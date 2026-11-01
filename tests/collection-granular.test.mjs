import test from 'node:test';
import assert from 'node:assert/strict';
import {grainPlan,grainWindow,createSeedBuffer,GrainCloud,grainArpDegree} from '../instruments/granular.js';

test('grain windows start and end at zero and remain bounded',()=>{
  const window=grainWindow(.23);assert.equal(window[0],0);assert.ok(Math.abs(window.at(-1))<1e-10);
  for(const value of window)assert.ok(value>=0&&value<=.23);
  assert.ok(window[63]>.229);
});

test('seed source is deterministic, stereo, finite and bounded',()=>{
  const context={sampleRate:8000,createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{length,sampleRate,duration:length/sampleRate,numberOfChannels:channels,getChannelData:i=>data[i]};}};
  const a=createSeedBuffer(context,.2),b=createSeedBuffer(context,.2);assert.equal(a.numberOfChannels,2);assert.deepEqual(a.getChannelData(0),b.getChannelData(0));
  assert.notDeepEqual(a.getChannelData(0),a.getChannelData(1));for(const v of a.getChannelData(0))assert.ok(Number.isFinite(v)&&Math.abs(v)<1);
});

test('grain offsets and pitched source lengths stay inside even a short buffer',()=>{
  for(const duration of [.03,.5,6])for(const pitch of [-48,-24,0,24,48])for(const position of [0,.5,1]){
    const p=grainPlan({duration:.65,position,pitch,jitter:.45,pitchJitter:12,stereo:1,gain:.4,density:50},duration,23);
    assert.ok(p.offset>=0);assert.ok(p.offset+p.bufferLength<=duration+1e-9);assert.ok(p.duration>0);assert.ok(Math.abs(p.duration*p.rate-p.bufferLength)<1e-8);assert.ok(p.amplitude<=.4);assert.ok(Math.abs(p.pan)<=1);
  }
});

test('grain arpeggiation follows the selected tempo and quarter/eighth/sixteenth division',()=>{
  assert.deepEqual([.01,.26,.51,.76].map(t=>grainArpDegree(t,120,8)),[0,2,4,6]);
  assert.deepEqual([.01,.26,.51,.76].map(t=>grainArpDegree(t,120,4)),[0,0,2,2]);
  assert.deepEqual([.01,.13,.26,.38].map(t=>grainArpDegree(t,120,16)),[0,2,4,6]);
  assert.equal(grainArpDegree(.26,60,8),0);assert.equal(grainArpDegree(.26,120,8),2);
});

function fixture(){
  const nodes=[];const param=()=>({values:[],setValueAtTime(...v){this.values.push(v);},setValueCurveAtTime(...v){this.values.push(v);}});
  const node=()=>{const n={connections:[],disconnected:0,connect(to){this.connections.push(to);},disconnect(){this.disconnected++;}};nodes.push(n);return n;};
  const context={currentTime:2,createBufferSource(){return Object.assign(node(),{playbackRate:param(),start(...args){this.started=args;},stop(...args){this.stopped=args;}});},createGain(){return Object.assign(node(),{gain:param()});},createStereoPanner(){return Object.assign(node(),{pan:param()});}};
  const audio={context,output:{}},cloud=new GrainCloud(audio);cloud.setBuffer({duration:6});return{cloud,nodes,audio};
}

test('actual grains schedule source/window/pan at the audio clock and report the same events',()=>{
  const f=fixture();const event=f.cloud.schedule(2.08,{duration:.18,position:.5,pitch:12,jitter:0,pitchJitter:0,stereo:.5,gain:.2,density:18});
  assert.equal(event.when,2.08);assert.ok(Math.abs(event.until-2.26)<1e-10);assert.equal(f.nodes[0].started[0],event.when);assert.equal(f.nodes[0].started[1],event.offset);assert.equal(f.nodes[0].playbackRate.values[0][0],2);assert.equal(f.nodes[1].gain.values[0][1],event.when);assert.equal(f.nodes[2].connections[0],f.audio.output);
  assert.equal(event.bufferLength,f.nodes[0].started[2]);assert.equal(event.bufferLength,event.duration*2); // The visual source window follows transposed buffer time.
  assert.equal(f.cloud.pool.size,1);f.nodes[0].onended();assert.equal(f.cloud.pool.size,0);assert.ok(f.nodes.every(n=>n.disconnected===1));
});

test('grain pool is bounded and teardown stops and disconnects every source',()=>{
  const f=fixture(),opts={duration:.65,position:.3,pitch:0,gain:.2,density:50};for(let i=0;i<100;i++)f.cloud.schedule(2+i*.005,opts);assert.equal(f.cloud.pool.size,48);assert.equal(f.cloud.events.length,48);
  f.cloud.destroy();assert.equal(f.cloud.pool.size,0);assert.equal(f.cloud.events.length,0);assert.ok(f.nodes.every(n=>n.disconnected===1));assert.equal(f.cloud.schedule(3,opts),null);
});
