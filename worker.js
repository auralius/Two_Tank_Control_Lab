'use strict';
importScripts('./physics.js');
const P = self.TankPhysics;
let params=P.sanitizeConfig(P.DEFAULTS), scenario='setpoint', manualTarget=null;
let plant=P.createPlant(params,scenario,null);
let source='', runtime=null, memory={}, timer=null, speed=8, budget=0;
function stop() { if(timer!==null) clearInterval(timer);timer=null; }
function fail(err) {stop();self.postMessage({kind:'error',message:String(err && err.message || err)});}
function readonlyContext(plant) {
  const r=P.sample(plant);
  return Object.freeze({t:r.t,h1:r.h1,h2:r.h2,u:r.u,qpump:r.qpump,q12:r.q12,
    qout:r.qout,qleak:r.qleak,overflow1:r.overflow1,overflow2:r.overflow2,
    error:r.error,target:Object.freeze({h2:r.target})});
}
function compile(source) {
  const factory=new Function('"use strict";\nlet state, params, memory;\n'+source+'\n'+
    'if (typeof controller !== "function") throw new Error("Please define function controller().");\n'+
    'const studentInit=typeof init === "function" ? init : null;\n'+
    'function bind(s,p,m){state=s;params=p;memory=m;}\n'+
    'return {initialize(s,p,m){bind(s,p,m);if(studentInit) studentInit(s,p,m);},\n'+
    'invoke(s,p,m){bind(s,p,m);return controller(s,p,m);}};');
  return factory();
}
function makeRuntime(p) {
  const r=compile(source),m={};
  r.initialize(readonlyContext(p),Object.freeze({...p.params}),m);
  return {r,m};
}
function reset() {
  stop();budget=0;
  plant=P.createPlant(params,scenario,manualTarget);
  runtime=null;memory={};
  const fresh=makeRuntime(plant);
  runtime=fresh.r;memory=fresh.m;
  self.postMessage({kind:'frames',reason:'reset',rows:[P.sample(plant)]});
}
function getCommand(result) {
  const value=typeof result==='object' && result!==null ? result.pump : result;
  if(typeof value!=='number' || !Number.isFinite(value))
    throw new Error('controller() must return a finite number (0–100 pump %), or { pump: number }.');
  return value;
}
function oneStep(p,r,m) {
  const u=getCommand(r.invoke(readonlyContext(p),Object.freeze({...p.params}),m));
  return P.step(p,u);
}
function simulate(count) {
  const rows=[];
  for(let i=0;i<count && plant.state.t<P.DURATION-1e-8;i++)rows.push(oneStep(plant,runtime,memory));
  if(rows.length)self.postMessage({kind:'frames',rows});
  if(plant.state.t>=P.DURATION-1e-8){stop();self.postMessage({kind:'done'});}
}
function tick() {
  try {
    budget+=.04*speed;
    let steps=0;
    while(timer!==null && budget+1e-9>=params.dt && steps<200){budget-=params.dt;steps++;}
    if(steps)simulate(steps);
  } catch(e) {fail(e);}
}
function testCase(mode){
  const p=P.createPlant(params,mode,null),{r,m}=makeRuntime(p),n=Math.round(P.DURATION/params.dt);
  let total=0,count=0,terminal=0,lastCount=0;
  for(let i=0;i<n;i++) {
    const row=oneStep(p,r,m);
    if(row.t>=130-1e-9){total+=row.error*row.error;count++;}
    if(row.t>=P.DURATION-25-1e-9){terminal+=Math.abs(row.error);lastCount++;}
  }
  const rms=Math.sqrt(total/Math.max(1,count)),finalMean=terminal/Math.max(1,lastCount);
  const rule= mode==='track' ? {metric:'RMS error (130–260 s)',value:rms,threshold:4.5}
    :{metric:'Mean absolute error (last 25 s)',value:finalMean,
      threshold:mode==='leak'?2.5:mode==='switch'?2.5:2};
  return {mode,passed:rule.value<rule.threshold,...rule,finalMean,rms,finalError:Math.abs(P.sample(p).error)};
}
self.onmessage=event=>{
  const msg=event.data||{};
  try{
    switch(msg.kind){
      case 'load':
        source=String(msg.source||'');scenario=P.MODES.includes(msg.scenario)?msg.scenario:'setpoint';
        params=P.sanitizeConfig(msg.params);
        manualTarget=Number.isFinite(Number(msg.setpoint))?P.clamp(Number(msg.setpoint),5,45):null;
        speed=P.clamp(Number(msg.speed)||8,1,60);
        reset();self.postMessage({kind:'ready'});break;
      case 'reset':reset();self.postMessage({kind:'ready'});break;
      case 'start':
        if(!runtime)throw new Error('Apply your controller first.');
        if(plant.state.t>=P.DURATION-1e-8)reset();
        stop();timer=setInterval(tick,40);self.postMessage({kind:'running'});break;
      case 'pause':stop();self.postMessage({kind:'paused'});break;
      case 'step':
        if(!runtime)throw new Error('Apply your controller first.');
        stop();budget=0;simulate(1);break;
      case 'finish':
        if(!runtime)throw new Error('Apply your controller first.');
        stop();budget=0;simulate(Math.round(P.DURATION/params.dt)+1);break;
      case 'speed':speed=P.clamp(Number(msg.speed)||8,1,60);break;
      case 'target':
        if(scenario==='setpoint'){
          manualTarget=P.clamp(Number(msg.target)||26,5,45);plant.manualTarget=manualTarget;
          self.postMessage({kind:'frames',reason:'target',rows:[P.sample(plant)]});
        }break;
      case 'test':
        stop();self.postMessage({kind:'test-start'});
        const results=P.MODES.map(testCase);
        self.postMessage({kind:'test-results',results});break;
      default:throw new Error('Unknown message: '+msg.kind);
    }
  }catch(e){fail(e);}
};
