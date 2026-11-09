import test from 'node:test';
import assert from 'node:assert/strict';
import {rosesSpectrum} from '../roses-voice.js';

test('Roses keeps the measured 1:2.5:4.5 glass modes separate from its harmonic foundation',()=>{
  const petal=rosesSpectrum(),bed=rosesSpectrum({roseLayer:1});
  assert.deepEqual(petal.glassRatios.map(value=>value/petal.glassRatios[0]),[1,2.5,4.5]);
  assert.deepEqual(petal.bodyRatios,[1,1,2]);
  assert.deepEqual(bed.glassWeights,[0,0,0]);assert.deepEqual(bed.bodyWeights,petal.bodyWeights);
  assert.ok(petal.glassWeights.reduce((a,b)=>a+b)>petal.bodyWeights.reduce((a,b)=>a+b),'Petal strikes lead the direct-touch sound');
});

test('Roses sound controls remain finite and preserve independent body and glass mixes',()=>{
  for(const value of[-100,0,.5,1,100,NaN,Infinity,undefined]){
    const spectrum=rosesSpectrum({roseBody:value,roseGlass:value,roseDecay:value,roseWidth:value,roseMotion:value,roseLayer:value});
    for(const value of Object.values(spectrum).flat())assert.ok(Number.isFinite(value));
    assert.ok(spectrum.bodyWeights.reduce((a,b)=>a+b)<=1.000001);
    assert.ok(spectrum.glassWeights.reduce((a,b)=>a+b)<=1.000001);
    assert.ok(spectrum.decaySeconds>=.08&&spectrum.decaySeconds<=1.08);
    assert.ok(spectrum.motionCents>=0&&spectrum.motionCents<=5);
  }
  const dark=rosesSpectrum({roseGlass:0}),bright=rosesSpectrum({roseGlass:1});
  assert.deepEqual(dark.bodyWeights,bright.bodyWeights);
  assert.deepEqual(dark.glassWeights,[0,0,0]);
  assert.equal(rosesSpectrum({roseWidth:0}).bodyDetunes[1],-0);
});
