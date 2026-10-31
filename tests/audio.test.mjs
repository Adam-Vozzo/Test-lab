import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = await readFile(new URL('../audio.js', import.meta.url), 'utf8');
const { AudioEngine, degreeToMidi, makeArpeggio } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fixture({ suspended = false, strictStarts = false } = {}) {
  let now = 1;
  let resume;
  const unlock = suspended ? new Promise(resolve => { resume = resolve; }) : Promise.resolve();
  class Param {
    constructor(value = 0) { this.value = value; this.ramps = []; }
    rampTo(value, duration, time) { this.value = value; this.ramps.push({ value, duration, time }); }
    setValueAtTime(value, time) { this.value = value; this.ramps.push({ value, time }); }
    cancelScheduledValues(time) { this.cancelledAt = time; }
  }
  class Node {
    constructor(options) {
      this.options = options; this.addend = new Param(typeof options === 'number' ? options : 0);
      this.frequency = new Param(); this.Q = new Param(); this.wet = new Param();
      this.feedback = new Param(); this.delayTime = new Param(); this.gain = new Param();
      this.detune = new Param(); this.attackCalls = []; this.releaseCalls = []; this.settings = [];
    }
    chain(...nodes) { this.chainNodes = nodes; } connect(node) { this.destination = node; (this.connections ||= []).push(node); } toDestination() {}
    start(time) { this.startTime = time; } dispose() { this.disposed = true; }
    set(options) { this.settings.push(options); }
    triggerAttack(...args) {
      if (strictStarts) {
        const actualTime = Math.max(args[1], now);
        assert.ok(actualTime > (this.lastSourceStart ?? -Infinity), 'Start time must be strictly greater than previous start time');
        this.lastSourceStart = actualTime;
      }
      this.attackCalls.push(args);
    }
    triggerRelease(...args) { this.releaseCalls.push(args); }
    getValue() { return .1; }
  }
  const events = new Map();
  const transport = { state: 'stopped', bpm: new Param(),
    scheduleRepeat(callback, interval) { const id = Symbol(interval); events.set(id, { callback, interval }); return id; },
    clear(id) { events.delete(id); }, start() { this.state = 'started'; }, stop() { this.state = 'stopped'; },
  };
  const rawContext = { get currentTime() { return now; }, state: 'running', addEventListener() {}, removeEventListener() {} };
  const context = { rawContext };
  const draws = [];
  globalThis.Tone = {
    start: () => unlock, now: () => now, getTransport: () => transport, getContext: () => context,
    getDraw: () => ({ schedule: callback => draws.push(callback) }),
    Filter: Node, FeedbackDelay: Node, Reverb: Node, Compressor: Node, Limiter: Node,
    Gain: Node, Meter: Node, Waveform: Node, Synth: Node, LFO: Node, Add: Node,
  };
  const state = {
    sound: { volume: .65, waveform: 'triangle', detune: 8, attack: .04, decay: .35, sustain: .55, release: 1.4, cutoff: 2400, resonance: 1.8, delay: .22, feedback: .25, reverb: .22 },
    sequence: { bpm: 112, swing: .1, root: 50, scale: 'dorian', length: 3,
      steps: [{ note: 0, active: true, velocity: .7 }, { note: 2, active: false }, { note: 4, active: true, velocity: .5 }],
      arp: false, arpRate: 8, arpDirection: 'up' },
  };
  const seen = { steps: [], notes: [] };
  const engine = new AudioEngine(() => state, { onStep: i => seen.steps.push(i), onNote: (...args) => seen.notes.push(args) });
  return { engine, state, seen, context, transport, events, draws, resume,
    advance: (amount = .1) => { now += amount; },
    flush: () => { while (draws.length) draws.shift()(); },
    attacks: () => engine.voices.reduce((sum, v) => sum + v.synth.attackCalls.length, 0),
  };
}

test('scale degrees wrap correctly in both directions and arps stay in the chosen scale', () => {
  assert.equal(degreeToMidi(0, 50, 'dorian'), 50);
  assert.equal(degreeToMidi(7, 50, 'dorian'), 62);
  assert.equal(degreeToMidi(-1, 50, 'dorian'), 48);
  assert.equal(degreeToMidi(-7, 50, 'dorian'), 38);
  assert.deepEqual(makeArpeggio([50], 50, 'dorian'), [50, 53, 57, 62]);
  assert.deepEqual(makeArpeggio([62, 50, 50], 50, 'dorian'), [50, 62]);
});

test('a pointer released while audio is unlocking cannot become a stuck voice', async () => {
  const f = fixture({ suspended: true });
  const pending = f.engine.noteOn('touch', 62);
  f.engine.noteOff('touch');
  f.resume();
  assert.equal(await pending, false);
  assert.equal(f.engine.live.size, 0);
  assert.equal(f.attacks(), 0);
  f.engine.dispose();
});

test('stop cancels an in-flight asynchronous start', async () => {
  const f = fixture({ suspended: true });
  const pending = f.engine.start();
  f.engine.stop();
  f.resume();
  assert.equal(await pending, false);
  assert.equal(f.engine.running, false);
  assert.equal(f.transport.state, 'stopped');
  f.engine.dispose();
});

test('immediate pointer cancellation cannot release before the queued attack', async () => {
  const f = fixture();
  await f.engine.noteOn('tap', 62);
  const voice = f.engine.live.get('tap').voice;
  const attackTime = voice.synth.attackCalls.at(-1)[1];
  f.engine.noteOff('tap');
  assert.ok(voice.synth.releaseCalls.at(-1)[0] > attackTime);
  assert.equal(f.engine.live.size, 0);
  f.engine.dispose();
});

test('sequence advances through rests and wraps the selected length on the audio clock', async () => {
  const f = fixture();
  await f.engine.start();
  const tick = f.events.get(f.engine.sequenceId).callback;
  [1, 1.14, 1.28, 1.42].forEach(tick);
  f.flush();
  assert.deepEqual(f.seen.steps, [0, 1, 2, 0]);
  assert.deepEqual(f.seen.notes.map(n => n[0]), [50, 57, 50]);
  f.state.sequence.bpm = 160;
  f.state.sound.feedback = 20;
  f.engine.update();
  assert.equal(f.transport.bpm.value, 160);
  assert.equal(f.engine.delay.feedback.value, .72);
  assert.equal(f.context.lookAhead, .025);
  f.engine.dispose();
});

test('sequencer cannot steal eight held voices; a ninth live touch remains bounded', async () => {
  const f = fixture();
  await f.engine.init();
  for (let i = 0; i < 8; i++) { await f.engine.noteOn(i, 50 + i); f.advance(); }
  assert.equal(f.attacks(), 8);
  f.engine._soundNote(70, .5, 3, .1, 'sequence');
  assert.equal(f.attacks(), 8);
  await f.engine.noteOn(9, 72);
  assert.equal(f.attacks(), 9);
  assert.equal(f.engine.voices.length, 8);
  assert.equal(f.engine.live.get(0).voice, null);
  f.engine.noteOff(0);
  assert.equal(f.engine.voices.filter(v => v.source === 'live').length, 8);
  f.engine.dispose();
});

test('arpeggio scheduling is independent from the sequence and releases on stop', async () => {
  const f = fixture();
  f.state.sequence.arp = true;
  await f.engine.noteOn('held', 50);
  assert.equal(f.engine.running, false);
  assert.equal(f.transport.state, 'started');
  const tick = f.events.get(f.engine.arpId).callback;
  [1, 1.3, 1.6, 1.9].forEach(tick);
  f.flush();
  assert.deepEqual(f.seen.notes.map(n => n[0]), [50, 53, 57, 62]);
  await f.engine.start();
  const sequenceTick = f.events.get(f.engine.sequenceId).callback;
  sequenceTick(2);
  f.engine.stop();
  f.flush();
  assert.deepEqual(f.seen.steps, [-1]);
  assert.equal(f.engine.live.size, 0);
  assert.equal(f.transport.state, 'stopped');
  assert.equal(f.engine.master.gain.value, 0);
  f.engine.dispose();
});

test('visual notes carry their exact sequence step and stable voice slot only after onset', async () => {
  const f = fixture();
  await f.engine.start();
  f.events.get(f.engine.sequenceId).callback(1);
  assert.equal(f.engine.getVisualState().voices.length, 8);
  assert.equal(f.engine.getVisualState().voices[0].envelope, 0);
  assert.equal(f.engine.getVisualState().voices[0].midi, null);
  f.advance(.023);
  const voice = f.engine.getVisualState().voices[0];
  assert.equal(voice.index, 0);
  assert.equal(voice.source, 'sequence');
  assert.equal(voice.step, 0);
  assert.equal(voice.midi, 50);
  assert.ok(Math.abs(voice.envelope - .5) < .0001);
  f.flush();
  assert.deepEqual(f.seen.notes[0][2], { index: 0, source: 'sequence', step: 0, time: 1.003, duration: 60 / 112 / 4 * .68 });
  f.engine.dispose();
});

test('released visual envelopes decay with their original source and panic clears all activity', async () => {
  const f = fixture();
  await f.engine.noteOn('held', 62, .7);
  f.advance(.6);
  let voice = f.engine.getVisualState().voices[0];
  assert.equal(voice.envelope, .55);
  f.engine.noteOff('held');
  assert.equal(f.engine.getVisualState().voices[0].source, 'live');
  f.advance(.2);
  voice = f.engine.getVisualState().voices[0];
  assert.ok(voice.envelope > 0 && voice.envelope < .55);
  assert.equal(voice.gateEnd, 1.6);
  f.advance(1.3);
  assert.equal(f.engine.getVisualState().voices[0].envelope, 0);
  await f.engine.noteOn('second', 65);
  f.advance(.05);
  assert.ok(f.engine.getVisualState().voices.some(v => v.envelope > 0));
  f.engine.stop();
  assert.ok(f.engine.getVisualState().voices.every(v => v.envelope === 0));
  assert.equal(f.engine.getVisualState().level, 0);
  f.engine.dispose();
});

test('visual state queries the real Tone envelope at audible time instead of look-ahead time', async () => {
  const f = fixture();
  globalThis.Tone.now = () => f.context.rawContext.currentTime + .025;
  await f.engine.noteOn('touch', 60, .7);
  assert.equal(f.engine.getVisualState().voices[0].envelope, 0);
  let queryTime;
  f.engine.voices[0].synth.envelope = { getValueAtTime(time) { queryTime = time; return .21; } };
  f.advance(.1);
  const visual = f.engine.getVisualState();
  assert.equal(queryTime, f.context.rawContext.currentTime);
  assert.equal(visual.time, queryTime);
  assert.ok(Math.abs(visual.voices[0].envelope - .3) < .000001);
  f.engine.dispose();
});

test('a future stolen slot retains the previous audible note until its replacement starts', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) await f.engine.noteOn(i, 50 + i);
  f.advance(.2);
  f.engine._soundNote(72, .8, 2, Infinity, 'live', 'new');
  let first = f.engine.getVisualState().voices[0];
  assert.equal(first.midi, 50);
  assert.ok(first.envelope > 0);
  f.advance(.81);
  first = f.engine.getVisualState().voices[0];
  assert.equal(first.midi, 72);
  assert.ok(first.envelope > 0);
  f.flush();
  assert.equal(f.seen.notes.filter(note => note[2].index === 0).length, 1, 'a stale callback cannot light an overwritten slot');
  f.engine.dispose();
});

test('green phase state follows the real LFO signal and rate changes remain phase-continuous', async () => {
  const f = fixture();
  await f.engine.init();
  assert.equal(f.engine.filterLFO.destination, f.engine.filterDepth);
  assert.equal(f.engine.filterDepth.destination, f.engine.filterBase);
  assert.equal(f.engine.filterBase.destination, f.engine.filter.frequency);
  assert.equal(f.engine.filterLFO.startTime, 1);
  assert.equal(f.engine.filterDepth.gain.value, 2400 * .85 * .08);
  f.advance(1 / (.35 * 4));
  let visual = f.engine.getVisualState();
  assert.ok(Math.abs(visual.lfoPhase - .25) < .000001);
  assert.ok(Math.abs(visual.cutoff - (2400 + 2400 * .85 * .08)) < .000001);
  const phase = visual.lfoPhase;
  f.state.sound.lfoRate = .7;
  f.engine.update();
  assert.ok(Math.abs(f.engine.getVisualState().lfoPhase - phase) < .000001);
  f.advance(.5);
  assert.ok(Math.abs(f.engine.getVisualState().lfoPhase - .6) < .000001);
  f.engine.dispose();
});

test('LFO modulation bounds and base frequency use matched smooth automation', async () => {
  const f = fixture();
  await f.engine.init();
  f.state.sound.cutoff = 100;
  f.state.sound.lfoDepth = 1;
  f.engine.update();
  assert.equal(f.engine.filterDepth.gain.value, 80);
  const base = f.engine.filterBase.addend.ramps.at(-1), depth = f.engine.filterDepth.gain.ramps.at(-1);
  assert.equal(base.time, depth.time);
  assert.equal(base.duration, depth.duration);
  assert.equal(f.engine.filter.frequency.ramps.length, 0, 'only the additive control signal drives cutoff');
  f.state.sound.cutoff = 20000; f.engine.update();
  assert.equal(f.engine.filterDepth.gain.value, 0);
  f.state.sound.cutoff = 20; f.engine.update();
  assert.equal(f.engine.filterDepth.gain.value, 0);
  assert.equal(f.engine.getVisualState().cutoff, 20);
  f.engine.dispose();
});


test('a stalled transport discards expired notes without replay bursts or losing sequence phase', async () => {
  const f = fixture({ strictStarts: true });
  await f.engine.start();
  // One pooled voice makes the repeated clamped Tone.Source start regression
  // deterministic; the same condition occurs after eight real pooled voices.
  f.engine.voices = f.engine.voices.slice(0, 1);
  const tick = f.events.get(f.engine.sequenceId).callback;
  tick(1); f.flush();
  f.advance(2);
  for (const expiredTime of [1.14, 1.28, 1.42, 1.56]) tick(expiredTime);
  assert.equal(f.attacks(), 1, 'expired beats do not burst at the resumed currentTime');
  assert.equal(f.engine.stepIndex, 5, 'rests and expired beats still advance the musical position');
  tick(3); f.flush();
  assert.equal(f.attacks(), 2);
  assert.deepEqual(f.seen.steps, [0, 2]);
  assert.equal(f.engine.voices[0].visual.step, 2);
  assert.equal(f.engine.voices[0].visual.started, 3.003);
  f.engine.dispose();
});

test('same-quantum live retriggers use strictly increasing voice attack times', async () => {
  const f = fixture({ strictStarts: true });
  await f.engine.init(); f.engine.voices = f.engine.voices.slice(0, 1);
  for (let i = 0; i < 12; i++) f.engine._soundNote(50 + i, .7, 1, Infinity, 'live', 'touch-' + i);
  const voice = f.engine.voices[0], attacks = voice.synth.attackCalls.map(args => args[1]);
  assert.equal(attacks.length, 12);
  attacks.slice(1).forEach((time, i) => assert.ok(time > attacks[i]));
  assert.equal(voice.visual.started, attacks.at(-1));
  f.engine.allNotesOff();
  assert.ok(voice.synth.releaseCalls.at(-1)[0] > attacks.at(-1));
  f.engine.dispose();
});

test('a near-late note shifts its gate and visual onset onto the same safe audible timeline', async () => {
  const f = fixture({ strictStarts: true });
  await f.engine.init(); f.engine.voices = f.engine.voices.slice(0, 1);
  f.engine._soundNote(50, .7, 1, .1, 'sequence');
  f.advance(.01);
  const voice = f.engine._soundNote(55, .7, 1, .1, 'sequence', null, { step: 2 });
  const onset = voice.synth.attackCalls.at(-1)[1], gate = voice.synth.releaseCalls.at(-1)[0];
  assert.ok(onset > f.context.rawContext.currentTime);
  assert.equal(voice.visual.started, onset);
  assert.equal(voice.visual.gateEnd, gate);
  assert.ok(Math.abs((gate - onset) - .097) < 1e-9, 'note duration survives the safety shift');
  f.flush(); assert.equal(f.seen.notes.at(-1)[2].time, onset);
  f.engine.dispose();
});


test('visual output RMS uses post-master samples, independent of legacy meter smoothing and saturation', async () => {
  const f=fixture();await f.engine.noteOn('meter',60);
  assert.ok(f.engine.master.connections.includes(f.engine.waveform));
  let rms=.3;f.engine.waveform.getValue=()=>new Float64Array([rms,-rms,rms,-rms]);f.engine.meter.getValue=()=>.8;
  const a=f.engine.getVisualState();assert.equal(a.outputLevel,.3);assert.equal(a.level,1);
  rms=.8;const b=f.engine.getVisualState();assert.equal(b.outputLevel,.8);assert.equal(b.level,1);
  rms=.02;assert.equal(f.engine.getOutputLevel(),.02);assert.equal(f.engine.getLevel(),1);
  rms=0;assert.equal(f.engine.getVisualState().outputLevel,0);assert.equal(f.engine.getVisualState().level,1);
  rms=NaN;assert.equal(f.engine.getOutputLevel(),0);
  rms=.5;f.engine.stop();assert.equal(f.engine.getVisualState().outputLevel,0);assert.equal(f.engine.getLevel(),0);
  f.engine.dispose();
});

test('every generated single-root arp pulse keeps its originating touch without owning the audio slot', async () => {
  const f=fixture();f.state.sequence.arp=true;await f.engine.noteOn('pointer-17',50);
  const entry=f.engine.live.get('pointer-17'),seen=[];assert.equal(entry.voice,null);
  f.advance(.01);
  for(let i=0;i<8;i++){
    if(i){f.advance(.3);f.engine._tickArp(f.context.rawContext.currentTime);f.advance(.01);}
    const voice=f.engine.getVisualState().voices.toSorted((a,b)=>b.started-a.started)[0];
    assert.equal(voice.source,'arp');assert.equal(voice.originId,'pointer-17');assert.equal(voice.pointerId,17);
    assert.equal(voice.originTime,entry.originTime);assert.ok(voice.generation>0);seen.push(voice.midi);
    assert.ok(f.engine.voices.every(v=>v.owner===null),'arp provenance must not reserve a held synth voice');
  }
  assert.deepEqual(seen,[50,53,57,62,50,53,57,62]);
  f.engine.noteOff('pointer-17');const attacks=f.attacks();f.advance(.3);f.engine._tickArp(f.context.rawContext.currentTime);assert.equal(f.attacks(),attacks);
  assert.ok(f.engine.getVisualState().voices.some(v=>v.envelope>0&&v.pointerId===17),'release tails retain their original touch');
  f.engine.stop();assert.ok(f.engine.getVisualState().voices.every(v=>v.envelope===0));f.engine.dispose();
});

test('polyphonic arp pitches retain the matching held touch in every direction and keyboard notes have no pointer', async () => {
  const f=fixture();f.state.sequence.arp=true;
  for(const [id,midi]of [['pointer-11',50],['key-g',57],['pointer-22',62]]){await f.engine.noteOn(id,midi);f.advance(.2);}
  const byPitch=new Map([[50,['pointer-11',11]],[57,['key-g',null]],[62,['pointer-22',22]]]);
  for(const direction of ['up','down','updown','random']){
    f.state.sequence.arpDirection=direction;
    for(let i=0;i<9;i++){
      f.advance(.3);f.engine._tickArp(f.context.rawContext.currentTime);f.advance(.01);
      const voice=f.engine.getVisualState().voices.toSorted((a,b)=>b.started-a.started)[0],origin=byPitch.get(voice.midi);
      assert.ok(origin);assert.equal(voice.originId,origin[0]);assert.equal(voice.pointerId,origin[1]);
      assert.equal(voice.originTime,f.engine.live.get(origin[0]).originTime);
    }
  }
  f.engine.dispose();
});

test('duplicate arp roots share generated chords while each source can light its own contact', async () => {
  const f=fixture();f.state.sequence.arp=true;await f.engine.noteOn('pointer-3',50);f.advance(.2);await f.engine.noteOn('pointer-4',50);
  const sources=new Set(),notes=[];
  for(let i=0;i<8;i++){
    f.advance(.3);f.engine._tickArp(f.context.rawContext.currentTime);f.advance(.01);
    const voice=f.engine.getVisualState().voices.toSorted((a,b)=>b.started-a.started)[0];sources.add(voice.pointerId);notes.push(voice.midi);
  }
  assert.deepEqual([...sources].sort(),[3,4]);assert.ok(notes.every(midi=>[50,53,57,62].includes(midi)));f.engine.dispose();
});

test('touch provenance follows audible snapshots across queued replacement and pointer reuse', async () => {
  const f=fixture();await f.engine.init();f.engine.voices=f.engine.voices.slice(0,1);
  f.engine._soundNote(50,.7,1,.2,'arp',null,{originId:'pointer-9',originTime:10});f.advance(.1);
  const first=f.engine.getVisualState().voices[0];assert.equal(first.pointerId,9);assert.equal(first.originTime,10);
  f.engine._soundNote(62,.7,2,.2,'arp',null,{originId:'pointer-9',originTime:20});
  const queued=f.engine.getVisualState().voices[0];assert.equal(queued.originTime,10);assert.equal(queued.generation,first.generation);
  f.advance(.91);const next=f.engine.getVisualState().voices[0];assert.equal(next.originTime,20);assert.equal(next.pointerId,9);assert.ok(next.generation>first.generation);
  f.engine._soundNote(57,.7,2.02,.2,'sequence',null,{step:2});f.advance(.02);
  const sequence=f.engine.getVisualState().voices[0];assert.equal(sequence.source,'sequence');assert.equal(sequence.originId,null);assert.equal(sequence.pointerId,null);assert.equal(sequence.originTime,null);
  f.engine.dispose();
});

test('arp toggles preserve the held gesture timestamp and cancellation does not invent another source', async () => {
  const f=fixture();await f.engine.noteOn('pointer-5',62);const originTime=f.engine.live.get('pointer-5').originTime;
  f.advance(.2);f.state.sequence.arp=true;f.engine.update();f.engine._tickArp(f.context.rawContext.currentTime);f.advance(.01);
  let voice=f.engine.getVisualState().voices.toSorted((a,b)=>b.started-a.started)[0];assert.equal(voice.source,'arp');assert.equal(voice.originTime,originTime);assert.equal(voice.pointerId,5);
  f.advance(.2);f.state.sequence.arp=false;f.engine.update();f.advance(.01);
  voice=f.engine.getVisualState().voices.toSorted((a,b)=>b.started-a.started)[0];assert.equal(voice.source,'live');assert.equal(voice.originTime,originTime);assert.equal(voice.pointerId,5);
  f.engine.noteOff('pointer-5');f.advance(.1);assert.ok(f.engine.getVisualState().voices.filter(v=>v.envelope>0).every(v=>v.pointerId===5&&v.originTime===originTime));
  f.engine.stop();assert.equal(f.engine.live.size,0);assert.ok(f.engine.getVisualState().voices.every(v=>v.envelope===0));f.engine.dispose();
});

test('pausing the sequencer preserves latched arp entries and their independent transport', async () => {
  const f=fixture();f.state.sequence.arp=true;await f.engine.noteOn('pointer-7',62);await f.engine.start();
  const sequenceId=f.engine.sequenceId,arpId=f.engine.arpId,entry=f.engine.live.get('pointer-7');
  f.advance(.3);f.events.get(sequenceId).callback(f.context.rawContext.currentTime);f.advance(.01);
  f.engine.stopSequence();assert.equal(f.engine.running,false);assert.equal(f.engine.sequenceId,null);assert.equal(f.events.has(sequenceId),false);
  assert.equal(f.engine.live.get('pointer-7'),entry);assert.equal(f.engine.transport.state,'started');assert.equal(f.events.has(arpId),true);assert.equal(f.engine._silenced,false);
  const attacks=f.attacks();f.advance(.3);f.events.get(arpId).callback(f.context.rawContext.currentTime);f.advance(.01);assert.equal(f.attacks(),attacks+1);
  const newest=f.engine.getVisualState().voices.toSorted((a,b)=>b.started-a.started)[0];assert.equal(newest.source,'arp');assert.equal(newest.pointerId,7);assert.ok(newest.envelope>0);
  assert.ok(f.engine.voices.filter(v=>v.visual?.source==='sequence').every(v=>Number.isFinite(v.visual.gateEnd)));
  await f.engine.start();assert.equal(f.engine.live.get('pointer-7'),entry);assert.equal(f.engine.running,true);
  f.engine.stop();assert.equal(f.engine.live.size,0);assert.equal(f.engine.transport.state,'stopped');assert.equal(f.engine._silenced,true);f.engine.dispose();
});

test('pausing a sequence keeps a physically held manual voice while ending sequence voices', async () => {
  const f=fixture();await f.engine.noteOn('key-a',50);await f.engine.start();const held=f.engine.live.get('key-a').voice;
  f.advance(.25);f.events.get(f.engine.sequenceId).callback(f.context.rawContext.currentTime);f.advance(.01);
  const releases=held.synth.releaseCalls.length;f.engine.stopSequence();
  assert.equal(f.engine.live.get('key-a').voice,held);assert.equal(held.synth.releaseCalls.length,releases);assert.equal(held.releaseAt,Infinity);assert.equal(f.engine.transport.state,'stopped');assert.equal(f.engine._silenced,false);
  f.advance(.3);const visual=f.engine.getVisualState().voices.find(v=>v.index===held.index);assert.equal(visual.source,'live');assert.ok(visual.envelope>.5);
  const attacks=f.attacks();f.engine._tickSequence(f.context.rawContext.currentTime);assert.equal(f.attacks(),attacks);f.engine.noteOff('key-a');assert.equal(f.engine.live.size,0);f.engine.dispose();
});

test('pausing the sequence cancels an audio unlock still in progress', async () => {
  const f=fixture({suspended:true});const pending=f.engine.start();f.engine.stopSequence();f.resume();
  assert.equal(await pending,false);assert.equal(f.engine.running,false);assert.equal(f.engine.sequenceId,null);assert.equal(f.engine.transport.state,'stopped');f.engine.dispose();
});
