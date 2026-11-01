import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
// The renderer reads the UI font on module load; spatial tests do not need a DOM.
globalThis.document={documentElement:{}};
globalThis.getComputedStyle=()=>({getPropertyValue:()=> 'monospace'});
const {RingScene,sectorEnvelope,beadBreathing,beadBreathParameters}=await import('../ring.js');
const TAU=Math.PI*2;
const fraction=point=>((Math.atan2(-point.y,point.x)+Math.PI)/TAU+1)%1;
const degree=(point,outer)=>Math.min(6,Math.floor(fraction(point)*7))+Math.min(2,Math.floor(Math.hypot(point.x,point.y)/outer*3))*7;
function fixture(pose={}){
 const visual={ringRadius:1.65,ringThickness:.57,beadSize:.047,density:.85,twist:.035,spread:.07,seed:42,...pose};
 const ring=Object.create(RingScene.prototype);ring.size={w:pose.w||760,h:pose.h||540};ring.canvas={getBoundingClientRect:()=>({left:73,top:41,width:ring.size.w,height:ring.size.h})};
 ring.getVisual=()=>visual;ring.getPalette=()=>({reference:true});ring.effectiveVisual=visual;ring.ringGroup=new THREE.Group();ring.material=new THREE.MeshBasicMaterial();ring.sphereGeometry=new THREE.SphereGeometry(1,12,8);ring.camera=new THREE.PerspectiveCamera(pose.fov||35,ring.size.w/ring.size.h,.1,60);ring.camera.position.set(0,.1,8.3);
 ring.ringGroup.rotation.set(pose.tilt||0,-.16,pose.rotation||0,'ZXY');ring.ringGroup.scale.set(pose.scale||1,pose.scale||1,(pose.scale||1)*(pose.depth||1));ring.ringGroup.position.y=.16;ring.updateGeometry(visual,true);ring.ringGroup.updateMatrixWorld(true);ring.camera.updateMatrixWorld(true);
 return {ring,visual};
}
function project(ring,point){const projected=point.clone().applyMatrix4(ring.ringGroup.matrixWorld).project(ring.camera);return{x:73+(projected.x*.5+.5)*ring.size.w,y:41+(-projected.y*.5+.5)*ring.size.h};}
function frontBeads(ring){const matrix=new THREE.Matrix4(),ray=new THREE.Raycaster(),found=[];for(let id=0;id<ring.beads.count;id+=3){ring.beads.getMatrixAt(id,matrix);const point=new THREE.Vector3().setFromMatrixPosition(matrix);const f=fraction(point)*7,radial=Math.hypot(point.x,point.y)/(ring.renderedGeometry.major+ring.renderedGeometry.minor)*3;if(Math.min(f%1,1-f%1)<.12||Math.min(radial%1,1-radial%1)<.15)continue;const client=project(ring,point);if(client.x<73||client.y<41||client.x>73+ring.size.w||client.y>41+ring.size.h)continue;ray.setFromCamera(new THREE.Vector2((client.x-73)/ring.size.w*2-1,1-(client.y-41)/ring.size.h*2),ring.camera);const first=ray.intersectObject(ring.beads,false)[0];if(first?.instanceId===id){found.push({point,client});if(found.length===12)break;}}return found;}

function assertArtworkFits(ring){
 const m=new THREE.Matrix4(),point=new THREE.Vector3(),check=p=>{p.applyMatrix4(ring.ringGroup.matrixWorld).project(ring.camera);assert.ok(Math.abs(p.x)<.98&&Math.abs(p.y)<.98&&p.z>-1&&p.z<1,JSON.stringify({viewport:ring.size,zoom:ring.orbit?.zoom,p}));};
 // Sample every major/tube phase and conservatively check expanded bead cubes.
 for(let id=0;id<ring.beads.count;id+=13){ring.beads.getMatrixAt(id,m);for(let corner=0;corner<8;corner++)check(point.set(corner&1?1.53:-1.53,corner&2?1.53:-1.53,corner&4?1.53:-1.53).applyMatrix4(m));}
 if(ring.coreCells){ring.coreGroup.updateMatrix();ring.coreCells.updateMatrix();const vertex=ring.coreCells.geometry.attributes.position,combined=new THREE.Matrix4();for(let id=0;id<ring.coreCells.count;id++){ring.coreCells.getMatrixAt(id,m);combined.multiplyMatrices(ring.coreGroup.matrix,ring.coreCells.matrix).multiply(m);for(let j=0;j<vertex.count;j++)check(point.fromBufferAttribute(vertex,j).applyMatrix4(combined));}}
}

test('visible bead hits preserve local musical zones across camera, pose, depth and viewport changes',()=>{
 const poses=[{rotation:0,tilt:0},{rotation:1.7,tilt:-.6},{rotation:-2.6,tilt:1.3,scale:.65,depth:1.5,fov:60},{rotation:3.1,tilt:.8,scale:1.25,fov:25},{rotation:-1.2,tilt:.95,w:390,h:600,depth:.6},{rotation:2.4,tilt:1.1,w:1000,h:280,scale:.8}];
 let tested=0;
 for(const pose of poses){const {ring}=fixture(pose),beads=frontBeads(ring);assert.ok(beads.length>=3,JSON.stringify(pose));for(const {point,client}of beads){const hit=ring.pickClientPoint(client.x,client.y);assert.equal(hit.kind,'bead');assert.equal(degree(hit.local,ring.renderedGeometry.major+ring.renderedGeometry.minor),degree(point,ring.renderedGeometry.major+ring.renderedGeometry.minor));const projected=project(ring,new THREE.Vector3(hit.local.x,hit.local.y,hit.local.z));assert.ok(Math.hypot(projected.x-client.x,projected.y-client.y)<.0001);tested++;}}
 assert.ok(tested>=50);
});

test('empty hole and outer drag area use the same transformed ring plane',()=>{
 const {ring}=fixture({rotation:2.1,tilt:.4,depth:1.5,fov:55});for(const point of [new THREE.Vector3(.15,.1,0),new THREE.Vector3(3.1,-1.2,0)]){const client=project(ring,point),hit=ring.pickClientPoint(client.x,client.y);assert.equal(hit.kind,'plane');assert.ok(new THREE.Vector3(hit.local.x,hit.local.y,hit.local.z).distanceTo(point)<1e-8);assert.ok(hit.radial>=0&&hit.radial<1);}
});

test('changing same-count geometry after a pick rebuilds bounds and preserves hit alignment',()=>{
 const {ring,visual}=fixture();const before=ring.beads.boundingSphere.radius;ring.pickClientPoint(400,300);const count=ring.beads.count;
 visual.ringRadius=2.3;visual.ringThickness=.9;visual.twist=.7;ring.updateGeometry(visual,true);ring.ringGroup.updateMatrixWorld(true);
 assert.equal(ring.beads.count,count);assert.ok(ring.beads.boundingSphere.radius>before+.5);const beads=frontBeads(ring);assert.ok(beads.length);for(const {point,client}of beads){const hit=ring.pickClientPoint(client.x,client.y);assert.equal(hit.kind,'bead');assert.equal(degree(hit.local,3.2),degree(point,3.2));}
});

test('degenerate pointers and nearly edge-on empty-space rays do not emit invalid positions',()=>{
 const {ring}=fixture({tilt:Math.PI/2,rotation:0});assert.equal(ring.pickClientPoint(NaN,100),null);const hit=ring.pickClientPoint(400,-400);assert.ok(hit===null||[hit.local.x,hit.local.y,hit.local.z,hit.angle,hit.radial].every(Number.isFinite));
});

test('live lighting and connection arcs remain on the same material point through ring/camera motion and release',()=>{
 const {ring}=fixture();ring.rippleUniforms={uTouches:{value:Array.from({length:8},()=>new THREE.Vector4())},uTouchLocal:{value:Array.from({length:8},()=>new THREE.Vector4())},uViewport:{value:new THREE.Vector2()},uVoices:{value:[.6,.4,0,0,0,0,0,0]}};
 const bead=frontBeads(ring)[4],hit=ring.pickClientPoint(bead.client.x,bead.client.y,{surfaceOnly:true}),anchor=ring.createSurfaceAnchor(hit),finger={clientX:bead.client.x,clientY:bead.client.y,anchor};
 ring.contacts=new Map([[7,finger]]);const live={index:0,started:5,source:'live',pointerId:7,envelope:.6},sequence={index:1,started:4,source:'sequence',envelope:.4};
 ring.updateContactSignals({voices:[live,sequence]});const before=ring.rippleUniforms.uTouches.value[0].clone(),local=ring.rippleUniforms.uTouchLocal.value[0].clone();assert.equal(before.z,.6);assert.equal(ring.rippleUniforms.uVoices.value[0],0);assert.equal(ring.rippleUniforms.uVoices.value[1],.4);
 ring.ringGroup.rotation.set(1.2,.4,2.7);ring.orbitState().yaw=.9;ring.orbit.pitch=2.1;ring.applyOrbitCamera(8.3);ring.updateContactSignals({voices:[live,sequence]});
 const after=ring.rippleUniforms.uTouches.value[0],expected=project(ring,new THREE.Vector3(hit.local.x,hit.local.y,hit.local.z));assert.ok(Math.hypot(after.x-before.x,after.y-before.y)>.1);assert.deepEqual(ring.rippleUniforms.uTouchLocal.value[0],local);assert.ok(Math.hypot(ring.projectSector(0).x-(expected.x-73),ring.projectSector(0).y-(expected.y-41))<1e-7);
 ring.contacts.clear();ring.orbit.pitch+=1;ring.applyOrbitCamera(8.3);ring.updateContactSignals({voices:[{...live,pointerId:undefined,envelope:.2},sequence]});assert.equal(ring.rippleUniforms.uTouches.value[0].z,.2);assert.deepEqual(ring.rippleUniforms.uTouchLocal.value[0],local);
 ring.rippleUniforms.uVoices.value[0]=.7;ring.updateContactSignals({voices:[{...live,pointerId:undefined,started:8,envelope:.7},sequence]});assert.equal(ring.rippleUniforms.uTouches.value[0].z,0);assert.equal(ring.rippleUniforms.uVoices.value[0],.7);assert.equal(ring.contactVoices.has(0),false);
});

test('strict gesture admission accepts visible beads and rejects the empty hole and surrounding plane',()=>{
 const {ring}=fixture({tilt:.4,rotation:.7});
 for(const {client}of frontBeads(ring))assert.equal(ring.pickClientPoint(client.x,client.y,{surfaceOnly:true}).kind,'bead');
 for(const point of [new THREE.Vector3(.05,.05,0),new THREE.Vector3(3.2,-1.3,0)]){
  const client=project(ring,point);assert.equal(ring.pickClientPoint(client.x,client.y,{surfaceOnly:true,tolerance:3}),null);
  assert.equal(ring.pickClientPoint(client.x,client.y).kind,'plane');
 }
});

test('visible sounding surfaces stay aligned after camera orbit, including rear and steep views',()=>{
 for(const [yaw,pitch]of [[.9,.5],[-2.6,-.8],[3.1,1.15],[-1.8,-1.2]]){
  const {ring}=fixture({rotation:.8,tilt:.6,fov:48});ring.orbitState().yaw=yaw;ring.orbit.pitch=pitch;ring.applyOrbitCamera(8.3);
  const beads=frontBeads(ring);assert.ok(beads.length>=6);for(const {point,client}of beads){
   const hit=ring.pickClientPoint(client.x,client.y,{surfaceOnly:true});assert.equal(hit.kind,'bead');assert.equal(degree(hit.local,2.22),degree(point,2.22));
   const projected=project(ring,new THREE.Vector3(hit.local.x,hit.local.y,hit.local.z));assert.ok(Math.hypot(projected.x-client.x,projected.y-client.y)<.0001);
  }
 }
});

test('orbit ownership, immediate camera movement, inertia decay, bounds and reset are deterministic',()=>{
 const {ring}=fixture();ring.reducedMotion={matches:false};const saved=[];ring.onCameraChange=view=>saved.push(view);
 const before=ring.camera.position.clone();assert.equal(ring.beginOrbit(1,100,100,0),true);assert.equal(ring.beginOrbit(2,100,100,1),false);
 assert.equal(ring.moveOrbit(2,180,160,20),false);assert.deepEqual(ring.camera.position,before);
 assert.equal(ring.moveOrbit(1,180,160,20),true);assert.ok(ring.camera.position.distanceTo(before)>1);const releasedYaw=ring.orbit.yaw;
 ring.endOrbit(1,false,30);ring.updateOrbit(1/60);assert.ok(ring.orbit.yaw<releasedYaw);
 for(let i=0;i<150;i++)ring.updateOrbit(1/60);assert.equal(ring.orbit.velocityYaw,0);assert.equal(ring.orbit.velocityPitch,0);
 ring.nudgeOrbit(0,100);assert.ok(ring.orbit.pitch>100);ring.setZoom(1.8);ring.resetOrbit();assert.equal(ring.orbit.yaw,0);assert.equal(ring.orbit.pitch,0);assert.equal(ring.orbit.zoom,1);assert.ok(ring.camera.quaternion.angleTo(new THREE.Quaternion())<1e-8);assert.deepEqual(saved.at(-1),{yaw:0,pitch:0,zoom:1});
});

test('cancel, stale release and reduced motion stop momentum while direct dragging still works',()=>{
 const {ring}=fixture();ring.reducedMotion={matches:true};ring.beginOrbit(1,10,10,0);ring.moveOrbit(1,70,40,20);assert.notEqual(ring.orbit.yaw,0);ring.endOrbit(1,false,30);assert.equal(ring.orbit.velocityYaw,0);
 ring.reducedMotion.matches=false;ring.beginOrbit(2,10,10,100);ring.moveOrbit(2,70,40,120);ring.endOrbit(2,false,250);assert.equal(ring.orbit.velocityYaw,0);
 ring.beginOrbit(3,10,10,300);ring.moveOrbit(3,70,40,320);ring.endOrbit(3,true,330);assert.equal(ring.orbit.velocityYaw,0);
 ring.beginOrbit(4,10,10,400);ring.moveOrbit(4,70,40,420);ring.cancelOrbit();assert.equal(ring.orbit.drag,null);assert.equal(ring.orbit.velocityYaw,0);
});

test('fallback strict picking follows actually painted bead and core geometry through its view transform',()=>{
 const {ring,visual}=fixture();ring.fallback=true;ring.energy=0;ring.getActivity=()=>({voices:[]});
 const noop=()=>{},gradient={addColorStop:noop};ring.ctx=new Proxy({createRadialGradient:()=>gradient},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>{target[key]=value;return true;}});
 for(const [yaw,pitch]of [[0,0],[1.2,.4],[-2,-.6]]){
  Object.assign(ring.orbitState(),{yaw,pitch});ring.drawFallback(visual,{reference:true},{voices:[]},0);
  const bead=ring.fallbackBeads.at(-1);assert.equal(ring.pickClientPoint(bead.screenX+73,bead.screenY+41,{surfaceOnly:true}).kind,'bead');
  assert.equal(ring.pickClientPoint(73+ring.size.w*.5,41+ring.size.h*.48,{surfaceOnly:true}).kind,'core');
  assert.equal(ring.pickClientPoint(75,43,{surfaceOnly:true}),null);
 }
});

function attachCage(ring){
 ring.cage=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial());ring.ringGroup.add(ring.cage);
}
function assertCageContainsArtwork(ring){
 ring.ringGroup.updateMatrixWorld(true);const inverse=ring.cage.matrixWorld.clone().invert(),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
 const inside=world=>{point.copy(world).applyMatrix4(inverse);assert.ok(Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))<=.5000001,JSON.stringify(point));};
 // Check all instances at the shader's maximum displacement, then transform
 // them independently into the actual rendered cage's unit-box coordinates.
 const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)];
 for(let i=0;i<ring.beads.count;i++){ring.beads.getMatrixAt(i,matrix);for(const axis of axes)inside(axis.clone().multiplyScalar(1.53).applyMatrix4(matrix).applyMatrix4(ring.beads.matrixWorld));}
 if(ring.coreCells){const geometry=ring.coreCells.geometry.attributes.position;for(let i=0;i<ring.coreCells.count;i++){ring.coreCells.getMatrixAt(i,matrix);for(let j=0;j<geometry.count;j++)inside(new THREE.Vector3().fromBufferAttribute(geometry,j).applyMatrix4(matrix).applyMatrix4(ring.coreCells.matrixWorld));}}
}

test('wireframe snugly contains expanded beads through extreme form, pose, depth and camera orbit',()=>{
 const cases=[{}, {rotation:2.1,tilt:1.3,scale:1.25,depth:2,ringRadius:2.8,ringThickness:1.1,beadSize:.1,twist:3,spread:1,density:.35}, {rotation:-2.7,tilt:-1.4,scale:.5,depth:.3,ringRadius:.9,ringThickness:1.1,twist:-3,density:.4}, {rotation:1.2,tilt:.8,scale:1.8,depth:1.7,ringRadius:2.8,ringThickness:.15,twist:-2.8}];
 for(const pose of cases){const {ring}=fixture(pose);attachCage(ring);ring.orbitState().yaw=1.6;ring.orbit.pitch=.9;ring.applyOrbitCamera(10);ring.updateCageBounds();assert.equal(ring.cage.parent,ring.ringGroup);assertCageContainsArtwork(ring);
  for(const axis of ['x','y','z']){assert.ok(Math.abs(ring.cageBounds.min[axis]-ring.cageContentBounds.min[axis]+ring.cagePadding)<1e-10);assert.ok(Math.abs(ring.cageBounds.max[axis]-ring.cageContentBounds.max[axis]-ring.cagePadding)<1e-10);}
  assert.ok(ring.cagePadding>=.075&&ring.cagePadding<=.18);
 }
});

test('wireframe follows same-count geometry edits and transformed core-cell vertices',()=>{
 const {ring,visual}=fixture({rotation:-1.1,tilt:1.2,depth:1.8});attachCage(ring);ring.updateCageBounds();const before=ring.cageBounds.clone(),count=ring.beads.count;
 visual.ringRadius=2.4;visual.ringThickness=.8;visual.twist=1.8;ring.updateGeometry(visual,true);
 ring.coreGroup=new THREE.Group();ring.coreGroup.position.set(.2,-.1,.15);ring.coreGroup.rotation.set(.3,.4,.1);ring.coreGroup.scale.set(.9,1.1,1.3);ring.ringGroup.add(ring.coreGroup);
 ring.coreCells=new THREE.InstancedMesh(new THREE.ConeGeometry(.25,.8,5),new THREE.MeshBasicMaterial(),2);ring.coreGroup.add(ring.coreCells);const instance=new THREE.Object3D();
 instance.position.set(0,0,.6);instance.updateMatrix();ring.coreCells.setMatrixAt(0,instance.matrix);instance.position.set(4.1,-.5,1.9);instance.rotation.set(.5,.8,.3);instance.updateMatrix();ring.coreCells.setMatrixAt(1,instance.matrix);
 ring.updateCageBounds();assert.equal(ring.beads.count,count);assert.ok(ring.cageBounds.max.x>before.max.x+.5);assertCageContainsArtwork(ring);
});

test('fallback frame contains the entire painted bead silhouette after orbit and form changes',()=>{
 const {ring,visual}=fixture();ring.fallback=true;ring.energy=1;ring.getActivity=()=>({voices:[]});
 const noop=()=>{},gradient={addColorStop:noop};ring.ctx=new Proxy({createRadialGradient:()=>gradient},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>{target[key]=value;return true;}});
 for(const [yaw,pitch,major,minor]of [[0,0,1.65,.57],[1.3,.9,2.8,1.1],[-2.6,-1,.9,.8]]){
  Object.assign(ring.orbitState(),{yaw,pitch});Object.assign(visual,{ringRadius:major,ringThickness:minor});ring.drawFallback(visual,{reference:true},{voices:[]},0);const bounds=ring.fallbackCageBounds;
  for(const bead of ring.fallbackBeads){assert.ok(bead.x-bead.radius>=bounds.left);assert.ok(bead.x+bead.radius<=bounds.right);assert.ok(bead.y-bead.radius>=bounds.top);assert.ok(bead.y+bead.radius<=bounds.bottom);}
 }
});

function contactFixture(){
 const {ring}=fixture();ring.rippleUniforms={uTouches:{value:Array.from({length:8},()=>new THREE.Vector4())},uViewport:{value:new THREE.Vector2()},uVoices:{value:Array(8).fill(.6)}};ring.contacts=new Map();ring.contactHistory=new Map();return ring;
}

test('arp pulses follow the originating moving finger and keep its location through Hold and release',()=>{
 const ring=contactFixture(),finger={clientX:400,clientY:200,startedAt:10,updatedAt:10,active:true};ring.contacts.set(7,finger);ring.contactHistory.set('pointer-7',[finger]);
 const voice={index:3,source:'arp',pointerId:7,originId:'pointer-7',originTime:10.02,generation:2,started:4,envelope:.8};
 ring.updateContactSignals({time:4.1,hold:true,voices:[voice]});assert.equal(ring.rippleUniforms.uTouches.value[3].z,.8);assert.equal(ring.rippleUniforms.uVoices.value[3],0);assert.deepEqual(ring.projectSector(3),{x:327,y:159});
 finger.clientX=500;finger.clientY=280;ring.updateContactSignals({time:4.2,hold:true,voices:[voice]});assert.deepEqual(ring.projectSector(3),{x:427,y:239});
 ring.contacts.clear();finger.active=false;
 // A later arpeggiated note must recover the original contact despite pointerup.
 ring.updateContactSignals({time:5.1,hold:true,voices:[{...voice,index:6,generation:7,started:5,envelope:.55}]});assert.deepEqual(ring.projectSector(6),{x:427,y:239});
 ring.updateContactSignals({time:5.3,hold:false,voices:[{...voice,index:6,generation:7,started:5,envelope:.16}]});assert.equal(ring.rippleUniforms.uTouches.value[6].z,.16);
});

test('queued arp snapshots, reused pointer IDs and pooled voice generations cannot steal contact lighting',()=>{
 const ring=contactFixture(),old={clientX:300,clientY:180,startedAt:10,updatedAt:10,active:false},fresh={clientX:600,clientY:320,startedAt:20,updatedAt:20,active:true};ring.contacts.set(1,fresh);ring.contactHistory.set('pointer-1',[old,fresh]);
 const voice={index:2,source:'arp',pointerId:1,originId:'pointer-1',originTime:10.02,generation:4,started:6,envelope:.6};
 ring.updateContactSignals({time:5.9,hold:true,voices:[voice]});assert.equal(ring.rippleUniforms.uTouches.value[2].z,0);
 ring.updateContactSignals({time:6.1,hold:true,voices:[voice]});assert.deepEqual(ring.projectSector(2),{x:227,y:139});
 fresh.clientX=620;ring.updateContactSignals({time:6.2,hold:true,voices:[voice]});assert.deepEqual(ring.projectSector(2),{x:227,y:139});
 ring.updateContactSignals({time:6.3,hold:true,voices:[{...voice,generation:5,originTime:20.02,started:6.25}]});assert.deepEqual(ring.projectSector(2),{x:547,y:279});
 ring.rippleUniforms.uVoices.value[2]=.7;ring.updateContactSignals({time:6.4,voices:[{index:2,source:'arp',originId:'key-a',pointerId:null,generation:6,started:6.35,envelope:.7}]});assert.equal(ring.contactVoices.has(2),false);assert.equal(ring.rippleUniforms.uTouches.value[2].z,0);assert.equal(ring.rippleUniforms.uVoices.value[2],.7);
});

test('temporary hit loss preserves the same sounding gesture when the finger re-enters',()=>{
 const ring=contactFixture(),finger={clientX:400,clientY:200,startedAt:10,updatedAt:10,active:true,element:{style:{},hidden:false,remove(){}}};
 ring.host={getBoundingClientRect:()=>({left:73,top:41,width:760,height:540})};ring.contacts.set(7,finger);ring.contactHistory.set('pointer-7',[finger]);
 const voice={index:3,source:'arp',pointerId:7,originId:'pointer-7',originTime:10.02,generation:2,started:4,envelope:.8};
 ring.updateContactSignals({time:4.1,hold:true,voices:[voice]});ring.suspendContact(7,430,230);assert.equal(finger.element.hidden,true);assert.equal(ring.contacts.get(7),finger);assert.equal(finger.active,true);ring.updateContactSignals({time:4.2,hold:true,voices:[voice]});assert.equal(ring.rippleUniforms.uTouches.value[3].z,0);
 const target=frontBeads(ring)[3],hit=ring.pickClientPoint(target.client.x,target.client.y,{surfaceOnly:true});ring.showContact(7,target.client.x,target.client.y,hit);ring.updateContactSignals({time:4.3,hold:true,voices:[voice]});assert.equal(finger.startedAt,10);assert.equal(finger.element.hidden,false);assert.equal(ring.contactHistory.get('pointer-7').length,1);assert.ok(Math.hypot(ring.projectSector(3).x-(target.client.x-73),ring.projectSector(3).y-(target.client.y-41))<1e-7);assert.equal(ring.rippleUniforms.uTouches.value[3].z,.8);
 ring.releaseContact(7);assert.equal(finger.active,false);assert.equal(ring.contacts.has(7),false);
 ring.clearContacts();assert.equal(ring.contactHistory.size,0);assert.equal(ring.contactVoices.size,0);assert.ok(ring.rippleUniforms.uTouches.value.every(touch=>touch.z===0));
});

test('periodic sector lighting has no dark seams across adjacent voices or tube rows',()=>{
 for(let i=0;i<2048;i++){const angle=i/2048*TAU-TAU;assert.ok(Math.abs(sectorEnvelope(angle,Array(8).fill(1))-1)<1e-12);assert.ok(Math.abs(sectorEnvelope(angle,Array(8).fill(.43))-.43)<1e-12);}
 const adjacent=[1,1,0,0,0,0,0,0];assert.equal(sectorEnvelope(Math.PI/8,adjacent),1);
 assert.ok(Math.abs(sectorEnvelope(-1e-9,[1,0,0,0,0,0,0,0])-sectorEnvelope(1e-9,[1,0,0,0,0,0,0,0]))<1e-12);
});

test('ambient bead breathing is bounded, slow, spatially varied and neutral at zero amount',()=>{
 for(const amount of [0,.08,.25])for(const rate of [2,8,20])for(let i=0;i<128;i++){
  const u=i*.13,w=i*.37,time=i*.29,scale=beadBreathing(u,w,time,amount,rate);assert.ok(scale>=1-amount&&scale<=1+amount);assert.ok(Math.abs(scale-beadBreathing(u,w,time+.016,amount,rate))<.012);
  if(amount===0)assert.equal(scale,1);
 }
 assert.notEqual(beadBreathing(0,0,2),beadBreathing(1.1,2.5,2));assert.equal(beadBreathing(1,2,7,.08,8),beadBreathing(1,2,7,.08,8));
});

test('fitted camera contains expanded artwork across sizes, shape extremes and full orbits',()=>{
 for(const [w,h]of [[760,540],[464,382],[406,217],[340,600]])for(const [yaw,pitch]of [[0,0],[.7,Math.PI/2],[-2,Math.PI],[1.4,Math.PI*3.5],[TAU*3+.3,-TAU*2-1.1]]){
  const {ring}=fixture({w,h,ringRadius:2.4,ringThickness:.9,twist:2.4,scale:1.25,depth:1.8,rotation:.8,tilt:1.2});attachCage(ring);ring.updateCageBounds();Object.assign(ring.orbitState(),{yaw,pitch,zoom:1});ring.applyOrbitCamera();
  assertArtworkFits(ring);
 }
});

test('orbit remains continuous through poles and zoom is immediate, bounded, persistent and resettable',()=>{
 const {ring}=fixture();attachCage(ring);ring.updateCageBounds();const orbit=ring.orbitState();orbit.yaw=.8;
 for(const pole of [Math.PI/2,Math.PI*1.5,-Math.PI/2]){orbit.pitch=pole-.0001;ring.applyOrbitCamera();const before=ring.camera.quaternion.clone();orbit.pitch=pole+.0001;ring.applyOrbitCamera();assert.ok(before.angleTo(ring.camera.quaternion)<.001);}
 const saved=[];ring.onCameraChange=view=>saved.push(view);ring.resetOrbit();const far=ring.camera.position.distanceTo(ring.cameraTarget);ring.setZoom(2);assert.ok(ring.camera.position.distanceTo(ring.cameraTarget)<far*.9);assert.equal(saved.at(-1).zoom,2);ring.zoomBy(.5);assert.equal(orbit.zoom,1);assert.equal(ring.setZoom(100),2.5);assert.equal(ring.setZoom(.01),.5);ring.resetOrbit();assert.equal(orbit.zoom,1);
});

test('material anchors track geometry edits and remap density without changing musical source identity',()=>{
 const {ring,visual}=fixture(),bead=frontBeads(ring)[4],hit=ring.pickClientPoint(bead.client.x,bead.client.y,{surfaceOnly:true}),anchor=ring.createSurfaceAnchor(hit),old=ring.resolveSurfaceAnchor(anchor).clone(),originalUV=[anchor.u,anchor.tubePhase];
 Object.assign(visual,{ringRadius:2.4,ringThickness:.8,twist:1.2,density:1.7});ring.updateGeometry(visual,true);const next=ring.resolveSurfaceAnchor(anchor);assert.ok(next.distanceTo(old)>.2);assert.deepEqual([anchor.u,anchor.tubePhase],originalUV);assert.ok(anchor.instanceId>=0&&anchor.instanceId<ring.beads.count);
 const matrix=new THREE.Matrix4();ring.beads.getMatrixAt(anchor.instanceId,matrix);assert.ok(anchor.offset.clone().applyMatrix4(matrix).distanceTo(next)<1e-10);
});

test('camera distance and angular sphere size stay constant over complete orbit and artwork rotations at every saved zoom',()=>{
 for(const [w,h]of [[694,635],[464,382],[406,217],[340,600]])for(const zoom of [.5,1,1.4,2,2.5]){
  const {ring,visual}=fixture({w,h,ringRadius:2.3,ringThickness:.9,twist:2.4,scale:1.25,depth:1.8,reactivity:2});attachCage(ring);ring.updateCageBounds();ring.orbitState().zoom=zoom;ring.applyOrbitCamera();
  const distance=ring.camera.position.distanceTo(ring.cameraTarget),envelope=ring.cameraEnvelope,key=envelope.key,angularSize=Math.asin(envelope.radius/distance);
  for(let i=0;i<48;i++){
   ring.orbit.yaw=i*.37;ring.orbit.pitch=i*.29-4;ring.ringGroup.rotation.set(Math.sin(i)*1.4,i*.11,i*.41);const reactive=visual.scale*(1+(i%2)*.044);ring.ringGroup.scale.set(reactive,reactive,reactive*visual.depth);ring.applyOrbitCamera();
   const next=ring.camera.position.distanceTo(ring.cameraTarget);assert.ok(Math.abs(next-distance)<1e-9);assert.equal(ring.cameraEnvelope.key,key);assert.ok(Math.abs(Math.asin(envelope.radius/next)-angularSize)<1e-12);
   assertArtworkFits(ring);
  }
 }
});

test('static frame includes the actual animated core throughout all waveform/envelope phases',()=>{
 const noop=()=>{};document.createElement=()=>({width:128,height:64,getContext:()=>({clearRect:noop,fillText:noop})});
 const {ring,visual}=fixture({ringRadius:2.3,ringThickness:.15,depth:2,scale:1.25,reactivity:2});ring.scene=new THREE.Scene();ring.rippleUniforms={uVoices:{value:Array(8).fill(0)}};ring.buildSignalObjects();ring.orbitState().zoom=2.5;
 let distance,key;
 for(const waveform of ['sine','triangle','sawtooth','square'])for(let i=0;i<16;i++){
  ring.energy=i%2;const activity={time:i*.51,voices:Array.from({length:8},(_,index)=>({index,midi:60,envelope:i%2})),cutoff:20000,resonance:12,sound:{waveform,cutoff:20000,resonance:12,detune:40,lfoDepth:1},sequence:{}};
  ring.parameterState(activity,.2);ring.updateSignalObjects(visual,{reference:true},activity,activity.time,false);ring.updateCageBounds();ring.orbit.yaw=i*.53;ring.orbit.pitch=i*.38;ring.ringGroup.rotation.set(i*.17,i*.31,i*.43);const scale=visual.scale*(1+ring.energy*.044);ring.ringGroup.scale.set(scale,scale,scale*visual.depth);ring.applyOrbitCamera();
  distance??=ring.cameraDistance;key??=ring.cameraEnvelope.key;assert.ok(Math.abs(ring.cameraDistance-distance)<1e-9);assert.equal(ring.cameraEnvelope.key,key);
  assertArtworkFits(ring);
 }
});

test('Ring size remains perceptible within the safe zoom range instead of cancelling into camera distance',()=>{
 const diameters=[];for(const scale of [.5,.74,1.25]){
  const {ring}=fixture({scale,depth:.9});attachCage(ring);ring.updateCageBounds();ring.orbitState().zoom=1;ring.applyOrbitCamera();
  const left=project(ring,new THREE.Vector3(-2.22,0,0)),right=project(ring,new THREE.Vector3(2.22,0,0));diameters.push(Math.hypot(right.x-left.x,right.y-left.y));
 }
 assert.ok(diameters[1]>diameters[0]*1.08);assert.ok(diameters[2]>diameters[1]*1.1);assert.ok(diameters[1]>110);
});

test('fallback scale is invariant during full orbit and all zooms keep its entire wireframe visible',()=>{
 const {ring,visual}=fixture({w:406,h:217,ringRadius:2.3,ringThickness:.9,scale:.74});ring.fallback=true;ring.energy=1;ring.getActivity=()=>({voices:[]});
 const noop=()=>{},gradient={addColorStop:noop};ring.ctx=new Proxy({createRadialGradient:()=>gradient},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>{target[key]=value;return true;}});
 for(const zoom of [.5,1,1.4,2.5]){
  ring.orbitState().zoom=zoom;const unit=ring.fallbackUnit(visual);
  for(let i=0;i<32;i++){
   ring.orbit.yaw=i*.37;ring.orbit.pitch=i*.43;assert.equal(ring.fallbackUnit(visual),unit);ring.drawFallback(visual,{reference:true},{voices:[]},i*.1);
   const box=ring.fallbackCageBounds,cos=Math.cos(box.rotation),sin=Math.sin(box.rotation),cx=ring.size.w*.5,cy=ring.size.h*.48,offset=visual.ringRadius*unit*.12;
   for(const x of [box.left,box.right])for(const y of [box.top,box.bottom])for(const back of [0,1]){const dx=x-cx+offset*back,dy=y-cy-offset*back,sx=cx+dx*cos-dy*sin,sy=cy+dx*sin+dy*cos;assert.ok(sx>0&&sx<ring.size.w&&sy>0&&sy<ring.size.h,JSON.stringify({zoom,i,sx,sy}));}
  }
 }
});

test('neighboring beads have repeatable independent phases and rates with no collective breathing pulse',()=>{
 const {ring}=fixture(),attribute=ring.sphereGeometry.getAttribute('aBreath');assert.equal(attribute.count,ring.beads.count);
 const rates=new Set(),phases=new Set();for(let i=0;i<128;i++){rates.add(attribute.getZ(i).toFixed(3));phases.add(attribute.getX(i).toFixed(3));assert.ok(attribute.getZ(i)>=.68&&attribute.getZ(i)<=1.42);}
 assert.ok(rates.size>80&&phases.size>110);assert.deepEqual(beadBreathParameters(.3,.8,42),beadBreathParameters(.3,.8,42));assert.notDeepEqual(beadBreathParameters(.3,.8,42),beadBreathParameters(.3,.8,43));
 const individual=[];for(const time of [0,2,4,7,11]){
  const samples=ring.beadCoordinates.map(b=>beadBreathing(b.u,b.tubePhase,time,.14,8,42)),average=samples.reduce((a,b)=>a+b,0)/samples.length;
  assert.ok(Math.abs(average-1)<.015);assert.ok(Math.max(...samples)-Math.min(...samples)>.22);individual.push(samples[0]);
 }
 assert.ok(Math.max(...individual)-Math.min(...individual)>.05);
 const phasesBefore=Array.from(attribute.array);const visual=ring.getVisual();visual.twist=1.3;visual.ringRadius=2.1;ring.updateGeometry(visual,true);assert.deepEqual(Array.from(ring.sphereGeometry.getAttribute('aBreath').array),phasesBefore);
});

test('overflow cage continues the same world edges behind panels while excluding the complete WebGL rectangle',()=>{
 const createElementNS=document.createElementNS;
 document.createElementNS=(_namespace,name)=>({name,attributes:{},style:{},children:[],classList:{add(){}},setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},prepend(child){this.children.unshift(child);}});
 try{
  const {ring,visual}=fixture({w:406,h:217,scale:.74,depth:1.7,rotation:1.1});attachCage(ring);ring.cageMaterial=ring.cage.material;ring.updateCageBounds();ring.orbitState().zoom=2.5;ring.applyOrbitCamera();
  const workspace={children:['panel'],getBoundingClientRect:()=>({left:10,top:8}),prepend(child){this.children.unshift(child);}};ring.host={closest:()=>workspace,getBoundingClientRect:()=>({left:73,top:41})};ring.updateCageOverflow(visual);
  const {svg,path,hole}=ring.cageOverflow;assert.equal(workspace.children[0],svg);assert.ok(svg.style.cssText.includes('pointer-events:none'));assert.ok(svg.style.cssText.includes('z-index:0'));assert.equal(svg.attributes['aria-hidden'],'true');assert.equal(svg.style.left,'63px');assert.equal(svg.style.top,'33px');assert.equal(svg.attributes.viewBox,'0 0 406 217');assert.equal(hole.attributes['clip-rule'],'evenodd');assert.ok(hole.attributes.d.endsWith('M0,0H406V217H0Z'));
  const positions=ring.cage.geometry.attributes.position,projected=new THREE.Vector3().fromBufferAttribute(positions,0).applyMatrix4(ring.cage.matrixWorld).project(ring.camera),first=path.attributes.d.match(/^M([^,]+),([^L]+)/);assert.ok(Math.abs(Number(first[1])-(projected.x*.5+.5)*ring.size.w)<.001);assert.ok(Math.abs(Number(first[2])-(.5-projected.y*.5)*ring.size.h)<.001);assert.equal((path.attributes.d.match(/M/g)||[]).length,12);assert.equal((path.attributes.d.match(/L/g)||[]).length,12);
  ring.cage.visible=false;ring.updateCageOverflow(visual);assert.equal(svg.style.display,'none');
 }finally{document.createElementNS=createElementNS;}
});

test('particle arrival is the true ring origin through all ring/camera transforms, independent of crystal-cell animation',()=>{
 const {ring}=fixture({scale:.74,depth:1.8,rotation:1.1,tilt:1.2});ring.coreGroup=new THREE.Group();ring.coreGroup.position.set(.6,-.3,1.4);ring.ringGroup.add(ring.coreGroup);
 for(let i=0;i<20;i++){ring.orbitState().yaw=i*.7;ring.orbit.pitch=i*.43;ring.orbit.zoom=.5+(i%5)*.5;ring.ringGroup.rotation.set(i*.31,i*.29,i*.53);ring.applyOrbitCamera();const expected=project(ring,new THREE.Vector3()),actual=ring.projectCore();assert.ok(Math.hypot(actual.x-(expected.x-73),actual.y-(expected.y-41))<1e-8);}
});

test('particle depth handoff validates frames, preserves encoded color, crops exact coordinates and acknowledges only presentation',()=>{
 const {ring}=fixture({w:406,h:217,scale:.74});ring.applyOrbitCamera();ring.depthSupported=true;ring.postMaterial={uniforms:{particleEnabled:{value:0},particleSource:{value:null},particleRect:{value:new THREE.Vector4()},particleDepth:{value:1}}};
 const ack=[],missing=[];let current={canvas:{width:1260,height:585},width:840,height:390,pixelRatio:1.5,version:1,ring:{x:430,y:30,w:406,h:217},onPresented:version=>ack.push(version),onUnavailable:()=>missing.push(true)};ring.setParticleLayerProvider(()=>current);
 ring.prepareParticleLayer(100);assert.equal(ring.particleDepthReady,false);assert.deepEqual(ack,[]);assert.equal(ring.particleTexture.colorSpace,THREE.NoColorSpace);assert.equal(ring.particleTexture.premultiplyAlpha,true);assert.deepEqual(ring.postMaterial.uniforms.particleRect.value.toArray(),[430/840,30/390,406/840,217/390]);const origin=new THREE.Vector3().setFromMatrixPosition(ring.ringGroup.matrixWorld).project(ring.camera);assert.equal(ring.postMaterial.uniforms.particleDepth.value,origin.z*.5+.5);
 const textureVersion=ring.particleTexture.version;ring.prepareParticleLayer(116);assert.equal(ring.particleTexture.version,textureVersion);ring.presentParticleLayer();assert.equal(ring.particleDepthReady,true);assert.deepEqual(ack,[1]);current.version=2;ring.prepareParticleLayer(132);assert.ok(ring.particleTexture.version>textureVersion);assert.equal(ring.particlePresentedVersion,1);ring.presentParticleLayer();assert.equal(ring.particlePresentedVersion,2);
 ring.contextLost=true;ring.prepareParticleLayer(148);assert.equal(ring.particleDepthReady,false);assert.equal(ring.postMaterial.uniforms.particleEnabled.value,0);assert.equal(missing.length,1);
 ring.contextLost=false;current={...current,ring:{...current.ring,x:NaN}};assert.equal(ring.prepareParticleLayer(164),null);assert.equal(ring.postMaterial.uniforms.particleEnabled.value,0);
});

test('resizing the same particle canvas reallocates immutable texture storage in both directions',()=>{
 const {ring}=fixture();ring.applyOrbitCamera();ring.depthSupported=true;ring.postMaterial={uniforms:{particleEnabled:{value:0},particleSource:{value:null},particleRect:{value:new THREE.Vector4()},particleDepth:{value:1}}};
 const canvas={width:1260,height:585},layer={canvas,width:840,height:390,version:7,ring:{x:430,y:30,w:406,h:217}};
 ring.setParticleLayerProvider(()=>layer);ring.prepareParticleLayer(100);let previous=ring.particleTexture,disposed=0;
 for(const [width,height]of [[1800,1050],[585,1260],[1260,585]]){
  previous.addEventListener('dispose',()=>disposed++);canvas.width=width;canvas.height=height;
  ring.prepareParticleLayer(140);assert.notStrictEqual(ring.particleTexture,previous);assert.equal(ring.particleTexture.image,canvas);
  assert.equal(ring.particleTextureWidth,width);assert.equal(ring.particleTextureHeight,height);assert.equal(ring.particleTexture.colorSpace,THREE.NoColorSpace);assert.equal(ring.particleTexture.premultiplyAlpha,true);
  previous=ring.particleTexture;const version=previous.version;ring.prepareParticleLayer(150);assert.strictEqual(ring.particleTexture,previous);assert.equal(previous.version,version);
 }
 assert.equal(disposed,3);assert.equal(ring.particleTextureVersion,7);assert.equal(ring.postMaterial.uniforms.particleSource.value,previous);
});

test('Signal uses the shared orbital guides outside its bead lattice without changing camera fitting',()=>{
 const {ring,visual}=fixture({ringRadius:1.93,ringThickness:.4,scale:1.25,gridSpacing:.7,gridOpacity:.5});
 ring.orbits=new THREE.Group();ring.buildOrbits();ring.applyOrbitCamera();const distance=ring.cameraDistance;
 ring.updateOrbitGuides(visual,{reference:true},3,.1);assert.equal(ring.orbits.visible,true);assert.equal(ring.orbits.children.filter(x=>x.isLineLoop).length,7);
 assert.ok(ring.orbits.scale.x*2.45>(visual.ringRadius+visual.ringThickness)*visual.scale);assert.deepEqual(ring.orbits.position,ring.ringGroup.position);
 const before=ring.orbits.scale.x;visual.gridSpacing=1.8;ring.updateOrbitGuides(visual,{reference:true},3,.1);assert.ok(ring.orbits.scale.x>before);ring.applyOrbitCamera();assert.equal(ring.cameraDistance,distance);
 ring.updateOrbitGuides({...visual,gridOpacity:0},{reference:true},3,.1);assert.ok(ring.orbitMaterials.every(m=>m.opacity===0));
 ring.updateOrbitGuides(visual,{reference:false},3,.1);assert.equal(ring.orbits.scale.x,1.8);assert.deepEqual(ring.orbits.position.toArray(),[0,0,0]);
});

test('Canvas fallback paints the same particle pixels between actual rear and front bead depths at inverted views',()=>{
 const {ring,visual}=fixture({w:406,h:217});ring.fallback=true;ring.energy=1;ring.getActivity=()=>({voices:[]});ring.canvas.width=609;ring.canvas.height=326;
 const noop=()=>{},gradient={addColorStop:noop},events=[];ring.ctx=new Proxy({createRadialGradient:()=>gradient,arc:()=>events.push('bead'),drawImage:(...args)=>events.push(args)},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>{target[key]=value;return true;}});
 const canvas={width:1260,height:585};ring.particleLayer={canvas,width:840,height:390,ring:{x:430,y:30,w:406,h:217}};
 for(const [yaw,pitch]of [[0,0],[1.1,2.7],[-2.3,-1.9]]){events.length=0;Object.assign(ring.orbitState(),{yaw,pitch});ring.drawFallback(visual,{reference:true},{voices:[]},0);const position=events.findIndex(Array.isArray);assert.equal(position,ring.fallbackBeads.filter(bead=>bead.z<0).length);assert.equal(events.filter(x=>x==='bead').length,1600);assert.deepEqual(events[position],[canvas,645,45,609,325.5,0,0,406,217]);}
});
