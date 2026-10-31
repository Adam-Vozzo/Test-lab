import * as THREE from './vendor/three.module.min.js';
const UI_FONT = getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim() || 'monospace';

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const val=(o,k,d,a=-Infinity,b=Infinity)=>clamp(Number.isFinite(+o[k])?+o[k]:d,a,b);
const V=()=>new THREE.Vector3();
const CAMERA_KEY='duo.galaxy.camera.v1';
const makeRandom=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const GUIDE_REFERENCE_DISTANCE=5.6,GUIDE_Z=-1.55;
// A separate seed keeps the existing star positions unchanged. Each star has
// its own phase and a 5–11 second cycle, with a slower secondary oscillation.
export function createTwinkleProfiles(count){const random=makeRandom(73129),profiles=new Float32Array(count*2);for(let i=0;i<count;i++)profiles.set([random()*TAU,.58+random()*.62],i*2);return profiles;}
export function twinkleFlux(phase,rate,time,amount){return 1+clamp(amount,0,1)*.55*(.72*Math.sin(phase+time*rate)+.28*Math.sin(phase*1.73+time*rate*.57));}
/** Nested world grids preserve screen density without sliding their origin.
 * Manual spacing changes density; only camera distance chooses a zoom level. */
export function guideZoomLevels(distance,manualSpacing=1){
 const zoom=clamp(Number.isFinite(+distance)?+distance:GUIDE_REFERENCE_DISTANCE,3,14),spacing=clamp(Number.isFinite(+manualSpacing)?+manualSpacing:1,.4,2.5);
 const continuous=Math.log2(zoom/GUIDE_REFERENCE_DISTANCE),lower=Math.floor(continuous),t=continuous-lower,mix=t*t*(3-2*t);
 return [{level:lower,weight:1-mix},{level:lower+1,weight:mix}].map(item=>({...item,step:.5*spacing*2**item.level,extent:[2.5*2**item.level,1.6*2**item.level],radius:3*2**item.level}));
}

const landmarks=[
 ['Sub',-1.8,-1.1,-.8],['Fundamental',-1.55,.25,-1.1],['Warm',-.95,-.55,-.4],['Round',-1.2,.9,.3],
 ['Sine',-.5,-.3,-1.25],['Mellow',-.85,.45,.8],['Hollow',-.2,-.8,.85],['Wood',.05,.25,-.7],
 ['Triangle',.25,1.08,.55],['Body',.4,.15,.25],['Pulse',.75,.75,-.5],['Reed',.6,-.55,1.1],
 ['Pluck',.9,-.9,-.4],['Glass',1.4,.45,-.75],['Brass',1.2,.95,.75],['Overtones',1.6,1.15,-.1],
 ['Resonant',.65,1.3,-1.1],['Sawtooth',1.7,-.15,.35],['Air',1.85,.5,1.15],['Edge',1.8,-1.1,1.3]
].map(([name,x,y,z],index)=>({name,position:new THREE.Vector3(x,y,z),index}));
const icon={orbit:'<circle cx="10" cy="10" r="3"/><ellipse cx="10" cy="10" rx="8" ry="5" transform="rotate(-30 10 10)"/>',pan:'<path d="M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3"/>',tune:'<circle cx="10" cy="10" r="5"/><path d="M10 1v5m0 8v5M1 10h5m8 0h5"/>',reset:'<path d="M4 6a7 7 0 1 1-1 8M4 2v5h5"/>',minus:'<path d="M4 10h12"/>',plus:'<path d="M4 10h12M10 4v12"/>'};
const svg=name=>`<svg viewBox="0 0 20 20" aria-hidden="true">${icon[name]}</svg>`;

/** A navigable timbre galaxy. Camera motion changes the view; the crosshair's
 * actual XYZ position maps to cutoff, resonance and oscillator detune. */
export class GalaxyScene {
 constructor(host,{getVisual=()=>({}),getPalette=()=>({}),getSound=()=>({}),getActivity=()=>({}),onChange=()=>{},onViewChange=()=>{}}={}){
  this.host=host;host.classList.add('galaxy-stage');host.dataset.galaxyMode='orbit';this.getVisual=getVisual;this.getPalette=getPalette;this.getSound=getSound;this.getActivity=getActivity;this.onChange=onChange;this.onViewChange=onViewChange;
  this.mode='orbit';this.pointers=new Map();this.target=new THREE.Vector3();this.azimuth=.25;this.elevation=.34;this.distance=5.6;this.dragging=false;this.dead=false;this.clock=0;this.lastFrame=0;this.viewVersion=0;
  this.cursor=V();this.raycaster=new THREE.Raycaster();this.dragPlane=new THREE.Plane();this.dragOffset=V();this.rayPoint=V();this.camera=new THREE.PerspectiveCamera(43,1,.05,60);
  this.scene=new THREE.Scene();this.cloud=new THREE.Group();this.scene.add(this.cloud);this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.twinkleProfiles=createTwinkleProfiles(4200);
  try{const saved=JSON.parse(localStorage.getItem(CAMERA_KEY)||'null');if(saved){this.azimuth=val(saved,'azimuth',.25);this.elevation=val(saved,'elevation',.34);this.distance=val(saved,'distance',5.6,3,14);if(Array.isArray(saved.target)&&saved.target.length===3&&saved.target.every(Number.isFinite))this.target.set(...saved.target.map(n=>clamp(n,-2.5,2.5)));}}catch{}
  this.canvas=document.createElement('canvas');this.canvas.className='galaxy-canvas';this.canvas.setAttribute('aria-hidden','true');host.append(this.canvas);
  this.overlay=document.createElement('canvas');this.overlay.className='galaxy-overlay';this.overlay.setAttribute('aria-hidden','true');host.append(this.overlay);this.ctx=this.overlay.getContext('2d');
  try{this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true,powerPreference:'low-power'});this.renderer.setClearColor(0x000000,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.buildScene();}catch{this.renderer=null;this.canvas.remove();}
  this.buildControls();this.controller=new AbortController();this.events={signal:this.controller.signal};this.bind();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();this.updateCamera();this.render(0);this.tick=this.tick.bind(this);this.raf=requestAnimationFrame(this.tick);
 }
 buildScene(){
  // Interleaved populations keep the same spatial depth at every density setting.
  // Only this visual volume is stretched: timbre landmarks and the cursor retain
  // their exact world coordinates and audio mappings.
  const random=makeRandom(3917),count=4200,positions=new Float32Array(count*3),colors=new Float32Array(count*3),sizes=new Float32Array(count),phases=new Float32Array(count),populations=new Uint8Array(count);
  const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(.00001,random())))*Math.cos(TAU*random());
  const palette=[new THREE.Color('#a6dbff'),new THREE.Color('#7484df'),new THREE.Color('#b2c9ef'),new THREE.Color('#bce4de'),new THREE.Color('#e6ca84')];
  this.depthExamples={};this.populationCounts={arms:0,core:0,near:0,far:0};
  for(let i=0;i<count;i++){
   const slot=i%100;let x,y,z,size,population,name;
   if(slot<2){
    population=2;name='near';x=(random()-.5)*5.5;y=(random()-.5)*3.1;z=1.25+random()*.85;size=3.1+random()*2.4;
   }else if(slot<20){
    population=3;name='far';x=(random()-.5)*8.5;y=(random()-.5)*4.8;z=-1.25-random()*2;size=.75+random()*1.15;
   }else if(slot<34){
    population=1;name='core';x=clamp(gaussian(),-2.8,2.8)*.40;y=clamp(gaussian(),-2.8,2.8)*.28;z=clamp(gaussian(),-2.5,2.5)*.66;size=.95+random()*1.65;
   }else{
    population=0;name='arms';const r=Math.pow(random(),.6)*2.8,arm=i%4,angle=arm*TAU/4+r*1.45+(random()-.5)*(.25+r*.20),scatter=gaussian()*(.035+r*.045);
    x=Math.cos(angle)*r*1.07+scatter;y=Math.sin(angle)*r*.57+scatter*.5;
    z=Math.sin(angle*1.7+r*.3)*(.12+r*.13)+clamp(gaussian(),-2.2,2.2)*(.10+r*.10);size=i%43===0?3.6:1+random()*1.85;
   }
   positions.set([x,y,z],i*3);populations[i]=population;this.populationCounts[name]++;if(this.depthExamples[name]===undefined)this.depthExamples[name]=i;
   const col=palette[i%palette.length].clone();if(population===2)col.lerp(new THREE.Color('#eff7ff'),.7);if(population===1)col.lerp(new THREE.Color('#dceef3'),.45);if(population===3)col.multiplyScalar(.65);
   colors.set([col.r,col.g,col.b],i*3);sizes[i]=size;phases[i]=random()*TAU;
  }
  this.starPopulations=populations;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setAttribute('size',new THREE.BufferAttribute(sizes,1));geometry.setAttribute('phase',new THREE.BufferAttribute(phases,1));geometry.setAttribute('twinkleProfile',new THREE.BufferAttribute(this.twinkleProfiles,2));
  // Shader depth changes must remain inside Three's CPU-side culling bounds.
  let bound=0;for(let i=0;i<count;i++)bound=Math.max(bound,Math.hypot(positions[i*3],positions[i*3+1],Math.abs(positions[i*3+2])*2.5+.05));geometry.boundingSphere=new THREE.Sphere(V(),bound);
  this.starMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexColors:true,uniforms:{clock:{value:0},pixelRatio:{value:1},energy:{value:0},drift:{value:.12},twinkleAmount:{value:.4},tint:{value:new THREE.Color('#b8ddff')},pointScale:{value:8},opacity:{value:1},depthScale:{value:1.3},focusDistance:{value:5.6},softLayer:{value:0}},vertexShader:`
   attribute float size;attribute float phase;attribute vec2 twinkleProfile;
   varying vec3 vColor;varying float vAlpha;varying float vSoftness;
   uniform float clock,pixelRatio,energy,drift,twinkleAmount,pointScale,depthScale,focusDistance,softLayer;
   void main(){
    vec3 p=position;p.z=p.z*depthScale+sin(clock*.16+phase)*.05*drift;
    vec4 mv=modelViewMatrix*vec4(p,1.);float distanceToEye=max(.05,-mv.z);
    gl_Position=projectionMatrix*mv;
    float nearWeight=1.-smoothstep(focusDistance*.42,focusDistance*.88,distanceToEye);
    float farFade=exp(-max(0.,distanceToEye-focusDistance)*.22);
    float nearClip=smoothstep(.28,1.2,distanceToEye);
    gl_PointSize=clamp(size*pixelRatio*pointScale/distanceToEye*(1.+nearWeight*.35),1.,softLayer>.5?68.:30.);
    vSoftness=clamp(nearWeight*.82+softLayer,0.,1.);
    vColor=color;
    float wave=.72*sin(twinkleProfile.x+clock*twinkleProfile.y)+.28*sin(twinkleProfile.x*1.73+clock*twinkleProfile.y*.57);
    float flux=1.+twinkleAmount*.55*wave;
    vAlpha=(.55+.45*(.5+.5*sin(phase)))*flux*(.9+energy*.35)*farFade*nearClip;
   }`,fragmentShader:`
   varying vec3 vColor;varying float vAlpha;varying float vSoftness;
   uniform vec3 tint;uniform float opacity;
   void main(){
    float r=length(gl_PointCoord-.5)*2.;
    float halo=exp(-r*r*mix(5.,2.8,vSoftness));
    float core=exp(-r*r*mix(48.,13.,vSoftness))*mix(.65,.16,vSoftness);
    float a=(halo*.66+core)*(1.-smoothstep(.70,1.,r));
    gl_FragColor=vec4(vColor*tint,a*vAlpha*opacity);
   }`});
  this.stars=new THREE.Points(geometry,this.starMaterial);this.cloud.add(this.stars);
  this.nebulaMaterial=this.starMaterial.clone();this.nebulaMaterial.uniforms.pointScale.value=62;this.nebulaMaterial.uniforms.opacity.value=.052;this.nebulaMaterial.uniforms.softLayer.value=1;this.nebulaMaterial.uniforms.twinkleAmount.value=0;
  // The nebula uses the same genuine 3D arms and bulge, so its parallax agrees
  // with the crisp stars rather than acting as a flat background sprite.
  this.nebula=new THREE.Points(geometry,this.nebulaMaterial);this.cloud.add(this.nebula);
  this.anchorMaterial=this.starMaterial.clone();this.anchorMaterial.uniforms.depthScale.value=1;this.anchorMaterial.uniforms.twinkleAmount.value=0;
  const anchorPositions=new Float32Array(landmarks.length*3),anchorColors=new Float32Array(landmarks.length*3),anchorSizes=new Float32Array(landmarks.length).fill(5.7),anchorPhases=new Float32Array(landmarks.length);
  landmarks.forEach((l,i)=>{l.position.toArray(anchorPositions,i*3);const color=palette[i%palette.length];anchorColors.set([color.r,color.g,color.b],i*3);anchorPhases[i]=i;});
  const ag=new THREE.BufferGeometry();ag.setAttribute('position',new THREE.BufferAttribute(anchorPositions,3));ag.setAttribute('color',new THREE.BufferAttribute(anchorColors,3));ag.setAttribute('size',new THREE.BufferAttribute(anchorSizes,1));ag.setAttribute('phase',new THREE.BufferAttribute(anchorPhases,1));ag.setAttribute('twinkleProfile',new THREE.BufferAttribute(createTwinkleProfiles(landmarks.length),2));this.anchorStars=new THREE.Points(ag,this.anchorMaterial);this.scene.add(this.anchorStars);
  const connections=[];for(let i=0;i<landmarks.length;i++){const l=landmarks[i],nearest=landmarks.filter(n=>n!==l).sort((a,b)=>l.position.distanceTo(a.position)-l.position.distanceTo(b.position)).slice(0,2);for(const n of nearest){connections.push(...l.position.toArray(),...n.position.toArray());}}
  const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(connections,3));this.links=new THREE.LineSegments(cg,new THREE.LineBasicMaterial({color:'#82b8d4',transparent:true,opacity:.12,depthWrite:false}));this.scene.add(this.links);
  this.guideSignature='';
  this.crosshair=new THREE.Group();this.scene.add(this.crosshair);
  ['#ffe79e','#8ae3f0','#b3a9ff'].forEach((color,index)=>{const points=[];for(let i=0;i<=64;i++){const a=i/64*TAU;points.push(index===0?new THREE.Vector3(Math.cos(a)*.13,Math.sin(a)*.13,0):index===1?new THREE.Vector3(0,Math.cos(a)*.13,Math.sin(a)*.13):new THREE.Vector3(Math.cos(a)*.13,0,Math.sin(a)*.13));}this.crosshair.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity:.7,depthTest:false})));});
 }
 buildGrid(v){
  const spacing=val(v,'gridSpacing',1,.4,2.5),type=['cartesian','polar','dots'].includes(v.gridType)?v.gridType:'cartesian',fade=val(v,'gridFade',.5,0,1);
  const signature=type+'-'+spacing.toFixed(4)+'-'+fade.toFixed(4);
  if(signature!==this.guideSignature){
   this.guideSignature=signature;this.guideBuildCount=(this.guideBuildCount||0)+1;this.guideLayers=new Map();
   // Camera bounds3–14 require these four levels. They are built only when the
   // guide style/manual spacing/fade changes, never during camera movement.
   for(const level of [-1,0,1,2]){
    const scale=2**level,step=.5*spacing*scale,xExtent=2.5*scale,yExtent=1.6*scale,radius=3*scale,points=[];
    const nx=Math.floor(xExtent/step+1e-9),ny=Math.floor(yExtent/step+1e-9);
    if(type==='dots'){
     for(let ix=-nx;ix<=nx;ix++)for(let iy=-ny;iy<=ny;iy++)points.push(ix*step,iy*step,GUIDE_Z);
    }else if(type==='polar'){
     const rings=Math.floor(radius/step+1e-9);for(let ring=1;ring<=rings;ring++){const r=ring*step;for(let i=0;i<80;i++){const a=i/80*TAU,b=(i+1)/80*TAU;points.push(r*Math.cos(a),r*Math.sin(a)*.62,GUIDE_Z,r*Math.cos(b),r*Math.sin(b)*.62,GUIDE_Z);}}
    }else{
     const segment=.2*scale;
     for(let ix=-nx;ix<=nx;ix++)for(let y=-yExtent;y<yExtent-1e-9;y+=segment)points.push(ix*step,y,GUIDE_Z,ix*step,Math.min(yExtent,y+segment),GUIDE_Z);
     for(let iy=-ny;iy<=ny;iy++)for(let x=-xExtent;x<xExtent-1e-9;x+=segment)points.push(x,iy*step,GUIDE_Z,Math.min(xExtent,x+segment),iy*step,GUIDE_Z);
    }
    const positions=new Float32Array(points),bands=Array.from({length:8},()=>[]),stride=type==='dots'?3:6;
    for(let i=0;i<points.length;i+=stride){const x=type==='dots'?points[i]:(points[i]+points[i+3])*.5,y=type==='dots'?points[i+1]:(points[i+1]+points[i+4])*.5;
     const edge=type==='polar'?Math.min(1,Math.hypot(x,y/.62)/radius):Math.min(1,Math.max(Math.abs(x)/xExtent,Math.abs(y)/yExtent));
     const luminance=1-fade*Math.pow(edge,1.3)*.9;bands[Math.min(7,Math.floor(luminance*8))].push(i);
    }
    this.guideLayers.set(level,{level,type,step,extent:[xExtent,yExtent],radius,positions,bands,weight:0});
   }
  }
  this.guideActive=guideZoomLevels(this.distance,spacing).map(info=>({...this.guideLayers.get(info.level),weight:info.weight}));
 }
 getGuideState(){
  const v=this.getVisual();this.buildGrid(v);return{type:v.gridType||'cartesian',manualSpacing:val(v,'gridSpacing',1,.4,2.5),zoomDistance:this.distance,referenceDistance:GUIDE_REFERENCE_DISTANCE,worldOrigin:[0,0,GUIDE_Z],geometryBuilds:this.guideBuildCount,levels:this.guideActive.map(l=>({level:l.level,step:l.step,weight:l.weight,extent:[...l.extent],radius:l.radius,samples:l.positions.length/(l.type==='dots'?3:6)}))};
 }
 buildControls(){
  this.controls=document.createElement('div');this.controls.className='galaxy-controls';this.controls.innerHTML=`<div class="galaxy-modes" role="group" aria-label="Galaxy navigation"><button type="button" data-galaxy-mode="orbit" aria-label="Orbit galaxy" aria-pressed="true" title="Drag to orbit">${svg('orbit')}<span>Orbit</span></button><button type="button" data-galaxy-mode="pan" aria-label="Pan galaxy" aria-pressed="false" title="Drag to pan · Shift-drag">${svg('pan')}<span>Pan</span></button><button type="button" data-galaxy-mode="tune" aria-label="Move 3D crosshair" aria-pressed="false" title="Drag the crosshair through the galaxy">${svg('tune')}<span>Tune</span></button></div><div class="galaxy-view-tools"><button type="button" data-galaxy-action="out" aria-label="Zoom galaxy out" title="Zoom out">${svg('minus')}</button><button type="button" data-galaxy-action="in" aria-label="Zoom galaxy in" title="Zoom in">${svg('plus')}</button><button type="button" data-galaxy-action="reset" aria-label="Reset galaxy view" title="Reset view">${svg('reset')}</button></div><label class="galaxy-depth"><span>Z · Spread</span><input type="range" min="0" max="40" step=".1" aria-label="Crosshair depth, oscillator detune" value="8"><output>8 ct</output></label>`;this.host.append(this.controls);
  this.live=document.createElement('span');this.live.className='galaxy-announcement';this.live.setAttribute('aria-live','polite');this.host.append(this.live);
 }
 bind(){
  this.host.addEventListener('contextmenu',e=>{if(!e.target.closest('.galaxy-controls'))e.preventDefault();},this.events);
  this.controls.addEventListener('pointerdown',e=>e.stopPropagation(),this.events);
  this.controls.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.galaxyMode){this.mode=button.dataset.galaxyMode;this.controls.querySelectorAll('[data-galaxy-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.galaxyMode===this.mode));this.host.dataset.galaxyMode=this.mode;this.live.textContent=this.mode==='tune'?'Drag to position the crosshair. Depth changes detune.':this.mode==='pan'?'Drag to pan the galaxy.':'Drag to orbit. Pinch or scroll to zoom.';}
   else if(button.dataset.galaxyAction==='reset'){this.azimuth=.25;this.elevation=.34;this.distance=5.6;this.target.set(0,0,0);this.updateCamera();this.saveView();}
   else this.zoom(button.dataset.galaxyAction==='in'?.84:1.19);
  },this.events);
  this.controls.querySelector('input').addEventListener('input',e=>{const amount=Number(e.target.value);this.onChange({detune:amount});this.controls.querySelector('output').textContent=amount.toFixed(1).replace('.0','')+' ct';this.syncCursor();this.viewVersion++;},this.events);
  this.host.addEventListener('pointerdown',e=>this.pointerDown(e),this.events);
  this.host.addEventListener('pointermove',e=>this.pointerMove(e),this.events);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])this.host.addEventListener(event,e=>this.pointerUp(e),this.events);
  this.host.addEventListener('wheel',e=>{if(e.target.closest('.galaxy-controls'))return;e.preventDefault();this.zoom(Math.exp(clamp(e.deltaY,-180,180)*.002));},{...this.events,passive:false});
  this.host.addEventListener('keydown',e=>{if(e.target.closest('.galaxy-controls'))return;let used=true;this.syncCursor();const step=e.shiftKey?.18:.055;if(e.key==='ArrowLeft')this.cursor.x-=step;else if(e.key==='ArrowRight')this.cursor.x+=step;else if(e.key==='ArrowUp')this.cursor.y+=step;else if(e.key==='ArrowDown')this.cursor.y-=step;else if(e.key==='PageUp')this.cursor.z+=step;else if(e.key==='PageDown')this.cursor.z-=step;else if(e.key==='+'||e.key==='=')this.zoom(.88);else if(e.key==='-')this.zoom(1.14);else used=false;if(used){e.preventDefault();e.stopPropagation();if(!['+','=','-'].includes(e.key))this.changePoint(this.cursor);}},this.events);
 }
 syncCursor(){const s=this.getSound();this.cursor.set(clamp(Math.log(Math.max(20,s.cutoff||2400)/20)/Math.log(1000),0,1)*4-2,(clamp(s.resonance??4.5,.1,12)-.1)/11.9*3-1.5,clamp((s.detune??8)/40,0,1)*3-1.5);}
 changePoint(point){const x=clamp(point.x,-2,2),y=clamp(point.y,-1.5,1.5),z=clamp(point.z,-1.5,1.5);this.onChange({cutoff:20*1000**((x+2)/4),resonance:.1+(y+1.5)/3*11.9,detune:(z+1.5)/3*40});this.cursor.set(x,y,z);this.viewVersion++;}
 local(e){const r=this.host.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
 rayAt(point){this.raycaster.setFromCamera(new THREE.Vector2(point.x/this.width*2-1,1-point.y/this.height*2),this.camera);return this.raycaster.ray;}
 pointerDown(e){
  if(e.target.closest('.galaxy-controls')||e.button>2)return;e.preventDefault();this.host.focus({preventScroll:true});this.host.setPointerCapture(e.pointerId);const point=this.local(e);this.pointers.set(e.pointerId,{...point,startX:point.x,startY:point.y});this.dragging=true;this.syncCursor();
  if(this.pointers.size===2){this.gesture=null;this.pinch=this.pinchState();return;}
  const c=this.projectCrosshair(),near=Math.hypot(point.x-c.x,point.y-c.y)<20;
  this.gesture={type:e.shiftKey||e.button===2?'pan':near||this.mode==='tune'?'tune':this.mode,start:point,moved:false};
  if(this.gesture.type==='tune'){const normal=this.camera.getWorldDirection(V());this.dragPlane.setFromNormalAndCoplanarPoint(normal,this.cursor);const hit=this.rayAt(point).intersectPlane(this.dragPlane,this.rayPoint);this.dragOffset.copy(near&&hit?this.cursor.clone().sub(hit):V());if(!near&&hit&&e.pointerType!=='touch')this.changePoint(hit);}
 }
 pinchState(){const pts=[...this.pointers.values()];return{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2,distance:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)};}
 pointerMove(e){
  const old=this.pointers.get(e.pointerId);if(!old)return;e.preventDefault();const point=this.local(e),dx=point.x-old.x,dy=point.y-old.y;this.pointers.set(e.pointerId,{...old,...point});
  if(this.pointers.size>1){const next=this.pinchState();if(this.pinch){this.distance=clamp(this.distance*this.pinch.distance/Math.max(12,next.distance),3,14);this.pan(next.x-this.pinch.x,next.y-this.pinch.y);this.updateCamera();}this.pinch=next;return;}
  const g=this.gesture;if(!g)return;if(Math.hypot(point.x-g.start.x,point.y-g.start.y)>4)g.moved=true;
  if(g.type==='orbit'){this.azimuth-=dx*.006;this.elevation+=dy*.006;this.updateCamera();}
  else if(g.type==='pan')this.pan(dx,dy);
  else{const hit=this.rayAt(point).intersectPlane(this.dragPlane,this.rayPoint);if(hit)this.changePoint(hit.add(this.dragOffset));}
 }
 pointerUp(e){if(!this.pointers.has(e.pointerId))return;const g=this.gesture,point=this.pointers.get(e.pointerId);this.pointers.delete(e.pointerId);if(!this.pointers.size){if(g&&!g.moved&&e.type==='pointerup'&&g.type!=='pan'){const nearest=this.labelHits?.map(l=>({...l,d:Math.hypot(l.x-point.x,l.y-point.y)})).sort((a,b)=>a.d-b.d)[0];if(nearest&&nearest.d<23)this.changePoint(landmarks[nearest.index].position);else if(g.type==='tune'){const hit=this.rayAt(point).intersectPlane(this.dragPlane,this.rayPoint);if(hit)this.changePoint(hit.add(this.dragOffset));}}this.dragging=false;this.gesture=null;this.pinch=null;this.saveView();}else{this.gesture=null;this.pinch=null;}}
 pan(dx,dy){const scale=2*this.distance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5))/Math.max(1,this.height);const right=V().setFromMatrixColumn(this.camera.matrixWorld,0),up=V().setFromMatrixColumn(this.camera.matrixWorld,1);this.target.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);this.target.clampScalar(-2.5,2.5);this.updateCamera();}
 zoom(factor){this.distance=clamp(this.distance*factor,3,14);this.updateCamera();this.saveView();}
 updateCamera(){
  const sa=Math.sin(this.azimuth),ca=Math.cos(this.azimuth),se=Math.sin(this.elevation),ce=Math.cos(this.elevation);
  this.camera.position.set(this.target.x+sa*ce*this.distance,this.target.y+se*this.distance,this.target.z+ca*ce*this.distance);
  // The elevation tangent stays perpendicular to the viewing direction at both
  // poles. A fixed world-up vector would flip the scene when orbiting past them.
  this.camera.up.set(-sa*se,ce,-ca*se);this.camera.lookAt(this.target);this.camera.updateMatrixWorld();this.viewVersion++;
 }
 saveView(){const view={azimuth:this.azimuth,elevation:this.elevation,distance:this.distance,target:this.target.toArray()};try{localStorage.setItem(CAMERA_KEY,JSON.stringify(view));}catch{}this.onViewChange(view);}
 project(point){const projected=point.clone().project(this.camera);return{x:(projected.x*.5+.5)*this.width,y:(-.5*projected.y+.5)*this.height,visible:projected.z>-1&&projected.z<1,z:projected.z};}
 projectCrosshair(){this.syncCursor();return this.project(this.cursor);}
 getInteractionState(){return{mode:this.mode,dragging:this.dragging,viewVersion:this.viewVersion,camera:{azimuth:this.azimuth,elevation:this.elevation,distance:this.distance,target:this.target.toArray()},crosshair:this.cursor.toArray()};}
 projectStar(index){
  if(!this.stars)return null;const attr=this.stars.geometry.attributes.position,i=clamp(Math.floor(index),0,attr.count-1),point=V().fromBufferAttribute(attr,i);point.z*=val(this.getVisual(),'skyDepth',1.3,.3,2.5);point.z+=Math.sin(this.starMaterial.uniforms.clock.value*.16+this.stars.geometry.attributes.phase.getX(i))*.05*this.starMaterial.uniforms.drift.value;this.cloud.updateMatrixWorld(true);this.cloud.localToWorld(point);const view=point.clone().applyMatrix4(this.camera.matrixWorldInverse);return{...this.project(point),viewDepth:-view.z,world:point.toArray(),population:this.starPopulations[i]};
 }
 getDepthState(){
  if(!this.stars)return{fallback:true,depth:val(this.getVisual(),'skyDepth',1.3,.3,2.5)};const attr=this.stars.geometry.attributes.position,count=Math.min(attr.count,this.stars.geometry.drawRange.count),depth=val(this.getVisual(),'skyDepth',1.3,.3,2.5);let minZ=Infinity,maxZ=-Infinity,minView=Infinity,maxView=-Infinity;const point=V();this.cloud.updateMatrixWorld(true);
  for(let i=0;i<count;i++){point.fromBufferAttribute(attr,i);point.z*=depth;point.z+=Math.sin(this.starMaterial.uniforms.clock.value*.16+this.stars.geometry.attributes.phase.getX(i))*.05*this.starMaterial.uniforms.drift.value;minZ=Math.min(minZ,point.z);maxZ=Math.max(maxZ,point.z);this.cloud.localToWorld(point);point.applyMatrix4(this.camera.matrixWorldInverse);minView=Math.min(minView,-point.z);maxView=Math.max(maxView,-point.z);}
  return{depth,renderedCount:count,localDepthRange:[minZ,maxZ],cameraDepthRange:[minView,maxView],populations:{...this.populationCounts},examples:{...this.depthExamples},crosshair:this.cursor.toArray()};
 }
 resize(){const r=this.host.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.ratio=Math.min(devicePixelRatio||1,1.5);this.overlay.width=Math.round(this.width*this.ratio);this.overlay.height=Math.round(this.height*this.ratio);this.ctx.setTransform(this.ratio,0,0,this.ratio,0,0);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();this.renderer?.setPixelRatio(this.ratio);this.renderer?.setSize(this.width,this.height,false);if(this.starMaterial)this.starMaterial.uniforms.pixelRatio.value=this.ratio;if(this.nebulaMaterial)this.nebulaMaterial.uniforms.pixelRatio.value=this.ratio;if(this.anchorMaterial)this.anchorMaterial.uniforms.pixelRatio.value=this.ratio;}
 tick(now){if(this.dead)return;this.raf=requestAnimationFrame(this.tick);if(document.hidden||now-this.lastFrame<32)return;const dt=Math.min(.1,(now-this.lastFrame)/1000);this.lastFrame=now;this.render(dt);}
 render(dt){
  const v=this.getVisual(),p=this.getPalette(),a=this.getActivity();this.syncCursor();const drift=val(v,'skyDrift',.15,0,1);if(!v.freeze&&!this.reduced.matches)this.clock+=dt;const t=v.freeze?val(v,'phase',0)*24:this.clock;
  // Tuning moves the reticle through a fixed world; spread scales the star
  // volume around its origin, independently of the sound/crosshair position.
  const spread=val(v,'skySpread',1,.5,1.8);if(this.renderer){this.stars.geometry.setDrawRange(0,Math.round(4200*val(v,'skyDensity',.72,.1,1.5)/1.5));this.cloud.scale.setScalar(spread*1.12);this.cloud.position.set(0,0,0);this.cloud.rotation.z=Math.sin(t*.035)*drift*.045;this.starMaterial.uniforms.clock.value=t;this.starMaterial.uniforms.twinkleAmount.value=val(v,'skyTwinkle',.4,0,1);this.starMaterial.uniforms.energy.value=clamp(a.energy??a.level??0,0,1);this.starMaterial.uniforms.drift.value=this.reduced.matches?0:drift;this.starMaterial.uniforms.tint.value.set(p.secondary||'#c2e5ff').lerp(new THREE.Color('#ffffff'),.6);this.nebulaMaterial.uniforms.clock.value=t;this.nebulaMaterial.uniforms.drift.value=drift;this.nebulaMaterial.uniforms.tint.value.set(p.secondary||'#c2e5ff').lerp(new THREE.Color('#a4b9e7'),.45);const stellarDepth=val(v,'skyDepth',1.3,.3,2.5);for(const material of [this.starMaterial,this.nebulaMaterial]){material.uniforms.depthScale.value=stellarDepth;material.uniforms.focusDistance.value=this.distance;}this.anchorMaterial.uniforms.clock.value=t;this.anchorMaterial.uniforms.energy.value=this.starMaterial.uniforms.energy.value;this.anchorMaterial.uniforms.drift.value=0;this.anchorMaterial.uniforms.focusDistance.value=this.distance;this.anchorMaterial.uniforms.tint.value.copy(this.starMaterial.uniforms.tint.value);this.links.material.opacity=val(v,'skyLinks',.35,0,1)*.32;this.links.material.color.set(p.secondary||'#82b8d4');this.crosshair.position.copy(this.cursor);this.renderer.render(this.scene,this.camera);}
  this.buildGrid(v);this.drawOverlay(v,p,a,t);const input=this.controls.querySelector('input');if(document.activeElement!==input)input.value=this.getSound().detune??8;const detune=Number(this.getSound().detune??8);this.controls.querySelector('output').textContent=detune.toFixed(1).replace('.0','')+' ct';input.style.setProperty('--fill',(detune/40*100)+'%');
 }
 drawOverlay(v,p,a,t){
  const c=this.ctx,w=this.width,h=this.height;c.clearRect(0,0,w,h);c.save();c.beginPath();c.rect(0,0,w,h);c.clip();const fg=p.fg||'#f4f4ff',accent=p.accent||'#ffe579',secondary=p.secondary||'#79d9ff';
  if(!this.renderer){
   const random=makeRandom(3917),depth=val(v,'skyDepth',1.3,.3,2.5),spread=val(v,'skySpread',1,.5,1.8);
   for(let i=0;i<Math.round(1100*val(v,'skyDensity',.72,.1,1.5));i++){
    const radius=Math.sqrt(random())*2.7,angle=(i%4)*TAU/4+radius*1.45+(random()-.5)*.5,layer=i%100;
    const z=layer<2?1.25+random()*.85:layer<20?-1.25-random()*2:(random()-.5)*(.4+radius*.6)+Math.sin(angle*1.7)*radius*.14;
    const point=new THREE.Vector3(Math.cos(angle)*radius*1.07*spread,Math.sin(angle)*radius*.57*spread,z*depth*spread),pt=this.project(point);if(!pt.visible)continue;
    const eye=point.clone().applyMatrix4(this.camera.matrixWorldInverse),distance=Math.max(.3,-eye.z),size=clamp((layer<2?17:6)/distance,.65,8);
    const flux=twinkleFlux(this.twinkleProfiles[i*2],this.twinkleProfiles[i*2+1],t,val(v,'skyTwinkle',.4,0,1));c.globalAlpha=clamp((.35+random()*.5)*Math.exp(-Math.max(0,distance-this.distance)*.22)*flux,.04,1);c.fillStyle=layer<2?fg:secondary;c.beginPath();c.arc(pt.x,pt.y,size*.5,0,TAU);c.fill();
   }c.globalAlpha=1;
  }

  // The cached levels share world coordinates. Common guides keep their
  // position and combined luminance as finer-only guides fade away on zoom-out.
  const gridAlpha=val(v,'gridOpacity',.5,0,.8)*.22,lineWidth=.6*val(v,'gridWeight',1,.3,2),point=V(),endpoint=V();
  c.strokeStyle=secondary;c.fillStyle=secondary;c.lineWidth=lineWidth;
  for(const layer of this.guideActive||[]){
   if(layer.weight<.0001)continue;const pts=layer.positions;
   for(let level=0;level<8;level++){const indices=layer.bands[level];if(!indices.length)continue;c.globalAlpha=gridAlpha*(level+1)/8*layer.weight;c.beginPath();
    for(const i of indices){point.set(pts[i],pts[i+1],pts[i+2]);const start=this.project(point);if(!start.visible)continue;
     if(layer.type==='dots'){const radius=Math.max(.35,lineWidth*.9);c.moveTo(start.x+radius,start.y);c.arc(start.x,start.y,radius,0,TAU);}
     else{endpoint.set(pts[i+3],pts[i+4],pts[i+5]);const end=this.project(endpoint);if(end.visible){c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);}}
    }if(layer.type==='dots')c.fill();else c.stroke();
   }
  }

  const cursor=this.project(this.cursor);const grid=val(v,'gridOpacity',.5,0,.8);const axes=[{v:new THREE.Vector3(2.5,0,0),color:'#dfc078',label:'X · CUTOFF'},{v:new THREE.Vector3(0,1.7,0),color:'#88ddd7',label:'Y · RESONANCE'},{v:new THREE.Vector3(0,0,1.7),color:'#b2a4eb',label:'Z · SPREAD'}];
  const origin=this.project(V());for(const axis of axes){const end=this.project(axis.v);if(!end.visible)continue;c.globalAlpha=grid*.5;c.strokeStyle=axis.color;c.lineWidth=val(v,'gridWeight',1,.3,2)*.8;c.setLineDash([1,5]);c.beginPath();c.moveTo(origin.x,origin.y);c.lineTo(end.x,end.y);c.stroke();c.setLineDash([]);if(v.copyVisibility!=='none'&&h>160){c.globalAlpha=.55;c.fillStyle=axis.color;c.font='8px '+UI_FONT;if(end.x>5&&end.x<w-65&&end.y>10&&end.y<h-40)c.fillText(axis.label,end.x+6,end.y);}}
  const font=clamp(w/48,9,12)*val(v,'labelScale',1,.9,1.25);c.font=`600 ${font}px ${UI_FONT}`;c.textBaseline='middle';if('letterSpacing'in c)c.letterSpacing=(font*(v.textTracking||0))+'px';this.labelHits=[];const occupied=[];
  const sorted=landmarks.map(l=>({...l,point:this.project(l.position),distance:l.position.distanceTo(this.cursor)})).sort((a,b)=>a.distance-b.distance);
  for(const l of sorted){const pt=l.point;if(!pt.visible||pt.x<8||pt.x>w-12||pt.y<12||pt.y>h-39)continue;const selected=l.distance<.35;this.labelHits.push({x:pt.x,y:pt.y,index:l.index});c.globalAlpha=selected?1:.75;c.fillStyle=selected?accent:fg;c.beginPath();c.arc(pt.x,pt.y,selected?2.4:1.3,0,TAU);c.fill();if(v.copyVisibility==='none')continue;const tx=pt.x+7,ty=pt.y-7,tw=c.measureText(l.name).width;if(tx+tw>w-6||occupied.some(r=>tx<r.x+r.w&&tx+tw>r.x&&ty<r.y+font+5&&ty+font+5>r.y))continue;if(h<130&&l.index%2)continue;occupied.push({x:tx,y:ty,w:tw});c.globalAlpha=selected?1:.72;c.fillText(l.name,tx,ty);}
  // A screen-space reticle supplements the three perpendicular world-space rings.
  if(cursor.visible){c.globalAlpha=1;c.strokeStyle=fg;c.lineWidth=1.4;c.beginPath();c.arc(cursor.x,cursor.y,7,0,TAU);c.stroke();c.strokeStyle=secondary;c.lineWidth=.8;c.beginPath();c.arc(cursor.x,cursor.y,10,0,TAU);c.stroke();c.strokeStyle=fg;c.beginPath();for(const [x,y]of [[-15,0],[15,0],[0,-15],[0,15]]){c.moveTo(cursor.x+x,cursor.y+y);c.lineTo(cursor.x+x*.65,cursor.y+y*.65);}c.stroke();c.fillStyle=accent;c.beginPath();c.arc(cursor.x,cursor.y,1.7,0,TAU);c.fill();
   const voices=(a.voices||[]).filter(x=>x.envelope>.02);for(const voice of voices){const angle=voice.index/8*TAU+t*.08,rad=20+(voice.midi%12)*2;const x=cursor.x+Math.cos(angle)*rad,y=cursor.y+Math.sin(angle)*rad*.6;c.globalAlpha=Math.sqrt(voice.envelope);c.fillStyle=accent;c.fillRect(x,y,2,2);}
  }
  c.restore();
 }
 dispose(){this.dead=true;cancelAnimationFrame(this.raf);this.controller.abort();this.resizeObserver.disconnect();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.renderer?.dispose();this.canvas.remove();this.overlay.remove();this.controls.remove();this.live.remove();}
}
