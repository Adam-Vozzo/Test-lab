import * as THREE from '../vendor/three.module.min.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';

const TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
// Fit the entire mechanism at maximum size and motion once per aspect ratio.
// Keeping this envelope fixed avoids camera pumping as the metal vibrates.
function fitEnvelope(){
  const points=[],point=new THREE.Vector3(),euler=new THREE.Euler();
  for(const rx of [.0175,.1825])for(const ry of [-.66,-.14])for(const rz of [-.19,-.11]){
    euler.set(rx,ry,rz);
    for(let k=0;k<6;k++)for(let i=0;i<=32;i++){
      const u=i/32,angle=(u-.5)*TAU*1.12,bulge=Math.pow(Math.sin(u*Math.PI),.65),offset=(k-2.5)*.255,twist=angle*.47+k*.13;
      const cx=Math.sin(angle)*(.6+.22*bulge)+offset*(.65+.55*bulge),cy=(u-.5)*3.48,cz=Math.cos(angle)*(.64+.2*bulge)+offset*.16,half=(.105+.09*bulge)*1.18;
      for(const side of [-1,1])for(const ax of [-.19,.19])for(const az of [-.21,.21]){point.set(cx+Math.cos(twist)*half*side+ax*bulge,cy+Math.sin(twist)*half*side*.25,cz+Math.sin(twist)*half*side+az*bulge).applyEuler(euler);points.push(point.clone());}
    }
    for(const side of [-1,1]){const a=side*.5*TAU*1.12;for(const x of [-.7,.7])for(const y of [-.08,.08])for(const z of [-.12,.14]){point.set(Math.sin(a)*.6+x,side*1.77+y,Math.cos(a)*.64+z).applyEuler(euler);points.push(point.clone());}}
  }
  return points;
}

// Six folded reeds share their mechanical envelope, but move independently.
// The material is lit geometry, not a screen-space colour field.
export class RelayRenderer {
  constructor(host){
    this.available=false;this.disposed=false;this.size='';this.lastTime=0;
    this.fitPoints=fitEnvelope();this.profile=signalRenderProfile();this.gate=createFrameGate(this.profile.mobile?60:90);
    try{
      this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:!this.profile.mobile,premultipliedAlpha:true,powerPreference:'low-power'});
      this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
      this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.3;
      this.canvas=this.renderer.domElement;this.canvas.className='relay-metal';this.canvas.setAttribute('aria-hidden','true');this.canvas.style.cssText='position:absolute;pointer-events:none;z-index:1';host.append(this.canvas);
      this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(33,1,.1,50);this.camera.position.set(0,.12,8.7);
      this.group=new THREE.Group();this.group.rotation.set(.15,-.43,-.15);this.scene.add(this.group);
      this.scene.add(new THREE.HemisphereLight(0xd6e3ff,0x07090d,2.1));
      for(const [colour,power,x,y,z] of [[0xe7efff,4.6,-3,4,4],[0x8ca5e6,2.5,3,-2,2],[0xff7545,1.3,-4,-2,-2]]){const light=new THREE.DirectionalLight(colour,power);light.position.set(x,y,z);this.scene.add(light);}
      const faces=[];for(let i=0;i<6;i++){const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,64,64);g.addColorStop(0,'#020407');g.addColorStop(.22,'#18212d');g.addColorStop(.3,'#e1e7ea');g.addColorStop(.36,'#25354c');g.addColorStop(.65,'#030608');g.addColorStop(.79,i%2?'#596777':'#83b4cd');g.addColorStop(.84,'#d8d9d7');g.addColorStop(1,'#090a0e');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);faces.push(c);}
      this.env=new THREE.CubeTexture(faces);this.env.needsUpdate=true;this.env.colorSpace=THREE.SRGBColorSpace;this.scene.environment=this.env;
      this.reeds=[];this.resources=[];this.segments=66;
      for(let k=0;k<6;k++){
        const positions=new Float32Array((this.segments+1)*4*3),indices=[];
        for(let i=0;i<this.segments;i++){const j=i*4;indices.push(j,j+1,j+4,j+1,j+5,j+4,j+2,j+6,j+3,j+3,j+6,j+7,j,j+4,j+2,j+2,j+4,j+6,j+1,j+3,j+5,j+3,j+7,j+5);
        if(i===0)indices.push(0,2,1,1,2,3);if(i===this.segments-1){const e=(i+1)*4;indices.push(e,e+1,e+2,e+1,e+3,e+2);}}
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(indices);
        const material=new THREE.MeshPhysicalMaterial({color:0x62788f,metalness:.9,roughness:.23,side:THREE.DoubleSide,iridescence:.52,iridescenceIOR:1.34,iridescenceThicknessRange:[120,350],clearcoat:.65,clearcoatRoughness:.16});
        const mesh=new THREE.Mesh(geometry,material);this.group.add(mesh);
        const edgeGeometry=new THREE.BufferGeometry();edgeGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.segments*4*3),3).setUsage(THREE.DynamicDrawUsage));
        const edgeMaterial=new THREE.LineBasicMaterial({color:0x7e9cb2,transparent:true,opacity:.42});const edge=new THREE.LineSegments(edgeGeometry,edgeMaterial);this.group.add(edge);
        this.reeds.push({mesh,geometry,material,edgeGeometry,edgeMaterial,k});this.resources.push(geometry,material,edgeGeometry,edgeMaterial);
      }
      // A pair of machined terminal rails makes the six reeds a suspended body.
      this.retainerGroup=new THREE.Group();this.group.add(this.retainerGroup);
      const railMaterial=new THREE.MeshStandardMaterial({color:0x273239,metalness:.88,roughness:.3}),boltMaterial=new THREE.MeshStandardMaterial({color:0x88999f,metalness:.9,roughness:.22});
      this.resources.push(railMaterial,boltMaterial);
      for(const side of [-1,1]){
        const a=side*.5*TAU*1.12,cx=Math.sin(a)*.6,cy=side*1.77,cz=Math.cos(a)*.64;
        const railGeometry=new THREE.BoxGeometry(1.25,.1,.18),rail=new THREE.Mesh(railGeometry,railMaterial);rail.position.set(cx,cy,cz-.02);rail.rotation.y=-.07;this.retainerGroup.add(rail);this.resources.push(railGeometry);
        for(let k=0;k<6;k++){const geo=new THREE.CylinderGeometry(.035,.035,.035,8),bolt=new THREE.Mesh(geo,boltMaterial);bolt.rotation.x=Math.PI/2;bolt.position.set(cx+(k-2.5)*.166,cy,cz+.09);this.retainerGroup.add(bolt);this.resources.push(geo);}
      }
      this.available=true;
    }catch{this.destroy();this.disposed=false;}
  }
  render(rect,t,sound,appearance,activity,reducedMotion=false){
    if(!this.available||this.disposed)return false;
    const key=[Math.round(rect.w),Math.round(rect.h),window.devicePixelRatio].join(':');
    if(key!==this.size){this.size=key;const dpr=renderPixelRatio(rect.w,rect.h,window.devicePixelRatio||1,{maxDpr:1.6,maxPixels:this.profile.mobile?520000:950000});this.renderer.setPixelRatio(dpr);this.renderer.setSize(Math.max(1,rect.w),Math.max(1,rect.h),false);this.camera.aspect=rect.w/rect.h;this.camera.updateProjectionMatrix();const tan=Math.tan(this.camera.fov*Math.PI/360);this.camera.position.z=Math.max(...this.fitPoints.map(p=>p.z*1.18+Math.max(Math.abs(p.x)*1.18/(tan*this.camera.aspect),Math.abs(p.y*1.18-.12)/tan)*1.045));this.gate.reset();}
    this.canvas.style.left=rect.x+'px';this.canvas.style.top=rect.y+'px';this.canvas.style.width=rect.w+'px';this.canvas.style.height=rect.h+'px';
    if(!this.gate.due(t*1000))return true;
    const motion=reducedMotion?0:appearance.idleMotion,now=reducedMotion?0:t;
    const strength=clamp(activity,0,1.5),material=clamp(sound.material),damping=clamp(sound.damping),size=appearance.chamberScale||1;
    this.group.scale.setScalar(size);
    this.group.rotation.x=.1+Math.sin(now*.17)*.055*motion;
    this.group.rotation.y=-.43+Math.sin(now*.12)*.11*motion+(material-.32)*.18;
    this.group.rotation.z=-.15+Math.sin(now*.14)*.025*motion;

    for(const reed of this.reeds){const {k,geometry,material:mat,edgeGeometry,edgeMaterial}=reed,position=geometry.attributes.position.array,edge=edgeGeometry.attributes.position.array;
      const offset=(k-2.5)*.255,phase=k*1.83,amp=(.012*motion+strength*.11*(1-damping*.65))*Math.sin(now*(3.6+k*.14)+phase);
      for(let i=0;i<=this.segments;i++){
        const u=i/this.segments,angle=(u-.5)*TAU*1.12,bulge=Math.pow(Math.sin(u*Math.PI),.65),cx=Math.sin(angle)*(.6+material*.22*bulge)+offset*(.65+.55*bulge),cy=(u-.5)*3.48,cz=Math.cos(angle)*(.64+material*.2*bulge)+Math.sin(u*Math.PI*2+phase)*amp;
        const twist=angle*.47+k*.13,half=(.105+.09*bulge)*(1+material*.18),motionX=Math.sin(u*Math.PI*(2+k%3)+now*6+phase)*amp*bulge;
        for(let side=0;side<2;side++){const s=side?1:-1,p=(i*4+side)*3;position[p]=cx+Math.cos(twist)*half*s+motionX;position[p+1]=cy+Math.sin(twist)*half*s*.25;position[p+2]=cz+Math.sin(twist)*half*s+offset*.16;position[p+6]=position[p];position[p+7]=position[p+1];position[p+8]=position[p+2]-.028;}
      }
      let e=0;for(let i=0;i<this.segments;i++)for(let side=0;side<2;side++){const a=(i*4+side)*3,b=((i+1)*4+side)*3;for(let q=0;q<3;q++)edge[e++]=position[a+q];for(let q=0;q<3;q++)edge[e++]=position[b+q];}
      geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();edgeGeometry.attributes.position.needsUpdate=true;
      mat.iridescence=appearance.iridescence;mat.roughness=appearance.metalRoughness;mat.envMapIntensity=.68+appearance.metalLight*.75;mat.emissive.set(appearance.signalColour);mat.emissiveIntensity=strength*.035*(1+k*.08);
      edgeMaterial.opacity=appearance.wireContrast*.55;edgeMaterial.color.set(appearance.wireColour);
    }
    this.renderer.render(this.scene,this.camera);return true;
  }
  destroy(){
    if(this.disposed)return;this.disposed=true;this.available=false;
    for(const r of this.resources||[])r.dispose();this.env?.dispose();this.renderer?.dispose();this.renderer?.forceContextLoss();this.canvas?.remove();
  }
}
