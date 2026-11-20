# Quick Guide: Using `memory` in Particle Control Lab

*Barefoot Undergraduate Students — Particle Control Lab v1.6 and later*

## 1. What is `memory`?

`memory` is a JavaScript object that **preserves student-defined values between controller calls**. It is useful for integral terms, previous errors, model estimates, counters, and histories.

The simulator automatically calls `controller()` every sampling period, `params.dt`. It also updates the physical `state`. **Your code is responsible for updating `memory`.**

In v1.6, we have two standard functions:

| Function | When the simulator calls it | What you do |
|---|---|---|
| `init()` | **Once** at the start of each fresh experiment | Initialize your memory variables |
| `controller()` | **Every** sampling period $T_s$ | Compute forces and update your memory variables |

You can also write any number of helper functions. All of them can access `state`, `params`, and `memory` directly.

## 2. Initialize in `init()`, update in `controller()`

You no longer need an initialization check inside every controller or helper function.

```javascript
function init() {
  memory.counter = 0;
  memory.integralX = 0;
  memory.previousErrorX = 0;
  memory.history = [];  // An empty JavaScript array
}

function controller() {
  const ex = state.target.x - state.x;

  memory.counter += 1;
  memory.integralX += ex * params.dt;
  memory.previousErrorX = ex;

  return { fx: 0, fy: 0 };  // Replace with your control law
}
```

The simulator clears memory and calls `init()` again on a fresh experiment/reset. **Pause and resume do not reinitialize memory.** Each automated challenge also gets fresh memory.

> `init()` is optional, but recommended whenever your controller needs stored values. If you omit it, `memory` begins as `{}`.

## 3. What does `undefined` mean?

An object property that has never been assigned a value is `undefined` — **not zero**.

```javascript
// If this property has not been initialized:
memory.data1;       // undefined
memory.data1 += 1;  // becomes NaN (Not a Number)
```

The preferred v1.6 solution is to initialize the property in `init()`:

```javascript
function init() {
  memory.data1 = 0;
}
```

If a property truly needs to be initialized later, JavaScript also supports:

```javascript
if (memory.data2 === undefined) memory.data2 = 0;
// or:
memory.data2 ??= 0;
```

These are still valid, but **routine controller initialization belongs in `init()`**.

## 4. Example: PI control with persistent memory

```javascript
function init() {
  memory.integralX = 0;
}

function controller() {
  const Kp = 10;
  const Ki = 2;
  const ex = state.target.x - state.x;

  // Integrate the position error once per sampling period.
  memory.integralX += ex * params.dt;

  const fx = Kp * ex + Ki * memory.integralX;
  return { fx, fy: 0 };
}
```

`memory.integralX` keeps its value between calls. **Do not reset it to zero inside `controller()`**, or the integral will never accumulate.

## 5. Lists in JavaScript are called **arrays**

An array can store many values under one property. Array positions are numbered starting from **0**.

### Create an empty history

```javascript
function init() {
  memory.history = [];
}
```

### Add new samples with `push()`

```javascript
// Inside controller() or a custom function:
memory.history.push(state.x);
```

If successive values are `1.2`, `1.5`, and `1.7`, the array becomes:

```javascript
memory.history;  // [1.2, 1.5, 1.7]
```

### Read samples back

```javascript
const first  = memory.history[0];  // 1.2
const second = memory.history[1];  // 1.5
const latest = memory.history[memory.history.length - 1];  // 1.7
const count  = memory.history.length;  // 3
```

To read the latest value safely when a history might be empty:

```javascript
const latest = memory.history.length > 0
  ? memory.history[memory.history.length - 1]
  : undefined;
```

### Read several previous samples

```javascript
const n = memory.history.length;
if (n >= 2) {
  const current  = memory.history[n - 1];
  const previous = memory.history[n - 2];
  const difference = current - previous;
}
```

### Iterate through an array

```javascript
let sum = 0;
for (const value of memory.history) {
  sum += value;
}
```

## 6. Arrays can also store objects

Instead of storing only position, we can record several values per sample.

```javascript
function init() {
  memory.history = [];
}

function controller() {
  const ex = state.target.x - state.x;

  memory.history.push({
    t: state.t,
    x: state.x,
    error: ex
  });

  const last = memory.history[memory.history.length - 1];
  const lastTime = last.t;
  const lastPosition = last.x;
  const lastError = last.error;

  return { fx: 10 * ex, fy: 0 };
}
```

Here `memory.history[0].x` means **the position stored in the first record**. This is useful for data logging, moving-average filters, observers, and model-based control.

## 7. Keep a bounded history

If you `push()` forever, the array grows on every simulation step. For a long-running browser simulation, it is better to keep only the most recent samples when that's all your algorithm needs.

```javascript
function init() {
  memory.history = [];
}

function controller() {
  memory.history.push(state.x);

  // Keep only the latest 100 samples.
  if (memory.history.length > 100) {
    memory.history.shift();  // Remove the oldest sample.
  }

  return { fx: 0, fy: 0 };
}
```

Other useful operations: `memory.history.pop()` removes the **last** entry; `memory.history.length` tells you how many entries are stored.

## 8. Who updates what?

| Object | Who updates it? | Student rule |
|---|---|---|
| `state` | Simulator | Read particle and target values |
| `params` | Experiment configuration | Read mass, damping, `dt`, force limits |
| `memory` | **Your JavaScript code** | Initialize in `init()`, update in `controller()` and helpers |

The simulator does not automatically generate `memory.history` or other memory properties. It only preserves your values between calls.

## 9. Common mistakes

**Mistake: reading an array that was never initialized**

```javascript
memory.history.push(state.x);  // Error if memory.history is undefined
```

**Fix:** assign `memory.history = []` in `init()` first.

**Mistake: clearing the history every sample**

```javascript
function controller() {
  memory.history = [];  // Previous samples are lost!
  memory.history.push(state.x);
  return { fx: 0, fy: 0 };
}
```

**Fix:** create the array in `init()`, then only `push()` inside `controller()`.

**Mistake: confusing array indices and length**

For an array with three elements, valid indices are `0`, `1`, and `2`; `history[3]` is `undefined`. The last index is always `history.length - 1` when the array is not empty.

**Remember:** **Initialize once in `init()` → update every sampling period in `controller()` → read stored values when needed.**
