import * as THREE from '../vendor/three.module.min.js';
import {createSurface,bindPointers,clamp,lerp,TAU} from './kit.js';
import {splitLayout} from '../instrument-layout.js';
import {wavetableSample,wavetableCoefficients} from '../wavetable.js';

const range=(key,label,min,max,step,unit,section,description)=>({key,label,min,max,step,unit,section,description});
export const definition={
  id:'granular',name:'Past / Future',batch:3,commonSoundControls:false,
  theme:{bg:'#090a0c',fg:'#eceeea',accent:'#e7df73',muted:'#8f999f'},
  defaultSound:{grainSize:.18,density:18,pitch:0,pitchJitter:3,position:.4,scan:.06,jitter:.12,stereo:.7,grainGain:.23,windowBeats:4,tablePosition:.35,tableWarp:.2,tableMix:.28,orbitRate:.09,orbitDepth:.25},
  defaultAppearance:{cloudSize:1.05,cloudDepth:1,pointSize:1.25,pointDensity:1,asciiSize:9,historyRows:18,traceWeight:1,grainGlow:.6,guideOpacity:.45},
  soundControls:[
    range('grainSize','Grain duration',.025,.65,.005,'s','Grains','Length of each windowed audio fragment.'),
    range('density','Grains per second',2,50,1,'Hz','Grains','Rate of genuinely scheduled buffer fragments.'),
    range('pitch','Pitch offset',-24,24,1,'st','Grains','Playback-rate transposition of each audio fragment.'),
    range('pitchJitter','Pitch scatter',0,12,.25,'st','Grains','Seeded pitch variation between scheduled grains.'),
    range('position','Read position',0,1,.001,'','Buffer','Starting position within the source buffer.'),
    range('scan','Scan speed',-.3,.3,.005,'/s','Buffer','Signed speed through the recorded buffer.'),
    range('jitter','Position scatter',0,.45,.005,'','Buffer','Spread of grain start positions around the read head.'),
    range('stereo','Stereo spread',0,1,.01,'','Output','Left/right distribution of individual fragments.'),
    range('grainGain','Output level',.04,.4,.01,'','Output','Level before overlap compensation and the output limiter.'),
    range('windowBeats','Source cycle length',.25,4,.25,'beats','Buffer','Time each of the three source windows feeds the grain scheduler.'),
    range('tablePosition','Table position',0,1,.005,'','Wavetable','Interpolates the actual periodic wavetable mixed with every grain.'),
    range('tableWarp','Table warp',0,1,.005,'','Wavetable','Changes the Fourier spectrum of the displayed and audible table.'),
    range('tableMix','Table / buffer blend',0,1,.01,'','Wavetable','Zero is buffer grains; one is the windowed wavetable oscillator.'),
    range('orbitRate','Satellite orbit rate',.01,.8,.01,'Hz','Satellite','Rate of the satellite and its actual stereo-pan modulation.'),
    range('orbitDepth','Satellite pan depth',0,.85,.01,'','Satellite','Amount of stereo panning represented by the satellite orbit.')
  ],
  appearanceControls:[
    range('cloudSize','Cloud scale',.65,1.4,.05,'×','Grain cloud','Size of the central 3D point-cloud volume.'),
    range('cloudDepth','Cloud depth',.2,1.5,.05,'×','Grain cloud','Depth of the point cloud; grain position remains anchored.'),
    range('pointSize','Point size',.5,3,.1,'px','Grain cloud','Size of individual cloud samples.'),
    range('pointDensity','Point density',.5,1.8,.1,'×','Grain cloud','Number of samples describing the cloud surface.'),
    range('asciiSize','History character size',8,14,.5,'px','History','Monospace size of the source-amplitude history.'),
    range('historyRows','History rows',8,24,1,'','History','Maximum recorded grain entries shown on the left.'),
    range('traceWeight','Trace weight',.5,2.5,.1,'px','Waveforms','Stroke width of buffer and grain waveform traces.'),
    range('grainGlow','Event glow',0,1,.05,'','Events','Glow around active grain events, independent of text.'),
    range('guideOpacity','Cloud guides',.1,.8,.05,'','Grain cloud','Opacity of the cloud wire mesh, coordinate axes, and orbit lines.')
  ]
};

const finite=(n,f=0)=>Number.isFinite(n)?n:f;
const fract=n=>n-Math.floor(n);
const hash=n=>fract(Math.sin(n*127.1+78.233)*43758.5453);
const safe=(value,min,max,fallback)=>clamp(finite(value,fallback),min,max);
// Keep the selected source through instrument switches in this tab. It is not
// uploaded or persisted as an implicit part of a small appearance preset.
let retainedSource=null;
function text(c,s,x,y,color='#9da5a8',size=10,align='left'){c.fillStyle=color;c.font=`${size}px "SFMono-Regular",Consolas,monospace`;c.textAlign=align;c.fillText(s,x,y);}
function line(c,points,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function rect(c,b,color='#41444a'){c.strokeStyle=color;c.lineWidth=.7;c.strokeRect(b.x,b.y,b.w,b.h);}

/** Hann windows have zero-valued endpoints, including at very short grains. */
export function grainWindow(amplitude=1,length=128){const data=new Float32Array(length);for(let i=0;i<length;i++)data[i]=(1-Math.cos(TAU*i/(length-1)))*.5*amplitude;return data;}

/** A deterministic source lets the instrument play immediately without capture. */
export function createSeedBuffer(context,seconds=6){
  const length=Math.floor(context.sampleRate*seconds),buffer=context.createBuffer(2,length,context.sampleRate);
  for(let channel=0;channel<2;channel++){
    const data=buffer.getChannelData(channel);let smooth=0;
    for(let i=0;i<length;i++){
      const t=i/context.sampleRate,cycle=t%1.5,env=Math.pow(Math.sin(Math.PI*cycle/1.5),2),base=146.8323839587;
      smooth=smooth*.97+(hash(i+channel*9187)*2-1)*.03;
      const harmonics=Math.sin(TAU*base*t+channel*.11)*.42+Math.sin(TAU*base*1.5*t)*.19+Math.sin(TAU*base*2.007*t+Math.sin(t*.6))*.12+Math.sin(TAU*base*3*t)*.045;
      data[i]=(harmonics*(.25+.75*env)+smooth*.35)*.64;
    }
  }
  return buffer;
}

export function grainPlan({duration,position,pitch,jitter,pitchJitter,stereo,panBias=0,gain,density},bufferDuration,index=0){
  const length=safe(duration,.025,.65,.18),semitones=safe(pitch,-48,48,0)+(hash(index+91)*2-1)*safe(pitchJitter,0,12,0),rate=2**(semitones/12);
  const bufferLength=Math.min(length*rate,Math.max(.001,bufferDuration-.001)),actualDuration=bufferLength/rate;
  const location=fract(finite(position,.4)+(hash(index+3)*2-1)*safe(jitter,0,.45,.1));
  return{duration:actualDuration,bufferLength,offset:location*Math.max(0,bufferDuration-bufferLength),position:location,pitch:semitones,rate,pan:clamp((hash(index+17)*2-1)*safe(stereo,0,1,.7)+safe(panBias,-1,1,0),-1,1),amplitude:safe(gain,.01,.5,.2)/Math.sqrt(Math.max(1,safe(density,1,50,18)*actualDuration*.8))};
}

export function retainGrainClock(next,now){return Number.isFinite(next)&&next>=now?next:now+.008;}

export function grainWindowIndex(time,epoch=0,bpm=112,beats=1){return Math.floor(Math.max(0,time-epoch)/(60/safe(bpm,40,220,112)*safe(beats,.25,4,1)))%3;}

export function grainArpDegree(time,bpm=112,division=8){return[0,2,4,6][Math.floor(Math.max(0,time)*safe(bpm,40,220,112)/60*safe(division,4,16,8)/4)%4];}

/** Bounded, look-ahead scheduled grains. No timing depends on the render loop. */
export class GrainCloud{
  constructor(audio){this.audio=audio;this.buffer=null;this.pool=new Set();this.events=[];this.serial=0;this.destroyed=false;this.seed=11;this.tables=new Map();}
  setBuffer(buffer){this.stop();this.buffer=buffer;this.events=[];}
  schedule(when,options){
    const context=this.audio.context,output=this.audio.output;if(this.destroyed||!context||!output||!this.buffer||this.pool.size>=48)return null;
    const p=grainPlan(options,this.buffer.duration,this.serial+this.seed),source=context.createBufferSource(),gain=context.createGain(),pan=context.createStereoPanner(),mix=safe(options.tableMix,0,1,0);
    when=Math.max(context.currentTime,finite(when,context.currentTime));source.buffer=this.buffer;source.playbackRate.setValueAtTime(p.rate,when);gain.gain.setValueCurveAtTime(grainWindow(p.amplitude*(1-mix)),when,p.duration);pan.pan.setValueAtTime(p.pan,when);source.connect(gain);gain.connect(pan);pan.connect(output);
    let oscillator=null,tableGain=null;if(mix>.001){const coefficients=wavetableCoefficients(options.tablePosition,options.tableWarp);let table=this.tables.get(coefficients.key);if(!table){table=context.createPeriodicWave(coefficients.real,coefficients.imag,{disableNormalization:true});this.tables.set(coefficients.key,table);if(this.tables.size>64)this.tables.delete(this.tables.keys().next().value);}oscillator=context.createOscillator();tableGain=context.createGain();oscillator.setPeriodicWave(table);oscillator.frequency.setValueAtTime(440*2**((finite(options.root,50)+p.pitch-69)/12),when);tableGain.gain.setValueCurveAtTime(grainWindow(p.amplitude*mix*.8),when,p.duration);oscillator.connect(tableGain);tableGain.connect(pan);oscillator.start(when);oscillator.stop(when+p.duration+.01);}
    const record={id:++this.serial,when,until:when+p.duration,position:p.position,offset:p.offset,bufferLength:p.bufferLength,pitch:p.pitch,pan:p.pan,duration:p.duration,level:p.amplitude,window:Math.round(safe(options.window,0,2,0)),tableMix:mix,tablePosition:finite(options.tablePosition,.35),tableWarp:finite(options.tableWarp,.2),contactId:options.contactId==null?null:String(options.contactId),root:finite(options.root,50)};
    const node={source,gain,pan,oscillator,tableGain,record};this.pool.add(node);source.onended=()=>{this.pool.delete(node);source.disconnect();gain.disconnect();pan.disconnect();if(oscillator){try{oscillator.stop();}catch{}oscillator.disconnect();tableGain.disconnect();}};source.start(when,p.offset,p.bufferLength);source.stop(when+p.duration+.01);
    this.events.push(record);if(this.events.length>180)this.events.splice(0,this.events.length-180);return record;
  }
  _stopNode(node){node.source.onended=null;try{node.source.stop();}catch{}node.source.disconnect();node.gain.disconnect();node.pan.disconnect();if(node.oscillator){try{node.oscillator.stop();}catch{}node.oscillator.disconnect();node.tableGain.disconnect();}this.pool.delete(node);}
  cancelContact(id){const key=String(id),now=this.audio.context?.currentTime??Infinity;for(const node of this.pool)if(node.record.contactId===key)this._stopNode(node);this.events=this.events.filter(e=>e.contactId!==key||e.when<=now);for(const e of this.events)if(e.contactId===key)e.until=Math.min(e.until,now);}
  stop(){for(const node of this.pool)this._stopNode(node);const now=this.audio.context?.currentTime??Infinity;this.events=this.events.filter(e=>e.when<=now);for(const e of this.events)e.until=Math.min(e.until,now);}
  destroy(){this.destroyed=true;this.stop();this.events=[];this.buffer=null;this.tables.clear();}
}

export function mount(host,api){
  const surface=createSurface(host,{label:'Buffer history and future grains. Drag the left timeline to scrub the source; drag the cloud to control grain position and pitch.',bg:'#090a0c'}),{canvas,ctx:c}=surface;
  const cloud=new GrainCloud(api.audio),contacts=new Map(),roles=new Map();let layout,lastT=0,readHead=.4,nextTime=0,lastScheduler=0,sourceName='HARMONIC BUFFER',bufferReady=false,latch=null,destroyed=false,generation=0,wasActive=false,sourcePeaks=null,cycleEpoch=0,scheduledDensity=18,windowOffsets=[-.25,0,.25],orbitOffset=0,satellite=null,satelliteScreen=null;
  const grainVisuals=new WeakMap(),waveTiles=new Map(),previewWaves=[];
  let webgl=null,scene=null,camera=null,cloudGroup=null,points=null,pointGeometry=null,pointMaterial=null,pointBase=null,pointAmount=0,axisMaterial=null,wireMaterial=null,bandCanvas=null,bandContext=null,bandTexture=null,bandMaterial=null,lastBand=-1,cloudViewport='';
  const buttons=document.createElement('div');buttons.className='granular-actions';buttons.style.cssText='position:absolute;left:24px;bottom:20px;display:flex;align-items:center;gap:8px;z-index:3;font:10px monospace;';
  const importButton=document.createElement('button');importButton.type='button';importButton.textContent='IMPORT AUDIO';importButton.setAttribute('aria-label','Import a local audio buffer');importButton.style.cssText='font:inherit;letter-spacing:.04em;padding:8px 11px;border:1px solid #5b5a47;color:#ddd9a0;background:#11120f;min-height:34px;';
  const sourceButton=document.createElement('button');sourceButton.type='button';sourceButton.textContent='RESET BUFFER';sourceButton.setAttribute('aria-label','Restore the internal harmonic buffer');sourceButton.style.cssText=importButton.style.cssText;
  const file=document.createElement('input');file.type='file';file.accept='audio/*';file.hidden=true;buttons.append(importButton,sourceButton,file);host.append(buttons);
  const onImport=()=>{api.audio.start();file.click();};importButton.addEventListener('click',onImport);
  const onReset=async()=>{const token=++generation;if(!await api.audio.start()||destroyed||token!==generation)return;retainedSource=null;setBuffer(createSeedBuffer(api.audio.context),'HARMONIC BUFFER');};sourceButton.addEventListener('click',onReset);
  const onFile=async()=>{const selected=file.files?.[0];if(!selected)return;const token=++generation;try{if(selected.size>64*1024*1024)throw new Error('Choose an audio file smaller than 64 MB');if(!await api.audio.start())throw new Error('Audio could not start');const decoded=await api.audio.context.decodeAudioData(await selected.arrayBuffer());if(destroyed||token!==generation)return;if(decoded.duration>120)throw new Error('Choose a source shorter than 2 minutes');const name=selected.name.replace(/\.[^.]+$/,'').slice(0,28).toUpperCase();retainedSource={buffer:decoded,name};setBuffer(decoded,name);api.toast('Audio buffer loaded');}catch(e){api.toast(e.message||'This audio format could not be decoded');}finally{file.value='';}};file.addEventListener('change',onFile);
  function sound(){return{...definition.defaultSound,...api.state.sound};}
  function appearance(){return{...definition.defaultAppearance,...api.state.appearance};}
  function bounds(){
    const w=surface.width,h=surface.height,m=Math.max(16,w*.02),panels=splitLayout(w,h,api.state.appearance,{pad:m,gap:18,stackPortrait:true}),L=panels.left,R=panels.right,portrait=!panels.wide,compact=!portrait&&h<520;
    if(portrait){const bottom=R.y+R.h-48;return{w,h,m,portrait,left:{x:L.x,y:L.y+32,w:L.w,h:L.h*.4},right:{x:R.x,y:R.y+25,w:R.w,h:R.h*.40},cloud:{x:w*.2,y:L.y+L.h*.42,w:w*.6,h:L.h*.40},timeline:{x:L.x,y:L.y+L.h-32,w:L.w,h:27},log:{x:R.x,y:bottom-86,w:R.w*.62,h:82},window:{x:R.x+R.w*.66,y:bottom-86,w:R.w*.34,h:82}};}
    const timelineY=compact?h-115:h*.79,timelineH=compact?31:Math.min(62,h*.085),fieldH=timelineY-65;
    return{w,h,m,portrait,left:{x:L.x,y:L.y+30,w:L.w*.70,h:fieldH},right:{x:R.x+R.w*.30,y:R.y+30,w:R.w*.70,h:fieldH},cloud:{x:L.x+L.w*.61,y:h*.105,w:R.x+R.w*.39-(L.x+L.w*.61),h:h*.62},timeline:{x:L.x,y:timelineY,w:L.w*.91,h:timelineH},log:{x:R.x,y:timelineY,w:R.w*.65,h:compact?64:h*.18},window:{x:R.x+R.w*.70,y:timelineY,w:R.w*.30,h:compact?64:h*.18}};
  }
  function setBuffer(buffer,name){cloud.setBuffer(buffer);waveTiles.clear();previewWaves.length=0;sourceName=name;bufferReady=true;readHead=sound().position;nextTime=0;sourcePeaks=makePeaks(buffer);api.save();}
  function makePeaks(buffer){const data=buffer.getChannelData(0),n=1024,peaks=new Float32Array(n);for(let i=0;i<n;i++){const from=Math.floor(i/n*data.length),to=Math.max(from+1,Math.floor((i+1)/n*data.length));let max=0;for(let j=from;j<to;j+=Math.max(1,Math.floor((to-from)/20)))max=Math.max(max,Math.abs(data[j]));peaks[i]=max;}return peaks;}
  function ensureBuffer(){if(!bufferReady&&api.audio.context){if(retainedSource)setBuffer(retainedSource.buffer,retainedSource.name);else setBuffer(createSeedBuffer(api.audio.context),'HARMONIC BUFFER');}}
  function inBox(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
  function windowBoxes(){const b=layout.right,top=b.y+b.h*.26,gap=b.h*.22;return Array.from({length:3},(_,i)=>({x:b.x,y:top+i*gap,w:b.w,h:gap*.79}));}
  const unbind=bindPointers(canvas,{down(p){surface.resize();layout=bounds();const lane=windowBoxes().findIndex(b=>inBox(p,b)),role=inBox(p,layout.window)?'table':satelliteScreen&&Math.hypot(p.x-satelliteScreen.x,p.y-satelliteScreen.y)<22?'satellite':inBox(p,layout.timeline)?'timeline':lane>=0?`future${lane}`:inBox(p,layout.left)?'history':inBox(p,layout.cloud)?'cloud':null;if(!role)return false;roles.set(p.id,role);setContact(p,role);api.audio.start().then(ok=>{if(ok&&!destroyed&&(contacts.has(p.id)||api.state.hold)){ensureBuffer();schedule();}});},move(p){const role=roles.get(p.id);if(role)setContact(p,role);},up:release,cancel:cancelContact});
  function setContact(p,role){const window=role.startsWith('future')?Number(role.at(-1)):null,box=role==='table'?layout.window:role==='timeline'?layout.timeline:role==='history'?layout.left:window!==null?windowBoxes()[window]:layout.cloud,nx=clamp((p.x-box.x)/box.w,0,1),ny=clamp((p.y-box.y)/box.h,0,1),q={id:p.id,x:p.x,y:p.y,role,position:readHead,pitch:0,window};
    if(role==='table'){const warp=clamp((p.x-box.x-5)/Math.max(1,box.w-10),0,1),position=1-clamp((p.y-box.y-20)/Math.max(14,box.h-42),0,1);api.setSound?.({tablePosition:position,tableWarp:warp});api.setStatus(`TABLE ${position.toFixed(2)} · WARP ${warp.toFixed(2)}`);}
    else if(role==='satellite'){const angle=Math.atan2(p.y-(box.y+box.h*.5),p.x-(box.x+box.w*.5)),distance=Math.hypot(nx-.5,ny-.5),previous=contacts.get(p.id),now=api.audio.context?.currentTime||0;q.angle=previous?previous.angle+Math.atan2(Math.sin(angle-previous.pointerAngle),Math.cos(angle-previous.pointerAngle)):panPhase(now);q.pointerAngle=angle;q.startDistance=previous?.startDistance??distance;q.startDepth=previous?.startDepth??sound().orbitDepth;orbitOffset=q.angle-now*sound().orbitRate*TAU;const depth=clamp(q.startDepth+(distance-q.startDistance)*1.6,0,.85);api.setSound?.({orbitDepth:depth});api.setStatus(`PAN ORBIT ${depth.toFixed(2)}`);}
    else{q.position=role==='history'?1-ny:nx;q.pitch=role==='timeline'?0:Math.round((.5-ny)*24);if(window!==null)windowOffsets[window]=q.position-readHead;else{readHead=q.position;api.setSound?.({position:readHead});}api.setStatus(`${(q.position*(cloud.buffer?.duration||6)).toFixed(2)} s · ${q.pitch>0?'+':''}${q.pitch} st`);}
    contacts.set(p.id,q);latch=q;const fingers=[...contacts.values()].filter(v=>v.role==='cloud');if(fingers.length>=2){const distance=Math.hypot(fingers[0].x-fingers[1].x,fingers[0].y-fingers[1].y)/Math.max(1,layout.cloud.w);api.setSound?.({pitchJitter:clamp(distance*20,0,12),stereo:clamp(distance*1.8,0,1)});}
  }
  function release(p){const q=contacts.get(p.id);if(q?.role==='satellite')orbitOffset=q.angle-(api.audio.context?.currentTime||0)*sound().orbitRate*TAU;contacts.delete(p.id);roles.delete(p.id);if(!api.state.hold&&!contacts.size)latch=null;api.save();}
  function cancelContact(p){const q=contacts.get(p.id);if(q?.role==='satellite')orbitOffset=q.angle-(api.audio.context?.currentTime||0)*sound().orbitRate*TAU;contacts.delete(p.id);roles.delete(p.id);if(latch?.id===p.id)latch=[...contacts.values()].at(-1)||null;cloud.cancelContact(p.id);if(!contacts.size&&!api.state.playing&&!(api.state.hold&&latch)){cloud.stop();nextTime=0;wasActive=false;}api.save();}
  function panPhase(time){return [...contacts.values()].find(q=>q.role==='satellite')?.angle??time*sound().orbitRate*TAU+orbitOffset;}
  function schedule(){
    if(destroyed)return;const ctx=api.audio.context;if(!ctx||ctx.state!=='running')return;ensureBuffer();const now=ctx.currentTime,z=sound(),active=api.state.playing||contacts.size>0||(api.state.hold&&latch);
    if(!api.state.hold&&!contacts.size)latch=null;
    if(!active){wasActive=false;lastScheduler=now;return;}if(!wasActive)cycleEpoch=now+.008;wasActive=true;
    const elapsed=clamp(now-lastScheduler,0,.1);lastScheduler=now;if(!contacts.size&&!api.state.hold)readHead=fract(readHead+z.scan*elapsed);
    if(z.density!==scheduledDensity){const last=cloud.events.at(-1);nextTime=Math.max(now+.008,last?last.when+1/z.density:now+.008);scheduledDensity=z.density;}nextTime=retainGrainClock(nextTime,now);
    let safety=0;while(nextTime<now+.11&&safety++<12){
      const list=[...contacts.values()].filter(q=>!['table','satellite'].includes(q.role)),contact=list.length?list[cloud.serial%list.length]:latch,window=contact?.window??grainWindowIndex(nextTime,cycleEpoch,api.state.bpm,z.windowBeats),position=contact?.window!==null&&contact?.window!==undefined?contact.position:fract((contact&&!['table','satellite'].includes(contact.role)?contact.position:readHead)+windowOffsets[window]);
      let pitch=z.pitch+(contact?.pitch||0);if(api.state.arp)pitch+=api.quantize(grainArpDegree(nextTime,api.state.bpm,api.state.arpRate))-api.state.root;
      cloud.schedule(nextTime,{duration:z.grainSize,position,pitch,jitter:z.jitter,pitchJitter:z.pitchJitter,stereo:z.stereo,panBias:Math.sin(panPhase(nextTime))*z.orbitDepth,gain:z.grainGain,density:z.density,window,contactId:contact?.id??null,tableMix:z.tableMix,tablePosition:z.tablePosition,tableWarp:z.tableWarp,root:api.state.root});nextTime+=1/z.density;
    }
  }
  const timer=setInterval(schedule,25);

  function initWebGL(){
    try{
      webgl=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'low-power'});webgl.setClearColor(0,0);webgl.setPixelRatio(Math.min(devicePixelRatio||1,1.5));webgl.domElement.style.cssText='position:absolute;pointer-events:none;z-index:1;';host.append(webgl.domElement);
      scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,.1,30);camera.position.set(0,.18,4.8);camera.lookAt(0,0,0);cloudGroup=new THREE.Group();scene.add(cloudGroup);
      pointMaterial=new THREE.PointsMaterial({color:'#eaf1f0',size:1.25,transparent:true,opacity:.82,depthWrite:false,sizeAttenuation:false});
      axisMaterial=new THREE.LineBasicMaterial({color:'#5f9ebc',transparent:true,opacity:.38});wireMaterial=new THREE.LineBasicMaterial({color:'#e5efed',transparent:true,opacity:.17,depthWrite:false});
      const shell=new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(.997,44,28)),wireMaterial);cloudGroup.add(shell);
      const core=new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.TorusGeometry(.49,.23,16,48)),new THREE.LineBasicMaterial({color:'#f5f5e9',transparent:true,opacity:.27,depthWrite:false}));core.rotation.x=.8;core.rotation.y=.5;cloudGroup.add(core);
      for(const [from,to]of [[[-1.4,0,0],[1.4,0,0]],[[0,-1.4,0],[0,1.4,0]],[[0,0,-1.4],[0,0,1.4]]]){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from),new THREE.Vector3(...to)]);cloudGroup.add(new THREE.Line(g,axisMaterial));}
      for(let k=0;k<2;k++){const pts=[];for(let i=0;i<=130;i++){const a=i/130*TAU;pts.push(new THREE.Vector3(Math.cos(a)*1.31,Math.sin(a)*.13,Math.sin(a)*1.08));}const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),axisMaterial);line.rotation.z=k?.47:-.37;line.rotation.x=k?.38:-.15;cloudGroup.add(line);}
      satellite=new THREE.Points(new THREE.SphereGeometry(.092,14,10),new THREE.PointsMaterial({color:'#efe898',size:2,transparent:true,opacity:.96,depthWrite:false,sizeAttenuation:false}));scene.add(satellite);
      bandCanvas=document.createElement('canvas');bandCanvas.width=768;bandCanvas.height=128;bandContext=bandCanvas.getContext('2d');bandTexture=new THREE.CanvasTexture(bandCanvas);bandTexture.generateMipmaps=false;bandTexture.minFilter=THREE.LinearFilter;bandMaterial=new THREE.MeshBasicMaterial({map:bandTexture,transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
      for(let i=0;i<4;i++){const band=new THREE.Mesh(new THREE.PlaneGeometry(2.03,.34),bandMaterial);band.position.set(0,i===3?0:(i-1)*.24,.11-i*.06);band.rotation.y=i===1?Math.PI/2:.12;band.rotation.z=i===3?Math.PI/2:i===2?-.13:0;cloudGroup.add(band);}
    }catch{webgl?.dispose();webgl?.domElement.remove();webgl=null;}
  }
  initWebGL();
  function makeCloud(density){
    const rings=Math.round(49*density),columns=132,count=rings*columns;pointBase=new Float32Array(count*3);const positions=new Float32Array(count*3);
    for(let i=0;i<rings;i++)for(let j=0;j<columns;j++){const k=(i*columns+j)*3,lat=(i+.5)/rings*Math.PI,lon=(j+(i%2)*.5)/columns*TAU;pointBase[k]=Math.sin(lat)*Math.cos(lon);pointBase[k+1]=Math.cos(lat);pointBase[k+2]=Math.sin(lat)*Math.sin(lon);}
    positions.set(pointBase);if(points){cloudGroup.remove(points);pointGeometry.dispose();}pointGeometry=new THREE.BufferGeometry();pointGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));points=new THREE.Points(pointGeometry,pointMaterial);cloudGroup.add(points);pointAmount=density;
  }
  function amplitudeCode(data,start,span,count,row=0){
    // Signed source amplitude, quantized into an ordered glyph ramp. Quiet
    // samples retain whitespace, so source dynamics remain visible as bands.
    const positive='  .,:;i1tfLCG08MW$#',negative='  .,:;l1frxcg08mw&%';let code='';for(let j=0;j<count*2;j++){const q=fract(start+(j/(count*2)+row*.173)*span),sample=data?data[Math.floor(q*(data.length-1))]:0,ramp=sample>=0?positive:negative,level=Math.pow(clamp(Math.abs(sample)*3.6,0,1),.73);code+=ramp[Math.min(ramp.length-1,Math.floor(level*ramp.length))];}return code;
  }
  function sourceLevel(data,start,span){if(!data)return 0;let sum=0;for(let j=0;j<24;j++){const sample=data[Math.floor(fract(start+j/24*span)*(data.length-1))];sum+=sample*sample;}return Math.sqrt(sum/24);}
  function visualFor(e){let cached=grainVisuals.get(e);if(!cached){const data=cloud.buffer?.getChannelData(0),duration=cloud.buffer?.duration||6;cached={codes:new Map(),energy:sourceLevel(data,e.offset/duration,e.bufferLength/duration),wave:null};grainVisuals.set(e,cached);}return cached;}
  function grainCode(e,count,row){const cached=visualFor(e),key=`${count}:${row}`;if(!cached.codes.has(key)){const duration=cloud.buffer?.duration||6;cached.codes.set(key,amplitudeCode(cloud.buffer?.getChannelData(0),e.offset/duration,e.bufferLength/duration,count,row));while(cached.codes.size>32)cached.codes.delete(cached.codes.keys().next().value);}return cached.codes.get(key);}
  function updateBand(t,active){
    if(!bandContext||t-lastBand<.07)return;lastBand=t;const ctx=bandContext;ctx.clearRect(0,0,768,128);const data=cloud.buffer?.getChannelData(0);if(!data)return;ctx.font='bold 14px monospace';ctx.fillStyle='#ffffff';ctx.shadowColor='#dceaff';ctx.shadowBlur=1.2;
    for(let row=0;row<8;row++){const e=active[row%Math.max(active.length,1)],duration=cloud.buffer?.duration||6,span=sound().grainSize/duration,code=e?grainCode(e,45,row):amplitudeCode(data,readHead,span,45,row);ctx.fillText(code,0,14+row*15);}ctx.shadowBlur=0;bandTexture.needsUpdate=true;
  }
  function drawCloud(t,snap,v){
    const b=layout.cloud,now=snap.time,active=cloud.events.filter(e=>e.when<=now&&e.until>now),ambient=api.reducedMotion?0:t;if(webgl){
      if(!pointBase||pointAmount!==v.pointDensity)makeCloud(v.pointDensity);const data=pointGeometry.attributes.position.array;
      for(let i=0;i<pointBase.length;i+=3){const x=pointBase[i],y=pointBase[i+1],z=pointBase[i+2],latitude=(y+1)*.5;let bump=0;for(const e of active){const d=latitude-e.position,env=Math.sin(Math.PI*(now-e.when)/e.duration);bump+=Math.exp(-d*d*75)*env*(.018+Math.abs(e.pitch)*.002);}
        const r=1+Math.min(.14,bump)+Math.sin(y*5+ambient*.24)*.01;data[i]=x*r;data[i+1]=y*r;data[i+2]=z*r;
      }
      pointGeometry.attributes.position.needsUpdate=true;pointMaterial.size=v.pointSize;pointMaterial.opacity=.76+clamp(Math.sqrt(snap.rms||0)*.5,0,.24);axisMaterial.opacity=v.guideOpacity*.85;wireMaterial.opacity=.035+v.guideOpacity*.11;cloudGroup.scale.set(v.cloudSize,v.cloudSize,v.cloudSize*v.cloudDepth);cloudGroup.rotation.set(.18,ambient*.035,-.13);updateBand(t,active);const z=sound(),phase=panPhase(now);satellite.position.set(Math.sin(phase)*1.32*v.cloudSize,Math.cos(phase)*.33*v.cloudSize,Math.cos(phase)*1.05*v.cloudSize);satellite.scale.setScalar(.85+z.orbitDepth*.7);
      const el=webgl.domElement;el.style.left=`${b.x}px`;el.style.top=`${b.y}px`;el.style.width=`${b.w}px`;el.style.height=`${b.h}px`;const viewport=`${b.w}:${b.h}:${webgl.getPixelRatio()}`;if(cloudViewport!==viewport){webgl.setSize(b.w,b.h,false);camera.aspect=b.w/b.h;camera.updateProjectionMatrix();cloudViewport=viewport;}webgl.render(scene,camera);const projected=satellite.position.clone().project(camera);satelliteScreen={x:b.x+(projected.x*.5+.5)*b.w,y:b.y+(.5-projected.y*.5)*b.h};
    }else{
      const radius=Math.min(b.w,b.h)*.37*v.cloudSize;c.save();c.translate(b.x+b.w*.5,b.y+b.h*.5);for(let i=0;i<40;i++){const y=(i/39-.5)*radius*2,rr=Math.sqrt(Math.max(0,radius*radius-y*y));for(let j=0;j<100;j++){const th=j/100*TAU+ambient*.035,x=Math.cos(th)*rr,z=Math.sin(th)*rr;c.fillStyle=`rgba(225,235,232,${.4+(z/radius+1)*.28})`;c.fillRect(x,y+z*.18*v.cloudDepth,v.pointSize,v.pointSize);}}c.restore();
    }
    if(satelliteScreen)text(c,`PAN ${(Math.sin(panPhase(now))*sound().orbitDepth).toFixed(2)} · ${sound().orbitRate.toFixed(2)} Hz`,b.x+b.w*.5,b.y+b.h-6,'#b7b88b',8,'center');
    for(const q of contacts.values()){c.strokeStyle='#e5df7c';c.lineWidth=.8;c.beginPath();c.arc(q.x,q.y,9,0,TAU);c.stroke();}
  }
  function drawOutput(snap,v,b,height){
    const events=cloud.events.filter(e=>e.when<=snap.time),data=cloud.buffer?.getChannelData(0),duration=cloud.buffer?.duration||6,cell=(b.w-14)/3;
    for(let slot=0;slot<3;slot++){const e=events.findLast(e=>e.window===slot),x=b.x+slot*(cell+7),y=b.y+18,h=height-18;line(c,[[x,y+h*.5],[x+cell,y+h*.5]],'#303739',.6);text(c,`W${slot+1}`,x,y-5,e?'#c8dfad':'#596866',7);if(!e||!data)continue;const cache=visualFor(e),key=`${cell}:${h}`;if(cache.outputKey!==key){const path=new Path2D();for(let j=0;j<Math.ceil(cell);j++){const u=j/cell,idx=Math.min(data.length-1,Math.floor((e.offset+u*e.bufferLength)/duration*data.length)),frequency=440*2**((e.root+e.pitch-69)/12),sample=(data[idx]*(1-e.tableMix)+wavetableSample(u*e.duration*frequency*TAU,e.tablePosition,e.tableWarp)*e.tableMix*.8)*Math.sin(Math.PI*u)**2;path[j?'lineTo':'moveTo'](j,h*.5-clamp(sample*1.7,-1,1)*h*.42);}cache.outputPath=path;cache.outputKey=key;}c.save();c.translate(x,y);c.strokeStyle=e.until>snap.time?'#f2edb0':'#b5c1bc';c.lineWidth=v.traceWeight;c.stroke(cache.outputPath);c.restore();}
  }
  function drawHistory(t,snap,v){
    const b=layout.left,now=snap.time,size=v.asciiSize,lineH=size*1.12,entryH=lineH*3.15,outputH=Math.max(38,Math.min(82,b.h*.18)),start=b.y+outputH+25,rows=Math.max(1,Math.min(Math.round(v.historyRows),Math.floor((b.h-outputH-34)/entryH))),entries=cloud.events.filter(e=>e.when<=now).slice(-rows).reverse(),data=cloud.buffer?.getChannelData(0);
    text(c,'PAST / OUTPUT',b.x,b.y-17,'#f2f3e8',11);text(c,`${now.toFixed(2)} s`,b.x+b.w,b.y-17,'#d2d4ca',10,'right');drawOutput(snap,v,b,outputH);text(c,sourceName,b.x,start-11,'#8f9b9a',8);
    const chars=Math.max(5,Math.floor((b.w-58)/(size*.61*2)));
    for(let i=0;i<entries.length;i++){const e=entries[i],y=start+i*entryH,energy=visualFor(e).energy,alpha=(.54+clamp(Math.sqrt(energy)*.7,0,.46))*(1-i/(rows+4)*.22);text(c,`${e.window+1}.${String(e.id).padStart(3,'0')}`,b.x,y,`rgba(217,223,217,${alpha})`,size);for(let row=0;row<3;row++)text(c,grainCode(e,chars,row),b.x+50,y+row*lineH,`rgba(232,234,217,${alpha})`,size);}
    if(!entries.length){if(data){for(let i=0;i<rows;i++){text(c,'B'+String(i).padStart(3,'0'),b.x,start+i*entryH,'#727d80',size);for(let row=0;row<3;row++)text(c,amplitudeCode(data,i/rows,.05,chars,row),b.x+50,start+i*entryH+row*lineH,'#8d9593',size);}}else for(let i=0;i<rows*3;i++)text(c,'· '.repeat(chars),b.x+50,start+i*lineH,'#39434a',size);text(c,data?'BUFFER / NO GRAIN EVENTS':'NO GRAINS SCHEDULED',b.x,b.y+b.h-3,'#77818a',8);}
  }
  function waveform(box,position,length,color,weight){
    const data=sourcePeaks;c.strokeStyle=color;c.lineWidth=weight;c.beginPath();for(let i=0;i<Math.max(1,Math.floor(box.w));i++){const q=fract(position+i/box.w*length),sample=data?data[Math.floor(q*(data.length-1))]:0,yy=box.y+box.h*.5+Math.sin(i*Math.PI*.7)*sample*box.h*.65;c[i?'lineTo':'moveTo'](box.x+i,yy);}c.stroke();
  }
  function waveTile(e,index,width,height,cell,position,length){
    const key=`${e?.id||0}:${width}:${height}:${cell}:${position}:${length}`,cached=e?waveTiles.get(key):previewWaves[index];if(cached?.key===key)return cached.canvas;
    const tile=document.createElement('canvas'),ratio=Math.min(surface.dpr||1,1.5);tile.width=Math.ceil(width*ratio);tile.height=Math.ceil(height*ratio);const ctx=tile.getContext('2d'),source=cloud.buffer?.getChannelData(0);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle=e?'#e6ece2':'#adb8ac';ctx.beginPath();
    for(let x=0;x<width;x+=cell){const u=fract(position+x/width*length),offset=source?Math.floor(u*(source.length-1)):0;let peak=0;if(source)for(let k=0;k<10;k++)peak=Math.max(peak,Math.abs(source[(offset+k*3)%source.length]));const amp=Math.pow(clamp(peak*3.1,0,1),.65)*height*.5;for(let yy=-amp;yy<=amp;yy+=cell)ctx.rect(x,height*.5+yy,cell*.66,cell*.66);}ctx.fill();const record={key,canvas:tile};
    if(e){waveTiles.set(key,record);while(waveTiles.size>8)waveTiles.delete(waveTiles.keys().next().value);}else previewWaves[index]=record;return tile;
  }
  function drawFuture(snap,v){
    const b=layout.right,now=snap.time,z=sound(),events=cloud.events.filter(e=>e.when<=now),latest=events.at(-1),active=wasActive?latest?.window??grainWindowIndex(now,cycleEpoch,api.state.bpm,z.windowBeats):-1,duration=cloud.buffer?.duration||6,stepSeconds=60/api.state.bpm*z.windowBeats;
    text(c,'FUTURE / SOURCE',b.x+b.w,b.y-17,'#f2f3e8',11,'right');text(c,`${cloud.pool.size.toString().padStart(2,'0')} GRAINS`,b.x,b.y-17,'#c6da92',8);
    const guideH=b.h*.18;for(let i=0;i<6;i++){const yy=b.y+10+i*guideH/6;line(c,[[b.x,yy],[b.x+b.w,yy]],'#22282a',.6);}for(const e of cloud.events){if(e.when<now||e.when>now+.16)continue;const x=b.x+(e.when-now)/.16*b.w,y=b.y+10+(e.window*2+e.id%2)*guideH/6;c.fillStyle='#9bbcb8';c.fillRect(x,y-1,Math.max(3,e.duration*b.w*.3),2);}
    for(const [i,box]of windowBoxes().entries()){const e=events.findLast(e=>e.window===i),isActive=i===active,width=box.w*.81,height=box.h*.66,position=e?e.offset/duration:fract(readHead+windowOffsets[i]),length=(e?.bufferLength||z.grainSize)/duration,cell=Math.max(2.4,v.traceWeight*2.4),remaining=active<0?0:((i-active+3)%3)*stepSeconds+(stepSeconds-((now-cycleEpoch)%stepSeconds));
      c.globalAlpha=isActive?1:.72;c.drawImage(waveTile(e,i,width,height,cell,position,length),box.x,box.y+box.h*.18,width,height);c.globalAlpha=1;rect(c,{x:box.x-4,y:box.y-2,w:box.w+4,h:box.h},isActive?'#9da88c':'#242d2d');text(c,`W${i+1}`,box.x,box.y+5,isActive?'#e4edbc':'#87928b',8);text(c,`${remaining.toFixed(1)}`,box.x+box.w,box.y+height*.56,isActive?'#e1ef92':'#8fa479',14,'right');text(c,`${(position*duration).toFixed(2)}s`,box.x+width,box.y+box.h-3,'#85918b',7,'right');}
    text(c,`${duration.toFixed(2)} s BUFFER`,b.x,b.y+b.h+1,'#8a999b',8);text(c,`${z.windowBeats.toFixed(2)} BEATS / SOURCE`,b.x+b.w,b.y+b.h+1,'#dfe8a1',8,'right');
    for(const e of events.slice(-10)){const age=(now-e.when)/Math.max(.15,e.duration*2.5);if(age<0||age>1)continue;const source=windowBoxes()[e.window],target={x:layout.left.x+layout.left.w*(e.window+.5)/3,y:layout.left.y+33},u=1-(1-age)**2,x=lerp(source.x,target.x,u),y=lerp(source.y+source.h*.5,target.y,u)+Math.sin(age*Math.PI)*layout.cloud.h*.12;c.fillStyle=`rgba(206,226,210,${(1-age)*.65})`;c.fillRect(x,y,2,2);}
  }
  function drawTimeline(snap,v){
    const b=layout.timeline,z=sound(),duration=cloud.buffer?.duration||6;rect(c,b,'#303846');waveform(b,0,1,'#59648b',v.traceWeight);
    for(let i=0;i<=8;i++){const x=b.x+b.w*i/8;line(c,[[x,b.y+b.h-5],[x,b.y+b.h]],'#8991b0',.6);text(c,(duration*i/8).toFixed(1),x,b.y+b.h+14,'#6e7c93',8,'center');}
    const px=b.x+readHead*b.w;c.fillStyle='rgba(132,155,255,.13)';c.fillRect(px-2,b.y,4,b.h);line(c,[[px,b.y],[px,b.y+b.h]],'#a7bdff',1.5);
    text(c,`${(readHead*duration).toFixed(2)} s`,b.x,b.y-11,'#bdcae2',10);text(c,api.state.hold?'HOLD':z.scan<0?'SCAN ←':'SCAN →',b.x+b.w,b.y-11,api.state.hold?'#e7df73':'#9ca9ba',9,'right');
  }
  function drawLog(snap,v){
    const b=layout.log,now=snap.time,events=cloud.events.slice(-40);c.fillStyle='#e8df76';c.fillRect(b.x,b.y,b.w,b.h);text(c,'GRAIN LOG',b.x+7,b.y+12,'#151b18',9);text(c,`${events.length} EVENTS`,b.x+b.w-7,b.y+12,'#303725',8,'right');
    const graph={x:b.x+5,y:b.y+18,w:b.w-10,h:Math.max(13,b.h*.36)};c.fillStyle='#0b1010';c.fillRect(graph.x,graph.y,graph.w,graph.h);c.save();c.beginPath();c.rect(graph.x,graph.y,graph.w,graph.h);c.clip();
    for(const e of events){const age=now-e.when,x=graph.x+graph.w*(1-age/2.8),y=graph.y+graph.h*(1-e.position);if(x<graph.x)continue;c.strokeStyle='rgba(233,223,117,.6)';c.beginPath();c.moveTo(x,y);c.lineTo(x+e.duration/2.8*graph.w,y-e.pan*7);c.stroke();c.fillStyle=e.when<=now&&e.until>now?'#fffbc1':'#d3cd83';c.shadowBlur=e.until>now?v.grainGlow*8:0;c.shadowColor='#e8e17e';c.beginPath();c.arc(x,y,1.4+e.level*3,0,TAU);c.fill();c.shadowBlur=0;}c.restore();
    const available=b.h-graph.h-25,rows=Math.max(1,Math.floor(available/10)),logged=events.slice(-rows).reverse();for(let i=0;i<logged.length;i++){const e=logged[i],y=graph.y+graph.h+10+i*10;text(c,`${String(e.id).padStart(4,'0')} ${e.when.toFixed(2).padStart(7,' ')}  ${e.position.toFixed(3)}  ${Math.round(e.duration*1000)}ms  ${e.pitch>=0?'+':''}${e.pitch.toFixed(1)}`,b.x+7,y,'#3b442d',8);}
    drawTable(snap,v);
  }
  let tablePaths=null,tableKey='';
  function drawTable(snap,v){const q=layout.window,z=sound(),key=`${q.x}:${q.y}:${q.w}:${q.h}:${z.tableWarp}`;rect(c,q,'#a7b5a0');text(c,'TONE / TABLE',q.x+5,q.y+11,'#d5ddbd',8);const top=q.y+20,height=Math.max(14,q.h-42),width=q.w-12;
    if(tableKey!==key){tableKey=key;tablePaths=Array.from({length:7},(_,row)=>Array.from({length:65},(_,i)=>{const phase=i/64,depth=row/6;return[q.x+6+phase*width*(.67+.33*depth)+(1-depth)*width*.16,top+height*(.15+depth*.7)-wavetableSample(phase*TAU,depth,z.tableWarp)*height*.22];}));}
    for(let row=0;row<7;row++){const active=Math.abs(row/6-z.tablePosition)<.1;line(c,tablePaths[row],active?'#f6f2b0':`rgba(169,198,133,${.32+row*.07})`,active?1.4:.8);}const x=q.x+5+z.tableWarp*(q.w-10),y=top+(1-z.tablePosition)*height;c.strokeStyle='#e8e1a0';c.lineWidth=1;c.beginPath();c.arc(x,y,4.5,0,TAU);c.stroke();text(c,`P ${z.tablePosition.toFixed(2)} W ${z.tableWarp.toFixed(2)}`,q.x+5,q.y+q.h-13,'#c6cda8',7);text(c,`MIX ${Math.round(z.tableMix*100)}%`,q.x+5,q.y+q.h-3,'#89997b',7);}

  function cancel(){contacts.clear();roles.clear();latch=null;cloud.stop();nextTime=0;wasActive=false;}
  return{
    frame(t,dt){lastT=t;surface.resize();layout=bounds();const v=appearance(),snap=api.audio.snapshot();c.clearRect(0,0,layout.w,layout.h);c.fillStyle='#090a0c';c.fillRect(0,0,layout.w,layout.h);drawHistory(t,snap,v);drawFuture(snap,v);drawTimeline(snap,v);drawLog(snap,v);drawCloud(t,snap,v);buttons.style.left=`${layout.m}px`;buttons.style.bottom=layout.portrait?'12px':'18px';buttons.style.transform=layout.w<360?'scale(.88)':'none';buttons.style.transformOrigin='left bottom';
      if(!bufferReady&&api.audio.context)ensureBuffer();
    },
    onStep(){ensureBuffer();schedule();},
    setPlaying(playing){if(!playing&&!contacts.size&&!(api.state.hold&&latch)){cloud.stop();nextTime=0;wasActive=false;}},
    update(key,kind){if(kind==='sound'&&key==='position')readHead=sound().position;},
    cancel,
    getData(){return{position:readHead,windowOffsets:[...windowOffsets],orbitOffset,source:sourceName==='HARMONIC BUFFER'?'internal':'local-file'};},
    setData(data){if(Array.isArray(data?.windowOffsets)&&data.windowOffsets.length===3)windowOffsets=data.windowOffsets.map(n=>safe(n,-1,1,0));if(Number.isFinite(data?.orbitOffset))orbitOffset=data.orbitOffset;if(Number.isFinite(data?.position)){readHead=clamp(data.position,0,1);api.state.sound.position=readHead;}if(data?.source==='local-file'&&!retainedSource)api.toast('Reimport the local source audio for this session');},
    destroy(){destroyed=true;generation++;clearInterval(timer);cancel();unbind?.();cloud.destroy();waveTiles.clear();previewWaves.length=0;importButton.removeEventListener('click',onImport);sourceButton.removeEventListener('click',onReset);file.removeEventListener('change',onFile);buttons.remove();const materials=new Set();if(scene)scene.traverse(object=>{object.geometry?.dispose();if(object.material)materials.add(object.material);});for(const material of materials)material.dispose();bandTexture?.dispose();webgl?.dispose();webgl?.forceContextLoss();webgl?.domElement.remove();surface.destroy();}
  };
}
