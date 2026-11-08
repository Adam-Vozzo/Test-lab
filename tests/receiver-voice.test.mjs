import test from 'node:test';
import assert from 'node:assert/strict';
import {receiverSpectrum} from '../receiver-voice.js';

test('Receiver retains a tuned centre while symmetric sidebands change width and harmonic balance',()=>{
 const pure=receiverSpectrum({sideband:0,spread:0}),wide=receiverSpectrum({sideband:1,spread:1});
 assert.deepEqual(pure.weights,[1,0,0]);assert.equal(wide.detunes[0],0);assert.equal(wide.detunes[1],-wide.detunes[2]);assert.equal(wide.detunes[2],18);
 assert.ok(wide.weights[0]>wide.weights[1]);assert.equal(wide.weights[1],wide.weights[2]);assert.equal(wide.weights.reduce((s,n)=>s+n),1);
});

test('Receiver noise, bandwidth and wander remain independent and bounded for invalid imports',()=>{
 for(const value of[-100,0,.5,1,100,NaN,Infinity,undefined]){
  const result=receiverSpectrum({sideband:value,spread:value,air:value,drift:value,bandwidth:value});
  for(const value of Object.values(result).flat())assert.ok(Number.isFinite(value));
  assert.ok(Math.abs(result.weights.reduce((s,n)=>s+n)-1)<1e-12);assert.ok(result.noiseGain>=0&&result.noiseGain<=.13);assert.ok(result.driftCents>=0&&result.driftCents<=4);
  assert.ok(result.bandwidthRatio>=1.35&&result.bandwidthRatio<=29.35);
 }
 const dry=receiverSpectrum({air:0,drift:0,bandwidth:0}),open=receiverSpectrum({air:1,drift:1,bandwidth:1});
 assert.equal(dry.noiseGain,0);assert.equal(dry.driftCents,0);assert.ok(open.bandwidthRatio>dry.bandwidthRatio*20);
 assert.deepEqual(dry.weights,open.weights);assert.deepEqual(dry.detunes,open.detunes);
});
