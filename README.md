# Two-Tank Control Lab v1.0

___URL: https://auralius.github.io/Two_Tank_Control_Lab/___

---

**Nonlinear liquid-level control · Student edition**

A lightweight JavaScript playground for controlling two non-interacting tanks in series. The pump feeds Tank 1, gravity transfers the liquid to Tank 2, and Tank 2 drains to the environment. Students regulate the **level of Tank 2**, using a **single pump command**. The lab uses only browser-native HTML/CSS/JavaScript and a Web Worker; no npm dependencies or software installation are required.

## Run locally (Ubuntu / Linux)

Extract the project, open a terminal in its folder, and run:

```bash
python3 -m http.server 8000
```

Visit <http://localhost:8000/>. Stop with **Ctrl+C**. Do not open `index.html` directly with `file://`: browser restrictions can prevent the Web Worker from loading.

Publish on GitHub Pages by uploading this folder's **contents** to your GitHub repository and selecting **Settings → Pages → Deploy from a branch → main / (root)**. Then visit the generated HTTPS address.

## 1. The nonlinear process

With water levels `h1`, `h2` in **cm** and flows in **L/s**:

$$
\begin{aligned}
A_1\dot h_1(t) &= q_p(t) - q_{12}(t),\\
A_2\dot h_2(t) &= q_{12}(t) - q_2(t) - d(t),\\
q_{12}(t) &= k_{12}\sqrt{h_1(t)},\\
q_2(t) &= k_2\sqrt{h_2(t)},\\
q_p(t) &= \frac{u(t)}{100}q_{\max}.
\end{aligned}
$$

`u` is the controller's **pump command in percent**, saturated to the interval **[0, 100]**. The controller manipulates only this pump command. The additional drain `d(t)` is zero except during the leak-disturbance exercise. The outlet obeys an idealized square-root gravity relation; the tanks are **non-interacting**, meaning `q12` depends on Tank 1 level, *not* the difference `h1-h2`.

| Parameter | Meaning | Default |
|---|---|---:|
| `A1` | Tank 1 volume change per cm (L/cm) | 1.4 |
| `A2` | Tank 2 volume change per cm (L/cm) | 1.6 |
| `k12` | Inter-tank outlet coefficient (L/s/√cm) | 0.65 |
| `k2` | Tank 2 outlet coefficient (L/s/√cm) | 0.43 |
| `qmax` | Maximum pump flow (L/s) | 3.2 |
| `hmax` | Maximum liquid level (cm) | 60 |
| `dt` | Controller sample time (s) | 0.2 |

Initial conditions: `h1(0)=10 cm`, `h2(0)=8 cm`; initial pump command is zero. Tank overflow and dry-out are modeled by keeping each tank's volume in `[0, Ai*hmax]` and accounting for spilled volume. These limits make the physical system **nonlinear with constraints**.

### Discretization

At each controller sample `T_s=params.dt`, the simulator holds the command constant. It integrates the volume-balance equations with forward Euler using internal substeps no larger than **0.05 s**. For a substep `δ`:

$$
\begin{aligned}
V_1^+ &= V_1 + \delta(q_p-q_{12}),\\
V_2^+ &= V_2 + \delta(q_{12}-q_2-d),\\
h_1^+ &= V_1^+/A_1,\quad h_2^+=V_2^+/A_2.
\end{aligned}
$$

The implementation caps withdrawals to available liquid, prevents negative volumes, and spills any liquid above each tank's maximum capacity. Substep flows are integrated as volumes; reported flow values are **sample-averaged** over the most recent `params.dt`.

Because `k*sqrt(h)` is nonlinear, a controller tuned for one operating point may behave differently at another. Students can investigate **PI/PID, operating-point linearization, feedforward control, and nonlinear model-based control**.

## 2. Programming model

The simulator calls two standard callbacks:

- **`init()`** — optional; called once at the start of every fresh experiment to initialize student-owned memory.
- **`controller()`** — required; called automatically once per **simulation sample**, not once per animation frame. It returns either a scalar pump percentage, such as `return 0;`, or an object `{ pump: 0 }`.

Any number of custom functions can be defined. All functions see **global script bindings** named `state`, `params`, and `memory`, which the worker refreshes before calling `controller()`.

### Student starter (intentionally unsolved)

```javascript
function init() {
  memory.integral = 0;
  memory.history = [];
}

function controller() {
  const error = state.target.h2 - state.h2;

  // TODO: Calculate a pump percentage (0-100).
  const pump = 0;
  return pump;
}
```

This returns zero pump flow until the student implements a controller. **The simulator automatically updates the physical tank states**; students must not assign `state.h1` or `state.h2` directly. No manual stepping is needed inside the controller. Older code using the positional signature `controller(state, params, memory)` is also accepted.

### `state` — read-only measured and simulated variables

| Property | Meaning |
|---|---|
| `state.h1`, `state.h2` | Tank levels (cm) |
| `state.target.h2` | Tank 2 reference (cm) |
| `state.error` | `state.target.h2 - state.h2` (cm) |
| `state.t` | Simulation time (s) |
| `state.u` | Previously applied pump command (%) |
| `state.qpump` | Previous sample-average pump flow (L/s) |
| `state.q12` | Previous sample-average transfer flow (L/s) |
| `state.qout` | Previous sample-average Tank 2 outlet flow (L/s) |
| `state.qleak` | Previous sample-average extra leak flow (L/s) |
| `state.overflow1`, `.overflow2` | Previous sample-average tank overflows (L/s) |

### `params` — read-only physical parameters

`params.A1`, `params.A2`, `params.k12`, `params.k2`, `params.qmax`, `params.hmax`, and **`params.dt`**. The selected sample time can be **0.05, 0.1, 0.2, 0.5, or 1 second**. Changing it resets the experiment. Playback SPEED changes wall-clock rate without changing `params.dt`.

### `memory` — fully student-managed persistent data

The memory object starts as `{}` at every new experiment. Its properties do not default to zero. Initialize them in `init()` and update them in `controller()` or helper functions. For example:

```javascript
function init() {
  memory.totalError = 0;
  memory.history = [];
}

function rememberLevel() {
  memory.history.push(state.h2);
  return memory.history[memory.history.length - 1];
}
```

`memory.history.length` is the number of recorded samples, `memory.history[0]` the first sample, `memory.history.at(-1)` the most recent (in modern browsers), and `memory.history[memory.history.length-2]` the previous sample once at least two are stored. Use `shift()` or a fixed-size circular buffer if retaining every sample for a long simulation would consume too much memory.

`init()` runs again when Reset, Apply & reset, a plant parameter, or a scenario selection creates a fresh experiment. It **does not** rerun when simulation is paused and resumed. Each built-in test starts with its own fresh memory.

## 3. Four experiments

| Scenario | Reference/disturbance | Duration | Built-in pass criterion |
|---|---|---:|---|
| Fixed setpoint | `h2` target = 26 cm (manual setpoint adjustable) | 260 s | Mean absolute error over final 25 s < 2 cm |
| Setpoint change | 20 cm → 32 cm at `t=105 s` | 260 s | Mean absolute error over final 25 s < 2.5 cm |
| Moving target | 18 cm initially; ramp to 29 cm from 35–180 s | 260 s | RMS error over 130–260 s < 4.5 cm |
| Extra leak | Target 26 cm; extra leak `d=0.45 L/s` after `t=115 s` | 260 s | Mean absolute error over final 25 s < 2.5 cm |

The **Run 4 tests** button evaluates the **current controller code** against these four built-in scenarios with the current plant parameters. Each test is independent and triggers its own `init()`. The thresholds are educational feedback, **not a tamper-proof autograder**. A well-tuned PI controller can pass all four; proportional-only feedback typically leaves substantial offset.

**Run to end** completes the currently selected experiment quickly for demonstrations or CSV export; **Step** advances exactly one sampling interval. With Run, select an accelerated playback speed for shorter waits.

## 4. CSV export and reproducibility

The **Export CSV** button exports one row per time sample plus the initial state for the current experiment. Header:

```text
scenario,t_s,h1_cm,h2_cm,target_h2_cm,pump_command_pct,pump_flow_Lps,transfer_flow_Lps,outlet_flow_Lps,leak_flow_Lps,overflow1_Lps,overflow2_Lps,error_h2_cm,A1_L_per_cm,A2_L_per_cm,k12_Lps_per_sqrt_cm,k2_Lps_per_sqrt_cm,qmax_Lps,hmax_cm,dt_s
```

Each row after the first represents the state at the **end of the sample interval**; its command and flows correspond to the interval just completed. Discrete flow values are averaged over that interval. Exported metadata makes it easier to validate student results with a future CSV autograder; however, CSV data alone cannot prove authorship. Students should submit both their controller `.js` file and their CSV traces.

Click **Copy setup link** to share an initial experiment URL, for example:

```text
https://auralius.github.io/Two_Tank_Control_Lab/?task=leak&A1=1.4&A2=1.6&k12=0.65&k2=0.43&qmax=3.2&dt=0.2&setpoint=26
```

The URL sets initial values; it does not prevent students from modifying them.

## 5. Classroom exploration (no solutions)

1. Begin with a proportional controller. How much steady-state error remains? Why does the pump need nonzero power at steady state?
2. Add an integrator using `memory` and `params.dt`. Compare P and PI under the extra leak disturbance.
3. Derive equilibrium inflow `q_p^*=k_2√h_2^*` and upstream equilibrium `h_1^*=(q_p^*/k_{12})²`. Convert the equilibrium flow into a nominal pump percentage.
4. Linearize the two square-root equations near an operating point and compare the linearized model with the nonlinear simulator.
5. Investigate flow saturation, full tanks, dry-out, and integral windup.
6. Vary `T_s` while holding controller gains fixed. Observe the combined effects of controller sampling and numerical integration.

## Project files

- `index.html`: student UI, full controller API reference
- `styles.css`: responsive styles, animated tanks
- `app.js`: editor, controls, charts, CSV and URL sharing
- `worker.js`: controller lifecycle, isolated runtime, scenario tests
- `physics.js`: pure nonlinear hydraulic plant and integration
- `tests/test_physics_and_worker.js`: optional Node.js correctness tests for instructors
- `LICENSE`: MIT

Test (instructors only): `node tests/test_physics_and_worker.js`. Students need **only a browser**.

## Limitations

This is a **teaching simulator**, not a physical water-handling design tool. It assumes gravity discharge with simple square-root laws, ideal pump-flow command, and fixed cross-sectional areas. It is not an interacting-tank model, and does not simulate pump dynamics, sensor noise, bubbles, cavitation, or valves. Controllers execute in a browser Web Worker; arbitrary student JavaScript should still be treated as **untrusted code**. A student can create an infinite loop or access network/browser capabilities available in that context. Use trusted classroom code; the Worker primarily keeps computation separate from the interface.
