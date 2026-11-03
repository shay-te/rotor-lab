import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {DEFS, D2R, ST_T, clamp, extAt, tipRound} from './physics.js';
import {S} from './state.js';

const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ===================== 3D SCENE ===================== */
const SC=4; // world units per metre
const canvas=document.querySelector('#gl');
export const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x04070c);scene.fog=new THREE.FogExp2(0x04070c,0.07);
export const camera=new THREE.PerspectiveCamera(38,1,0.05,80);camera.position.set(3.7,2.7,4.3);
const controls=new OrbitControls(camera,canvas);
controls.target.set(0,1.45,0);controls.enableDamping=true;controls.minDistance=2.2;controls.maxDistance=11;controls.maxPolarAngle=1.52;
controls.autoRotate=!reduceMotion;controls.autoRotateSpeed=0.45;controls.addEventListener('start',()=>controls.autoRotate=false);
{const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(new RoomEnvironment(),0.04).texture;}

scene.add(new THREE.HemisphereLight(0x5f9cff,0x020306,0.35));
const key=new THREE.DirectionalLight(0xa9dcff,1.0);key.position.set(3,6,3);scene.add(key);
const rim=new THREE.DirectionalLight(0x2f8fff,1.1);rim.position.set(-4,3,-5);scene.add(rim);

const M={
  dark:new THREE.MeshStandardMaterial({color:0x121924,metalness:.85,roughness:.32,envMapIntensity:.55}),
  steel:new THREE.MeshStandardMaterial({color:0x8c99ab,metalness:1,roughness:.2,envMapIntensity:.85}),
  chrome:new THREE.MeshStandardMaterial({color:0xc9d3df,metalness:1,roughness:.08,envMapIntensity:1}),
  rubber:new THREE.MeshStandardMaterial({color:0x07090c,metalness:.1,roughness:.6,envMapIntensity:.3}),
  glow:new THREE.MeshStandardMaterial({color:0x000000,emissive:0x3fc6ff,emissiveIntensity:2.2}),
  glowSoft:new THREE.MeshStandardMaterial({color:0x000000,emissive:0x1d86c4,emissiveIntensity:1.4}),
  blade:new THREE.MeshPhysicalMaterial({color:0xd6ecff,metalness:0,roughness:.12,transparent:true,opacity:.42,clearcoat:1,clearcoatRoughness:.1,emissive:0x0b3456,emissiveIntensity:.6,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.1}),
  core:new THREE.MeshStandardMaterial({color:0x000000,emissive:0x3fc6ff,emissiveIntensity:2.6,transparent:true,opacity:.9}),
  flap:new THREE.MeshStandardMaterial({color:0xffad47,metalness:.1,roughness:.45,transparent:true,opacity:.85,emissive:0x8a4a00,emissiveIntensity:.9,side:THREE.DoubleSide}),
  act:new THREE.MeshStandardMaterial({color:0x000000,emissive:0xffad47,emissiveIntensity:2.4}),
  actOff:new THREE.MeshStandardMaterial({color:0x2a3340,metalness:.6,roughness:.4})
};
const DOT_GEO=new THREE.SphereGeometry(.014,12,8);

/* halo sprites stand in for bloom */
function haloTex(){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');const g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(140,220,255,1)');g.addColorStop(.25,'rgba(63,198,255,.45)');g.addColorStop(1,'rgba(63,198,255,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
const HALO=haloTex();
function halo(size,op){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:HALO,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));s.scale.set(size,size,1);return s;}

/* floor */
const floor=new THREE.Mesh(new THREE.CircleGeometry(12,96),new THREE.MeshStandardMaterial({color:0x070b12,metalness:.35,roughness:.7,envMapIntensity:.08}));
floor.rotation.x=-Math.PI/2;scene.add(floor);
const grid=new THREE.GridHelper(24,48,0x123048,0x0a1724);grid.material.transparent=true;grid.material.opacity=.45;grid.position.y=.002;scene.add(grid);
const plat=new THREE.Mesh(new THREE.CylinderGeometry(1.7,1.76,.05,96),new THREE.MeshStandardMaterial({color:0x0b121c,metalness:.5,roughness:.55,envMapIntensity:.15}));plat.position.y=.025;scene.add(plat);
const rings=[];
[[1.05,.5],[1.32,.3],[1.66,.6],[2.3,.18],[3.1,.12]].forEach(([r,o])=>{const m=new THREE.Mesh(new THREE.RingGeometry(r,r+.012,160),new THREE.MeshBasicMaterial({color:0x3fc6ff,transparent:true,opacity:o,toneMapped:false,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.y=r<1.8?.052:.004;scene.add(m);rings.push(m);});
const pulse=new THREE.Mesh(new THREE.RingGeometry(.98,1,128),new THREE.MeshBasicMaterial({color:0x3fc6ff,transparent:true,opacity:0,toneMapped:false,side:THREE.DoubleSide}));pulse.rotation.x=-Math.PI/2;pulse.position.y=.055;scene.add(pulse);

/* back-wall monitors (ambient) */
function screenTex(seed){const c=document.createElement('canvas');c.width=512;c.height=320;const x=c.getContext('2d');x.fillStyle='#03101c';x.fillRect(0,0,512,320);x.strokeStyle='rgba(63,198,255,.12)';for(let i=0;i<512;i+=32){x.beginPath();x.moveTo(i,0);x.lineTo(i,320);x.stroke();}for(let j=0;j<320;j+=32){x.beginPath();x.moveTo(0,j);x.lineTo(512,j);x.stroke();}
  const cols=['rgba(63,198,255,.9)','rgba(255,173,71,.85)','rgba(86,224,160,.6)'];
  for(let k=0;k<3;k++){x.strokeStyle=cols[k];x.lineWidth=2.5;x.beginPath();for(let i=0;i<=512;i+=4){const y=160+Math.sin(i*.013*(k+1)+seed*2)*(50-k*12)+Math.sin(i*.051+seed+k)*14-k*30;i?x.lineTo(i,y):x.moveTo(i,y);}x.stroke();}
  x.fillStyle='rgba(63,198,255,.7)';x.font='16px monospace';x.fillText('WAKE · LOG '+(seed*7+11),16,26);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.wrapS=THREE.RepeatWrapping;return t;}
const screens=[];
[[-3.6,2.3,-5.2,.35],[0,2.6,-6,0],[3.6,2.3,-5.2,-.35]].forEach(([x,y,z,ry],i)=>{const tex=screenTex(i+1);const m=new THREE.Mesh(new THREE.PlaneGeometry(3.2,2),new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:.55,toneMapped:false}));m.position.set(x,y,z);m.rotation.y=ry;scene.add(m);const f=new THREE.Mesh(new THREE.BoxGeometry(3.35,2.15,.06),M.dark);f.position.set(x,y,z-.05);f.rotation.y=ry;scene.add(f);screens.push(tex);});

/* base */
function cyl(rt,rb,h,mat,seg=48){return new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);}
const base=new THREE.Group();scene.add(base);
[[.66,.74,.12,.11,M.dark],[.5,.57,.1,.22,M.steel],[.33,.4,.1,.32,M.dark]].forEach(([a,b,h,y,m])=>{const c=cyl(a,b,h,m,64);c.position.y=y;base.add(c);});
const footLights=[];
for(let i=0;i<4;i++){
  const g=new THREE.Group();g.rotation.y=i*Math.PI/2+Math.PI/4;base.add(g);
  const leg=new THREE.Mesh(new THREE.BoxGeometry(1,.1,.22),M.dark);leg.position.set(.8,.11,0);g.add(leg);
  const strip=new THREE.Mesh(new THREE.BoxGeometry(.7,.012,.04),M.glowSoft);strip.position.set(.82,.166,0);g.add(strip);
  const foot=cyl(.19,.21,.12,M.dark);foot.position.set(1.32,.08,0);g.add(foot);
  const lamp=cyl(.11,.11,.014,M.glow);lamp.position.set(1.32,.147,0);g.add(lamp);
  const h=halo(.6,.35);h.position.set(1.32,.2,0);g.add(h);footLights.push(h);
}
const loadCell=new THREE.Mesh(new THREE.TorusGeometry(.2,.018,12,72),M.glow.clone());loadCell.rotation.x=Math.PI/2;loadCell.position.y=.385;base.add(loadCell);
const loadHalo=halo(.9,.3);loadHalo.position.y=.4;base.add(loadHalo);

/* telescopic mast */
const mast={outer:cyl(.085,.085,.8,M.dark),mid:cyl(.066,.066,.8,M.steel),inner:cyl(.05,.05,.8,M.chrome)};
Object.values(mast).forEach(m=>scene.add(m));
const bandMid=new THREE.Mesh(new THREE.TorusGeometry(.07,.008,8,40),M.glow);bandMid.rotation.x=Math.PI/2;scene.add(bandMid);
const bandIn=new THREE.Mesh(new THREE.TorusGeometry(.054,.007,8,40),M.glow);bandIn.rotation.x=Math.PI/2;scene.add(bandIn);
const knob=new THREE.Mesh(new THREE.SphereGeometry(.07,24,16),M.dark);scene.add(knob);
const motorHousing=cyl(.075,.09,.2,M.dark);scene.add(motorHousing);
let cable=null,cableE=-1;
function setMast(e){
  mast.outer.position.y=.78;mast.mid.position.y=.88+e*.5;mast.inner.position.y=.98+e;
  bandMid.position.y=1.28+e*.5;bandIn.position.y=1.38+e;knob.position.set(.11,1.05+e*.5,0);
  head.position.y=1.62+e;motorHousing.position.y=1.47+e;
  if(Math.abs(e-cableE)>.01){
    cableE=e;if(cable){scene.remove(cable);cable.geometry.dispose();}
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(.36,.3,.22),new THREE.Vector3(.6,.5+e*.15,.38),new THREE.Vector3(.34,1.0+e*.6,.24),new THREE.Vector3(.12,1.36+e,.08)]);
    cable=new THREE.Mesh(new THREE.TubeGeometry(curve,40,.013,8,false),M.rubber);scene.add(cable);
  }
}

/* head, tilt, rotor */
const head=new THREE.Group();scene.add(head);
const tilt=new THREE.Group();head.add(tilt);
const hub=new THREE.Mesh(new THREE.SphereGeometry(.16,48,32),M.chrome);tilt.add(hub);
const seam=new THREE.Mesh(new THREE.TorusGeometry(.161,.006,8,64),M.dark);seam.rotation.x=Math.PI/2;tilt.add(seam);
const seam2=new THREE.Mesh(new THREE.TorusGeometry(.161,.005,8,64),M.dark);tilt.add(seam2);
const eyeRing=new THREE.Mesh(new THREE.TorusGeometry(.07,.013,12,48),M.dark);eyeRing.position.z=.145;tilt.add(eyeRing);
const eye=new THREE.Mesh(new THREE.SphereGeometry(.055,24,16),M.glow);eye.position.z=.118;tilt.add(eye);
const eyeHalo=halo(.55,.55);eyeHalo.position.z=.2;tilt.add(eyeHalo);
const eyeLight=new THREE.PointLight(0x3fc6ff,1.4,3,2);eyeLight.position.z=.3;tilt.add(eyeLight);
export const rotor=new THREE.Group();tilt.add(rotor);
const forceArrow=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),1,0xffad47,.14,.08);forceArrow.line.material.toneMapped=false;forceArrow.cone.material.toneMapped=false;scene.add(forceArrow);
const fx=new THREE.Group();tilt.add(fx);
let pivots=[],fxMesh=null,builtKey='';

function loft(secs,thick,camber){
  const K=10,ring=[];
  const yt=s=>5*thick*(0.2969*Math.sqrt(s)-0.126*s-0.3516*s*s+0.2843*s*s*s-0.1036*s*s*s*s),yc=s=>camber*4*s*(1-s);
  for(let i=K;i>=0;i--){const s=.5*(1-Math.cos(Math.PI*i/K));ring.push([s,yc(s)+yt(s)]);}
  for(let i=1;i<K;i++){const s=.5*(1-Math.cos(Math.PI*i/K));ring.push([s,yc(s)-yt(s)]);}
  const RN=ring.length,pos=[],idx=[];
  secs.forEach(sec=>{const cp=Math.cos(sec.p),sp=Math.sin(sec.p);ring.forEach(([s,y])=>{const z0=(s-.25)*sec.c,y0=y*sec.c;pos.push(sec.x,y0*cp-z0*sp,y0*sp+z0*cp+(sec.z||0));});});
  for(let j=0;j<secs.length-1;j++)for(let i=0;i<RN;i++){const a=j*RN+i,b=j*RN+(i+1)%RN,c=a+RN,d=b+RN;idx.push(a,c,b,b,c,d);}
  [0,secs.length-1].forEach((j,e)=>{let cx=0,cy=0,cz=0;for(let i=0;i<RN;i++){cx+=pos[(j*RN+i)*3];cy+=pos[(j*RN+i)*3+1];cz+=pos[(j*RN+i)*3+2];}const ci=pos.length/3;pos.push(cx/RN,cy/RN,cz/RN);for(let i=0;i<RN;i++){const a=j*RN+i,b=j*RN+(i+1)%RN;e?idx.push(ci,a,b):idx.push(ci,b,a);}});
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
function propBladeGeo(g,core){
  const R=g.R*SC,x0=.16,secs=[],M_=18,R0=Math.max(.04,.12*g.R);
  for(let j=0;j<=M_;j++){
    const t=j/M_;if(core&&t>.8)break;
    const x=x0+(R-x0)*t,xr=(x/SC)/g.R;
    let c=g.chord*tipRound(t)*SC;if(core)c*=.3;
    const p=(g.pitch+g.twist*(.75-xr))*D2R;
    const z=Math.tan(g.sweep*D2R)*Math.max(0,x-(x0+.55*(R-x0)));
    secs.push({x,c,p,z});
  }
  return loft(secs,core?.045:.1,g.camber);
}
function propSec(g,t){const R=g.R*SC,x0=.16,x=x0+(R-x0)*t,xr=(x/SC)/g.R;return {x,p:(g.pitch+g.twist*(.75-xr))*D2R,z:Math.tan(g.sweep*D2R)*Math.max(0,x-(x0+.55*(R-x0))),cb:g.chord*tipRound(t)*SC,ext:extAt(g,t)*tipRound(t)*SC};}
function place(sec,y0,z0){const cp=Math.cos(sec.p),sp=Math.sin(sec.p);return [sec.x,y0*cp-z0*sp,y0*sp+z0*cp+sec.z];}
function flapGeo(g){ // second panel: thin plate sliding out of the main panel's trailing edge
  const pos=[],idx=[],M_=18,h=.0045;
  for(let j=0;j<=M_;j++){const sec=propSec(g,j/M_),zA=.75*sec.cb-.004,zB=.75*sec.cb+sec.ext;
    [[h/2,zA],[h/2,zB],[-h/2,zB],[-h/2,zA]].forEach(([y,z])=>pos.push(...place(sec,y,z)));}
  for(let j=0;j<M_;j++)for(let i=0;i<4;i++){const a=j*4+i,b=j*4+(i+1)%4,c=a+4,d=b+4;idx.push(a,c,b,b,c,d);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
function cycloBladeGeo(g,core){
  const b=g.span*SC,c=g.chord*SC*(core?.3:1),secs=[];
  for(let j=0;j<=8;j++){secs.push({x:-b/2*(core?.85:1)+b*(core?.85:1)*j/8,c,p:0,z:0});}
  const geo=loft(secs,core?.045:.11,g.camber);geo.rotateZ(Math.PI/2);return geo;
}
function disposeGroup(gr){gr.traverse(o=>{if(o.geometry&&o.userData.own)o.geometry.dispose();});while(gr.children.length)gr.remove(gr.children[0]);}
function own(m){m.userData.own=true;return m;}
function buildRotor(mode,g){
  disposeGroup(rotor);disposeGroup(fx);pivots=[];
  if(mode==='prop'){
    rotor.position.set(0,0,0);fx.position.set(0,0,0);
    const gb=propBladeGeo(g,false),gc=propBladeGeo(g,true),gf=flapGeo(g);
    const acts=ST_T.map(t=>{const sec=propSec(g,Math.min(t,.97));return {on:sec.ext>.004,p:place(sec,0,.75*sec.cb+sec.ext)};});
    const collar=own(new THREE.Mesh(new THREE.TorusGeometry(.168,.018,10,64),M.steel));collar.rotation.x=Math.PI/2;rotor.add(collar);
    for(let i=0;i<g.n;i++){
      const arm=new THREE.Group();arm.rotation.y=2*Math.PI*i/g.n;rotor.add(arm);
      const cg=new THREE.Group();cg.position.x=.15;cg.rotation.z=(g['c'+(i+1)]||0)*D2R;arm.add(cg); // tilt hinge at the hub
      const hinge=own(cyl(.022,.022,.06,M.steel,16));hinge.rotation.x=Math.PI/2;cg.add(hinge);
      const kn=own(new THREE.Mesh(new THREE.BoxGeometry(.07,.05,.07),M.dark));kn.position.x=.03;cg.add(kn);
      const kl=own(new THREE.Mesh(new THREE.BoxGeometry(.012,.052,.03),M.glow));kl.position.set(.05,0,.0);cg.add(kl);
      const pg=new THREE.Group();pg.position.x=-.15;pg.rotation.x=(g['a'+(i+1)]||0)*D2R;cg.add(pg); // this blade's own pitch
      const b=new THREE.Mesh(gb,M.blade);b.renderOrder=2;pg.add(b);
      const c=new THREE.Mesh(gc,M.core);c.renderOrder=1;pg.add(c);
      const f=new THREE.Mesh(gf,M.flap);f.renderOrder=3;pg.add(f);
      acts.forEach(a=>{const d=new THREE.Mesh(DOT_GEO,a.on?M.act:M.actOff);d.position.set(...a.p);pg.add(d);});
    }
    if(g.n===1){ // counterweight opposite the single blade
      const rod=own(cyl(.014,.014,.2,M.steel,12));rod.rotation.z=Math.PI/2;rod.position.x=-.25;rotor.add(rod);
      const w=own(cyl(.05,.05,.07,M.dark,24));w.rotation.z=Math.PI/2;w.position.x=-.35;rotor.add(w);
      const band=own(new THREE.Mesh(new THREE.TorusGeometry(.051,.006,8,32),M.glow));band.rotation.y=Math.PI/2;band.position.x=-.35;rotor.add(band);
    }
    rotor.userData.geos=[gb,gc,gf];
    const disc=own(new THREE.Mesh(new THREE.RingGeometry(.18,g.R*SC,96),new THREE.MeshBasicMaterial({color:0x3fc6ff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false})));
    disc.rotation.x=-Math.PI/2;fx.add(disc);fxMesh=disc;
  } else {
    const b=g.span*SC,Rc=g.Rc*SC,off=.22+b/2;
    rotor.position.set(0,off,0);fx.position.set(0,off,0);
    const shaft=own(cyl(.03,.03,b+.3,M.chrome,24));shaft.position.y=-.15;rotor.add(shaft);
    [-1,1].forEach(s=>{const p=own(cyl(Rc*1.22,Rc*1.22,.018,M.dark,64));p.position.y=s*b/2;rotor.add(p);const r=own(new THREE.Mesh(new THREE.TorusGeometry(Rc*1.22,.008,8,64),M.glow));r.rotation.x=Math.PI/2;r.position.y=s*b/2;rotor.add(r);});
    const gb=cycloBladeGeo(g,false),gc=cycloBladeGeo(g,true);rotor.userData.geos=[gb,gc];
    for(let i=0;i<g.n;i++){
      const beta=2*Math.PI*i/g.n,pv=new THREE.Group();pv.position.set(Rc*Math.sin(beta),0,Rc*Math.cos(beta));pv.userData.beta=beta;rotor.add(pv);
      pv.add(new THREE.Mesh(gb,M.blade));pv.add(new THREE.Mesh(gc,M.core));
      [-1,1].forEach(s=>{const k=own(new THREE.Mesh(new THREE.BoxGeometry(.03,.03,.05),M.steel));k.position.y=s*(b/2-.02);pv.add(k);});
      const rod=own(cyl(.006,.006,Rc*.9,M.steel,8));rod.rotation.z=Math.PI/2;rod.position.set(-Rc*.45,b/2-.03,0);pv.add(rod);
      pivots.push(pv);
    }
    const shell=own(new THREE.Mesh(new THREE.CylinderGeometry(Rc,Rc,b,64,1,true),new THREE.MeshBasicMaterial({color:0x3fc6ff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false})));
    fx.add(shell);fxMesh=shell;
  }
}
function disposeRotorGeos(){(rotor.userData.geos||[]).forEach(g=>g.dispose());rotor.userData.geos=[];}

/* downwash particles */
const PN=420,pPos=new Float32Array(PN*3),pLife=new Float32Array(PN);
const pGeo=new THREE.BufferGeometry();pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
function dotTex(){const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');const g=x.createRadialGradient(16,16,0,16,16,16);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,32,32);return new THREE.CanvasTexture(c);}
const pMat=new THREE.PointsMaterial({color:0x3fc6ff,size:.04,map:dotTex(),transparent:true,opacity:.0,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
const points=new THREE.Points(pGeo,pMat);scene.add(points);points.frustumCulled=false;
for(let i=0;i<PN;i++)pLife[i]=Math.random();
const _v=new THREE.Vector3(),_c=new THREE.Vector3();
function spawn(i,center,flow,mode,g){
  if(mode==='prop'){const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*g.R*SC*.95;pPos[i*3]=center.x+Math.cos(a)*r;pPos[i*3+1]=center.y-.03;pPos[i*3+2]=center.z+Math.sin(a)*r;}
  else{const b=g.span*SC,Rc=g.Rc*SC;const s=(Math.random()-.5)*b;const perp=new THREE.Vector3(0,-flow.z,flow.y);const q=(Math.random()*2-1)*Rc;pPos[i*3]=center.x+s;pPos[i*3+1]=center.y+perp.y*q;pPos[i*3+2]=center.z+perp.z*q;}
}

/* ===================== FRAME (3D part; main.js drives the loop) ===================== */
export let eCur=0;let tiltCur=0,builtMode='';
function lerp(a,b,t){return a+(b-a)*t;}
export function renderScene(dt,now){
  // morph displayed genome toward target
  const defs=DEFS[S.mode];let changed=builtMode!==S.mode;
  if(builtMode!==S.mode){S.disp={...S.target};}
  defs.forEach(d=>{if(d.int){if(S.disp[d.k]!==S.target[d.k]){S.disp[d.k]=S.target[d.k];changed=true;}}else{const nv=lerp(S.disp[d.k],S.target[d.k],Math.min(1,dt*7));if(Math.abs(nv-S.disp[d.k])>1e-6){changed=true;}S.disp[d.k]=nv;}});
  if(changed){disposeRotorGeos();buildRotor(S.mode,S.disp);builtMode=S.mode;}
  const res=S.live.res,k=S.live.k;
  const rpm=res?res.rpm*k:0;
  // spin: visible rate, not literal rpm
  const spin=reduceMotion?.3:(.15+rpm/1300);
  rotor.rotation.y-=spin*2*Math.PI*dt;
  if(S.mode==='cyclo'){const amp=S.disp.amp*D2R,ph=S.disp.phase*D2R;pivots.forEach(pv=>{const ps=pv.userData.beta+rotor.rotation.y;pv.rotation.y=pv.userData.beta+Math.PI/2+amp*Math.cos(ps+ph)*Math.min(1,.2+k);});}
  if(fxMesh)fxMesh.material.opacity=.07*k*Math.min(1,rpm/3000);
  // mast + tilt
  const eT=res?res.height*k*2.5:0;eCur=lerp(eCur,eT,Math.min(1,dt*3));setMast(eCur);
  tiltCur=lerp(tiltCur,S.mode==='cyclo'?-Math.PI/2:0,Math.min(1,dt*3));tilt.rotation.z=tiltCur;
  // glows
  const lf=res?clamp(res.Tnet/4,0,1)*k:0;
  loadCell.material.emissiveIntensity=1+lf*3;loadHalo.material.opacity=.15+lf*.5;
  pulse.scale.setScalar(1+((now/1000)%2.4)/2.4*.65);pulse.material.opacity=(1-((now/1000)%2.4)/2.4)*.35*(.3+lf);
  screens.forEach((t,i)=>t.offset.x=(now/1000*(.01+i*.004))%1);
  // particles
  const center=new THREE.Vector3();
  if(S.mode==='prop'){head.getWorldPosition(center);}else{rotor.getWorldPosition(center);}
  let flow=new THREE.Vector3(0,-1,0);
  if(S.mode==='cyclo'&&res){flow.set(0,-res.T,-res.side).normalize();if(!isFinite(flow.y))flow.set(0,-1,0);}
  const vi=res?res.vi*k:0,spd=(.4+vi*.35)*(reduceMotion?.4:1);
  pMat.opacity=.55*Math.min(1,vi/3)*k;
  for(let i=0;i<PN;i++){pLife[i]+=dt*spd*.6;if(pLife[i]>1){pLife[i]=0;spawn(i,center,flow,S.mode,S.disp);}else{pPos[i*3]+=flow.x*spd*dt*1.6;pPos[i*3+1]+=flow.y*spd*dt*1.6;pPos[i*3+2]+=flow.z*spd*dt*1.6;}}
  pGeo.attributes.position.needsUpdate=true;
  // thrust vector arrow: 1 N = 0.25 units; shows sideways push in cyclorotor mode
  if(res&&res.T*k>0.05){const fv=new THREE.Vector3(0,res.T*k,(res.side||0)*k);const L=fv.length();forceArrow.visible=true;forceArrow.position.copy(center);forceArrow.position.y+=S.mode==='prop'?.05:0;forceArrow.setDirection(fv.clone().normalize());forceArrow.setLength(Math.max(.2,L*.25),.14,.08);}else forceArrow.visible=false;
  controls.update();renderer.render(scene,camera);
}
