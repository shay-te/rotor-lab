import {BASELINE} from './physics.js';

// Shared mutable app state. Every module that reads or changes it imports this one object.
export const S={mode:'prop',run:'idle',speed:'watch',noise:true,budget:30,hist:[],best:null,test:null,log:[],
  maxTests:80,tuneAngles:true,target:{...BASELINE.prop},disp:{...BASELINE.prop},live:{res:null,prev:null,k:0},src:'baseline',acc:0};
