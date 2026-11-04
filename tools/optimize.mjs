#!/usr/bin/env node
// Offline optimizer: recomputes the OPT table in js/optimal.js from the same physics the page uses.
//
// Pass 1  For each power budget, every propeller blade count (1-5) and every cyclorotor blade
//         count (2-6): multi-start CMA-ES on solve().score. Per-blade pitch (a1..a5) and tilt
//         (c1..c5) stay at 0; every other setting, all 8 outline points included, is free.
// Pass 2  For each budget, polish the best propeller with every setting free (blade count fixed),
//         including per-blade pitch and tilt: local CMA-ES runs from the pass-1 winner.
//
// A budget keeps its stored design unless this run beats it by more than MIN_GAIN, so the table
// only ever improves and does not flip between equally good designs from run to run.
//
// Usage:  npm run optimize -- [--budgets 15,30,45] [--starts 2] [--seed 1] [--workers N] [--out js/optimal.js]

import {Worker, isMainThread, parentPort} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFS, BASELINE, clamp01, encode, decode, solve} from '../js/physics.js';

const SAMPLES_PER_START = 12; // a search run starts at the best of a few uniform samples, so it rarely begins on the flat "can't lift" floor
const SEARCH_SIGMA = 0.3;     // first step of a search run, as a fraction of each setting's range
const POLISH_SIGMA = 0.03;    // first step of a polish run
const BOUND_PENALTY = 100;    // pulls the search back inside the ranges (many optimum settings sit on a limit)
const MAX_RUN_TESTS = 20000;  // safety cap on one CMA-ES run; runs normally stop well before it
const MIN_GAIN = 1e-4;        // a new design replaces the stored one only if it scores over 0.01% higher (3-5 blades often tie)
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

// Objective in the page's normalized [0,1] space, over the free settings only; counts every simulated test.
function objective(mode, budget, base, dims) {
  const f = x => {
    f.evals++;
    const u = base.slice();
    dims.forEach((i, k) => { u[i] = x[k]; });
    const s = solve(mode, decode(mode, u), budget).score;
    return Number.isFinite(s) ? s : -Infinity;
  };
  f.evals = 0;
  f.full = x => { const u = base.slice(); dims.forEach((i, k) => { u[i] = x[k]; }); return u; };
  return f;
}

// Jacobi eigen-decomposition of a symmetric matrix: eigenvalues, and eigenvectors as the columns of V.
function eig(A) {
  const n = A.length, a = A.map(row => row.slice());
  const V = a.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  return {values: a.map((row, i) => row[i]), V};
}

const popSize = dims => 4 + Math.floor(3 * Math.log(dims));

// One (mu/mu_w, lambda) CMA-ES run (Hansen's tutorial), maximizing f from mean m0 with step sigma0.
// It learns which settings pay off when moved together (neighbouring outline points, pitch with
// twist) and samples along those directions. Samples are scored clamped to the ranges; the penalty
// on how far they fell outside keeps the mean from drifting off a limit. Returns the best sample.
function cmaes(f, m0, sigma0, lambda, rand) {
  const N = m0.length, mu = Math.floor(lambda / 2);
  let w = [...Array(mu)].map((_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wSum = w.reduce((s, x) => s + x, 0);
  w = w.map(x => x / wSum);
  const mueff = 1 / w.reduce((s, x) => s + x * x, 0);
  const cc = (4 + mueff / N) / (N + 4 + 2 * mueff / N), cs = (mueff + 2) / (N + mueff + 5);
  const c1 = 2 / ((N + 1.3) ** 2 + mueff), cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((N + 2) ** 2 + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (N + 1)) - 1) + cs;
  const chiN = Math.sqrt(N) * (1 - 1 / (4 * N) + 1 / (21 * N * N));
  const eigenEvery = Math.max(1, Math.floor(1 / (10 * N * (c1 + cmu))));
  let m = m0.slice(), sigma = sigma0, pc = Array(N).fill(0), ps = Array(N).fill(0);
  const C = m.map((_, i) => m.map((_, j) => (i === j ? 1 : 0)));
  let B = C.map(row => row.slice()), D = Array(N).fill(1);
  let best = {x: m0.slice(), score: -Infinity}, tests = 0, gen = 0, lastGain = 0, eigenAt = 0;
  while (tests + lambda <= MAX_RUN_TESTS) {
    if (gen - eigenAt >= eigenEvery) {
      for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) C[j][i] = C[i][j];
      const e = eig(C);
      B = e.V; D = e.values.map(v => Math.sqrt(Math.max(v, 1e-20))); eigenAt = gen;
    }
    const pop = [];
    for (let k = 0; k < lambda; k++) {
      const z = [...Array(N)].map(() => gauss(rand)), y = Array(N).fill(0);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) y[i] += B[i][j] * D[j] * z[j];
      const x = m.map((mi, i) => mi + sigma * y[i]), xc = x.map(clamp01);
      const outside = x.reduce((s, xi, i) => s + (xi - xc[i]) ** 2, 0);
      const score = f(xc); tests++;
      if (score > best.score) { if (score > best.score + 1e-6) lastGain = gen; best = {x: xc, score}; }
      pop.push({x, fit: score - BOUND_PENALTY * outside});
    }
    pop.sort((p, q) => q.fit - p.fit);
    const mOld = m;
    m = Array(N).fill(0);
    for (let k = 0; k < mu; k++) for (let i = 0; i < N; i++) m[i] += w[k] * pop[k].x[i];
    const yw = m.map((mi, i) => (mi - mOld[i]) / sigma);
    const bty = Array(N).fill(0), cInvSqrtYw = Array(N).fill(0);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) bty[j] += B[i][j] * yw[i];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) cInvSqrtYw[i] += B[i][j] * bty[j] / D[j];
    const kps = Math.sqrt(cs * (2 - cs) * mueff);
    ps = ps.map((p, i) => (1 - cs) * p + kps * cInvSqrtYw[i]);
    const psNorm = Math.hypot(...ps);
    const hsig = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * (gen + 1))) / chiN < 1.4 + 2 / (N + 1) ? 1 : 0;
    const kpc = Math.sqrt(cc * (2 - cc) * mueff);
    pc = pc.map((p, i) => (1 - cc) * p + hsig * kpc * yw[i]);
    for (let i = 0; i < N; i++) for (let j = 0; j <= i; j++) {
      let rankMu = 0;
      for (let k = 0; k < mu; k++) rankMu += w[k] * ((pop[k].x[i] - mOld[i]) / sigma) * ((pop[k].x[j] - mOld[j]) / sigma);
      C[i][j] = (1 - c1 - cmu) * C[i][j] + c1 * (pc[i] * pc[j] + (1 - hsig) * cc * (2 - cc) * C[i][j]) + cmu * rankMu;
    }
    sigma *= Math.exp((cs / damps) * (psNorm / chiN - 1));
    gen++;
    const maxD = Math.max(...D), minD = Math.min(...D);
    const converged = sigma * maxD < 1e-4, degenerate = maxD / minD > 1e7, stalled = gen - lastGain > 10 + Math.ceil(30 * N / lambda);
    if (converged || degenerate || stalled) break;
  }
  return best;
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
// Each start doubles the population (IPOP restarts): a bigger population searches more widely.
function runSearch({mode, n, budget, starts, seed}) {
  const defs = DEFS[mode], rand = rng(hashSeed(seed, 'search', mode, budget, n));
  const base = encode(mode, {...BASELINE[mode], n});
  const dims = defs.map((d, i) => i).filter(i => defs[i].k !== 'n' && defs[i].group !== 'angles');
  const f = objective(mode, budget, base, dims);
  let best = null, lambda = popSize(dims.length);
  for (let s = 0; s < starts; s++, lambda *= 2) {
    let m0 = null, f0 = -Infinity;
    for (let k = 0; k < SAMPLES_PER_START; k++) {
      const x = dims.map(() => rand()), fx = f(x);
      if (fx > f0) { f0 = fx; m0 = x; }
    }
    const r = cmaes(f, m0, SEARCH_SIGMA, lambda, rand);
    if (!best || r.score > best.score) best = r;
  }
  const g = design(mode, f.full(best.x));
  return {mode, n, budget, g, ...report(mode, g, budget), evals: f.evals};
}

// Pass 2: every setting free except the blade count, including pitch and tilt of each blade in use.
function runPolish({budget, g: g0, starts, seed}) {
  const mode = 'prop', defs = DEFS[mode], rand = rng(hashSeed(seed, 'polish', budget));
  const base = encode(mode, {...BASELINE[mode], ...g0});
  const dims = defs.map((d, i) => i).filter(i => defs[i].k !== 'n' && !(defs[i].blade > g0.n));
  const f = objective(mode, budget, base, dims);
  const x0 = dims.map(i => base[i]);
  let best = {x: x0, score: f(x0)}, lambda = popSize(dims.length);
  for (let s = 0; s < starts; s++, lambda *= 2) {
    const r = cmaes(f, best.x, POLISH_SIGMA, lambda, rand);
    if (r.score > best.score) best = r;
  }
  const g = design(mode, f.full(best.x));
  return {mode, n: g.n, budget, g, ...report(mode, g, budget), evals: f.evals};
}

/* ---------- worker pool ---------- */

function runJob(job) {
  const t0 = performance.now();
  const r = job.kind === 'polish' ? runPolish(job) : runSearch(job);
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
  return `// Best designs from a multi-start CMA-ES search (noise-free model) at ${list} W.\n` +
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
  const o = {budgets: [15, 30, 45], starts: 2, seed: 1, workers: availableParallelism(),
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
  --starts 2           CMA-ES runs per rotor type, blade count and budget; each one
                       starts somewhere new with twice the previous population
  --seed 1             random seed; the same seed gives the same result
  --workers N          worker threads (default: all cores)
  --out FILE           where to write the table (default: js/optimal.js)

Budgets you do not list keep their current entries in the output file, and a
listed budget keeps its stored design unless this run beats it by more than 0.01%.`;

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
    for (const n of [...PROP_N].reverse()) jobs.push({kind: 'search', mode: 'prop', n, budget, starts, seed});
    for (const n of [...CYCLO_N].reverse()) jobs.push({kind: 'search', mode: 'cyclo', n, budget, starts, seed});
  }
  const progress = (r, i, total) => console.log(
    `  [${pad(i, String(total).length)}/${total}] ${r.kind} ${r.mode.padEnd(5)} n=${r.n} @ ${pad(r.budget, 2)} W` +
    `  ${pad(r.score.toFixed(3), 7)} g/W  ${pad(r.evals, 6)} tests  ${(r.ms / 1000).toFixed(1)} s`);

  console.log('Pass 1: multi-start CMA-ES, blade pitch and tilt fixed at 0');
  const searches = await runPool(jobs, workers, progress);
  const pick = (mode, budget) => searches.filter(r => r.mode === mode && r.budget === budget).reduce((a, b) => (b.score > a.score ? b : a));

  console.log('Pass 2: polish the best propeller with every setting free');
  const polished = await runPool(budgets.map(budget => ({kind: 'polish', budget, g: pick('prop', budget).g, starts, seed})), workers, progress);

  // merge into the existing table so unlisted budgets keep their entries
  const stored = readOpt(out);
  const opt = {prop: {...stored.prop}, cyclo: {...stored.cyclo}};
  const storedReport = (mode, b) => {
    const g = stored[mode]?.['b' + b];
    return g ? {n: g.n, ...report(mode, {...BASELINE[mode], ...g}, b)} : null;
  };
  const rows = [];
  budgets.forEach((b, i) => {
    const p1 = pick('prop', b), pol = polished[i], cy = pick('cyclo', b);
    const prop = pol.score >= p1.score ? pol : p1; // polishing starts from p1, so it can only match or improve
    for (const [mode, best, found] of [['prop', p1, prop], ['cyclo', cy, cy]]) {
      const old = storedReport(mode, b), kept = old != null && found.score <= old.score * (1 + MIN_GAIN);
      if (!kept) opt[mode]['b' + b] = found.g;
      rows.push({b, mode, best, found, stored: old, kept, written: kept ? old : found});
    }
  });
  writeFileSync(out, formatOpt(opt));

  const evals = [...searches, ...polished].reduce((a, r) => a + r.evals, 0);
  const ns = [1, 2, 3, 4, 5, 6];
  console.log('\nLift per watt (g/W) of the best design found; * = cannot lift the mast head, score penalised\n');
  console.log(`Budget  Rotor  ${ns.map(n => pad('n=' + n, 7)).join(' ')}    Pass 1   Final        Stored   Change`);
  for (const r of rows) {
    const per = ns.map(n => pad(cell(searches.find(c => c.mode === r.mode && c.budget === r.b && c.n === n)), 7)).join(' ');
    const change = r.stored == null ? '      new' : pad(((r.found.score / r.stored.score - 1) * 100).toFixed(2) + '%', 9);
    console.log(`${pad(r.b + ' W', 6)}  ${r.mode.padEnd(5)}  ${per}  ${pad(r.best.score.toFixed(3), 8)}  ${pad(r.found.score.toFixed(3), 6)} n=${r.found.n}` +
      `  ${pad(r.stored == null ? '–' : r.stored.score.toFixed(3), 7)}  ${change}${r.kept ? '  kept stored' : ''}`);
  }
  for (const b of budgets) {
    const r = rows.find(x => x.b === b && x.mode === 'prop').written;
    console.log(`\n${b} W propeller: ${r.n} blades, ${r.gpw.toFixed(2)} g/W, ${r.grams.toFixed(0)} g net lift at ${r.rpm.toFixed(0)} rpm`);
  }
  const kept = rows.filter(r => r.kept);
  if (kept.length) console.log(`\nNote: kept ${kept.length} stored design(s) that this run did not beat by more than ${MIN_GAIN * 100}%.`);
  if (budgets.some(b => ![15, 30, 45].includes(b))) console.log('Note: the page only reads b15, b30 and b45.');
  console.log(`\n${evals.toLocaleString('en-US')} simulated tests in ${((performance.now() - t0) / 1000).toFixed(1)} s · wrote ${out}`);
}

if (isMainThread) {
  main().catch(e => { console.error(e.message); process.exit(1); });
} else {
  parentPort.on('message', job => parentPort.postMessage(runJob(job)));
}
