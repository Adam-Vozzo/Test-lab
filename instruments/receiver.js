import {TAU,clamp,lerp,rgba,createSurface,bindPointers,line} from './kit.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
import {ReceiverRenderer,rasterText} from './receiver-renderer.js';

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'receiver',name:'Receiver',layoutMode:'single',commonSoundControls:false,keyboardNotes:true,
 theme:{bg:'#060b0e',fg:'#c4cfce',accent:'#b9cccb',muted:'#849698'},
 defaultSound:{waveform:'receiver',sideband:.34,spread:.22,air:.045,drift:.22,bandwidth:.68,attack:.045,decay:.45,sustain:.72,release:1.35,gain:.72,cutoff:10000,resonance:.65,echo:.2,delayTime:.29,feedback:.24,glide:.07,detune:0,pan:0,expression:.8,gate:1.25,scanRate:'2'},
 defaultAppearance:{screenColour:'#293b43',phosphorColour:'#c6d0c8',exposure:1,grain:.19,grainScale:1,scanlines:.34,curvature:.65,edgeShade:.8,phosphorHalo:.65,phosphorSoftness:.5,rasterDrift:.5,markScale:1,markContrast:.98,trailLength:.5,targetDrift:.45,driftRate:.45,readoutScale:1,readoutContrast:.95,railContrast:.7,railDensity:1},
 soundControls:[
  range('sideband','Sideband level',0,1,.01,'Receiver','Balance of warm sideband harmonics around the tuned fundamental.'),
  range('spread','Sideband spacing',0,1,.01,'Receiver','Symmetric tuning offset of the sidebands, adding slow interference beats.'),
  range('air','Reception noise',0,.35,.005,'Receiver','Level of softened, band-limited noise under the pitched signal.'),
  range('drift','Frequency drift',0,1,.01,'Receiver','Slow independent frequency wander of the received tone.'),
  range('bandwidth','Receiver bandwidth',0,1,.01,'Receiver','Openness of the receiver filter. Also controlled by the right-hand rail.'),
  range('expression','Vertical expression',0,1,.01,'Touch','Depth of touch-height control over the output low-pass filter.'),
  range('glide','Tuning glide',.005,.4,.005,'Touch','Time taken to retune while a contact moves across the screen.','s'),
  range('attack','Attack',.005,1,.005,'Envelope','Time for a new contact to reach full signal level.','s'),
  range('decay','Decay',.03,2,.01,'Envelope','Time for the initial signal to settle to its sustained level.','s'),
  range('sustain','Sustain',0,1,.01,'Envelope','Signal level retained while a contact is held.'),
  range('release','Release',.05,5,.01,'Envelope','Time for a released contact to fade.','s'),
  range('cutoff','Output low-pass',500,18000,10,'Output','Maximum brightness after the receiver; touch height applies expression below this value.','Hz'),
  range('echo','Delay level',0,.4,.01,'Output','Amount of delayed signal mixed into the output.'),
  range('delayTime','Delay time',.08,.8,.01,'Output','Time between signal repeats.','s'),
  range('feedback','Delay feedback',0,.6,.01,'Output','Amount returned to the delay, controlling the tail length.'),
  range('gate','Scan gate',.25,2,.01,'Scan','Duration of a scanned beacon relative to its scan interval.','×'),
  {key:'scanRate',label:'Scan interval',kind:'select',options:[['1','1/16'],['2','1/8'],['4','1/4']],section:'Scan',description:'Musical spacing between acquisitions of the five saved beacons.'}
 ],
 appearanceControls:[
  {key:'screenColour',label:'Glass colour',kind:'color',section:'Screen',description:'Base colour of the luminous screen field.'},
  range('exposure','Screen exposure',.45,1.6,.05,'Screen','Brightness of the phosphor haze inside the glass.','×'),
  range('grain','Screen grain',0,.65,.01,'Screen','Intensity of the fine monochrome texture, blended with soft light.'),
  range('grainScale','Grain size',.4,1.8,.05,'Screen','Size of the individual grains across the glass.','×'),
  range('scanlines','Scanline contrast',0,1,.05,'Screen','Visibility of the thin horizontal raster lines.'),
  range('curvature','Glass curvature',0,1,.05,'Screen','Roundness and dark edge roll-off of the screen; playing coordinates remain unchanged.'),
  range('edgeShade','Edge shading',0,1,.05,'Screen','Strength of the darkened curved corners and bezel.'),
  range('rasterDrift','Raster movement',0,1,.05,'Screen','Slow movement of the faint exposure band through the display.'),
  {key:'phosphorColour',label:'Phosphor colour',kind:'color',section:'Phosphor',description:'Colour of tracking marks, calibration scales and readouts.'},
  range('phosphorHalo','Phosphor halation',0,1,.05,'Phosphor','Local light spread immediately around bright tracking marks and scales.'),
  range('phosphorSoftness','Phosphor softness',0,1,.05,'Phosphor','Soft duplicate edge around the raster lettering and tracking marks.'),
  range('markScale','Target size',.65,1.8,.05,'Tracking','Size of target diamonds and acquisition brackets; touch targets remain generous.'),
  range('markContrast','Target contrast',.3,1,.05,'Tracking','Brightness of the five target markers and the tuning crosshair.'),
  range('trailLength','Tracking persistence',0,1,.05,'Tracking','Length of the fading traces behind the acquisition crosshair.'),
  range('targetDrift','Target drift distance',0,1,.05,'Tracking','Distance of the gentle local drift around each saved beacon position.'),
  range('driftRate','Target drift speed',0,1,.05,'Tracking','Rate of ambient target movement. Does not change the saved pitch or sound.'),
  range('readoutScale','Readout size',.8,1.5,.05,'Calibration','Size of frequency, note and channel labels.','×'),
  range('readoutContrast','Readout contrast',.35,1,.05,'Calibration','Brightness of the technical lettering.'),
  range('railContrast','Scale contrast',.2,1,.05,'Calibration','Brightness of the bottom pitch scale and right bandwidth rail.'),
  range('railDensity','Pitch tick density',.5,2,.25,'Calibration','Number of fine ticks between the labelled pitch divisions.','×')
 ]
};
export const RECEIVER_BEACONS=Object.freeze([{x:.19,y:.80},{x:.45,y:.64},{x:.5,y:.30},{x:.72,y:.77},{x:.80,y:.15}].map(Object.freeze));
export function receiverLayout(w,h,appearance={}){
 const pad=Math.max(5,Math.min(13,Math.min(w,h)*.022)),frame={x:pad,y:pad,w:w-pad*2,h:h-pad*2};
 const top=h<420?41:59,bottom=h<420?49:67,left=w<500?27:43,right=w<500?44:61;
 const field={x:frame.x+left,y:frame.y+top,w:Math.max(20,frame.w-left-right),h:Math.max(20,frame.h-top-bottom)};
 const pitchRail={x:field.x-9,y:frame.y+frame.h-25,w:field.w+24,h:32},bandwidthRail={x:frame.x+frame.w-25,y:field.y+6,w:34,h:field.h-8};
 return{w,h,frame,field,pitchRail,bandwidthRail,radius:12+(appearance.curvature??.65)*Math.min(w,h)*.055};
}
export const receiverPoint=(nx,ny,l)=>({x:l.field.x+nx*l.field.w,y:l.field.y+ny*l.field.h});
export const receiverCoordinates=(x,y,l)=>({nx:clamp((x-l.field.x)/l.field.w),ny:clamp((y-l.field.y)/l.field.h)});
export function receiverMapping(nx,ny,scale='dorian'){
 const count=scale==='pentatonic'?5:scale==='chromatic'?12:7;
 return{degree:Math.round(clamp(nx)*count*2),cutoffMix:Math.pow(1-clamp(ny),1.1),pan:(clamp(nx)-.5)*.9};
}
export function receiverBeaconPose(beacon,time,appearance={},reduced=false,index=0){
 const amount=reduced?0:(appearance.targetDrift??.45)*.014,rate=appearance.driftRate??.45,t=rate===0?0:time*(.13+rate*.35);
 return{x:clamp(beacon.x+Math.sin(t+index*2.31)*amount,.025,.975),y:clamp(beacon.y+Math.cos(t*.73+index*1.63)*amount,.035,.965)};
}
export function receiverHit(x,y,l,poses=[]){
 if(Math.abs(x-l.bandwidthRail.x)<23&&y>l.bandwidthRail.y-12&&y<l.bandwidthRail.y+l.bandwidthRail.h+12)return{kind:'bandwidth'};
 if(Math.abs(y-l.pitchRail.y)<20&&x>l.pitchRail.x-12&&x<l.pitchRail.x+l.pitchRail.w+12)return{kind:'pitch'};
 let nearest=-1,distance=Infinity;for(let i=0;i<poses.length;i++){const p=receiverPoint(poses[i].x,poses[i].y,l),d=Math.hypot(x-p.x,y-p.y);if(d<distance){nearest=i;distance=d;}}
 if(distance<26)return{kind:'beacon',index:nearest};
 if(x>=l.field.x-12&&x<=l.field.x+l.field.w+12&&y>=l.field.y-10&&y<=l.field.y+l.field.h+10)return{kind:'field'};
 return null;
}
const hz=midi=>440*Math.pow(2,(midi-69)/12);

export function mount(host,api){
 const surface=createSurface(host,{label:'Receiver. Touch the screen to tune and play. Drag a beacon to edit its scanned note. Bottom rail tunes pitch; right rail adjusts receiver bandwidth.'}),c=surface.ctx,renderer=new ReceiverRenderer();
 const profile=signalRenderProfile(),gate=createFrameGate(profile.mobile?60:90);
 surface.resize=()=>{const r=surface.canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),d=renderPixelRatio(w,h,window.devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?1100000:1800000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)||surface.dpr!==d){surface.canvas.width=Math.max(1,Math.round(w*d));surface.canvas.height=Math.max(1,Math.round(h*d));c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});return surface;};surface.resize();
 const beacons=RECEIVER_BEACONS.map(p=>({...p})),contacts=new Map(),provenance=new Map();
 let cursor={x:.5,y:.5},reticle={x:.5,y:.5},time=0,layout=receiverLayout(surface.width,surface.height),destroyed=false,lastStatus='',lastNote=api.quantize(7,-1),trails=[],activeBeacon=-1,scanCursor=0,transportPlaying=false;
 const getAppearance=()=>({...definition.defaultAppearance,...api.state.appearance});
 const getLayout=()=>layout=receiverLayout(surface.width,surface.height,getAppearance());
 const poses=()=>beacons.map((p,i)=>[...contacts.values()].find(q=>q.kind==='beacon'&&q.index===i)?.visual||receiverBeaconPose(p,time,getAppearance(),api.reducedMotion,i));
 const cancel=id=>{(api.noteCancel||api.noteOff)('receiver-'+id);contacts.delete(id);};
 function play(p,q,first=false){
  const l=getLayout(),position=receiverCoordinates(p.x,p.y,l);
  if(q.kind==='bandwidth'){api.setSound({bandwidth:clamp(1-(p.y-l.bandwidthRail.y)/l.bandwidthRail.h)});position.nx=q.x;position.ny=q.y;}
  else if(q.kind==='pitch'){position.nx=clamp((p.x-l.pitchRail.x)/l.pitchRail.w);position.ny=q.y;}
  if(q.kind==='beacon'){if(!first){q.visual={x:clamp(position.nx+q.grabX,.025,.975),y:clamp(position.ny+q.grabY,.035,.965)};const drift=receiverBeaconPose({x:.5,y:.5},time,getAppearance(),api.reducedMotion,q.index);beacons[q.index]={x:clamp(q.visual.x-(drift.x-.5)),y:clamp(q.visual.y-(drift.y-.5))};}position.nx=q.visual.x;position.ny=q.visual.y;}
  q.x=position.nx;q.y=position.ny;cursor={x:q.x,y:q.y};
  const audioPosition=q.kind==='beacon'?beacons[q.index]:{x:q.x,y:q.y};
  const mapping=receiverMapping(audioPosition.x,audioPosition.y,api.state.scale),midi=api.quantize(mapping.degree,-1),cutoff=api.state.sound.cutoff*lerp(1,.16+.84*mapping.cutoffMix,api.state.sound.expression);
  const options={cutoff,pan:mapping.pan,velocity:.8};lastNote=midi;q.midi=midi;q.degree=mapping.degree;provenance.set('receiver-'+p.id,{x:q.x,y:q.y,index:q.kind==='beacon'?q.index:-1});
  (first?api.noteOn:api.noteUpdate)('receiver-'+p.id,midi,options);
 }
 const unbind=bindPointers(surface.canvas,{
  down(p){const l=getLayout(),positions=poses(),hit=receiverHit(p.x,p.y,l,positions);if(!hit)return false;const occupied=hit.kind==='beacon'&&[...contacts.values()].some(q=>q.kind==='beacon'&&q.index===hit.index),q={...hit,kind:occupied?'field':hit.kind,id:p.id,x:cursor.x,y:cursor.y};if(q.kind==='beacon'){const point=receiverCoordinates(p.x,p.y,l);q.visual={...positions[hit.index]};q.grabX=q.visual.x-point.nx;q.grabY=q.visual.y-point.ny;}contacts.set(p.id,q);play(p,q,true);},
  move(p){const q=contacts.get(p.id);if(q)play(p,q);},
  up(p){if(!contacts.has(p.id))return;api.noteOff('receiver-'+p.id);contacts.delete(p.id);api.save();},
  cancel(p){cancel(p.id);}
 });
 function ink(v,alpha=1){return rgba(v.phosphorColour,alpha);}
 function glow(v,amount=1){c.shadowColor=ink(v,clamp(v.phosphorHalo*1.077));c.shadowBlur=(1.25+v.phosphorSoftness*6)*amount;}
 function text(v,value,x,y,size=10,alpha=1,align='left'){c.save();glow(v,.4+v.phosphorSoftness*.6);rasterText(c,value,x,y,size*v.readoutScale,ink(v,v.readoutContrast*alpha),align);c.restore();}
 function bracket(v,x,y,strength=0,size=1){const r=(11+strength*5)*v.markScale*size,h=7*v.markScale;c.save();glow(v,.8);c.strokeStyle=ink(v,v.markContrast*(.48+strength*.5));c.lineWidth=.9;c.beginPath();c.moveTo(x-r+4,y-h);c.lineTo(x-r,y-h);c.lineTo(x-r,y+h);c.lineTo(x-r+4,y+h);c.moveTo(x+r-4,y-h);c.lineTo(x+r,y-h);c.lineTo(x+r,y+h);c.lineTo(x+r-4,y+h);c.stroke();c.restore();}
 function marker(v,x,y,strength,index,selected){const r=(4.5+strength*1.5)*v.markScale;c.save();glow(v);c.lineWidth=.85;c.strokeStyle=ink(v,v.markContrast*(.78+strength*.22));c.beginPath();c.moveTo(x,y-r);c.lineTo(x+r,y);c.lineTo(x,y+r);c.lineTo(x-r,y);c.closePath();c.stroke();c.fillStyle=ink(v,.4+strength*.5);c.fillRect(x-.9,y-.9,1.8,1.8);c.restore();if(index===activeBeacon||index===selected||index===(selected+1)%5||strength>.08)bracket(v,x,y+12,index===selected?.22:strength,index===(selected+1)%5?.85:1);}
 function rails(v,l,snap,displayX){
  const f=l.frame,base=l.pitchRail,rail=l.bandwidthRail,scale=api.state.scale==='chromatic'?12:api.state.scale==='pentatonic'?5:7,count=scale*2,divisions=Math.round(count*4*v.railDensity),alpha=v.railContrast;
  c.save();glow(v,.65);c.strokeStyle=ink(v,alpha*.8);c.lineWidth=.75;
  for(let i=0;i<=divisions;i++){const x=base.x+i/divisions*base.w,major=i%Math.round(divisions/4)===0,h=major?10:i%4===0?6:2.5;line(c,[[x,base.y-h],[x,base.y+1]],ink(v,alpha*(major?.9:.5)),major?1.5:.7);}
  const tx=base.x+displayX*base.w;c.fillStyle=ink(v,.9);c.fillRect(tx-2.5,base.y-11,5,13);
  c.strokeStyle=ink(v,alpha*.7);c.strokeRect(rail.x-4,rail.y,8,rail.h);line(c,[[rail.x,rail.y],[rail.x,rail.y+rail.h]],ink(v,alpha*.3),1);
  const by=rail.y+(1-api.state.sound.bandwidth)*rail.h;c.fillStyle=ink(v,.8);c.fillRect(rail.x-8,by-1,16,2);c.fillRect(rail.x-2,by-6,4,12);c.restore();
  for(let i=0;i<3;i++)text(v,api.noteName(api.quantize(Math.round(i*count/2),-1)),base.x+i/2*base.w,base.y-18,8.5,.75,i===0?'left':i===2?'right':'center');
  text(v,'BW',rail.x,rail.y-13,9,.78,'center');
  const top=f.y+21,power=clamp(snap.rms*4),meterW=Math.min(100,l.w*.18),x1=f.x+20,x2=f.x+f.w-20-meterW;
  text(v,'TUNE',x1+meterW+9,top,10,.85);text(v,'PWR',x2-10,top,10,.85,'right');
  for(const [x,value]of [[x1,displayX],[x2,power]]){c.save();glow(v,.7);c.strokeStyle=ink(v,.35);c.lineWidth=.8;c.strokeRect(x,top-5,meterW,9);c.fillStyle=ink(v,.5);c.fillRect(x+3,top-3,(meterW-6)*value,5);line(c,[[x-4,top+11],[x+meterW+4,top+11]],ink(v,.22),.6);c.restore();}
 }
 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;dt=Math.min(.1,time?t-time:dt);time=t;surface.resize();const l=getLayout(),v=getAppearance(),snap=api.audio.snapshot(),points=poses();
   renderer.draw(c,l,v,t,api.reducedMotion);let target={...cursor};activeBeacon=-1;
   const strengths=Array(5).fill(0),voices=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started);lastNote=voices.length?voices[0].midi:api.quantize(receiverMapping(cursor.x,cursor.y,api.state.scale).degree,-1);
   if(!contacts.size&&!api.state.playing&&voices.length){const origin=provenance.get(voices[0].id);if(origin)target={x:origin.x,y:origin.y};else{const count=(api.state.scale==='chromatic'?12:api.state.scale==='pentatonic'?5:7)*2;let best=0;for(let i=1;i<=count;i++)if(Math.abs(api.quantize(i,-1)-lastNote)<Math.abs(api.quantize(best,-1)-lastNote))best=i;target={x:best/count,y:cursor.y};}}
   for(const voice of voices){const scan=/^receiver-scan-(\d)$/.exec(voice.id),p=scan?{...beacons[Number(scan[1])],index:Number(scan[1])}:provenance.get(voice.id);if(!p)continue;if(p.index>=0)strengths[p.index]=Math.max(strengths[p.index],clamp(voice.level*1.5));}
   if(!contacts.size&&api.state.playing){const voice=voices.find(v=>v.id.startsWith('receiver-scan-'));if(voice){activeBeacon=Number(voice.id.split('-').pop());target=points[activeBeacon];lastNote=voice.midi;}}
   for(const q of contacts.values())if(q.kind==='beacon')activeBeacon=q.index;
   const response=api.reducedMotion?1:1-Math.exp(-dt*(contacts.size?22:7));reticle.x=lerp(reticle.x,target.x,response);reticle.y=lerp(reticle.y,target.y,response);
   const rp=receiverPoint(reticle.x,reticle.y,l);if(!api.reducedMotion){trails.push({x:reticle.x,y:reticle.y});const max=3+Math.round(v.trailLength*22);if(trails.length>max)trails.splice(0,trails.length-max);}else trails=[];
   if(v.trailLength>0&&!api.reducedMotion)for(let i=0;i<trails.length;i+=3){const p=receiverPoint(trails[i].x,trails[i].y,l),a=i/trails.length*.12*v.trailLength;c.fillStyle=ink(v,a);c.fillRect(p.x-1,p.y-1,2,2);}
   const selected=points.reduce((best,p,i)=>Math.hypot(p.x-reticle.x,p.y-reticle.y)<Math.hypot(points[best].x-reticle.x,points[best].y-reticle.y)?i:best,0);
   const readX=l.frame.x+22,readY=l.frame.y+l.frame.h-(l.h<420?80:96),frequency=hz(lastNote),frequencyText=frequency.toFixed(1)+' HZ',receiverText=api.state.playing?'SCAN '+String(activeBeacon+1).padStart(2,'0')+'/05':'RX '+api.noteName(lastNote);
   // Reserve both fixed readouts before placing a movable target label. Widths
   // conservatively use the bitmap font's widest glyph, including its spacing.
   const reserved={x:readX-5,y:readY-6*v.readoutScale-4,w:Math.max(frequencyText.length*12,receiverText.length*9)*6/7*v.readoutScale+12,h:17+10.5*v.readoutScale+8};
   for(let i=0;i<points.length;i++){
    const p=receiverPoint(points[i].x,points[i].y,l),strength=strengths[i];marker(v,p.x,p.y,strength,i,selected);
    const midi=api.quantize(receiverMapping(beacons[i].x,beacons[i].y,api.state.scale).degree,-1),name=api.noteName(midi),font=11.5*v.readoutScale,halfWidth=name.length*6/7*font*.5,halfHeight=font*.5,below=p.y+24*v.markScale;
    let labelX=p.x,labelY=below+halfHeight+2<l.pitchRail.y-29?below:p.y-17*v.markScale;
    labelY=Math.min(labelY,l.pitchRail.y-29-halfHeight);
    if(labelX+halfWidth>reserved.x&&labelX-halfWidth<reserved.x+reserved.w&&labelY+halfHeight>reserved.y&&labelY-halfHeight<reserved.y+reserved.h){
     const right=reserved.x+reserved.w+halfWidth+8;
     if(right+halfWidth<l.bandwidthRail.x-15)labelX=Math.max(labelX,right);else labelY=Math.min(labelY,reserved.y-halfHeight-7);
    }
    text(v,name,labelX,labelY,11.5,.87+strength*.13,'center');
   }
   c.save();glow(v,1.3);c.strokeStyle=ink(v,v.markContrast*.85);c.lineWidth=2;const r=5.2*v.markScale;line(c,[[rp.x-r,rp.y],[rp.x+r,rp.y]],c.strokeStyle,2);line(c,[[rp.x,rp.y-r],[rp.x,rp.y+r]],c.strokeStyle,2);c.restore();
   for(const q of contacts.values()){const p=receiverPoint(q.x,q.y,l);bracket(v,p.x,p.y,.9,1.25);}
   rails(v,l,snap,reticle.x);
   text(v,frequencyText,readX,readY,12,1);text(v,receiverText,readX,readY+17,9,.75);
   const status=`${api.noteName(lastNote)} · ${snap.voices.filter(v=>v.gate).length} voices`;if(status!==lastStatus){api.setStatus(status);lastStatus=status;}
   for(const [id]of provenance)if(![...contacts.keys()].some(p=>'receiver-'+p===id)&&!snap.voices.some(v=>v.id===id)&&!api.audio.sources?.has(id))provenance.delete(id);
  },
  onStep(step,when){const interval=Number(api.state.sound.scanRate)||2;if(step%interval)return;const index=scanCursor++%beacons.length,p=beacons[index],m=receiverMapping(p.x,p.y,api.state.scale),midi=api.quantize(m.degree,-1);api.audio.pulse('receiver-scan-'+index,midi,{...api.state.sound,cutoff:api.state.sound.cutoff*lerp(1,.16+.84*m.cutoffMix,api.state.sound.expression),pan:m.pan,velocity:.72},when,60/api.state.bpm/4*interval*api.state.sound.gate);},
  setPlaying(playing){if(playing&&!transportPlaying)scanCursor=0;transportPlaying=playing;},
  update(){},cancel(){for(const id of contacts.keys())cancel(id);for(const id of provenance.keys())(api.noteCancel||api.noteOff)(id);contacts.clear();},
  getData(){return{beacons:beacons.map(p=>({...p})),cursor:{...cursor}};},
  setData(data){if(Array.isArray(data?.beacons))for(let i=0;i<5;i++){const p=data.beacons[i];if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))beacons[i]={x:clamp(p.x),y:clamp(p.y)};}if(Number.isFinite(data?.cursor?.x)&&Number.isFinite(data?.cursor?.y))cursor={x:clamp(data.cursor.x),y:clamp(data.cursor.y)};},
  destroy(){destroyed=true;unbind();for(const id of provenance.keys())(api.noteCancel||api.noteOff)(id);contacts.clear();provenance.clear();renderer.dispose();surface.destroy();}
 };
}
