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
const nodeCount=16,U=128,V=24;
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
    return {left,right,loop:{x:right.x+right.w*.015,y:right.y+right.h*.205,w:right.w*.97,h:right.h*.62}};
  }
  function makeWebGL(){
    try{
      const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:true,powerPreference:'high-performance'});
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
      const material=new THREE.MeshPhysicalMaterial({color:'#ffffff',vertexColors:true,roughness:.24,metalness:.13,clearcoat:1,clearcoatRoughness:.18,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,material);group.add(mesh);
      const fieldPositions=[],fieldSamples=[];
      for(let plane=0;plane<2;plane++){
        for(let row=0;row<17;row++)for(let col=0;col<32;col++)for(let end=0;end<2;end++)fieldSamples.push({plane,u:-1+(col+end)/32*2,v:-1+row/16*2});
        for(let col=0;col<23;col++)for(let row=0;row<24;row++)for(let end=0;end<2;end++)fieldSamples.push({plane,u:-1+col/22*2,v:-1+(row+end)/24*2});
      }
      for(const p of fieldSamples)fieldPositions.push(p.u*3.1,p.v*2.5,-1);
      const fieldGeometry=new THREE.BufferGeometry();fieldGeometry.setAttribute('position',new THREE.Float32BufferAttribute(fieldPositions,3));const fieldColors=[];for(const p of fieldSamples){const edge=clamp((1-Math.abs(p.u))*8)*clamp((1-Math.abs(p.v))*8),hole=clamp((Math.hypot(p.u*3.1,p.v*2.15)-.85)/.6),patch=.12+.88*Math.sqrt(clamp((Math.abs(p.u*p.v)-.02)/.2)),strength=edge*hole*patch;fieldColors.push(.08*strength,.2*strength,strength);}fieldGeometry.setAttribute('color',new THREE.Float32BufferAttribute(fieldColors,3));
      const field=new THREE.LineSegments(fieldGeometry,new THREE.LineBasicMaterial({color:'#ffffff',vertexColors:true,transparent:true,opacity:.48,blending:THREE.AdditiveBlending,depthWrite:false}));scene.add(field);field.rotation.z=.16;
      const guide=new THREE.Group();group.add(guide);
      for(let i=0;i<3;i++){
        const ring=new THREE.Mesh(new THREE.TorusGeometry(1.82+i*.047,.007+(i===1?.006:0),5,144),new THREE.MeshBasicMaterial({color:i===1?'#7299ff':'#416aff',transparent:true,opacity:i===1?.95:.74,depthWrite:false}));ring.position.z=-.08-i*.025;guide.add(ring);const halo=new THREE.Mesh(new THREE.TorusGeometry(1.82+i*.047,.029,5,144),new THREE.MeshBasicMaterial({color:'#2d55ff',transparent:true,opacity:.17,blending:THREE.AdditiveBlending,depthWrite:false}));halo.position.copy(ring.position);guide.add(halo);
      }
      const inner=new THREE.Mesh(new THREE.TorusGeometry(.86,.008,5,144),new THREE.MeshBasicMaterial({color:'#6c9cff',transparent:true,opacity:.9,depthWrite:false}));inner.position.z=.04;guide.add(inner);const innerHalo=new THREE.Mesh(new THREE.TorusGeometry(.86,.025,5,144),new THREE.MeshBasicMaterial({color:'#2b58ff',transparent:true,opacity:.2,blending:THREE.AdditiveBlending,depthWrite:false}));innerHalo.position.z=.04;guide.add(innerHalo);
      const orbit=new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:145},(_,i)=>new THREE.Vector3(Math.cos(i/144*TAU)*1.9,Math.sin(i/144*TAU)*1.9,0))),new THREE.LineBasicMaterial({color:'#618eff',transparent:true,opacity:.6,depthWrite:false}));orbit.rotation.set(.28,-.35,.15);guide.add(orbit);
      // A cached projected grid adds bounded cobalt radiance without scene-wide bloom.
      const sheetCanvas=document.createElement('canvas');sheetCanvas.width=512;sheetCanvas.height=512;const sc=sheetCanvas.getContext('2d');
      sc.strokeStyle='#476fff';sc.lineWidth=1.4;sc.shadowColor='#315bff';sc.shadowBlur=9;sc.beginPath();for(let j=0;j<=24;j++){const p=j/24*512;sc.moveTo(p,0);sc.lineTo(p,512);sc.moveTo(0,p);sc.lineTo(512,p);}sc.stroke();sc.shadowBlur=0;
      const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=512;const mc=maskCanvas.getContext('2d');for(const xx of [104,408])for(const yy of [104,408]){const gradient=mc.createRadialGradient(xx,yy,10,xx,yy,158);gradient.addColorStop(0,'rgba(255,255,255,.9)');gradient.addColorStop(1,'rgba(255,255,255,0)');mc.fillStyle=gradient;mc.fillRect(0,0,512,512);}sc.globalCompositeOperation='destination-in';sc.drawImage(maskCanvas,0,0);
      const sheetTexture=new THREE.CanvasTexture(sheetCanvas);sheetTexture.colorSpace=THREE.SRGBColorSpace;
      const sheets=[];for(let i=0;i<2;i++){const sheet=new THREE.Mesh(new THREE.PlaneGeometry(6.2,4.5),new THREE.MeshBasicMaterial({map:sheetTexture,transparent:true,opacity:.6,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));sheet.position.z=-1.3-i*.4;sheet.rotation.set(i?.2:-.26,i?-.35:.2,i?-.2:.18);scene.add(sheet);sheets.push(sheet);}
      const contactGeometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:65},()=>new THREE.Vector3()));
      const connection=new THREE.Line(contactGeometry,new THREE.LineBasicMaterial({color:'#b3f09e',transparent:true,opacity:.8,depthWrite:false}));scene.add(connection);connection.visible=false;
      const dot=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color:'#b3f09e'}));scene.add(dot);dot.visible=false;
      return {renderer,scene,camera,group,mesh,geometry,material,positions,colors,guide,field,fieldSamples,sheets,sheetTexture,connection,dot,el};
    }catch{return null;}
  }
  webgl=makeWebGL();
  function pointAt(u,v,t,appearance=api.state.appearance,out=new THREE.Vector3()){
    const a=u*TAU,b=v*TAU,lobes=Math.round(appearance.lobes??7),fold=appearance.lobeDepth??.22,width=appearance.tubeWidth??.15;
    const idx=Math.floor(((u%1)+1)%1*16),level=levels[idx]||0;
    const radial=1.28+fold*.3*Math.cos(a*lobes)+level*.07;
    const tube=width*1.65*(1+fold*1.5*(.5+.5*Math.cos(a*lobes)))*(1+level*.12),z=.06*Math.sin(a*3+t*.16)*(reduced.matches?0:1)+tube*Math.sin(b)*1.16;
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
    group.rotation.set(.52+cameraView.pitch,cameraView.yaw,rotationPhase);group.updateMatrixWorld(true);
  }
  function fit(v){
    if(!webgl)return;const r=layout().loop,key=[Math.round(r.w),Math.round(r.h),Math.min(devicePixelRatio||1,1.5)].join('|');
    if(key!==sizeKey){sizeKey=key;webgl.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));webgl.renderer.setSize(Math.max(1,r.w),Math.max(1,r.h),false);webgl.el.style.left=r.x+'px';webgl.el.style.top=r.y+'px';webgl.el.style.width=r.w+'px';webgl.el.style.height=r.h+'px';webgl.camera.aspect=r.w/r.h;webgl.camera.updateProjectionMatrix();}
    const halfVertical=THREE.MathUtils.degToRad(20),halfHorizontal=Math.atan(Math.tan(halfVertical)*webgl.camera.aspect),bound=1.28+v.lobeDepth*.3+v.tubeWidth*1.65*(1+v.lobeDepth*1.5)*1.16+.11;
    const distance=bound/Math.sin(Math.min(halfVertical,halfHorizontal))*(1.06+(1.5-cameraView.zoom)*.65);webgl.camera.position.set(0,0,distance);webgl.camera.lookAt(0,0,0);webgl.camera.updateMatrixWorld();
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
    if(y>.57&&y<.955&&x>.36&&x<.955)return {index:Math.min(15,Math.floor((x-.36)/.595*16)),degree:Math.round(clamp(1-(y-.59)/.345,0,1)*7),mode:'matrix'};
    if(y>.56&&x<.32){const cx=r.x+r.w*.055,cy=r.y+r.h*.77,rad=Math.min(r.w*.265,r.h*.2),dx=p.x-cx,dy=p.y-cy,radius=Math.hypot(dx,dy);if(radius<rad*1.06)return {index:Math.floor(((Math.atan2(dy,dx)/TAU+1)%1)*16),degree:Math.round(clamp((radius/rad-.3)/.7,0,1)*7),mode:'distribution'};}
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
      const score=scoreHit(p);if(score){const contact={id:'structure-'+p.id+'-'+(++gestureSerial),role:'score',index:score.index,mode:score.mode,startY:p.y,startDegree:pattern[score.index]};contacts.set(p.id,contact);if(score.mode!=='truss')pattern[score.index]=score.degree;play(contact,true);return;}
      const hit=pick(p.x,p.y);if(hit){const contact={id:'structure-'+p.id+'-'+(++gestureSerial),role:'loop',...hit};contacts.set(p.id,contact);play(contact,true);return;}
      const r=layout().right;if(p.x<r.x||p.y<r.y)return false;
      nav.set(p.id,{x:p.x,y:p.y});if(nav.size>=2){const [a,b]=navPair();pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:cameraView.zoom};}return;
    },
    move(p){
      const contact=contacts.get(p.id);if(contact){
        if(contact.role==='loop'){const hit=pick(p.x,p.y);if(hit){contact.u=hit.u;contact.v=hit.v;play(contact);}}
        else{const r=layout().left;if(contact.mode!=='truss'){const hit=scoreHit(p);if(hit?.mode===contact.mode){contact.index=hit.index;pattern[contact.index]=hit.degree;}}else pattern[contact.index]=Math.round(clamp(contact.startDegree+(contact.startY-p.y)/(r.h*.03),0,7));play(contact);api.save();}return;
      }
      const previous=nav.get(p.id);if(!previous)return;const dx=p.x-previous.x,dy=p.y-previous.y;nav.set(p.id,{x:p.x,y:p.y});
      if(nav.size>=2&&pinch){const [a,b]=navPair();cameraView.zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,.55,1.5);}else{cameraView.yaw+=dx*.008;cameraView.pitch+=dy*.008;}
    },
    up(p){end(p);},cancel(p){end(p);}
  });
  function end(p){const contact=contacts.get(p.id);if(contact){api.noteOff(contact.id);contacts.delete(p.id);}nav.delete(p.id);if(nav.size<2)pinch=null;api.save();}
  const wheel=e=>{const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,r=layout().right;if(x<r.x||y<r.y||pick(x,y))return;e.preventDefault();cameraView.zoom=clamp(cameraView.zoom*Math.exp(-e.deltaY*.001),.55,1.5);api.save();};canvas.addEventListener('wheel',wheel,{passive:false});
  const keyIds=new Set();
  const keyDown=e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;if(e.key==='Home'){e.preventDefault();cameraView={yaw:.08,pitch:.24,zoom:1.15};}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();cameraView.yaw+=(e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0);cameraView.pitch+=(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0);}};canvas.addEventListener('keydown',keyDown);
  function drawScore(r,v,snap){
    const ink=v.ink,pad=r.w*.05;c.fillStyle=v.paper;c.fillRect(r.x,r.y,r.w,r.h);c.fillStyle=rgba(ink,.04);for(let i=0;i<520;i++)c.fillRect(r.x+random(i)*r.w,r.y+random(i+1000)*r.h,.8,.8);
    label(c,'SCORE  /  16 NODES',r.x+pad,r.y+20,rgba(ink,.75),9);label(c,api.noteName(lastMidi),r.x+r.w-pad,r.y+20,ink,12,'right');
    const nodes=trussNodes(r),depth=r.w*.022*v.structureDepth,cube=Math.min(r.w*.055,r.h*.06);
    for(let row=0;row<2;row++)for(let j=0;j<7;j++){
      const a=nodes[row*8+j],b=nodes[row*8+j+1];line(c,[[a.x-cube/2,a.y-cube/2],[b.x-cube/2,b.y-cube/2]],rgba(ink,.6),v.lineWeight);line(c,[[a.x+cube/2,a.y+cube/2],[b.x+cube/2,b.y+cube/2]],rgba(ink,.6),v.lineWeight);line(c,[[a.x-cube/2,a.y-cube/2],[b.x+cube/2,b.y+cube/2]],rgba(ink,.32),v.lineWeight*.7);
      line(c,[[a.x-cube/2+depth,a.y-cube/2-depth],[b.x-cube/2+depth,b.y-cube/2-depth]],rgba(ink,.47),v.lineWeight*.75);line(c,[[a.x+cube/2+depth,a.y+cube/2-depth],[b.x+cube/2+depth,b.y+cube/2-depth]],rgba(ink,.47),v.lineWeight*.75);line(c,[[a.x+cube/2,a.y+cube/2],[b.x-cube/2+depth,b.y-cube/2-depth]],rgba(ink,.28),v.lineWeight*.65);
    }
    nodes.forEach((p,i)=>{
      const x=p.x-cube/2,y=p.y-cube/2,active=levels[i];c.strokeStyle=rgba(ink,.45+active*.5);c.lineWidth=v.lineWeight;c.strokeRect(x,y,cube,cube);
      line(c,[[x,y],[x+depth,y-depth],[x+cube+depth,y-depth],[x+cube,y]],rgba(ink,.65),v.lineWeight);line(c,[[x+cube,y+cube],[x+cube+depth,y+cube-depth],[x+cube+depth,y-depth]],rgba(ink,.65),v.lineWeight);line(c,[[x,y+cube],[x+depth,y+cube-depth],[x+cube+depth,y+cube-depth]],rgba(ink,.24),v.lineWeight*.7);
      if(i===selected||active>.05){c.fillStyle=rgba(ink,.2+active*.6);c.beginPath();c.arc(p.x,p.y,2.2+active*2.5,0,TAU);c.fill();}
      line(c,[[p.x,p.y],[p.x,p.y-cube*(.4+pattern[i]/7)]],rgba(ink,.6),v.lineWeight);c.fillStyle=rgba(ink,.64);c.beginPath();c.ellipse(p.x-1,p.y,2.1,1.5,-.4,0,TAU);c.fill();
      if(r.h>440||i===selected)label(c,String(i+1).padStart(2,'0'),p.x,i<8?p.y+cube*1.05:p.y-cube*.85-depth,rgba(ink,.53),7,'center');
    });
    // Polar and Cartesian views edit the same sixteen pitch values.
    const dcx=r.x+r.w*.055,dcy=r.y+r.h*.77,dr=Math.min(r.w*.265,r.h*.2);
    c.save();c.beginPath();c.rect(r.x,r.y+r.h*.555,r.w*.325,r.h*.43);c.clip();
    c.fillStyle=rgba(ink,.19);c.beginPath();
    for(let i=0;i<1200;i++){const a=i*2.3999632297,rr=dr*Math.sqrt((i+.5)/1200);c.rect(dcx+Math.cos(a)*rr,dcy+Math.sin(a)*rr,.65,.65);}c.fill();
    c.fillStyle=rgba(ink,.55);c.beginPath();
    for(let i=0;i<16;i++){
      const a=(i+.5)/16*TAU,reach=.3+pattern[i]/7*.7;
      for(let j=0;j<150;j++){const rr=dr*(reach*.62+Math.sqrt((j+.5)/150)*reach*.38),angle=a+(random(i*151+j)-.5)*TAU/16;c.rect(dcx+Math.cos(angle)*rr,dcy+Math.sin(angle)*rr,.7,.7);}
    }c.fill();
    c.strokeStyle=rgba(ink,.45);c.lineWidth=v.lineWeight;c.beginPath();c.arc(dcx,dcy,dr,0,TAU);c.stroke();
    const sa=(selected+.5)/16*TAU,sr=dr*(.3+pattern[selected]/7*.7),sx=dcx+Math.cos(sa)*sr,sy=dcy+Math.sin(sa)*sr;
    c.strokeStyle=rgba(ink,.75);c.beginPath();c.arc(sx,sy,4+levels[selected]*2,0,TAU);c.stroke();c.restore();
    label(c,'NODE  /  PITCH',r.x+pad,r.y+r.h*.515,rgba(ink,.55),8);
    label(c,`STEP ${String((snap.step??0)%16+1).padStart(2,'0')}`,r.x+r.w-pad,r.y+r.h*.515,rgba(ink,.7),8,'right');
    const x=r.x+r.w*.36,y=r.y+r.h*.59,w=r.w*.595,h=r.h*.345,cw=w/16,rh=h/7;
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
    const x=r.x+r.w*.045,y=r.y+16,w=r.w*.91,h=r.h*.175,ink='#b2e0c3';
    c.strokeStyle=rgba(ink,.68);c.lineWidth=v.lineWeight;c.strokeRect(x,y,w,h);
    label(c,'SPECTRUM HISTORY',x+8,y+13,rgba(ink,.9),8);label(c,`${hz(lastMidi).toFixed(2)} Hz`,x+w-9,y+13,'#d6e5e4',11,'right');
    const slices=history.slice(-Math.max(4,Math.floor(v.historyDepth*22)));
    for(let j=0;j<slices.length;j++){
      const age=j/Math.max(1,slices.length-1),bins=slices[j],pts=[];let last=16;for(let k=0;k<bins.length;k++)if(bins[k]>.045)last=Math.max(last,k);last=Math.min(63,last+3);
      for(let i=0;i<64;i++){const val=bins[Math.floor(i/63*last)]||0;pts.push([x+w*.20+i/63*w*.58+(1-age)*w*.055,y+h*.89-(1-age)*h*.26-val*h*.46*v.historyGain]);}
      c.beginPath();c.moveTo(pts[0][0],y+h*.89-(1-age)*h*.26);for(const p of pts)c.lineTo(...p);c.lineTo(pts.at(-1)[0],y+h*.89-(1-age)*h*.26);c.closePath();c.fillStyle=rgba(v.loopColour,.18+age*.28);c.fill();line(c,pts,rgba(v.loopColour,.2+age*.75),.8);
    }
    if(!slices.length)line(c,[[x+w*.15,y+h*.88],[x+w*.84,y+h*.88]],rgba(v.loopColour,.35),.8);
    const wave=snap.waveform||[],chars='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#',font=Math.max(7,Math.min(10,r.w*.015)),rows=Math.max(3,Math.floor(r.h*.145/(font+1.4+(1-v.asciiDensity)*3))),cols=Math.max(16,Math.floor(r.w*.86/(font*.62)));
    let peak=.008;for(let i=0;i<wave.length;i++)peak=Math.max(peak,Math.abs(wave[i]));const hasSignal=peak>.009;
    c.save();c.beginPath();c.rect(x,r.y+r.h*.81835,w,r.h*.145);c.clip();c.font=`600 ${font}px ui-monospace, monospace`;
    for(let row=0;row<rows;row++){
      let text='',strength=0;
      for(let i=0;i<cols;i++){const pos=wave.length?(row*37+i*67)%wave.length:0,n=hasSignal?clamp((wave[pos]||0)/peak,-1,1):0,d=hasSignal?clamp(((wave[(pos+13)%wave.length]||0)-(wave[pos]||0))/peak,-1,1):0;strength+=Math.abs(n);text+=hasSignal?chars[Math.floor(clamp((n+1)*.42+(d+1)*.08,0,.999)*chars.length)]:' ';}
      if(!hasSignal)text=Array.from({length:7},(_,i)=>{const n=api.quantize(pattern[(row*7+i)%16]);return api.noteName(n)+' '+hz(n).toFixed(1);}).join('  ').slice(0,cols);
      c.fillStyle=rgba(strength/cols>.62?'#b9dbc6':'#ddd9f1',hasSignal?.45+strength/cols*.48:.24);c.fillText(text,x+5,r.y+r.h*.8185+row*(font+1.4));
    }c.restore();
    label(c,`N ${String((snap.voices||[]).length).padStart(2,'0')}  /  RMS ${(snap.rms||0).toFixed(3)}`,x,r.y+r.h*.818,rgba('#bdd2d2',.8),8);
    label(c,'ORBIT  ·  PINCH',x+w,r.y+r.h*.818,rgba('#9ca6c5',.6),8,'right');
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
      if(webgl){
        fit(v);updateGeometry(t,v);webgl.el.style.background=`radial-gradient(ellipse at 50% 50%, ${rgba('#4653bb',v.fieldGlow*(.12+clamp(snap.rms*2,0,.3)))}, transparent 67%)`;
        const pos=webgl.field.geometry.attributes.position.array,freq=snap.frequency||[];let k=0;
        for(const p of webgl.fieldSamples){
          const a=(p.u+1)/2,bin=freq.length?(freq[Math.floor(a*freq.length*.6)]||0):0,wave=Math.sin(p.u*3+p.v*2)*.09+bin*.24;
          pos[k++]=p.u*3.1+(p.plane? p.v*.35:0);pos[k++]=p.v*2.15+(p.plane? p.u*.45:0)+wave;pos[k++]=-1.1+(p.plane?p.u*.65:p.v*.7)+wave*.4;
        }
        webgl.field.geometry.attributes.position.needsUpdate=true;webgl.field.material.opacity=.18+v.fieldGlow*.35;for(const sheet of webgl.sheets)sheet.material.opacity=.3+v.fieldGlow*.55;
      }
      else drawFallback(panes.loop,v,t);
      drawConnection(v,snap);if(webgl)webgl.renderer.render(webgl.scene,webgl.camera);
    },
    onStep(step,when){const midi=api.quantize(pattern[step%16]);api.audio.pulse('structure-sequence-'+step,midi,{...api.state.sound,gain:.15,pan:(step%8-3.5)*.055},when,60/api.state.bpm*.26);},
    cancel,
    getData(){return {pattern:pattern.slice(),camera:{...cameraView}};},
    setData(data){if(Array.isArray(data?.pattern)&&data.pattern.length===16)pattern=data.pattern.map((v,i)=>Number.isFinite(v)?Math.round(clamp(v,0,7)):original[i]);if(data?.camera)for(const key of ['yaw','pitch','zoom'])if(Number.isFinite(data.camera[key]))cameraView[key]=key==='zoom'?clamp(data.camera[key],.55,1.5):data.camera[key];},
    destroy(){cancel();off();canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('keydown',keyDown);if(webgl){webgl.scene.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(m=>m.dispose());else object.material?.dispose();});webgl.sheetTexture.dispose();webgl.renderer.dispose();webgl.renderer.forceContextLoss();webgl.el.remove();}surface.destroy();}
  };
}
