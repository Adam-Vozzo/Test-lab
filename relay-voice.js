const clamp = (value, min=0, max=1) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const HARMONIC = [1, 2, 3, 4, 5, 6];
const METAL = [1, 1.997, 2.756, 4.07, 5.404, 7.13];

export const RELAY_DEFAULTS = Object.freeze({material:.32,damping:.38,brightness:.58,strike:.28,excitation:.22});

/** Six independently damped bending modes: the fundamental stays tuned while
 * the upper modes move from a string spectrum toward a struck metal plate. */
export function relayModes(input={}) {
  const p=Object.fromEntries(Object.entries(RELAY_DEFAULTS).map(([key,value])=>[key,clamp(finite(input[key],value))]));
  const modes=HARMONIC.map((harmonic,i)=>{
    const ratio=harmonic+(METAL[i]-harmonic)*p.material;
    // Excitation position creates real spectral nodes, not an extra detune.
    const node=.12+.88*Math.abs(Math.sin(Math.PI*(.055+p.strike*.89)*(i+1)));
    const weight=node/Math.pow(i+1,1.55-p.brightness*1.18);
    const decay=(.18+4.8*Math.pow(1-p.damping,1.6))/Math.pow(ratio,.35+p.damping*1.4);
    const tail=(.018+p.excitation*.64)*Math.exp(-i*p.damping*.16);
    return {ratio,weight,decay,tail};
  });
  const total=modes.reduce((sum,mode)=>sum+mode.weight,0);
  return modes.map(mode=>({...mode,weight:mode.weight/total}));
}

/** Native Web Audio modal synthesis; no worklet, per-sample JS, or feedback loop.
 * Each mode carries its own decaying excitation and a bounded bowed component.
 * The host supplies the contact envelope, filter, panning and master limiting. */
export function createRelayVoice(context, frequency, options, when) {
  const output=context.createGain(), modes=relayModes(options).map(spec=>({
    spec, oscillator:context.createOscillator(), gain:context.createGain()
  }));
  const nodes=[output];
  let started=false, disposed=false, start=when, previous=options;
  const safeFrequency=(hz,ratio)=>clamp(hz*ratio,10,context.sampleRate*.45);
  const envelopeAt=(segment,time)=>time<segment.end
    ? segment.from+(segment.to-segment.from)*clamp((time-segment.time)/Math.max(.001,segment.end-segment.time))
    : segment.target+(segment.to-segment.target)*Math.exp(-(time-segment.end)/segment.decay);
  for(const mode of modes){
    mode.oscillator.type='sine';mode.oscillator.connect(mode.gain);mode.gain.connect(output);
    nodes.push(mode.oscillator,mode.gain);
    mode.oscillator.frequency.setValueAtTime(safeFrequency(frequency,mode.spec.ratio),when);
    mode.oscillator.detune.setValueAtTime(finite(options.detune,0),when);
    mode.gain.gain.setValueAtTime(mode.spec.weight,when);
    mode.gain.gain.setTargetAtTime(mode.spec.weight*mode.spec.tail,when+.004,mode.spec.decay);
    mode.segment={time:when,end:when+.004,from:mode.spec.weight,to:mode.spec.weight,target:mode.spec.weight*mode.spec.tail,decay:mode.spec.decay};
  }
  return {
    modes,nodes,output,
    connect(node){output.connect(node);},
    start(time=when){if(started||disposed)return;started=true;start=time;for(const mode of modes)mode.oscillator.start(time);},
    update(hz,next,time){
      if(disposed)return;
      const specs=relayModes(next),age=Math.max(0,time-start),glide=clamp(finite(next.glide,.045),.003,1);
      const timbreChanged=Object.keys(RELAY_DEFAULTS).some(key=>next[key]!==previous[key]);
      for(let i=0;i<modes.length;i++){
        const mode=modes[i],spec=specs[i],osc=mode.oscillator;
        osc.frequency.cancelScheduledValues(time);osc.frequency.setTargetAtTime(safeFrequency(hz,spec.ratio),time,glide);
        osc.detune.cancelScheduledValues(time);osc.detune.setTargetAtTime(finite(next.detune,0),time,glide);
        if(timbreChanged){
          const gain=mode.gain.gain;
          // Preserve the age of an already excited body when its material is
          // edited. Smooth to the new envelope rather than striking it again.
          const current=envelopeAt(mode.segment,time);
          const nextAge=spec.weight*(spec.tail+(1-spec.tail)*Math.exp(-age/spec.decay));
          gain.cancelScheduledValues(time);gain.setValueAtTime(current,time);
          gain.linearRampToValueAtTime(nextAge,time+.035);
          gain.setTargetAtTime(spec.weight*spec.tail,time+.035,spec.decay);
          mode.segment={time,end:time+.035,from:current,to:nextAge,target:spec.weight*spec.tail,decay:spec.decay};
        }
        mode.spec=spec;
      }
      previous=next;
    },
    stop(time){for(const mode of modes)try{mode.oscillator.stop(time);}catch{}},
    dispose(){
      if(disposed)return;disposed=true;
      for(const mode of modes){mode.oscillator.onended=null;try{mode.oscillator.stop();}catch{}}
      for(const node of nodes)try{node.disconnect();}catch{}
    }
  };
}
