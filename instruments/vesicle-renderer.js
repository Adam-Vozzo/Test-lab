import * as THREE from '../vendor/three.module.min.js';
import {renderPixelRatio} from '../render-performance.js';

const shellVertex=`varying vec3 n;varying vec3 eye;varying vec3 p;void main(){vec4 v=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-v.xyz);p=position;gl_Position=projectionMatrix*v;}`;
const shellFragment=`uniform vec3 colour;uniform float opacity;uniform float time;varying vec3 n;varying vec3 eye;varying vec3 p;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),3.);float shine=pow(max(0.,dot(normalize(n),normalize(vec3(-.6,.8,1.)))),24.);float caustic=pow(.5+.5*sin(p.y*15.+sin(p.x*9.+time*.35)*2.),12.)*.035;gl_FragColor=vec4(mix(colour,vec3(.94,1.,1.),shine),opacity*(.018+rim*.57+shine*.33+caustic));}`;

export class VesicleRenderer{
 constructor(host,{mobile=false}={}){
  this.mobile=mobile;this.ready=false;this.resources=[];this.fins=[];
  try{
   this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:!mobile,powerPreference:'high-performance'});this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
   this.el=this.renderer.domElement;this.el.style.cssText='position:absolute;pointer-events:none;z-index:1;';this.el.setAttribute('aria-hidden','true');host.append(this.el);
   this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(34,1,.1,30);this.camera.position.set(0,0,5.8);
   this.scene.add(new THREE.HemisphereLight('#d7ffff','#12336c',2.2));const key=new THREE.DirectionalLight('#dcffff',4);key.position.set(-3,4,5);this.scene.add(key);const edge=new THREE.DirectionalLight('#1aa7ff',3);edge.position.set(3,-2,-2);this.scene.add(edge);
   this.root=new THREE.Group();this.scene.add(this.root);this.creature=new THREE.Group();this.root.add(this.creature);this.creature.scale.setScalar(1.15);
   this.skin=new THREE.MeshPhysicalMaterial({color:'#a3dce8',roughness:.28,metalness:.04,clearcoat:.9,clearcoatRoughness:.18});
   this.finMaterial=new THREE.MeshPhysicalMaterial({color:'#54b5e1',roughness:.34,side:THREE.DoubleSide,transparent:true,opacity:.72});
   this.dark=new THREE.MeshPhysicalMaterial({color:'#081731',roughness:.18,clearcoat:1});this.white=new THREE.MeshBasicMaterial({color:'#f2ffff'});this.vein=new THREE.MeshBasicMaterial({color:'#b8f4f3',transparent:true,opacity:.65});
   this.resources.push(this.skin,this.finMaterial,this.dark,this.white,this.vein);
   const sphere=new THREE.SphereGeometry(1,32,20);this.resources.push(sphere);
   const orb=(group,pos,scale,material=this.skin)=>{const mesh=new THREE.Mesh(sphere,material);mesh.position.set(...pos);mesh.scale.set(...scale);group.add(mesh);return mesh;};
   const tube=(points,r,material=this.skin)=>{const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),40,r,7,false);this.resources.push(geometry);const mesh=new THREE.Mesh(geometry,material);this.creature.add(mesh);return mesh;};
   this.body=orb(this.creature,[0,-.18,0],[.29,.43,.26]);this.head=orb(this.creature,[0,.38,.10],[.45,.38,.33]);
   orb(this.creature,[0,.18,.33],[.22,.16,.12]);
   this.eyes=[];
   for(const side of[-1,1]){
    const eye=new THREE.Group();eye.position.set(side*.19,.42,.39);eye.rotation.y=side*.18;this.creature.add(eye);orb(eye,[0,0,0],[.073,.105,.042],this.dark);orb(eye,[-.019,.035,.035],[.022,.031,.012],this.white);orb(eye,[.022,-.028,.04],[.009,.012,.007],this.white);this.eyes.push(eye);
    tube([[side*.21,-.05,.04],[side*.34,-.13,.21],[side*.34,.03,.35]],.065);for(let j=0;j<3;j++)tube([[side*.34,.03,.35],[side*(.31+j*.035),.13+(j===1?.04:0),.38]],.019);
    const foot=orb(this.creature,[side*.25,-.47,.15],[.13,.22,.12]);foot.rotation.z=side*.65;
    const gill=new THREE.Group();gill.position.set(side*.34,.42,-.04);this.creature.add(gill);this.fins.push(gill);
    for(let k=0;k<3;k++){
     const g=new THREE.BufferGeometry(),angle=(k-1)*.5,ex=side*(.25+Math.cos(angle)*.11),ey=Math.sin(angle)*.45;g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,ex,ey+.10,-.04,ex*.83,ey-.06,.025],3));g.computeVertexNormals();this.resources.push(g);gill.add(new THREE.Mesh(g,this.finMaterial));
     const lineGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(ex*.85,ey,0)]);const material=new THREE.LineBasicMaterial({color:'#a9eaf4',transparent:true,opacity:.62});this.resources.push(lineGeometry,material);gill.add(new THREE.Line(lineGeometry,material));
    }
   }
   this.tail=tube([[0,-.45,-.08],[.15,-.72,-.13],[.62,-.65,-.03],[.73,-.15,.07],[.55,.03,.12]],.065);
   this.mouth=orb(this.creature,[0,.18,.435],[.026,.018,.01],this.dark);
   this.eggGeometry=new THREE.SphereGeometry(1,48,32);const pos=this.eggGeometry.attributes.position;for(let i=0;i<pos.count;i++){const y=pos.getY(i),taper=1-y*.12;pos.setXYZ(i,pos.getX(i)*1.05*taper,y*1.37,pos.getZ(i)*1.05*taper);}this.eggGeometry.computeVertexNormals();this.resources.push(this.eggGeometry);
   this.shell=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.FrontSide,uniforms:{colour:{value:new THREE.Color('#75cbea')},opacity:{value:.85},time:{value:0}},vertexShader:shellVertex,fragmentShader:shellFragment});this.resources.push(this.shell);const egg=new THREE.Mesh(this.eggGeometry,this.shell);egg.renderOrder=4;this.root.add(egg);
   // Small suspended nutrient particles remain inside the egg volume.
   const pp=[];for(let i=0;i<72;i++){const a=i*2.399,r=.25+(i%9)/9*.6,y=((i*17)%71)/71*2.2-1.1;pp.push(Math.cos(a)*r,y,Math.sin(a)*r);}
   const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(pp,3));const pm=new THREE.PointsMaterial({color:'#c8f9ff',size:.012,transparent:true,opacity:.37,depthWrite:false});this.resources.push(pg,pm);this.dust=new THREE.Points(pg,pm);this.root.add(this.dust);this.ready=true;
  }catch{this.renderer?.dispose();this.el?.remove();this.ready=false;}
 }
 resize(rect){if(!this.ready)return;const d=renderPixelRatio(rect.w,rect.h,devicePixelRatio||1,{maxDpr:1.5,maxPixels:this.mobile?550000:1000000});const key=[rect.w,rect.h,d].join(':');if(key!==this.sizeKey){this.sizeKey=key;this.renderer.setPixelRatio(d);this.renderer.setSize(rect.w,rect.h,false);this.camera.aspect=rect.w/rect.h;this.camera.position.z=this.camera.aspect<.8?6.7:5.8;this.camera.updateProjectionMatrix();}Object.assign(this.el.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});}
 draw(t,v,pose,level,reduced){if(!this.ready)return;const motion=reduced?0:v.floatMotion,clock=reduced?0:t;this.skin.color.set(v.creatureColour);this.finMaterial.color.set(v.finColour);this.shell.uniforms.colour.value.set(v.shellColour);this.shell.uniforms.opacity.value=v.shellOpacity;this.shell.uniforms.time.value=clock;this.root.rotation.set(pose.pitch,pose.yaw,0);this.root.scale.setScalar(v.eggScale);this.creature.position.y=Math.sin(clock*.72)*.055*motion;this.creature.rotation.z=Math.sin(clock*.53)*.07*motion;this.creature.rotation.y=Math.sin(clock*.37)*.16*motion;this.body.scale.y=.43*(1+Math.sin(clock*1.35)*.018*motion+level*.05);this.head.rotation.z=Math.sin(clock*.8)*.025*motion;this.tail.rotation.y=Math.sin(clock*.66)*.08*motion;this.fins.forEach((f,i)=>f.rotation.y=Math.sin(clock*1.6+i)*.15*motion);const blink=!reduced&&Math.sin(clock*.53)> .997?.17:1;this.eyes.forEach(e=>e.scale.y=blink);this.mouth.scale.y=.018*(1+level*1.5);this.dust.rotation.y=clock*.035*motion;this.renderer.render(this.scene,this.camera);}
 dispose(){for(const resource of this.resources)resource.dispose?.();this.renderer?.dispose();this.renderer?.forceContextLoss();this.el?.remove();this.resources.length=0;}
}
