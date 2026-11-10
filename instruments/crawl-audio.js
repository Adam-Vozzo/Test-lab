import {clamp} from './kit.js';

const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const blend=(current,target,dt,attack=.035,release=.22)=>current+(target-current)*(1-Math.exp(-dt/(target>current?attack:release)));
const ZERO=()=>({level:0,bass:0,mid:0,treble:0,attack:0});
const WEIGHTS={centipede:[.85,.3,.1],spider:[.1,.45,.9],beetle:[1,.25,.08],mantis:[.12,.7,.65],scorpion:[.65,.65,.2]};
const weighted=(frame,weights)=>(frame.bass*weights[0]+frame.mid*weights[1]+frame.treble*weights[2])/(weights[0]+weights[1]+weights[2]);

/** Measured output only: transport state and note schedules never drive this.
 * The collection analyser is a parallel, post-master 512-sample FFT with Web
 * Audio's default -100..-30dB range. RMS gates stale FFT data during silence. */
export class CrawlAudioResponse{
 constructor(){this.reset();}
 reset(){this.time=0;this.envelope=ZERO();this.slow=ZERO();this.history=[];}
 update(snapshot={},dt=1/60,{sampleRate=48000,sensitivity=1.2}={}){
  dt=clamp(finite(dt),0,.1);if(!dt)return this.envelope;
  this.time+=dt;
  const rms=clamp(finite(snapshot.rms)),gain=clamp(finite(sensitivity,1.2),0,3),level=rms>.0003?1-Math.exp(-(rms-.0003)*12*gain):0;
  const frequency=snapshot.frequency,bands=[0,0,0],rate=clamp(finite(sampleRate,48000),8000,192000);
  if(level>0&&frequency?.length){
   const binHz=rate/(frequency.length*2);
   for(let i=1;i<frequency.length;i++){
    const hz=i*binHz,value=clamp(finite(frequency[i]));if(hz<35||hz>12000||!value)continue;
    const power=Math.pow(10,(-100+value*70)/10);bands[hz<320?0:hz<2400?1:2]+=power;
   }
  }
  const total=bands.reduce((a,b)=>a+b,0),target={level,bass:0,mid:0,treble:0};
  for(const [i,key]of ['bass','mid','treble'].entries())target[key]=total>1e-12?level*Math.sqrt(bands[i]/total):0;
  let spectralRise=0;
  for(const key of ['level','bass','mid','treble']){
   this.envelope[key]=blend(this.envelope[key],target[key],dt,key==='level'?.025:.035,.22);
   this.slow[key]=blend(this.slow[key],target[key],dt,.22,.32);
   if(key!=='level')spectralRise+=Math.max(0,this.envelope[key]-this.slow[key]);
  }
  const rise=Math.max(0,this.envelope.level-this.slow.level-.035),onset=level>0?clamp((rise*2.8+spectralRise*.65)*Math.min(1,level*2)):0;
  this.envelope.attack=Math.max(this.envelope.attack*Math.exp(-dt/.16),onset);
  for(const key of Object.keys(this.envelope))if(this.envelope[key]<.00001)this.envelope[key]=0;
  this.history.push({time:this.time,...this.envelope});
  while(this.history.length>180||this.history.length>1&&this.history[1].time<this.time-.7)this.history.shift();
  return this.envelope;
 }
 sample(delay){
  const time=this.time-delay,history=this.history;if(!history.length||time<history[0].time)return ZERO();
  for(let i=history.length-1;i>0;i--)if(history[i-1].time<=time){
   const a=history[i-1],b=history[i],t=clamp((time-a.time)/Math.max(.00001,b.time-a.time)),out=ZERO();
   for(const key of Object.keys(out))out[key]=a[key]+(b[key]-a[key])*t;return out;
  }
  return history[0];
 }
 assign(creatures){
  for(const creature of creatures){
   const weights=WEIGHTS[creature.kind]||WEIGHTS.spider,frame=this.envelope;
   const level=clamp(frame.level*.28+weighted(frame,weights)*.88);
   const segments=Array.from({length:creature.segments.length},(_,index)=>{const delayed=this.sample(index*.024);return clamp(weighted(delayed,weights)*.85+delayed.level*.15+delayed.attack*.28);});
   creature.audio={level,bass:frame.bass,mid:frame.mid,treble:frame.treble,attack:frame.attack,segments};
  }
 }
}
