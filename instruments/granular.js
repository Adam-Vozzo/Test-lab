import * as THREE from '../vendor/three.module.min.js';
import {createSurface,bindPointers,clamp,lerp,TAU} from './kit.js';

const range=(key,label,min,max,step,unit,section,description)=>({key,label,min,max,step,unit,section,description});
export const definition={
  id:'granular',name:'Past / Future',batch:3,commonSoundControls:false,
  theme:{bg:'#090a0c',fg:'#eceeea',accent:'#e7df73',muted:'#8f999f'},
  defaultSound:{grainSize:.18,density:18,pitch:0,pitchJitter:3,position:.4,scan:.06,jitter:.12,stereo:.7,grainGain:.23},
  defaultAppearance:{cloudSize:1,cloudDepth:.7,pointSize:1.4,pointDensity:1,asciiSize:10,historyRows:15,traceWeight:1,grainGlow:.45,guideOpacity:.35},
  soundControls:[
    range('grainSize','Grain duration',.025,.65,.005,'s','Grains','Length of each windowed audio fragment.'),
    range('density','Grains per second',2,50,1,'Hz','Grains','Rate of genuinely scheduled buffer fragments.'),
    range('pitch','Pitch offset',-24,24,1,'st','Grains','Playback-rate transposition of each audio fragment.'),
    range('pitchJitter','Pitch scatter',0,12,.25,'st','Grains','Seeded pitch variation between scheduled grains.'),
    range('position','Read position',0,1,.001,'','Buffer','Starting position within the source buffer.'),
    range('scan','Scan speed',-.3,.3,.005,'/s','Buffer','Signed speed through the recorded buffer.'),
    range('jitter','Position scatter',0,.45,.005,'','Buffer','Spread of grain start positions around the read head.'),
    range('stereo','Stereo spread',0,1,.01,'','Output','Left/right distribution of individual fragments.'),
    range('grainGain','Grain level',.04,.4,.01,'','Output','Level before overlap compensation and the output limiter.')
  ],
  appearanceControls:[
    range('cloudSize','Cloud scale',.65,1.4,.05,'×','Grain cloud','Size of the central 3D point-cloud volume.'),
    range('cloudDepth','Cloud depth',.2,1.5,.05,'×','Grain cloud','Depth of the point cloud; grain position remains anchored.'),
    range('pointSize','Point size',.5,3,.1,'px','Grain cloud','Size of individual cloud samples.'),
    range('pointDensity','Point density',.5,1.8,.1,'×','Grain cloud','Number of samples describing the cloud surface.'),
    range('asciiSize','History character size',8,14,1,'px','History','Monospace size of the source-amplitude history.'),
    range('historyRows','History rows',8,24,1,'','History','Maximum recorded grain entries shown on the left.'),
    range('traceWeight','Trace weight',.5,2.5,.1,'px','Waveforms','Stroke width of buffer and grain waveform traces.'),
    range('grainGlow','Event glow',0,1,.05,'','Events','Glow around active grain events, independent of text.'),
    range('guideOpacity','Guide opacity',.1,.8,.05,'','Guides','Opacity of time lines and cloud coordinate axes.')
  ]
};

const finite=(n,f=0)=>Number.isFinite(n)?n:f;
const fract=n=>n-Math.floor(n);
const hash=n=>fract(Math.sin(n*127.1+78.233)*43758.5453);
const safe=(value,min,max,fallback)=>clamp(finite(value,fallback),min,max);
const scaleNames=' .:-=+*#%@';
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

export function grainPlan({duration,position,pitch,jitter,pitchJitter,stereo,gain,density},bufferDuration,index=0){
  const length=safe(duration,.025,.65,.18),semitones=safe(pitch,-48,48,0)+(hash(index+91)*2-1)*safe(pitchJitter,0,12,0),rate=2**(semitones/12);
  const bufferLength=Math.min(length*rate,Math.max(.001,bufferDuration-.001)),actualDuration=bufferLength/rate;
  const location=fract(finite(position,.4)+(hash(index+3)*2-1)*safe(jitter,0,.45,.1));
  return{duration:actualDuration,bufferLength,offset:location*Math.max(0,bufferDuration-bufferLength),position:location,pitch:semitones,rate,pan:(hash(index+17)*2-1)*safe(stereo,0,1,.7),amplitude:safe(gain,.01,.5,.2)/Math.sqrt(Math.max(1,safe(density,1,50,18)*actualDuration*.8))};
}

export function grainArpDegree(time,bpm=112,division=8){return[0,2,4,6][Math.floor(Math.max(0,time)*safe(bpm,40,220,112)/60*safe(division,4,16,8)/4)%4];}

/** Bounded, look-ahead scheduled grains. No timing depends on the render loop. */
export class GrainCloud{
  constructor(audio){this.audio=audio;this.buffer=null;this.pool=new Set();this.events=[];this.serial=0;this.destroyed=false;this.seed=11;}
  setBuffer(buffer){this.stop();this.buffer=buffer;this.events=[];}
  schedule(when,options){
    const context=this.audio.context,output=this.audio.output;if(this.destroyed||!context||!output||!this.buffer||this.pool.size>=48)return null;
    const p=grainPlan(options,this.buffer.duration,this.serial+this.seed),source=context.createBufferSource(),gain=context.createGain(),pan=context.createStereoPanner();
    when=Math.max(context.currentTime,finite(when,context.currentTime));source.buffer=this.buffer;source.playbackRate.setValueAtTime(p.rate,when);gain.gain.setValueCurveAtTime(grainWindow(p.amplitude),when,p.duration);pan.pan.setValueAtTime(p.pan,when);source.connect(gain);gain.connect(pan);pan.connect(output);
    const record={id:++this.serial,when,until:when+p.duration,position:p.position,offset:p.offset,pitch:p.pitch,pan:p.pan,duration:p.duration,level:p.amplitude};
    const node={source,gain,pan};this.pool.add(node);source.onended=()=>{this.pool.delete(node);source.disconnect();gain.disconnect();pan.disconnect();};source.start(when,p.offset,p.bufferLength);source.stop(when+p.duration+.01);
    this.events.push(record);if(this.events.length>180)this.events.splice(0,this.events.length-180);return record;
  }
  stop(){for(const node of this.pool){node.source.onended=null;try{node.source.stop();}catch{}node.source.disconnect();node.gain.disconnect();node.pan.disconnect();}this.pool.clear();}
  destroy(){this.destroyed=true;this.stop();this.events=[];this.buffer=null;}
}

export function mount(host,api){
  const surface=createSurface(host,{label:'Buffer history and future grains. Drag the left timeline to scrub the source; drag the cloud to control grain position and pitch.',bg:'#090a0c'}),{canvas,ctx:c}=surface;
  const cloud=new GrainCloud(api.audio),contacts=new Map(),roles=new Map();let layout,lastT=0,readHead=.4,nextTime=0,lastScheduler=0,sourceName='HARMONIC BUFFER',bufferReady=false,latch=null,destroyed=false,generation=0,wasActive=false,sourcePeaks=null;
  let webgl=null,scene=null,camera=null,cloudGroup=null,points=null,pointGeometry=null,pointMaterial=null,pointBase=null,pointAmount=0,axisMaterial=null;
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
    const w=surface.width,h=surface.height,m=Math.max(18,w*.024),portrait=w<640,compact=!portrait&&h<520;
    const timelineY=compact?h-124:h*.76,timelineH=compact?32:55,fieldH=Math.min(h*.64,timelineY-70);
    return{w,h,m,portrait,
      left:{x:m,y:45,w:portrait?w-m*2:w*.34-m,h:portrait?h*.25:fieldH},
      right:{x:portrait?m:w*.65,y:portrait?h*.62:45,w:portrait?w-m*2:w*.35-m,h:portrait?h*.16:fieldH},
      cloud:{x:portrait?w*.2:w*.28,y:portrait?h*.3:h*.11,w:portrait?w*.6:w*.43,h:portrait?h*.19:h*.55},
      timeline:{x:m,y:portrait?h*.52:timelineY,w:portrait?w-m*2:w*.41,h:portrait?34:timelineH},
      log:{x:portrait?m:w*.53,y:portrait?h*.8:timelineY,w:portrait?w-m*2:w*.47-m,h:portrait?h*.12:compact?62:h*.17}};
  }
  function setBuffer(buffer,name){cloud.setBuffer(buffer);sourceName=name;bufferReady=true;readHead=sound().position;nextTime=0;sourcePeaks=makePeaks(buffer);api.save();}
  function makePeaks(buffer){const data=buffer.getChannelData(0),n=1024,peaks=new Float32Array(n);for(let i=0;i<n;i++){const from=Math.floor(i/n*data.length),to=Math.max(from+1,Math.floor((i+1)/n*data.length));let max=0;for(let j=from;j<to;j+=Math.max(1,Math.floor((to-from)/20)))max=Math.max(max,Math.abs(data[j]));peaks[i]=max;}return peaks;}
  function ensureBuffer(){if(!bufferReady&&api.audio.context){if(retainedSource)setBuffer(retainedSource.buffer,retainedSource.name);else setBuffer(createSeedBuffer(api.audio.context),'HARMONIC BUFFER');}}
  function inBox(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
  const unbind=bindPointers(canvas,{down(p){surface.resize();layout=bounds();const role=inBox(p,layout.timeline)?'timeline':inBox(p,layout.left)?'history':inBox(p,layout.cloud)?'cloud':inBox(p,layout.right)?'future':null;if(!role)return false;roles.set(p.id,role);setContact(p,role);api.audio.start().then(ok=>{if(ok&&!destroyed&&(contacts.has(p.id)||api.state.hold)){ensureBuffer();nextTime=0;schedule();}});},move(p){const role=roles.get(p.id);if(role)setContact(p,role);},up:release,cancel:release});
  function setContact(p,role){const box=role==='timeline'?layout.timeline:role==='history'?layout.left:role==='future'?layout.right:layout.cloud,nx=clamp((p.x-box.x)/box.w,0,1),ny=clamp((p.y-box.y)/box.h,0,1),position=role==='history'?1-ny:nx,pitch=role==='timeline'?0:Math.round((.5-ny)*24);const q={id:p.id,x:p.x,y:p.y,position,pitch};contacts.set(p.id,q);latch=q;readHead=position;if(api.setSound)api.setSound({position});else api.state.sound.position=position;api.setStatus(`${(position*(cloud.buffer?.duration||6)).toFixed(2)} s · ${pitch>0?'+':''}${pitch} st`);}
  function release(p){contacts.delete(p.id);roles.delete(p.id);if(!api.state.hold&&!contacts.size)latch=null;api.save();}
  function schedule(){
    if(destroyed)return;const ctx=api.audio.context;if(!ctx||ctx.state!=='running')return;ensureBuffer();const now=ctx.currentTime,z=sound(),active=api.state.playing||contacts.size>0||(api.state.hold&&latch);
    if(!api.state.hold&&!contacts.size)latch=null;
    if(!active){if(wasActive)nextTime=0;wasActive=false;lastScheduler=now;return;}wasActive=true;
    const elapsed=clamp(now-lastScheduler,0,.1);lastScheduler=now;if(!contacts.size&&!api.state.hold)readHead=fract(readHead+z.scan*elapsed);
    if(nextTime<now||nextTime>now+.3)nextTime=now+.008;
    let safety=0;while(nextTime<now+.11&&safety++<12){
      const list=[...contacts.values()],contact=list.length?list[cloud.serial%list.length]:latch;
      let pitch=z.pitch+(contact?.pitch||0);if(api.state.arp)pitch+=api.quantize(grainArpDegree(nextTime,api.state.bpm,api.state.arpRate))-api.state.root;
      cloud.schedule(nextTime,{duration:z.grainSize,position:contact?.position??readHead,pitch,jitter:z.jitter,pitchJitter:z.pitchJitter,stereo:z.stereo,gain:z.grainGain,density:z.density});nextTime+=1/z.density;
    }
  }
  const timer=setInterval(schedule,25);

  function initWebGL(){
    try{
      webgl=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'low-power'});webgl.setClearColor(0,0);webgl.setPixelRatio(Math.min(devicePixelRatio||1,1.5));webgl.domElement.style.cssText='position:absolute;pointer-events:none;z-index:1;';host.append(webgl.domElement);
      scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,.1,30);camera.position.set(0,.35,5.3);camera.lookAt(0,0,0);cloudGroup=new THREE.Group();scene.add(cloudGroup);
      pointMaterial=new THREE.PointsMaterial({color:'#d8e3ec',size:.018,transparent:true,opacity:.78,depthWrite:false,sizeAttenuation:true});
      axisMaterial=new THREE.LineBasicMaterial({color:'#507b94',transparent:true,opacity:.3});for(const [from,to]of [[[-1.65,0,0],[1.65,0,0]],[[0,-1.5,0],[0,1.5,0]],[[0,0,-1.5],[0,0,1.5]]]){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from),new THREE.Vector3(...to)]);cloudGroup.add(new THREE.Line(g,axisMaterial));}
    }catch{webgl?.dispose();webgl?.domElement.remove();webgl=null;}
  }
  initWebGL();
  function makeCloud(density){
    const rings=Math.round(32*density),columns=80,count=rings*columns;pointBase=new Float32Array(count*3);const positions=new Float32Array(count*3);
    for(let i=0;i<rings;i++)for(let j=0;j<columns;j++){const k=(i*columns+j)*3,lat=(i+.5)/rings*Math.PI,lon=j/columns*TAU;pointBase[k]=Math.sin(lat)*Math.cos(lon);pointBase[k+1]=Math.cos(lat);pointBase[k+2]=Math.sin(lat)*Math.sin(lon);}
    positions.set(pointBase);if(points){cloudGroup.remove(points);pointGeometry.dispose();}pointGeometry=new THREE.BufferGeometry();pointGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));points=new THREE.Points(pointGeometry,pointMaterial);cloudGroup.add(points);pointAmount=density;
  }
  function drawCloud(t,snap,v){
    const b=layout.cloud,now=snap.time,active=cloud.events.filter(e=>e.when<=now&&e.until>now),ambient=api.reducedMotion?0:t;if(webgl){
      if(!pointBase||pointAmount!==v.pointDensity)makeCloud(v.pointDensity);const data=pointGeometry.attributes.position.array;
      for(let i=0;i<pointBase.length;i+=3){const x=pointBase[i],y=pointBase[i+1],z=pointBase[i+2],latitude=(y+1)*.5;let bump=0;for(const e of active){const d=latitude-e.position,env=Math.sin(Math.PI*(now-e.when)/e.duration);bump+=Math.exp(-d*d*65)*env*(.025+Math.abs(e.pitch)*.003);}
        const r=1+Math.min(.4,bump)+Math.sin(y*5+ambient*.24)*.018;data[i]=x*r;data[i+1]=y*r;data[i+2]=z*r*v.cloudDepth;
      }
      pointGeometry.attributes.position.needsUpdate=true;pointMaterial.size=v.pointSize*.013;pointMaterial.opacity=.65+clamp(snap.rms*2,0,.3);axisMaterial.opacity=v.guideOpacity;cloudGroup.scale.setScalar(v.cloudSize);cloudGroup.rotation.set(.2, ambient*.065, -.13);
      const el=webgl.domElement;el.style.left=`${b.x}px`;el.style.top=`${b.y}px`;el.style.width=`${b.w}px`;el.style.height=`${b.h}px`;if(el.width!==Math.round(b.w*webgl.getPixelRatio())||el.height!==Math.round(b.h*webgl.getPixelRatio())){webgl.setSize(b.w,b.h,false);camera.aspect=b.w/b.h;camera.updateProjectionMatrix();}webgl.render(scene,camera);
    }else{
      const radius=Math.min(b.w,b.h)*.33*v.cloudSize;c.save();c.translate(b.x+b.w*.5,b.y+b.h*.5);for(let i=0;i<20;i++){const y=(i/19-.5)*radius*2,rr=Math.sqrt(Math.max(0,radius*radius-y*y));for(let j=0;j<72;j++){const th=j/72*TAU+ambient*.065,x=Math.cos(th)*rr,z=Math.sin(th)*rr;c.fillStyle=`rgba(211,224,234,${.25+(z/radius+1)*.23})`;c.fillRect(x,y+z*.18*v.cloudDepth,v.pointSize,v.pointSize);}}c.restore();
    }
    for(const q of contacts.values()){c.strokeStyle='#e5df7c';c.lineWidth=.8;c.beginPath();c.arc(q.x,q.y,9,0,TAU);c.stroke();}
  }
  function drawHistory(t,snap,v){
    const b=layout.left,now=snap.time,size=v.asciiSize,rows=Math.max(3,Math.min(Math.round(v.historyRows),Math.floor((b.h-40)/(size*1.35)))),entries=cloud.events.filter(e=>e.when<=now).slice(-rows).reverse(),lineH=Math.min(size*1.75,(b.h-40)/rows);
    text(c,'PAST',b.x,b.y-17,'#e8eae6',12);text(c,`${now.toFixed(2)} s`,b.x+b.w,b.y-17,'#999c9e',10,'right');
    text(c,sourceName,b.x,b.y+8,'#777f84',8);const maxChars=Math.max(8,Math.floor((b.w-68)/(size*.62))),data=cloud.buffer?.getChannelData(0);
    for(let i=0;i<entries.length;i++){
      const e=entries[i],y=b.y+32+i*lineH,alpha=Math.max(.2,1-i/(v.historyRows+2));text(c,String(e.id).padStart(4,'0'),b.x,y,`rgba(150,160,168,${alpha})`,size-1);
      let ascii='';for(let j=0;j<maxChars;j++){const index=data?Math.floor((e.offset+j/maxChars*e.duration)*cloud.buffer.sampleRate)%data.length:0,val=data?Math.abs(data[index]):0;ascii+=scaleNames[Math.min(scaleNames.length-1,Math.floor(val*1.8*(scaleNames.length-1)))];}
      text(c,ascii,b.x+43,y,`rgba(225,230,229,${alpha})`,size);
    }
    if(!entries.length){
      for(let i=0;i<Math.min(rows,14);i++){let row='';for(let j=0;j<maxChars;j++){const signal=Math.abs(Math.sin((i*17+j)*.12)*Math.sin(j*.31));row+=scaleNames[Math.floor(signal*3)];}text(c,row,b.x+43,b.y+32+i*lineH,'#30363c',size);}text(c,'NO GRAINS SCHEDULED',b.x,b.y+b.h-9,'#77818a',8);
    }
  }
  function waveform(box,position,length,color,weight){
    const data=sourcePeaks;c.strokeStyle=color;c.lineWidth=weight;c.beginPath();for(let i=0;i<Math.max(1,Math.floor(box.w));i++){const q=fract(position+i/box.w*length),sample=data?data[Math.floor(q*(data.length-1))]:0,yy=box.y+box.h*.5+Math.sin(i*Math.PI*.7)*sample*box.h*.65;c[i?'lineTo':'moveTo'](box.x+i,yy);}c.stroke();
  }
  function drawFuture(snap,v){
    const b=layout.right,now=snap.time,z=sound(),future=cloud.events.filter(e=>e.until>now).slice(-3);
    text(c,'FUTURE',b.x+b.w,b.y-17,'#e8eae6',12,'right');text(c,`${cloud.pool.size.toString().padStart(2,'0')} GRAINS`,b.x,b.y-17,'#a0bd86',9);
    const top=b.y+b.h*.39,gap=b.h*.155;
    for(let i=0;i<3;i++){
      const e=future[i],y=top+i*gap,width=b.w*.78;waveform({x:b.x,y,w:width,h:gap*.58},e?.position??fract(readHead+i*.13),(e?.duration||z.grainSize)/(cloud.buffer?.duration||6),'#d7dedb',v.traceWeight);
      text(c,e?`${e.pitch>=0?'+':''}${e.pitch.toFixed(1)}`:'—',b.x+b.w,y+gap*.36,e?'#a9d393':'#687768',12,'right');
    }
    text(c,`${(cloud.buffer?.duration||6).toFixed(2)} s BUFFER`,b.x,b.y+b.h-3,'#7e8c91',9);text(c,`${Math.round(z.grainSize*1000)} ms`,b.x+b.w,b.y+b.h-3,'#d4df9a',11,'right');
  }
  function drawTimeline(snap,v){
    const b=layout.timeline,z=sound(),duration=cloud.buffer?.duration||6;rect(c,b,'#303846');waveform(b,0,1,'#59648b',v.traceWeight);
    for(let i=0;i<=8;i++){const x=b.x+b.w*i/8;line(c,[[x,b.y+b.h-5],[x,b.y+b.h]],'#8991b0',.6);text(c,(duration*i/8).toFixed(1),x,b.y+b.h+14,'#6e7c93',8,'center');}
    const px=b.x+readHead*b.w;c.fillStyle='rgba(132,155,255,.13)';c.fillRect(px-2,b.y,4,b.h);line(c,[[px,b.y],[px,b.y+b.h]],'#a7bdff',1.5);
    text(c,`${(readHead*duration).toFixed(2)} s`,b.x,b.y-11,'#bdcae2',10);text(c,api.state.hold?'HOLD':z.scan<0?'SCAN ←':'SCAN →',b.x+b.w,b.y-11,api.state.hold?'#e7df73':'#9ca9ba',9,'right');
  }
  function drawLog(snap,v){
    const b=layout.log,now=snap.time,events=cloud.events.slice(-40);c.fillStyle='#e6df7d';c.fillRect(b.x,b.y,b.w,18);text(c,'GRAIN LOG',b.x+8,b.y+12,'#1b1c17',9);text(c,`${events.length} EVENTS`,b.x+b.w-8,b.y+12,'#343525',8,'right');rect(c,b,'#e6df7d');
    const graph={x:b.x+8,y:b.y+24,w:b.w-16,h:Math.max(12,b.h-33)};c.save();c.beginPath();c.rect(graph.x,graph.y,graph.w,graph.h);c.clip();
    for(const e of events){const age=now-e.when,x=graph.x+graph.w*(1-age/2.8),y=graph.y+graph.h*(1-e.position);if(x<graph.x)continue;c.strokeStyle='rgba(233,223,117,.35)';c.beginPath();c.moveTo(x,y);c.lineTo(x+e.duration/2.8*graph.w,y-e.pan*7);c.stroke();c.fillStyle=e.when<=now&&e.until>now?'#fff9bc':'#b8b572';c.shadowBlur=e.until>now?v.grainGlow*9:0;c.shadowColor='#e8e17e';c.beginPath();c.arc(x,y,1.6+e.level*4,0,TAU);c.fill();c.shadowBlur=0;}
    c.restore();
  }
  function cancel(){contacts.clear();roles.clear();latch=null;cloud.stop();nextTime=0;wasActive=false;}
  return{
    frame(t,dt){lastT=t;surface.resize();layout=bounds();const v=appearance(),snap=api.audio.snapshot();c.clearRect(0,0,layout.w,layout.h);c.fillStyle='#090a0c';c.fillRect(0,0,layout.w,layout.h);drawHistory(t,snap,v);drawFuture(snap,v);drawTimeline(snap,v);drawLog(snap,v);drawCloud(t,snap,v);buttons.style.left=`${layout.m}px`;buttons.style.bottom=layout.portrait?'12px':'18px';buttons.style.transform=layout.w<360?'scale(.88)':'none';buttons.style.transformOrigin='left bottom';
      if(!bufferReady&&api.audio.context)ensureBuffer();
    },
    onStep(){ensureBuffer();schedule();},
    update(key,kind){if(kind==='sound'&&key==='position')readHead=sound().position;},
    cancel,
    getData(){return{position:readHead,source:sourceName==='HARMONIC BUFFER'?'internal':'local-file'};},
    setData(data){if(Number.isFinite(data?.position)){readHead=clamp(data.position,0,1);api.state.sound.position=readHead;}if(data?.source==='local-file'&&!retainedSource)api.toast('Reimport the local source audio for this session');},
    destroy(){destroyed=true;generation++;clearInterval(timer);cancel();unbind?.();cloud.destroy();importButton.removeEventListener('click',onImport);sourceButton.removeEventListener('click',onReset);file.removeEventListener('change',onFile);buttons.remove();if(scene)scene.traverse(object=>{object.geometry?.dispose();});pointMaterial?.dispose();axisMaterial?.dispose();webgl?.dispose();webgl?.forceContextLoss();webgl?.domElement.remove();surface.destroy();}
  };
}
