/* Two-Tank Control Lab: nonlinear, non-interacting gravity-fed cascade.
   Tank 1 receives pump flow, tank 1 drains to tank 2, tank 2 drains outside.
   Units: h[cm], A[L/cm], q[L/s], k[L/(s sqrt(cm))], time[s].
   Conserves liquid volume through bounded explicit-Euler substeps.
*/
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TankPhysics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SAMPLE_PERIODS = Object.freeze([0.05, 0.1, 0.2, 0.5, 1]);
  const DEFAULTS = Object.freeze({ A1: 1.4, A2: 1.6, k12: 0.65, k2: 0.43, qmax: 3.2, hmax: 60, dt: 0.2 });
  const MODES = Object.freeze(['setpoint','switch','track','leak']);
  const DURATION = 260;
  function clamp(v, low, high) { return Math.min(high, Math.max(low, v)); }
  function numberOr(value, fallback) {
    return value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? fallback : Number(value);
  }
  function sanitizeConfig(raw) {
    const p = raw || {};
    const chosenDt = numberOr(p.dt, DEFAULTS.dt);
    return {
      A1: clamp(numberOr(p.A1,DEFAULTS.A1), 0.5, 5),
      A2: clamp(numberOr(p.A2,DEFAULTS.A2), 0.5, 5),
      k12: clamp(numberOr(p.k12,DEFAULTS.k12), 0.1, 1.5),
      k2: clamp(numberOr(p.k2,DEFAULTS.k2), 0.1, 1.5),
      qmax: clamp(numberOr(p.qmax,DEFAULTS.qmax), 0.5, 6),
      hmax: 60,
      dt: SAMPLE_PERIODS.includes(chosenDt) ? chosenDt : DEFAULTS.dt
    };
  }
  function targetAt(t, mode, manual) {
    if (mode === 'switch') return t < 105 - 1e-9 ? 20 : 32;
    if (mode === 'track') return t < 35 ? 18 : t >= 180 ? 29 : 18 + (29-18)*(t-35)/(180-35);
    if (mode === 'leak') return 26;
    return Number.isFinite(manual) ? clamp(manual, 5, 45) : 26;
  }
  function disturbanceAt(t, mode) { return mode === 'leak' && t >= 115 - 1e-9 ? 0.45 : 0; }
  function createPlant(raw, scenario, manualTarget) {
    const params = sanitizeConfig(raw);
    const mode = MODES.includes(scenario) ? scenario : 'setpoint';
    return {params, mode, manualTarget: Number.isFinite(manualTarget) ? manualTarget : null,
      stepCount:0,
      state:{t:0,h1:10,h2:8,u:0,qpump:0,q12:0,qout:0,qleak:0,
        overflow1:0,overflow2:0}};
  }
  function ratesAt(h1,h2,u,leak,p) {
    return { qpump: p.qmax*u/100, q12:p.k12*Math.sqrt(Math.max(0,h1)),
      qout:p.k2*Math.sqrt(Math.max(0,h2)), qleak: leak };
  }
  function step(plant, command) {
    if (typeof command !== 'number' || !Number.isFinite(command)) throw new Error('controller() must return a finite numeric pump command, 0–100 (%).');
    const p = plant.params, s = plant.state;
    const u = clamp(command,0,100), leak = disturbanceAt(s.t,plant.mode);
    let v1 = s.h1*p.A1, v2 = s.h2*p.A2;
    const n = Math.max(1,Math.ceil(p.dt/0.05));
    const h = p.dt/n;
    let total12=0,totalOut=0,totalPump=0,totalLeak=0,spill1=0,spill2=0;
    for(let j=0;j<n;j++) {
      const q = ratesAt(v1/p.A1,v2/p.A2,u,leak,p);
      const vin = q.qpump*h;
      const v12 = Math.min(q.q12*h,v1+vin);
      const voutBase = Math.min(q.qout*h,v2+v12);
      const vLeak = Math.min(q.qleak*h,Math.max(0,v2+v12-voutBase));
      v1 += vin-v12;
      v2 += v12-voutBase-vLeak;
      const overflowVolume1 = Math.max(0,v1-p.hmax*p.A1);
      const overflowVolume2 = Math.max(0,v2-p.hmax*p.A2);
      v1 -= overflowVolume1; v2 -= overflowVolume2;
      v1 = Math.max(0,v1);v2 = Math.max(0,v2);
      totalPump += vin; total12 += v12; totalOut += voutBase;
      totalLeak += vLeak; spill1 += overflowVolume1; spill2 += overflowVolume2;
    }
    plant.stepCount++;
    plant.state = {
      t:Math.round(plant.stepCount*p.dt*1e9)/1e9,
      h1:v1/p.A1, h2:v2/p.A2, u,
      qpump:totalPump/p.dt, q12:total12/p.dt,qout:totalOut/p.dt,
      qleak:totalLeak/p.dt,overflow1:spill1/p.dt, overflow2:spill2/p.dt
    };
    return sample(plant);
  }
  function sample(plant) {
    const p=plant.params,s=plant.state, target=targetAt(s.t,plant.mode,plant.manualTarget);
    return {scenario:plant.mode,t:s.t,h1:s.h1,h2:s.h2,target,
      u:s.u,qpump:s.qpump,q12:s.q12,qout:s.qout,qleak:s.qleak,
      overflow1:s.overflow1,overflow2:s.overflow2,error:target-s.h2,
      A1:p.A1,A2:p.A2,k12:p.k12,k2:p.k2,qmax:p.qmax,hmax:p.hmax,dt:p.dt};
  }
  return {DEFAULTS,MODES,SAMPLE_PERIODS,DURATION,clamp,sanitizeConfig,
    targetAt,disturbanceAt,createPlant,ratesAt,step,sample};
});
