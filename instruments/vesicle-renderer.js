import * as THREE from '../vendor/three.module.min.js';
import {renderPixelRatio} from '../render-performance.js';
const shellVertex=`varying vec3 n;varying vec3 eye;varying vec3 p;void main(){vec4 v=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-v.xyz);p=position;gl_Position=projectionMatrix*v;}`;
const shellFragment=`uniform vec3 colour;uniform float opacity;uniform float time;varying vec3 n;varying vec3 eye;varying vec3 p;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),3.5);float s=pow(max(0.,dot(normalize(n),normalize(vec3(-.6,.8,1.)))),44.);float bands=pow(.5+.5*sin(p.y*8.+sin(p.x*5.+time*.15)),18.)*.04;gl_FragColor=vec4(mix(colour,vec3(.85,1.,1.),s),opacity*(.004+rim*.55+s*.24+bands*rim));}`;

export class VesicleRenderer {
 constructor(host,{mobile=false}={}) {
  this.mobile=mobile;this.ready=false;this.resources=[];this.fins=[];this.tendrils=[];
  try {
   this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:!mobile,powerPreference:'high-performance'});
   this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
   this.el=this.renderer.domElement;this.el.style.cssText='position:absolute;pointer-events:none;z-index:1;';this.el.setAttribute('aria-hidden','true');host.append(this.el);
   this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(34,1,.1,30);this.camera.position.set(0,0,5.8);
   this.scene.add(new THREE.HemisphereLight('#b6e8ff','#301e57',1.25));
   for(const [colour,intensity,position]of [['#eaffed',3.1,[-3,4,4]],['#44caff',4,[3,-1,-2]],['#ff7eb7',1.5,[-3,-2,-1]]]){const l=new THREE.DirectionalLight(colour,intensity);l.position.set(...position);this.scene.add(l);}
   this.root=new THREE.Group();this.scene.add(this.root);this.creature=new THREE.Group();this.root.add(this.creature);
   const keep=x=>(this.resources.push(x),x);
   this.skin=keep(new THREE.MeshPhysicalMaterial({color:'#80bdc9',roughness:.29,metalness:.15,clearcoat:.85,clearcoatRoughness:.2,iridescence:.65,iridescenceIOR:1.35,iridescenceThicknessRange:[180,420]}));
   // Pigment flecks follow the actual sculpture, rather than a flat screen texture.
   this.skin.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 tissue;').replace('#include <begin_vertex>','#include <begin_vertex>\ntissue=position;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 tissue;').replace('#include <color_fragment>',`#include <color_fragment>
    float folds=sin(tissue.y*38.+sin(tissue.x*21.)*1.5)*sin(tissue.z*34.+tissue.x*11.);float pores=pow(max(0.,sin(tissue.x*91.)*sin(tissue.y*77.)*sin(tissue.z*83.)),7.);diffuseColor.rgb*=.86+folds*.07;diffuseColor.rgb+=vec3(.16,.43,.39)*pores;`);};
   this.finMaterial=keep(new THREE.MeshPhysicalMaterial({color:'#67a9da',roughness:.32,metalness:.12,side:THREE.DoubleSide,transparent:true,opacity:.64,depthWrite:false,iridescence:1,iridescenceThicknessRange:[180,490]}));
   this.dark=keep(new THREE.MeshPhysicalMaterial({color:'#050d24',roughness:.1,metalness:.3,clearcoat:1}));
   this.iris=keep(new THREE.MeshPhysicalMaterial({color:'#1e7b93',emissive:'#07616f',emissiveIntensity:.45,roughness:.23,metalness:.35}));
   this.light=keep(new THREE.MeshBasicMaterial({color:'#a6ffe4',transparent:true,opacity:.8}));
   const sphere=keep(new THREE.SphereGeometry(1,40,28));
   const orb=(parent,pos,scale,mat=this.skin)=>{const m=new THREE.Mesh(sphere,mat);m.position.set(...pos);m.scale.set(...scale);parent.add(m);return m;};
   const curve=pts=>new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p)));
   const tube=(parent,pts,r,mat=this.skin)=>{const g=keep(new THREE.TubeGeometry(curve(pts),64,r,8,false)),m=new THREE.Mesh(g,mat);parent.add(m);return m;};
   // One continuous tapered loft joins the belly, folded caudal peduncle and curled tail.
   const bodyCurve=curve([[0,.57,0],[-.06,.31,.025],[.035,-.02,0],[.12,-.35,-.02],[.02,-.64,.01],[-.35,-.78,.03],[-.66,-.56,.08],[-.65,-.23,.11],[-.47,-.09,.13]]);
   const frames=bodyCurve.computeFrenetFrames(104,false),verts=[],indices=[];
   for(let i=0;i<=104;i++){const f=i/104,p=bodyCurve.getPointAt(f),r=(.215*Math.exp(-f*f*14)+.058)*(1-Math.pow(f,2.4))+.003;for(let j=0;j<=32;j++){const a=j/32*Math.PI*2,n=frames.normals[i],b=frames.binormals[i],rr=r*(1+.025*Math.sin(a*6+f*30));verts.push(p.x+rr*(Math.cos(a)*n.x+Math.sin(a)*b.x),p.y+rr*(Math.cos(a)*n.y+Math.sin(a)*b.y),p.z+rr*(Math.cos(a)*n.z+Math.sin(a)*b.z)*.84);if(i<104&&j<32){const k=i*33+j;indices.push(k,k+33,k+1,k+1,k+33,k+34);}}}
   const bg=keep(new THREE.BufferGeometry());bg.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));bg.setIndex(indices);bg.computeVertexNormals();this.body=new THREE.Mesh(bg,this.skin);this.creature.add(this.body);
   this.head=new THREE.Group();this.head.position.set(-.025,.44,.035);this.head.rotation.z=-.11;this.creature.add(this.head);
   const hg=keep(new THREE.SphereGeometry(1,52,36)),hp=hg.attributes.position;for(let i=0;i<hp.count;i++){const y=hp.getY(i),x=hp.getX(i),z=hp.getZ(i);hp.setXYZ(i,x*.335*(1-.18*Math.max(0,-y)),y*.285,z*.255+.045*(1-y*y));}hg.computeVertexNormals();this.head.add(new THREE.Mesh(hg,this.skin));
   this.eyes=[];for(const s of [-1,1]){const eye=new THREE.Group();eye.position.set(s*.192,.035,.229);eye.rotation.z=s*-.22;eye.rotation.y=s*.35;this.head.add(eye);orb(eye,[0,0,0],[.092,.108,.045],this.skin);orb(eye,[0,0,.026],[.073,.086,.04],this.dark);orb(eye,[0,-.004,.057],[.044,.061,.017],this.iris);orb(eye,[0,.002,.069],[.027,.05,.009],this.dark);orb(eye,[-.02,.029,.075],[.013,.018,.005],this.light);this.eyes.push(eye);}
   this.mouth=orb(this.head,[0,-.102,.273],[.021,.012,.008],this.dark);
   // Broad ribbed gill sails: curved membranes with fine branching anatomical veins.
   const membrane=(parent,s,phase,base,span,height)=>{const sail=new THREE.Group();parent.add(sail);parent=sail;const g=new THREE.BufferGeometry(),p=[],idx=[];for(let i=0;i<=28;i++){const u=i/28;for(let j=0;j<=10;j++){const v=j/10,bend=Math.sin(u*Math.PI);p.push(base[0]+s*(u*span),base[1]+u*height+(v-.5)*Math.sin(Math.PI*u)*(.38+.08*Math.sin(u*9+phase)),base[2]+Math.sin(u*3+phase)*.12+(v-.5)*bend*.2);if(i<28&&j<10){const k=i*11+j;idx.push(k,k+11,k+1,k+1,k+11,k+12);}}}g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();keep(g);const mesh=new THREE.Mesh(g,this.finMaterial);parent.add(mesh);this.fins.push({mesh:sail,phase});
    for(let k=1;k<12;k++){const u=k/13,pts=[];for(let j=0;j<=14;j++){const f=j/14,uu=u*f,v=.5+(k%2?1:-1)*.48*f;pts.push([base[0]+s*uu*span,base[1]+uu*height+(v-.5)*Math.sin(Math.PI*uu)*(.38+.08*Math.sin(uu*9+phase)),base[2]+Math.sin(uu*3+phase)*.12+(v-.5)*Math.sin(Math.PI*uu)*.2+.003]);}tube(parent,pts,.0025,this.light);}
   };
   // Upper sails and antennae curl inward beneath the narrower crown. Keep the body
   // at full scale; the vertex regression includes all independent motion extrema.
   for(const s of [-1,1]){const gill=new THREE.Group();gill.position.set(s*.21,.49,-.045);gill.rotation.z=s*.12;this.creature.add(gill);this.tendrils.push(gill);membrane(gill,s,s,[0,0,0],.43,.20);membrane(gill,s,2+s,[0,-.04,-.04],.47,-.18);for(let k=0;k<5;k++){const a=(k-2)*.16;tube(gill,[[0,0,.02],[s*.19,.08+a*.8,.04],[s*.32,.10+a*.5,.07],[s*.26,.18+a*.35,.08]],.004,this.light);}
    const arm=new THREE.Group();arm.position.set(s*.12,-.08,.07);arm.rotation.z=s*-.3;this.creature.add(arm);membrane(arm,s,1+s,[0,0,0],.33,-.34);tube(arm,[[0,0,0],[s*.15,-.17,.05],[s*.31,-.32,.02]],.018);
   }
   // Bioluminescent lateral organs and a translucent dorsal ruff articulate the curled silhouette.
   for(let i=0;i<21;i++){const f=.12+i*.032,p=bodyCurve.getPointAt(f);for(const s of[-1,1])orb(this.creature,[p.x+s*(.13*(1-f)),p.y,p.z+.075*(1-f)],[.009*(1-f)+.002,.016*(1-f)+.003,.006],this.light);}
   const eggG=keep(new THREE.SphereGeometry(1,64,40)),ep=eggG.attributes.position;for(let i=0;i<ep.count;i++){const y=ep.getY(i),taper=1-y*.12;ep.setXYZ(i,ep.getX(i)*1.02*taper,y*1.35,ep.getZ(i)*1.02*taper);}eggG.computeVertexNormals();
   this.shell=keep(new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.FrontSide,uniforms:{colour:{value:new THREE.Color('#75cbea')},opacity:{value:.85},time:{value:0}},vertexShader:shellVertex,fragmentShader:shellFragment}));const egg=new THREE.Mesh(eggG,this.shell);egg.renderOrder=5;this.root.add(egg);
   // Nutrient motes use the same tapered cross-section as the shell at their height.
   const pp=[];for(let i=0;i<150;i++){const a=i*2.399,y=((i*17)%149)/149*2.2-1.1,yn=y/1.35,r=(.15+(i%9)/9*.68)*1.02*(1-yn*.12)*Math.sqrt(1-yn*yn);pp.push(Math.cos(a)*r,y,Math.sin(a)*r);}const pg=keep(new THREE.BufferGeometry());pg.setAttribute('position',new THREE.Float32BufferAttribute(pp,3));const pm=keep(new THREE.PointsMaterial({color:'#b8f3de',size:.008,transparent:true,opacity:.45,depthWrite:false}));this.dust=new THREE.Points(pg,pm);this.root.add(this.dust);this.ready=true;
  }catch(error){console.warn('Vesicle WebGL fallback',error);this.renderer?.dispose();this.el?.remove();this.ready=false;}
 }
 resize(rect){if(!this.ready)return;const d=renderPixelRatio(rect.w,rect.h,devicePixelRatio||1,{maxDpr:1.5,maxPixels:this.mobile?550000:1000000}),key=[rect.w,rect.h,d].join(':');if(key!==this.sizeKey){this.sizeKey=key;this.renderer.setPixelRatio(d);this.renderer.setSize(rect.w,rect.h,false);this.camera.aspect=rect.w/rect.h;this.camera.position.z=1.37*1.15/Math.sin(Math.atan(Math.tan(17*Math.PI/180)*Math.min(1,this.camera.aspect)))*1.025;this.camera.updateProjectionMatrix();}Object.assign(this.el.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});}
 draw(t,v,pose,level,reduced){if(!this.ready)return;const motion=reduced?0:v.floatMotion,clock=reduced?0:t;this.skin.color.set(v.creatureColour);this.finMaterial.color.set(v.finColour);this.finMaterial.opacity=.58+level*.16;this.iris.emissiveIntensity=.4+level*1.4;this.shell.uniforms.colour.value.set(v.shellColour);this.shell.uniforms.opacity.value=v.shellOpacity;this.shell.uniforms.time.value=clock;this.root.rotation.set(pose.pitch,pose.yaw,0);this.root.scale.setScalar(v.eggScale);this.creature.position.y=Math.sin(clock*.72)*.04*motion;this.creature.rotation.z=Math.sin(clock*.43)*.06*motion;this.creature.rotation.y=Math.sin(clock*.29)*.2*motion;this.creature.scale.setScalar(1+level*.035);this.head.rotation.z=-.11+Math.sin(clock*.8)*.025*motion;for(const f of this.fins){f.mesh.rotation.y=Math.sin(clock*1.8+f.phase)*.11*motion*(1+level);f.mesh.rotation.x=Math.sin(clock*.9+f.phase)*.045*motion;}this.tendrils.forEach((g,i)=>g.rotation.y=Math.sin(clock*1.1+i)*.13*motion);const blink=!reduced&&Math.sin(clock*.51)>.998?.2:1;this.eyes.forEach(e=>e.scale.y=blink);this.mouth.scale.y=.012*(1+level*2);this.light.opacity=.65+level*.35;this.dust.rotation.y=clock*.035*motion;this.renderer.render(this.scene,this.camera);}
 dispose(){for(const resource of this.resources)resource.dispose?.();this.renderer?.dispose();this.renderer?.forceContextLoss();this.el?.remove();this.resources.length=0;}
}
