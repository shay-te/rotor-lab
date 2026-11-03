# Rotor Lab

An interactive 3D test stand for finding the rotor blade that lifts the most per watt.

**Live site: https://shay-te.github.io/rotor-lab/**

## What it does

A rotor sits on a telescopic mast that can only move up and down. Every test gets the same power budget, so the rotor that lifts the most is also the most efficient one. The mast rises with net lift, and sensors report thrust, power, speed, figure of merit and side force.

You can change:

- **Rotor type**: propeller, or a cyclorotor (blades on a drum that turns sideways).
- **Blade count**: 1 to 5 (a single blade gets a counterweight).
- **Blade length**: 8 to 40 cm.
- **Blade outline**: a main panel plus a second panel that slides out at 8 points along the blade, from root to tip. Presets for square, triangle, reverse triangle, root panel and tip panel.
- **Pitch, twist, camber and tip sweep**.
- **Per-blade pitch and tilt**: each blade gets its own pitch offset and can tilt from 90° down to 90° up.

## AI search

**Start AI search** runs a Bayesian optimizer (a Gaussian-process model with expected improvement). It picks each test, learns from the result, and writes down why it chose the next shape. It is built to find a good design in about 80 tests with ±3% sensor noise, which is how it would work on a real rig where every test means printing a blade.

**Optimal** loads the best design found by an exhaustive offline search (more than a million simulated tests, multi-start pattern search, every blade count, at 15, 30 and 45 W).

## Optimal design (simulated, 30 W)

| Setting | Value |
|---|---|
| Blades | 4 (3–5 are within 0.4%) |
| Blade length | 40 cm (limit) |
| Width | 12 mm at the hub, then 20 mm to the tip |
| Pitch | 10.5° at 75% radius |
| Twist | 30° |
| Camber | 8% (limit) |
| Per-blade pitch and tilt | all 0° |
| Result | 21.8 g/W, about 695 g of lift at about 700 rpm |

Findings that held across every search:

- Blade length matters most. Bigger rotors spin slower and move more air, which is more efficient.
- Equal, flat blades always win. Unequal pitch or tilt costs efficiency and shakes the rig.
- Outline matters little once twist is right. Smooth shapes beat jagged ones.
- The best cyclorotor reaches about a third of the propeller's lift per watt.

## The physics model

- **Propeller**: blade-element momentum theory with Prandtl tip loss, a low-Reynolds airfoil model with stall, per-blade forces (so unequal blades create a rotating imbalance), blade tilt, and an extra drag term for sudden width changes.
- **Cyclorotor**: a quasi-steady model with cyclic pitch and induced inflow along the thrust direction.
- **Limits**: blades are rigid; there is no ground effect, no forward flight, no blade flex and no rotor-to-rotor interaction. High camber is probably overrated by the model.

Use it to rank shapes, then confirm the winners on a real rig.

## Next step: the physical rig

The plan is a 3D-printed test stand where the same AI planner chooses each blade. It would generate an STL file for printing, then read a load cell (lift) and a current and voltage sensor (power), and decide what to print next.

## Run locally

The page is plain static files with no build step, but it uses ES modules, so it has to be served over HTTP (opening `index.html` straight from disk will not load the scripts). From the repo root:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
npx serve .                   # or this, then open http://localhost:3000/
```

## Project structure

```
index.html              page markup; loads css/style.css and js/main.js
css/style.css           all styles (design tokens in :root at the top)
js/main.js              entry point: AI search runs, frame loop, event wiring, start-up
js/state.js             the shared mutable state object S
js/physics.js           rotor models and scoring: DEFS, BASELINE, airfoil, evalProp,
                        evalCyclo, bladeMass, solve (pure: no DOM, no THREE)
js/planner.js           Gaussian-process Bayesian optimizer (GP, Planner, explain)
js/scene.js             Three.js scene: lab, rig, telescopic mast, rotor meshes, downwash
js/ui.js                sliders, presets, telemetry, blade outline, side-force dial,
                        results chart, planner log
js/optimal.js           OPT: stored optimum designs (generated, see below)
tools/optimize.mjs      offline optimizer that regenerates js/optimal.js
.github/workflows/      GitHub Pages deployment
```

The imports have no cycles. `physics.js` depends on nothing, `planner.js` and `state.js` build on it, `scene.js` adds the state, `ui.js` adds the scene, and `main.js` ties them all together.

Three.js r147 comes from jsDelivr through the import map in `index.html` (`three` and `three/addons/`).

## Recompute the optimum

`js/optimal.js` is written by an offline optimizer that imports the same `js/physics.js` as the page (Node 20 or newer, no dependencies):

```sh
npm run optimize
```

For each power budget it runs a multi-start coordinate pattern search for every propeller blade count (1–5) and every cyclorotor blade count (2–6), with per-blade pitch and tilt at 0. It then polishes the best propeller with every setting free, per-blade pitch and tilt included, using random kicks and re-climbs. It prints a summary table comparing the new designs with the stored ones, then rewrites `js/optimal.js`. A full run (about 125,000 simulated tests) takes around two minutes on a 10-core laptop, spread across all cores, and lands within 0.1% of the stored designs.

| Option | Default | Meaning |
|---|---|---|
| `--budgets 15,30,45` | 15,30,45 | Power budgets in watts. The page reads b15, b30 and b45; budgets you leave out keep their stored entries. |
| `--starts 6` | 6 | Random starts per rotor type, blade count and budget. |
| `--seed 1` | 1 | Random seed. The same seed gives the same result. |
| `--workers N` | all cores | Worker threads. |
| `--out FILE` | `js/optimal.js` | Where to write the table. Point it elsewhere for a trial run. |

Example of a quick trial run that leaves the stored table alone:

```sh
npm run optimize -- --budgets 30 --starts 1 --out /tmp/optimal.js
```

## Deployment

Every push to `master` deploys the repo root to GitHub Pages through `.github/workflows/pages.yml`. In the repository settings, **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**.
