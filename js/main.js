import {DEFS, BASELINE, clamp, encode, decode, solve} from './physics.js';
import {Planner, gauss} from './planner.js';
import {S} from './state.js';
import {OPT} from './optimal.js';
import {renderer, camera, renderScene} from './scene.js';
import {$, PRESETS, buildSliders, syncSliders, evaluateShown, updateButtons, updateTelemetry, drawChart, drawOutline, renderLog, renderBest} from './ui.js';

/* ===================== AI SEARCH RUNS ===================== */
const MAX_TESTS=80, TEST_DUR=1.5;

function measure(res){return res.score*(S.noise?1+gauss()*0.03:1);}

/* runs */
function startTest(){
  const plan=Planner.pick(S.mode,S.hist);
  if(S.mode==='prop'&&!S.tuneAngles){const cur=encode('prop',S.target);DEFS.prop.forEach((d,i)=>{if(d.group==='angles')plan.u[i]=cur[i];});}
  const g=decode(S.mode,plan.u);const res=solve(S.mode,g,S.budget);
  S.test={plan,u:plan.u,g,res,meas:measure(res),t:0};
  S.target={...g};S.src='AI test '+(S.hist.length+1);syncSliders();
  $('#plan-line').textContent=plan.why;
}
function finishTest(){
  const t=S.test;S.test=null;
  const entry={u:t.u,g:t.g,res:t.res,meas:t.meas,pred:t.plan.pred?t.plan.pred.mean:null,kind:t.plan.kind,idx:S.hist.length+1,why:t.plan.why};
  S.hist.push(entry);
  const isBest=!S.best||entry.meas>S.best.meas;if(isBest)S.best=entry;
  let resTxt=`Measured ${entry.meas.toFixed(2)} g/W`;
  if(entry.pred!=null){const diff=entry.meas-entry.pred;resTxt+=Math.abs(diff)<0.15*Math.abs(entry.pred)+0.1?' · close to prediction':(diff>0?' · beat prediction':' · below prediction, model updated');}
  if(!entry.res.lifts)resTxt='Too weak to lift the head off its stop · scored low';
  if(isBest&&S.hist.length>1)resTxt+=' · new best';
  S.log.unshift({idx:entry.idx,why:entry.why,res:resTxt,best:isBest&&S.hist.length>1});S.log=S.log.slice(0,9);
  renderLog();renderBest();drawChart();
  if(S.hist.length>=S.maxTests){S.run='done';S.target={...S.best.g};S.src='best';evaluateShown();syncSliders();
    $('#plan-line').textContent=`Search finished after ${S.hist.length} tests. Best: ${S.best.meas.toFixed(2)} g/W (test ${S.best.idx}).`;updateButtons();}
}
function stepEvolution(dt){
  if(S.run!=='running')return;
  if(S.speed==='fast'){
    S.acc+=dt;if(S.acc<0.09)return;S.acc=0;
    if(S.test){S.test.t=1;finishTest();}
    if(S.run!=='running')return;
    startTest();S.live.prev=S.live.res;S.live.res=S.test.res;S.live.k=1;finishTest();
    if(S.run==='running'&&S.best){S.target={...S.best.g};S.live.res=S.best.res;}
    return;
  }
  if(!S.test){startTest();}
  const t=S.test;t.t+=dt/TEST_DUR;
  if(t.t<0.3){S.live.k=Math.max(0,S.live.k-dt*2.6);}
  else{if(S.live.res!==t.res){S.live.prev=S.live.res;S.live.res=t.res;}S.live.k=Math.min(1,(t.t-0.3)/0.5);}
  if(t.t>=1)finishTest();
}
function resetSearch(){
  S.maxTests=MAX_TESTS;S.hist=[];S.best=null;S.test=null;S.log=[];S.run='idle';S.target={...BASELINE[S.mode]};S.src='baseline';
  evaluateShown();syncSliders();renderLog();renderBest();drawChart();updateButtons();$('#plan-line').textContent='';
}

/* ===================== LOOP ===================== */
let last=performance.now(),uiAcc=0;
function frame(now){
  const dt=clamp((now-last)/1000,0,.05);last=now;
  stepEvolution(dt);
  renderScene(dt,now);
  uiAcc+=dt;if(uiAcc>.1){uiAcc=0;updateTelemetry();}
  requestAnimationFrame(frame);
}

/* ===================== EVENTS ===================== */
function setMode(m){
  if(m===S.mode)return;S.mode=m;
  $('#mode-prop').setAttribute('aria-pressed',m==='prop');$('#mode-cyclo').setAttribute('aria-pressed',m==='cyclo');
  S.target={...BASELINE[m]};buildSliders();resetSearch();
}
$('#mode-prop').onclick=()=>setMode('prop');$('#mode-cyclo').onclick=()=>setMode('cyclo');
$('#btn-run').onclick=()=>{
  if(S.run==='running'){S.run='paused';}
  else if(S.run==='done'){S.maxTests+=20;S.run='running';}
  else{S.run='running';}
  updateButtons();syncSliders();
};
$('#btn-reset').onclick=resetSearch;
$('#speed').onchange=e=>{S.speed=e.target.value;};
$('#noise').onchange=e=>{S.noise=e.target.checked;};
$('#budget').oninput=e=>{S.budget=+e.target.value;$('#budget-out').textContent=S.budget+' W';e.target.style.setProperty('--p',((S.budget-10)/50*100)+'%');
  if(S.hist.length){resetSearch();$('#plan-line').textContent='Power budget changed, so earlier results no longer compare. Search reset.';}else evaluateShown();};
$('#btn-load-best').onclick=()=>{if(!S.best)return;if(S.run==='running')S.run='paused';S.test=null;S.target={...S.best.g};S.src='best';S.live.prev=S.live.res;S.live.res=S.best.res;S.live.k=1;syncSliders();updateButtons();};

$('#tune-angles').onchange=e=>{S.tuneAngles=e.target.checked;};
$('#btn-level').onclick=()=>{if(S.run==='running'){S.run='paused';S.test=null;}S.target={...S.target,a1:0,a2:0,a3:0,a4:0,a5:0,c1:0,c2:0,c3:0,c4:0,c5:0};S.src='manual';evaluateShown();syncSliders();updateButtons();};
document.querySelectorAll('.presets button').forEach(b=>b.onclick=()=>{if(S.run==='running'){S.run='paused';S.test=null;}S.target={...S.target,...PRESETS[b.dataset.p]};S.src='manual';evaluateShown();syncSliders();updateButtons();});
$('#btn-optimal').onclick=()=>$('#btn-load-opt').onclick();
$('#btn-load-opt').onclick=()=>{if(S.run==='running')S.run='paused';S.test=null;const bk=S.budget<23?'b15':S.budget<38?'b30':'b45';S.target={...BASELINE[S.mode],...OPT[S.mode][bk]};S.src='computed optimum';evaluateShown();syncSliders();updateButtons();
  $('#plan-line').textContent=`Computed optimum for ${S.mode==='prop'?'the propeller':'the cyclorotor'} at 30 W, from an exhaustive search at ${bk.slice(1)} W.`;};
const stage=$('#stage');
function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();drawChart();drawOutline();}
new ResizeObserver(resize).observe(stage);
$('#budget').style.setProperty('--p','40%');

buildSliders();evaluateShown();renderLog();renderBest();resize();drawChart();updateButtons();
requestAnimationFrame(frame);
// open calmly on the optimal design; the AI search only runs when asked
$('#btn-load-opt').onclick();S.run='idle';updateButtons();
