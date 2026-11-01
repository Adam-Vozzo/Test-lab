import * as THREE from '../vendor/three.module.min.js';
import {TAU,clamp,lerp,createSurface,bindPointers,label,line,rgba} from './kit.js';

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
  id:'structure',name:'Structural Score',batch:3,
  theme:{bg:'#080b1b',fg:'#e3e8fa',accent:'#b295ed',muted:'#919bb7'},
  defaultSound:{waveform:'triangle',attack:.009,decay:.24,sustain:.25,release:.8,cutoff:5400,resonance:2,ratio:3,index:.9,detune:5},
  defaultAppearance:{paper:'#eeece4',ink:'#494751',loopColour:'#9573d5',signalColour:'#b3f09e',lobes:7,lobeDepth:.22,tubeWidth:.15,structureDepth:1,lineWeight:.8,historyDepth:.75,historyGain:1.15,asciiDensity:.65,rotation:.035,fieldGlow:.45},
  soundControls:[
    {key:'waveform',label:'String waveform',kind:'select',options:[['triangle','Triangle'],['sine','Sine'],['sawtooth','Saw'],['square','Square']],section:'Voice',description:'Oscillator used by score nodes and the spectral loop.'},
    range('cutoff','Low-pass cutoff',120,14000,20,'Voice','Brightness of every plucked score event.','Hz'),
    range('resonance','Filter resonance',.1,10,.1,'Voice','Emphasis around the cutoff frequency.','Q'),
    range('ratio','Modulator ratio',.5,8,.25,'Voice','Frequency relationship shaping each note.','×'),
    range('index','Modulation index',0,7,.05,'Voice','Harmonic detail of the score voice and loop surface.'),
    range('attack','Attack',.005,1,.005,'Envelope','Rise time of each touched or sequenced node.','s'),
    range('release','Release',.08,4,.02,'Envelope','Decay tail after a score node is released.','s'),
  ],
  appearanceControls:[
    {key:'paper',label:'Score paper',kind:'color',section:'Score',description:'Background of the truss and editable pitch matrix.'},
    {key:'ink',label:'Structure ink',kind:'color',section:'Score',description:'Truss edges, note rails and printed values.'},
    range('structureDepth','Truss depth',.3,1.7,.05,'Score','Extrusion of the printed structural cells.'),
    range('lineWeight','Line weight',.4,1.5,.05,'Score','Stroke width of the structural drawing and score matrix.','px'),
    {key:'loopColour',label:'Loop material',kind:'color',section:'Spectral loop',description:'Surface colour of the continuous three-dimensional loop.'},
    range('lobes','Loop lobes',3,12,1,'Spectral loop','Number of broad folds around the continuous loop.'),
    range('lobeDepth','Fold depth',0,.55,.01,'Spectral loop','Radial depth of the loop folds.'),
    range('tubeWidth','Tube thickness',.08,.26,.01,'Spectral loop','Thickness of the continuous tubular surface.'),
    range('rotation','Ambient rotation',0,.12,.005,'Spectral loop','Slow rotation of the loop; direct orbit gestures remain independent.','rad/s'),
    range('fieldGlow','Field glow',0,1,.05,'Spectral loop','Blue atmosphere behind the loop; scales with output level.'),
    {key:'signalColour',label:'Contact colour',kind:'color',section:'Connections',description:'Touch reticles and the connection from the selected score node.'},
    range('historyDepth','Spectrum history',.2,1,.05,'Analysis','Number of recent measured spectral slices shown above the loop.'),
    range('historyGain','Spectrum height',.3,2,.05,'Analysis','Vertical scale of measured frequency bins.'),
    range('asciiDensity','ASCII density',.25,1,.05,'Analysis','Sampling density of the live waveform text below the loop.'),
  ]
};

const original=[0,4,2,6,3,7,5,2,0,3,6,4,7,5,2,1];
const nodeCount=16,U=96,V=12;
const hz=m=>440*Math.pow(2,(m-69)/12);
const random=i=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};

export function mount(host,api){
  const surface=createSurface(host,{label:'Structural score. Drag printed nodes or score cells to edit pitch. Play the purple loop; drag empty space around it to orbit, or pinch and scroll there to zoom.'});
  const {canvas,ctx:c}=surface;canvas.style.position='absolute';canvas.style.inset='0';canvas.style.zIndex='2';
  let pattern=original.slice(),selected=0,cameraView={yaw:.08,pitch:.24,zoom:1.15},rotationPhase=0;
  let currentTime=0,frameCount=0,gestureSerial=0,history=[],lastMidi=api.quantize(0),sizeKey='';
  let contacts=new Map(),anchors=new Map(),nav=new Map(),pinch=null,levels=new Float32Array(nodeCount),webgl=null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const vec=new THREE.Vector3(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
  function layout(){
    const w=surface.width,h=surface.height,portrait=w<h*.83,gap=portrait?10:12;
    const left=portrait?{x:0,y:0,w,h:(h-gap)/2}:{x:0,y:0,w:(w-gap)/2,h};
    const right=portrait?{x:0,y:left.h+gap,w,h:left.h}:{x:(w+gap)/2,y:0,w:(w-gap)/2,h};
    return {left,right,loop:{x:right.x+right.w*.015,y:right.y+right.h*.255,w:right.w*.97,h:right.h*.54}};
  }
  function makeWebGL(){
    try{
      const renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
      const el=renderer.domElement;el.style.cssText='position:absolute;z-index:1;pointer-events:none;';el.setAttribute('aria-hidden','true');host.append(el);
      const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,80),group=new THREE.Group();scene.add(group);
      scene.add(new THREE.AmbientLight('#c8c4ff',1.5));
      const key=new THREE.DirectionalLight('#e4dcff',3);key.position.set(-3,5,6);scene.add(key);
      const rim=new THREE.DirectionalLight('#506cff',2.7);rim.position.set(3,-2,-2);scene.add(rim);
      const fill=new THREE.PointLight('#bfa1ef',15,15,2);fill.position.set(0,-2,4);scene.add(fill);
      const geometry=new THREE.BufferGeometry(),positions=new Float32Array((U+1)*(V+1)*3),colors=new Float32Array(positions.length),uvs=new Float32Array((U+1)*(V+1)*2),indices=[];
      for(let i=0;i<=U;i++)for(let j=0;j<=V;j++){const n=i*(V+1)+j;uvs[n*2]=i/U;uvs[n*2+1]=j/V;if(i<U&&j<V){const a=n,b=n+V+1;indices.push(a,b,a+1,a+1,b,b+1);}}
      geometry.setIndex(indices);geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),3.2);
      const material=new THREE.MeshPhysicalMaterial({color:'#ffffff',vertexColors:true,roughness:.32,metalness:.17,clearcoat:.8,clearcoatRoughness:.35,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,material);group.add(mesh);
      const guideGeometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:129},(_,i)=>new THREE.Vector3(Math.cos(i/128*TAU)*1.55,Math.sin(i/128*TAU)*1.55,-.12)));
      const guide=new THREE.Line(guideGeometry,new THREE.LineBasicMaterial({color:'#7f99ff',transparent:true,opacity:.4,depthWrite:false}));group.add(guide);
      const contactGeometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:65},()=>new THREE.Vector3()));
      const connection=new THREE.Line(contactGeometry,new THREE.LineBasicMaterial({color:'#b3f09e',transparent:true,opacity:.8,depthWrite:false}));scene.add(connection);connection.visible=false;
      const dot=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color:'#b3f09e'}));scene.add(dot);dot.visible=false;
      return {renderer,scene,camera,group,mesh,geometry,material,positions,colors,guide,connection,dot,el};
    }catch{return null;}
  }
  webgl=makeWebGL();
  function pointAt(u,v,t,appearance=api.state.appearance,out=new THREE.Vector3()){
    const a=u*TAU,b=v*TAU,lobes=Math.round(appearance.lobes??7),fold=appearance.lobeDepth??.22,width=appearance.tubeWidth??.15;
    const idx=Math.floor(((u%1)+1)%1*16),level=levels[idx]||0;
    const radial=1.28+fold*Math.cos(a*lobes)+level*.09;
    const tube=width*(1+level*.2),z=.075*Math.sin(a*3+t*.16)*(reduced.matches?0:1)+tube*Math.sin(b);
    return out.set((radial+tube*Math.cos(b))*Math.cos(a),(radial+tube*Math.cos(b))*Math.sin(a),z);
  }
  function updateGeometry(t,v){
    if(!webgl)return;
    const {geometry,positions,colors,group}=webgl,base=new THREE.Color(v.loopColour),active=new THREE.Color(v.signalColour),col=new THREE.Color();
    for(let i=0;i<=U;i++)for(let j=0;j<=V;j++){
      const n=i*(V+1)+j,p=pointAt(i/U,j/V,t,v,vec);positions[n*3]=p.x;positions[n*3+1]=p.y;positions[n*3+2]=p.z;
      const level=levels[Math.min(15,Math.floor(i/U*16))];col.copy(base).lerp(active,level*.32);col.multiplyScalar(.78+.17*Math.sin(j/V*TAU)+level*.14);colors[n*3]=col.r;colors[n*3+1]=col.g;colors[n*3+2]=col.b;
    }
    geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;geometry.computeVertexNormals();
    group.rotation.set(cameraView.pitch,cameraView.yaw,rotationPhase);group.updateMatrixWorld(true);
  }
  function fit(v){
    if(!webgl)return;const r=layout().loop,key=[Math.round(r.w),Math.round(r.h),Math.min(devicePixelRatio||1,1.5)].join('|');
    if(key!==sizeKey){sizeKey=key;webgl.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));webgl.renderer.setSize(Math.max(1,r.w),Math.max(1,r.h),false);webgl.el.style.left=r.x+'px';webgl.el.style.top=r.y+'px';webgl.el.style.width=r.w+'px';webgl.el.style.height=r.h+'px';webgl.camera.aspect=r.w/r.h;webgl.camera.updateProjectionMatrix();}
    const halfVertical=THREE.MathUtils.degToRad(20),halfHorizontal=Math.atan(Math.tan(halfVertical)*webgl.camera.aspect),bound=1.28+v.lobeDepth+v.tubeWidth*1.2+.13;
    const distance=bound/Math.sin(Math.min(halfVertical,halfHorizontal))*1.08*(1.5/cameraView.zoom);webgl.camera.position.set(0,0,distance);webgl.camera.lookAt(0,0,0);webgl.camera.updateMatrixWorld();
  }
  function pick(x,y){
    const r=layout().loop;if(x<r.x||x>r.x+r.w||y<r.y||y>r.y+r.h)return null;
    if(webgl){pointer.set((x-r.x)/r.w*2-1,1-(y-r.y)/r.h*2);raycaster.setFromCamera(pointer,webgl.camera);const hit=raycaster.intersectObject(webgl.mesh)[0];if(hit)return {u:hit.uv.x,v:hit.uv.y};return null;}
    const dx=(x-r.x-r.w/2)/(Math.min(r.w,r.h)*.36),dy=(y-r.y-r.h/2)/(Math.min(r.w,r.h)*.3),radius=Math.hypot(dx,dy);
    return radius>.72&&radius<1.25?{u:((Math.atan2(-dy,dx)/TAU)%1+1)%1,v:.25}:null;
  }
  function project(u,v){const r=layout().loop;if(webgl){const p=pointAt(u,v,currentTime);p.applyMatrix4(webgl.group.matrixWorld).project(webgl.camera);return{x:r.x+(p.x*.5+.5)*r.w,y:r.y+(.5-p.y*.5)*r.h};}const a=u*TAU;return{x:r.x+r.w/2+Math.cos(a)*Math.min(r.w,r.h)*.36,y:r.y+r.h/2-Math.sin(a)*Math.min(r.w,r.h)*.3};}
  function trussNodes(r){
    return Array.from({length:16},(_,i)=>{const row=i<8?0:1,j=i%8,t=j/7;return {x:r.x+r.w*(.09+t*.82),y:r.y+r.h*(row===0?.40-t*.23:.17+t*.23)+(3.5-pattern[i])*r.h*.009};});
  }
  function scoreHit(p){const r=layout().left;if(p.x<r.x||p.x>r.x+r.w||p.y<r.y||p.y>r.y+r.h)return null;
    const x=(p.x-r.x)/r.w,y=(p.y-r.y)/r.h;
    if(y>.57&&y<.955&&x>.105&&x<.955)return {index:Math.min(15,Math.floor((x-.105)/.85*16)),degree:Math.round(clamp(1-(y-.59)/.345,0,1)*7),mode:'matrix'};
    const nodes=trussNodes(r);let index=0,d=Infinity;nodes.forEach((n,i)=>{const distance=Math.hypot(p.x-n.x,p.y-n.y);if(distance<d){d=distance;index=i;}});return y<.54?{index,degree:pattern[index],mode:'truss'}:null;
  }
  function play(contact,first=false){
    const index=contact.role==='loop'?Math.min(15,Math.floor(contact.u*16)):contact.index,midi=api.quantize(pattern[index]);selected=index;lastMidi=midi;
    const options={...api.state.sound,gain:.16,pan:contact.role==='loop'?.15:-.12};
    if(first)api.noteOn(contact.id,midi,options);else api.noteUpdate(contact.id,midi,options);contact.midi=midi;
    anchors.set(contact.id,{index,u:contact.role==='loop'?contact.u:undefined,v:contact.v});
    api.setStatus(`STEP ${String(index+1).padStart(2,'0')}  ·  ${api.noteName(midi)}  ·  ${hz(midi).toFixed(2)} Hz`);
  }
  function navPair(){return [...nav.values()].slice(0,2);}
  const off=bindPointers(canvas,{
    down(p){
      const score=scoreHit(p);if(score){const contact={id:'structure-'+p.id+'-'+(++gestureSerial),role:'score',index:score.index,mode:score.mode,startY:p.y,startDegree:pattern[score.index]};contacts.set(p.id,contact);if(score.mode==='matrix')pattern[score.index]=score.degree;play(contact,true);return;}
      const hit=pick(p.x,p.y);if(hit){const contact={id:'structure-'+p.id+'-'+(++gestureSerial),role:'loop',...hit};contacts.set(p.id,contact);play(contact,true);return;}
      const r=layout().right;if(p.x<r.x||p.y<r.y)return false;
      nav.set(p.id,{x:p.x,y:p.y});if(nav.size>=2){const [a,b]=navPair();pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:cameraView.zoom};}return;
    },
    move(p){
      const contact=contacts.get(p.id);if(contact){
        if(contact.role==='loop'){const hit=pick(p.x,p.y);if(hit){contact.u=hit.u;contact.v=hit.v;play(contact);}}
        else{const r=layout().left;if(contact.mode==='matrix'){const hit=scoreHit(p);if(hit?.mode==='matrix'){contact.index=hit.index;pattern[contact.index]=hit.degree;}}else pattern[contact.index]=Math.round(clamp(contact.startDegree+(contact.startY-p.y)/(r.h*.03),0,7));play(contact);api.save();}return;
      }
      const previous=nav.get(p.id);if(!previous)return;const dx=p.x-previous.x,dy=p.y-previous.y;nav.set(p.id,{x:p.x,y:p.y});
      if(nav.size>=2&&pinch){const [a,b]=navPair();cameraView.zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,.55,1.5);}else{cameraView.yaw+=dx*.008;cameraView.pitch+=dy*.008;}
    },
    up(p){end(p);},cancel(p){end(p);}
  });
  function end(p){const contact=contacts.get(p.id);if(contact){api.noteOff(contact.id);contacts.delete(p.id);}nav.delete(p.id);if(nav.size<2)pinch=null;api.save();}
  const wheel=e=>{const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,r=layout().right;if(x<r.x||y<r.y||pick(x,y))return;e.preventDefault();cameraView.zoom=clamp(cameraView.zoom*Math.exp(-e.deltaY*.001),.55,1.5);api.save();};canvas.addEventListener('wheel',wheel,{passive:false});
  const keyIds=new Set(),keyMap='asdfghjk';
  const keyDown=e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;const i=keyMap.indexOf(e.key.toLowerCase());if(i>=0){e.preventDefault();const id='structure-key-'+i;keyIds.add(id);api.noteOn(id,api.quantize(i),{gain:.16});lastMidi=api.quantize(i);}else if(e.key==='Home'){e.preventDefault();cameraView={yaw:.08,pitch:.24,zoom:1.15};}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();cameraView.yaw+=(e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0);cameraView.pitch+=(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0);}};
  const keyUp=e=>{const i=keyMap.indexOf(e.key.toLowerCase());if(i>=0){const id='structure-key-'+i;api.noteOff(id);keyIds.delete(id);}};canvas.addEventListener('keydown',keyDown);canvas.addEventListener('keyup',keyUp);
  function drawScore(r,v,snap){
    const ink=v.ink,pad=r.w*.05;c.fillStyle=v.paper;c.fillRect(r.x,r.y,r.w,r.h);c.fillStyle=rgba(ink,.04);for(let i=0;i<520;i++)c.fillRect(r.x+random(i)*r.w,r.y+random(i+1000)*r.h,.8,.8);
    label(c,'SCORE  /  16 NODES',r.x+pad,r.y+20,rgba(ink,.75),9);label(c,api.noteName(lastMidi),r.x+r.w-pad,r.y+20,ink,12,'right');
    const nodes=trussNodes(r),depth=r.w*.022*v.structureDepth,cube=Math.min(r.w*.055,r.h*.06);
    for(let row=0;row<2;row++)for(let j=0;j<7;j++){
      const a=nodes[row*8+j],b=nodes[row*8+j+1];line(c,[[a.x-cube/2,a.y-cube/2],[b.x-cube/2,b.y-cube/2]],rgba(ink,.6),v.lineWeight);line(c,[[a.x+cube/2,a.y+cube/2],[b.x+cube/2,b.y+cube/2]],rgba(ink,.6),v.lineWeight);line(c,[[a.x-cube/2,a.y-cube/2],[b.x+cube/2,b.y+cube/2]],rgba(ink,.32),v.lineWeight*.7);
    }
    nodes.forEach((p,i)=>{
      const x=p.x-cube/2,y=p.y-cube/2,active=levels[i];c.strokeStyle=rgba(ink,.45+active*.5);c.lineWidth=v.lineWeight;c.strokeRect(x,y,cube,cube);
      line(c,[[x,y],[x+depth,y-depth],[x+cube+depth,y-depth],[x+cube,y]],rgba(ink,.65),v.lineWeight);line(c,[[x+cube,y+cube],[x+cube+depth,y+cube-depth],[x+cube+depth,y-depth]],rgba(ink,.65),v.lineWeight);line(c,[[x,y+cube],[x+depth,y+cube-depth],[x+cube+depth,y+cube-depth]],rgba(ink,.24),v.lineWeight*.7);
      if(i===selected||active>.05){c.fillStyle=rgba(ink,.2+active*.6);c.beginPath();c.arc(p.x,p.y,2.2+active*2.5,0,TAU);c.fill();}
      if(r.h>440||i===selected)label(c,String(i+1).padStart(2,'0'),p.x,p.y+cube*.95,rgba(ink,.53),7,'center');
    });
    label(c,'DRAG NODE  /  PITCH',r.x+pad,r.y+r.h*.515,rgba(ink,.55),8);
    label(c,`STEP ${String((snap.step??0)%16+1).padStart(2,'0')}`,r.x+r.w-pad,r.y+r.h*.515,rgba(ink,.7),8,'right');
    const x=r.x+r.w*.105,y=r.y+r.h*.59,w=r.w*.85,h=r.h*.345,cw=w/16,rh=h/7;
    c.strokeStyle=rgba(ink,.23);c.lineWidth=v.lineWeight*.7;c.setLineDash([3,4]);c.strokeRect(x-4,y-8,w+8,h+16);c.setLineDash([]);
    for(let row=0;row<8;row++){
      const yy=y+row*rh;label(c,api.noteName(api.quantize(7-row)),x-9,yy,rgba(ink,.72),8,'right');c.setLineDash([5,5]);line(c,[[x,yy],[x+w,yy]],rgba(ink,.3),v.lineWeight*.6);c.setLineDash([]);
    }
    for(let i=0;i<16;i++){
      const yy=y+(1-clamp(pattern[i]/7,0,1))*h,xx=x+(i+.5)*cw,active=api.state.playing&&i===(snap.step??0)%16;
      if(active){c.fillStyle=rgba(ink,.055);c.fillRect(x+i*cw,y-7,cw,h+14);}
      c.fillStyle=rgba(ink,active?.94:.66);c.fillRect(xx-cw*.28,yy-2,cw*.56,4);if(i===selected){c.strokeStyle=rgba(ink,.55);c.lineWidth=.8;c.beginPath();c.arc(xx,yy,cw*.43,0,TAU);c.stroke();}
      if(r.w>350&&i%2===0)label(c,String(i+1).padStart(2,'0'),xx,Math.min(r.y+r.h-6,y+h+20),rgba(ink,.5),7,'center');
    }
  }
  function drawAnalysis(r,v,snap){
    const x=r.x+r.w*.045,y=r.y+16,w=r.w*.91,h=r.h*.205,ink='#99b6b2';
    c.strokeStyle=rgba(ink,.4);c.lineWidth=v.lineWeight;c.strokeRect(x,y,w,h);
    label(c,'SPECTRUM HISTORY',x+8,y+13,rgba(ink,.9),8);label(c,`${hz(lastMidi).toFixed(2)} Hz`,x+w-9,y+13,'#d6e5e4',11,'right');
    const slices=history.slice(-Math.max(4,Math.floor(v.historyDepth*22)));
    for(let j=0;j<slices.length;j++){
      const age=j/Math.max(1,slices.length-1),bins=slices[j],pts=[];
      for(let i=0;i<64;i++){const val=bins[i]||0;pts.push([x+w*.15+i/63*w*.69+(1-age)*w*.09,y+h*.88-(1-age)*h*.35-val*h*.38*v.historyGain]);}
      line(c,pts,rgba(v.loopColour,.16+age*.65),.7);
    }
    if(!slices.length)line(c,[[x+w*.15,y+h*.88],[x+w*.84,y+h*.88]],rgba(v.loopColour,.35),.8);
    const wave=snap.waveform||[],chars=' .,:;!172ZX#',rows=Math.max(3,Math.floor(r.h*.155/(9+(1-v.asciiDensity)*6))),cols=Math.max(16,Math.floor(r.w*.86/7));
    c.save();c.beginPath();c.rect(x,r.y+r.h*.83,w,r.h*.15);c.clip();c.font='8px ui-monospace, monospace';c.fillStyle=rgba('#d3d4ec',.65);
    for(let row=0;row<rows;row++){let text='';for(let i=0;i<cols;i++){const amplitude=wave.length?Math.abs(wave[(row*cols+i)%wave.length]):0;text+=chars[Math.floor(clamp(amplitude*1.8,0,.999)*chars.length)];}c.fillText(text,x+5,r.y+r.h*.847+row*10);}c.restore();
    label(c,`N ${String((snap.voices||[]).length).padStart(2,'0')}  /  RMS ${(snap.rms||0).toFixed(3)}`,x,r.y+r.h*.8,rgba('#bdd2d2',.8),8);
    label(c,'ORBIT  ·  PINCH',x+w,r.y+r.h*.8,rgba('#9ca6c5',.6),8,'right');
  }
  function drawFallback(r,v,t){
    const cx=r.x+r.w/2,cy=r.y+r.h/2,scale=Math.min(r.w,r.h)*.28;
    for(let j=0;j<10;j++){const pts=[];for(let i=0;i<=180;i++){const a=i/180*TAU,rr=1.28+v.lobeDepth*Math.cos(a*v.lobes)+Math.cos(j/9*TAU)*v.tubeWidth;pts.push([cx+Math.cos(a)*rr*scale,cy+Math.sin(a)*rr*scale*.8+Math.sin(j/9*TAU)*scale*v.tubeWidth]);}line(c,pts,rgba(v.loopColour,.25+j/20),1.4);}
  }
  function drawConnection(v,snap){
    const {left,loop}=layout(),nodes=trussNodes(left);const held=(snap.voices||[]).find(voice=>anchors.get(voice.id)?.u!==undefined&&(voice.level||0)>.002);const active=[...contacts.values()].find(p=>p.role==='loop')||(held?anchors.get(held.id):null);const level=Math.max(...levels),node=nodes[active?Math.min(15,Math.floor(active.u*16)):selected];
    if(!active&&level<.02){if(webgl){webgl.connection.visible=false;webgl.dot.visible=false;}return;}
    const u=active?active.u:(selected+.5)/16,vv=active?active.v:.25,point=project(u,vv),edge={x:loop.x,y:clamp(node.y,loop.y+loop.h*.12,loop.y+loop.h*.88)};
    c.save();c.strokeStyle=rgba(v.signalColour,.2+level*.5);c.lineWidth=.9;c.setLineDash([2,4]);c.beginPath();c.moveTo(node.x,node.y);c.bezierCurveTo(node.x+left.w*.2,node.y,edge.x-30,edge.y,edge.x,edge.y);c.stroke();c.setLineDash([]);c.restore();
    if(webgl){
      const {connection,dot,camera,group}=webgl;pointer.set(-1,1-(edge.y-loop.y)/loop.h*2);raycaster.setFromCamera(pointer,camera);const start=new THREE.Vector3();raycaster.ray.intersectPlane(plane,start);
      const end=pointAt(u,vv,currentTime).applyMatrix4(group.matrixWorld),control=start.clone().lerp(end,.5).add(new THREE.Vector3(0,-.18,.03));
      const curve=new THREE.QuadraticBezierCurve3(start,control,end),array=connection.geometry.attributes.position.array;
      for(let i=0;i<65;i++){const p=curve.getPoint(i/64);array[i*3]=p.x;array[i*3+1]=p.y;array[i*3+2]=p.z;}
      connection.geometry.attributes.position.needsUpdate=true;connection.geometry.computeBoundingSphere();connection.material.color.set(v.signalColour);connection.material.opacity=.3+level*.5;connection.visible=true;dot.position.copy(end);dot.material.color.set(v.signalColour);dot.visible=true;
    }else line(c,[[edge.x,edge.y],[point.x,point.y]],rgba(v.signalColour,.6),1);
    if(!webgl){c.strokeStyle=rgba(v.signalColour,.85);c.lineWidth=1;c.beginPath();c.arc(point.x,point.y,7,0,TAU);c.stroke();}
  }
  function cancel(){for(const p of contacts.values())api.noteOff(p.id);for(const id of keyIds)api.noteOff(id);contacts.clear();anchors.clear();nav.clear();keyIds.clear();pinch=null;}
  return {
    frame(t,dt){
      currentTime=t;surface.resize();const w=surface.width,h=surface.height;if(w<2||h<2)return;const v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot(),target=new Float32Array(16);
      const sounding=new Set();let latest=null;
      for(const voice of snap.voices||[]){sounding.add(voice.id);if(!latest||(voice.started||0)>(latest.started||0))latest=voice;const anchor=anchors.get(voice.id),sequence=/^structure-sequence-(\d+)/.exec(voice.id),level=Math.sqrt(clamp((voice.level||0)*4));if(anchor)target[anchor.index]=Math.max(target[anchor.index],level);else if(sequence){const i=Number(sequence[1])%16;target[i]=Math.max(target[i],level);}else for(let i=0;i<16;i++)if(Math.abs(voice.midi-api.quantize(pattern[i]))<.6)target[i]=Math.max(target[i],level);}
      if(latest)lastMidi=latest.midi;if(anchors.size>256)for(const id of anchors.keys()){if(!sounding.has(id)&&![...contacts.values()].some(contact=>contact.id===id))anchors.delete(id);if(anchors.size<=192)break;}
      for(let i=0;i<16;i++)levels[i]=lerp(levels[i],target[i],1-Math.exp(-dt*12));
      if(api.state.playing&&contacts.size===0)selected=(snap.step??0)%16;
      if(++frameCount%5===0){const data=snap.frequency||[];history.push(Array.from({length:64},(_,i)=>data[Math.floor(Math.pow(i/63,1.7)*Math.max(0,data.length-1))]||0));if(history.length>22)history.shift();}
      if(!reduced.matches&&!nav.size)rotationPhase+=dt*v.rotation;
      const panes=layout();c.clearRect(0,0,w,h);drawScore(panes.left,v,snap);drawAnalysis(panes.right,v,snap);
      if(webgl){fit(v);updateGeometry(t,v);webgl.el.style.background=`radial-gradient(ellipse at 50% 50%, ${rgba('#4653bb',v.fieldGlow*(.08+clamp(snap.rms*2,0,.3)))}, transparent 67%)`;}
      else drawFallback(panes.loop,v,t);
      drawConnection(v,snap);if(webgl)webgl.renderer.render(webgl.scene,webgl.camera);
    },
    onStep(step,when){const midi=api.quantize(pattern[step%16]);api.audio.pulse('structure-sequence-'+step,midi,{...api.state.sound,gain:.15,pan:(step%8-3.5)*.055},when,60/api.state.bpm*.26);},
    cancel,
    getData(){return {pattern:pattern.slice(),camera:{...cameraView}};},
    setData(data){if(Array.isArray(data?.pattern)&&data.pattern.length===16)pattern=data.pattern.map((v,i)=>Number.isFinite(v)?Math.round(clamp(v,0,7)):original[i]);if(data?.camera)for(const key of ['yaw','pitch','zoom'])if(Number.isFinite(data.camera[key]))cameraView[key]=key==='zoom'?clamp(data.camera[key],.55,1.5):data.camera[key];},
    destroy(){cancel();off();canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('keydown',keyDown);canvas.removeEventListener('keyup',keyUp);if(webgl){webgl.scene.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(m=>m.dispose());else object.material?.dispose();});webgl.renderer.dispose();webgl.renderer.forceContextLoss();webgl.el.remove();}surface.destroy();}
  };
}
