#!/usr/bin/env node
// Offline optimizer: recomputes the OPT table in js/optimal.js from the same physics the page uses.
//
// Pass 1  For each power budget, every propeller blade count (1-5) and every cyclorotor blade
//         count (2-6): multi-start coordinate pattern search on solve().score. Per-blade pitch
//         (a1..a5) and tilt (c1..c5) stay at 0.
// Pass 2  For each budget, polish the best propeller with every setting free (blade count fixed),
//         including per-blade pitch and tilt: re-climb, then a few random kicks, each re-climbed.
//
// Usage:  npm run optimize -- [--budgets 15,30,45] [--starts 6] [--seed 1] [--workers N] [--out js/optimal.js]

import {Worker, isMainThread, parentPort} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFS, BASELINE, clamp01, encode, decode, solve} from '../js/physics.js';

const MIN_STEP = 1 / 1024;   // stop halving below ~0.1% of each setting's range
const SAMPLES_PER_START = 12; // a start is the best of a few uniform samples, so climbs rarely begin on the flat "can't lift" floor
const KICKS = 4;              // random kicks in the polish pass
const KICK_SIGMA = 0.05;      // kick size, as a fraction of each setting's range
const PROP_N = [1, 2, 3, 4, 5];
const CYCLO_N = [2, 3, 4, 5, 6];

/* ---------- search ---------- */

// Seeded PRNG (mulberry32), so a run is reproducible whatever order the workers finish in.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join(':')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function gauss(rand) {
  let u = 0, v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Objective in the page's normalized [0,1] space; counts every simulated test.
function objective(mode, budget) {
  const f = u => {
    f.evals++;
    const s = solve(mode, decode(mode, u), budget).score;
    return Number.isFinite(s) ? s : -Infinity;
  };
  f.evals = 0;
  return f;
}

// Coordinate pattern search: try +step and -step on each free setting and keep any gain;
// when a full sweep finds nothing, halve the step; stop once the step drops below MIN_STEP.
function climb(f, u0, dims, step) {
  let u = u0.slice(), best = f(u);
  while (step >= MIN_STEP) {
    let improved = false;
    for (const i of dims) {
      for (const s of [step, -step]) {
        const v = u.slice();
        v[i] = clamp01(u[i] + s);
        if (v[i] === u[i]) continue;
        const fv = f(v);
        if (fv > best) { u = v; best = fv; improved = true; break; }
      }
    }
    if (!improved) step /= 2;
  }
  return {u, score: best};
}

const round4 = v => Math.round(v * 1e4) / 1e4;
function design(mode, u) {
  const g = decode(mode, u);
  for (const k in g) g[k] = round4(g[k]);
  return g;
}
function report(mode, g, budget) {
  const r = solve(mode, g, budget);
  return {score: r.score, gpw: r.gpw, grams: r.grams, rpm: r.rpm, lifts: r.lifts};
}

// Pass 1: one rotor type, one blade count, one budget. Per-blade pitch and tilt fixed at 0.
function runClimb({mode, n, budget, starts, seed}) {
  const defs = DEFS[mode], rand = rng(hashSeed(seed, 'climb', mode, budget, n));
  const base = encode(mode, {...BASELINE[mode], n});
  const dims = defs.map((d, i) => i).filter(i => defs[i].k !== 'n' && defs[i].group !== 'angles');
  const f = objective(mode, budget);
  let best = null;
  for (let s = 0; s < starts; s++) {
    let u0 = null, f0 = -Infinity;
    for (let k = 0; k < SAMPLES_PER_START; k++) {
      const u = base.slice();
      for (const i of dims) u[i] = rand();
      const fu = f(u);
      if (fu > f0) { f0 = fu; u0 = u; }
    }
    const r = climb(f, u0, dims, 0.25);
    if (!best || r.score > best.score) best = r;
  }
  const g = design(mode, best.u);
  return {mode, n, budget, g, ...report(mode, g, budget), evals: f.evals};
}

// Pass 2: every setting free except the blade count, including pitch and tilt of each blade in use.
function runPolish({budget, g: g0, seed}) {
  const mode = 'prop', defs = DEFS[mode], rand = rng(hashSeed(seed, 'polish', budget));
  const dims = defs.map((d, i) => i).filter(i => defs[i].k !== 'n' && !(defs[i].blade > g0.n));
  const f = objective(mode, budget);
  let best = climb(f, encode(mode, {...BASELINE[mode], ...g0}), dims, 1 / 16);
  for (let k = 0; k < KICKS; k++) {
    const v = best.u.slice();
    for (const i of dims) v[i] = clamp01(v[i] + KICK_SIGMA * gauss(rand));
    const r = climb(f, v, dims, 1 / 16);
    if (r.score > best.score) best = r;
  }
  const g = design(mode, best.u);
  return {mode, n: g.n, budget, g, ...report(mode, g, budget), evals: f.evals};
}

/* ---------- worker pool ---------- */

function runJob(job) {
  const t0 = performance.now();
  const r = job.kind === 'polish' ? runPolish(job) : runClimb(job);
  return {...r, kind: job.kind, ms: performance.now() - t0};
}

function runPool(jobs, size, onResult) {
  return new Promise((done, fail) => {
    const results = new Array(jobs.length);
    let next = 0, finished = 0;
    if (!jobs.length) return done(results);
    for (let w = 0; w < Math.min(size, jobs.length); w++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      let cur = -1;
      const feed = () => {
        if (next < jobs.length) worker.postMessage(jobs[(cur = next++)]);
        else worker.terminate();
      };
      worker.on('message', r => {
        results[cur] = r;
        onResult(r, ++finished, jobs.length);
        if (finished === jobs.length) done(results);
        feed();
      });
      worker.on('error', fail);
      feed();
    }
  });
}

/* ---------- output ---------- */

// Same data layout the page has always used: OPT[mode]['b' + watts] = full design.
const fmtDesign = g => '{' + Object.entries(g).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + '}';
const budgetsOf = o => Object.keys(o || {}).map(k => +k.slice(1)).sort((a, b) => a - b);
function formatOpt(opt) {
  const ws = budgetsOf(opt.prop);
  const list = ws.length > 1 ? ws.slice(0, -1).join(', ') + ' and ' + ws.at(-1) : String(ws[0] ?? '');
  const body = Object.keys(opt).map(mode => {
    const rows = budgetsOf(opt[mode]).map(w => `    "b${w}": ${fmtDesign(opt[mode]['b' + w])}`);
    return `  ${JSON.stringify(mode)}: {\n${rows.join(',\n')}\n  }`;
  });
  return `// Results of an exhaustive multi-start search (noise-free model) at ${list} W.\n` +
    '// Written by tools/optimize.mjs (npm run optimize). Rerun it instead of editing by hand.\n' +
    `export const OPT={\n${body.join(',\n')}\n};\n`;
}
function readOpt(file) {
  if (!existsSync(file)) return {};
  const m = readFileSync(file, 'utf8').match(/export const OPT=(\{[\s\S]*\});/);
  if (!m) throw new Error(`${file} does not contain "export const OPT={...};"`);
  return JSON.parse(m[1]);
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const o = {budgets: [15, 30, 45], starts: 6, seed: 1, workers: availableParallelism(),
    out: fileURLToPath(new URL('../js/optimal.js', import.meta.url))};
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const val = () => inline ?? argv[++i];
    if (flag === '--budgets') o.budgets = val().split(',').map(Number);
    else if (flag === '--starts') o.starts = +val();
    else if (flag === '--seed') o.seed = +val();
    else if (flag === '--workers') o.workers = +val();
    else if (flag === '--out') o.out = resolve(val());
    else if (flag === '--help' || flag === '-h') o.help = true;
    else throw new Error(`unknown option ${argv[i]} (try --help)`);
  }
  if (!o.budgets.length || o.budgets.some(b => !(b > 0))) throw new Error('--budgets needs positive watts, e.g. 15,30,45');
  for (const k of ['starts', 'workers']) if (!(Number.isInteger(o[k]) && o[k] >= 1)) throw new Error(`--${k} needs a whole number >= 1`);
  if (!Number.isFinite(o.seed)) throw new Error('--seed needs a number');
  return o;
}

const HELP = `Recompute the stored optimum designs (js/optimal.js).

  --budgets 15,30,45   power budgets in watts (the page reads b15, b30 and b45)
  --starts 6           random starts per rotor type, blade count and budget
  --seed 1             random seed; the same seed gives the same result
  --workers N          worker threads (default: all cores)
  --out FILE           where to write the table (default: js/optimal.js)

Budgets you do not list keep their current entries in the output file.`;

const pad = (s, w) => String(s).padStart(w);
const cell = r => (r ? r.score.toFixed(2) + (r.lifts ? ' ' : '*') : '–');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const {budgets, starts, seed, workers, out} = opts;
  const t0 = performance.now();
  console.log(`Budgets ${budgets.join(', ')} W · ${starts} starts · seed ${seed} · ${workers} workers`);

  // slowest jobs first (more blades = more work per test) so the pool finishes evenly
  const jobs = [];
  for (const budget of budgets) {
    for (const n of [...PROP_N].reverse()) jobs.push({kind: 'climb', mode: 'prop', n, budget, starts, seed});
    for (const n of [...CYCLO_N].reverse()) jobs.push({kind: 'climb', mode: 'cyclo', n, budget, starts, seed});
  }
  const progress = (r, i, total) => console.log(
    `  [${pad(i, String(total).length)}/${total}] ${r.kind === 'polish' ? 'polish' : 'search'} ${r.mode.padEnd(5)} n=${r.n} @ ${pad(r.budget, 2)} W` +
    `  ${pad(r.score.toFixed(3), 7)} g/W  ${pad(r.evals, 6)} tests  ${(r.ms / 1000).toFixed(1)} s`);

  console.log('Pass 1: multi-start pattern search, blade pitch and tilt fixed at 0');
  const climbs = await runPool(jobs, workers, progress);
  const pick = (mode, budget) => climbs.filter(r => r.mode === mode && r.budget === budget).reduce((a, b) => (b.score > a.score ? b : a));

  console.log('Pass 2: polish the best propeller with every setting free');
  const polished = await runPool(budgets.map(budget => ({kind: 'polish', budget, g: pick('prop', budget).g, seed})), workers, progress);

  // merge into the existing table so unlisted budgets keep their entries
  const stored = readOpt(out);
  const opt = {prop: {...stored.prop}, cyclo: {...stored.cyclo}};
  const storedScore = (mode, b) => {
    const g = stored[mode]?.['b' + b];
    return g ? solve(mode, {...BASELINE[mode], ...g}, b).score : null;
  };
  const rows = [];
  budgets.forEach((b, i) => {
    const p1 = pick('prop', b), pol = polished[i], cy = pick('cyclo', b);
    const prop = pol.score >= p1.score ? pol : p1; // polishing starts from p1, so it can only match or improve
    opt.prop['b' + b] = prop.g;
    opt.cyclo['b' + b] = cy.g;
    rows.push({b, mode: 'prop', best: p1, final: prop, stored: storedScore('prop', b)});
    rows.push({b, mode: 'cyclo', best: cy, final: cy, stored: storedScore('cyclo', b)});
  });
  writeFileSync(out, formatOpt(opt));

  const evals = [...climbs, ...polished].reduce((a, r) => a + r.evals, 0);
  const ns = [1, 2, 3, 4, 5, 6];
  console.log('\nLift per watt (g/W) of the best design found; * = cannot lift the mast head, score penalised\n');
  console.log(`Budget  Rotor  ${ns.map(n => pad('n=' + n, 7)).join(' ')}    Pass 1   Final        Stored   Change`);
  for (const r of rows) {
    const per = ns.map(n => pad(cell(climbs.find(c => c.mode === r.mode && c.budget === r.b && c.n === n)), 7)).join(' ');
    const change = r.stored == null ? '      new' : pad(((r.final.score / r.stored - 1) * 100).toFixed(2) + '%', 9);
    console.log(`${pad(r.b + ' W', 6)}  ${r.mode.padEnd(5)}  ${per}  ${pad(r.best.score.toFixed(3), 8)}  ${pad(r.final.score.toFixed(3), 6)} n=${r.final.n}` +
      `  ${pad(r.stored == null ? '–' : r.stored.toFixed(3), 7)}  ${change}`);
  }
  for (const b of budgets) {
    const r = rows.find(x => x.b === b && x.mode === 'prop').final;
    console.log(`\n${b} W propeller: ${r.gpw.toFixed(2)} g/W, ${r.grams.toFixed(0)} g net lift at ${r.rpm.toFixed(0)} rpm`);
  }
  const worse = rows.filter(r => r.stored != null && r.final.score < r.stored - 1e-9);
  if (worse.length) console.log(`\nNote: ${worse.length} new design(s) score below the stored ones (try more --starts). Review with git diff before committing.`);
  if (budgets.some(b => ![15, 30, 45].includes(b))) console.log('Note: the page only reads b15, b30 and b45.');
  console.log(`\n${evals.toLocaleString('en-US')} simulated tests in ${((performance.now() - t0) / 1000).toFixed(1)} s · wrote ${out}`);
}

if (isMainThread) {
  main().catch(e => { console.error(e.message); process.exit(1); });
} else {
  parentPort.on('message', job => parentPort.postMessage(runJob(job)));
}
