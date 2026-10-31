import test from 'node:test';
import assert from 'node:assert/strict';

// The renderer module reads the UI font once; the grid functions themselves are
// independent of DOM/WebGL and are also used by the 2D fallback.
globalThis.document={documentElement:{}};
globalThis.getComputedStyle=()=>({getPropertyValue:()=> 'monospace'});
const {GalaxyScene,guideZoomLevels,createTwinkleProfiles,twinkleFlux}=await import('../galaxy.js');
const THREE=await import('../vendor/three.module.min.js');
const weightedStep=levels=>levels.reduce((sum,l)=>sum+l.step*l.weight,0);
const makeGrid=(type='cartesian')=>{const grid=Object.create(GalaxyScene.prototype);grid.distance=5.6;grid.visual={gridType:type,gridSpacing:1,gridFade:.5};grid.getVisual=()=>grid.visual;return grid;};

test('zoom keeps apparent guide density readable with nested world intervals',()=>{
 const ratios=[];
 for(let distance=3;distance<=14;distance+=.125){const levels=guideZoomLevels(distance);assert.ok(Math.abs(levels[0].weight+levels[1].weight-1)<1e-12);assert.equal(levels[1].step,levels[0].step*2);ratios.push(weightedStep(levels)/distance);}
 assert.ok(Math.max(...ratios)/Math.min(...ratios)<1.16,'screen-space density should remain nearly constant');
});

test('level transitions are continuous and manual spacing only changes density',()=>{
 for(const distance of [5.6,11.2])assert.ok(Math.abs(weightedStep(guideZoomLevels(distance-1e-6))-weightedStep(guideZoomLevels(distance+1e-6)))<1e-8);
 const dense=guideZoomLevels(14,.5),sparse=guideZoomLevels(14,2);
 dense.forEach((level,i)=>{assert.equal(sparse[i].step,level.step*4);assert.deepEqual(sparse[i].extent,level.extent);assert.equal(sparse[i].radius,level.radius);assert.equal(sparse[i].weight,level.weight);});
});

test('Cartesian, polar and dotted guide caches survive repeated zoom changes',()=>{
 for(const type of ['cartesian','polar','dots']){const grid=makeGrid(type);const first=grid.getGuideState();const geometry=grid.guideLayers;
  for(const distance of [3,4,5.59,5.6,5.61,8,11.2,14,5.6]){grid.distance=distance;const state=grid.getGuideState();assert.equal(state.geometryBuilds,first.geometryBuilds);assert.equal(grid.guideLayers,geometry);assert.deepEqual(state.worldOrigin,[0,0,-1.55]);assert.ok(state.levels.every(l=>l.samples>0));}
  grid.visual.gridSpacing=2;assert.equal(grid.getGuideState().geometryBuilds,first.geometryBuilds+1);
 }
});

test('all three grid styles stay anchored on the same world plane',()=>{
 const close=(a,b)=>Math.abs(a-b)<1e-5;
 for(const type of ['cartesian','polar','dots']){const grid=makeGrid(type);grid.visual.gridSpacing=.65;grid.getGuideState();for(const layer of grid.guideLayers.values()){
  const p=layer.positions;for(let i=0;i<p.length;i+=3){assert.ok(close(p[i+2],-1.55));if(type==='dots'){assert.ok(close(p[i]/layer.step,Math.round(p[i]/layer.step)));assert.ok(close(p[i+1]/layer.step,Math.round(p[i+1]/layer.step)));}if(type==='polar'){const radius=Math.hypot(p[i],p[i+1]/.62);assert.ok(close(radius/layer.step,Math.round(radius/layer.step)));}}
  if(type==='dots')assert.ok(Array.from({length:p.length/3},(_,i)=>i*3).some(i=>p[i]===0&&p[i+1]===0));
  if(type==='cartesian')for(let i=0;i<p.length;i+=6)assert.ok((close(p[i],p[i+3])&&close(p[i]/layer.step,Math.round(p[i]/layer.step)))||(close(p[i+1],p[i+4])&&close(p[i+1]/layer.step,Math.round(p[i+1]/layer.step))));
 }}
});

test('guide LOD does not mutate user settings or require a WebGL renderer',()=>{
 const grid=makeGrid('dots');Object.freeze(grid.visual);const original={...grid.visual};grid.distance=14;assert.doesNotThrow(()=>grid.getGuideState());assert.deepEqual(grid.visual,original);assert.equal(grid.renderer,undefined);
});

const makeOrbit=()=>{
 const galaxy=Object.create(GalaxyScene.prototype);
 Object.assign(galaxy,{azimuth:.25,elevation:.34,distance:5.6,target:new THREE.Vector3(),camera:new THREE.PerspectiveCamera(43,1.5,.05,60),viewVersion:0,width:600,height:400,raycaster:new THREE.Raycaster()});
 galaxy.updateCamera();return galaxy;
};

test('orbit passes through either pole without a camera flip or singular basis',()=>{
 const galaxy=makeOrbit();
 for(const pole of [-Math.PI*1.5,-Math.PI*.5,Math.PI*.5,Math.PI*1.5]){
  let previous;
  for(const offset of [-1e-5,0,1e-5]){
   galaxy.elevation=pole+offset;galaxy.updateCamera();
   const right=new THREE.Vector3().setFromMatrixColumn(galaxy.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(galaxy.camera.matrixWorld,1),forward=galaxy.camera.getWorldDirection(new THREE.Vector3());
   assert.ok(galaxy.camera.matrixWorld.elements.every(Number.isFinite));
   assert.ok(Math.abs(right.dot(up))<1e-10&&Math.abs(up.dot(forward))<1e-10);
   assert.ok(Math.abs(right.length()-1)<1e-10&&Math.abs(up.length()-1)<1e-10);
   if(previous)assert.ok(Math.abs(previous.dot(galaxy.camera.quaternion))>.999999999,'camera should rotate continuously across a pole');
   previous=galaxy.camera.quaternion.clone();
  }
 }
});

test('actual pointer orbit allows multiple complete rotations in both directions',()=>{
 const galaxy=makeOrbit();galaxy.local=e=>({x:e.clientX,y:e.clientY});galaxy.pointers=new Map([[4,{x:0,y:0,startX:0,startY:0}]]);galaxy.gesture={type:'orbit',start:{x:0,y:0},moved:false};
 const initial=galaxy.camera.quaternion.clone(),turnPixels=Math.PI*2/.006;
 for(const [x,y]of [[turnPixels*2,turnPixels*3],[-turnPixels*2,-turnPixels*3],[0,0]]){
  galaxy.pointerMove({pointerId:4,clientX:x,clientY:y,preventDefault(){}});
  assert.ok(Math.abs(galaxy.azimuth-(.25-x*.006))<1e-12);
  assert.ok(Math.abs(galaxy.elevation-(.34+y*.006))<1e-12);
  assert.ok(Math.abs(initial.dot(galaxy.camera.quaternion))>.999999999);
 }
});

test('inverted and pole views preserve projected crosshair ray alignment and screen-space panning',()=>{
 const galaxy=makeOrbit(),point=new THREE.Vector3(.5,-.3,.2),hit=new THREE.Vector3();
 for(const elevation of [-Math.PI*3.5,-Math.PI,Math.PI*.5,Math.PI*.8,Math.PI*2.5]){
  galaxy.elevation=elevation;galaxy.target.set(0,0,0);galaxy.updateCamera();
  const projected=galaxy.project(point),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(galaxy.camera.getWorldDirection(new THREE.Vector3()),point);
  assert.ok(galaxy.rayAt(projected).intersectPlane(plane,hit));assert.ok(hit.distanceTo(point)<1e-10);
  const before=galaxy.project(point);galaxy.pan(12,-8);const after=galaxy.project(point);
  assert.ok(after.x>before.x,'dragging right moves projected content right, even upside down');
  assert.ok(after.y<before.y,'dragging up moves projected content up, even upside down');
 }
});

test('star phases and rates are deterministic, independent, and use slow cycles',()=>{
 const small=createTwinkleProfiles(128),large=createTwinkleProfiles(4200);
 assert.deepEqual(small,large.slice(0,small.length),'density changes must not replace existing star rhythms');
 const rates=[];for(let i=0;i<small.length;i+=2){assert.ok(small[i]>=0&&small[i]<Math.PI*2);rates.push(small[i+1]);}
 assert.ok(Math.min(...rates)>.57&&Math.max(...rates)<1.21);
 assert.ok(new Set(rates.map(rate=>Math.round(rate*100))).size>40,'stars must not pulse together at a shared rate');
});

test('twinkle remains smooth and gentle without whole-field flashes or fully dark stars',()=>{
 const profiles=createTwinkleProfiles(4200),averages=[];let largestChange=0,individualRange=0;
 for(let time=0;time<24;time+=.25){let sum=0;
  for(let i=0;i<profiles.length;i+=2){const phase=profiles[i],rate=profiles[i+1],flux=twinkleFlux(phase,rate,time,.4);assert.ok(flux>=.78&&flux<=1.22);sum+=flux;largestChange=Math.max(largestChange,Math.abs(flux-twinkleFlux(phase,rate,time+1/30,.4)));}
  averages.push(sum/(profiles.length/2));individualRange=Math.max(individualRange,Math.abs(twinkleFlux(profiles[0],profiles[1],time,.4)-twinkleFlux(profiles[0],profiles[1],0,.4)));
 }
 assert.ok(Math.max(...averages)-Math.min(...averages)<.015,'overall exposure stays steady while individual stars twinkle');
 assert.ok(largestChange<.008,'no sudden brightness jumps at the render cadence');
 assert.ok(individualRange>.15,'individual variation should remain perceptible');
 for(const amount of [0,.4,1])for(let time=0;time<20;time+=.2){const flux=twinkleFlux(profiles[20],profiles[21],time,amount);assert.ok(flux>=.45&&flux<=1.55);if(!amount)assert.equal(flux,1);}
});

test('galaxy twinkle clock advances independently of positional drift and holds under Freeze or reduced motion',()=>{
 const galaxy=makeGrid();Object.assign(galaxy,{clock:0,cursor:new THREE.Vector3(),reduced:{matches:false},getPalette:()=>({}),getActivity:()=>({}),getSound:()=>({cutoff:2400,resonance:4.5,detune:8}),controls:{querySelector:()=>({style:{setProperty(){}},value:0})}});
 galaxy.visual.skyDrift=0;galaxy.visual.skyTwinkle=.4;galaxy.drawOverlay=(_v,_p,_a,time)=>{galaxy.renderedTime=time;};
 galaxy.render(1);galaxy.render(1);assert.equal(galaxy.renderedTime,2,'twinkle must not depend on position drift');
 galaxy.visual.freeze=true;galaxy.visual.phase=.25;galaxy.render(1);const frozen=galaxy.renderedTime;galaxy.render(3);assert.equal(galaxy.renderedTime,frozen);assert.equal(galaxy.clock,2);
 galaxy.visual.freeze=false;galaxy.reduced.matches=true;galaxy.render(4);const reduced=galaxy.renderedTime;galaxy.render(4);assert.equal(galaxy.renderedTime,reduced);assert.equal(galaxy.clock,2);
});

test('dragging the reticle tunes through a fixed star field at every spread without moving the camera',()=>{
 const galaxy=makeOrbit(),sound={cutoff:20*1000**.5,resonance:6.05,detune:20};
 Object.assign(galaxy,{scene:new THREE.Scene(),cloud:new THREE.Group(),twinkleProfiles:createTwinkleProfiles(4200),cursor:new THREE.Vector3(),dragPlane:new THREE.Plane(),dragOffset:new THREE.Vector3(),rayPoint:new THREE.Vector3(),pointers:new Map(),reduced:{matches:false},clock:0,visual:{skySpread:.75,freeze:true,phase:0},getSound:()=>sound,getPalette:()=>({}),getActivity:()=>({}),onChange:values=>Object.assign(sound,values),onViewChange(){},renderer:{render(){}},controls:{querySelector:()=>({style:{setProperty(){}},value:0})},host:{focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0})},drawOverlay(){}});
 galaxy.getVisual=()=>galaxy.visual;galaxy.scene.add(galaxy.cloud);galaxy.buildScene();
 const event=(x,y,type='pointermove')=>({pointerId:1,clientX:x,clientY:y,pointerType:'mouse',button:0,type,target:{closest:()=>null},preventDefault(){}});
 for(const spread of [.5,.75,1,1.6])for(const mode of ['orbit','pan']){
  galaxy.visual.skySpread=spread;galaxy.mode=mode;Object.assign(sound,{cutoff:20*1000**.5,resonance:6.05,detune:20});galaxy.render(0);
  const camera=galaxy.getInteractionState().camera,stars=[0,20,34,351,752].map(index=>galaxy.projectStar(index)),cloud=galaxy.cloud.matrixWorld.clone(),start=galaxy.projectCrosshair();
  galaxy.pointerDown(event(start.x,start.y,'pointerdown'));assert.equal(galaxy.gesture.type,'tune','direct reticle dragging takes precedence over background navigation mode');
  galaxy.pointerMove(event(start.x+28,start.y-12));galaxy.render(0);galaxy.pointerUp(event(start.x+28,start.y-12,'pointerup'));
  const end=galaxy.projectCrosshair();assert.ok(Math.abs(end.x-start.x-28)<1e-8&&Math.abs(end.y-start.y+12)<1e-8,'reticle follows the pointer');
  assert.deepEqual(galaxy.getInteractionState().camera,camera,'tuning must preserve all camera state');
  [0,20,34,351,752].forEach((index,i)=>assert.deepEqual(galaxy.projectStar(index),stars[i],'star positions must remain fixed while the reticle moves'));
  assert.deepEqual(galaxy.cloud.matrixWorld.elements,cloud.elements);assert.notEqual(sound.cutoff,20*1000**.5);
 }
});
