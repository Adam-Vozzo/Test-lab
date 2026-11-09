import {clamp,createSurface,bindPointers,label,line,rgba} from './kit.js';
import {RosesRenderer,ROSE_CENTRES} from './roses-renderer.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'roses',name:'Roses',layoutMode:'single',commonSoundControls:false,keyboardNotes:true,
 theme:{bg:'#020303',fg:'#bbc7bd',accent:'#df4c8b',muted:'#75857d'},
 defaultSound:{waveform:'roses',roseBody:.32,roseGlass:.72,roseDecay:.56,roseWidth:.18,roseMotion:.22,attack:.02,decay:.35,sustain:.72,release:1.6,gain:.72,cutoff:12000,resonance:.5,echo:.2,delayTime:.39,feedback:.28,glide:.06,detune:0,pan:0,gate:.55,scanRate:'2',bedLevel:.24},
 defaultAppearance:{petalColour:'#d82c75',leafColour:'#82aa8e',petalWidth:1.25,petalCurl:.55,petalLayers:5,bloomScale:1.1,bouquetSpread:1.05,leafSize:.9,glyphStyle:'ascii',glyphDensity:1.4,glyphSize:1.45,exposure:1.1,wireContrast:.4,lineWeight:.5,glow:.85,glowRadius:.6,saturation:1.3,highlightGain:1.25,sceneScale:1.15,revealDuration:6,idleMotion:1.5,idleRotation:.035,motionRate:.8,response:.2,spray:1,readoutContrast:.88,readoutSize:1},
 soundControls:[
  range('roseBody','Body level',0,1,.01,'Rose voice','Level of the warm sustained fundamental beneath each petal chime.'),
  range('roseGlass','Glass level',0,1,.01,'Rose voice','Level of the three high, inharmonic partials struck by each petal.'),
  range('roseDecay','Glass decay',0,1,.01,'Rose voice','Time for the high partials to ring out after a petal is struck.'),
  range('roseWidth','Detune width',0,1,.01,'Rose voice','Small tuning differences that create slow beating in the sustained body.'),
  range('roseMotion','Pitch drift',0,1,.01,'Rose voice','Gentle pitch motion in sustained tones.'),
  range('attack','Attack',.002,.8,.002,'Envelope','Time for the complete petal voice to rise; longer attacks soften the glass strike.','s'),
  range('decay','Decay',.05,2,.01,'Envelope','Time for the complete petal voice to settle after its initial peak.','s'),
  range('sustain','Sustain',0,1,.01,'Envelope','Level retained by a held petal; the glass partials also have their own decay.'),
  range('release','Release',.1,5,.05,'Envelope','Time for a released petal to fade.','s'),
  range('cutoff','Low-pass',800,18000,50,'Output','Brightness of the entire voice after synthesis.','Hz'),
  range('echo','Delay level',0,.45,.01,'Output','Amount of the soft repeated chimes.'),
  range('delayTime','Delay time',.08,.8,.01,'Output','Time between delayed chimes.','s'),
  range('feedback','Delay feedback',0,.6,.01,'Output','Length of the delay tail.'),
  range('bedLevel','Foundation level',0,.5,.01,'Sequence','Level of the lower sustained harmony while Play is running.'),
  range('gate','Petal gate',.15,2,.05,'Sequence','Duration of each sequenced petal relative to its interval.','×'),
  {key:'scanRate',label:'Petal interval',kind:'select',options:[['1','1/16'],['2','1/8'],['4','1/4']],section:'Sequence',description:'Musical spacing between the petals sounded by Play.'}
 ],
 appearanceControls:[
  {key:'petalColour',label:'Petal colour',kind:'color',section:'Petals',description:'Base colour of the rose glyphs and petal contours.'},
  range('petalWidth','Petal width',.55,1.5,.05,'Petals','Width of each curved petal fan in the 3D flower.'),
  range('petalCurl','Petal curl',0,1.5,.05,'Petals','Lift and curl of each petal edge in 3D.'),
  range('petalLayers','Petal layers',2,5,1,'Petals','Number of nested petal layers within every flower.'),
  range('bloomScale','Flower size',.65,1.3,.05,'Petals','Size of the flower heads; stems retain their positions.','×'),
  range('bouquetSpread','Branch spread',.65,1.3,.05,'Stems and leaves','Horizontal separation of the five flower stems.','×'),
  {key:'leafColour',label:'Leaf colour',kind:'color',section:'Stems and leaves',description:'Colour of stem segments, leaf veins and leaf hatching.'},
  range('leafSize','Leaf size',.5,1.5,.05,'Stems and leaves','Size of the compound leaves on the main stem.','×'),
  {key:'glyphStyle',label:'Surface marks',kind:'select',options:[['ascii','ASCII'],['dots','Dots']],section:'Surface',description:'Screen-aligned characters or small square points sampled across the 3D surfaces.'},
  range('glyphDensity','Surface density',.45,1.6,.05,'Surface','Packs more, smaller characters into the surface. Fine settings trade legibility for detail; device limits bound the total.'),
  range('glyphSize','Character size',.65,1.6,.05,'Surface','Size of the individual characters, without changing flower geometry.','×'),
  range('exposure','Glyph exposure',.4,1.6,.05,'Surface','Brightness of the petal and leaf marks; the background remains black.','×'),
  range('wireContrast','Contour contrast',0,1,.05,'Surface','Visibility of fine petal edges, leaf veins and stem construction lines.'),
  range('lineWeight','Contour weight',.5,1.8,.05,'Surface','Stroke width of the fine construction lines.','×'),
  range('saturation','Petal saturation',.6,1.8,.05,'Light','Colour intensity of petal midtones and their halos; highlights retain a bright warm core.','×'),
  range('highlightGain','Highlight gain',.5,1.8,.05,'Light','Brightness of the lit petal folds and the light they emit into the bloom.','×'),
  range('glow','Petal bloom',0,1,.05,'Light','Local light surrounding each luminous glyph; zero removes the halo.'),
  range('glowRadius','Bloom radius',0,1,.05,'Light','Radius of the small glyph halos. Does not blur the underlying characters.'),
  range('sceneScale','Bouquet scale',.65,1.15,.05,'View','Size of the complete bouquet within the canvas.','×'),
  range('revealDuration','Entry duration',0,12,.5,'Motion','Time to build the stem, branches, leaves and opening flowers. Zero reveals the complete model.','s'),
  range('idleMotion','Ambient motion',0,1.5,.05,'Motion','Independent slow tilting and swaying of the flower heads around their stems.'),
  range('idleRotation','Idle rotation',0,.12,.005,'Motion','Slow rotation of the entire bouquet. Pauses while touching the sculpture, then eases back in. Zero stops rotation.','rad/s'),
  range('motionRate','Ambient speed',0,2,.05,'Motion','Speed of ambient movement, independent of the musical tempo.','×'),
  range('response','Contact bend',0,1.5,.05,'Motion','Amount of flower nod and leaf flex after a note is struck.'),
  range('spray','Released glyphs',0,1,.05,'Motion','Number of small marks released from a struck petal, leaf or stem.'),
  range('readoutContrast','Annotation contrast',0,1,.05,'Annotations','Brightness of the note, angle and vertex annotations.'),
  range('readoutSize','Annotation size',.8,1.4,.05,'Annotations','Size of the sparse technical readouts.','×')
 ]
};
export const rosePetalDegree=(petal,flower=0)=>petal>=220?2+(petal-220)%5:8+((petal+flower*2)%4);
const ZOOM_MIN=.65,ZOOM_MAX=3.2;

export function mount(host,api){
 const surface=createSurface(host,{label:'Roses. Touch individual petals for chimes; leaves and stems play lower notes. Drag between petals to play different notes. Drag empty space to orbit; pinch anywhere or use the mouse wheel to zoom. Shift-drag to pan a close view.'}),c=surface.ctx,profile=signalRenderProfile(),gate=createFrameGate(profile.mobile?60:90),renderer=new RosesRenderer(surface.canvas,{mobile:profile.mobile});
 surface.resize=()=>{const r=surface.canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),d=renderPixelRatio(w,h,window.devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?1000000:1700000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)||surface.dpr!==d){surface.canvas.width=Math.max(1,Math.round(w*d));surface.canvas.height=Math.max(1,Math.round(h*d));c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});renderer.resize(w,h,d);return surface;};surface.resize();
 const contacts=new Map(),provenance=new Map(),seenOnsets=new Set(),energy=new Float32Array(256);let camera={yaw:.19433333333333686,pitch:6.55833333333334,zoom:.7590744829719918,offsetX:0,offsetY:0},time=0,startTime=null,lastTime=0,scanCursor=0,barCount=0,transport=false,destroyed=false,lastNote=api.quantize(9),lastStatus='',pinch=null,focus=null,cursor=null,revealProgress=0,idleYaw=0,idleSpeed=0,lastInteraction=-Infinity;
 const appearance=()=>({...definition.defaultAppearance,...api.state.appearance});
 const sourceId=(pointer,petal)=>'roses-touch-'+pointer+'-'+petal;
 function emit(id,amount=1){if(!api.reducedMotion)renderer.emitPetal(id,time,amount);}
 function soundPetal(p,q,hit,first=false){
  if(!hit)return;const id=sourceId(p.id,hit.id);if(q.source&&q.source!==id)api.noteOff(q.source);
  const changed=q.source!==id;q.source=id;q.ownedSources.add(id);q.petal=hit.id;q.flower=hit.flower;q.x=p.x;q.y=p.y;
  const midi=api.quantize(rosePetalDegree(hit.id,hit.flower)),options={velocity:.65+clamp(p.pressure)*.2,pan:clamp((p.x/surface.width-.5)*1.2,-.65,.65)};
  provenance.set(id,{petal:hit.id,flower:hit.flower});lastNote=midi;focus={id:hit.id,time};
  if(first||changed){api.noteOn(id,midi,options);energy[hit.id]=Math.max(energy[hit.id],.9);}else api.noteUpdate(id,midi,options);
 }
 // Keep the point beneath the fingers stationary as magnification changes.
 // Offsets are viewport fractions, so a saved close view survives resize.
 function anchorView(){camera.yaw+=idleYaw;idleYaw=0;idleSpeed=0;}
 function constrainView(){const limit=Math.max(0,(camera.zoom-1)*.65);camera.offsetX=clamp(camera.offsetX,-limit,limit);camera.offsetY=clamp(camera.offsetY,-limit,limit);}
 function setZoom(zoom,anchorX,anchorY,origin=camera,startX=anchorX,startY=anchorY){
  const next=clamp(zoom,ZOOM_MIN,ZOOM_MAX),ratio=next/origin.zoom;
  camera.offsetX=anchorX+(.5+origin.offsetX-startX)*ratio-.5;
  camera.offsetY=anchorY+(.53+origin.offsetY-startY)*ratio-.53;
  camera.zoom=next;constrainView();
 }
 function resetPinch(){const group=[...contacts.values()];pinch=group.length>=2?{ids:[group[0].id,group[1].id],distance:Math.hypot(group[0].x-group[1].x,group[0].y-group[1].y),x:(group[0].x+group[1].x)/2/surface.width,y:(group[0].y+group[1].y)/2/surface.height,camera:{...camera},points:group.map(q=>({x:q.x,y:q.y})),active:group[0].kind!=='petal'&&group[1].kind!=='petal'}:null;}
 function movePinch(){
  if(!pinch)return false;const group=pinch.ids.map(id=>contacts.get(id));if(group.some(q=>!q)||pinch.distance<4)return false;
  const distance=Math.hypot(group[0].x-group[1].x,group[0].y-group[1].y);
  const bothMoved=group.every((q,i)=>Math.hypot(q.x-pinch.points[i].x,q.y-pinch.points[i].y)>5);
  if(!pinch.active&&bothMoved&&Math.abs(distance-pinch.distance)>Math.max(14,pinch.distance*.08)){
   pinch.active=true;anchorView();for(const q of group){for(const id of q.ownedSources)(api.noteCancel||api.noteOff)(id);q.ownedSources.clear();q.source=null;q.kind='orbit';}
  }
  if(!pinch.active)return false;
  setZoom(pinch.camera.zoom*distance/pinch.distance,(group[0].x+group[1].x)/2/surface.width,(group[0].y+group[1].y)/2/surface.height,pinch.camera,pinch.x,pinch.y);return true;
 }
 const unbind=bindPointers(surface.canvas,{
  down(p){lastInteraction=time;cursor={x:p.x,y:p.y,time};const pan=p.event?.shiftKey,hit=pan?null:renderer.pick(p.x,p.y),q={id:p.id,kind:pan?'pan':hit?'petal':'orbit',x:p.x,y:p.y,source:null,ownedSources:new Set()};if(!hit)anchorView();contacts.set(p.id,q);if(hit)soundPetal(p,q,hit,true);resetPinch();},
  move(p){cursor={x:p.x,y:p.y,time};const q=contacts.get(p.id);if(!q)return;const dx=p.x-q.x,dy=p.y-q.y;q.x=p.x;q.y=p.y;if(movePinch())return;
   if(q.kind==='petal'){const hit=renderer.pick(p.x,p.y);if(hit)soundPetal(p,q,hit);return;}
   if(q.kind==='pan'){camera.offsetX+=dx/surface.width;camera.offsetY+=dy/surface.height;constrainView();}
   else{camera.yaw+=dx*.007;camera.pitch+=dy*.007;}
  },
  up(p){lastInteraction=time;const q=contacts.get(p.id);if(q?.source)api.noteOff(q.source);contacts.delete(p.id);resetPinch();api.save();},
  cancel(p){lastInteraction=time;const q=contacts.get(p.id);if(q)for(const id of q.ownedSources)(api.noteCancel||api.noteOff)(id);contacts.delete(p.id);resetPinch();}
 });
 const wheel=e=>{lastInteraction=time;anchorView();e.preventDefault();const r=surface.canvas.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?surface.height:1);setZoom(camera.zoom*Math.exp(-delta*.0015),(e.clientX-r.left)/surface.width,(e.clientY-r.top)/surface.height,{...camera});api.save();};surface.canvas.addEventListener('wheel',wheel,{passive:false});
 const hover=e=>{if(e.pointerType==='touch'||contacts.has(e.pointerId))return;const r=surface.canvas.getBoundingClientRect();cursor={x:e.clientX-r.left,y:e.clientY-r.top,time};};surface.canvas.addEventListener('pointermove',hover,{passive:true});
 function drawAnnotations(v,snap){if(!v.readoutContrast)return;const size=(surface.height<400?9.5:12)*v.readoutSize,pad=surface.height<400?12:20,opacity=v.readoutContrast*.8;
  // The reference begins with a calibrated stem before its branches unfold.
  if(renderer.reveal<.43&&renderer.intro){const fade=clamp((.43-renderer.reveal)/.1);for(let n=0;n<=10;n++){const y=-2.02+n*.357;if(n/10>renderer.intro.stem)continue;const p=renderer.transform(0,y,0);label(c,(n/10).toFixed(2),p.x+8,p.y,rgba('#82aa8e',opacity*fade*.75),size*.78);}}
  if(renderer.reveal>.72){const fade=clamp((renderer.reveal-.72)/.28);label(c,'ROSA / '+String(renderer.petals.length).padStart(3,'0'),pad,surface.height-pad-11,rgba('#c4c9bd',opacity*fade),size);label(c,api.noteName(lastNote)+'  '+(440*Math.pow(2,(lastNote-69)/12)).toFixed(1)+' HZ',pad,surface.height-pad,rgba('#c4c9bd',opacity*fade),size);label(c,'AZ '+((renderer.camera.yaw*180/Math.PI)%360).toFixed(1)+'° / '+camera.zoom.toFixed(2)+'×',surface.width-pad,surface.height-pad,rgba('#c4c9bd',opacity*fade),size,'right');}
  const active=snap.voices.filter(q=>q.level>.015&&provenance.has(q.id)).sort((a,b)=>b.started-a.started),selected=active.length?provenance.get(active[0].id).petal:focus?.id;
  if(active.length)focus={id:selected,time};
  const strength=focus?clamp(1-(time-focus.time)/1.5):0,p=renderer.projectInteraction?.(selected)||renderer.projectPetal(selected);
  if(p?.visible&&strength>0&&p.x>pad&&p.x<surface.width-pad&&p.y>pad&&p.y<surface.height-45){
   const text='#'+String(selected).padStart(3,'0')+' / '+api.noteName(api.quantize(rosePetalDegree(selected,p.flower))),width=Math.max(text.length,12)*size*.63,side=p.x<surface.width*.5?1:-1,x=clamp(p.x+side*70,pad+(side<0?width:0),surface.width-pad-(side>0?width:0)),y=clamp(p.y-45,24,surface.height-65),col=rgba('#c4c9bd',opacity*strength);
   c.save();c.setLineDash([1,4]);line(c,[[p.x,p.y],[x,y]],col,.7);c.restore();label(c,text,x,y-7,col,size,side>0?'left':'right');label(c,'A '+clamp(energy[selected]||0).toFixed(2)+' / θ '+((p.bend||0)*180/Math.PI).toFixed(1)+'°',x,y+size*.85,col,size*.88,side>0?'left':'right');
  }
  if(cursor){const fade=contacts.size?1:clamp(1-(time-cursor.time)/1.5);if(fade){const r=clamp(Math.min(surface.width,surface.height)*.035,10,28),len=r*.3;c.beginPath();for(const x of[-1,1])for(const y of[-1,1]){const px=cursor.x+x*r,py=cursor.y+y*r;c.moveTo(px-x*len,py);c.lineTo(px,py);c.lineTo(px,py-y*len);}c.strokeStyle=rgba('#dbe1d3',opacity*fade*.7);c.lineWidth=.85;c.stroke();}}
 }

 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;time=t;if(startTime===null)startTime=t;dt=Math.min(.1,lastTime?t-lastTime:dt);lastTime=t;surface.resize();const v=appearance(),snap=api.audio.snapshot();
   for(let i=0;i<energy.length;i++)energy[i]*=Math.exp(-dt*3.2);
   const audible=new Set();for(const voice of snap.voices){const p=provenance.get(voice.id),onset=voice.id+':'+voice.started;audible.add(onset);if(p){energy[p.petal]=Math.max(energy[p.petal],clamp(voice.level*2));if(!seenOnsets.has(onset)&&voice.level>.002){if(!api.reducedMotion)renderer.strike(p.petal,time,.75);emit(p.petal);seenOnsets.add(onset);}}}for(const onset of seenOnsets)if(!audible.has(onset))seenOnsets.delete(onset);
   revealProgress=Math.max(revealProgress,api.reducedMotion||v.revealDuration<=0?1:clamp((t-startTime)/v.revealDuration));
   // Keep automatic rotation out of the saved camera. The renderer receives
   // one shared pose for surfaces, hit testing, annotations and loose glyphs.
   if(api.reducedMotion){anchorView();}
   else if(contacts.size||t-lastInteraction<2||revealProgress<1){idleSpeed=0;}
   else{const target=(v.idleRotation??.035)*(v.motionRate??1);idleSpeed+=(target-idleSpeed)*(1-Math.exp(-dt*1.4));idleYaw+=idleSpeed*dt;}
   renderer.draw(v,t,{...camera,yaw:camera.yaw+idleYaw},energy,revealProgress,api.reducedMotion);
   for(const q of contacts.values())if(q.kind==='petal'&&t-(q.lastShed??0)>.32){emit(q.petal,.35);q.lastShed=t;}
   drawAnnotations(v,snap);const latest=snap.voices.filter(q=>q.level>.01).sort((a,b)=>b.started-a.started)[0];if(latest)lastNote=latest.midi;const status=api.noteName(lastNote)+' · '+snap.voices.filter(q=>q.gate).length+' voices';if(lastStatus!==status){api.setStatus(status);lastStatus=status;}
   for(const id of provenance.keys())if(!snap.voices.some(q=>q.id===id)&&!api.audio.sources?.has(id)&&![...contacts.values()].some(q=>q.source===id))provenance.delete(id);
  },
  onStep(step,when){const interval=Number(api.state.sound.scanRate)||2;if(step%interval)return;const index=scanCursor++%5,candidates=renderer.petals.filter(p=>p.flower===index),entry=candidates[(scanCursor*3)%Math.max(1,candidates.length)];if(!entry)return;const petal=entry.id,flower=entry.flower,id='roses-seq-'+petal,midi=api.quantize(rosePetalDegree(petal,flower));provenance.set(id,{petal,flower});api.audio.pulse(id,midi,{...api.state.sound,velocity:.66,pan:ROSE_CENTRES[flower][0]*.4},when,60/api.state.bpm/4*interval*api.state.sound.gate);if(step===0){const chord=[[3,5,7],[1,5,8],[0,4,7,10]][Math.floor(barCount++/2)%3];if(api.state.sound.bedLevel>0)for(const degree of chord)api.audio.pulse('roses-bed-'+degree,api.quantize(degree),{...api.state.sound,roseLayer:1,roseBody:.9,attack:.8,release:2,gain:api.state.sound.bedLevel,velocity:.65},when,60/api.state.bpm*3.5);}},
  setPlaying(playing){if(playing&&!transport){scanCursor=0;barCount=0;}transport=playing;},
  update(){},cancel(){for(const q of contacts.values())if(q.source)(api.noteCancel||api.noteOff)(q.source);for(const id of provenance.keys())(api.noteCancel||api.noteOff)(id);contacts.clear();pinch=null;},
  getData(){return{camera:{...camera}};},setData(data){if(data?.camera){idleYaw=0;idleSpeed=0;lastInteraction=time;const p=data.camera;if(Number.isFinite(p.yaw))camera.yaw=p.yaw;if(Number.isFinite(p.pitch))camera.pitch=p.pitch;if(Number.isFinite(p.zoom))camera.zoom=clamp(p.zoom,ZOOM_MIN,ZOOM_MAX);camera.offsetX=Number.isFinite(p.offsetX)?p.offsetX:0;camera.offsetY=Number.isFinite(p.offsetY)?p.offsetY:0;constrainView();}},
  destroy(){destroyed=true;unbind();surface.canvas.removeEventListener('wheel',wheel);surface.canvas.removeEventListener('pointermove',hover);for(const id of provenance.keys())(api.noteCancel||api.noteOff)(id);renderer.dispose();surface.destroy();}
 };
}
