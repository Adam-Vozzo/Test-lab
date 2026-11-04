import * as THREE from '../vendor/three.module.min.js';
import {splitLayout} from '../instrument-layout.js';
import {TAU,clamp,lerp,createSurface,bindPointers,label,line,rgba} from './kit.js';

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
  id:'hand',name:'Etching / Machine',batch:3,
  theme:{bg:'#080b18',fg:'#e2e6ff',accent:'#ba9bea',muted:'#939bb7'},
  defaultSound:{waveform:'triangle',attack:.025,decay:.3,sustain:.48,release:1.05,cutoff:4400,resonance:1.4,ratio:2,index:.7,detune:3},
  defaultAppearance:{paper:'#eeeadf',ink:'#514451',electric:'#7196ff',blocks:'#c4a1f0',stipple:1.15,handRelief:.75,tracePersistence:.5,traceGlow:.65,signalScale:8,blockDepth:1,asciiDensity:.7,gridWeight:.7,panelRotation:.12,ringScale:1,ringBreath:.16,ringDrift:.08,formMotion:.55,keyRefresh:4},
  soundControls:[
    {key:'waveform',label:'Carrier waveform',kind:'select',options:[['triangle','Triangle'],['sine','Sine'],['sawtooth','Saw'],['square','Square']],section:'Voice',description:'Oscillator played by either keyboard.'},
    range('cutoff','Low-pass cutoff',120,14000,20,'Voice','Brightness of held keys and the central form.','Hz'),
    range('ratio','Modulator ratio',.25,8,.25,'Voice','Modulator frequency relative to each played note.','×'),
    range('index','Modulation index',0,8,.05,'Voice','Harmonic intensity; drag either upper form to shape it.'),
    range('attack','Attack',.005,2,.005,'Envelope','Time for each key to reach its peak.','s'),
    range('decay','Decay',.03,2,.01,'Envelope','Time from the peak to the held level.','s'),
    range('sustain','Sustain',.05,1,.01,'Envelope','Amplitude while a key remains held.'),
    range('release','Release',.05,5,.05,'Envelope','Tail after a key is released.','s'),
  ],
  appearanceControls:[
    {key:'paper',label:'Paper',kind:'color',section:'Etching',description:'Drafting paper behind the ring and chromatic keyboard.'},
    {key:'ink',label:'Printed ink',kind:'color',section:'Etching',description:'Drafting rules, stipple relief and printed key details.'},
    range('stipple','Stipple density',.3,1.8,.05,'Etching','Point density of the drafting relief and printed keys.'),
    range('handRelief','Form relief',.1,1.5,.05,'Etching','Depth of the stippled drafting field surrounding the interactive ring.'),
    {key:'electric',label:'Trace colour',kind:'color',section:'Machine',description:'Electrical paths, scope and keyboard outlines.'},
    range('tracePersistence','Point memory',0,1,.05,'Machine','Smoothing of the digital point form using earlier measured waveform samples.'),
    range('traceGlow','Trace glow',0,1.5,.05,'Machine','Soft glow around blue paths; does not affect the paper side.'),
    range('signalScale','Signal display gain',1,24,.5,'Machine','Display gain for measured scope and ASCII traces; audio level stays unchanged.','×'),
    {key:'blocks',label:'Note blocks',kind:'color',section:'Machine',description:'Colour of the extruded active-note columns.'},
    range('blockDepth','Block depth',.2,1.8,.05,'Machine','Extrusion depth of the sequence prisms; height continues to encode pitch.'),
    range('asciiDensity','Key text density',.2,1,.05,'Machine','Sampling density of the waveform characters inside keys.'),
    range('panelRotation','Radial rotation',0,.5,.01,'Machine','Continuous rotation speed of the blue radial projection panels.','rad/s'),
    range('ringScale','Draft ring scale',.6,1.25,.01,'Etching','Camera scale of the playable three-dimensional ring.'),
    range('ringDrift','Ring drift',0,.2,.005,'Etching','Slow material rotation and independent tilt of the playable ring.','rad/s'),
    range('formMotion','Form motion',0,1,.01,'Machine','Ambient rotation and breathing of the digital form; gestures add stronger deformation.'),
    range('keyRefresh','Key data refresh',1,12,1,'Machine','Measured waveform character updates per second. Lower values keep the key data readable.','Hz'),
    range('ringBreath','Bead movement',0,.3,.01,'Etching','Individual bead breathing around the drafting ring.'),
    range('gridWeight','Rule weight',.3,1.6,.05,'Both surfaces','Weight of plot frames, guides and keyboard outlines.','px'),
  ]
};

const seed=i=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};
const basePattern=[0,2,4,6,4,3,1,4,0,3,5,7,5,4,2,1];
const hz=midi=>440*Math.pow(2,(midi-69)/12);
const formatHz=v=>v>=1000?(v/1000).toFixed(2)+'k':String(Math.round(v));

export function mount(host,api){
  const surface=createSurface(host,{label:'Etching and Machine. Play the chromatic keyboards or three-dimensional ring. Orbit empty ring space. Drag the outer drafting circle to adjust detune. Drag sequence prisms vertically to edit pitch. The digital circular dial controls cutoff and the four bars control attack, decay, sustain and release.'});
  const {canvas,ctx:c}=surface, contacts=new Map(), keyIds=new Set(),anchors=new Map(),navigation=new Map();canvas.style.zIndex='2';
  const reliefPoints=Array.from({length:20000},(_,i)=>{const z=1-2*(i+.5)/20000,r=Math.sqrt(1-z*z),a=i*2.3999632297;return{x:Math.cos(a)*r,y:Math.sin(a)*r,z,a,grain:seed(i+729)};});
  const reliefCanvas=document.createElement('canvas'),reliefContext=reliefCanvas.getContext('2d',{alpha:true});let reliefKey='';
  const cloudBuckets=Array.from({length:6},()=>[]);for(let i=0;i<5200;i++){const p=reliefPoints[Math.floor(i/5200*20000)];cloudBuckets[Math.min(5,Math.floor((p.z+1)*3))].push({...p,index:i});}
  let pattern=basePattern.slice(), events=[], elapsed=0, frameCounter=0,gestureSerial=0;
  let traceHistory=[],keyWave=[],keyWaveTime=-1,formPose={yaw:0,tilt:0,pullX:0,pullY:0,grip:0},ringPhase=0, levels=new Float32Array(13), lastNote=api.quantize(0), shape={x:.5,y:.46},cameraState={yaw:.1,pitch:.65,zoom:1},ringTime=0,pinch=null;const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),dummy=new THREE.Object3D(),temporary=new THREE.Vector3();let ring=null;
  function layout(){const q=splitLayout(surface.width,surface.height,api.state.appearance,{pad:0,gap:12,stackPortrait:true,portraitRatio:.83});return [q.left,q.right];}
  function keyBase(){let n=api.state.root??api.quantize(0);while([1,3,6,8,10].includes((n%12+12)%12))n--;return n;}
  function keyboard(r){
    const white=[],black=[],x=r.x+r.w*.045,y=r.y+r.h*.735,w=r.w*.91,h=r.h*.235,kw=w/8;let midi=keyBase();
    for(let i=0;i<8;i++){while([1,3,6,8,10].includes((midi%12+12)%12))midi++;white.push({midi,x:x+i*kw,y,w:kw-1,h,black:false});if(i<7&&[0,2,5,7,9].includes(midi%12))black.push({midi:midi+1,x:x+(i+1)*kw-kw*.19,y,w:kw*.38,h:h*.61,black:true});midi++;}
    return [...white,...black];
  }
  function keyAt(p,r){return keyboard(r).reverse().find(k=>p.x>=k.x&&p.x<=k.x+k.w&&p.y>=k.y&&p.y<=k.y+k.h);}
  function keyIndex(midi){return Math.round(clamp(midi-keyBase(),0,12));}
  function ringRect(){const r=layout()[0];return{x:r.x+r.w*.18,y:r.y+r.h*.045,w:r.w*.76,h:r.h*.455};}
  function knobs(){const r=layout()[0],radius=Math.max(18,Math.min(22,r.w*.045));return ['cutoff','index','ratio','release'].map((key,i)=>({key,cx:r.x+r.w*(.12+i*.255),cy:r.y+r.h*(r.h<440?.50:.52),rad:radius}));}
  function draftOuter(){const r=layout()[0];return{cx:r.x+r.w*.59,cy:r.y+r.h*.275,rad:Math.min(r.w*.29,r.h*.25)};}
  function outerHit(p){const q=draftOuter(),x=(p.x-q.cx)/q.rad,y=(p.y-q.cy)/(q.rad*.84);return Math.hypot(x,y)>.88&&Math.hypot(x,y)<1.14;}
  function dialRect(){const r=layout()[1];return{cx:r.x+r.w*.38,cy:r.y+r.h*.255,rad:Math.min(r.w*.255,r.h*.225)};}
  function envelopeBars(){const r=layout()[1],keys=['attack','decay','sustain','release'];return keys.map((key,i)=>({key,x:r.x+r.w*(.72+i*.065),y:r.y+r.h*.09,w:r.w*.052,h:r.h*.335}));}
  function soundPatch(patch){if(api.setSound)api.setSound(patch);else{Object.assign(api.state.sound,patch);api.audio.configure(api.state.sound);}}
  function makeRing(){try{
    const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    const el=renderer.domElement;el.style.cssText='position:absolute;z-index:3;pointer-events:none;';el.setAttribute('aria-hidden','true');host.append(el);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.05,50),group=new THREE.Group();scene.add(group);scene.add(new THREE.AmbientLight('#d7d6c9',2.1));const lamp=new THREE.DirectionalLight('#ffffff',2.8);lamp.position.set(-3,4,6);scene.add(lamp);const edge=new THREE.DirectionalLight('#8b91a2',1.1);edge.position.set(3,-2,2);scene.add(edge);
    const geometry=new THREE.SphereGeometry(.053,8,6),material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.95,metalness:0}),beads=new THREE.InstancedMesh(geometry,material,72*10);beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);beads.frustumCulled=false;beads.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1.7);group.add(beads);
    material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
float etchCell=mod(floor(gl_FragCoord.x)+floor(gl_FragCoord.y)*2.0,4.0);
if(etchCell<0.65 && dot(gl_FragColor.rgb,vec3(.299,.587,.114))>.55)discard;`);};
    const guide=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:96},(_,i)=>new THREE.Vector3(Math.cos(i/96*TAU)*1.4,Math.sin(i/96*TAU)*1.4,0))),new THREE.LineBasicMaterial({color:'#807a73',transparent:true,opacity:.32}));group.add(guide);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),new THREE.MeshBasicMaterial({color:'#4c5b63'}));group.add(dot);dot.visible=false;
    return{renderer,el,scene,camera,group,beads,dot,geometry,material,key:''};
  }catch{return null;}}
  ring=makeRing();
  function beadPoint(u,v,t=ringTime,out=new THREE.Vector3()){
    const a=u*TAU,s=api.state.sound,b=v*TAU+Math.sin(a*2)*(s.detune||0)/40*.35,rr=.95+.018*Math.sin(a*3)*(s.index||0),tube=.22+(s.resonance||1)*.008;
    return out.set((rr+tube*Math.cos(b))*Math.cos(a),(rr+tube*Math.cos(b))*Math.sin(a),tube*Math.sin(b));
  }
  function updateRing(t,v,snap){if(!ring)return;const r=ringRect(),key=[r.x,r.y,r.w,r.h,devicePixelRatio].join('|');if(key!==ring.key){ring.key=key;ring.renderer.setSize(Math.max(1,r.w),Math.max(1,r.h),false);Object.assign(ring.el.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});ring.camera.aspect=r.w/r.h;ring.camera.updateProjectionMatrix();}
    const bound=1.43,half=Math.min(THREE.MathUtils.degToRad(19),Math.atan(Math.tan(THREE.MathUtils.degToRad(19))*ring.camera.aspect));ring.camera.position.set(0,0,bound/Math.sin(half)*Math.max(1.06,1.4/(cameraState.zoom*v.ringScale)));ring.camera.lookAt(0,0,0);ring.camera.updateMatrixWorld();ring.group.rotation.set(cameraState.pitch+Math.sin(ringPhase*.71)*.075,cameraState.yaw+Math.sin(ringPhase*.47)*.06,ringPhase);ring.group.updateMatrixWorld(true);
    const active=snap.voices||[],ink=new THREE.Color(v.ink),paper=new THREE.Color(v.paper),lit=new THREE.Color('#626d72'),color=new THREE.Color();
    for(let i=0;i<720;i++){const u=Math.floor(i/10)/72,vv=(i%10)/10,p=beadPoint(u,vv,t,temporary);let intensity=0;for(const voice of active){const a=anchors.get(voice.id);if(a?.u!==undefined){const d=Math.min(Math.abs(u-a.u),1-Math.abs(u-a.u));intensity=Math.max(intensity,Math.max(0,1-d/.1)*Math.sqrt(clamp(voice.level*5)));}else if(Math.abs(voice.midi-api.quantize(Math.floor(u*8)))<.6)intensity=Math.max(intensity,Math.sqrt(clamp(voice.level*4)));}
      const breath=1+v.ringBreath*(Math.sin(t*.72+seed(i)*TAU)*.55+Math.sin(t*.43+seed(i+811)*TAU)*.45);dummy.position.copy(p);dummy.scale.setScalar(breath*(1+intensity*.18));dummy.updateMatrix();ring.beads.setMatrixAt(i,dummy.matrix);color.copy(paper).lerp(ink,.24+.3*(1+Math.sin(vv*TAU))*.5).lerp(lit,intensity*.85);ring.beads.setColorAt(i,color);
    }ring.beads.instanceMatrix.needsUpdate=true;ring.beads.instanceColor.needsUpdate=true;
    const held=active.find(voice=>anchors.get(voice.id)?.u!==undefined),anchor=held?anchors.get(held.id):null;ring.dot.visible=!!anchor;if(anchor)ring.dot.position.copy(beadPoint(anchor.u,anchor.v));ring.renderer.render(ring.scene,ring.camera);
  }
  function ringPick(p){const r=ringRect();if(p.x<r.x||p.x>r.x+r.w||p.y<r.y||p.y>r.y+r.h)return null;if(ring){ndc.set((p.x-r.x)/r.w*2-1,1-(p.y-r.y)/r.h*2);raycaster.setFromCamera(ndc,ring.camera);const hit=raycaster.intersectObject(ring.beads)[0];if(hit){return{u:Math.floor(hit.instanceId/10)/72,v:(hit.instanceId%10)/10};}return null;}
    const dx=(p.x-r.x-r.w/2)/(Math.min(r.w,r.h)*.3),dy=(p.y-r.y-r.h/2)/(Math.min(r.w,r.h)*.26),rr=Math.hypot(dx,dy);return rr>.65&&rr<1.25?{u:(Math.atan2(dy,dx)/TAU+1)%1,v:.25}:null;
  }
  function ringProjection(anchor){const r=ringRect();if(ring){const p=beadPoint(anchor.u,anchor.v);p.applyMatrix4(ring.group.matrixWorld).project(ring.camera);return{x:r.x+(p.x*.5+.5)*r.w,y:r.y+(.5-p.y*.5)*r.h};}return{x:r.x+r.w/2,y:r.y+r.h/2};}
  function region(p){const panes=layout();for(let side=0;side<2;side++){const r=panes[side];if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)return {side,r,x:(p.x-r.x)/r.w,y:(p.y-r.y)/r.h};}return null;}
  function record(midi,when=api.audio.snapshot().time||0,source=null){events.unshift({midi,when,source});events=events.slice(0,32);if(when<=(api.audio.snapshot().time||0))lastNote=midi;}
  function play(contact,p,first=false){
    const r=layout()[contact.side],x=clamp((p.x-r.x)/r.w),y=clamp((p.y-r.y)/r.h);let midi;
    if(contact.role==='orbit')return;
    if(contact.role==='spread'){const q=draftOuter(),a=Math.atan2((p.y-q.cy)/.84,p.x-q.cx);if(first)contact.startAngle=a;let delta=a-contact.startAngle;if(delta>Math.PI)delta-=TAU;if(delta< -Math.PI)delta+=TAU;soundPatch({detune:Math.round(clamp(contact.startValue+delta/Math.PI*32,-40,40)*10)/10});return;}
    if(contact.role==='knob'){
      if(!first){const specs={cutoff:[120,14000],index:[0,8],ratio:[.25,8],release:[.05,5]},[min,max]=specs[contact.key],delta=(contact.startY-p.y)/(r.h*.26);soundPatch({[contact.key]:contact.key==='cutoff'?clamp(contact.startValue*Math.pow(100,delta),min,max):clamp(contact.startValue+delta*(max-min),min,max)});}return;
    }
    if(contact.role==='envelope'){
      const bar=envelopeBars().find(b=>b.key===contact.key),f=clamp(1-(p.y-bar.y)/bar.h),max=contact.key==='release'?5:2;
      soundPatch({[contact.key]:contact.key==='sustain'?f:Math.max(contact.key==='attack'?.005:contact.key==='decay'?.03:.05,Math.expm1(f*Math.log1p(max*80))/80)});return;
    }
    if(contact.role==='dial'){
      const d=dialRect(),a=Math.atan2(p.y-d.cy,p.x-d.cx);if(first)contact.fraction=(a+Math.PI/2+TAU)%TAU/TAU;else{let delta=a-contact.lastAngle;if(delta>Math.PI)delta-=TAU;if(delta< -Math.PI)delta+=TAU;contact.fraction=clamp(contact.fraction+delta/TAU);}contact.lastAngle=a;soundPatch({cutoff:120*Math.pow(14000/120,contact.fraction)});return;
    }
    if(contact.role==='key'){const k=keyAt(p,r);if(!k)return;midi=k.midi;}
    else if(contact.role==='step'){if(!first)pattern[contact.step]=Math.round(clamp(contact.startDegree+(contact.startY-p.y)/(r.h*.12)*7,0,7));midi=api.quantize(pattern[contact.step]);api.save();}
    else if(contact.role==='ring'){const hit=first?contact:ringPick(p);if(!hit)return;contact.u=hit.u;contact.v=hit.v;midi=api.quantize(Math.min(7,Math.floor(contact.u*8)));anchors.set(contact.id,{u:contact.u,v:contact.v});}
    else{shape={x,y};midi=api.quantize(Math.floor(clamp(x/.7,0,.999)*8));soundPatch({index:clamp((.5-y)*16,0,7.5),ratio:clamp(.5+x*7,.25,8)});}
    contact.x=x;contact.y=y;contact.pointerX=p.x;contact.pointerY=p.y;const options={...api.state.sound,gain:.16,pan:contact.side?.18:-.18};if(first){api.noteOn(contact.id,midi,options);record(midi,undefined,contact.role==='ring'?{u:contact.u,v:contact.v}:contact.role==='step'?{step:contact.step}:null);}else{api.noteUpdate(contact.id,midi,options);if(contact.midi!==midi)record(midi,undefined,contact.role==='ring'?{u:contact.u,v:contact.v}:contact.role==='step'?{step:contact.step}:null);}contact.midi=midi;lastNote=midi;api.setStatus(`${api.noteName(midi)}  ·  ${hz(midi).toFixed(2)} Hz`);
  }
  const off=bindPointers(canvas,{
    down(p){
      const q=region(p);if(!q)return false;const r=q.r,key=keyAt(p,r),knobHit=q.side===0?knobs().find(k=>Math.hypot(p.x-k.cx,p.y-k.cy)<=Math.max(24,k.rad+3)):null,bar=q.side===1?envelopeBars().find(b=>p.x>=b.x-3&&p.x<=b.x+b.w+3&&p.y>=b.y-3&&p.y<=b.y+b.h+3):null,hit=q.side===0?ringPick(p):null,d=dialRect(),distance=Math.hypot(p.x-d.cx,(p.y-d.cy)/.88);
      let role,knob;if(key)role='key';else if(q.y>.565&&q.y<.71)role='step';else if(bar)role='envelope';else if(q.side===1&&distance>d.rad*.82&&distance<d.rad*1.19)role='dial';else if(knobHit){role='knob';knob=knobHit.key;}else if(hit)role='ring';else if(q.side===0&&outerHit(p))role='spread';else if(q.side===0&&q.y<.51&&q.x>.17)role='orbit';else if(q.side===1&&distance<d.rad*.8)role='shape';else return false;
      const step=Math.min(15,Math.floor(clamp((q.x-.045)/.91,0,.999)*16)),contact={id:'hand-'+p.id+'-'+(++gestureSerial),side:q.side,role,key:bar?.key||knob,startY:p.y,startValue:api.state.sound[role==='spread'?'detune':knob],step,startDegree:pattern[step],...hit};contacts.set(p.id,contact);
      if(role==='orbit'){navigation.set(p.id,{x:p.x,y:p.y});if(navigation.size>=2){const [a,b]=[...navigation.values()];pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:cameraState.zoom};}}else play(contact,p,true);
    },
    move(p){const contact=contacts.get(p.id);if(!contact)return;if(contact.role==='orbit'){const before=navigation.get(p.id);navigation.set(p.id,{x:p.x,y:p.y});if(navigation.size>=2&&pinch){const [a,b]=[...navigation.values()];cameraState.zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,.6,1.4);}else if(before){cameraState.yaw+=(p.x-before.x)*.009;cameraState.pitch+=(p.y-before.y)*.009;}return;}if(contact.role==='ring'){if(navigation.size){contact.pointerX=p.x;contact.pointerY=p.y;return;}if(Math.hypot(p.x-contact.pointerX,p.y-contact.pointerY)<.75)return;}play(contact,p);},
    up(p){endContact(p);},cancel(p){endContact(p,true);}
  });
  function endContact(p,cancelled=false){const contact=contacts.get(p.id);if(contact?.midi!==undefined)(cancelled?(api.noteCancel||api.noteOff):api.noteOff)(contact.id);if(cancelled&&contact)anchors.delete(contact.id);contacts.delete(p.id);navigation.delete(p.id);if(navigation.size<2)pinch=null;api.save();}
  const wheel=e=>{const rect=canvas.getBoundingClientRect(),p={x:e.clientX-rect.left,y:e.clientY-rect.top},r=ringRect();if(p.x<r.x||p.x>r.x+r.w||p.y<r.y||p.y>r.y+r.h||ringPick(p))return;e.preventDefault();cameraState.zoom=clamp(cameraState.zoom*Math.exp(-e.deltaY*.001),.6,1.4);api.save();};canvas.addEventListener('wheel',wheel,{passive:false});
  function drawPrintedRelief(c,r,v){
    const ink=v.ink,pad=r.w*.045,cx=r.w*.59,cy=r.h*.275,rad=Math.min(r.w*.29,r.h*.25),weight=v.gridWeight,energy=0,t=0;
    c.strokeStyle=rgba(ink,.45);c.lineWidth=weight*.7;c.beginPath();c.ellipse(cx,cy,rad*1.02,rad*.84,-.17,0,TAU);c.stroke();
    const count=Math.floor(Math.min(20000,14000*v.stipple));
    c.fillStyle=rgba(ink,.88);
    for(let i=0;i<count;i++){
      const p=reliefPoints[Math.floor(i/count*reliefPoints.length)],depth=p.y*.68+p.z*.74;if(depth<-.025)continue;
      const fold=Math.sin(p.a*3+p.z*5)*.065*v.handRelief,indent=Math.exp(-((p.x-.1)**2+(p.y-.45)**2)*8)*.26*v.handRelief;
      const wave=energy*Math.sin(p.a*4+t*2)*.035,xx=p.x*(1+fold+wave),zz=p.z-indent;
      const px=cx+xx*rad,py=cy+(p.y*.62-zz*.61)*rad+(shape.y-.4)*rad*.055;
      const shade=clamp(.48-p.x*.3+p.y*.22-p.z*.16,.1,.92),d=(.33+p.grain*.55+shade*.95)*(1+energy*.24);c.fillRect(px,py,d,d);
    }
    // A recessed well and engraved fold give the stipple relief a continuous annular volume.
    const wellX=cx-rad*.08,wellY=cy+rad*.06,wellR=rad*(.22+v.handRelief*.035);
    c.fillStyle=v.paper;c.beginPath();c.ellipse(wellX,wellY,wellR,wellR*.79,-.18,0,TAU);c.fill();
    c.fillStyle=rgba(ink,.7);for(let i=0;i<1150*v.stipple;i++){const a=seed(i+1800)*TAU,rr=wellR*(1+seed(i+5000)*.19);c.fillRect(wellX+Math.cos(a)*rr,wellY+Math.sin(a)*rr*.79,.65,.65);}
    for(let j=0;j<5;j++)line(c,[[cx+rad*(.01+j*.014),cy-rad*.28],[cx+rad*(.43+j*.012),cy-rad*.53]],rgba(ink,.55-j*.07),.65);
    // Concentric construction circles and radial dimensions remain part of the paper drawing.
    c.setLineDash([2,4]);c.strokeStyle=rgba(ink,.25);for(const f of [.56,.76,1.08]){c.beginPath();c.ellipse(cx,cy,rad*f,rad*.84*f,-.17,0,TAU);c.stroke();}c.setLineDash([]);
  }
  function drawHand(r,v,t,energy){
    c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.fillStyle=v.paper;c.fillRect(r.x,r.y,r.w,r.h);
    const ink=v.ink, pad=r.w*.045, cx=r.x+r.w*.59,cy=r.y+r.h*.275,rad=Math.min(r.w*.29,r.h*.25),weight=v.gridWeight;
    c.fillStyle=rgba(ink,.045);for(let i=0;i<650;i++)c.fillRect(r.x+seed(i)*r.w,r.y+seed(i+991)*r.h,1,1);
    label(c,'ETCHING  /  NOTE GEOMETRY',r.x+pad,r.y+19,rgba(ink,.7),9);
    label(c,api.noteName(lastNote),r.x+r.w-pad,r.y+19,ink,12,'right');
    const cacheKey=[r.w,r.h,surface.dpr,v.paper,v.ink,v.stipple,v.handRelief,v.gridWeight].join('|');
    if(cacheKey!==reliefKey){
      reliefKey=cacheKey;const d=Math.min(surface.dpr,1.5);reliefCanvas.width=Math.ceil(r.w*d);reliefCanvas.height=Math.ceil(r.h*.57*d);reliefContext.setTransform(d,0,0,d,0,0);
      drawPrintedRelief(reliefContext,{...r,x:0,y:0},v);
    }
    c.drawImage(reliefCanvas,r.x,r.y,r.w,r.h*.57);
    const sound=api.state.sound;
    for(const knob of knobs()){
      const {key,cx:xx,cy:yy,rad:rr}=knob,value=sound[key],fraction=key==='cutoff'?Math.log(value/120)/Math.log(14000/120):key==='index'?value/8:key==='ratio'?value/8:value/5;
      c.fillStyle=rgba(v.paper,.88);c.beginPath();c.arc(xx,yy,rr+3,0,TAU);c.fill();c.strokeStyle=rgba(ink,.65);c.lineWidth=.8;c.beginPath();c.arc(xx,yy,rr,0,TAU);c.stroke();const angle=-Math.PI*.8+clamp(fraction)*Math.PI*1.6;line(c,[[xx,yy],[xx+Math.sin(angle)*rr*.7,yy-Math.cos(angle)*rr*.7]],ink,1.15);
      const caption=key==='cutoff'?'CUTOFF':key.toUpperCase(),captionWidth=caption.length*4.9+8;c.fillStyle=v.paper;c.fillRect(xx-captionWidth/2,yy-rr-13,captionWidth,11);
      label(c,caption,xx,yy-rr-6,rgba(ink,.8),8,'center');label(c,key==='cutoff'?formatHz(value):value.toFixed(key==='release'?2:1),xx,yy+rr*.62,rgba(ink,.7),8,'center');
    }
    const outer=draftOuter(),spreadAngle=sound.detune/40*Math.PI,spreadX=outer.cx+Math.cos(spreadAngle)*outer.rad,spreadY=outer.cy+Math.sin(spreadAngle)*outer.rad*.84;
    c.strokeStyle=rgba(ink,.5);c.lineWidth=1;c.beginPath();c.arc(spreadX,spreadY,4,0,TAU);c.stroke();for(let i=0;i<48;i++){const a=i/48*TAU;line(c,[[outer.cx+Math.cos(a)*outer.rad*1.05,outer.cy+Math.sin(a)*outer.rad*.84*1.05],[outer.cx+Math.cos(a)*outer.rad*1.08,outer.cy+Math.sin(a)*outer.rad*.84*1.08]],rgba(ink,i%4===0?.45:.18),.6);}
    label(c,'DETUNE '+sound.detune.toFixed(1)+' ct',r.x+pad,outer.cy-outer.rad*.5,rgba(ink,.7),8);
    drawPrisms(r,false,v);drawKeyboard(r,false,v,t);c.restore();
  }
  function drawPrisms(r,machine,v){
    const pad=r.w*.045,kw=r.w*.91/16,base=r.y+r.h*.7,snap=api.audio.snapshot(),min=api.quantize(0),span=Math.max(1,api.quantize(7)-min),step=(snap.step||0)%16;
    for(let i=0;i<16;i++){
      const midi=api.quantize(pattern[i]),height=r.h*(.018+(midi-min)/span*.09),xx=r.x+pad+i*kw+kw*.15,ww=kw*.57,depth=Math.min(8,kw*.24)*v.blockDepth,yy=base-height,active=api.state.playing&&i===step;
      if(machine){const face=c.createLinearGradient(xx,yy,xx+ww,base);face.addColorStop(0,'#ead7ff');face.addColorStop(.4,v.blocks);face.addColorStop(1,active?'#d9fac2':'#9676c0');c.fillStyle=face;c.fillRect(xx,yy,ww,height);c.fillStyle='#f3e6ff';c.beginPath();c.moveTo(xx,yy);c.lineTo(xx+depth,yy-depth);c.lineTo(xx+ww+depth,yy-depth);c.lineTo(xx+ww,yy);c.closePath();c.fill();c.fillStyle=rgba(v.blocks,.6);c.beginPath();c.moveTo(xx+ww,yy);c.lineTo(xx+ww+depth,yy-depth);c.lineTo(xx+ww+depth,base-depth);c.lineTo(xx+ww,base);c.closePath();c.fill();for(let sy=yy+2;sy<base;sy+=2.5)line(c,[[xx,sy],[xx+ww,sy]],rgba('#f4e7ff',.45),.5);}
      else{c.strokeStyle=rgba(v.ink,active?.9:.54);c.lineWidth=v.gridWeight;c.strokeRect(xx,yy,ww,height);line(c,[[xx,yy],[xx+depth,yy-depth],[xx+ww+depth,yy-depth],[xx+ww,yy]],rgba(v.ink,.58),v.gridWeight);line(c,[[xx+ww,base],[xx+ww+depth,base-depth],[xx+ww+depth,yy-depth]],rgba(v.ink,.58),v.gridWeight);if(active){c.fillStyle=rgba(v.ink,.12);c.fillRect(xx,yy,ww,height);}}
      if(active){c.fillStyle=machine?'#c9f0a0':v.ink;c.fillRect(xx,base+3,ww,2);}if(kw>25||i%2===0)label(c,api.noteName(midi),xx+ww/2,base+10,machine?'#c3d1ee':rgba(v.ink,.65),Math.max(6,Math.min(8,kw*.25)),'center');
    }
    label(c,'SEQ 16  /  PITCH ↑',r.x+pad,r.y+r.h*.575,machine?rgba(v.electric,.72):rgba(v.ink,.65),7);
  }
  function drawKeyboard(r,machine,v,t){
    const snap=api.audio.snapshot(),wave=keyWave,keys=keyboard(r),chars='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#';let peak=.008;for(let k=0;k<wave.length;k++)peak=Math.max(peak,Math.abs(wave[k]));
    for(const k of keys){
      const voices=(snap.voices||[]).filter(voice=>Math.round(voice.midi)===k.midi),level=Math.sqrt(clamp(Math.max(0,...voices.map(voice=>voice.level||0))*4)),gated=voices.some(voice=>voice.gate),ink=machine?v.electric:v.ink;
      c.fillStyle=machine?(k.black?rgba('#213744',.35+level*.35):rgba(gated?'#a5bf86':'#304368',gated?.08+level*.17:.13+level*.12)):k.black?rgba(v.ink,.94):v.paper;c.fillRect(k.x,k.y,k.w,k.h);c.strokeStyle=machine&&gated?'#b8ec81':rgba(ink,k.black?.65:.42);c.lineWidth=v.gridWeight;c.strokeRect(k.x,k.y,k.w,k.h);
      if(machine){
        c.save();c.beginPath();c.rect(k.x+2,k.y+2,k.w-4,k.h-18);c.clip();const font=Math.max(6,Math.min(9,k.w*.18)),columns=Math.max(2,Math.floor((k.w-4)/(font*.62))),rows=Math.floor((k.h-19)/(font+1.2+(1-v.asciiDensity)*2));c.font=`600 ${font}px ui-monospace,monospace`;
        for(let row=0;row<rows;row++){let text='',power=0;for(let col=0;col<columns;col++){const pos=wave.length?(row*43+col*71+k.midi*97)%wave.length:0,n=peak>.009?clamp((wave[pos]||0)/peak*v.signalScale/8,-1,1):0,d=peak>.009?clamp(((wave[(pos+17)%wave.length]||0)-(wave[pos]||0))/peak,-1,1):0;power+=Math.abs(n);text+=peak>.009?chars[Math.floor(clamp((n+1)*.42+(d+1)*.08,0,.999)*chars.length)]:' ';}power/=columns;if(peak<=.009)text=[api.noteName(k.midi),hz(k.midi).toFixed(1),'M'+k.midi,'A'+api.state.sound.attack.toFixed(2),'R'+api.state.sound.release.toFixed(2)][row%5].slice(0,columns);if(gated&&power>.4){c.fillStyle=rgba('#9dc94e',.18);c.fillRect(k.x+2,k.y+2+row*(font+1.2),k.w-4,font+1);c.fillStyle='#d4f59e';}else c.fillStyle=rgba('#e2e4ed',peak>.009?.48+power*.4:.28);c.fillText(text,k.x+3,k.y+font+3+row*(font+1.2));}c.restore();
      }else{c.fillStyle=k.black?rgba(v.paper,.5):rgba(ink,.22);c.beginPath();for(let j=0;j<Math.floor((k.black?150:220)*v.stipple);j++)c.rect(k.x+seed(j*7+k.midi)*k.w,k.y+seed(j*5+k.midi+500)*k.h,.65,.65);c.fill();}
      if(level>.01){c.fillStyle=machine?'#ceef9a':k.black?v.paper:v.ink;c.fillRect(k.x+2,k.y+k.h-3,(k.w-4)*level,1.5);}label(c,api.noteName(k.midi),k.x+k.w/2,k.y+k.h-9,machine?'#d1dbf2':k.black?v.paper:v.ink,Math.max(6,Math.min(9,k.w*.2)),'center');
    }
  }
  function drawMachine(r,v,t,energy,snap){
    const motionTime=api.reducedMotion?0:t;
    c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.fillStyle='#070b18';c.fillRect(r.x,r.y,r.w,r.h);
    const pad=r.w*.045,{cx,cy,rad}=dialRect(),electric=v.electric;
    const glow=c.createRadialGradient(cx,cy,rad*.3,cx,cy,rad*2.4);glow.addColorStop(0,rgba(electric,.11));glow.addColorStop(1,rgba(electric,0));c.fillStyle=glow;c.fillRect(r.x,r.y,r.w,r.h*.62);
    // Bounded radial light sheets and electrical paths follow the measured spectrum.
    const frequency=snap.frequency||[],scopeWave=snap.waveform||[];
    c.save();c.beginPath();c.rect(r.x,r.y+26,r.w,r.h*.69-26);c.clip();
    for(let fan=0;fan<11;fan++){
      const bin=frequency.length?(frequency[Math.floor(fan/11*frequency.length*.6)]||0):0,neighbour=frequency.length?(frequency[Math.floor((fan+1)/12*frequency.length*.6)]||0):0,angle=fan/11*TAU+t*v.panelRotation+.14*Math.sin(fan*2.1)+(bin-neighbour)*.2,spread=.07+.07*(.5+.5*Math.sin(fan*1.7))+bin*.1,inner=rad*(1.01+(fan%3)*.025),outer=rad*(1.72+.35*Math.sin(fan*1.3)+bin*.65);
      const sheet=c.createRadialGradient(cx,cy,inner,cx,cy,outer);sheet.addColorStop(0,rgba('#5c80ff',.03));sheet.addColorStop(.5,rgba('#4771ff',.22+v.traceGlow*.15+bin*.2));sheet.addColorStop(1,rgba(electric,0));
      c.save();c.shadowColor='#385bdd';c.shadowBlur=6+v.traceGlow*7;c.fillStyle=sheet;c.beginPath();c.moveTo(cx+Math.cos(angle-spread)*inner,cy+Math.sin(angle-spread)*inner*.88);c.lineTo(cx+Math.cos(angle-spread*1.35)*outer,cy+Math.sin(angle-spread*1.35)*outer*.88);c.lineTo(cx+Math.cos(angle+spread*1.35)*outer,cy+Math.sin(angle+spread*1.35)*outer*.88);c.lineTo(cx+Math.cos(angle+spread)*inner,cy+Math.sin(angle+spread)*inner*.88);c.closePath();c.fill();c.restore();
      for(let j=0;j<22;j++){const a=angle-spread+j/21*spread*2,pts=[];for(let k=0;k<22;k++){const f=k/21,rr=inner+(outer-inner)*f,amp=scopeWave.length?(scopeWave[(k*13+fan*37)%scopeWave.length]||0)*v.signalScale:0,bend=Math.sin(f*4+fan)*.026+amp*.025*f;pts.push([cx+Math.cos(a+bend)*rr,cy+Math.sin(a+bend)*rr*.88]);}line(c,pts,rgba(electric,.045+bin*.08),.65);}
    }
    c.restore();
    label(c,'MACHINE  /  VOICE STATE',r.x+pad,r.y+19,rgba('#cbd7ff',.8),9);
    label(c,`${hz(lastNote).toFixed(2)} Hz`,r.x+r.w-pad,r.y+19,'#dce4ff',11,'right');
    c.save();c.shadowBlur=v.traceGlow*12;c.shadowColor=electric;
    const bezel=c.createLinearGradient(cx-rad,cy-rad,cx+rad,cy+rad);bezel.addColorStop(0,'#b6d2ff');bezel.addColorStop(.25,electric);bezel.addColorStop(.55,'#182965');bezel.addColorStop(.8,'#6589e0');bezel.addColorStop(1,'#c4d4fb');
    c.strokeStyle=bezel;c.lineWidth=Math.max(5,rad*.035);c.beginPath();c.ellipse(cx,cy,rad,rad*.88,-.15,0,TAU);c.stroke();
    c.lineWidth=.8;c.strokeStyle=rgba('#bfd6ff',.65);for(const f of [.965,1.035]){c.beginPath();c.ellipse(cx,cy,rad*f,rad*.88*f,-.15,0,TAU);c.stroke();}
    c.lineWidth=.65;c.strokeStyle=rgba(electric,.48);for(const f of [.88,1.09]){c.beginPath();c.ellipse(cx,cy,rad*f,rad*.88*f,-.15,0,TAU);c.stroke();}
    c.restore();
    for(let i=0;i<40;i++){const a=i/40*TAU,rr=i%5===0?1.11:1.075;line(c,[[cx+Math.cos(a)*rad*1.02,cy+Math.sin(a)*rad*.9],[cx+Math.cos(a)*rad*rr,cy+Math.sin(a)*rad*.88*rr]],rgba(electric,i%5===0?.65:.25),.7);}
    const fraction=clamp(Math.log(api.state.sound.cutoff/120)/Math.log(14000/120)),angle=fraction*TAU-Math.PI/2,handleX=cx+Math.cos(angle)*rad,handleY=cy+Math.sin(angle)*rad*.88;
    c.strokeStyle='#bde989';c.lineWidth=1.3;c.beginPath();c.arc(handleX,handleY,4.5,0,TAU);c.stroke();line(c,[[handleX-Math.cos(angle)*7,handleY-Math.sin(angle)*7],[handleX+Math.cos(angle)*7,handleY+Math.sin(angle)*7]],'#c6f3aa',1);
    label(c,'FC '+formatHz(api.state.sound.cutoff)+' Hz',cx,cy+rad*.65,'#b9d7a4',8,'center');label(c,'FM '+api.state.sound.ratio.toFixed(2)+' ×  /  I '+api.state.sound.index.toFixed(2),cx,cy+rad*.76,rgba('#bdd2ee',.75),7,'center');
    const measured=snap.waveform||[],prior=traceHistory[Math.max(0,traceHistory.length-1-Math.floor(v.tracePersistence*8))]||measured;
    for(let bucket=0;bucket<cloudBuckets.length;bucket++){
      c.fillStyle=rgba(bucket>3?'#e3f7d9':'#bed3c7',.4+bucket*.065+energy*.16);c.beginPath();
      for(const p of cloudBuckets[bucket]){
        const a=p.a+motionTime*.12*v.formMotion,amp=measured.length?clamp(lerp(measured[(p.index*13)%measured.length],prior.length?prior[(p.index*13)%prior.length]:0,v.tracePersistence*.75)*v.signalScale,-1,1):0,fold=1+(.13+api.state.sound.index*.055)*Math.sin(a*(2+api.state.sound.ratio*.4)+p.z*4)+amp*.24;
        const ambient=motionTime*.17*v.formMotion,yaw=formPose.yaw+ambient,tilt=formPose.tilt+Math.sin(motionTime*.23)*.18*v.formMotion,px=p.x*Math.cos(yaw)+p.z*Math.sin(yaw),pz=p.z*Math.cos(yaw)-p.x*Math.sin(yaw),py=p.y*Math.cos(tilt)-pz*Math.sin(tilt),depth=p.y*Math.sin(tilt)+pz*Math.cos(tilt);
        const opening=clamp(Math.log(api.state.sound.cutoff/120)/Math.log(14000/120)),rr=rad*(.36+opening*.10)*fold*(1+Math.sin(motionTime*.7+p.z)*.025*v.formMotion),alignment=px*formPose.pullX+py*formPose.pullY,influence=Math.pow(clamp((alignment+1)*.5),3)*formPose.grip,xx=px*rr*(1-formPose.grip*.13)+formPose.pullX*rad*influence*.52,yy=py*rr*(1-formPose.grip*.13)+formPose.pullY*rad*influence*.52,perspective=1+depth*.13,size=.7+(depth+1)*.25+energy*.55;
        c.rect(cx+xx*perspective,cy+yy*perspective,size,size);
      }c.fill();
    }
    for(const contact of contacts.values()){if(contact.role!=='shape')continue;const px=contact.pointerX,py=contact.pointerY;c.strokeStyle='#c3f5a4';c.lineWidth=1.3;c.beginPath();c.arc(px,py,5,0,TAU);c.stroke();line(c,[[cx,cy],[px,py]],rgba('#c3f5a4',.6),.7);}
    for(const bar of envelopeBars()){
      const value=api.state.sound[bar.key],max=bar.key==='release'?5:2,f=bar.key==='sustain'?value:Math.log1p(value*80)/Math.log1p(max*80),height=clamp(f)*bar.h;
      c.strokeStyle=rgba(electric,.55);c.lineWidth=v.gridWeight;c.strokeRect(bar.x,bar.y,bar.w,bar.h);const gradient=c.createLinearGradient(0,bar.y+bar.h,0,bar.y);gradient.addColorStop(0,'#456c37');gradient.addColorStop(.45,'#9ac66b');gradient.addColorStop(1,'#e6ffc0');c.fillStyle=gradient;c.fillRect(bar.x+2,bar.y+bar.h-height,bar.w-4,height);
      for(let yy=bar.y+3;yy<bar.y+bar.h;yy+=4)line(c,[[bar.x+1,yy],[bar.x+bar.w-1,yy]],rgba('#101b23',.25),.5);line(c,[[bar.x,bar.y+bar.h-height],[bar.x+bar.w,bar.y+bar.h-height]],'#d9f6b8',1.2);label(c,bar.key[0].toUpperCase(),bar.x+bar.w/2,bar.y+bar.h+11,'#d7e8c4',8,'center');label(c,bar.key==='sustain'?Math.round(value*100)+'%':value<1?Math.round(value*1000)+'m':value.toFixed(1)+'s',bar.x+bar.w/2,bar.y+bar.h+22,'#98ad99',7,'center');
    }
    const compact=r.h<440,ly=r.y+r.h*.505,lh=r.h*(compact?.043:.073);
    c.strokeStyle=rgba(electric,.32);c.lineWidth=v.gridWeight;c.strokeRect(r.x+pad,ly,r.w-pad*2,lh);
    const time=snap.time||0, recent=events.filter(e=>e.when<=time).slice(0,compact?1:3);
    for(let i=0;i<(compact?1:3);i++){const e=recent[i],text=e?`${i===0?'NOW ':'PAST'} ${api.noteName(e.midi).padEnd(3)} ${e.when.toFixed(3).padStart(7)}s`:'—';label(c,text,r.x+pad+6,ly+11+i*10,rgba('#d4dcf7',.8-i*.18),7.5);}
    const wave=snap.waveform||[],pts=[];for(let i=0;i<100;i++){const value=wave.length?clamp(wave[Math.floor(i/100*wave.length)]*v.signalScale,-1,1):0;pts.push([r.x+r.w*.48+i/99*r.w*.45,ly+lh/2+value*lh*.38]);}line(c,pts,rgba('#b8e8d2',.8),.8);
    drawPrisms(r,true,v);drawKeyboard(r,true,v,t);c.restore();
  }
  function drawTransfer(v,t,snap){
    const [left,machine]=layout(),right=dialRect(),outer=draftOuter(),stacked=machine.y>left.y+left.h*.5,voices=(snap.voices||[]).filter(voice=>voice.level>.001),time=snap.time||0,energy=Math.sqrt(clamp(Math.max(0,...voices.map(voice=>voice.level||0))*5)),duration=clamp(60/api.state.bpm*.95,.3,1.3);
    const point=(path,f)=>{if(path.segments){const n=path.segments.length,index=Math.min(n-1,Math.floor(f*n));return point(path.segments[index],f*n-index);}const g=1-f;return{x:g*g*g*path.a.x+3*g*g*f*path.b.x+3*g*f*f*path.c.x+f*f*f*path.d.x,y:g*g*g*path.a.y+3*g*g*f*path.b.y+3*g*f*f*path.c.y+f*f*f*path.d.y};};
    for(let lane=0;lane<5;lane++){
      const offset=(lane-2),a={x:outer.cx+outer.rad*.69,y:outer.cy+outer.rad*offset*.18},d={x:right.cx-right.rad*.25,y:right.cy+right.rad*offset*.095},path={a,b:{x:left.x+left.w+.035*left.w,y:a.y},c:{x:right.cx-right.rad*.65,y:d.y},d};
      if(stacked){const rail=left.x+left.w-3-lane*1.8,junction={x:rail,y:machine.y-9},entry={x:right.cx+right.rad*.72,y:machine.y+28};path.segments=[{a,b:{x:rail,y:a.y},c:{x:rail,y:a.y+24},d:{x:rail,y:a.y+40}},{a:{x:rail,y:a.y+40},b:{x:rail,y:left.y+left.h*.7},c:{x:rail,y:left.y+left.h},d:junction},{a:junction,b:{x:rail,y:machine.y+2},c:{x:entry.x,y:machine.y+2},d:entry},{a:entry,b:{x:right.cx,y:right.cy-right.rad*.8},c:{x:d.x,y:right.cy-right.rad*.4},d}];}
      for(const voice of voices){const anchor=anchors.get(voice.id);if(anchor?.u===undefined||Math.abs(voice.midi)%5!==lane)continue;const source=ringProjection(anchor);line(c,[[source.x,source.y],[a.x,a.y]],rgba(v.ink,.2+Math.sqrt(clamp(voice.level*5))*.5),.8);}
      const grad=c.createLinearGradient(a.x,a.y,d.x,d.y);grad.addColorStop(0,rgba(v.ink,.2+energy*.25));grad.addColorStop(.52,rgba(v.electric,.2+energy*.3));grad.addColorStop(1,rgba('#bbdfad',.2+energy*.6));c.strokeStyle=grad;c.lineWidth=.6+energy*.45;c.beginPath();c.moveTo(a.x,a.y);for(const segment of path.segments||[path])c.bezierCurveTo(segment.b.x,segment.b.y,segment.c.x,segment.c.y,segment.d.x,segment.d.y);c.stroke();
      if(energy>.01)for(let j=0;j<7;j++){const f=(time*api.state.bpm/60*.36+j/7+lane*.04)%1,p=point(path,f);c.fillStyle=f<.4?rgba(v.ink,energy*.72):rgba('#c9eac8',energy*.9);c.fillRect(p.x,p.y,1.7,1.7);}
      for(const event of events){const age=time-event.when;if(age<0||age>duration||Math.abs(event.midi)%5!==lane)continue;for(let k=0;k<10;k++){const f=age/duration-k*.015;if(f<0)continue;const p=point(path,f);c.fillStyle=f<.4?rgba(v.ink,.9*(1-k/11)):rgba('#dcffbf',.95*(1-k/11));const size=k<2?3:1.7;c.fillRect(p.x,p.y,size,size);}}
      if(energy>.04){c.strokeStyle=rgba('#b9ed9f',energy*.35);c.beginPath();c.arc(d.x,d.y,2+energy*3,0,TAU);c.stroke();}
    }
  }
  function cancel(){for(const p of contacts.values())if(p.midi!==undefined)(api.noteCancel||api.noteOff)(p.id);contacts.clear();navigation.clear();anchors.clear();pinch=null;keyIds.clear();}
  return {
    frame(t,dt){
      elapsed=t;surface.resize();const w=surface.width,h=surface.height;if(!w||!h)return;
      const v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot(),target=new Float32Array(13);
      const latest=(snap.voices||[]).reduce((a,b)=>!a||(b.started||0)>(a.started||0)?b:a,null);if(latest)lastNote=latest.midi;
      for(const voice of snap.voices||[]){const i=keyIndex(voice.midi);target[i]=Math.max(target[i],Math.sqrt(clamp((voice.level||0)*4)));}
      for(let i=0;i<13;i++)levels[i]=lerp(levels[i],target[i],1-Math.exp(-dt*14));
      if(++frameCounter%3===0){traceHistory.push(Array.from(snap.waveform||[]).filter((_,i)=>i%4===0));if(traceHistory.length>9)traceHistory.shift();}
      if(t-keyWaveTime>=1/v.keyRefresh){keyWaveTime=t;keyWave=Array.from(snap.waveform||[]);}
      const gesture=[...contacts.values()].find(p=>p.role==='shape'),dial=dialRect(),yawTarget=gesture?(gesture.x/.7-.5)*2.6:0,tiltTarget=gesture?clamp((gesture.y-.25)*4,-.65,.65):0,ease=1-Math.exp(-dt*8);formPose.yaw=lerp(formPose.yaw,yawTarget,ease);formPose.tilt=lerp(formPose.tilt,tiltTarget,ease);formPose.pullX=lerp(formPose.pullX,gesture?clamp((gesture.pointerX-dial.cx)/dial.rad,-1,1):0,ease);formPose.pullY=lerp(formPose.pullY,gesture?clamp((gesture.pointerY-dial.cy)/dial.rad,-1,1):0,ease);formPose.grip=lerp(formPose.grip,gesture?1:0,1-Math.exp(-dt*(gesture?11:4)));if(!api.reducedMotion&&!navigation.size)ringPhase+=dt*v.ringDrift;
      const energy=clamp((snap.rms||0)*4+Math.max(...levels)*.3,0,1);c.clearRect(0,0,w,h);const panes=layout();drawHand(panes[0],v,t,energy);drawMachine(panes[1],v,t,energy,snap);ringTime=t;updateRing(t,v,snap);drawTransfer(v,t,snap);if(anchors.size>192){const active=new Set((snap.voices||[]).map(voice=>voice.id));for(const id of anchors.keys())if(!active.has(id))anchors.delete(id);}
    },
    onStep(step,when){const midi=api.quantize(pattern[step%16]);api.audio.pulse('hand-sequence-'+step,midi,{...api.state.sound,gain:.15,pan:step%2?.13:-.13},when,60/api.state.bpm*.32);record(midi,when,{step:step%16});},
    cancel,
    setPlaying(playing){if(!playing)events=events.filter(event=>event.source?.step===undefined);},
    getData(){return {pattern:pattern.slice(),ringCamera:{...cameraState}};},
    setData(data){cancel();if(Array.isArray(data?.pattern)&&data.pattern.length===16)pattern=data.pattern.map((v,i)=>Number.isFinite(v)?Math.round(clamp(v,0,7)):basePattern[i]);if(data?.ringCamera)for(const key of ['yaw','pitch','zoom'])if(Number.isFinite(data.ringCamera[key]))cameraState[key]=key==='zoom'?clamp(data.ringCamera[key],.6,1.4):data.ringCamera[key];},
    destroy(){cancel();off();canvas.removeEventListener('wheel',wheel);if(ring){ring.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});ring.renderer.dispose();ring.renderer.forceContextLoss();ring.el.remove();}reliefCanvas.width=0;reliefCanvas.height=0;surface.destroy();}
  };
}
