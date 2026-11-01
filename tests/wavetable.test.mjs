import test from 'node:test';
import assert from 'node:assert/strict';
import {wavetableCoefficients,wavetableSample} from '../wavetable.js';
test('wavetable plots exactly the oscillator coefficients with bounded amplitude and no DC',()=>{
 for(const position of [0,.25,.5,.75,1])for(const warp of [0,.5,1]){
  const {real,imag}=wavetableCoefficients(position,warp);assert.equal(real[0],0);assert.equal(imag[0],0);let dc=0;
  for(let i=0;i<256;i++){const theta=i/256*Math.PI*2,value=wavetableSample(theta,position,warp);let direct=0;for(let k=1;k<real.length;k++)direct+=real[k]*Math.cos(k*theta)+imag[k]*Math.sin(k*theta);assert.ok(Math.abs(value-direct)<1e-6);assert.ok(Math.abs(value)<=.881);dc+=value;}
  assert.ok(Math.abs(dc/256)<1e-6);
 }
});
test('wavetable position and spectral warp produce different periodic shapes',()=>{
 const rmsDifference=(a,b)=>Math.sqrt(Array.from({length:128},(_,i)=>(a(i*Math.PI/64)-b(i*Math.PI/64))**2).reduce((a,b)=>a+b)/128);
 assert.ok(rmsDifference(p=>wavetableSample(p,0),p=>wavetableSample(p,.75))>.15);
 assert.ok(rmsDifference(p=>wavetableSample(p,.6,0),p=>wavetableSample(p,.6,1))>.02);
 assert.ok(Math.abs(wavetableSample(.33,.6,.7)-wavetableSample(.33+Math.PI*2,.6,.7))<1e-10);
});
