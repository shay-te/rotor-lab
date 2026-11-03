# Rotor Lab

An interactive 3D test stand for finding the rotor blade that lifts the most per watt.

Open `index.html` in a browser, or visit the GitHub Pages site for this repository.

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

## Tech

A single HTML file with no build step. Three.js r147 is loaded from jsDelivr.
