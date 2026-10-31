/* Independent dotted filaments shared by both halves of the instrument.
 * They express the voices/filter without claiming to be a measured spectrum. */
const TAU = Math.PI * 2;
export const ASCII_GLYPHS = '.,:;+=x*#%@';
export const asciiGlyphIndex = value => Math.min(ASCII_GLYPHS.length-1,Math.floor(Math.sqrt(Math.max(0,Math.min(1,Number.isFinite(value)?value:0)))*ASCII_GLYPHS.length));
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number.isFinite(+n) ? +n : a));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const amount = (v, key, fallback, min = 0, max = 2) => v[key] == null ? fallback : clamp(v[key], min, max);
const point = (p, fallback) => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : fallback;
const tint = (hex, light, white=0) => {const raw=/^#[0-9a-f]{6}$/i.test(hex||'')?hex:'#79d9ff';const n=parseInt(raw.slice(1),16);return 'rgb('+[n>>16,n>>8&255,n&255].map(v=>Math.round(lerp(v*light,255,white))).join(',')+')';};
const cloneActivity = a => ({ ...a, sound: {...a.sound}, sequence: {...a.sequence}, voices: (a.voices || []).map(voice => ({ ...voice })) });
const noise = (n, seed) => {let h=Math.imul((n+1)^seed,1597334677);h=Math.imul(h^(h>>>16),2246822519);return((h^(h>>>13))>>>0)/4294967296;};

function cubic(a, b, c, d, t) {
  const k = 1 - t;
  return { x: k*k*k*a.x + 3*k*k*t*b.x + 3*k*t*t*c.x + t*t*t*d.x,
    y: k*k*k*a.y + 3*k*k*t*b.y + 3*k*t*t*c.y + t*t*t*d.y };
}

/** A damped elastic backbone with its source and destination pinned.
 * Coordinates are offsets from the live chord, in CSS pixels. Moving that
 * chord leaves the interior behind; springs carry the tug down the chain. */
export class ElasticTrail {
  constructor(segments=24){
    this.segments=segments;
    this.x=new Float64Array(segments+1);this.y=new Float64Array(segments+1);
    this.vx=new Float64Array(segments+1);this.vy=new Float64Array(segments+1);
    this.input={x:0,y:0};
  }
  reset(){for(const a of [this.x,this.y,this.vx,this.vy])a.fill(0);this.input={x:0,y:0};}
  step(delta,dt,{tension=.55,damping=.6,limit=180}={}){
    const elapsed=clamp(dt,0,1),n=this.segments;
    const inputX=Number.isFinite(delta.x)?delta.x:0,inputY=Number.isFinite(delta.y)?delta.y:0;
    const length=Math.hypot(inputX,inputY),scale=length>limit?limit/length:1;
    const dx=inputX*scale,dy=inputY*scale;
    this.input={x:dx,y:dy};
    if(!elapsed)return;
    const steps=Math.max(1,Math.ceil(elapsed*180)),h=elapsed/steps;
    const waveSpeed=.45+clamp(tension,0,1)*1.25,k=(waveSpeed*n)**2;
    const drag=.8+clamp(damping,.15,1)*5.8;
    for(let step=0;step<steps;step++){
      // Distribute the measured gesture over this frame's substeps. This
      // gives the same lag for a smooth drag at 30, 60 or irregular FPS.
      for(let i=1;i<n;i++){const follow=1-i/n;this.x[i]-=dx/steps*follow;this.y[i]-=dy/steps*follow;}
      for(let i=1;i<n;i++){
        this.vx[i]+=(k*(this.x[i-1]+this.x[i+1]-2*this.x[i])-drag*this.vx[i])*h;
        this.vy[i]+=(k*(this.y[i-1]+this.y[i+1]-2*this.y[i])-drag*this.vy[i])*h;
      }
      for(let i=1;i<n;i++){
        this.x[i]+=this.vx[i]*h;this.y[i]+=this.vy[i]*h;
        const offset=Math.hypot(this.x[i],this.y[i]);
        if(offset>limit){const bound=limit/offset;this.x[i]*=bound;this.y[i]*=bound;this.vx[i]*=bound*.8;this.vy[i]*=bound*.8;}
      }
    }
    const stats=this.stats();if(stats.maxOffset<.0005&&stats.maxVelocity<.002)this.reset();
  }
  sample(t,variation=0){
    if(t<=0||t>=1)return{x:0,y:0};
    const u=clamp(t+Math.sin(t*Math.PI)*variation*.018,0,1)*this.segments,i=Math.floor(u),f=u-i;
    const sample=a=>{const p=a[Math.max(0,i-1)],q=a[i],r=a[Math.min(this.segments,i+1)],s=a[Math.min(this.segments,i+2)];return .5*(2*q+(r-p)*f+(2*p-5*q+4*r-s)*f*f+(-p+3*q-3*r+s)*f*f*f);};
    return{x:sample(this.x),y:sample(this.y)};
  }
  stats(){
    let maxOffset=0,maxVelocity=0,energy=0;
    for(let i=1;i<this.segments;i++){maxOffset=Math.max(maxOffset,Math.hypot(this.x[i],this.y[i]));maxVelocity=Math.max(maxVelocity,Math.hypot(this.vx[i],this.vy[i]));energy+=this.x[i]**2+this.y[i]**2+(this.vx[i]**2+this.vy[i]**2)*.025;}
    return{maxOffset,maxVelocity,energy,input:{...this.input},segments:this.segments,
      profile:Array.from({length:this.segments+1},(_,i)=>({x:this.x[i],y:this.y[i],vx:this.vx[i],vy:this.vy[i]}))};
  }
}

/** Peak reconstruction preserves a thin emission inside a larger character
 * cell. Averaging it over 12–24px would erase the actual packet radiance. */
export function sampleCellRadiance(data,width,x,y,scale=1){
  let peak=0;
  for(let row=0;row<scale;row++)for(let col=0;col<scale;col++)peak=Math.max(peak,data[((y*scale+row)*width+x*scale+col)*4+3]);
  return peak/255;
}

/** A bounded irregular path with mathematically exact projected endpoints. */
export function filamentPoint(source,destination,strand,t,c,time=0){
  if(t<=0)return{x:source.x,y:source.y,z:0};
  if(t>=1)return{x:destination.x,y:destination.y,z:0};
  const dx=destination.x-source.x,dy=destination.y-source.y,distance=Math.hypot(dx,dy);
  const ux=distance>.001?dx/distance:1,uy=distance>.001?dy/distance:0,nx=-uy,ny=ux;
  const taper=Math.pow(Math.sin(Math.PI*t),1.12);
  const scale=clamp(Math.min(c.width/1240,c.height/680),.55,1.35);
  const reach=Math.min(Math.max(90,distance*.36),c.height*.4)*(c.length/.65)*c.spread*(1+c.delay*.2);
  const motion=Number.isFinite(c.motionAmount)?c.motionAmount:.65;
  // Broad waves share a slow phase across the fan. Independent static curls
  // retain the broken-line character, while the whole field breathes as one.
  const fan=(strand.angle*.85+Math.sin(strand.phase)*.3)*reach;
  const curl=Math.sin(t*TAU*(.3+strand.curl*.75)+strand.phase)*reach*(.13+c.chaos*.4)*strand.bend;
  const sway=motion*reach*(Math.sin(time-t*Math.PI*.75)*.36+
    Math.sin(time*.53+t*Math.PI*.8+strand.phase*.18)*.16);
  const independent=motion*Math.sin(time*.67+strand.phase+t*Math.PI)*reach*c.chaos*.085;
  const depthWave=(Math.cos(t*Math.PI*(.7+strand.curl)+strand.phase)*.7+
    Math.sin(time*.61+t*Math.PI+strand.phase*.12)*motion*.3)*strand.z*c.depth;
  const cross=taper*(fan+curl+sway+independent)*(.72+c.cutoff*.32+c.resonance*.22)*(1+c.reverb*.22);
  const along=taper*(Math.sin(t*Math.PI*(.7+strand.curl)+strand.phase)*.6+
    Math.sin(time*.43+t*Math.PI+strand.phase)*motion*.4)*reach*c.chaos*(.045+c.detune*.06);
  const parallax=taper*depthWave*28*scale;
  const tug=c.elastic?c.elastic.sample(t,strand.z):{x:0,y:0};
  const influence=(c.dragStrength??1)*(.88+strand.bend*.2);
  return{x:lerp(source.x,destination.x,t)+nx*cross+ux*along+parallax*.45+tug.x*influence,
    y:lerp(source.y,destination.y,t)+ny*cross+uy*along-parallax*.7+tug.y*influence,z:depthWave*taper};
}

/** Tone only occupied raster cells; exposure cannot illuminate empty space. */
export function matrixValue(sample,v={},exposureOffset=0){
  if(!(sample>0))return 0;
  const exposure=amount(v,'matrixExposure',.6,-2,2)+(Number.isFinite(exposureOffset)?exposureOffset:0),contrast=amount(v,'matrixContrast',1,.4,2.5);
  const threshold=amount(v,'matrixThreshold',.06,0,.75);
  const value=clamp((sample*Math.pow(2,exposure)-.5)*contrast+.5,0,1);
  return value>threshold?value:0;
}

/** A wrapped Gaussian packet has no leading-edge or loop-boundary jump. */
export function flowPacket(t,head,width=.095){
  const delta=Math.atan2(Math.sin((t-head)*TAU),Math.cos((t-head)*TAU))/TAU;
  return Math.exp(-.5*(delta/width)**2);
}

/** A compact bright head with a longer wake behind it, moving toward t=1.
 * Both ends fade to zero before the circular seam, so wrapping a new emission
 * at the map never flashes a whole path or reverses its apparent direction. */
export function directionalPacket(t,head){
  const behind=Math.atan2(Math.sin((head-t)*TAU),Math.cos((head-t)*TAU))/TAU;
  const front=Math.exp(-.5*(behind/.021)**2);
  const tail=behind>0?smooth(0,.025,behind)*Math.exp(-behind/.105)*(1-smooth(.27,.42,behind)):0;
  return{head:front,tail,light:front*1.42+tail*.88};
}

/** Stops of exposure per doubling of actual post-master output RMS. */
export function outputExposure(level,response=.8){
  if(!(level>0)||!Number.isFinite(level))return 0;
  const stops=Math.log2(level/.1);
  // Smooth saturation keeps the extreme quiet/loud ends finite without a
  // hard brightness plateau as the measured level crosses a clamp boundary.
  return clamp(response,0,2)*4*Math.tanh(stops/4);
}

/** Three separable box convolutions approximate a Gaussian, in O(pixels). */
export function blurAlpha(rgba,width,height,sigma){
  const size=width*height;let a=new Float32Array(size),b=new Float32Array(size);
  for(let i=0;i<size;i++)a[i]=rgba[i*4+3];
  // Below one pixel, rounded box widths can all become one and silently
  // remove the blur. A normalized 3-tap Gaussian retains the small-radius
  // spread on Safari while preserving alpha energy away from the edges.
  if(sigma>0&&sigma<.85){
    const side=Math.exp(-.5/(sigma*sigma)),normal=1+side*2,edge=side/normal,center=1/normal;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;b[i]=a[i]*center+(x>0?a[i-1]*edge:0)+(x+1<width?a[i+1]*edge:0);}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;a[i]=b[i]*center+(y>0?b[i-width]*edge:0)+(y+1<height?b[i+width]*edge:0);}
    return a;
  }
  const ideal=Math.sqrt(4*sigma*sigma+1);let low=Math.floor(ideal);if(low%2===0)low--;
  low=Math.max(1,low);const high=low+2;
  const count=Math.round((12*sigma*sigma-3*low*low-12*low-9)/(-4*low-4));
  const pass=(input,output,r,horizontal)=>{
    if(!r){output.set(input);return;}
    const outer=horizontal?height:width,inner=horizontal?width:height;
    const index=(u,t)=>horizontal?u*width+t:t*width+u;
    const span=2*r+1;
    for(let u=0;u<outer;u++){
      let sum=0;for(let t=0;t<=r&&t<inner;t++)sum+=input[index(u,t)];
      for(let t=0;t<inner;t++){
        output[index(u,t)]=sum/span;
        const remove=t-r,add=t+r+1;
        if(remove>=0)sum-=input[index(u,remove)];if(add<inner)sum+=input[index(u,add)];
      }
    }
  };
  for(let i=0;i<3;i++){const r=((i<count?low:high)-1)/2;pass(a,b,r,true);pass(b,a,r,false);}
  return a;
}

export class SignalField {
  constructor(host, { getVisual = () => ({}), getPalette = () => ({}), getActivity = () => ({}), getAnchors = () => ({}) } = {}) {
    this.host = host;
    this.getVisual = getVisual;
    this.getPalette = getPalette;
    this.getActivity = getActivity;
    this.getAnchors = getAnchors;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'shared-signal-field';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    // A transparent particle-only surface can be depth-composited by the ring
    // without importing the sequencer/live connection arcs into its texture.
    this.particleCanvas = document.createElement('canvas');
    this.particleCtx = this.particleCanvas.getContext('2d', { alpha: true });
    this.particleVersion = 0;
    this.particleLayer = null;
    this.presentedParticleVersion = -1;
    this.lastParticleDriverFrame = -Infinity;
    this.connectionFrame = null;
    this.onParticlePresented = version => this.acceptParticleLayer(version);
    this.onParticleUnavailable = () => this.releaseParticleDepth();
    this.buckets = Array.from({ length: 16 }, () => []);
    // Emission is rasterized at one pixel per matrix cell. The visible dots
    // are a mask of this image, not individually snapped particle sprites.
    this.emissionCanvas = document.createElement('canvas');
    this.emissionCtx = this.emissionCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    this.bloomSeed = document.createElement('canvas');
    this.bloomSeedCtx = this.bloomSeed.getContext('2d', { alpha: true, willReadFrequently: true });
    this.bloomCanvas = document.createElement('canvas');
    this.bloomCtx = this.bloomCanvas.getContext('2d', { alpha: true });
    this.bloomFilterSupported = typeof this.bloomCtx.filter === 'string';
    this.strands = [];
    this.elastic = new ElasticTrail();
    this.sourceHistory = null;
    this.strandSeed = null;
    this.lastFrame = 0;
    this.energy = 0;
    this.outputLevel = 0;
    this.hasOutputSample = false;
    this.motionPhase = 0;
    this.flowPhase = 0;
    this.motionAmount = .65;
    this.exposureOffset = 0;
    this.frozenMotion = null;
    this.frozen = null;
    this.disposed = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  resize() {
    if (this.disposed) return;
    const box = this.host.getBoundingClientRect();
    this.elastic?.reset();this.sourceHistory=null;
    this.width = Math.max(1, box.width);
    this.height = Math.max(1, box.height);
    this.pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    for (const canvas of [this.canvas,this.particleCanvas]) {
      canvas.width = Math.round(this.width * this.pixelRatio);
      canvas.height = Math.round(this.height * this.pixelRatio);
    }
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.particleCtx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.presentedParticleVersion=-1;this.particleLayer=null;this.connectionFrame=null;
    for (const canvas of [this.bloomSeed, this.bloomCanvas]) {
      canvas.width = Math.max(1, Math.ceil(this.width * .5));
      canvas.height = Math.max(1, Math.ceil(this.height * .5));
    }
  }

  tick(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    // Ring rendering drives the same gated update before its final composite.
    // Do not issue a newer outside frame after that frame was acknowledged.
    if(now-this.lastParticleDriverFrame<120)return;
    if(this.presentedParticleVersion>=0)this.releaseParticleDepth();
    this.advanceParticleFrame(now);
  }

  advanceParticleFrame(now){
    const interval=(this.lastFilamentStats?.pathSamples||0)>16000?50:30;
    if(document.hidden||now-this.lastFrame<interval)return;
    const elapsed=(now-(this.lastFrame||now))/1000;
    this.lastFrame=now;this.render(elapsed);
  }

  updateParticleLayer(now=performance.now()){
    if(this.disposed)return null;
    this.lastParticleDriverFrame=now;
    this.advanceParticleFrame(now);
    return this.getParticleLayer();
  }

  getParticleLayer(){return this.particleLayer;}

  acceptParticleLayer(version){
    if(this.disposed||!this.particleLayer||version!==this.particleVersion)return false;
    if(this.presentedParticleVersion===version)return true;
    this.presentedParticleVersion=version;
    this.compositeParticleLayer();
    return true;
  }

  releaseParticleDepth(){
    this.lastParticleDriverFrame=-Infinity;
    if(this.presentedParticleVersion<0)return;
    this.presentedParticleVersion=-1;
    if(!this.disposed)this.compositeParticleLayer();
  }

  publishParticleLayer(anchors,connections=null){
    this.particleVersion++;
    this.connectionFrame=connections;
    const ring=anchors?.ring;
    this.particleLayer=ring&&[ring.x,ring.y,ring.w,ring.h].every(Number.isFinite)&&ring.w>0&&ring.h>0?{
      canvas:this.particleCanvas,width:this.width,height:this.height,pixelRatio:this.pixelRatio,
      version:this.particleVersion,ring:{...ring},source:anchors.filter?{...anchors.filter}:null,core:anchors.core?{...anchors.core}:null,
      onPresented:this.onParticlePresented,onUnavailable:this.onParticleUnavailable,
    }:null;
    this.compositeParticleLayer();
  }

  compositeParticleLayer(){
    const c=this.ctx;if(!c||this.disposed)return;
    c.clearRect(0,0,this.width,this.height);c.save();
    c.globalAlpha=1;c.globalCompositeOperation='source-over';
    const ring=this.particleLayer?.ring,clip=ring&&this.presentedParticleVersion===this.particleVersion;
    const regions=[];
    if(clip){
      const left=clamp(ring.x,0,this.width),right=clamp(ring.x+ring.w,0,this.width);
      const top=clamp(ring.y,0,this.height),bottom=clamp(ring.y+ring.h,0,this.height);
      regions.push([0,0,this.width,top],[0,bottom,this.width,this.height-bottom],
        [0,top,left,bottom-top],[right,top,this.width-right,bottom-top]);
    }else regions.push([0,0,this.width,this.height]);
    const sx=this.particleCanvas.width/this.width,sy=this.particleCanvas.height/this.height;
    for(const [x,y,w,h]of regions)if(w>0&&h>0)c.drawImage(this.particleCanvas,x*sx,y*sy,w*sx,h*sy,x,y,w,h);
    c.restore();
    if(this.connectionFrame)this.drawConnections(...this.connectionFrame);
    this.lastParticleComposite={version:this.particleVersion,depthAccepted:!!clip,regions:regions.filter(r=>r[2]>0&&r[3]>0)};
  }

  render(dt = 1 / 32) {
    const c = this.ctx;
    if (!c || this.disposed) return;
    c.clearRect(0, 0, this.width, this.height);
    this.particleCtx.clearRect(0,0,this.width,this.height);
    const visual = this.getVisual() || {}, palette = this.getPalette() || {};
    const latest = this.getActivity() || {};
    const flowElapsed=Number.isFinite(dt)?Math.max(0,dt):0;
    const elapsed=Math.min(flowElapsed,1),motionElapsed=Math.min(elapsed,.1);
    if (visual.freeze && !this.frozen) {
      this.frozen = cloneActivity(latest);
      this.frozenMotion={motion:this.motionPhase,flow:this.flowPhase,setting:amount(visual,'phase',0,0,1),
        amount:this.motionAmount,amountSetting:amount(visual,'trailMotionAmount',.65,0,1.5)};
    }
    if (!visual.freeze && this.frozen) {
      // Resume from the displayed frame, including a deliberate phase scrub.
      const scrub=amount(visual,'phase',0,0,1)-this.frozenMotion.setting;
      this.motionPhase=this.frozenMotion.motion+scrub*TAU;
      this.flowPhase=this.frozenMotion.flow+scrub;
      this.frozen=null;this.frozenMotion=null;
    }
    const activity = this.frozen || latest;
    const bpm=activity.sequence?.bpm==null?112:clamp(activity.sequence.bpm,40,220);
    const cyclesPerBeat=amount(visual,'trailFlowSpeed',.28,0,1.5);
    const anchors = this.getAnchors() || {};
    if (!anchors.sky || !anchors.ring || !anchors.core) {this.publishParticleLayer(null);return;}
    this.updateElastic(anchors,visual,elapsed);
    const voices = (activity.voices || []).filter(voice => voice.envelope > .006);
    // outputLevel is the unboosted meter after the master gain. The fallback
    // is only for older non-audio hosts; voice count never drives exposure.
    const raw=activity.outputLevel == null ? clamp(activity.level,0,1)/3.6 : clamp(activity.outputLevel,0,1);
    if(!this.hasOutputSample){this.outputLevel=raw;this.hasOutputSample=true;}
    if(!visual.freeze){
      if(raw<=.000001)this.outputLevel=0;
      else this.outputLevel+=(raw-this.outputLevel)*(1-Math.exp(-elapsed/(raw>this.outputLevel ? .12 : .6)));
      this.motionAmount+=(amount(visual,'trailMotionAmount',.65,0,1.5)-this.motionAmount)*(1-Math.exp(-motionElapsed/.28));
      if(!this.reducedMotion.matches){
        this.motionPhase+=motionElapsed*amount(visual,'trailMotionSpeed',.22,0,1)*.8;
        this.flowPhase+=flowElapsed*bpm/60*cyclesPerBeat;
      }
    }
    if(visual.freeze){const change=amount(visual,'trailMotionAmount',.65,0,1.5)-this.frozenMotion.amountSetting;this.motionAmount=clamp(this.frozenMotion.amount+change,0,1.5);}
    this.energy=smooth(.00001,.003,this.outputLevel);
    this.exposureOffset=outputExposure(this.outputLevel,amount(visual,'matrixAudioResponse',.8,0,2));
    this.lastLoudness={raw,smoothed:this.outputLevel,response:amount(visual,'matrixAudioResponse',.8,0,2),
      exposureOffset:this.exposureOffset,effectiveExposure:amount(visual,'matrixExposure',.6,-2,2)+this.exposureOffset};
    const energy=this.energy;
    if (energy < .004) {this.lastFilamentStats={strands:0,cells:0,pathSamples:0,loudness:this.lastLoudness};this.publishParticleLayer(anchors);return;}
    const scrub=visual.freeze?amount(visual,'phase',0,0,1)-this.frozenMotion.setting:0;
    const phase=visual.freeze?this.frozenMotion.motion+scrub*TAU:this.motionPhase;
    this.currentFlowPhase=visual.freeze?this.frozenMotion.flow+scrub:this.flowPhase;
    this.currentFlow={bpm,cyclesPerBeat,cyclesPerSecond:bpm/60*cyclesPerBeat,phase:this.currentFlowPhase};
    this.drawSurface(anchors, activity, visual, palette, phase, energy, voices);
    this.publishParticleLayer(anchors,[anchors,activity,visual,palette,phase,voices]);
  }

  updateElastic(anchors,v,elapsed){
    const source=point(anchors.filter,{x:anchors.sky.x+anchors.sky.w*.5,y:anchors.sky.y+anchors.sky.h*.5});
    const world=Array.isArray(anchors.filterWorld)&&anchors.filterWorld.length===3&&anchors.filterWorld.every(Number.isFinite)?anchors.filterWorld.slice():null;
    const layout=[anchors.sky.x,anchors.sky.y,anchors.sky.w,anchors.sky.h,this.width,this.height].join(',');
    const previous=this.sourceHistory;let delta={x:0,y:0};
    if(previous&&previous.layout===layout){
      if(world&&previous.world&&typeof anchors.projectFilterWorld==='function'){
        if(Math.hypot(...world.map((x,i)=>x-previous.world[i]))>1e-8){
          // Project both world positions through the current camera. Orbit,
          // pan and zoom change the view, not the crosshair's physical input.
          const old=point(anchors.projectFilterWorld(previous.world),source);
          delta={x:source.x-old.x,y:source.y-old.y};
        }
      }else if(!world&&!previous.world){
        // Older hosts can still drive the effect with screen anchors. A
        // layout-sized jump is a rebase, never a giant injected impulse.
        const dx=source.x-previous.source.x,dy=source.y-previous.source.y;
        if(Math.hypot(dx,dy)<Math.min(this.width,this.height)*.4)delta={x:dx,y:dy};
      }
    }else if(previous)this.elastic.reset();
    this.sourceHistory={source:{...source},world,layout};
    if(this.reducedMotion.matches){this.elastic.reset();return;}
    if(v.freeze)return;
    this.elastic.step(delta,elapsed,{tension:amount(v,'trailTension',.55,0,1),damping:amount(v,'trailDragDamping',.6,.15,1),limit:Math.max(30,Math.min(this.width,this.height)*.24)});
  }

  seedStrands(seed) {
    if(this.strandSeed===seed)return;
    this.strandSeed=seed;
    this.strands=Array.from({length:96},(_,i)=>{
      const r=k=>noise(i*17+k,seed);
      return {group:i%4,x:r(0),y:r(1),z:r(2)*2-1,length:.55+r(3)*.85,
        angle:r(4)*2-1,phase:r(5)*TAU,speed:.22+r(6)*.55,bend:.2+r(7)*.8,
        curl:r(8),gap:r(9),light:.58+r(10)*.42};
    });
  }

  drawSurface(a, activity, v, p, phase, energy, voices) {
    const density=amount(v,'particleDensity',.8,0,1.2),reactivity=amount(v,'reactivity',1,0,1.5);
    if(density<.005||energy<.004||reactivity<.005){this.lastFilamentStats={strands:0,cells:0,pathSamples:0};return;}
    const count=Math.round(clamp(amount(v,'strandCount',38,8,72)*density/.8,1,96));
    const requestedDots=Math.round(amount(v,'trailDotCount',80,12,240));
    // Honor the requested count on every path, even at the dense extreme.
    // Batched drawing and a slower field cadence handle the bounded 23,040
    // samples; neither size nor density silently truncates later paths.
    const dotsPerPath=requestedDots;
    const dotSize=amount(v,'trailDotSize',5.2,.6,12);
    const shape=['circle','ascii'].includes(v.matrixShape)?v.matrixShape:'square';
    const pitch=shape==='ascii'?amount(v,'matrixAsciiPitch',12,8,24):amount(v,'matrixPitch',5.5,2,18);
    const cols=Math.ceil(this.width/pitch),rows=Math.ceil(this.height/pitch);
    const sampleScale=shape==='ascii'?4:1,sampleCols=cols*sampleScale,sampleRows=rows*sampleScale;
    if(this.emissionCanvas.width!==sampleCols||this.emissionCanvas.height!==sampleRows){this.emissionCanvas.width=sampleCols;this.emissionCanvas.height=sampleRows;}
    const raster=this.emissionCtx;
    raster.setTransform(1,0,0,1,0,0);raster.clearRect(0,0,sampleCols,sampleRows);
    raster.globalCompositeOperation='lighter';raster.fillStyle='#fff';
    raster.setTransform(sampleScale/pitch,0,0,sampleScale/pitch,0,0);
    const sound=activity.sound||{},sky=a.sky,core=point(a.core,{x:this.width*.76,y:this.height*.45});
    const source=point(a.filter,{x:sky.x+sky.w*.5,y:sky.y+sky.h*.5});
    const cutoff=clamp(Math.log(Math.max(20,+activity.cutoff||2400)/20)/Math.log(1000),0,1);
    const resonance=clamp((+activity.resonance||.1)/12,0,1);
    const config={length:amount(v,'strandLength',.65,.2,1.5),chaos:amount(v,'strandChaos',.7,0,1),
      spread:amount(v,'fieldSpread',1,.3,1.8),depth:amount(v,'fieldDepth',.7,0,1.5),cutoff,resonance,
      detune:clamp((sound.detune??8)/40,0,1),reverb:clamp(sound.reverb??.22,0,.65),delay:clamp(sound.delay??.22,0,.65),
      height:this.height,width:this.width,motionAmount:this.motionAmount,elastic:this.elastic,dragStrength:amount(v,'trailDragStrength',1,0,1.5)};
    const feedback=clamp(sound.feedback??.25,0,.7);
    this.seedStrands(Math.floor(amount(v,'seed',42,0,2147483646)));
    for(const bucket of this.buckets)bucket.length=0;
    const clock=phase;
    const paths=[];let cells=0,skipped=0,arrival=0,emission=0;
    for(let i=0;i<count;i++){
      const strand=this.strands[i];
      // Every path advances by the same beats-based amount, with seeded
      // offsets that stagger emission and arrival instead of blinking the fan.
      const travel=this.currentFlowPhase;
      const head=((travel+strand.phase/TAU)%1+1)%1;
      const z=strand.z*config.depth;
      const size=dotSize*(.88+strand.z*.12);
      let visible=0;
      for(let j=0;j<dotsPerPath;j++){
        const t=(j+.5)/dotsPerPath;
        const q=filamentPoint(source,core,strand,t,config,clock);
        // A soft visibility envelope opens and closes each broken run. No
        // sample abruptly pops when a sine crosses a visibility threshold.
        const breaks=Math.sin(t*TAU*(2.1+strand.gap*2.9)-clock*.2+strand.phase);
        const run=strand.gap>.22&&t>.055&&t<.945?smooth(-.85,-.28+config.chaos*.14,breaks):1;
        const packet=directionalPacket(t,head);
        const softEnds=.7+.3*Math.pow(Math.max(0,Math.sin(t*Math.PI)),.24);
        const depthLight=clamp(.75+z*.22+q.z*.18,.4,1.2);
        const light=clamp(softEnds*depthLight*strand.light*Math.sqrt(energy)*reactivity*
          ((.105+feedback*.025)*run+packet.head*1.42+packet.tail*.88*(.55+run*.45)),0,1);
        if(q.x<-.5*size||q.y<-.5*size||q.x>this.width+.5*size||q.y>this.height+.5*size||light<.001){skipped++;continue;}
        // Canvas area sampling distributes a moving emission over adjacent
        // fixed cells. Motion changes their luminance, never the lattice.
        raster.globalAlpha=light;
        raster.fillRect(q.x-size*.5,q.y-size*.5,size,size);
        cells++;visible++;
      }
      arrival+=flowPacket(1,head,.025);
      emission+=flowPacket(0,head,.025);
      paths.push({index:i,samples:dotsPerPath,visible,head,
        headPoint:filamentPoint(source,core,strand,head,config,clock),
        tailPoint:filamentPoint(source,core,strand,(head-.08+1)%1,config,clock),
        arrival:flowPacket(1,head,.025),emission:flowPacket(0,head,.025),
        source:filamentPoint(source,core,strand,0,config,clock),midpoint:filamentPoint(source,core,strand,.5,config,clock),
        destination:filamentPoint(source,core,strand,1,config,clock)});
    }
    // Endpoints enter the same raster as every other sample, so the matrix
    // never breaks into free-floating squares at the crosshair or core.
    for(const [q,pulse]of [[source,emission],[core,arrival]]){
      raster.globalAlpha=clamp(Math.sqrt(energy)*reactivity*(.12+pulse*.32),0,1);
      raster.fillRect(q.x-dotSize*.5,q.y-dotSize*.5,dotSize,dotSize);
    }
    const input=raster.getImageData(0,0,sampleCols,sampleRows).data;
    const gap=amount(v,'matrixGap',.28,0,.8),valueSize=amount(v,'matrixValueSize',.35,0,1);
    if(shape==='ascii')this.ensureAsciiAtlas(pitch,gap,p.secondary);
    const glyphCounts=shape==='ascii'?Object.fromEntries([...ASCII_GLYPHS].map(g=>[g,0])):null;
    const luminance=new Float32Array(cols*rows);
    let litCells=0,valueSum=0,maxValue=0;
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const index=y*cols+x,value=matrixValue(sampleCellRadiance(input,sampleCols,x,y,sampleScale),v,this.exposureOffset);
      luminance[index]=value;
      if(value<=0)continue;
      // ASCII density carries brightness; fixed-size characters remain
      // legible instead of being dimmed again through size and opacity.
      const size=shape==='ascii'?pitch:pitch*(1-gap)*lerp(1,Math.sqrt(value),valueSize);
      if(glyphCounts)glyphCounts[ASCII_GLYPHS[asciiGlyphIndex(value)]]++;
      if(size<.15)continue;
      const bucket=Math.min(15,Math.floor(value*16));
      this.buckets[bucket].push((x+.5)*pitch,(y+.5)*pitch,size,value);
      litCells++;valueSum+=value;maxValue=Math.max(maxValue,value);
    }
    this.matrixFrame={luminance,cols,rows,pitch,origin:{x:0,y:0}};
    const bloom=this.drawParticleBloom(v,p,shape);
    const c=this.particleCtx;c.save();c.globalCompositeOperation='lighter';
    for(let i=0;i<this.buckets.length;i++){
      const points=this.buckets[i];if(!points.length)continue;
      const light=(i+.5)/this.buckets.length;
      if(shape==='ascii'){
        c.globalAlpha=1;
        for(let j=0;j<points.length;j+=4)this.drawAsciiGlyph(c,points[j],points[j+1],points[j+2],points[j+3]);
        continue;
      }
      c.globalAlpha=.12+light*.88;c.fillStyle=tint(p.secondary,.6+light*.4,light>.8?(light-.8)*.65:0);
      c.beginPath();
      for(let j=0;j<points.length;j+=4){
        const x=points[j],y=points[j+1],size=points[j+2];
        if(shape==='circle'){c.moveTo(x+size*.5,y);c.arc(x,y,size*.5,0,TAU);}
        else c.rect(x-size*.5,y-size*.5,size,size);
      }
      c.fill();
    }
    c.restore();
    this.lastFilamentStats={strands:count,cells:litCells,emissions:cells,pathSamples:count*dotsPerPath,requestedDots,dotsPerPath,skipped,
      dotSize,source:{...source},destination:{...core},paths,loudness:this.lastLoudness,
      motion:{phase,flowPhase:this.currentFlowPhase,amount:this.motionAmount},flow:this.currentFlow,elastic:this.elastic.stats(),endpointPulse:{emission,arrival},
      matrix:{pitch,gap,shape,cols,rows,origin:{x:0,y:0},litCells,valueSum,maxValue,
        ...(glyphCounts?{glyphRamp:ASCII_GLYPHS,glyphCounts,glyphFontSize:this.asciiAtlas.fontSize,samplePitch:pitch/sampleScale,reconstruction:'peak',glyphTransfer:'sqrt'}:{} )},bloom};
  }

  ensureAsciiAtlas(pitch,gap,color){
    const key=[pitch,gap,color].join('|');
    if(this.asciiAtlas?.key===key)return;
    const canvas=this.asciiAtlas?.canvas||document.createElement('canvas');
    const scale=2,tile=Math.ceil(pitch*scale),fontSize=pitch*(1-gap);
    canvas.width=tile*ASCII_GLYPHS.length;canvas.height=tile*2;
    const c=canvas.getContext('2d',{alpha:true});
    c.font=`600 ${fontSize*scale}px "SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace`;
    c.textAlign='center';c.textBaseline='alphabetic';
    for(let row=0;row<2;row++)for(let i=0;i<ASCII_GLYPHS.length;i++){
      const glyph=ASCII_GLYPHS[i],metrics=c.measureText(glyph);
      const ascent=metrics.actualBoundingBoxAscent??fontSize*scale*.75,descent=metrics.actualBoundingBoxDescent??fontSize*scale*.15;
      c.fillStyle=row===1?tint(color,.95):tint(color,.95,i>7?(i-7)*.025:0);
      c.fillText(glyph,(i+.5)*tile,(row+.5)*tile+(ascent-descent)*.5);
    }
    this.asciiAtlas={key,canvas,tile,fontSize};
  }

  drawAsciiGlyph(c,x,y,size,value,bloom=false){
    const atlas=this.asciiAtlas,index=asciiGlyphIndex(value);
    c.drawImage(atlas.canvas,index*atlas.tile,bloom?atlas.tile:0,atlas.tile,atlas.tile,x-size*.5,y-size*.5,size,size);
  }

  drawParticleBloom(v,p,shape){
    const strength=amount(v,'particleBloom',.4,0,2),radius=amount(v,'particleBloomRadius',5,1,24);
    const threshold=amount(v,'particleBloomThreshold',.45,0,1);
    const stats={strength,radius,threshold,cells:0,valueSum:0,method:this.bloomFilterSupported?'gaussian-filter':'gaussian-box'};
    if(strength<=0||threshold>=1)return stats;
    const seed=this.bloomSeedCtx,b=this.bloomCtx,w=this.bloomSeed.width,h=this.bloomSeed.height;
    seed.setTransform(1,0,0,1,0,0);seed.clearRect(0,0,w,h);seed.setTransform(.5,0,0,.5,0,0);
    seed.globalCompositeOperation='source-over';seed.fillStyle=tint(p.secondary,.95);
    for(const points of this.buckets)for(let j=0;j<points.length;j+=4){
      const value=(points[j+3]-threshold)/(1-threshold);
      if(value<=0)continue;
      const x=points[j],y=points[j+1],size=points[j+2];
      seed.globalAlpha=value;
      if(shape==='ascii')this.drawAsciiGlyph(seed,x,y,size,points[j+3],true);
      else if(shape==='circle'){seed.beginPath();seed.arc(x,y,size*.5,0,TAU);seed.fill();}
      else seed.fillRect(x-size*.5,y-size*.5,size,size);
      stats.cells++;stats.valueSum+=value;
    }
    if(!stats.cells)return stats;
    b.setTransform(1,0,0,1,0,0);b.clearRect(0,0,w,h);
    if(this.bloomFilterSupported){
      b.filter=`blur(${radius*.5}px)`;b.drawImage(this.bloomSeed,0,0);b.filter='none';
    }else{
      // Safari versions without Canvas2D.filter get a real separable blur,
      // rather than a square halo or a filter applied to the whole interface.
      const frame=seed.getImageData(0,0,w,h),data=frame.data;
      const alpha=blurAlpha(data,w,h,radius*.5);
      const hex=/^#[0-9a-f]{6}$/i.test(p.secondary||'')?p.secondary:'#79d9ff',rgb=parseInt(hex.slice(1),16);
      for(let i=0;i<alpha.length;i++){const j=i*4;data[j]=Math.round((rgb>>16)*.95);data[j+1]=Math.round((rgb>>8&255)*.95);data[j+2]=Math.round((rgb&255)*.95);data[j+3]=alpha[i];}
      b.putImageData(frame,0,0);
    }
    const c=this.particleCtx;c.save();c.globalCompositeOperation='lighter';c.globalAlpha=Math.min(1,strength);
    // The filtered layer contains only thresholded blue matrix cells. Gold
    // and white connections are painted later, outside this processing pass.
    c.drawImage(this.bloomCanvas,0,0,w,h,0,0,w*2,h*2);
    if(strength>1){c.globalAlpha=strength-1;c.drawImage(this.bloomCanvas,0,0,w,h,0,0,w*2,h*2);}c.restore();
    return stats;
  }

  drawConnections(a, activity, v, p, phase, voices) {
    const strength = amount(v, 'connections', 1, 0, 1);
    if (!strength || !voices.length) return;
    const c = this.ctx, portrait = !!a.portrait;
    const lineWidth = amount(v, 'signalWidth', 1.5, .5, 3);
    const core = a.core;
    const sectors = a.sectors || [];
    const filter = point(a.filter, {x:a.sky.x+a.sky.w*.5,y:a.sky.y+a.sky.h*.5});
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const sorted = [...voices].sort((x,y)=>x.envelope-y.envelope);
    for (const voice of sorted) {
      const env = clamp(voice.envelope, 0, 1);
      if (env < .012) continue;
      const sector = ((Math.floor(voice.index) || 0) % 8 + 8) % 8;
      const dest = point(sectors[sector], {x:core.x+Math.cos(sector/8*TAU)*a.ring.w*.24,y:core.y+Math.sin(sector/8*TAU)*a.ring.h*.22});
      const sequence = voice.source === 'sequence';
      const step = Number.isFinite(voice.step) ? voice.step : 0;
      const source = sequence ? point((a.steps || [])[step], filter) : filter;
      const dx = dest.x-source.x, dy = dest.y-source.y;
      let b, d;
      if (portrait) {
        const bend = Math.min(this.width*.25, 50+sector*5);
        const side = sequence ? 1 : -1;
        b = {x:source.x+side*bend,y:source.y+dy*.35};
        d = {x:dest.x+side*bend,y:dest.y-dy*.25};
      } else if (sequence) {
        const sag = Math.min(this.height-16, Math.max(source.y,dest.y)+35+sector*5);
        b = {x:source.x+dx*.36,y:sag};
        d = {x:dest.x-dx*.24,y:sag+12};
      } else {
        const lift = Math.min(a.sky.h*.62, Math.abs(dx)*.25)+12+sector*3;
        b = {x:source.x+dx*.25,y:Math.max(10,Math.min(source.y,dest.y)-lift)};
        d = {x:dest.x-dx*.22,y:Math.max(9,dest.y-lift*.72)};
      }
      const color = sequence ? p.accent || '#ffe779' : p.fg || '#f1f6ff';
      const opacity = strength * Math.sqrt(env);
      const age = Math.max(0,(Number(activity.time)||0)-(voice.started||0));
      const attack = Math.exp(-age*9);
      // A very small halo leaves the geometry sharply legible, as in the video.
      c.strokeStyle = color;
      c.globalAlpha = opacity*.15;
      c.lineWidth = lineWidth*3.2;
      c.beginPath();c.moveTo(source.x,source.y);c.bezierCurveTo(b.x,b.y,d.x,d.y,dest.x,dest.y);c.stroke();
      c.globalAlpha = opacity*(.84+attack*.16);
      c.lineWidth = lineWidth*(1.05+env*.28);
      c.beginPath();c.moveTo(source.x,source.y);c.bezierCurveTo(b.x,b.y,d.x,d.y,dest.x,dest.y);c.stroke();
      // The packet travels from source to voice. Reduced motion retains the
      // source and destination flashes but omits the moving intermediary.
      if (!this.reducedMotion.matches) {
        const duration = .23 + Math.abs(dx+dy)*.00018;
        const t = clamp(age/duration,0,1);
        if (t < 1) {
          const packet = cubic(source,b,d,dest,t);
          c.globalAlpha = opacity;
          c.fillStyle = color;
          c.beginPath();c.arc(packet.x,packet.y,2.5,0,TAU);c.fill();
          c.globalAlpha = opacity * .92;
          c.fillStyle = p.fg || '#fffce7';
          c.beginPath();c.arc(packet.x,packet.y,1.2,0,TAU);c.fill();
        }
      }
      c.fillStyle = color;
      c.globalAlpha = opacity*(.65+attack*.35);
      c.beginPath();c.arc(source.x,source.y,2+attack*2.5,0,TAU);c.fill();
      c.beginPath();c.arc(dest.x,dest.y,2.2+env*1.8,0,TAU);c.fill();
      c.globalAlpha = opacity*.5;
      c.lineWidth = .7;
      c.beginPath();c.arc(dest.x,dest.y,5+env*4+attack*4,0,TAU);c.stroke();
    }
    c.restore();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.canvas.remove();this.particleCanvas.remove();
    this.particleLayer=null;this.connectionFrame=null;
  }
}
