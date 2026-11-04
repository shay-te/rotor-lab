// Rotor physics: blade-element momentum for propellers, a quasi-steady model for cyclorotors.
// Pure: no DOM and no THREE, so the page and Node (tools/optimize.mjs) both import it.

/* ===================== PHYSICS ===================== */
export const D2R=Math.PI/180, RHO=1.225, MU=1.81e-5, G=9.81, PLA=1240;
export const RIG={W:1.08, k:12, hmax:0.5}; // moving head weight (N), mast spring (N/m), max travel (m)

export const DEFS={
  prop:[
    {k:'n',label:'Blades',min:1,max:5,int:true,fmt:v=>v.toFixed(0)},
    {k:'R',label:'Blade length',hint:'radius',min:0.08,max:0.40,fmt:v=>(v*100).toFixed(1)+' cm'},
    {k:'chord',label:'Main panel width',min:0.008,max:0.08,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e0',label:'Panel out · root',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e1',label:'Panel out · 14%',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e2',label:'Panel out · 29%',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e3',label:'Panel out · 43%',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e4',label:'Panel out · 57%',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e5',label:'Panel out · 71%',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e6',label:'Panel out · 86%',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'e7',label:'Panel out · tip',min:0,max:0.06,group:'outline',fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'pitch',label:'Pitch',hint:'at 75% radius',min:4,max:24,fmt:v=>v.toFixed(1)+'°'},
    {k:'twist',label:'Twist',hint:'root − tip',min:0,max:30,fmt:v=>v.toFixed(1)+'°'},
    {k:'camber',label:'Camber',min:0,max:0.08,fmt:v=>(v*100).toFixed(1)+'%'},
    {k:'sweep',label:'Tip sweep',min:-15,max:30,fmt:v=>v.toFixed(0)+'°'},
    {k:'a1',label:'Blade 1 pitch',hint:'offset',min:-8,max:8,group:'angles',blade:1,fmt:v=>(v>0?'+':'')+v.toFixed(1)+'°'},
    {k:'a2',label:'Blade 2 pitch',hint:'offset',min:-8,max:8,group:'angles',blade:2,fmt:v=>(v>0?'+':'')+v.toFixed(1)+'°'},
    {k:'a3',label:'Blade 3 pitch',hint:'offset',min:-8,max:8,group:'angles',blade:3,fmt:v=>(v>0?'+':'')+v.toFixed(1)+'°'},
    {k:'a4',label:'Blade 4 pitch',hint:'offset',min:-8,max:8,group:'angles',blade:4,fmt:v=>(v>0?'+':'')+v.toFixed(1)+'°'},
    {k:'a5',label:'Blade 5 pitch',hint:'offset',min:-8,max:8,group:'angles',blade:5,fmt:v=>(v>0?'+':'')+v.toFixed(1)+'°'},
    {k:'c1',label:'Blade 1 tilt',hint:'up + / down −',min:-90,max:90,group:'angles',blade:1,fmt:v=>(v>0?'+':'')+v.toFixed(0)+'°'},
    {k:'c2',label:'Blade 2 tilt',hint:'up + / down −',min:-90,max:90,group:'angles',blade:2,fmt:v=>(v>0?'+':'')+v.toFixed(0)+'°'},
    {k:'c3',label:'Blade 3 tilt',hint:'up + / down −',min:-90,max:90,group:'angles',blade:3,fmt:v=>(v>0?'+':'')+v.toFixed(0)+'°'},
    {k:'c4',label:'Blade 4 tilt',hint:'up + / down −',min:-90,max:90,group:'angles',blade:4,fmt:v=>(v>0?'+':'')+v.toFixed(0)+'°'},
    {k:'c5',label:'Blade 5 tilt',hint:'up + / down −',min:-90,max:90,group:'angles',blade:5,fmt:v=>(v>0?'+':'')+v.toFixed(0)+'°'}
  ],
  cyclo:[
    {k:'n',label:'Blades',min:2,max:6,int:true,fmt:v=>v.toFixed(0)},
    {k:'Rc',label:'Drum radius',min:0.04,max:0.14,fmt:v=>(v*100).toFixed(1)+' cm'},
    {k:'span',label:'Blade span',min:0.08,max:0.30,fmt:v=>(v*100).toFixed(1)+' cm'},
    {k:'chord',label:'Chord',min:0.015,max:0.06,fmt:v=>(v*1000).toFixed(0)+' mm'},
    {k:'amp',label:'Pitch swing',hint:'amplitude',min:10,max:45,fmt:v=>v.toFixed(1)+'°'},
    {k:'phase',label:'Phase offset',hint:'steers thrust',min:-40,max:40,fmt:v=>v.toFixed(0)+'°'},
    {k:'camber',label:'Camber',min:0,max:0.08,fmt:v=>(v*100).toFixed(1)+'%'}
  ]
};
export const BASELINE={
  prop:{n:2,R:0.12,chord:0.02,e0:0.008,e1:0.0069,e2:0.0057,e3:0.0046,e4:0.0034,e5:0.0023,e6:0.0011,e7:0.0,pitch:13,twist:10,camber:0.03,sweep:0,a1:0,a2:0,a3:0,a4:0,a5:0,c1:0,c2:0,c3:0,c4:0,c5:0},
  cyclo:{n:4,Rc:0.08,span:0.16,chord:0.035,amp:28,phase:12,camber:0.02}
};
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const clamp01=v=>clamp(v,0,1);
export function decode(mode,u){const g={};DEFS[mode].forEach((d,i)=>{let v=d.min+u[i]*(d.max-d.min);if(d.int)v=Math.round(v);g[d.k]=v;});return g;}
export function encode(mode,g){return DEFS[mode].map(d=>(g[d.k]-d.min)/(d.max-d.min));}

export function airfoil(a,camber,Re,slope){
  const a0=5.8*slope, aL0=-2*camber, aS=(10+45*camber)*D2R;
  let cl, over=0;
  if(Math.abs(a)<=aS) cl=a0*(a-aL0);
  else {const s=Math.sign(a); const clm=a0*(s*aS-aL0); over=Math.abs(a)-aS; cl=clm*Math.max(0.5,1-over/0.35);}
  const re=Math.max(Re,1.5e4);
  const cd0=0.012*Math.pow(re/1e5,-0.45)*(1+2*camber);
  const dc=cl-8*camber;
  const cd=cd0+0.03*dc*dc+1.1*Math.pow(Math.sin(Math.min(over,1.2)),2);
  return {cl,cd};
}
export const NS=8,STATIONS=[...Array(NS)].map((_,k)=>'e'+k),ST_T=STATIONS.map((_,k)=>k/(NS-1));
export function extAt(g,t){if(g.e0===undefined)return 0;const f=clamp(t,0,1)*(NS-1),i=Math.min(NS-2,Math.floor(f)),u=f-i;return (g[STATIONS[i]]||0)*(1-u)+(g[STATIONS[i+1]]||0)*u;}
export function kinkAt(g,t,c){if(g.e0===undefined)return 0;const d=0.06,a=clamp(t-d,0,1),b=clamp(t+d,0,1);const cw=x=>g.chord+extAt(g,x);return 0.15*Math.abs(cw(a)-2*cw(t)+cw(b))/Math.max(c,1e-3);}
export function tipRound(t){return t>0.9?Math.max(0.3,Math.sqrt(1-0.9*Math.pow((t-0.9)/0.1,2))):1;}
export function outlineName(g){if(g.e0===undefined)return '';const c0=g.chord+g.e0,cm=g.chord+extAt(g,.5),c4=g.chord+g['e'+(NS-1)],r=c4/c0;
  if(cm>1.15*Math.max(c0,c4))return 'Wide middle';if(cm<0.85*Math.min(c0,c4))return 'Narrow waist';
  if(r<0.7)return 'Triangle · wide root';if(r>1.4)return 'Reverse triangle · wide tip';return 'Square';}
export function chordAt(g,t){let c=g.chord+extAt(g,t); if(t>0.9) c*=Math.max(0.3,Math.sqrt(1-0.9*Math.pow((t-0.9)/0.1,2))); return c;}

export function evalProp(g,rpm){
  const n=g.n,R=g.R,r0=Math.max(0.04,0.12*R),N=22,dr=(R-r0)/N,W=rpm*Math.PI/30;
  // per blade: pitch offset, and tilt out of the rotor plane (cos shrinks its circle, sin turns lift sideways)
  const off=[],cb=[],sb=[];for(let b=0;b<n;b++){off.push((g['a'+(b+1)]||0)*D2R);const be=(g['c'+(b+1)]||0)*D2R;cb.push(Math.max(0,Math.cos(be)));sb.push(Math.sin(be));}
  const cm=Math.max(1e-3,cb.reduce((a,v)=>a+v,0)/n),cmax=Math.max(1e-3,...cb);
  const Tb=new Float64Array(n),Qb=new Float64Array(n),Fr=new Float64Array(n),cl=new Float64Array(n),cd=new Float64Array(n);
  let viSum=0;
  for(let i=0;i<N;i++){
    const r=r0+(i+0.5)*dr,x=r/R,t=(r-r0)/(R-r0),c=chordAt(g,t); // r = distance along the blade
    const th=(g.pitch+g.twist*(0.75-x))*D2R;
    const slope=Math.cos(g.sweep*D2R*Math.max(0,(t-0.55)/0.45));
    const kink=kinkAt(g,t,c); // sudden width change sheds a small vortex: extra drag
    const Ut=W*r;
    let vi=Math.max(0.3,0.04*Ut),phi=0,W2=0;
    for(let it=0;it<30;it++){
      phi=Math.atan2(vi,Ut);W2=Ut*Ut+vi*vi;
      let sum=0;for(let b=0;b<n;b++){if(cb[b]<1e-3){cl[b]=cd[b]=0;continue;}const af=airfoil(th+off[b]-phi,g.camber,RHO*Math.sqrt(W2)*cb[b]*c/MU,slope);cl[b]=af.cl;cd[b]=af.cd+kink;sum+=cb[b]*cb[b]*cb[b]*(af.cl*Math.cos(phi)-af.cd*Math.sin(phi));}
      const f=n*(1-x)/(2*x*Math.max(Math.sin(phi),0.01));
      const F=Math.max(0.05,(2/Math.PI)*Math.acos(Math.min(1,Math.exp(-f))));
      const dTp=0.5*RHO*W2*c*sum; // all blades share one inflow
      const rm=r*cm;
      const vNew=dTp>0?Math.sqrt(dTp/(4*Math.PI*RHO*rm*F*cm)):0.05;
      vi=0.55*vi+0.45*vNew;
    }
    const q=0.5*RHO*W2*c*dr;
    for(let b=0;b<n;b++){const k2=cb[b]*cb[b],Ln=q*k2*(cl[b]*Math.cos(phi)-cd[b]*Math.sin(phi));
      Tb[b]+=Ln*cb[b];Fr[b]+=Ln*sb[b];Qb[b]+=q*k2*(cl[b]*Math.sin(phi)+cd[b]*Math.cos(phi))*r*cb[b];}
    viSum+=vi;
  }
  let T=0,Q=0,ix=0,iy=0;
  for(let b=0;b<n;b++){T+=Tb[b];Q+=Qb[b];const az=2*Math.PI*b/n,Fd=Qb[b]/(0.7*R*Math.max(cb[b],0.05));
    ix+=-Fd*Math.sin(az)-Fr[b]*Math.cos(az);iy+=Fd*Math.cos(az)-Fr[b]*Math.sin(az);}
  const Re_=R*cmax,Pfloor=T>0?Math.pow(T,1.5)/Math.sqrt(2*RHO*Math.PI*Re_*Re_)/0.85:0;
  // imbalance: unequal blades leave a force in the rotor plane that spins with the rotor and shakes the rig
  return {T,P:Math.max(Q*W,Pfloor,1e-3),vi:viSum/N,tip:W*R*cmax,rpm,side:0,imb:Math.hypot(ix,iy),Tb:Array.from(Tb)};
}

export function evalCyclo(g,rpm){
  const n=g.n,Rc=g.Rc,b=g.span,c=g.chord,W=rpm*Math.PI/30,A=b*2*Rc,Ut=W*Rc,amp=g.amp*D2R,ph=g.phase*D2R,K=36;
  let v=0.5,Fx=0,Fy=0,Pw=0,dx=0,dy=1,drift=0;
  for(let it=0;it<24;it++){
    const Fx0=Fx,Fy0=Fy;
    Fx=0;Fy=0;Pw=0;
    for(let j=0;j<K;j++){
      const ps=2*Math.PI*j/K,tx=Math.cos(ps),ty=-Math.sin(ps),nx=Math.sin(ps),ny=Math.cos(ps);
      const va=v*(1+0.7*Math.max(0,-(nx*dx+ny*dy))); // air is pushed opposite the force; faster in the downstream half
      const wx=-va*dx-Ut*tx,wy=-va*dy-Ut*ty;
      const wt=-(wx*tx+wy*ty),wn=wx*nx+wy*ny,Wm=Math.hypot(wx,wy)||1e-6;
      const a=amp*Math.cos(ps+ph)+Math.atan2(wn,wt);
      const af=airfoil(a,g.camber,RHO*Wm*c/MU,1);
      const ux=wx/Wm,uy=wy/Wm;let ex=-uy,ey=ux;if(ex*nx+ey*ny<0){ex=-ex;ey=-ey;}
      const q=0.5*RHO*Wm*Wm*c*b;
      const fx=q*(af.cl*ex+af.cd*ux),fy=q*(af.cl*ey+af.cd*uy);
      Fx+=fx;Fy+=fy;Pw-=(fx*tx+fy*ty)*Ut;
    }
    Fx*=n/K;Fy*=n/K;Pw*=n/K;
    const Fm=Math.hypot(Fx,Fy)||1e-6;dx=0.5*dx+0.5*Fx/Fm;dy=0.5*dy+0.5*Fy/Fm;const dm=Math.hypot(dx,dy)||1;dx/=dm;dy/=dm;
    v=0.5*v+0.5*Math.sqrt(Fm/(2*RHO*A));
    if(it>=20)drift=Math.max(drift,Math.hypot(Fx-Fx0,Fy-Fy0)/Fm); // how much the force still moves in the last 4 repeats
  }
  // physical floor: never better than ideal momentum theory plus minimum blade drag (blocks numerical "free lunch" solutions)
  const Fm=Math.hypot(Fx,Fy),Pfloor=Math.pow(Fm,1.5)/Math.sqrt(2*RHO*A)/0.8+n*0.5*RHO*c*b*Ut*Ut*Ut*0.012;
  // settled: false when the repeats never converge (the force keeps swinging), so these numbers are not a real answer
  return {T:Fy,side:Fx,P:Math.max(Pw,Pfloor),vi:v,tip:Ut,rpm,settled:drift<1e-3};
}

export function bladeMass(mode,g){
  if(mode==='prop'){
    const r0=Math.max(0.04,0.12*g.R),N=20,dr=(g.R-r0)/N;let v=0;
    for(let i=0;i<N;i++){const c=chordAt(g,(i+0.5)/N);v+=0.075*c*c*dr;}
    const m=g.n*(v*PLA*0.6+0.003);
    return g.n===1?m*(1+0.45*g.R/0.08):m; // one blade needs a counterweight on a short arm
  }
  return g.n*(0.075*g.chord*g.chord*g.span*PLA*0.6+0.004)+2*(Math.PI*g.Rc*g.Rc*0.0015*PLA*0.4);
}

export function solve(mode,g,budget){
  const ev=mode==='prop'?evalProp:evalCyclo, maxR=mode==='prop'?12000:8000, loss=mode==='cyclo'?1.08:1;
  const run=r=>{const o=ev(g,r);o.Pe=o.P*loss/0.72+0.6;return o;};
  let o=run(maxR),limited=false;
  if(o.Pe<=budget) limited=true;
  else {let lo=200,hi=maxR;for(let i=0;i<20;i++){const m=(lo+hi)/2;if(run(m).Pe>budget)hi=m;else lo=m;}o=run(lo);}
  const mass=bladeMass(mode,g);
  o.limited=limited;o.mass=mass;o.Tnet=o.T-mass*G;o.grams=o.Tnet/G*1000;o.gpw=o.grams/o.Pe;
  o.height=clamp((o.Tnet-RIG.W)/RIG.k,0,RIG.hmax);
  o.lifts=o.Tnet>RIG.W;
  o.score=o.gpw*(o.lifts?1:Math.pow(clamp(o.Tnet/RIG.W,0,1),2)); // shapes that can't lift the head off its stop score low
  o.fm=(mode==='prop'&&o.T>0)?Math.pow(o.T,1.5)/(o.P*Math.sqrt(2*RHO*Math.PI*g.R*g.R)):null;
  return o;
}
