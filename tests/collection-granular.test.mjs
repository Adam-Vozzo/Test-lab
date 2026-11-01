import test from 'node:test';
import assert from 'node:assert/strict';
import {grainPlan,grainWindow,createSeedBuffer,GrainCloud,grainArpDegree,grainWindowIndex,retainGrainClock} from '../instruments/granular.js';
import {circuitPacketPhase,pathPoint,circuitWind,touchWindGain} from '../instruments/swarm.js';

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
  const nodes=[],tables=[];const param=()=>({values:[],setValueAtTime(...v){this.values.push(v);},setValueCurveAtTime(...v){this.values.push(v);}});
  const node=()=>{const n={connections:[],disconnected:0,connect(to){this.connections.push(to);},disconnect(){this.disconnected++;}};nodes.push(n);return n;};
  const context={currentTime:2,createBufferSource(){return Object.assign(node(),{playbackRate:param(),start(...args){this.started=args;},stop(...args){this.stopped=args;}});},createGain(){return Object.assign(node(),{gain:param()});},createStereoPanner(){return Object.assign(node(),{pan:param()});}};
  context.createPeriodicWave=(real,imag,options)=>{const table={real,imag,options};tables.push(table);return table;};
  context.createOscillator=()=>Object.assign(node(),{frequency:param(),setPeriodicWave(table){this.table=table;},start(...args){this.started=args;},stop(...args){this.stopped=args;}});
  const audio={context,output:{}},cloud=new GrainCloud(audio);cloud.setBuffer({duration:6});return{cloud,nodes,audio,tables};
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

test('three source windows cycle on the musical audio clock and preserve event identity',()=>{
  assert.deepEqual([0,.499,.5,.999,1,1.5].map(t=>grainWindowIndex(t,0,120,1)),[0,0,1,1,2,0]);
  assert.equal(grainWindowIndex(5.75,5,120,.5),0);assert.equal(grainWindowIndex(5.75,5,60,1),0);
  const f=fixture();const event=f.cloud.schedule(2.1,{duration:.18,position:.5,pitch:0,gain:.2,density:18,window:2});assert.equal(event.window,2);assert.equal(event.when,f.nodes[0].started[0]);
});

test('low grain densities keep their longer intervals instead of restarting every scheduler tick',()=>{
  let next=0;const scheduled=[];for(let tick=0;tick<80;tick++){const now=tick*.025;next=retainGrainClock(next,now);while(next<now+.11){scheduled.push(next);next+=.5;}}
  assert.deepEqual(scheduled,[0,.5,1,1.5,2]);assert.equal(retainGrainClock(5.5,5.025),5.5);assert.ok(retainGrainClock(4,5)>5);
});

test('grain wavetable layer uses the same clock, exact coefficients, bounded mix and owned cleanup',()=>{
  const f=fixture(),options={duration:.18,position:.5,pitch:12,pitchJitter:0,root:57,gain:.2,density:18,tableMix:.5,tablePosition:.63,tableWarp:.4};
  const event=f.cloud.schedule(2.1,options),oscillator=f.nodes.find(n=>n.frequency),tableGain=f.nodes.at(-1);
  assert.equal(oscillator.started[0],event.when);assert.equal(oscillator.frequency.values[0][0],440);assert.equal(f.tables[0].options.disableNormalization,true);
  assert.equal(tableGain.gain.values[0][1],event.when);const sourcePeak=Math.max(...f.nodes[1].gain.values[0][0]),tablePeak=Math.max(...tableGain.gain.values[0][0]);assert.ok(Math.abs(tablePeak/sourcePeak-.8)<1e-6);
  f.cloud.schedule(2.2,options);assert.equal(f.tables.length,1);f.cloud.destroy();assert.equal(f.cloud.pool.size,0);assert.ok(f.nodes.every(n=>n.disconnected===1));assert.deepEqual(oscillator.stopped,[]);
});

test('satellite pan modulation remains bounded together with grain stereo spread',()=>{
  for(const panBias of [-1,-.5,.5,1])for(let i=0;i<50;i++){const p=grainPlan({duration:.18,position:.5,pitch:0,stereo:1,panBias,gain:.2,density:18},6,i);assert.ok(p.pan>=-1&&p.pan<=1);}
});

test('stopping grains also removes unsounded future visual events',()=>{
  const f=fixture(),options={duration:.2,position:.5,pitch:0,gain:.2,density:18};const current=f.cloud.schedule(2,options);f.cloud.schedule(2.08,options);f.audio.context.currentTime=2.03;f.cloud.stop();
  assert.equal(f.cloud.pool.size,0);assert.deepEqual(f.cloud.events.map(e=>e.id),[current.id]);assert.equal(f.cloud.events[0].until,2.03);
});

test('cancelling one touch stops its buffer and table layers without cancelling another touch',()=>{
  const f=fixture(),options={duration:.2,position:.5,pitch:0,gain:.2,density:18,tableMix:.5};
  const first=f.cloud.schedule(2.08,{...options,contactId:1}),second=f.cloud.schedule(2.1,{...options,contactId:2});f.cloud.cancelContact(1);
  assert.equal(f.cloud.pool.size,1);assert.deepEqual(f.cloud.events.map(e=>e.id),[second.id]);assert.ok(f.nodes.slice(0,5).every(n=>n.disconnected===1));assert.ok(f.nodes.slice(5).every(n=>n.disconnected===0));assert.notEqual(first.id,second.id);f.cloud.destroy();
});

test('circuit packets stay hidden before their note and follow routed distance to the sculpture',()=>{
  const event={when:5,travel:.5};assert.equal(circuitPacketPhase(event,4.99),null);assert.equal(circuitPacketPhase(event,5),0);assert.equal(circuitPacketPhase(event,5.25),.5);assert.equal(circuitPacketPhase(event,5.5),1);
  const path=[[0,0],[40,0],[40,60]];assert.deepEqual(pathPoint(path,0),[0,0]);assert.deepEqual(pathPoint(path,.5),[40,10]);assert.deepEqual(pathPoint(path,1),[40,60]);
});

test('sequence wind starts at sculpture arrival and sounding touches modulate physical force',()=>{
  const event={when:5,travel:.5,cutoff:2400,resonance:2.8,spread:7};assert.equal(circuitWind(event,5.49),null);assert.ok(circuitWind(event,5.5).force>0);assert.ok(circuitWind(event,6).front>circuitWind(event,5.6).front);assert.ok(circuitWind(event,6).force<circuitWind(event,5.6).force);assert.equal(circuitWind(event,8.3),null);
  assert.ok(touchWindGain(.1,60)>touchWindGain(0,60));assert.ok(touchWindGain(.1,72)>touchWindGain(.1,48));assert.equal(circuitWind(event,5.6,0).force,0);
});
