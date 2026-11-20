/* TwoTankLab UI. Physical simulation and user controller run in a Web Worker. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const storageKey='twotanklab.student.controller.v1_0';
  const starterCode=`// Standard function: called ONCE on every fresh experiment.
function init() {
  memory.integral = 0;
  memory.history = [];
}

// Custom helper functions are allowed here.
// state, params and memory are available in ALL functions.

// Standard function: automatically called every params.dt seconds.
function controller() {
  const error = state.target.h2 - state.h2;

  // TODO: Develop your pump controller.
  // Pump command: 0 to 100 percent.
  const pump = 0;

  return pump;
}`;
  let worker=null,history=[],latest=null,dirty=false,running=false;
  let pendingAction=null,lastResponse=0,loadTimer=null,watchTimer=null,drawRequested=false;
  function fmt(v,n=1){return Number.isFinite(v)?v.toFixed(n):'—';}
  function escapeHTML(v){return String(v).replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
  function setStatus(s,kind=''){
    const el=$('statusLabel');el.className='status'+(kind?' '+kind:'');
    el.innerHTML='<i></i> '+escapeHTML(s);
  }
  function msg(text,kind=''){
    $('message').textContent=text;$('message').className='editor-message'+(kind?' '+kind:'');
  }
  function config(){return {A1:+$('a1Input').value,A2:+$('a2Input').value,
    k12:+$('k12Input').value,k2:+$('k2Input').value,
    qmax:+$('qmaxInput').value,dt:+$('dtSelect').value};}
  function scenario(){return $('scenarioSelect').value;}
  function resizeGutter(){const e=$('codeEditor');$('lineNumbers').textContent=Array.from({length:e.value.split('\n').length},(_,i)=>i+1).join('\n');$('lineNumbers').scrollTop=e.scrollTop;}
  function saveEditor(){try{localStorage.setItem(storageKey,$('codeEditor').value);}catch(_){}}
  function setDirty(){dirty=true;saveEditor();resizeGutter();msg('Editor changed. Select Apply & reset to compile the new controller.');}
  function loadEditor(){try{$('codeEditor').value=localStorage.getItem(storageKey)||starterCode;}catch(_){$('codeEditor').value=starterCode;}resizeGutter();}
  function refreshFields(){
    const p=config();$('setpointInput').disabled=scenario()!=='setpoint';
    $('stepLabel').textContent=fmt(p.dt,2)+' s';$('apiDt').textContent=fmt(p.dt,2)+' s';
    $('configNote').textContent=`Tₛ = ${fmt(p.dt,2)} s · qₘₐₓ = ${fmt(p.qmax,1)} L/s · 260 s simulation`;
  }
  function parseURL(){
    const q=new URLSearchParams(location.search);
    if(q.has('task')&&['setpoint','switch','track','leak'].includes(q.get('task')))$('scenarioSelect').value=q.get('task');
    const fields={A1:'a1Input',A2:'a2Input',k12:'k12Input',k2:'k2Input',qmax:'qmaxInput',setpoint:'setpointInput'};
    for(const [key,id] of Object.entries(fields))if(q.has(key))$(id).value=q.get(key);
    if(q.has('dt')&&['0.05','0.1','0.2','0.5','1'].includes(q.get('dt')))$('dtSelect').value=q.get('dt');
    refreshFields();
  }
  function send(kind,payload={}){if(worker)worker.postMessage({kind,...payload});}
  function killWorker(){
    if(loadTimer!==null)clearTimeout(loadTimer);loadTimer=null;
    if(watchTimer!==null)clearInterval(watchTimer);watchTimer=null;
    if(worker)worker.terminate();worker=null;running=false;
  }
  function openWorker(nextAction=null){
    pendingAction=nextAction;
    if(location.protocol==='file:'){
      setStatus('Local server needed','error');
      msg('Open a terminal in the extracted folder: python3 -m http.server 8000. Then visit http://localhost:8000/ (not file://).','error');return;
    }
    killWorker();
    try{worker=new Worker('./worker.js?v=1.0.0');}
    catch(e){setStatus('Worker unavailable','error');msg('Cannot create a Web Worker: '+e.message,'error');return;}
    const thisWorker=worker;setStatus('Loading…');lastResponse=performance.now();
    worker.onmessage=e=>{
      if(thisWorker!==worker)return;
      lastResponse=performance.now();
      const d=e.data||{};
      if(d.kind==='frames'){
        if(d.reason==='reset'){
          history=[];$('testResults').innerHTML='<div class="empty-tests">No tests yet. Run the four challenges to evaluate your controller.</div>';
        }
        for(const row of d.rows||[]){
          if(d.reason==='target'&&history.length&&Math.abs(history[history.length-1].t-row.t)<1e-8)history[history.length-1]=row;
          else history.push(row);
          latest=row;
        }
        refreshNumbers();requestDraw();
      }else if(d.kind==='ready'){
        if(loadTimer!==null)clearTimeout(loadTimer);loadTimer=null;
        dirty=false;running=false;setStatus('Ready');msg('Controller compiled. init() called once. Run, Step, or test your controller.','success');
        if(pendingAction){const x=pendingAction;pendingAction=null;send(x);}
      }else if(d.kind==='running'){running=true;setStatus('Simulating','running');}
      else if(d.kind==='paused'){running=false;setStatus('Paused');}
      else if(d.kind==='done'){running=false;setStatus('Completed');msg('Simulation finished. Export the CSV for analysis.','success');}
      else if(d.kind==='test-start'){running=false;setStatus('Testing','running');$('testResults').innerHTML='<div class="empty-tests">Evaluating four independent nonlinear control challenges…</div>';}
      else if(d.kind==='test-results'){setStatus('Ready');renderTests(d.results||[]);}
      else if(d.kind==='error'){running=false;pendingAction=null;setStatus('Controller error','error');msg(d.message||'Unknown error','error');}
    };
    worker.onerror=e=>{setStatus('Worker error','error');msg('worker.js or physics.js could not load. Serve this folder over HTTP. '+(e.message||''),'error');};
    worker.onmessageerror=()=>{setStatus('Worker error','error');msg('Worker sent unreadable data.','error');};
    worker.postMessage({kind:'load',source:$('codeEditor').value,scenario:scenario(),params:config(),
      setpoint:+$('setpointInput').value,speed:+$('speedSelect').value});
    loadTimer=setTimeout(()=>{
      if(thisWorker!==worker)return;
      if(performance.now()-lastResponse>7900){setStatus('Controller unresponsive','error');msg('No reply from controller. Check for an infinite loop, then press Apply & reset.','error');killWorker();}
    },8000);
    // Keep checking after startup, including single-step and fast tests.
    watchTimer=setInterval(()=>{
      if(thisWorker!==worker)return;
      if((running||$('statusLabel').textContent.includes('Testing'))&&performance.now()-lastResponse>9000){
        setStatus('Controller unresponsive','error');msg('The controller may contain a blocking loop. Revise it and press Apply & reset.','error');killWorker();
      }
    },1500);
  }
  function run(kind){if(!worker||dirty)openWorker(kind);else send(kind);}
  function refreshNumbers(){
    if(!latest)return;
    const r=latest;
    $('readH1').textContent=fmt(r.h1);$('readH2').textContent=fmt(r.h2);
    $('readTarget').textContent=fmt(r.target);$('readPump').textContent=fmt(r.u);
    $('level1').textContent=fmt(r.h1);$('level2').textContent=fmt(r.h2);
    $('water1').style.height=Math.min(100,Math.max(0,100*r.h1/r.hmax))+'%';
    $('water2').style.height=Math.min(100,Math.max(0,100*r.h2/r.hmax))+'%';
    $('targetLine').style.bottom=Math.min(100,Math.max(0,100*r.target/r.hmax))+'%';
    $('readTransfer').textContent=fmt(r.q12,2)+' L/s';$('readOutlet').textContent=fmt(r.qout,2)+' L/s';$('readLeak').textContent=fmt(r.qleak,2)+' L/s';
    $('flowPump').textContent='PUMP '+fmt(r.qpump,2)+' L/s';$('flowBetween').textContent='TRANSFER '+fmt(r.q12,2)+' L/s';$('flowOut').textContent='OUTLET '+fmt(r.qout,2)+' L/s';
    $('stageTime').textContent='t = '+fmt(r.t,1)+' s';$('durationLabel').textContent=fmt(r.t,1)+' / 260 s';
    $('progressFill').style.width=Math.min(100,100*r.t/260)+'%';
    let squares=0,n=0;
    for(const item of history)if(item.t>=50){squares+=item.error*item.error;n++;}
    $('rmsLabel').textContent=n?fmt(Math.sqrt(squares/n),2)+' cm':'—';
  }
  function canvasSize(canvas,ctx){
    const rect=canvas.getBoundingClientRect();
    const w=Math.max(1,Math.floor(rect.width)),h=Math.max(1,Math.floor(rect.height));
    const dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);return {w,h};
  }
  function drawPlot(canvas,type){
    const ctx=canvas.getContext('2d');const {w,h}=canvasSize(canvas,ctx);
    ctx.clearRect(0,0,w,h);const left=42,right=w-12,top=12,bottom=h-26;
    const minY=0,maxY=type==='levels'?60:100;
    const xp=t=>left+t/260*(right-left),yp=y=>bottom-(y-minY)/(maxY-minY)*(bottom-top);
    ctx.font='10px system-ui,sans-serif';ctx.textBaseline='middle';ctx.strokeStyle='#e5edf0';ctx.fillStyle='#96a5ae';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const val=minY+(maxY-minY)*i/4,y=yp(val);
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(fmt(val,0),left-7,y);
    }
    for(let i=0;i<=4;i++){
      const t=260*i/4,x=xp(t);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
      ctx.textAlign='center';ctx.fillText(fmt(t,0),x,bottom+15);
    }
    if(!history.length)return;
    function trace(get,color,dashed){
      ctx.save();ctx.beginPath();ctx.lineWidth=2;ctx.strokeStyle=color;ctx.setLineDash(dashed?[6,4]:[]);
      const stride=Math.max(1,Math.ceil(history.length/3500));
      for(let i=0;i<history.length;i+=stride){const r=history[i];const x=xp(r.t),y=yp(get(r));if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      const r=history[history.length-1];ctx.lineTo(xp(r.t),yp(get(r)));ctx.stroke();ctx.restore();
    }
    if(type==='levels'){
      trace(r=>r.h1,'#5595c2',false);trace(r=>r.target,'#21a0a1',true);trace(r=>r.h2,'#e97943',false);
    }else{
      // Pump is percentage on 0-100 y-axis; flows share the same canvas with a 0-6 L/s scale.
      trace(r=>r.qout/6*100,'#5595c2',false);
      trace(r=>r.q12/6*100,'#21a0a1',false);
      trace(r=>r.u,'#e97943',false);
    }
  }
  function requestDraw(){if(drawRequested)return;drawRequested=true;requestAnimationFrame(()=>{
    drawRequested=false;drawPlot($('levelChart'),'levels');drawPlot($('flowChart'),'flows');
  });}
  const names={setpoint:'Fixed setpoint',switch:'Setpoint change',track:'Moving target',leak:'Extra-leak rejection'};
  function renderTests(items){
    $('testResults').innerHTML=items.map(r=>`<div class="test-card ${r.passed?'pass':'fail'}"><span class="tag">${r.passed?'PASS':'TRY AGAIN'}</span><h4>${escapeHTML(names[r.mode]||r.mode)}</h4><div class="result">${fmt(r.value,2)} cm</div><div class="rule">${escapeHTML(r.metric)}<br>Target: &lt; ${fmt(r.threshold,1)} cm</div></div>`).join('');
  }
  function download(name,text,mime){
    const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function csvExport(){
    if(history.length<=1){msg('No simulation data yet. Run or Step first.','error');return;}
    const fields=['scenario','t_s','h1_cm','h2_cm','target_h2_cm','pump_command_pct','pump_flow_Lps','transfer_flow_Lps','outlet_flow_Lps','leak_flow_Lps','overflow1_Lps','overflow2_Lps','error_h2_cm','A1_L_per_cm','A2_L_per_cm','k12_Lps_per_sqrt_cm','k2_Lps_per_sqrt_cm','qmax_Lps','hmax_cm','dt_s'];
    const keys=['scenario','t','h1','h2','target','u','qpump','q12','qout','qleak','overflow1','overflow2','error','A1','A2','k12','k2','qmax','hmax','dt'];
    const csv=fields.join(',')+'\r\n'+history.map(row=>keys.map(k=>k==='scenario'?row[k]:Number(row[k]).toFixed(k==='t'?4:6)).join(',')).join('\r\n')+'\r\n';
    download('two_tank_'+scenario()+'.csv',csv,'text/csv;charset=utf-8');
    msg('Exported '+history.length+' CSV rows with physical parameters.','success');
  }
  function share(){
    const url=new URL(location.href);url.search='';
    const p=config(),data={task:scenario(),...p,setpoint:+$('setpointInput').value};
    for(const [k,v] of Object.entries(data))url.searchParams.set(k,v);
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(url.toString()).then(()=>msg('Experiment link copied.','success')).catch(()=>prompt('Copy setup link',url.toString()));
    else prompt('Copy setup link',url.toString());
  }
  function reset(){refreshFields();openWorker();}
  function events(){
    $('codeEditor').addEventListener('input',setDirty);
    $('codeEditor').addEventListener('scroll',()=>{$('lineNumbers').scrollTop=$('codeEditor').scrollTop;});
    $('codeEditor').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const el=e.target;el.setRangeText('  ',el.selectionStart,el.selectionEnd,'end');setDirty();}});
    $('applyBtn').addEventListener('click',()=>openWorker());
    $('restoreBtn').addEventListener('click',()=>{
      if($('codeEditor').value!==starterCode&&!confirm('Replace your code with the original zero-pump starter?'))return;
      $('codeEditor').value=starterCode;setDirty();
    });
    $('runBtn').addEventListener('click',()=>run('start'));
    $('pauseBtn').addEventListener('click',()=>send('pause'));
    $('stepBtn').addEventListener('click',()=>run('step'));
    $('finishBtn').addEventListener('click',()=>run('finish'));
    $('resetBtn').addEventListener('click',reset);
    $('testBtn').addEventListener('click',()=>run('test'));
    $('speedSelect').addEventListener('change',()=>send('speed',{speed:+$('speedSelect').value}));
    $('saveBtn').addEventListener('click',()=>download('two_tank_controller.js',$('codeEditor').value,'text/javascript;charset=utf-8'));
    $('csvBtn').addEventListener('click',csvExport);
    $('shareBtn').addEventListener('click',share);
    for(const id of ['scenarioSelect','a1Input','a2Input','k12Input','k2Input','qmaxInput','dtSelect'])$(id).addEventListener('change',reset);
    $('setpointInput').addEventListener('change',()=>{if(scenario()==='setpoint'&&worker)send('target',{target:+$('setpointInput').value});});
    window.addEventListener('resize',requestDraw);
  }
  function main(){loadEditor();parseURL();events();requestDraw();openWorker();}
  main();
})();
