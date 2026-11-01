import test from 'node:test';
import assert from 'node:assert/strict';
import {carrierMapping,definition as carrier} from '../instruments/carrier.js';
import {polarMapping,phasePoint,definition as graticule} from '../instruments/graticule.js';
import {definition as cellular} from '../instruments/cellular.js';

const TAU=Math.PI*2;
test('carrier degree and ratio rings follow the rendered circle at different aspect ratios',()=>{
  for(const aspect of [.46,1.44,2.16,3])for(const radial of [.1,.4,.75,.98]){
    const radius=Math.min(aspect*.43,.64),a=.4;
    const nxLeft=.472-Math.cos(a)*radius*radial/aspect,ny=.64-Math.sin(a)*radius*radial;
    const left=carrierMapping(nxLeft,ny,0,aspect),right=carrierMapping(1-nxLeft,ny,1,aspect);
    assert.ok(Math.abs(left.radial-radial)<1e-10);assert.equal(left.degree,Math.min(6,Math.floor(radial*7)));
    assert.ok(Math.abs(right.radial-radial)<1e-10);assert.equal(right.ratio,Math.round((.5+radial*7.5)*4)/4);
  }
});
test('carrier maps angular movement to octave and FM index with bounded extremes',()=>{
  for(let i=0;i<20;i++)for(let j=0;j<20;j++)for(const side of[0,1]){
    const p=carrierMapping(i/19,j/19,side,2.16);assert.ok(Number.isFinite(p.angle));assert.ok(p.radial>=0&&p.radial<=1);
    if(side===0){assert.ok(p.degree>=0&&p.degree<=6);assert.ok(p.octave>=-1&&p.octave<=1);}
    else{assert.ok(p.ratio>=.5&&p.ratio<=8);assert.ok(p.index>=0&&p.index<=10);}
  }
  const low=carrierMapping(.8,.8,1),high=carrierMapping(.8,.1,1);assert.ok(high.index>low.index);
});
test('polar scale sectors and octave rings remain aligned through portrait and wide viewports',()=>{
  for(const aspect of [.46,1.44,2.16,3])for(let degree=0;degree<7;degree++)for(let octave=0;octave<3;octave++){
    const radius=Math.min(aspect*.225,.36),angle=(degree+.5)/7*TAU-Math.PI*.5,r=(octave+.5)/3;
    const p=polarMapping(.255+Math.cos(angle)*radius*r/aspect,.48+Math.sin(angle)*radius*r,aspect);
    assert.equal(p.degree,degree);assert.equal(p.octave,octave-1);assert.ok(Math.abs(p.r-r)<1e-10);
  }
});
test('phase plot uses the FM carrier, modulator and normalized analytic derivative',()=>{
  for(const ratio of [.25,1,1.5,3,8])for(const index of [0,.75,5,10])for(let i=0;i<51;i++){
    const theta=i/50*TAU,p=phasePoint(theta,ratio,index),h=.000001;
    const numerical=(phasePoint(theta+h,ratio,index).carrier-phasePoint(theta-h,ratio,index).carrier)/(2*h)/(1+index*ratio);
    assert.ok(Math.abs(p.derivative-numerical)<1e-6);assert.ok(Math.abs(p.carrier)<=1&&Math.abs(p.mod)<=1&&Math.abs(p.derivative)<=1+1e-12);
  }
  const p=phasePoint(.7,1,0);assert.equal(p.carrier,p.mod);assert.equal(p.derivative,Math.cos(.7));
});
test('gesture instrument controls declare valid defaults and affected-object descriptions',()=>{
  for(const d of[carrier,cellular,graticule])for(const [controls,defaults]of[[d.appearanceControls,d.defaultAppearance],[d.soundControls,d.defaultSound]]){
    const keys=new Set();for(const c of controls){assert.ok(!keys.has(c.key),`${d.id} duplicate ${c.key}`);keys.add(c.key);assert.ok(c.section&&c.description.length>15);assert.ok(Object.hasOwn(defaults,c.key),`${d.id} missing ${c.key}`);
      if(!c.kind||c.kind==='range'){assert.ok(Number.isFinite(defaults[c.key]));assert.ok(defaults[c.key]>=c.min&&defaults[c.key]<=c.max,`${d.id} invalid default ${c.key}`);}
    }
  }
});
