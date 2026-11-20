'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const P=require('../physics.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name);}
function near(a,b,tol=1e-8){assert.ok(Math.abs(a-b)<=tol,`expected ${a} to be near ${b}`);}
function worker(){
  const messages=[];
  let currentInterval=0;
  const sandbox={console, Math,Number,Error,Date,
    setInterval:()=>++currentInterval,clearInterval:()=>{},
    self:{postMessage:m=>messages.push(m)},
    importScripts:()=>{sandbox.self.TankPhysics=P;}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../worker.js'),'utf8'),sandbox,{filename:'worker.js'});
  const send=(kind,other={})=>sandbox.self.onmessage({data:{kind,...other}});
  const clear=()=>messages.splice(0,messages.length);
  return {send,messages,clear};
}
test('default parameters',()=>{assert.equal(P.DEFAULTS.dt,.2);assert.equal(P.DEFAULTS.A1,1.4);assert.equal(P.DEFAULTS.k12,.65);});
test('sample periods',()=>assert.equal(P.SAMPLE_PERIODS.length,5));
test('bad sampling period falls back to default',()=>assert.equal(P.sanitizeConfig({dt:.3}).dt,.2));
test('parameter bounds',()=>{const p=P.sanitizeConfig({A1:-5,A2:100,k12:0,qmax:25});near(p.A1,.5);near(p.A2,5);near(p.k12,.1);near(p.qmax,6);});
test('initial tank levels',()=>{const r=P.sample(P.createPlant(P.DEFAULTS,'setpoint',26));near(r.h1,10);near(r.h2,8);near(r.target,26);});
test('zero initial input drains both tanks',()=>{const p=P.createPlant(P.DEFAULTS,'setpoint',26),old=P.sample(p);P.step(p,0);const r=P.sample(p);assert.ok(r.h1<old.h1);assert.ok(r.h2>old.h2);});
test('flow law',()=>near(P.ratesAt(4,9,100,0,P.DEFAULTS).q12,1.3));
test('pump is saturated high',()=>near(P.step(P.createPlant(P.DEFAULTS),1000).u,100));
test('pump is saturated low',()=>near(P.step(P.createPlant(P.DEFAULTS),-5).u,0));
test('finite command required',()=>assert.throws(()=>P.step(P.createPlant(P.DEFAULTS),NaN),/finite/));
test('exact sampling clock',()=>{const p=P.createPlant({...P.DEFAULTS,dt:.05});for(let i=0;i<100;i++)P.step(p,50);near(p.state.t,5,1e-9);});
test('mass conservation without leaks',()=>{
  const p=P.createPlant(P.DEFAULTS,'setpoint',26),initial=p.state.h1*p.params.A1+p.state.h2*p.params.A2;
  const r=P.step(p,75);const final=r.h1*r.A1+r.h2*r.A2;
  near(final,initial+r.qpump*r.dt-r.qout*r.dt-r.qleak*r.dt-r.overflow1*r.dt-r.overflow2*r.dt,1e-7);
});
test('extra leak starts at 115s',()=>near(P.disturbanceAt(115,'leak'),.45));
test('leak absent before 115s',()=>near(P.disturbanceAt(114.9,'leak'),0));
test('setpoint switch',()=>{near(P.targetAt(104.99,'switch'),20);near(P.targetAt(105,'switch'),32);});
test('target ramp',()=>{near(P.targetAt(35,'track'),18);near(P.targetAt(180,'track'),29);});
test('tank capacity prevents overflow',()=>{
  const p=P.createPlant({...P.DEFAULTS,qmax:6,k12:.1,k2:.1});
  for(let i=0;i<1000;i++)P.step(p,100);
  assert.ok(p.state.h1<=60+1e-7);assert.ok(p.state.h2<=60+1e-7);
});
test('dry tanks remain nonnegative',()=>{const p=P.createPlant(P.DEFAULTS);for(let i=0;i<5000;i++)P.step(p,0);assert.ok(p.state.h1>=0&&p.state.h2>=0);});
test('pump accelerates the upper level compared with no pump',()=>{
  const a=P.createPlant(P.DEFAULTS),b=P.createPlant(P.DEFAULTS);
  for(let i=0;i<100;i++){P.step(a,100);P.step(b,0);}assert.ok(a.state.h1>b.state.h1);
});
test('worker starts with zero pump and initializes memory',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.calls=0;} function controller(){memory.calls++;return 0;}',params:P.DEFAULTS});
  assert.equal(w.messages.at(-1).kind,'ready');w.clear();w.send('step');assert.equal(w.messages.at(-1).rows[0].u,0);
});
test('helpers read global state, params and memory',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.factor=2;} function f(){return params.dt*memory.factor+state.h1;} function controller(){return f();}',params:P.DEFAULTS});
  w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,10.4);
});
test('legacy positional controller arguments supported',()=>{
  const w=worker();w.send('load',{source:'function controller(state,params,memory){return state.h1+params.dt;}',params:P.DEFAULTS});w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,10.2);
});
test('memory persists between steps without repeated init',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.calls=0;} function controller(){memory.calls++;return memory.calls;}',params:P.DEFAULTS});w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,1);w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,2);
});
test('pause does not reset memory',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.calls=0;} function controller(){return ++memory.calls;}',params:P.DEFAULTS});w.clear();w.send('step');w.send('pause');w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,2);
});
test('reset calls init again',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.calls=0;} function controller(){return ++memory.calls;}',params:P.DEFAULTS});w.send('step');w.send('reset');w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,1);
});
test('arrays in memory persist',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.history=[];} function controller(){memory.history.push(state.t);return memory.history.length;}',params:P.DEFAULTS});w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,1);w.clear();w.send('step');near(w.messages.at(-1).rows[0].u,2);
});
test('state frozen against mutation',()=>{
  const w=worker();w.send('load',{source:'function controller(){state.h2=999;return 0;}',params:P.DEFAULTS});w.clear();w.send('step');assert.equal(w.messages.at(-1).kind,'error');
});
test('param object frozen',()=>{
  const w=worker();w.send('load',{source:'function controller(){params.A1=999;return 0;}',params:P.DEFAULTS});w.clear();w.send('step');assert.equal(w.messages.at(-1).kind,'error');
});
test('invalid controller output rejected',()=>{
  const w=worker();w.send('load',{source:'function controller(){return {fx:12};}',params:P.DEFAULTS});w.clear();w.send('step');assert.equal(w.messages.at(-1).kind,'error');
});
test('optional init',()=>{
  const w=worker();w.send('load',{source:'function controller(){return 3;}',params:P.DEFAULTS});assert.equal(w.messages.at(-1).kind,'ready');
});
test('scenario-specific fresh init for each test',()=>{
  const w=worker();w.send('load',{source:'function init(){memory.acc=0;} function controller(){memory.acc++;return 50;}',params:P.DEFAULTS});w.clear();w.send('test');
  const results=w.messages.at(-1);assert.equal(results.kind,'test-results');assert.equal(results.results.length,4);
  assert.ok(results.results.every(x=>Number.isFinite(x.value)));
});
test('finish simulation reaches 260 seconds',()=>{
  const w=worker();w.send('load',{source:'function controller(){return 50;}',params:P.DEFAULTS});w.clear();w.send('finish');
  const frames=w.messages.find(x=>x.kind==='frames');near(frames.rows.at(-1).t,260);assert.equal(w.messages.at(-1).kind,'done');
});
console.log(`${checks} checks passed.`);
