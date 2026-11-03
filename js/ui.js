import {DEFS, D2R, RIG, STATIONS, ST_T, clamp, encode, decode, extAt, tipRound, outlineName, solve} from './physics.js';
import {S} from './state.js';
import {rotor, eCur} from './scene.js';

/* ===================== UI STATE ===================== */
export const $=s=>document.querySelector(s);
const cssv=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL={cyan:cssv('--cyan'),amber:cssv('--amber'),dim:cssv('--dim'),faint:cssv('--faint'),line:cssv('--line'),line2:cssv('--line-2'),fg:cssv('--fg'),good:cssv('--good'),panel:cssv('--panel')};

/* sliders */
export function buildSliders(){
  const box=$('#sliders'),boxO=$('#sliders-outline'),boxA=$('#sliders-angles');box.innerHTML='';boxO.innerHTML='';boxA.innerHTML='';
  $('#outline-sec').hidden=S.mode!=='prop';$('#angles-sec').hidden=S.mode!=='prop';
  DEFS[S.mode].forEach(d=>{
    const w=document.createElement('div');w.className='sl';
    w.innerHTML=`<label for="p-${d.k}">${d.label}${d.hint?`<small>${d.hint}</small>`:''}</label><output id="o-${d.k}"></output><input type="range" id="p-${d.k}" min="0" max="1000" step="1">`;
    if(d.blade)w.dataset.blade=d.blade;
    (d.group==='outline'?boxO:d.group==='angles'?boxA:box).appendChild(w);
    const inp=w.querySelector('input');
    inp.addEventListener('input',()=>{
      const u=encode(S.mode,S.target);const i=DEFS[S.mode].indexOf(d);u[i]=inp.value/1000;
      S.target=decode(S.mode,u);
      if(S.run==='running'){S.run='paused';S.test=null;}
      S.src='manual';evaluateShown();syncSliders();updateButtons();
    });
  });
  syncSliders();
}
export function syncSliders(){
  const u=encode(S.mode,S.target);
  DEFS[S.mode].forEach((d,i)=>{const inp=$('#p-'+d.k);if(!inp)return;inp.value=Math.round(u[i]*1000);inp.style.setProperty('--p',(u[i]*100)+'%');$('#o-'+d.k).textContent=d.fmt(S.target[d.k]);});
  $('#genome-src').textContent=S.src;
  document.querySelectorAll('#sliders-angles .sl').forEach(w=>{w.hidden=+w.dataset.blade>S.target.n;});
  if(S.mode==='prop'&&$('#outline')){$('#outline-name').textContent=outlineName(S.target);drawOutline();}
  $('#sliders').classList.toggle('following',S.run==='running');
}
export function evaluateShown(){const r=solve(S.mode,S.target,S.budget);S.live.prev=S.live.res;S.live.res=r;S.live.k=1;}
export function updateButtons(){
  const b=$('#btn-run');
  b.textContent=S.run==='running'?'Pause':S.run==='paused'?'Resume AI search':S.run==='done'?'Run 20 more tests':'Start AI search';
  const chip=$('#state-chip');
  chip.className='chip'+(S.run==='running'?' run':S.run==='done'?' done':'');
  chip.textContent=S.run==='running'?(S.test?S.test.plan.kind:'testing'):S.run==='done'?'Search finished':S.src==='manual'?'Manual test':S.run==='paused'?'Paused':'Idle';
  $('#sliders').classList.toggle('following',S.run==='running');
}

/* ===================== TELEMETRY / CHARTS ===================== */
function fmt(v,d){return (v==null||!isFinite(v))?'—':v.toFixed(d);}
export function updateTelemetry(){
  const r=S.live.res,k=S.live.k;
  const pending=S.run==='running'&&S.speed==='watch'&&S.test&&S.test.t<.8;
  const gEl=$('#m-gpw');
  if(r){const shown=(S.test&&S.speed==='watch'&&r===S.test.res&&r.lifts)?S.test.meas:r.gpw;gEl.innerHTML=(pending?'···':fmt(shown,2))+'<small>g/W</small>';}
  gEl.classList.toggle('pending',!!pending);
  $('#hero-state').textContent=pending?'measuring':S.src==='manual'?'manual':'measured';
  $('#m-best').textContent=S.best?S.best.meas.toFixed(2)+' g/W · test '+S.best.idx:'—';
  if(!r)return;
  $('#r-T').innerHTML=fmt(r.T*k,2)+'<small>N</small>';
  $('#r-net').innerHTML=fmt(r.grams*k,0)+'<small>g</small>';
  $('#r-P').innerHTML=fmt(r.Pe*k,1)+'<small>W</small>';
  const rpmEl=$('#r-rpm');rpmEl.innerHTML=fmt(r.rpm*k,0)+'<small>rpm'+(r.limited?' max':'')+'</small>';rpmEl.classList.toggle('warn',r.limited);
  $('#r-h').innerHTML=fmt(eCur/2.5*100,1)+'<small>cm</small>';
  $('#r-fm').innerHTML=r.fm==null?'—':fmt(r.fm,2);
  const tipEl=$('#r-tip');tipEl.innerHTML=fmt(r.tip*k,0)+'<small>m/s</small>';tipEl.classList.toggle('warn',r.tip>120);
  $('#r-mass').innerHTML=fmt(r.mass*1000,1)+'<small>g</small>';
  $('#gauge-fill').style.height=clamp(eCur/2.5/RIG.hmax*100,0,100)+'%';
  $('#gen-label').textContent=S.run==='running'?`Test ${S.hist.length+(S.test?1:0)} of ${S.maxTests}`:S.src==='manual'?'Manual shape':S.src==='computed optimum'?'Computed optimum':S.src==='best'?`Best design · test ${S.best?S.best.idx:''}`:S.hist.length?`${S.hist.length} tests done`:'Baseline design';
  updateButtons();
  drawDial(r,k);
}
function setupCanvas(cv){const dpr=Math.min(window.devicePixelRatio||1,2),w=cv.clientWidth,h=+(cv.dataset.h||(cv.dataset.h=cv.getAttribute('height')));cv.width=w*dpr;cv.height=h*dpr;cv.style.height=h+'px';const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);return {x,w,h};}
function drawDial(r,k){
  const {x,w,h}=setupCanvas($('#dial'));const cx=w/2,cy=h/2,R=Math.min(h/2-14,90);
  const side=S.mode==='cyclo'?(r.side||0)*k:0, lift=Math.max(0,r.T*k);
  x.strokeStyle=COL.line2;x.lineWidth=1;[1,2/3,1/3].forEach(f=>{x.beginPath();x.arc(cx,cy,R*f,0,7);x.stroke();});
  x.beginPath();x.moveTo(cx-R,cy);x.lineTo(cx+R,cy);x.moveTo(cx,cy-R);x.lineTo(cx,cy+R);x.stroke();
  x.font='10px "JetBrains Mono",monospace';x.fillStyle=COL.faint;x.textAlign='left';
  const full=S.mode==='prop'?((r.imb||0)*k*k>0.6?3:0.6):3,sc=R/full;
  x.textAlign='right';x.fillText('outer ring '+full+' N',w-4,12);x.textAlign='left';
  // top view: drum axis left-right, side push is fore/aft along the vertical of this dial
  const len=clamp(side,-3,3)*sc;
  x.textAlign='left';x.fillStyle=COL.dim;
  if(S.mode==='prop'){const im=(r.imb||0)*k*k,ang=-rotor.rotation.y,L=clamp(im,0,full)*sc;
    if(im<0.005){x.beginPath();x.fillStyle=COL.amber;x.arc(cx,cy,3.5,0,7);x.fill();x.fillStyle=COL.dim;x.fillText('blades equal: no side force',6,h-6);}
    else{x.strokeStyle=COL.amber;x.fillStyle=COL.amber;x.lineWidth=2.5;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(ang)*L,cy+Math.sin(ang)*L);x.stroke();x.beginPath();x.arc(cx+Math.cos(ang)*L,cy+Math.sin(ang)*L,4,0,7);x.fill();
      x.strokeStyle=COL.amber;x.globalAlpha=.3;x.lineWidth=1;x.beginPath();x.arc(cx,cy,L,0,7);x.stroke();x.globalAlpha=1;
      x.fillStyle=COL.dim;x.fillText('spins with the rotor: shakes the rig',6,h-6);}
    $('#side-val').textContent=im.toFixed(2)+' N';return;}
  else{x.strokeStyle=COL.amber;x.fillStyle=COL.amber;x.lineWidth=2.5;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx,cy-len);x.stroke();
    if(Math.abs(len)>4){const d=Math.sign(len);x.beginPath();x.moveTo(cx,cy-len-d*2);x.lineTo(cx-5,cy-len+d*7);x.lineTo(cx+5,cy-len+d*7);x.fill();}
    x.fillStyle=COL.dim;const ang=Math.atan2(side,lift)/D2R;x.fillText(`thrust tilted ${Math.abs(ang).toFixed(0)}° ${side>=0?'forward':'back'}`,6,h-6);}
  $('#side-val').textContent=(S.mode==='prop'?'0.00':Math.abs(side).toFixed(2))+' N';
}
export function drawOutline(){
  const cv=$('#outline');if(!cv||!cv.clientWidth)return;const g=S.target;
  const padL=8,padR=8,N=40,w0=cv.clientWidth,span=w0-padL-padR;
  const maxTot=g.chord+Math.max(...STATIONS.map(k=>g[k]||0));
  const bladeLen=g.R-0.04,trueSc=span/bladeLen,stripH=Math.min(70,maxTot*trueSc);
  const top=16,areaH=80,stripY=top+areaH+22;
  cv.dataset.h=Math.ceil(stripY+stripH+20);
  const {x,w,h}=setupCanvas(cv);
  const sc=Math.max(trueSc,areaH/(Math.max(0.03,maxTot)*1.1)),exag=sc/trueSc;
  const sw=(t,k)=>Math.tan(g.sweep*D2R)*Math.max(0,t-.55)*bladeLen*k;
  const X=t=>padL+t*span;
  const shape=(y0,k,inner,outer,fill,stroke)=>{x.beginPath();for(let i=0;i<=N;i++){const t=i/N;x.lineTo(X(t),y0+sw(t,k)+inner(t)*tipRound(t)*k);}for(let i=N;i>=0;i--){const t=i/N;x.lineTo(X(t),y0+sw(t,k)+outer(t)*tipRound(t)*k);}x.closePath();x.fillStyle=fill;x.fill();if(stroke){x.strokeStyle=stroke;x.lineWidth=1.2;x.stroke();}};
  const main=()=>0,mainEnd=()=>g.chord,full=t=>g.chord+extAt(g,t);
  // exaggerated view
  shape(top,sc,main,mainEnd,'rgba(63,198,255,.22)',COL.cyan);
  shape(top,sc,mainEnd,full,'rgba(255,173,71,.25)',COL.amber);
  ST_T.forEach(t=>{const tt=Math.min(t,.97);x.beginPath();x.fillStyle=COL.amber;x.arc(X(tt),top+sw(tt,sc)+full(tt)*tipRound(tt)*sc,3,0,7);x.fill();});
  // true proportions (what the 3D view shows)
  shape(stripY,trueSc,main,mainEnd,COL.cyan);
  shape(stripY,trueSc,mainEnd,full,COL.amber);
  x.font='10px "JetBrains Mono",monospace';x.fillStyle=COL.faint;x.textAlign='left';x.fillText('ROOT',padL,10);x.textAlign='right';x.fillText('TIP',w-padR,10);
  x.textAlign='center';x.fillStyle=COL.amber;x.fillText(exag>1.15?`width drawn ${exag.toFixed(exag<10?1:0)}× wider`:'drawn to scale',w/2,10);
  x.fillStyle=COL.faint;x.textAlign='left';x.fillText(`true proportions · ${(bladeLen*100).toFixed(0)} cm long`,padL,stripY-6);
  x.textAlign='right';x.fillText(`root ${(full(0)*1000).toFixed(0)} mm · tip ${(full(1)*1000).toFixed(0)} mm`,w-padR,h-4);
}
export function drawChart(){
  const {x,w,h}=setupCanvas($('#chart'));const L=34,Rp=8,T=8,B=20,pw=w-L-Rp,ph=h-T-B;
  const H=S.hist,n=Math.max(12,H.length);
  let ymax=Math.max(1,...H.map(e=>e.meas),...H.map(e=>e.pred||0))*1.12,ymin=Math.min(0,...H.map(e=>e.meas));
  const X=i=>L+(i-.5)/n*pw,Y=v=>T+ph-(v-ymin)/(ymax-ymin)*ph;
  x.font='10px "JetBrains Mono",monospace';x.fillStyle=COL.faint;x.strokeStyle=COL.line;x.lineWidth=1;
  const step=niceStep((ymax-ymin)/4);
  for(let v=Math.ceil(ymin/step)*step;v<=ymax;v+=step){x.beginPath();x.moveTo(L,Y(v));x.lineTo(w-Rp,Y(v));x.stroke();x.textAlign='right';x.fillText(v.toFixed(step<1?1:0),L-6,Y(v)+3);}
  x.textAlign='center';const xs=n<=20?5:10;for(let i=xs;i<=n;i+=xs)x.fillText(i,X(i),h-6);
  if(!H.length){x.fillStyle=COL.dim;x.font='12px Barlow,sans-serif';x.fillText('Start the AI search to see results here.',L+pw/2,T+ph/2);return;}
  x.fillStyle=COL.faint;H.forEach(e=>{if(e.pred!=null){x.fillRect(X(e.idx)-3,Y(e.pred)-1,6,2);}});
  H.forEach(e=>{x.fillStyle=e.kind==='survey'||e.kind==='baseline'?'rgba(122,142,166,.8)':COL.cyan;x.globalAlpha=.85;x.beginPath();x.arc(X(e.idx),Y(e.meas),2.8,0,7);x.fill();});x.globalAlpha=1;
  x.strokeStyle=COL.amber;x.lineWidth=2;x.beginPath();let b=-1e9;H.forEach((e,i)=>{b=Math.max(b,e.meas);i?x.lineTo(X(e.idx),Y(b)):x.moveTo(X(e.idx),Y(b));});x.stroke();
  x.fillStyle=COL.amber;x.beginPath();x.arc(X(H.length),Y(b),3.5,0,7);x.fill();
}
function niceStep(r){const p=Math.pow(10,Math.floor(Math.log10(r)));const m=r/p;return (m<1.5?1:m<3?2:m<7?5:10)*p;}
export function renderLog(){
  const ol=$('#log');ol.innerHTML='';
  if(!S.log.length){ol.innerHTML='<li>The planner explains each choice here: what it changes and what result it expects.</li>';return;}
  S.log.forEach(l=>{const li=document.createElement('li');if(l.best)li.className='best-hit';li.innerHTML=`<b>#${l.idx}</b>${l.why}<span class="res">${l.res}</span>`;ol.appendChild(li);});
}
export function renderBest(){
  const dl=$('#best-list');
  if(!S.best){dl.innerHTML='<dd class="empty">No tests yet.</dd>';$('#best-when').textContent='';return;}
  $('#best-when').textContent=S.best.meas.toFixed(2)+' g/W';
  dl.innerHTML=(S.mode==='prop'?`<dt>Outline</dt><dd>${outlineName(S.best.g)}</dd>`:'')+DEFS[S.mode].map(d=>`<dt>${d.label}</dt><dd>${d.fmt(S.best.g[d.k])}</dd>`).join('')+`<dt>Mast height</dt><dd>${(S.best.res.height*100).toFixed(1)} cm</dd>`;
}

/* outline presets (wired up in main.js) */
export const PRESETS={square:{chord:0.03,e0:0,e1:0,e2:0,e3:0,e4:0,e5:0,e6:0,e7:0},tri:{chord:0.01,e0:0.035,e1:0.03,e2:0.025,e3:0.02,e4:0.015,e5:0.01,e6:0.005,e7:0.0},rev:{chord:0.01,e0:0.0,e1:0.005,e2:0.01,e3:0.015,e4:0.02,e5:0.025,e6:0.03,e7:0.035},root:{chord:0.012,e0:0.025,e1:0.025,e2:0.025,e3:0.025,e4:0.0149,e5:0.003,e6:0,e7:0},tip:{chord:0.012,e0:0,e1:0,e2:0.003,e3:0.0149,e4:0.025,e5:0.025,e6:0.025,e7:0.025}};
