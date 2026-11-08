import test from 'node:test';
import assert from 'node:assert/strict';
import {relayModes} from '../relay-voice.js';

test('modal material preserves the fundamental and bends upper modes without FM',()=>{
 const string=relayModes({material:0}),plate=relayModes({material:1});
 assert.deepEqual(string.map(m=>m.ratio),[1,2,3,4,5,6]);assert.equal(plate[0].ratio,1);
 assert.ok(Math.abs(plate[2].ratio-2.756)<1e-10);assert.equal(plate.length,6);
});

test('modal excitation remains normalized and finite across imported extremes',()=>{
 for(const value of [-100,0,.2,.5,1,100,NaN,Infinity,undefined]){
  const modes=relayModes({material:value,damping:value,brightness:value,strike:value,excitation:value});
  assert.ok(Math.abs(modes.reduce((s,m)=>s+m.weight,0)-1)<1e-10);
  for(const mode of modes)for(const [key,n]of Object.entries(mode)){
   assert.ok(Number.isFinite(n)&&n>0,key);if(key==='weight'||key==='tail')assert.ok(n<=1,key);
  }
 }
});

test('damping kills higher modes sooner; brightness, strike and excitation have distinct roles',()=>{
 const soft=relayModes({damping:0}),damped=relayModes({damping:1});
 assert.ok(damped[5].decay<soft[5].decay*.1);assert.ok(damped[5].decay<damped[0].decay);
 const dark=relayModes({brightness:0}),bright=relayModes({brightness:1});
 assert.ok(bright[5].weight/bright[0].weight>dark[5].weight/dark[0].weight*3);
 assert.notDeepEqual(relayModes({strike:.1}).map(m=>m.weight),relayModes({strike:.5}).map(m=>m.weight));
 assert.ok(relayModes({excitation:1})[0].tail>relayModes({excitation:0})[0].tail*20);
});
