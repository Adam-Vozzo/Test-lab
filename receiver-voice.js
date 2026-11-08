const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const noiseBuffers=new WeakMap();

export const RECEIVER_DEFAULTS=Object.freeze({sideband:.34,spread:.22,air:.045,drift:.22,bandwidth:.68});

/** Radio-like beating stays around a tuned fundamental. These coefficients are
 * also available to the display without estimating sound from its artwork. */
export function receiverSpectrum(input={}){
  const p=Object.fromEntries(Object.entries(RECEIVER_DEFAULTS).map(([key,value])=>[key,clamp(finite(input[key],value))]));
  return {
    weights:[1-p.sideband*.64,p.sideband*.32,p.sideband*.32],
    detunes:[0,-18*p.spread,18*p.spread],
    noiseGain:p.air*.13,
    driftCents:p.drift*4,
    bandwidthRatio:1.35+Math.pow(p.bandwidth,1.7)*28,
    noiseCentreRatio:1.8+p.bandwidth*4
  };
}

function receiverNoise(context){
  let buffer=noiseBuffers.get(context);
  if(buffer)return buffer;
  buffer=context.createBuffer(1,Math.max(1,Math.round(context.sampleRate*2)),context.sampleRate);
  const data=buffer.getChannelData(0);let seed=0x5a7c13;
  // One context-local loop is shared by every voice. It contains no DC bias and
  // never needs per-frame noise generation or a worker to make sound.
  let mean=0;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;mean+=data[i];}
  mean/=data.length;for(let i=0;i<data.length;i++)data[i]-=mean;
  noiseBuffers.set(context,buffer);return buffer;
}

/** Three gently beating tonal oscillators and a quiet band-limited air bed.
 * All sources enter the host's contact envelope, filter, pan and master meter;
 * release and panic therefore silence the noise together with the pitched tone. */
export function createReceiverVoice(context,frequency,options,when){
  const output=context.createGain(),body=context.createBiquadFilter(),drift=context.createOscillator(),driftGain=context.createGain();
  const tones=Array.from({length:3},(_,i)=>({oscillator:context.createOscillator(),gain:context.createGain(),index:i}));
  const noise=context.createBufferSource(),noiseFilter=context.createBiquadFilter(),noiseGain=context.createGain();
  const nodes=[output,body,drift,driftGain,...tones.flatMap(t=>[t.oscillator,t.gain]),noise,noiseFilter,noiseGain];
  const sources=[...tones.map(t=>t.oscillator),drift,noise];
  let started=false,disposed=false;
  body.type='lowpass';body.Q.value=.55;body.connect(output);
  drift.type='sine';drift.frequency.value=.09+(frequency%17)/17*.055;drift.connect(driftGain);
  for(const tone of tones){tone.oscillator.type=tone.index?'triangle':'sine';tone.oscillator.connect(tone.gain);tone.gain.connect(body);driftGain.connect(tone.oscillator.detune);}
  noise.buffer=receiverNoise(context);noise.loop=true;noiseFilter.type='bandpass';noiseFilter.Q.value=.7;noise.connect(noiseFilter);noiseFilter.connect(noiseGain);noiseGain.connect(body);
  const set=(param,value,time,smooth)=>{
    param.cancelScheduledValues(time);
    if(smooth)param.setTargetAtTime(value,time,smooth);else param.setValueAtTime(value,time);
  };
  function tune(hz,next,time,initial=false){
    const spectrum=receiverSpectrum(next),glide=initial?0:clamp(finite(next.glide,.07),.003,1),ease=initial?0:.035;
    const safeHz=clamp(finite(hz,frequency),10,context.sampleRate*.43),detune=clamp(finite(next.detune,0),-1200,1200);
    for(const tone of tones){set(tone.oscillator.frequency,safeHz,time,glide);set(tone.oscillator.detune,detune+spectrum.detunes[tone.index],time,glide);set(tone.gain.gain,spectrum.weights[tone.index],time,ease);}
    set(driftGain.gain,spectrum.driftCents,time,ease);
    set(body.frequency,clamp(safeHz*spectrum.bandwidthRatio,25,context.sampleRate*.43),time,ease);
    set(noiseFilter.frequency,clamp(safeHz*spectrum.noiseCentreRatio,80,context.sampleRate*.4),time,ease);
    set(noiseGain.gain,spectrum.noiseGain,time,ease);
  }
  tune(frequency,options,when,true);
  return {
    carrier:tones[0].oscillator,tones,nodes,sources,output,
    connect(node){output.connect(node);},
    start(time=when){if(started||disposed)return;started=true;for(const source of sources)source.start(time);},
    update(hz,next,time){if(!disposed)tune(hz,next,time);},
    stop(time){for(const source of sources)try{source.stop(time);}catch{}},
    dispose(){if(disposed)return;disposed=true;for(const source of sources){source.onended=null;try{source.stop();}catch{}}for(const node of nodes)try{node.disconnect();}catch{}}
  };
}
