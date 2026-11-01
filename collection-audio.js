import {wavetableCoefficients} from './wavetable.js';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? clamp(Number(value), min, max) : fallback;
const WAVES = new Set(['sine', 'triangle', 'sawtooth', 'square', 'wavetable']);
const DEFAULTS = Object.freeze({waveform:'triangle',tablePosition:.35,tableWarp:0,attack:.018,decay:.18,sustain:.65,release:.55,cutoff:6500,resonance:1.2,gain:.7,pan:0,ratio:2,index:0,detune:0,crush:0,glide:.025,echo:.08,delayTime:.23,feedback:.18,eqLowGain:0,eqLowFreq:160,eqMidGain:0,eqMidFreq:1200,eqMidQ:.7,eqHighGain:0,eqHighFreq:6000});
export const midiFrequency = midi => 440 * Math.pow(2, (number(midi, 60, 0, 127) - 69) / 12);

/** A small native audio host. Musical source identity is independent of the
 * short-lived oscillator voices used for envelopes, sequencing and arpeggios. */
export class CollectionAudio {
  constructor({AudioContext, Tone, audioSession, maxVoices=16, setInterval:interval, clearInterval:clear, setTimeout:timeout, clearTimeout:clearTimeoutFn, resumeTimeoutMs=1800, onError, onStateChange} = {}) {
    // Production uses the same standardized Web Audio platform as Signal. An
    // injected/native context remains available for tests and library fallback.
    this._Tone = AudioContext ? null : Tone || globalThis.Tone;
    this._Context = AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
    this._setInterval = interval || globalThis.setInterval.bind(globalThis);
    this._clearInterval = clear || globalThis.clearInterval.bind(globalThis);
    this._setTimeout = timeout || globalThis.setTimeout.bind(globalThis);
    this._clearTimeout = clearTimeoutFn || globalThis.clearTimeout.bind(globalThis);
    this._resumeTimeoutMs = number(resumeTimeoutMs,1800,50,10000);
    this._audioSession = audioSession === undefined ? globalThis.navigator?.audioSession : audioSession;
    this._previousSessionType = null; this._ownsSessionType = false;
    this._onError = onError || (error => console.error(error));
    this._onStateChange = onStateChange || (() => {});
    this.maxVoices = clamp(Math.round(maxVoices), 1, 32);
    this.sound = {...DEFAULTS};
    this.performance = {hold:false,arp:false,bpm:112,arpRate:8};
    this.transport = {playing:false,bpm:112,onStep:null};
    this.sources = new Map();
    this._voices = []; this._serial = 0; this._generation = 0;
    this._context = null; this._output = null; this._pendingStarts = new Set();
    this._contextListener = null; this._wasRunning = false;
    this._timer = null; this._disposed = false; this._muted = false;
    this._nextSequence = null; this._sequenceStep = 0; this._stepEvents = [];
    this._nextArp = null; this._arpIndex = 0; this._insideStep = false;
    this._waveform = new Float32Array(512); this._frequency = new Float32Array(256);
    this._spectrumBytes = new Uint8Array(256); this._rms = 0;
    this._periodicWaves = new Map();
  }

  get context() { return this._context; }
  /** External engines (e.g. granular voices) connect here before output metering. */
  get output() { return this._output; }
  get now() { return this._context?.currentTime || 0; }

  async start() {
    if (this._disposed || (!this._Context && !this._Tone?.getContext)) return false;
    try {
      this._prepareAudioSession();
      if (!this._context) this._createContext();
      this._wake();
      // Touch pointerdown may precede Safari's eligible activation event. A
      // pending attempt must never prevent touchend/click from trying again.
      // Signal calls Tone.start() for every gesture; preserve that behavior here.
      const resumed = this._Tone ? this._Tone.start() : this._context.resume();
      if (!await this._waitForRunning(resumed) || this._disposed || this._context.state!=='running') return false;
      this.lastError = null; this._wasRunning = true;
      for (const pending of [...this._pendingStarts]) pending.check();
      this._reconcile(); this._tick();
      return true;
    } catch (error) {
      this.lastError = error;
      return false;
    }
  }

  _prepareAudioSession() {
    // Web Audio's automatic session is ambient on supported platforms. This is
    // a music instrument; request the music-playback category when available.
    // Preserve an explicitly active recording session and restore our change.
    try {
      const session = this._audioSession;
      if (!session || session.type === 'playback' || session.type === 'play-and-record') return;
      if (!this._ownsSessionType) this._previousSessionType = session.type;
      session.type = 'playback'; this._ownsSessionType = session.type === 'playback';
    } catch { /* AudioSession is optional; unsupported platforms use Web Audio. */ }
  }

  _waitForRunning(resume) {
    const context = this._context;
    return new Promise(resolve => {
      let settled = false, timer = null;
      const pending = {check:null,finish:null};
      const finish = (ready,error) => {
        if (settled) return; settled = true;
        if (timer!==null) this._clearTimeout(timer);
        context.removeEventListener?.('statechange',pending.check);
        this._pendingStarts.delete(pending);
        if (error) this.lastError = error;
        resolve(ready);
      };
      pending.finish = finish;
      pending.check = () => {
        if (this._disposed || context.state==='closed') finish(false);
        else if (context.state==='running') finish(true);
      };
      this._pendingStarts.add(pending);
      context.addEventListener?.('statechange',pending.check);
      timer = this._setTimeout(() => {
        if (context.state==='running') finish(true);
        else finish(false,new Error('Audio activation did not complete. Tap Play to retry.'));
      },this._resumeTimeoutMs);
      Promise.resolve(resume).then(pending.check,error=>finish(false,error));
      pending.check();
    });
  }

  _createContext() {
    let context;
    if (this._Tone?.getContext) {
      if (this._Tone.getContext().rawContext.state==='closed' && this._Tone.Context && this._Tone.setContext) this._Tone.setContext(new this._Tone.Context({latencyHint:'interactive'}));
      context = this._Tone.getContext().rawContext;
    } else { this._Tone = null; context = new this._Context({latencyHint:'interactive'}); }
    this._context = context;
    const output = this._output = context.createGain();
    const compressor = this._compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.knee.value = 8;
    compressor.ratio.value = 8; compressor.attack.value = .003; compressor.release.value = .16;
    const master = this._master = context.createGain(); master.gain.value = .72;
    const analyser = this._analyser = context.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = .7;
    const low=this._eqLow=context.createBiquadFilter(),mid=this._eqMid=context.createBiquadFilter(),high=this._eqHigh=context.createBiquadFilter();
    low.type='lowshelf';mid.type='peaking';high.type='highshelf';
    output.connect(low);low.connect(mid);mid.connect(high);high.connect(compressor);compressor.connect(master);
    // Metering observes a parallel branch, exactly as in Signal. Its display
    // processing is never inserted between the music bus and the speakers.
    master.connect(context.destination); master.connect(analyser);
    const delay = this._delay = context.createDelay(1.2);
    const feedback = this._feedback = context.createGain(), wet = this._wet = context.createGain();
    high.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(compressor);
    this._applyEffects();
    this._contextListener = () => {
      if (context.state==='running') { this._wasRunning=true; return; }
      if (this._wasRunning && !this._disposed) {
        this._wasRunning=false; this.panic(); this._onStateChange(context.state);
      }
    };
    context.addEventListener?.('statechange',this._contextListener);
    this._timer = this._setInterval(() => this._tick(), 25);
  }

  _options(options={}) {
    const input = {...this.sound, ...options};
    return {
      waveform: WAVES.has(input.waveform) ? input.waveform : 'triangle',
      tablePosition:number(input.tablePosition,.35,0,1),tableWarp:number(input.tableWarp,0,0,1),
      attack:number(input.attack,.018,.002,4), decay:number(input.decay,.18,.005,4),
      sustain:number(input.sustain,.65,0,1), release:number(input.release,.55,.015,8),
      cutoff:number(input.cutoff,6500,25,20000), resonance:number(input.resonance,1.2,.1,16),
      gain:number(input.gain,.7,0,1), velocity:number(input.velocity,1,0,1),
      pan:number(input.pan,0,-1,1), ratio:number(input.ratio,2,.125,16),
      index:number(input.index,0,0,16), detune:number(input.detune,0,-1200,1200),
      crush:number(input.crush,0,0,1), glide:number(input.glide,.025,.003,1),
    };
  }

  configure(sound={}, {replace=false}={}) {
    this.sound = {...(replace ? DEFAULTS : this.sound), ...sound};
    const applied = replace ? this.sound : sound;
    this._applyEffects();
    for (const source of this.sources.values()) source.options = {...source.options, ...applied};
    for (const voice of this._voices) if (!voice.disposed) this._updateVoice(voice, voice.midi, {...voice.options, ...applied});
  }

  _applyEffects() {
    if (!this._context) return;
    const now = this.now;
    this._smooth(this._delay.delayTime, number(this.sound.delayTime,.23,.03,1.1), now, .04);
    this._smooth(this._feedback.gain, number(this.sound.feedback,.18,0,.65), now, .03);
    this._smooth(this._wet.gain, this._muted ? 0 : number(this.sound.echo,.08,0,.6), now, .025);
    for(const [node,prefix,fallback,min,max]of [[this._eqLow,'eqLow',160,40,500],[this._eqMid,'eqMid',1200,200,5000],[this._eqHigh,'eqHigh',6000,2000,16000]]){
      this._smooth(node.frequency,Math.min(this._context.sampleRate*.45,number(this.sound[prefix+'Freq'],fallback,min,max)),now,.025);
      this._smooth(node.gain,number(this.sound[prefix+'Gain'],0,-18,18),now,.025);
    }
    this._smooth(this._eqMid.Q,number(this.sound.eqMidQ,.7,.25,8),now,.025);
  }

  _smooth(param, value, when=this.now, duration=.015) {
    param.cancelScheduledValues(when);
    param.setTargetAtTime(value, when, duration);
  }

  _wake() {
    if (!this._context || !this._muted) return;
    this._muted = false;
    this._smooth(this._output.gain, 1, this.now, .006); this._applyEffects();
  }

  noteOn(id, midi, options={}) {
    if (this._disposed) return null;
    id = String(id); midi = number(midi, 60, 0, 127);
    this._removeSourceVoices(id, this.now, .025);
    if (!this.sources.has(id) && this.sources.size >= this.maxVoices) {
      // Touch IDs are often never reused. Bound the latched pool as well as the
      // oscillators, otherwise repeated Hold taps accumulate invisible sources.
      const victim = [...this.sources.values()].find(source => !source.physical) || this.sources.values().next().value;
      this.sources.delete(victim.id); this._removeSourceVoices(victim.id,this.now,.025);
    }
    const source = {id,midi,options:{...options},physical:true,generation:++this._generation};
    this.sources.set(id, source);
    this._wake();
    if (this._context?.state === 'running') {
      if (this.performance.arp) { if (this._nextArp === null) this._nextArp = this.now + .005; this._tick(); }
      else this._newVoice(source, this.now, 'direct');
    }
    return source;
  }

  noteUpdate(id, midi, options={}) {
    const source = this.sources.get(String(id)); if (!source || this._disposed) return false;
    source.midi = number(midi, source.midi, 0, 127); source.options = {...source.options, ...options};
    for (const voice of this._voices) if (voice.id === source.id && voice.generation === source.generation && !voice.disposed) this._updateVoice(voice, source.midi, source.options);
    return true;
  }

  noteOff(id,{force=false}={}) {
    id = String(id); const source = this.sources.get(id); if (!source) return;
    source.physical = false;
    if (this.performance.hold&&!force) return;
    this.sources.delete(id); this._removeSourceVoices(id, this.now);
    if (!this.sources.size) this._nextArp = null;
  }

  setPerformance(options={}) {
    const before = {...this.performance};
    if ('hold' in options) this.performance.hold = Boolean(options.hold);
    if ('arp' in options) this.performance.arp = Boolean(options.arp);
    if ('bpm' in options) this.performance.bpm = number(options.bpm,112,40,220);
    if ('arpRate' in options) this.performance.arpRate = number(options.arpRate,8,1,32);
    if (before.hold && !this.performance.hold) {
      for (const [id, source] of this.sources) if (!source.physical) { this.sources.delete(id); this._removeSourceVoices(id,this.now); }
    }
    if (before.arp !== this.performance.arp) {
      for (const voice of [...this._voices]) if (voice.kind === 'arp' || voice.kind === 'direct') this._releaseVoice(voice,this.now,.035);
      this._nextArp = null; this._arpIndex = 0;
      this._reconcile(); this._tick();
    }
  }

  setTransport(options={}) {
    const wasPlaying = this.transport.playing;
    if ('bpm' in options) {
      this.transport.bpm = number(options.bpm,112,40,220);
      this.performance.bpm = this.transport.bpm;
    }
    if ('onStep' in options) this.transport.onStep = typeof options.onStep === 'function' ? options.onStep : null;
    if ('playing' in options) this.transport.playing = Boolean(options.playing);
    if (wasPlaying !== this.transport.playing) {
      this._nextSequence = null;
      if (this.transport.playing) { this._sequenceStep = 0; this._stepEvents = []; }
      else {
        for (const voice of [...this._voices]) if (voice.kind === 'sequence') this._releaseVoice(voice,this.now,Math.min(.12,voice.options.release));
        this._stepEvents = this._stepEvents.filter(event => event.when <= this.now);
      }
    }
    this._tick();
  }

  pulse(id, midi, options={}, when=this.now, duration=.12) {
    if (this._disposed || this._context?.state !== 'running') return null;
    this._wake();
    const source = {id:String(id),midi:number(midi,60,0,127),options,generation:++this._generation};
    const voice = this._newVoice(source, Math.max(this.now,number(when,this.now,0,this.now+2)), this._insideStep ? 'sequence' : 'pulse');
    if (voice) this._releaseVoice(voice,voice.start+number(duration,.12,.015,16));
    return voice;
  }

  _reconcile() {
    if (this._disposed || this._context?.state !== 'running') return;
    if (this.performance.arp) {
      if (this.sources.size && this._nextArp === null) this._nextArp = this.now + .005;
      return;
    }
    for (const source of this.sources.values()) {
      const playing = this._voices.some(voice => voice.kind==='direct' && voice.generation===source.generation && !voice.disposed && voice.releaseAt===null);
      if (!playing) this._newVoice(source,this.now,'direct');
    }
  }

  _tick() {
    if (this._disposed || this._context?.state !== 'running') return;
    const now = this.now, horizon = now + .075;
    this._cleanup();
    if (this.transport.playing && this.transport.onStep) {
      if (this._nextSequence === null || this._nextSequence < now-.2) this._nextSequence = now+.008;
      while (this._nextSequence < horizon) {
        const step = this._sequenceStep++ % 16, when = this._nextSequence;
        this._stepEvents.push({step,when});
        this._insideStep = true;
        try { this.transport.onStep(step,when); } catch (error) { this._onError(error); }
        finally { this._insideStep = false; }
        this._nextSequence += 60/this.transport.bpm/4;
      }
      this._stepEvents = this._stepEvents.filter(event => event.when >= now-4);
    }
    if (this.performance.arp && this.sources.size) {
      if (this._nextArp === null || this._nextArp < now-.2) this._nextArp = now+.005;
      const period = 60/this.performance.bpm*4/this.performance.arpRate;
      while (this._nextArp < horizon) {
        const sources = [...this.sources.values()].sort((a,b) => a.midi-b.midi || a.generation-b.generation);
        const source = sources[this._arpIndex++ % sources.length];
        const voice = this._newVoice(source,this._nextArp,'arp');
        if (voice) this._releaseVoice(voice,this._nextArp+Math.max(.025,period*.66));
        this._nextArp += period;
      }
    }
  }

  _newVoice(source, when, kind) {
    if (!this._context || this._disposed) return null;
    this._cleanup();
    if (this._voices.length >= this.maxVoices) {
      // Released/quiet voices are stolen first; live source identity stays intact.
      const victim = [...this._voices].sort((a,b) => (a.releaseAt===null)-(b.releaseAt===null) || this._level(a,this.now)-this._level(b,this.now) || a.serial-b.serial)[0];
      this._destroyVoice(victim);
    }
    const context = this._context, options = this._options(source.options);
    const carrier = context.createOscillator(), modulator = context.createOscillator(), modulation = context.createGain();
    const filter = context.createBiquadFilter(), shaper = context.createWaveShaper(), amp = context.createGain();
    const pan = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
    const voice = {id:source.id,generation:source.generation,serial:++this._serial,kind,midi:source.midi,options,start:when,releaseAt:null,releaseLevel:0,releaseDuration:0,stopAt:Infinity,disposed:false,
      carrier,modulator,modulation,filter,shaper,amp,pan,nodes:[carrier,modulator,modulation,filter,shaper,amp,pan],envelope:{attack:options.attack,decay:options.decay,sustain:options.sustain},peak:.17*options.gain*options.velocity};
    this._setWaveform(voice,options);modulator.type = 'sine'; filter.type = 'lowpass';
    const hz = midiFrequency(source.midi);
    carrier.frequency.setValueAtTime(hz,when); carrier.detune.setValueAtTime(options.detune,when);
    modulator.frequency.setValueAtTime(Math.min(context.sampleRate*.45,hz*options.ratio),when);
    modulation.gain.setValueAtTime(hz*options.index,when);
    filter.frequency.setValueAtTime(Math.min(context.sampleRate*.45,options.cutoff),when); filter.Q.setValueAtTime(options.resonance,when);
    if (pan.pan) pan.pan.setValueAtTime(options.pan,when);
    this._setCrush(voice,options.crush);
    carrier.connect(filter);
    if (voice.shaperActive) { filter.connect(shaper); shaper.connect(amp); }
    else filter.connect(amp);
    voice.connected = true; amp.connect(pan); pan.connect(this._output);
    modulator.connect(modulation); modulation.connect(carrier.frequency);
    amp.gain.setValueAtTime(0,when); amp.gain.linearRampToValueAtTime(voice.peak,when+options.attack); amp.gain.linearRampToValueAtTime(voice.peak*options.sustain,when+options.attack+options.decay);
    this._voices.push(voice);
    carrier.onended = () => this._destroyVoice(voice);
    carrier.start(when); modulator.start(when);
    return voice;
  }

  _setWaveform(voice,options){
    if(options.waveform!=='wavetable'){
      if(voice.waveKey!==options.waveform){voice.carrier.type=options.waveform;voice.waveKey=options.waveform;}
      return;
    }
    const coefficients=wavetableCoefficients(options.tablePosition,options.tableWarp),key=coefficients.key;
    if(voice.waveKey===key)return;
    let wave=this._periodicWaves.get(key);
    if(!wave){wave=this._context.createPeriodicWave(coefficients.real,coefficients.imag,{disableNormalization:true});this._periodicWaves.set(key,wave);if(this._periodicWaves.size>64)this._periodicWaves.delete(this._periodicWaves.keys().next().value);}
    voice.carrier.setPeriodicWave(wave);voice.waveKey=key;
  }

  _setCrush(voice, value) {
    if (voice.crush === value) return;
    voice.crush = value;
    const active = value>=.001;
    if (!active) voice.shaper.curve = null;
    else {
      const curve = new Float32Array(4097), steps = Math.pow(2,Math.round(2+(1-value)*14));
      for (let i=0;i<curve.length;i++) curve[i] = Math.round((i/(curve.length-1)*2-1)*steps)/steps;
      voice.shaper.curve = curve;
    }
    if (voice.connected && active!==voice.shaperActive) {
      voice.filter.disconnect(); voice.shaper.disconnect();
      if (active) { voice.filter.connect(voice.shaper); voice.shaper.connect(voice.amp); }
      else voice.filter.connect(voice.amp);
    }
    voice.shaperActive = active;
  }

  _updateVoice(voice, midi, rawOptions) {
    if (voice.disposed) return;
    const options = this._options(rawOptions), now = Math.max(this.now,voice.start), hz = midiFrequency(midi), before = voice.options;
    voice.midi = midi; voice.options = options;
    this._setWaveform(voice,options);
    this._smooth(voice.carrier.frequency,hz,now,options.glide);
    this._smooth(voice.carrier.detune,options.detune,now,options.glide);
    this._smooth(voice.modulator.frequency,Math.min(this._context.sampleRate*.45,hz*options.ratio),now,options.glide);
    this._smooth(voice.modulation.gain,hz*options.index,now,.025);
    this._smooth(voice.filter.frequency,Math.min(this._context.sampleRate*.45,options.cutoff),now,.025);
    this._smooth(voice.filter.Q,options.resonance,now,.025);
    if (voice.pan.pan) this._smooth(voice.pan.pan,options.pan,now,.025);
    this._setCrush(voice,options.crush);
    if (before.gain!==options.gain || before.velocity!==options.velocity || before.sustain!==options.sustain) {
      const previous = this._level(voice,now)*voice.peak;
      voice.peak = .17*options.gain*options.velocity; voice.envelope.sustain = options.sustain;
      const gain = voice.amp.gain, a = voice.start+voice.envelope.attack, d = a+voice.envelope.decay;
      gain.cancelScheduledValues(now); gain.setValueAtTime(previous,now);
      if (voice.releaseAt!==null && now>=voice.releaseAt) gain.linearRampToValueAtTime(0,Math.max(now+.005,voice.stopAt-.025));
      else {
        if (a>now) gain.linearRampToValueAtTime(voice.peak,a);
        if (d>now) gain.linearRampToValueAtTime(voice.peak*options.sustain,d);
        else gain.linearRampToValueAtTime(voice.peak*options.sustain,now+.025);
        if (voice.releaseAt!==null) {
          gain.cancelScheduledValues(voice.releaseAt);
          voice.releaseLevel = this._heldLevel(voice,voice.releaseAt);
          gain.setValueAtTime(voice.releaseLevel*voice.peak,voice.releaseAt);
          gain.linearRampToValueAtTime(0,voice.releaseAt+voice.releaseDuration);
        }
      }
    }
  }

  _heldLevel(voice, time) {
    const age = time-voice.start, env = voice.envelope;
    if (age<0) return 0;
    if (age<env.attack) return age/env.attack;
    if (age<env.attack+env.decay) return 1-(1-env.sustain)*(age-env.attack)/env.decay;
    return env.sustain;
  }

  _level(voice, time) {
    if (voice.disposed || time<voice.start || time>=voice.stopAt) return 0;
    if (voice.releaseAt!==null && time>=voice.releaseAt) return voice.releaseLevel*clamp(1-(time-voice.releaseAt)/voice.releaseDuration,0,1);
    return this._heldLevel(voice,time);
  }

  _releaseVoice(voice, when=this.now, release=voice.options.release) {
    if (voice.disposed || (voice.releaseAt!==null && voice.releaseAt<=when)) return;
    if (when<voice.start) { this._destroyVoice(voice); return; }
    const level = this._heldLevel(voice,when), duration = number(release,.55,.008,8);
    voice.releaseAt = when; voice.releaseLevel = level; voice.releaseDuration = duration; voice.stopAt = when+duration+.025;
    const gain = voice.amp.gain;
    gain.cancelScheduledValues(when); gain.setValueAtTime(level*voice.peak,when); gain.linearRampToValueAtTime(0,when+duration);
    try { voice.carrier.stop(voice.stopAt); voice.modulator.stop(voice.stopAt); } catch {}
  }

  _removeSourceVoices(id, when, release) {
    for (const voice of [...this._voices]) if (voice.id===id && (voice.kind==='direct'||voice.kind==='arp')) this._releaseVoice(voice,when,release??voice.options.release);
  }

  _destroyVoice(voice) {
    if (!voice || voice.disposed) return;
    voice.disposed = true; voice.carrier.onended = null;
    try { voice.carrier.stop(); } catch {}
    try { voice.modulator.stop(); } catch {}
    for (const node of voice.nodes) try { node.disconnect(); } catch {}
    const index = this._voices.indexOf(voice); if (index!==-1) this._voices.splice(index,1);
  }

  _cleanup() { for (const voice of [...this._voices]) if (voice.stopAt<=this.now) this._destroyVoice(voice); }

  snapshot() {
    const time = this.now;
    if (this._analyser && this._context.state==='running') {
      this._analyser.getFloatTimeDomainData(this._waveform);
      this._analyser.getByteFrequencyData(this._spectrumBytes);
      let energy = 0;
      for (const value of this._waveform) energy += value*value;
      this._rms = Math.sqrt(energy/this._waveform.length);
      for (let i=0;i<this._frequency.length;i++) this._frequency[i] = this._spectrumBytes[i]/255;
    } else { this._waveform.fill(0); this._frequency.fill(0); this._rms=0; }
    let step = 0;
    for (const event of this._stepEvents) if (event.when<=time) step=event.step;
    const voices = this._voices.filter(voice => !voice.disposed && voice.start<=time && voice.stopAt>time).map(voice => ({id:voice.id,midi:voice.midi,level:this._level(voice,time)*voice.options.gain*voice.options.velocity,gate:voice.releaseAt===null||time<voice.releaseAt,started:voice.start,kind:voice.kind}));
    return {time,rms:this._rms,step,voices,waveform:this._waveform,frequency:this._frequency};
  }

  panic() {
    this.sources.clear(); this.transport.playing = false;
    this._nextArp = null; this._nextSequence = null; this._stepEvents = [];
    for (const voice of [...this._voices]) this._destroyVoice(voice);
    if (this._context) { this._muted=true; this._smooth(this._output.gain,0,this.now,.003); this._smooth(this._wet.gain,0,this.now,.003); }
  }

  dispose() {
    if (this._disposed) return;
    this.panic(); this._disposed = true;
    for (const pending of [...this._pendingStarts]) pending.finish(false);
    this._context?.removeEventListener?.('statechange',this._contextListener);
    try { if (this._ownsSessionType && this._audioSession.type==='playback') this._audioSession.type=this._previousSessionType; } catch {}
    if (this._timer!==null) this._clearInterval(this._timer); this._timer=null;
    for (const node of [this._output,this._eqLow,this._eqMid,this._eqHigh,this._compressor,this._master,this._analyser,this._delay,this._feedback,this._wet]) try { node?.disconnect(); } catch {}
    this._periodicWaves.clear();
    return this._context?.close().catch(() => {});
  }
}
