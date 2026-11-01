import test from 'node:test';
import assert from 'node:assert/strict';
import {CollectionAudio, midiFrequency} from '../collection-audio.js';

function fixture({suspended=false,maxVoices=16,audioSession,resumeMode='normal',useTone=false}={}) {
  let now=1, unblock, timer, clears=0,resumeCalls=0,toneStarts=0;
  const waits=new Set(),states=[];
  const resume = suspended ? new Promise(resolve=>{unblock=resolve;}) : Promise.resolve();
  class Param {
    constructor(value=0) { this.value=value;this.events=[]; }
    setValueAtTime(value,time) { this.value=value;this.events.push({kind:'set',value,time}); }
    linearRampToValueAtTime(value,time) { this.value=value;this.events.push({kind:'ramp',value,time}); }
    setTargetAtTime(value,time,duration) { this.value=value;this.events.push({kind:'target',value,time,duration}); }
    cancelScheduledValues(time) { this.events=this.events.filter(event=>event.time<time); }
  }
  class Node {
    constructor() { this.connections=[];for(const key of ['frequency','detune','gain','Q','pan','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param(); }
    connect(node) {this.connections.push(node);return node;}
    disconnect() {this.disconnected=true;this.connections=[];}
    start(time) {assert.equal(this.started,undefined);this.started=time;}
    stop(time) {this.stopped=time??now;}
    getFloatTimeDomainData(array) {array.fill(this.sample??0);}
    getByteFrequencyData(array) {array.fill(this.spectral??0);}
  }
  class Context {
    constructor() { this.state=suspended?'suspended':'running';this.destination=new Node();this.sampleRate=48000;this.nodes=[];this.listeners=new Map(); }
    get currentTime() {return now;}
    createGain() {const node=new Node();this.nodes.push(node);return node;}
    createOscillator() {return this.createGain();}
    createBiquadFilter() {return this.createGain();}
    createWaveShaper() {return this.createGain();}
    createStereoPanner() {return this.createGain();}
    createDelay() {return this.createGain();}
    createDynamicsCompressor() {return this.createGain();}
    createAnalyser() {return this.createGain();}
    addEventListener(name,fn) {if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
    removeEventListener(name,fn) {this.listeners.get(name)?.delete(fn);}
    emit(name) {for(const fn of [...(this.listeners.get(name)||[])])fn();}
    resume() {resumeCalls++;if(resumeMode==='stalled'||(resumeMode==='gesture'&&resumeCalls===1))return new Promise(()=>{});return(resumeMode==='normal'?resume:Promise.resolve()).then(()=>{if(this.state!=='closed'){this.state='running';this.emit('statechange');}});}
    close() {this.state='closed';this.emit('statechange');return Promise.resolve();}
  }
  const errors=[];
  const context=useTone?new Context():null,Tone=useTone?{getContext:()=>({rawContext:context}),start(){toneStarts++;return context.resume();}}:undefined;
  const audio=new CollectionAudio({AudioContext:useTone?undefined:Context,Tone,audioSession,maxVoices,setInterval(fn){timer=fn;return 1;},clearInterval(){clears++;},setTimeout(fn){const token={fn};waits.add(token);return token;},clearTimeout(token){waits.delete(token);},onError:e=>errors.push(e),onStateChange:state=>states.push(state)});
  return {audio,errors,states,get now(){return now;},advance(seconds){now+=seconds;timer?.();},at(time){now=time;timer?.();},unblock(){unblock?.();},get clears(){return clears;},get resumeCalls(){return resumeCalls;},get toneStarts(){return toneStarts;},get pendingWaits(){return waits.size;},expire(){for(const token of [...waits])token.fn();},allowResume(){resumeMode='immediate';}};
}

test('unlock is gesture-bound and a released contact cannot sound after pending resume',async()=>{
  const f=fixture({suspended:true}),ready=f.audio.start();
  assert.ok(f.audio.context);assert.ok(f.audio.output);
  f.audio.noteOn('touch',60);f.audio.noteOff('touch');f.unblock();
  assert.equal(await ready,true);assert.deepEqual(f.audio.snapshot().voices,[]);
  await f.audio.dispose();assert.equal(f.clears,1);
});

test('dispose while resume is pending cannot restart synthesis or scheduling',async()=>{
  const f=fixture({suspended:true}),ready=f.audio.start();f.audio.noteOn('touch',60);await f.audio.dispose();f.unblock();
  assert.equal(await ready,false);assert.equal(f.audio.sources.size,0);assert.equal(f.audio.context.state,'closed');assert.equal(f.clears,1);
});

test('an activation-gated pointerdown cannot block a later eligible gesture from resuming',async()=>{
  const f=fixture({suspended:true,resumeMode:'gesture'}),first=f.audio.start();
  f.audio.noteOn('released-before-unlock',60);f.audio.noteOff('released-before-unlock');
  assert.equal(f.resumeCalls,1);assert.equal(f.audio.context.state,'suspended');
  const second=f.audio.start();assert.equal(f.resumeCalls,2,'resume must run synchronously again within the new gesture');
  assert.equal(await second,true);assert.equal(await first,true);assert.deepEqual(f.audio.snapshot().voices,[]);assert.equal(f.pendingWaits,0);
  await f.audio.start();assert.equal(f.resumeCalls,3,'running contexts still receive the gesture-bound platform start');await f.audio.dispose();
});

test('stalled activation has a bounded result and a subsequent gesture can recover',async()=>{
  const f=fixture({suspended:true,resumeMode:'stalled'}),pending=f.audio.start();assert.equal(f.pendingWaits,1);f.expire();
  assert.equal(await pending,false);assert.match(f.audio.lastError.message,/activation/);assert.equal(f.pendingWaits,0);
  f.allowResume();assert.equal(await f.audio.start(),true);assert.equal(f.audio.lastError,null);await f.audio.dispose();
});

test('production Tone platform uses its standardized context and retries its start for every gesture',async()=>{
  const f=fixture({useTone:true,suspended:true,resumeMode:'gesture'}),first=f.audio.start();
  assert.equal(f.toneStarts,1);const second=f.audio.start();assert.equal(f.toneStarts,2);assert.equal(await second,true);assert.equal(await first,true);
  f.audio.noteOn('tone-platform',69);f.advance(.1);assert.equal(f.audio.snapshot().voices[0].id,'tone-platform');await f.audio.dispose();
});

test('music requests playback session type where supported and restores only its own change',async()=>{
  const session={type:'auto'},f=fixture({audioSession:session});await f.audio.start();assert.equal(session.type,'playback');await f.audio.dispose();assert.equal(session.type,'auto');
  const recording={type:'play-and-record'},g=fixture({audioSession:recording});await g.audio.start();assert.equal(recording.type,'play-and-record');await g.audio.dispose();assert.equal(recording.type,'play-and-record');
  const blocked={get type(){return'auto';},set type(value){throw new Error('unsupported');}},h=fixture({audioSession:blocked});assert.equal(await h.audio.start(),true);await h.audio.dispose();
});

test('context interruption clears notes and reports state without automatically replaying them',async()=>{
  const f=fixture();await f.audio.start();f.audio.noteOn('held',60);f.audio.setPerformance({hold:true});f.audio.noteOff('held');
  f.audio.context.state='interrupted';f.audio.context.emit('statechange');assert.deepEqual(f.states,['interrupted']);assert.equal(f.audio.sources.size,0);assert.equal(f.audio.transport.playing,false);
  assert.equal(await f.audio.start(),true);assert.deepEqual(f.audio.snapshot().voices,[]);await f.audio.dispose();
});

test('audio-time envelopes exclude future notes and preserve release tails',async()=>{
  const f=fixture();await f.audio.start();
  f.audio.pulse('step',69,{attack:.1,decay:.1,sustain:.5,release:.2,gain:1},1.1,.4);
  assert.deepEqual(f.audio.snapshot().voices,[]);
  f.at(1.15);let v=f.audio.snapshot().voices[0];assert.equal(v.id,'step');assert.ok(Math.abs(v.level-.5)<1e-8);assert.equal(v.gate,true);
  f.at(1.4);v=f.audio.snapshot().voices[0];assert.equal(v.level,.5);
  f.at(1.6);v=f.audio.snapshot().voices[0];assert.equal(v.gate,false);assert.ok(Math.abs(v.level-.25)<1e-8);
  f.at(1.74);assert.deepEqual(f.audio.snapshot().voices,[]);await f.audio.dispose();
});

test('Hold releases latched contacts independently while physical contacts continue',async()=>{
  const f=fixture();await f.audio.start();f.audio.setPerformance({hold:true});
  f.audio.noteOn('a',60);f.audio.noteOn('b',64);f.advance(.25);f.audio.noteOff('a');
  assert.equal(f.audio.sources.size,2);assert.equal(f.audio.snapshot().voices.filter(v=>v.gate).length,2);
  f.audio.setPerformance({hold:false});assert.equal(f.audio.sources.has('a'),false);assert.equal(f.audio.sources.has('b'),true);
  const voices=f.audio.snapshot().voices;assert.equal(voices.find(v=>v.id==='a').gate,false);assert.equal(voices.find(v=>v.id==='b').gate,true);
  f.audio.noteOff('b');f.advance(1);assert.deepEqual(f.audio.snapshot().voices,[]);await f.audio.dispose();
});

test('arp works while the sequence is paused, follows source IDs, and Hold keeps its note pool',async()=>{
  const f=fixture();await f.audio.start();f.audio.setPerformance({arp:true,hold:true,bpm:120,arpRate:8});
  f.audio.noteOn('low',60,{release:.03});f.audio.noteOn('high',67,{release:.03});f.audio.noteOff('low');f.audio.noteOff('high');
  assert.equal(f.audio.transport.playing,false);f.at(1.02);assert.equal(f.audio.snapshot().voices.find(v=>v.gate)?.id,'low');
  f.at(1.23);f.at(1.27);assert.equal(f.audio.snapshot().voices.find(v=>v.gate)?.id,'high');
  f.audio.setPerformance({hold:false});assert.equal(f.audio.sources.size,0);f.advance(.5);assert.deepEqual(f.audio.snapshot().voices,[]);await f.audio.dispose();
});

test('turning arp off restores sustained physical notes and removes queued arp attacks',async()=>{
  const f=fixture();await f.audio.start();f.audio.setPerformance({arp:true,bpm:220,arpRate:32});f.audio.noteOn('a',60);f.audio.noteOn('b',64);
  assert.ok(f.audio._voices.some(v=>v.start>f.now));f.audio.setPerformance({arp:false});
  assert.equal(f.audio._voices.some(v=>v.kind==='arp'&&v.start>f.now),false);
  assert.equal(f.audio.snapshot().voices.filter(v=>v.kind==='direct'&&v.gate).length,2);
  f.audio.noteOff('a');f.audio.noteOff('b');f.advance(1);assert.deepEqual(f.audio.snapshot().voices,[]);await f.audio.dispose();
});

test('rapid source release cancels every future arp note, including adjacent queued voices',async()=>{
  const f=fixture();await f.audio.start();f.audio.setPerformance({arp:true,bpm:220,arpRate:32});f.audio.noteOn('a',60);
  assert.ok(f.audio._voices.filter(v=>v.id==='a'&&v.start>f.now).length>=2);
  f.audio.noteOff('a');assert.equal(f.audio._voices.filter(v=>v.id==='a').length,0);f.advance(.2);assert.deepEqual(f.audio.snapshot().voices,[]);await f.audio.dispose();
});

test('source reuse has a fresh envelope and updates only the corresponding live identity',async()=>{
  const f=fixture();await f.audio.start();f.audio.noteOn('a',60);f.audio.noteOn('b',67);f.advance(.25);
  f.audio.noteOff('a');f.audio.noteOn('a',72,{ratio:3,index:2});f.audio.noteUpdate('a',74,{pan:.7});f.advance(.03);
  const active=f.audio.snapshot().voices.filter(v=>v.gate);assert.equal(active.find(v=>v.id==='a').midi,74);assert.equal(active.find(v=>v.id==='b').midi,67);
  const current=f.audio._voices.find(v=>v.id==='a'&&v.releaseAt===null);assert.equal(current.modulation.gain.value,midiFrequency(74)*2);assert.equal(current.pan.pan.value,.7);await f.audio.dispose();
});

test('transport look-ahead schedules audio but visual step follows actual audio time',async()=>{
  const f=fixture();await f.audio.start();const scheduled=[];
  f.audio.setTransport({playing:true,bpm:120,onStep(step,when){scheduled.push({step,when});f.audio.pulse('seq-'+step,60+step,{release:.08},when,.04);}});
  assert.equal(scheduled[0].when,1.008);assert.deepEqual(f.audio.snapshot().voices,[]);
  f.at(1.08);assert.equal(scheduled.at(-1).step,1);assert.equal(f.audio.snapshot().step,0);
  f.at(1.14);assert.equal(f.audio.snapshot().step,1);
  f.audio.noteOn('held',48);f.audio.setTransport({playing:false});assert.equal(f.audio.snapshot().voices.find(v=>v.id==='held').gate,true);
  assert.equal(f.audio._voices.some(v=>v.kind==='sequence'&&v.start>f.now),false);f.advance(.8);assert.deepEqual(f.audio.snapshot().voices.map(v=>v.id),['held']);await f.audio.dispose();
});

test('clock interruption skips missed beats without scheduling a burst',async()=>{
  const f=fixture();await f.audio.start();const events=[];f.audio.setTransport({playing:true,bpm:112,onStep:(step,when)=>events.push({step,when})});
  const count=events.length;f.advance(20);assert.equal(events.length,count+1);assert.ok(events.at(-1).when>f.now);await f.audio.dispose();
});

test('configure changes live FM/filter/shape while preserving voice and contact provenance',async()=>{
  const f=fixture();await f.audio.start();f.audio.noteOn('held',57,{index:0});f.advance(.3);
  const before=f.audio._voices[0];f.audio.configure({ratio:3,index:2,cutoff:1800,resonance:5,waveform:'sawtooth',crush:.8});
  assert.strictEqual(f.audio._voices[0],before);assert.equal(before.carrier.type,'sawtooth');assert.equal(before.filter.frequency.value,1800);assert.equal(before.filter.Q.value,5);assert.equal(before.modulator.frequency.value,midiFrequency(57)*3);assert.equal(before.modulation.gain.value,midiFrequency(57)*2);assert.ok(before.shaper.curve instanceof Float32Array);
  f.audio.setPerformance({arp:true});f.advance(.02);assert.ok(f.audio._voices.some(v=>v.kind==='arp'&&v.options.index===2));await f.audio.dispose();
});

test('zero-crush voices physically bypass the optional waveshaper and reconnect safely when edited',async()=>{
  const f=fixture();await f.audio.start();f.audio.noteOn('plain',60,{crush:0});const v=f.audio._voices[0];
  assert.deepEqual(v.filter.connections,[v.amp]);assert.deepEqual(v.shaper.connections,[]);
  f.audio.configure({crush:.7});assert.deepEqual(v.filter.connections,[v.shaper]);assert.deepEqual(v.shaper.connections,[v.amp]);
  f.audio.configure({crush:0});assert.deepEqual(v.filter.connections,[v.amp]);assert.deepEqual(v.shaper.connections,[]);await f.audio.dispose();
});

test('replacing an instrument sound resets effects omitted by the incoming instrument',async()=>{
  const f=fixture();await f.audio.start();f.audio.configure({waveform:'square',crush:.9,echo:.5,feedback:.6,delayTime:.8,index:8,customOldField:123});
  f.audio.configure({waveform:'sine',index:1.2},{replace:true});f.audio.noteOn('new',60);
  const voice=f.audio._voices[0];assert.equal(voice.options.waveform,'sine');assert.equal(voice.options.index,1.2);assert.equal(voice.options.crush,0);assert.equal(voice.shaper.curve,null);
  assert.equal(f.audio.sound.echo,.08);assert.equal(f.audio.sound.feedback,.18);assert.equal(f.audio.sound.delayTime,.23);assert.equal(f.audio.sound.customOldField,undefined);
  assert.equal(f.audio._wet.gain.value,.08);assert.equal(f.audio._feedback.gain.value,.18);assert.equal(f.audio._delay.delayTime.value,.23);
  f.audio.configure({ratio:3});assert.equal(f.audio.sound.index,1.2);assert.equal(voice.options.ratio,3);await f.audio.dispose();
});

test('voice allocation is bounded and stolen oscillators disconnect',async()=>{
  const f=fixture({maxVoices:4});await f.audio.start();const original=f.audio.pulse('old',60,{release:4},1,.1);f.advance(.2);
  for(let i=0;i<12;i++)f.audio.noteOn('touch-'+i,60+i);
  assert.equal(f.audio._voices.length,4);assert.equal(original.disposed,true);assert.ok(original.nodes.every(n=>n.disconnected));
  f.audio.panic();assert.equal(f.audio.sources.size,0);assert.deepEqual(f.audio.snapshot().voices,[]);assert.equal(f.audio.output.gain.value,0);
  f.audio.noteOn('new',60);assert.equal(f.audio.output.gain.value,1);await f.audio.dispose();
});

test('repeated Hold touches with new pointer IDs keep the latched note pool bounded',async()=>{
  const f=fixture({maxVoices:4});await f.audio.start();f.audio.setPerformance({hold:true});
  f.audio.noteOn('physical',48);
  for(let i=0;i<30;i++){f.audio.noteOn('touch-'+i,60+i%12);f.audio.noteOff('touch-'+i);f.advance(.03);}
  assert.equal(f.audio.sources.size,4);assert.equal(f.audio.sources.has('physical'),true);assert.equal(f.audio.sources.has('touch-0'),false);assert.equal(f.audio.sources.has('touch-29'),true);
  f.audio.setPerformance({hold:false});assert.deepEqual([...f.audio.sources.keys()],['physical']);await f.audio.dispose();
});

test('meter reads actual post-master output, including external engines, independently of voice count',async()=>{
  const f=fixture();await f.audio.start();f.audio._analyser.sample=.125;f.audio._analyser.spectral=128;
  let snapshot=f.audio.snapshot();assert.equal(snapshot.voices.length,0);assert.equal(snapshot.rms,.125);assert.ok(Math.abs(snapshot.frequency[10]-128/255)<1e-7);
  f.audio.noteOn('a',60);f.audio._analyser.sample=0;snapshot=f.audio.snapshot();assert.equal(snapshot.rms,0);
  assert.ok(f.audio.output.connections.includes(f.audio._compressor));assert.ok(f.audio._master.connections.includes(f.audio._analyser));assert.ok(f.audio._master.connections.includes(f.audio.context.destination));assert.deepEqual(f.audio._analyser.connections,[],'the analyser is never in the speaker path');await f.audio.dispose();
});
