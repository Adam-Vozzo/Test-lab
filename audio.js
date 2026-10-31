// DUO's audio clock and synthesis are independent of the graphics frame rate.
export const SCALES = Object.freeze({
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  pentatonic: [0, 3, 5, 7, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
});

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function degreeToMidi(degree, root = 50, scale = 'dorian') {
  const notes = SCALES[String(scale).toLowerCase()] || SCALES.dorian;
  const d = Math.round(clamp(degree, -70, 70, 0));
  const octave = Math.floor(d / notes.length);
  return clamp(Math.round(Number(root) || 50) + octave * 12 + notes[((d % notes.length) + notes.length) % notes.length], 12, 115, 50);
}

export const scaleToMidi = degreeToMidi;
export const midiToFrequency = (midi) => 440 * 2 ** ((clamp(midi, 12, 115, 60) - 69) / 12);

export function makeArpeggio(heldNotes, root = 50, scale = 'dorian') {
  const held = [...new Set(heldNotes.map(n => Math.round(clamp(n, 12, 103, 50))))].sort((a, b) => a - b);
  if (held.length !== 1) return held;
  let degree = 0;
  let distance = Infinity;
  for (let i = -28; i < 35; i++) {
    const difference = Math.abs(degreeToMidi(i, root, scale) - held[0]);
    if (difference < distance) { degree = i; distance = difference; }
  }
  return [0, 2, 4, 7].map(offset => degreeToMidi(degree + offset, root, scale));
}

export class AudioEngine {
  constructor(getState, callbacks = {}) {
    this.getState = typeof getState === 'function' ? getState : () => ({});
    this.callbacks = callbacks;
    this.live = new Map();
    this.voices = [];
    this.nodes = [];
    this.running = false;
    this.disposed = false;
    this.sequenceId = null;
    this.arpId = null;
    this.stepIndex = 0;
    this.arpIndex = 0;
    this._arpLastOnset = -Infinity;
    this.epoch = 0;
    this._startRequest = 0;
    this._silenced = true;
    this._last = {};
    this._emptyWaveform = new Float32Array(128);
    this._lfoSegments = [];
    this._lfoRate = .35;
  }

  _emit(name, ...args) {
    try { this.callbacks[name]?.(...args); } catch (error) { console.warn('DUO audio callback:', error); }
  }

  async init() {
    if (this.disposed) throw new Error('Audio engine is closed.');
    const Tone = this.Tone || globalThis.Tone;
    if (!Tone) throw new Error('The sound engine has not loaded.');
    this.Tone = Tone;
    // Invoke resume in the original user gesture, before any other await.
    const resume = Tone.start();
    if (!this._initPromise) {
      this._initPromise = (async () => {
        await resume;
        if (this.disposed) return false;
        this._build();
        this.update();
        return true;
      })().catch(error => { this._initPromise = null; this._emit('onState', 'error', error.message); throw error; });
    }
    await resume;
    const ready = await this._initPromise;
    if (ready) this._emit('onState', 'running');
    return ready;
  }

  _build() {
    const T = this.Tone;
    // Tone defaults to a generous 100 ms look-ahead; direct playing needs less.
    const context = T.getContext();
    context.lookAhead = .025;
    context.updateInterval = .012;
    const own = node => { this.nodes.push(node); return node; };
    this.transport = T.getTransport();
    this.transport.swingSubdivision = '16n';
    this.filter = own(new T.Filter({ type: 'lowpass', rolloff: -24, frequency: 2400, Q: 1.8 }));
    // The filter's frequency is one audio-rate signal: base + bipolar LFO depth.
    // Never write filter.frequency after connecting this chain: Signal.connect
    // intentionally clears the destination's intrinsic value.
    this.filterBase = own(new T.Add(2400));
    this.filterDepth = own(new T.Gain(0));
    this.filterLFO = own(new T.LFO({ frequency: .35, min: -1, max: 1, type: 'sine', phase: 0 }));
    this.filterLFO.connect(this.filterDepth);
    this.filterDepth.connect(this.filterBase);
    this.filterBase.connect(this.filter.frequency);
    const lfoStart = T.now();
    this._lfoSegments = [{ time: lfoStart, phase: 0, rate: .35 }];
    this.filterLFO.start(lfoStart);
    this.delay = own(new T.FeedbackDelay({ delayTime: .27, maxDelay: 2, feedback: .25, wet: .16 }));
    this.reverb = own(new T.Reverb({ decay: 2.8, preDelay: .025, wet: .2 }));
    this.compressor = own(new T.Compressor({ threshold: -18, ratio: 3, attack: .008, release: .16, knee: 18 }));
    this.limiter = own(new T.Limiter(-2));
    this.master = own(new T.Gain(0));
    this.meter = own(new T.Meter({ normalRange: true, smoothing: .82 }));
    this.waveform = own(new T.Waveform(128));
    this.filter.chain(this.delay, this.reverb, this.compressor, this.limiter, this.master);
    this.master.toDestination();
    this.master.connect(this.meter);
    this.master.connect(this.waveform);
    for (let i = 0; i < 8; i++) {
      const synth = own(new T.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: .04, decay: .35, sustain: .55, release: 1.4 },
        volume: -15,
        portamento: .018,
      }));
      synth.connect(this.filter);
      this.voices.push({ index: i, synth, owner: null, source: null, started: -1, lastAttackTime: -Infinity, releaseAt: -1, visual: null, previousVisual: null, generation: 0 });
    }
    this._context = context.rawContext;
    this._contextListener = () => {
      const state = this._context.state;
      if (state !== 'running') {
        this.stop();
        this._emit('onState', state === 'closed' ? 'closed' : 'suspended');
      } else this._emit('onState', 'running');
    };
    this._context.addEventListener?.('statechange', this._contextListener);
    this.ready = true;
  }

  _draw(callback, time, epoch = this.epoch) {
    const deliver = () => { if (!this.disposed && this.epoch === epoch) callback(); };
    const draw = this.Tone?.getDraw?.() || this.Tone?.Draw;
    if (draw?.schedule) draw.schedule(deliver, time); else deliver();
  }

  _wakeOutput() {
    if (!this.ready) return;
    if (this._silenced) {
      this._silenced = false;
      const volume = clamp(this.getState().sound?.volume, 0, 1, .65);
      this.master.gain.rampTo(volume ** 1.5 * .8, .025);
    }
  }

  _chooseVoice(source, time) {
    let voice = this.voices.find(v => !v.owner && v.releaseAt <= time);
    if (!voice) voice = this.voices.filter(v => v.source !== 'live').sort((a, b) => a.releaseAt - b.releaseAt)[0];
    // A sequencer must never steal a finger-held note.
    if (!voice && source !== 'live') return null;
    if (!voice) voice = [...this.voices].sort((a, b) => a.started - b.started)[0];
    if (voice.owner !== null && voice.source === 'live') {
      const former = this.live.get(voice.owner);
      if (former) former.voice = null;
    }
    return voice;
  }

  _envelopeSettings() {
    const sound = this.getState().sound || {};
    return {
      attack: clamp(sound.attack, .005, 4, .04), decay: clamp(sound.decay, .01, 5, .35),
      sustain: clamp(sound.sustain, 0, 1, .55), release: clamp(sound.release, .03, 8, 1.4),
    };
  }

  _envelopeEstimate(visual, time) {
    if (!visual || time < visual.started) return 0;
    const { attack, decay, sustain, release } = visual.adsr;
    const held = at => {
      const age = Math.max(0, at - visual.started);
      if (age < attack) return age / attack;
      if (age < attack + decay) return sustain + (1 - sustain) * Math.exp(-5 * (age - attack) / decay);
      return sustain;
    };
    if (time < visual.gateEnd) return held(time);
    if (time >= visual.gateEnd + release) return 0;
    const level = visual.releaseFrom ?? held(visual.gateEnd);
    return level * Math.exp(-5 * (time - visual.gateEnd) / release);
  }

  _releaseVisual(voice, time) {
    const visual = voice.visual;
    if (!visual) return;
    // Preserve the originating instrument/source while the voice releases.
    const from = this._envelopeEstimate(visual, time);
    visual.gateEnd = time;
    visual.releaseFrom = from;
    visual.adsr.release = clamp(this.getState().sound?.release, .03, 8, 1.4);
  }

  _soundNote(midi, velocity, time, duration, source = 'sequence', owner = null, metadata = {}) {
    if (!this.ready || this.disposed) return null;
    const now = this._audioTime();
    time = Number.isFinite(time) ? time : this.Tone.now();
    // A stalled UI can deliver a backlog of transport callbacks. Replaying old
    // beats would create a burst, and Tone clamps every old oscillator start
    // to the same currentTime (which violates its strict restart ordering).
    // Let the transport/step indices advance, but discard expired audio events.
    if (source !== 'live' && time + .003 < now - .015) return null;
    time = Math.max(time, now);
    const voice = this._chooseVoice(source, time);
    if (!voice) return null;
    // Finger retriggers or near-late events can still target the same pooled
    // voice in one audio-clock quantum. Keep its release, attack and visual
    // snapshot on one strictly increasing, audible timeline.
    time = Math.max(time, (voice.lastAttackTime ?? -Infinity) + .003);
    this._wakeOutput();
    // Keep the old visual identity until a queued replacement actually sounds.
    if (voice.releaseAt > time || voice.owner !== null) {
      voice.synth.triggerRelease(time);
      this._releaseVisual(voice, time);
    }
    voice.previousVisual = voice.visual;
    const attackTime = time + .003;
    const strength = clamp(velocity, .04, 1, .7);
    const adsr = this._envelopeSettings();
    const gateEnd = Number.isFinite(duration) ? time + Math.max(.025, duration) : Infinity;
    voice.synth.triggerAttack(midiToFrequency(midi), attackTime, strength);
    voice.lastAttackTime = attackTime;
    voice.source = source;
    voice.owner = owner;
    voice.started = time;
    voice.visual = {
      midi: Math.round(midi), velocity: strength, source,
      step: Number.isInteger(metadata.step) ? metadata.step : null,
      // Gesture provenance belongs to the scheduled note, not its pooled slot.
      // Arp voices remain unowned for allocation even when a finger caused them.
      originId: source === 'live' ? owner : source === 'arp' ? metadata.originId ?? null : null,
      originTime: source === 'live' || source === 'arp' ? metadata.originTime ?? performance.now() / 1000 : null,
      generation: voice.generation + 1,
      started: attackTime, gateEnd, adsr,
    };
    if (Number.isFinite(gateEnd)) {
      voice.synth.triggerRelease(gateEnd);
      voice.releaseAt = gateEnd + adsr.release;
    } else voice.releaseAt = Infinity;
    const generation = ++voice.generation;
    const information = { index: voice.index, source, step: voice.visual.step, time: attackTime, duration };
    this._draw(() => {
      if (voice.generation === generation) this._emit('onNote', Math.round(midi), strength, information);
    }, attackTime);
    return voice;
  }

  _ensureTransport() {
    if (this.transport.state !== 'started') this.transport.start('+0.025');
  }

  async start() {
    const request = ++this._startRequest;
    try {
      if (!await this.init() || this.disposed || request !== this._startRequest) return false;
      if (this.running) return true;
      this.update();
      this.running = true;
      this.stepIndex = 0;
      this._wakeOutput();
      this.sequenceId = this.transport.scheduleRepeat(time => this._tickSequence(time), '16n');
      this._ensureTransport();
      return true;
    } catch (error) { this._emit('onState', 'error', error.message); return false; }
  }

  _tickSequence(time) {
    if (!this.running) return;
    const sequence = this.getState().sequence || {};
    const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
    const length = Math.round(clamp(sequence.length, 1, Math.min(64, steps.length || 16), 16));
    const index = this.stepIndex++ % length;
    const step = steps[index];
    const expired = time + .003 < this._audioTime() - .015;
    if (!expired) this._draw(() => { if (this.running) this._emit('onStep', index); }, time);
    if (expired || !step || step.active === false) return;
    const midi = degreeToMidi(step.note, sequence.root, sequence.scale);
    const stepDuration = 60 / clamp(sequence.bpm, 35, 240, 112) / 4;
    this._soundNote(midi, clamp(step.velocity, .08, 1, .65), time, stepDuration * .68, 'sequence', null, { step: index });
  }

  async noteOn(id, midi, velocity = .7) {
    const entry = { midi: Math.round(clamp(midi, 12, 115, 50)), velocity: clamp(velocity, .04, 1, .7), voice: null, originTime: performance.now() / 1000 };
    this.noteOff(id);
    this.live.set(id, entry);
    try {
      if (!await this.init() || this.live.get(id) !== entry || this.disposed) return false;
      this.update();
      const sequence = this.getState().sequence || {};
      if (sequence.arp) {
        const time = this.Tone.now();
        this._soundNote(entry.midi, entry.velocity, time, .12, 'arp', null, { originId: id, originTime: entry.originTime });
        this._arpLastOnset = time;
        if (this.live.size === 1) this.arpIndex = 1;
        this._ensureTransport();
      } else entry.voice = this._soundNote(entry.midi, entry.velocity, this.Tone.now(), Infinity, 'live', id, { originTime: entry.originTime });
      return true;
    } catch (error) { this.live.delete(id); this._emit('onState', 'error', error.message); return false; }
  }

  noteOff(id) {
    const entry = this.live.get(id);
    if (!entry) return;
    const voice = entry.voice;
    if (voice && voice.owner === id && this.ready) {
      const time = Math.max(this.Tone.now(), voice.started + .006);
      voice.synth.triggerRelease(time);
      this._releaseVisual(voice, time);
      voice.owner = null;
      voice.source = 'release';
      voice.releaseAt = time + clamp(this.getState().sound?.release, .03, 8, 1.4);
    }
    this.live.delete(id);
  }

  _tickArp(time) {
    const sequence = this.getState().sequence || {};
    if (!sequence.arp || !this.live.size) return;
    // The first gesture sounds immediately; don't double it at transport start.
    if (time - this._arpLastOnset < .05) return;
    const held = [...this.live];
    const notes = makeArpeggio(held.map(([, entry]) => entry.midi), sequence.root, sequence.scale);
    if (!notes.length) return;
    const tickIndex = this.arpIndex++;
    let position = tickIndex;
    const direction = String(sequence.arpDirection || 'up').toLowerCase();
    if (direction === 'down') position = notes.length - 1 - position % notes.length;
    else if (direction === 'updown' || direction === 'pendulum') {
      const length = Math.max(1, notes.length * 2 - 2);
      position %= length;
      if (position >= notes.length) position = length - position;
    } else if (direction === 'random') {
      // A stable sequence makes saved gestures reproducible.
      position = ((position * 1664525 + 1013904223) >>> 0) % notes.length;
    }
    const midi = notes[position % notes.length];
    // One distinct held root generates a chord; every generated pitch belongs
    // to that root. Otherwise the selected pitch identifies its held source.
    // Duplicate held pitches alternate provenance across complete arp cycles.
    const heldPitch = entry => Math.round(clamp(entry.midi, 12, 103, 50));
    const singleRoot = new Set(held.map(([, entry]) => heldPitch(entry))).size === 1;
    const origins = singleRoot ? held : held.filter(([, entry]) => heldPitch(entry) === midi);
    const origin = origins[Math.floor(tickIndex / notes.length) % origins.length] || held[0];
    const duration = 60 / clamp(sequence.bpm, 35, 240, 112) * 4 / this._arpRate * .62;
    const velocity = held.reduce((sum, [, item]) => sum + item.velocity, 0) / held.length;
    this._soundNote(midi, velocity * .9, time, duration, 'arp', null, { originId: origin[0], originTime: origin[1].originTime });
    this._arpLastOnset = time;
  }

  update() {
    if (!this.ready || this.disposed) return;
    const state = this.getState();
    const sound = state.sound || {};
    const sequence = state.sequence || {};
    const shape = { sine: 'sine', triangle: 'triangle', saw: 'sawtooth', sawtooth: 'sawtooth', square: 'square', pulse: 'pulse', fm: 'fmsine' }[sound.waveform] || 'triangle';
    const envelope = {
      attack: clamp(sound.attack, .005, 4, .04), decay: clamp(sound.decay, .01, 5, .35),
      sustain: clamp(sound.sustain, 0, 1, .55), release: clamp(sound.release, .03, 8, 1.4),
    };
    const envelopeKey = JSON.stringify(envelope);
    const detune = clamp(sound.detune, 0, 70, 8);
    this.voices.forEach((voice, index) => {
      if (shape !== this._last.shape) voice.synth.set({ oscillator: { type: shape } });
      if (envelopeKey !== this._last.envelope) voice.synth.set({ envelope });
      if (detune !== this._last.detune) voice.synth.detune.rampTo((index % 2 ? 1 : -1) * detune * .5, .08);
    });
    const ramp = (key, value, param, duration = .06, startTime) => {
      if (this._last[key] !== value) { param.rampTo(value, duration, startTime); this._last[key] = value; }
    };
    const baseCutoff = clamp(sound.cutoff, 20, 20000, 2400);
    const lfoDepth = clamp(sound.lfoDepth, 0, 1, .08);
    // The depth is bounded around the base so the modulated cutoff remains
    // inside the same 20–20,000 Hz range as the XY surface.
    const depthHz = Math.min(baseCutoff * .85 * lfoDepth, baseCutoff - 20, 20000 - baseCutoff);
    const filterChangeTime = this.Tone.now();
    ramp('cutoff', baseCutoff, this.filterBase.addend, .045, filterChangeTime);
    ramp('lfoDepthHz', depthHz, this.filterDepth.gain, .045, filterChangeTime);
    const lfoRate = clamp(sound.lfoRate, .05, 4, .35);
    if (lfoRate !== this._lfoRate) {
      const at = this.Tone.now();
      const phase = this._lfoPhaseAt(at);
      this.filterLFO.frequency.cancelScheduledValues(at);
      this.filterLFO.frequency.setValueAtTime(lfoRate, at);
      this._lfoSegments = this._lfoSegments.filter(segment => segment.time < at);
      this._lfoSegments.push({ time: at, phase, rate: lfoRate });
      // Retain the current/next segment, not an ever-growing automation log.
      if (this._lfoSegments.length > 32) this._lfoSegments.splice(0, this._lfoSegments.length - 32);
      this._lfoRate = lfoRate;
    }
    ramp('resonance', clamp(sound.resonance, .1, 12, 1.8), this.filter.Q, .045);
    ramp('delay', clamp(sound.delay, 0, .65, .22), this.delay.wet);
    ramp('feedback', clamp(sound.feedback, 0, .72, .25), this.delay.feedback);
    ramp('reverb', clamp(sound.reverb, 0, .7, .22), this.reverb.wet);
    const bpm = clamp(sequence.bpm, 35, 240, 112);
    ramp('bpm', bpm, this.transport.bpm, .12);
    ramp('delayTime', 60 / bpm * .75, this.delay.delayTime, .2);
    this.transport.swing = clamp(sequence.swing, 0, .65, .1);
    const volume = clamp(sound.volume, 0, 1, .65);
    if (volume !== this._last.volume) this.master.gain.rampTo(this._silenced ? 0 : volume ** 1.5 * .8, .04);
    this._last = { ...this._last, shape, envelope: envelopeKey, detune, volume };
    const rate = [4, 8, 16, 32].includes(Number(sequence.arpRate)) ? Number(sequence.arpRate) : 8;
    if (rate !== this._arpRate || this.arpId === null) {
      if (this.arpId !== null) this.transport.clear(this.arpId);
      this._arpRate = rate;
      this.arpId = this.transport.scheduleRepeat(time => this._tickArp(time), `${rate}n`);
    }
    const arp = Boolean(sequence.arp);
    if (this._last.arp !== undefined && this._last.arp !== arp) {
      const now = this.Tone.now();
      this.arpIndex = 0;
      for (const [id, entry] of this.live) {
        if (entry.voice?.owner === id) {
          const releaseTime = Math.max(now, entry.voice.started + .006);
          entry.voice.synth.triggerRelease(releaseTime);
          this._releaseVisual(entry.voice, releaseTime);
          entry.voice.owner = null;
          entry.voice.source = 'release';
          entry.voice.releaseAt = now + envelope.release;
        }
        entry.voice = arp ? null : this._soundNote(entry.midi, entry.velocity, now, Infinity, 'live', id, { originTime: entry.originTime });
      }
      if (arp && this.live.size) this._ensureTransport();
    }
    this._last.arp = arp;
  }

  allNotesOff() {
    this.live.clear();
    this.epoch++;
    if (!this.ready) return;
    const time = this.Tone.now();
    for (const voice of this.voices) {
      const releaseTime = Math.max(time, voice.started + .006);
      voice.synth.triggerRelease(releaseTime);
      this._releaseVisual(voice, releaseTime);
      voice.owner = null;
      voice.source = 'release';
      voice.releaseAt = time + clamp(this.getState().sound?.release, .03, 8, 1.4);
    }
  }

  stopSequence() {
    // The footer controls the sequencer. Manual and latched notes, including
    // their independent arp clock, keep sounding when the sequence is paused.
    ++this._startRequest;
    this.running = false;
    if (this.ready) {
      if (this.sequenceId !== null) this.transport.clear(this.sequenceId);
      this.sequenceId = null;
      const now = this.Tone.now();
      for (const voice of this.voices) {
        if (voice.source !== 'sequence') continue;
        const releaseTime = Math.max(now, voice.started + .006);
        voice.synth.triggerRelease(releaseTime);
        this._releaseVisual(voice, releaseTime);
        voice.source = 'release';
        voice.releaseAt = releaseTime + clamp(this.getState().sound?.release, .03, 8, 1.4);
        voice.generation++; // Cancel any queued sequence-only UI notification.
      }
      if (!this.getState().sequence?.arp || !this.live.size) {
        this.transport.stop();
        this.transport.position = 0;
        this.arpIndex = 0;
        this._arpLastOnset = -Infinity;
      }
    }
    this.stepIndex = 0;
    this._emit('onStep', -1);
  }

  stop() {
    ++this._startRequest;
    this.running = false;
    this.allNotesOff();
    if (this.ready) {
      if (this.sequenceId !== null) this.transport.clear(this.sequenceId);
      this.sequenceId = null;
      this.transport.stop();
      this.transport.position = 0;
      this._silenced = true;
      this.master.gain.rampTo(0, .09);
    }
    this.stepIndex = 0;
    this.arpIndex = 0;
    this._arpLastOnset = -Infinity;
    this._emit('onStep', -1);
  }

  _audioTime() {
    const rawTime = this._context?.currentTime;
    if (Number.isFinite(rawTime)) return rawTime;
    const immediate = this.Tone?.immediate?.();
    return Number.isFinite(immediate) ? immediate : (this.Tone?.now?.() || 0);
  }

  _lfoPhaseAt(time) {
    if (!this._lfoSegments.length || time < this._lfoSegments[0].time) return 0;
    let segment = this._lfoSegments[0];
    for (const item of this._lfoSegments) { if (item.time > time) break; segment = item; }
    return ((segment.phase + (time - segment.time) * segment.rate) % 1 + 1) % 1;
  }

  getVisualState() {
    const time = this._audioTime(), sound = this.getState().sound || {};
    const lfoPhase = this._lfoPhaseAt(time);
    const parameterAt = (parameter, fallback) => {
      const value = parameter?.getValueAtTime?.(time) ?? parameter?.value;
      return Number.isFinite(value) ? value : fallback;
    };
    const baseCutoff = parameterAt(this.filterBase?.addend, clamp(sound.cutoff, 20, 20000, 2400));
    const depthHz = parameterAt(this.filterDepth?.gain, 0);
    const cutoff = clamp(baseCutoff + Math.sin(lfoPhase * Math.PI * 2) * depthHz, 20, 20000, baseCutoff);
    const voices = this.voices.map(voice => {
      const visual = voice.visual?.started <= time ? voice.visual : voice.previousVisual;
      const pointer = /^pointer-(\d+)$/.exec(String(visual?.originId ?? ''));
      let envelope = 0;
      if (visual && !this._silenced && time >= visual.started && time < visual.gateEnd + visual.adsr.release) {
        // Tone's public envelope query is the exact scheduled ADSR, including
        // exponential release and retrigger-from-current-level. The snapshot
        // model is also useful to non-Tone render/test hosts.
        const actual = voice.synth.envelope?.getValueAtTime?.(time);
        envelope = Number.isFinite(actual) ? actual / Math.max(.04, visual.velocity) : this._envelopeEstimate(visual, time);
      }
      return {
        index: voice.index, midi: visual?.midi ?? null, velocity: visual?.velocity ?? 0,
        envelope: clamp(envelope, 0, 1, 0), source: visual?.source ?? null,
        step: visual?.step ?? null, started: visual?.started ?? -1, gateEnd: visual?.gateEnd ?? -1,
        originId: visual?.originId ?? null, pointerId: pointer ? Number(pointer[1]) : null,
        originTime: visual?.originTime ?? null,
        generation: visual?.generation ?? 0,
      };
    });
    const outputLevel = this.getOutputLevel();
    return { time, voices, level: this.getLevel(), outputLevel, lfoPhase, cutoff, baseCutoff,
      resonance: clamp(sound.resonance, .1, 12, 1.8) };
  }

  // The existing waveform analyser is connected after the master gain.
  // Its samples give real output RMS; Tone.Meter's peak hold depends on how
  // often it is polled, so that legacy display meter stays separate below.
  getOutputLevel() {
    if (!this.ready || this._silenced) return 0;
    const samples = this.waveform.getValue();
    if (!samples?.length) return 0;
    let sum = 0;
    for (const sample of samples) { if (Number.isFinite(sample)) sum += sample * sample; }
    return clamp(Math.sqrt(sum / samples.length), 0, 1, 0);
  }

  getLevel() {
    if (!this.ready || this._silenced) return 0;
    const value = this.meter.getValue();
    const level = Array.isArray(value) || ArrayBuffer.isView(value) ? Math.max(...value) : value;
    return clamp(level * 3.6, 0, 1, 0);
  }

  getWaveform() { return this.ready && !this._silenced ? this.waveform.getValue() : this._emptyWaveform; }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    if (this.arpId !== null) this.transport?.clear(this.arpId);
    this._context?.removeEventListener?.('statechange', this._contextListener);
    for (const node of this.nodes.reverse()) { try { node.dispose(); } catch { /* Already disposed. */ } }
    this.nodes = [];
    this.voices = [];
  }
}
