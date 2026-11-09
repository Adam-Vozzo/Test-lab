const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;

export const ROSES_DEFAULTS=Object.freeze({roseBody:.32,roseGlass:.72,roseDecay:.56,roseWidth:.18,roseMotion:.22,roseLayer:0});

/** The reference pairs a low harmonic bed with struck glass modes at
 * 1 : 2.5 : 4.5. A petal's glass fundamental sits two octaves above its body. */
export function rosesSpectrum(input={}){
  const p=Object.fromEntries(Object.entries(ROSES_DEFAULTS).map(([key,value])=>[key,clamp(finite(input[key],value))]));
  return {
    bodyWeights:[.62,.25,.13].map(weight=>weight*p.roseBody),
    bodyRatios:[1,1,2],bodyDetunes:[0,-9*p.roseWidth,9*p.roseWidth],
    glassWeights:[.6,.2,.2].map(weight=>weight*p.roseGlass*(1-p.roseLayer)),
    glassRatios:[4,10,18],decaySeconds:.08+p.roseDecay*p.roseDecay,
    motionCents:p.roseMotion*5
  };
}

/** The host owns touch activation, ADSR, Hold/Arp, pan and output limiting.
 * Glass decays once per strike while the body can sustain. Adjusting a control
 * never retriggers a petal or restores an already decayed partial. */
export function createRosesVoice(context,frequency,options,when){
  const output=context.createGain(),motion=context.createOscillator(),motionGain=context.createGain();
  const body=Array.from({length:3},(_,index)=>({oscillator:context.createOscillator(),gain:context.createGain(),index}));
  const glass=Array.from({length:3},(_,index)=>({oscillator:context.createOscillator(),envelope:context.createGain(),gain:context.createGain(),index,anchorTime:when+.004,anchorLevel:1,tau:0}));
  const nodes=[output,motion,motionGain,...body.flatMap(part=>[part.oscillator,part.gain]),...glass.flatMap(part=>[part.oscillator,part.envelope,part.gain])];
  const sources=[...body.map(part=>part.oscillator),...glass.map(part=>part.oscillator),motion];
  let started=false,disposed=false;
  motion.type='sine';motion.frequency.value=.17+(frequency%19)/19*.09;motion.connect(motionGain);
  for(const part of body){part.oscillator.type=part.index===1?'triangle':'sine';part.oscillator.connect(part.gain);part.gain.connect(output);motionGain.connect(part.oscillator.detune);}
  for(const part of glass){part.oscillator.type='sine';part.oscillator.connect(part.envelope);part.envelope.connect(part.gain);part.gain.connect(output);}
  const set=(param,value,time,smooth)=>{param.cancelScheduledValues(time);if(smooth)param.setTargetAtTime(value,time,smooth);else param.setValueAtTime(value,time);};
  function decay(part,tau,time,initial){
    if(!initial&&Math.abs(tau-part.tau)<1e-9)return;
    const attackEnd=when+.004;
    const level=time<attackEnd?clamp((time-when)/.004):part.anchorLevel*Math.exp(-(time-part.anchorTime)/Math.max(.001,part.tau));
    const param=part.envelope.gain;param.cancelScheduledValues(time);param.setValueAtTime(initial?0:level,time);
    if(time<attackEnd)param.linearRampToValueAtTime(1,attackEnd);
    part.anchorTime=Math.max(time,attackEnd);part.anchorLevel=time<attackEnd?1:level;part.tau=tau;
    param.setTargetAtTime(0,part.anchorTime,tau);
  }
  function tune(hz,next,time,initial=false){
    const spectrum=rosesSpectrum(next),glide=initial?0:clamp(finite(next.glide,.06),.003,1),ease=initial?0:.025;
    const safeHz=clamp(finite(hz,frequency),10,context.sampleRate*.4),detune=clamp(finite(next.detune,0),-1200,1200);
    for(const part of body){
      const requested=safeHz*spectrum.bodyRatios[part.index],fade=clamp((context.sampleRate*.45-requested)/(context.sampleRate*.1));
      set(part.oscillator.frequency,Math.min(requested,context.sampleRate*.45),time,glide);
      set(part.oscillator.detune,detune+spectrum.bodyDetunes[part.index],time,glide);
      set(part.gain.gain,spectrum.bodyWeights[part.index]*fade,time,ease);
    }
    for(const part of glass){
      const requested=safeHz*spectrum.glassRatios[part.index],fade=clamp((context.sampleRate*.45-requested)/(context.sampleRate*.1));
      set(part.oscillator.frequency,Math.min(requested,context.sampleRate*.45),time,glide);
      set(part.oscillator.detune,detune,time,glide);
      set(part.gain.gain,spectrum.glassWeights[part.index]*fade,time,ease);
      decay(part,spectrum.decaySeconds*[1,1.35,.8][part.index],time,initial);
    }
    set(motionGain.gain,spectrum.motionCents,time,ease);
  }
  tune(frequency,options,when,true);
  return {
    carrier:body[0].oscillator,body,glass,nodes,sources,output,
    connect(node){output.connect(node);},
    start(time=when){if(started||disposed)return;started=true;for(const source of sources)source.start(time);},
    update(hz,next,time){if(!disposed)tune(hz,next,time);},
    stop(time){for(const source of sources)try{source.stop(time);}catch{}},
    dispose(){if(disposed)return;disposed=true;for(const source of sources){source.onended=null;try{source.stop();}catch{}}for(const node of nodes)try{node.disconnect();}catch{}}
  };
}
