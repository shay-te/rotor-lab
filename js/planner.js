import {DEFS, BASELINE, clamp01, encode, decode} from './physics.js';

/* ===================== AI PLANNER (Gaussian-process Bayesian optimization) ===================== */
export function gauss(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function erf(x){const s=Math.sign(x);x=Math.abs(x);const t=1/(1+0.3275911*x);const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return s*y;}
const Phi=z=>0.5*(1+erf(z/Math.SQRT2)), phi=z=>Math.exp(-0.5*z*z)/Math.sqrt(2*Math.PI);

export class GP{
  constructor(X,y,ls,noise){
    this.X=X;this.ls=ls;const n=X.length;
    this.mu=y.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(y.reduce((a,b)=>a+(b-this.mu)**2,0)/n)||1;this.sd=sd;
    const ys=y.map(v=>(v-this.mu)/sd);
    const K=[];for(let i=0;i<n;i++){K.push(new Float64Array(n));for(let j=0;j<=i;j++){const k=this.k(X[i],X[j])+(i===j?noise:0);K[i][j]=k;K[j]&&(K[j][i]=k);}}
    for(let i=0;i<n;i++)for(let j=0;j<n;j++)K[i][j]=i>=j?K[i][j]:K[j][i];
    const L=K.map(r=>new Float64Array(n));
    for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=K[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(s,1e-9)):s/L[j][j];}
    this.L=L;this.alpha=this.cholSolve(ys);
  }
  k(a,b){let s=0;for(let i=0;i<a.length;i++){const d=(a[i]-b[i])/this.ls[i];s+=d*d;}return Math.exp(-0.5*s);}
  fwd(b){const L=this.L,n=b.length,z=new Float64Array(n);for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*z[k];z[i]=s/L[i][i];}return z;}
  cholSolve(b){const L=this.L,n=b.length,z=this.fwd(b),x=new Float64Array(n);for(let i=n-1;i>=0;i--){let s=z[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}return x;}
  predict(x){const ks=this.X.map(xi=>this.k(x,xi));let m=0;for(let i=0;i<ks.length;i++)m+=ks[i]*this.alpha[i];const v=this.fwd(ks);let vv=1;for(let i=0;i<v.length;i++)vv-=v[i]*v[i];return {mean:this.mu+m*this.sd,std:Math.sqrt(Math.max(vv,1e-9))*this.sd};}
}

export const Planner={
  survey:8,
  pick(mode,hist){
    const d=DEFS[mode].length;
    if(hist.length===0) return {u:encode(mode,BASELINE[mode]),kind:'baseline',why:'Starting from the baseline blade to get a reference reading.'};
    if(hist.length<this.survey){
      // spread-out survey: pick the random candidate farthest from everything tested
      let best=null,bd=-1;
      for(let c=0;c<200;c++){const u=Array.from({length:d},Math.random);const dm=Math.min(...hist.map(h=>dist(u,h.u)));if(dm>bd){bd=dm;best=u;}}
      return {u:best,kind:'survey',why:'Survey: testing a shape far from earlier ones to map the design space.'};
    }
    const X=hist.map(h=>h.u),y=hist.map(h=>h.meas);
    const gp=new GP(X,y,Array(d).fill(0.28),0.02);
    const ranked=[...hist].sort((a,b)=>b.meas-a.meas),best=ranked[0].meas;
    const xi=0.01*Math.abs(best);
    let top=null;
    const progress=Math.min(1,hist.length/45), localSigma=0.14-0.09*progress;
    for(let c=0;c<500;c++){
      let u;
      if(c<160) u=Array.from({length:d},Math.random);
      else {const p=ranked[Math.floor(Math.pow(Math.random(),2)*Math.min(4,ranked.length))].u;u=p.map(v=>clamp01(v+gauss()*localSigma*(Math.random()<0.6?1:0.35)));}
      const pr=gp.predict(u),z=(pr.mean-best-xi)/pr.std,ei=(pr.mean-best-xi)*Phi(z)+pr.std*phi(z);
      if(!top||ei>top.ei) top={u,ei,pr};
    }
    const nearest=Math.min(...hist.map(h=>dist(top.u,h.u)));
    const kind=nearest>0.22?'explore':'refine';
    return {u:top.u,kind,pred:top.pr,ei:top.ei,why:explain(mode,top.u,ranked[0].u,kind,top.pr)};
  }
};
function dist(a,b){let s=0;for(let i=0;i<a.length;i++)s+=(a[i]-b[i])**2;return Math.sqrt(s/a.length);}
export function explain(mode,u,bu,kind,pr){
  const defs=DEFS[mode],g=decode(mode,u),gb=decode(mode,bu);
  const ch=defs.map((d,i)=>({d,du:u[i]-bu[i],v:g[d.k]-gb[d.k]})).filter(c=>Math.abs(c.du)>0.04&&Math.abs(c.v)>1e-9).sort((a,b)=>Math.abs(b.du)-Math.abs(a.du)).slice(0,2);
  const word=c=>{const up=c.v>0;const k=c.d.k;
    const m={n:up?'more blades':'fewer blades',R:up?'longer blades':'shorter blades',Rc:up?'a wider drum':'a narrower drum',span:up?'longer span':'shorter span',chord:up?(mode==='prop'?'a wider main panel':'wider chord'):(mode==='prop'?'a narrower main panel':'narrower chord'),taper:up?'less taper':'more taper',e0:up?'panel out more at the root':'panel in at the root',e1:up?'panel out more at 14%':'panel in at 14%',e2:up?'panel out more at 29%':'panel in at 29%',e3:up?'panel out more at 43%':'panel in at 43%',e4:up?'panel out more at 57%':'panel in at 57%',e5:up?'panel out more at 71%':'panel in at 71%',e6:up?'panel out more at 86%':'panel in at 86%',e7:up?'panel out more at the tip':'panel in at the tip',a1:up?'more angle on blade 1':'less angle on blade 1',a2:up?'more angle on blade 2':'less angle on blade 2',a3:up?'more angle on blade 3':'less angle on blade 3',a4:up?'more angle on blade 4':'less angle on blade 4',a5:up?'more angle on blade 5':'less angle on blade 5',c1:up?'blade 1 tilted up':'blade 1 tilted down',c2:up?'blade 2 tilted up':'blade 2 tilted down',c3:up?'blade 3 tilted up':'blade 3 tilted down',c4:up?'blade 4 tilted up':'blade 4 tilted down',c5:up?'blade 5 tilted up':'blade 5 tilted down',pitch:up?'more pitch':'less pitch',twist:up?'more twist':'less twist',camber:up?'more camber':'less camber',sweep:up?'more tip sweep':'less tip sweep',amp:up?'a bigger pitch swing':'a smaller pitch swing',phase:up?'phase shifted forward':'phase shifted back'}[k];
    return m+' ('+(up?'+':'−')+c.d.fmt(Math.abs(c.v)).replace(/^0\.0+$/,'0')+')';};
  const what=ch.length?ch.map(word).join(' and '):'a fine-tuned variant';
  const lead=kind==='explore'?'Exploring':'Refining the best:';
  return `${lead} ${what}. Model expects ${pr.mean.toFixed(2)} ± ${pr.std.toFixed(2)} g/W.`;
}
