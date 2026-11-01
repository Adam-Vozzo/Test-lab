import * as THREE from './vendor/three.module.min.js';
const UI_FONT = getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim() || 'monospace';

const TAU = Math.PI * 2;
// Peak expansion: voice .12 + reactive wave .16 + ambient breath .25.
const MAX_BEAD_EXPANSION = 1.53;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const value = (o, k, d, a = -Infinity, b = Infinity) => clamp(Number.isFinite(+o[k]) ? +o[k] : d, a, b);
function rng(seed) { let n = seed | 0; return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const markerTime=(a,t,rate=.35)=>a.time>0&&Number.isFinite(a.lfoPhase)?a.lfoPhase*TAU:t*rate*TAU;
function color(input, fallback) { try { return new THREE.Color(input || fallback); } catch { return new THREE.Color(fallback); } }
export function sectorEnvelope(angle,envelopes){const u=((angle/TAU*8)%8+8)%8,index=Math.floor(u),t=u-index,s=t*t*(3-2*t);return(Number(envelopes[index])||0)*(1-s)+(Number(envelopes[(index+1)%8])||0)*s;}
export function beadBreathParameters(u,w,seed=42){const hash=k=>{const n=Math.sin(u*127.1+w*311.7+seed*19.19+k*74.7)*43758.5453123;return n-Math.floor(n);};return[hash(1)*TAU,hash(2)*TAU,.68+hash(3)*.74];}
export function beadBreathing(u,w,time,amount=.14,rate=8,seed=42){const [a,b,speed]=beadBreathParameters(u,w,seed),phase=time*rate*TAU/60*speed;return 1+amount*(.65*Math.sin(phase+a)+.35*Math.sin(phase*.61+b));}
const zoomClearance=zoom=>1+.12*(2.5/clamp(Number.isFinite(zoom)?zoom:1,.5,2.5)-1);
const sizeHeadroom=scale=>Math.pow(Math.max(1,1.25/scale),.35);


const postVertex = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const blurFragment = `
  varying vec2 vUv; uniform sampler2D source; uniform vec2 direction; uniform float threshold;
  vec3 sampleAt(vec2 uv) { vec3 c=texture2D(source,uv).rgb; return c*max(0.,1.-threshold/max(.001,max(c.r,max(c.g,c.b)))); }
  void main(){vec3 c=sampleAt(vUv)*.227027;c+=sampleAt(vUv+direction*1.384615)*.316216;c+=sampleAt(vUv-direction*1.384615)*.316216;c+=sampleAt(vUv+direction*3.230769)*.070270;c+=sampleAt(vUv-direction*3.230769)*.070270;gl_FragColor=vec4(c,1.);}`;
const finishFragment = `
  varying vec2 vUv; uniform sampler2D source; uniform sampler2D bloom; uniform vec2 resolution;
  uniform float glow, grain, vignette, contrast, saturation, hue, phase, blur, scanlines, fringe, exposure, temperature, tint;
  uniform vec3 background; uniform sampler2D particleSource, sceneDepth; uniform vec4 particleRect; uniform float particleDepth, particleEnabled;
  vec3 rotateHue(vec3 c,float angle){vec3 k=normalize(vec3(1.));return c*cos(angle)+cross(k,c)*sin(angle)+k*dot(k,c)*(1.-cos(angle));}
  vec3 sceneColor(vec2 uv){vec4 texel=texture2D(source,uv);return texel.rgb/max(texel.a,.001);}
  void main(){
    vec2 px=1./resolution;vec4 raw=texture2D(source,vUv);vec3 c=raw.rgb/max(raw.a,.001);
    if(blur>.001){vec2 d=px*blur*4.;c=mix(c,(sceneColor(vUv+vec2(d.x,0.))+sceneColor(vUv-vec2(d.x,0.))+sceneColor(vUv+vec2(0.,d.y))+sceneColor(vUv-vec2(0.,d.y)))*.25,blur*.65);}
    if(fringe>.001){vec2 off=(vUv-.5)*fringe*.004;c.r=sceneColor(vUv+off).r;c.b=sceneColor(vUv-off).b;}
    vec3 bloomColor=texture2D(bloom,vUv).rgb*glow*1.7;c+=bloomColor;
    float lum=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(lum),c,saturation);c=rotateHue(c,hue);c=(c-.18)*contrast+.18;
    c*=vec3(1.+temperature*.18+tint*.07,1.-tint*.09,1.-temperature*.18+tint*.07);
    c=max(c*exposure,vec3(0.));c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);c=pow(c,vec3(1./2.2));
    float coverage=max(raw.a,clamp(max(bloomColor.r,max(bloomColor.g,bloomColor.b))*2.,0.,1.));
    float edge=length((vUv-.5)*vec2(1.,.84));c*=1.-smoothstep(.2,.76,edge)*vignette*.75;
    float noise=fract(sin(dot(floor(vUv*resolution),vec2(12.9898,78.233))+phase)*43758.5453)-.5;
    c+=noise*grain*.13;c*=1.-scanlines*.08*(.5+.5*sin(vUv.y*resolution.y*3.14159));
    // The browser's transparent canvas and the Canvas2D particle upload both
    // use premultiplied alpha. Keep that representation at every boundary;
    // straight RGB in a nearly transparent bloom texel must never become a halo.
    coverage=clamp(coverage,0.,1.);vec3 premultiplied=clamp(c,0.,1.)*coverage;
    if(particleEnabled>.5){
      vec2 fieldUv=vec2(particleRect.x+vUv.x*particleRect.z,1.-particleRect.y-(1.-vUv.y)*particleRect.w);
      vec4 field=texture2D(particleSource,fieldUv);
      field*=step(particleDepth-.000001,texture2D(sceneDepth,vUv).r);
      premultiplied=field.rgb+premultiplied*(1.-field.a);
      coverage=field.a+coverage*(1.-field.a);
    }
    gl_FragColor=vec4(premultiplied,coverage);
  }`;

/** A self-contained, pointer-transparent artwork layer for the playable voice ring. */
export class RingScene {
  constructor(host, { getVisual = () => ({}), getPalette = () => ({}), getActivity = () => ({}), cameraView = {}, onCameraChange = () => {} } = {}) {
    this.host = host; this.getVisual = getVisual; this.getPalette = getPalette; this.getActivity = getActivity;this.onCameraChange=onCameraChange;
    this.orbit={yaw:value(cameraView,'yaw',0),pitch:value(cameraView,'pitch',0),zoom:value(cameraView,'zoom',1,.5,2.5),velocityYaw:0,velocityPitch:0,drag:null};
    this.disposed = false; this.time = 0; this.energy = 0; this.frame = 0; this.lastFrame = performance.now(); this.size = { w: 1, h: 1 };
    this.canvas = document.createElement('canvas'); this.canvas.className = 'ring-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    this.canvas.setAttribute('aria-hidden', 'true'); host.prepend(this.canvas);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    try { this.setupWebGL(); } catch (error) {
      console.warn('Using the 2D voice-ring renderer.', error.message);
      this.renderer?.dispose(); this.canvas.remove(); this.canvas = document.createElement('canvas'); this.canvas.className = 'ring-canvas';
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;'; this.canvas.setAttribute('aria-hidden','true'); host.prepend(this.canvas);
      this.ctx = this.canvas.getContext('2d'); this.fallback = true;
    }
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.tick = this.tick.bind(this); this.raf = requestAnimationFrame(this.tick);
  }

  setupWebGL() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene(); this.renderer.setClearColor(0,0);
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 60); this.camera.position.set(0, .1, 8.3);
    this.ringGroup = new THREE.Group(); this.scene.add(this.ringGroup);
    this.orbits = new THREE.Group(); this.scene.add(this.orbits);
    this.ambient = new THREE.HemisphereLight('#e5ddce', '#101a19', 1.8); this.scene.add(this.ambient);
    this.keyLight = new THREE.DirectionalLight('#ffe2ba', 2.1); this.keyLight.position.set(-3, 4, 5); this.scene.add(this.keyLight);
    this.fillLight = new THREE.DirectionalLight('#6baca3', .85); this.fillLight.position.set(4, -1, 2); this.scene.add(this.fillLight);
    this.rimLight = new THREE.PointLight('#ffb56e', 42, 14, 2); this.rimLight.position.set(-3, 2, -.2); this.scene.add(this.rimLight);
    this.environment = this.makeEnvironment(); this.scene.environment = this.environment.texture;
    this.material = new THREE.MeshPhysicalMaterial({ color: '#fff6e1', metalness: .75, roughness: .3, clearcoat: .22, clearcoatRoughness: .14, envMapIntensity: 1.25 });
    this.rippleUniforms = { uVoices: { value: Array(8).fill(0) }, uTouches: { value: Array.from({length:8},()=>new THREE.Vector4(0,0,0,24)) }, uViewport:{value:new THREE.Vector2(1,1)},uTouchLocal:{value:Array.from({length:8},()=>new THREE.Vector4(0,0,0,.65))},uBreath:{value:.14},uBreathRate:{value:8},uBreathTime:{value:0}, uReference: { value: 0 }, uTime: { value: 0 }, uEnergy: { value: 0 }, uTurbulence: { value: .2 }, uNote: { value: 0 }, uSignalColor: { value: new THREE.Color('#ffc58b') } };
    this.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.rippleUniforms);
      shader.vertexShader = 'uniform float uTime; uniform float uEnergy; uniform float uTurbulence; uniform float uVoices[8]; uniform vec4 uTouches[8]; uniform vec2 uViewport; uniform vec4 uTouchLocal[8]; uniform float uBreath,uBreathRate,uBreathTime; attribute vec2 aRingUV; attribute vec3 aBreath; uniform float uReference; varying float vSignal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vSignal=0.;
        #ifdef USE_INSTANCING
        vec3 center=instanceMatrix[3].xyz;float angle=aRingUV.x;
        float sectorSignal=0.;float touchSignal=0.;
        for(int voice=0;voice<8;voice++){
          float delta=acos(clamp(cos(angle-float(voice)*.785398163),-1.,1.));
          sectorSignal+=(1.-smoothstep(0.,.785398163,delta))*uVoices[voice];
          float touchDistance=distance(center,uTouchLocal[voice].xyz);
          touchSignal=max(touchSignal,(1.-smoothstep(uTouchLocal[voice].w*.3,uTouchLocal[voice].w,touchDistance))*uTouches[voice].z);
        }
        vSignal=max(clamp(sectorSignal,0.,1.),touchSignal);
        float wave=sin(center.x*3.8+center.y*2.7+uTime*2.);
        float breathPhase=uBreathTime*uBreathRate*.104719755*aBreath.z;
        float breath=.65*sin(breathPhase+aBreath.x)+.35*sin(breathPhase*.61+aBreath.y);
        transformed*=1.+vSignal*.12+wave*uEnergy*.04*uTurbulence+breath*uBreath;
        #endif`);
      shader.fragmentShader = 'uniform vec3 uSignalColor; uniform float uReference; varying float vSignal;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,uSignalColor,min(.92,vSignal*.95));');
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=uSignalColor*vSignal*mix(.65,.22,uReference);');
    };
    this.sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.buildOrbits(); this.buildSignalObjects(); this.buildTrails(); this.buildParticles(42); this.setupPost(); this.updateGeometry({}, true);
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.contextLost = true;this.releaseParticleLayer(); });
    this.canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false;if(this.particleTexture)this.particleTexture.needsUpdate=true;this.environment?.dispose();this.environment=this.makeEnvironment();this.scene.environment=this.environment.texture;this.resize(); });
  }

  makeEnvironment() {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512; const c = canvas.getContext('2d');
    const base = c.createLinearGradient(0, 0, 0, 512); base.addColorStop(0, '#51534f'); base.addColorStop(.35, '#727a73'); base.addColorStop(.56, '#17201e'); base.addColorStop(1, '#050707'); c.fillStyle=base; c.fillRect(0,0,1024,512);
    c.fillStyle='#ffffff'; c.fillRect(110,70,150,130); c.fillStyle='#deded7'; c.fillRect(615,120,240,25);
    c.fillStyle='#333c3d'; c.fillRect(350,30,140,450); c.fillStyle='#b7c8c6'; c.fillRect(910,200,90,110);
    const texture = new THREE.CanvasTexture(canvas); texture.mapping = THREE.EquirectangularReflectionMapping; texture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer); const env = pmrem.fromEquirectangular(texture); texture.dispose(); pmrem.dispose(); return env;
  }

  updateGeometry(v, force = false) {
    const major = value(v, 'ringRadius', 1.7, .9, 2.8), minor = value(v, 'ringThickness', .55, .15, 1.1);
    const bead = value(v, 'beadSize', .045, .015, .1), density = value(v, 'density', 1, .2, 2.4);
    const twist = value(v, 'twist', .2, -3, 3), spread = value(v, 'spread', .1, 0, 1), seed = value(v, 'seed', 42);
    const reference=!!this.getPalette()?.reference; const signature = [major, minor, bead, density, twist, spread, seed,reference].join('|');
    if (signature === this.geometrySignature) return;
    if (!force && performance.now() - (this.lastGeometry || 0) < 110) return;
    this.geometrySignature=signature; this.lastGeometry=performance.now();this.renderedGeometry={major,minor,twist,spread,bead};
    const rows = Math.round((reference?80:132) * Math.sqrt(density)), cols = Math.round((reference?20:34) * Math.sqrt(density)); const count = rows * cols;
    if (!this.beads || this.beads.count !== count) {
      if (this.beads) { this.ringGroup.remove(this.beads); this.beads.dispose(); }
      this.beads = new THREE.InstancedMesh(this.sphereGeometry, this.material, count); this.beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.ringGroup.add(this.beads);
    }
    let uv=this.sphereGeometry.getAttribute('aRingUV');if(!uv||uv.count!==count){uv=new THREE.InstancedBufferAttribute(new Float32Array(count*2),2);this.sphereGeometry.setAttribute('aRingUV',uv);}
    let breath=this.sphereGeometry.getAttribute('aBreath');if(!breath||breath.count!==count){breath=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3);this.sphereGeometry.setAttribute('aBreath',breath);}
    const dummy = new THREE.Object3D(), random=rng(seed); this.beadCoordinates=[];this.beadContentBounds??=new THREE.Box3();this.beadContentBounds.makeEmpty();const extentPoint=new THREE.Vector3();
    for (let i=0;i<rows;i++) for (let j=0;j<cols;j++) {
      const index=i*cols+j, u=(i+(j%2)*.5)/rows*TAU, w=j/cols*TAU + twist*Math.sin(u*3), tube=minor*(1+twist*.15*Math.sin(u*2+.4)), r=major+tube*Math.cos(w);
      const jitter=(random()-.5)*spread*.16; dummy.position.set((r+jitter)*Math.cos(u),(r+jitter)*Math.sin(u),tube*Math.sin(w)+twist*.45*Math.sin(u*2-.3));
      const packing=clamp(r/(major+minor),.63,1);
      const s = bead*(reference?1.45+random()*.08:.74+random()*.10)*(reference?.9+packing*.1:packing); dummy.scale.setScalar(s); dummy.updateMatrix(); this.beads.setMatrixAt(index,dummy.matrix);
      const radius=s*MAX_BEAD_EXPANSION;this.beadContentBounds.expandByPoint(extentPoint.copy(dummy.position).addScalar(radius));this.beadContentBounds.expandByPoint(extentPoint.copy(dummy.position).addScalar(-radius));
      uv.setXY(index,u,w);breath.setXYZ(index,...beadBreathParameters(u,j/cols*TAU,seed));this.beadCoordinates.push({u,w,tubePhase:j/cols*TAU,random:random()});
    }
    uv.needsUpdate=true;breath.needsUpdate=true;this.beads.instanceMatrix.needsUpdate=true; this.beads.computeBoundingSphere(); this.paletteSignature='';
  }

  buildOrbits() {
    this.orbitMaterials=[];
    for(let i=0;i<7;i++) {
      const p=[]; for(let j=0;j<=192;j++){const t=j/192*TAU;const r=2.45+i*.075;p.push(new THREE.Vector3(r*Math.cos(t),r*Math.sin(t),0));}
      const g=new THREE.BufferGeometry().setFromPoints(p);const m=new THREE.LineBasicMaterial({color:'#bd945e',transparent:true,opacity:.12});this.orbitMaterials.push(m);
      const l=new THREE.LineLoop(g,m);l.rotation.x=[.2,.9,1.2,.6,-.5,1.5,.9][i];l.rotation.y=[.1,.5,-.8,.7,.4,.1,-.6][i];l.rotation.z=i*.39;this.orbits.add(l);
    }
    const axes=[];for(let a=0;a<3;a++){const p=new THREE.Vector3(),q=new THREE.Vector3();p.setComponent(a,-2.9);q.setComponent(a,2.9);axes.push(p,q);}
    this.axisMaterial=new THREE.LineBasicMaterial({color:'#d9bf92',transparent:true,opacity:.2});this.orbits.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(axes),this.axisMaterial));
    const tick=[];for(let i=-14;i<=14;i++){if(!i)continue;const x=i*.2;tick.push(new THREE.Vector3(x,-.025,0),new THREE.Vector3(x,.025,0));tick.push(new THREE.Vector3(-.025,x,0),new THREE.Vector3(.025,x,0));}
    this.orbits.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tick),this.axisMaterial));
    this.orbits.rotation.set(-.62,.1,-.08);
  }

  updateOrbitGuides(v,p,phase,speed) {
    const grid=value(v,'gridOpacity',.2,0,1),spacing=value(v,'gridSpacing',1,.4,2.5);
    this.orbitMaterials.forEach((m,i)=>{m.opacity=grid*(i%2?.34:.55);});this.axisMaterial.opacity=grid*.55;
    // Signal's larger bead lattice needs the same orbital geometry fitted around
    // its outer surface. Guide spacing changes only the guides, never the camera.
    const extent=(value(v,'ringRadius',1.7)+value(v,'ringThickness',.55))*value(v,'scale',1,.5,1.8);
    this.orbits.scale.setScalar(p.reference?extent*(1.08+spacing*.2)/2.45:spacing);
    if(p.reference)this.orbits.position.copy(this.ringGroup.position);else this.orbits.position.set(0,0,0);
    this.orbits.rotation.z=-.08+phase*speed*.025;this.orbits.visible=v.gridType!=='none';
  }

  buildSignalObjects() {
    // Retain local bounds for stable framing; visible guides use the orbital lines.
    this.cageMaterial=new THREE.LineBasicMaterial({color:'#bd4f44',transparent:true,opacity:.7});
    this.cage=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),this.cageMaterial);
    this.cage.visible=false;this.ringGroup.add(this.cage);
    this.coreGroup=new THREE.Group();this.ringGroup.add(this.coreGroup);
    // Shallow overlapping crystal petals preserve the layered, cellular center.
    this.coreMaterial=new THREE.MeshPhongMaterial({color:'#ffffff',emissive:'#b9eced',emissiveIntensity:.24,flatShading:true,shininess:18,transparent:true,opacity:.74,depthWrite:false,side:THREE.DoubleSide});
    const outline=[[.94,.2,0],[.55,.68,-.05],[-.45,.76,0],[-.85,.38,.04],[-.91,-.25,0],[-.48,-.73,0],[.55,-.68,-.05],[.96,-.19,0]],vertices=[];
    for(let j=0;j<outline.length;j++)vertices.push(.02,0,.48,...outline[j],...outline[(j+1)%outline.length]);
    const petalGeometry=new THREE.BufferGeometry();petalGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));petalGeometry.computeVertexNormals();
    this.coreCellData=[{angle:0,radius:0,size:.24,band:0}];
    for(let band=1;band<=2;band++){const count=band===1?6:12;for(let i=0;i<count;i++)this.coreCellData.push({angle:i/count*TAU+(band===1?.22:0),radius:band===1?.28:.62,size:band===1?.32:.36,band});}
    this.coreCells=new THREE.InstancedMesh(petalGeometry,this.coreMaterial,this.coreCellData.length);
    this.coreCells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.coreCells.frustumCulled=false;this.coreCells.renderOrder=1;this.coreGroup.add(this.coreCells);
    this.coreLineMaterial=new THREE.LineBasicMaterial({color:'#7dccdc',transparent:true,opacity:.14,blending:THREE.AdditiveBlending,depthWrite:false});
    this.coreHull=new THREE.Group();this.coreGroup.add(this.coreHull);
    const edgeGeometry=new THREE.EdgesGeometry(petalGeometry,18);
    for(let i=0;i<this.coreCellData.length;i++){const edges=new THREE.LineSegments(edgeGeometry,this.coreLineMaterial);edges.matrixAutoUpdate=false;edges.renderOrder=2;this.coreHull.add(edges);}
    this.modulationMarker=new THREE.Mesh(new THREE.IcosahedronGeometry(.07,1),new THREE.MeshBasicMaterial({color:'#6eff8e',wireframe:true,transparent:true,opacity:.9}));this.ringGroup.add(this.modulationMarker);
    this.voiceLabels=[];
    for(let index=0;index<8;index++){
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
      const sprite=new THREE.Sprite(material);sprite.scale.set(.35,.175,1);sprite.renderOrder=10;this.ringGroup.add(sprite);
      this.voiceLabels.push({canvas,texture,sprite,text:''});
    }
    this._coreDummy=new THREE.Object3D();this.buildParameterGuides();
  }

  buildParameterGuides() {
    this.parameterGuides=new THREE.Group();this.ringGroup.add(this.parameterGuides);
    this.envelopeMaterial=new THREE.LineBasicMaterial({color:'#d8efff',transparent:true,opacity:.36,depthWrite:false});
    this.envelopePositions=new Float32Array(193*3);
    this.envelopeGeometry=new THREE.BufferGeometry();this.envelopeGeometry.setAttribute('position',new THREE.BufferAttribute(this.envelopePositions,3).setUsage(THREE.DynamicDrawUsage));
    this.envelopeLine=new THREE.Line(this.envelopeGeometry,this.envelopeMaterial);this.envelopeLine.frustumCulled=false;this.envelopeLine.renderOrder=4;this.envelopeMaterial.depthTest=false;this.parameterGuides.add(this.envelopeLine);
    this.echoGuides=[];
    for(let i=0;i<5;i++){
      const positions=new Float32Array(81*3),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
      const material=new THREE.LineBasicMaterial({color:'#ffe579',transparent:true,opacity:.1,depthWrite:false});
      const line=new THREE.Line(geometry,material);line.frustumCulled=false;this.parameterGuides.add(line);this.echoGuides.push({positions,geometry,material,line});
    }
    const haloMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      uniforms:{tint:{value:new THREE.Color('#79d9ff')},amount:{value:.22}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 vUv;uniform vec3 tint;uniform float amount;void main(){float r=length(vUv-.5)*2.;float a=exp(-pow((r-.72)*7.,2.))*(1.-smoothstep(.86,1.,r))*amount*.14;gl_FragColor=vec4(tint,a);}' });
    this.reverbHalo=new THREE.Mesh(new THREE.PlaneGeometry(2,2),haloMaterial);this.reverbHalo.position.z=-.42;this.parameterGuides.add(this.reverbHalo);
    this.stepMarkers=[];
    const markerGeometry=new THREE.SphereGeometry(.025,7,5);
    for(let i=0;i<16;i++){const marker=new THREE.Mesh(markerGeometry,new THREE.MeshBasicMaterial({color:'#dfefff',transparent:true,opacity:.35,depthWrite:false}));this.parameterGuides.add(marker);this.stepMarkers.push(marker);}
    this.clockMarker=new THREE.Mesh(new THREE.OctahedronGeometry(.055,0),new THREE.MeshBasicMaterial({color:'#ffe579',transparent:true,opacity:.8}));this.parameterGuides.add(this.clockMarker);
    this.holdBracket=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:65},(_,i)=>new THREE.Vector3(Math.cos(i/64*TAU),Math.sin(i/64*TAU),0))),new THREE.LineBasicMaterial({color:'#ffe579',transparent:true,opacity:.3,depthWrite:false}));this.parameterGuides.add(this.holdBracket);
  }

  parameterState(a,dt) {
    const s=a.sound||{},q=a.sequence||{};
    const desired={cutoff:value(s,'cutoff',2400,20,20000),resonance:value(s,'resonance',4.5,.1,12),detune:value(s,'detune',8,0,40),attack:value(s,'attack',.04,.005,2),decay:value(s,'decay',.35,.05,2),sustain:value(s,'sustain',.55,0,1),release:value(s,'release',1.4,.05,5),delay:value(s,'delay',.22,0,.65),feedback:value(s,'feedback',.25,0,.7),reverb:value(s,'reverb',.22,0,.65),lfoRate:value(s,'lfoRate',.35,.05,4),lfoDepth:value(s,'lfoDepth',.08,0,1),bpm:value(q,'bpm',112,40,220),swing:value(q,'swing',.1,0,.45),root:value(q,'root',50,48,59)};
    this.response??={...desired};const amount=1-Math.exp(-Math.max(.008,dt)*12);
    for(const key of Object.keys(desired)){const delta=desired[key]-this.response[key];this.response[key]=Math.abs(delta)<Math.max(.00001,Math.abs(desired[key])*.00001)?desired[key]:this.response[key]+delta*amount;}
    const r=this.response;r.waveform=['sine','triangle','square','sawtooth'].includes(s.waveform)?s.waveform:'triangle';r.scale=q.scale||'dorian';r.length=[8,12,16].includes(q.length)?q.length:16;r.step=Math.max(0,Number(q.step)||0);r.steps=q.steps||[];r.arp=!!q.arp;r.arpRate=value(q,'arpRate',8,4,16);r.arpDirection=q.arpDirection||'up';r.hold=!!a.hold;
    r.brightness=clamp(Math.log(r.cutoff/20)/Math.log(1000),0,1);r.focus=r.resonance/12;r.split=r.detune/40;return r;
  }

  shapeForSound(v,r) {
    return {...v,ringRadius:value(v,'ringRadius',1.7)*(.965+r.brightness*.055),ringThickness:value(v,'ringThickness',.55)*(.91+r.focus*.16+r.sustain*.05),twist:value(v,'twist',.2)+(r.split-.2)*.17,spread:value(v,'spread',.1)+r.split*.06};
  }

  updateParameterGuides(v,p,a,phase,r) {
    const major=value(v,'ringRadius',1.7),minor=value(v,'ringThickness',.55),hole=major-minor;
    this.parameterGuides.visible=true;
    const colorSignal=color(p.accent,'#ffe579'),colorCore=color(p.secondary,'#79d9ff');
    this.envelopeMaterial.color.copy(colorCore).lerp(colorSignal,.28);this.envelopeMaterial.opacity=.23+r.sustain*.18;
    const total=r.attack+r.decay+.5+r.release;
    for(let i=0;i<=192;i++){
      const time=i/192*total;let envelope;
      if(time<r.attack)envelope=time/r.attack;
      else if(time<r.attack+r.decay)envelope=r.sustain+(1-r.sustain)*Math.pow(1-(time-r.attack)/r.decay,2);
      else if(time<r.attack+r.decay+.5)envelope=r.sustain;
      else envelope=r.sustain*Math.pow(Math.max(0,1-(time-r.attack-r.decay-.5)/r.release),2);
      const theta=i/192*TAU-Math.PI*.5,radius=Math.max(.25,hole-.02)-.23*(1-envelope);
      this.envelopePositions[i*3]=Math.cos(theta)*radius;this.envelopePositions[i*3+1]=Math.sin(theta)*radius;this.envelopePositions[i*3+2]=.36+envelope*.035;
    }
    this.envelopeGeometry.attributes.position.needsUpdate=true;
    const echoes=Math.ceil(r.feedback/.7*4)+1;
    this.echoGuides.forEach((echo,k)=>{
      echo.line.visible=r.delay>.004&&k<echoes;
      const radius=major+minor+.12+k*(.035+r.delay*.2),turn=.72+r.delay*2.2;
      for(let i=0;i<=80;i++){const u=i/80,theta=-.35-k*(.12+r.delay*.7)+u*turn;echo.positions[i*3]=Math.cos(theta)*radius;echo.positions[i*3+1]=Math.sin(theta)*radius;echo.positions[i*3+2]=-.06-k*.08;}
      echo.geometry.attributes.position.needsUpdate=true;echo.material.color.copy(colorSignal);echo.material.opacity=r.delay*.48*Math.pow(.25+r.feedback,k)*(.6+this.energy*2);
    });
    this.reverbHalo.scale.setScalar((major+minor)*(1.05+r.reverb*.8));this.reverbHalo.material.uniforms.tint.value.copy(colorCore);this.reverbHalo.material.uniforms.amount.value=r.reverb*(.6+this.energy*1.5);
    const scales={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],dorian:[0,2,3,5,7,9,10],pentatonic:[0,3,5,7,10]},intervals=scales[r.scale]||scales.dorian;
    this.stepMarkers.forEach((marker,i)=>{
      marker.visible=i<r.length;const step=r.steps[i]||{note:i%7,velocity:.7,active:true},degree=Math.round(Number(step.note)||0),pitch=intervals[((degree%intervals.length)+intervals.length)%intervals.length]+12*Math.floor(degree/intervals.length);
      const theta=(i+(i%2?r.swing*.55:0))/r.length*TAU-Math.PI*.5;
      const radius=major+minor+.22+pitch/24*.13;marker.position.set(Math.cos(theta)*radius,Math.sin(theta)*radius,.03);
      const selected=a.sequencePlaying===true&&i===r.step;marker.scale.setScalar((.6+value(step,'velocity',.7,.1,1)*.7)*(selected?1.8:1));marker.material.color.copy(selected?colorSignal:colorCore).offsetHSL((r.root-50)*.012,0,0);marker.material.opacity=step.active===false?.12:selected?.95:.3+value(step,'velocity',.7,.1,1)*.25;
    });
    const beat=(a.time>0?a.time:phase)*r.bpm/60,dir=r.arpDirection==='down'?-1:1,arpBeat=r.arp?r.arpRate/4:1;
    let theta=beat*TAU/8*arpBeat*dir+(r.root-50)/12*TAU;
    if(r.arp&&r.arpDirection==='upDown')theta=Math.sin(theta)*Math.PI;
    if(r.arp&&r.arpDirection==='random')theta=(Math.sin(Math.floor(beat*arpBeat)*12.9898)*43758.5453%1)*TAU;
    this.clockMarker.position.set(Math.cos(theta)*(major+minor+.4),Math.sin(theta)*(major+minor+.4),.03);this.clockMarker.material.color.copy(colorSignal);this.clockMarker.material.opacity=r.arp?.65:.22;this.clockMarker.scale.setScalar(r.arp?1:.65);
    this.holdBracket.visible=r.hold;this.holdBracket.scale.setScalar(major+minor+.06);this.holdBracket.position.z=.1;this.holdBracket.material.color.copy(colorSignal);
  }

  signalActivity(activity,frozen) {
    if(!frozen){this.frozenSignal=null;return activity;}
    if(!this.frozenSignal)this.frozenSignal={...activity,sound:{...activity.sound},sequence:{...activity.sequence,steps:(activity.sequence?.steps||[]).map(step=>({...step}))},voices:(activity.voices||[]).map(voice=>({...voice}))};
    return this.frozenSignal;
  }

  updateSignalObjects(v,p,a,phase,frozen) {
    a=this.signalActivity(a,frozen);
    const reference=!!p.reference, major=value(v,'ringRadius',1.7),minor=value(v,'ringThickness',.55),r=this.response||this.parameterState(a,.016);
    const voices=Array.isArray(a.voices)?a.voices:[];
    if(!frozen){for(let i=0;i<8;i++){const voice=voices.find(x=>x.index===i);this.rippleUniforms.uVoices.value[i]=clamp(Number(voice?.envelope)||0,0,1);}}
    const envelopes=this.rippleUniforms.uVoices.value;
    this.cage.visible=false;
    this.coreGroup.visible=true;this.coreGroup.scale.setScalar(Math.max(.3,(major-minor)*(.69+r.brightness*.27)));this.updateParameterGuides(v,p,a,phase,r);
    const cutoff=clamp(Math.log(Math.max(20,Number(a.cutoff)||2400)/20)/Math.log(1000),0,1),q=clamp((Number(a.resonance)||1)/12,0,1);
    const voiced=envelopes.reduce((sum,x)=>sum+x,0)/8;
    const react=value(v,'reactivity',.6,0,2),effectiveEnergy=Math.max(this.energy,voiced)*react;
    const audioPhase=frozen?phase:Number.isFinite(a.time)?a.time:phase;
    for(let i=0;i<this.coreCellData.length;i++){
      const cell=this.coreCellData[i],fold=r.waveform==='square'?4:r.waveform==='triangle'?3:r.waveform==='sawtooth'?5:1;const theta=cell.angle+Math.sin(audioPhase*.5)*effectiveEnergy*.035+(cell.band===1?1:-1)*(r.split-.2)*.3+(r.root-50)*.012;
      const pulse=Math.sin(theta*3+audioPhase*(.8+cutoff))*effectiveEnergy*(.025+q*.06);
      const waveformShape=r.waveform==='sine'?1:1+Math.cos(theta*fold)*(r.waveform==='square'?.18:.13);const opening=(.9+cutoff*.16+effectiveEnergy*.05)*waveformShape;
      this._coreDummy.position.set(Math.cos(theta)*(cell.radius+pulse)*(1+r.split*.12),Math.sin(theta)*(cell.radius+pulse),.035+(2-cell.band)*(.055+r.focus*.12)+Math.sin(theta*2+audioPhase)*effectiveEnergy*.035+r.lfoDepth*Math.sin(markerTime(a,phase,r.lfoRate))*cell.radius*.09);
      this._coreDummy.rotation.set(Math.sin(theta)*.08,Math.cos(theta)*(.12+q*.12),theta);
      this._coreDummy.scale.set(cell.size*opening*(r.waveform==='sawtooth'?1.15:1),cell.size*(r.waveform==='square'?.84:r.waveform==='sine'?1.13:1)*(1+effectiveEnergy*.05),cell.size*(.42+q*.65));
      this._coreDummy.updateMatrix();this.coreCells.setMatrixAt(i,this._coreDummy.matrix);this.coreHull.children[i].matrix.copy(this._coreDummy.matrix);
    }
    this.coreCells.instanceMatrix.needsUpdate=true;this.coreMaterial.emissiveIntensity=.12+cutoff*.22+effectiveEnergy*.24;
    this.coreLineMaterial.opacity=.07+q*.2+effectiveEnergy*.08;
    const markerPhase=markerTime(a,phase,r.lfoRate);
    this.modulationMarker.visible=reference;this.modulationMarker.position.set(Math.cos(markerPhase)*(major+minor+.24+r.lfoDepth*.5),Math.sin(markerPhase)*(major+minor+.24+r.lfoDepth*.5),.1+Math.sin(markerPhase)*r.lfoDepth*.4);
    for(let i=0;i<8;i++){
      const item=this.voiceLabels[i],voice=voices.find(x=>x.index===i&&x.envelope>.015),angle=i/8*TAU,r=major+minor+.2;
      item.sprite.position.set(Math.cos(angle)*r,Math.sin(angle)*r,.13);item.sprite.visible=reference;
      const text=voice?String(voice.midi):String(i+1).padStart(2,'0'),active=envelopes[i]>.08,signature=text+'-'+active;
      if(item.text!==signature){const ctx=item.canvas.getContext('2d');ctx.clearRect(0,0,128,64);ctx.font='bold 42px '+UI_FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=active?'#fff6a5':'#e9eaff';ctx.fillText(text,64,32);item.texture.needsUpdate=true;item.text=signature;}
    }
  }

  // Fit in the artwork's local frame; parenting then applies the exact same
  // tilt, rotation, depth and reactive scale to the ring and its wireframe.
  updateCageBounds() {
    if(!this.cage||!this.beadContentBounds)return;
    this._cageFit??={bounds:new THREE.Box3(),cell:new THREE.Box3(),matrix:new THREE.Matrix4(),combined:new THREE.Matrix4(),size:new THREE.Vector3()};
    const fit=this._cageFit;fit.bounds.copy(this.beadContentBounds);
    if(this.coreGroup?.visible&&this.coreCells?.visible){
      const cells=this.coreCells;if(!cells.geometry.boundingBox)cells.geometry.computeBoundingBox();this.coreGroup.updateMatrix();cells.updateMatrix();
      for(let i=0;i<cells.count;i++){
        cells.getMatrixAt(i,fit.matrix);fit.combined.multiplyMatrices(this.coreGroup.matrix,cells.matrix).multiply(fit.matrix);
        fit.cell.copy(cells.geometry.boundingBox).applyMatrix4(fit.combined);fit.bounds.union(fit.cell);
      }
    }
    this.cageContentBounds??=new THREE.Box3();this.cageContentBounds.copy(fit.bounds);
    fit.bounds.getSize(fit.size);this.cagePadding=clamp(Math.max(fit.size.x,fit.size.y)*.025,.075,.18);
    this.cageBounds??=new THREE.Box3();this.cageBounds.copy(fit.bounds).expandByScalar(this.cagePadding);
    this.cageBounds.getCenter(this.cage.position);this.cageBounds.getSize(this.cage.scale);this.cage.updateMatrix();
  }

  orbitState(){return this.orbit??=( {yaw:0,pitch:0,zoom:1,velocityYaw:0,velocityPitch:0,drag:null} );}

  beginOrbit(pointerId,clientX,clientY,now=performance.now()) {
    const orbit=this.orbitState();if(orbit.drag)return false;
    orbit.velocityYaw=0;orbit.velocityPitch=0;orbit.drag={pointerId,x:clientX,y:clientY,time:now};return true;
  }

  moveOrbit(pointerId,clientX,clientY,now=performance.now()) {
    const orbit=this.orbitState(),drag=orbit.drag;if(!drag||drag.pointerId!==pointerId)return false;
    const sensitivity=TAU/Math.max(440,Math.min(this.size.w,this.size.h)*2.2),dx=clientX-drag.x,dy=clientY-drag.y,dt=Math.max(.008,(now-drag.time)/1000);
    const yaw=-dx*sensitivity,pitch=dy*sensitivity;
    orbit.yaw+=yaw;orbit.pitch+=pitch;
    orbit.velocityYaw=clamp(yaw/dt,-2.4,2.4);orbit.velocityPitch=clamp(pitch/dt,-2.4,2.4);
    drag.x=clientX;drag.y=clientY;drag.time=now;this.applyOrbitCamera();this.publishOrbit();return true;
  }

  endOrbit(pointerId,cancelled=false,now=performance.now()) {
    const orbit=this.orbitState();if(orbit.drag?.pointerId!==pointerId)return;
    if(cancelled||this.reducedMotion?.matches||now-orbit.drag.time>100){orbit.velocityYaw=0;orbit.velocityPitch=0;}
    orbit.drag=null;this.publishOrbit();
  }

  stopOrbitMomentum(){const orbit=this.orbitState();orbit.velocityYaw=0;orbit.velocityPitch=0;}

  cancelOrbit(){const orbit=this.orbitState();orbit.drag=null;orbit.velocityYaw=0;orbit.velocityPitch=0;this.publishOrbit();}

  resetOrbit(){this.cancelOrbit();const orbit=this.orbitState();orbit.yaw=0;orbit.pitch=0;orbit.zoom=1;this.applyOrbitCamera();this.publishOrbit();}

  nudgeOrbit(yaw,pitch){this.cancelOrbit();const orbit=this.orbitState();orbit.yaw+=yaw;orbit.pitch+=pitch;this.applyOrbitCamera();this.publishOrbit();}

  publishOrbit(){const orbit=this.orbitState();this.onCameraChange?.({yaw:((orbit.yaw+Math.PI)%TAU+TAU)%TAU-Math.PI,pitch:((orbit.pitch+Math.PI)%TAU+TAU)%TAU-Math.PI,zoom:orbit.zoom??1});}

  updateOrbit(dt) {
    const orbit=this.orbitState();if(orbit.drag)return;
    if(this.reducedMotion?.matches){orbit.velocityYaw=0;orbit.velocityPitch=0;return;}
    if(Math.abs(orbit.velocityYaw)+Math.abs(orbit.velocityPitch)<.005){orbit.velocityYaw=0;orbit.velocityPitch=0;return;}
    const decay=Math.exp(-7*dt),travel=(1-decay)/7;
    orbit.yaw+=orbit.velocityYaw*travel;orbit.pitch+=orbit.velocityPitch*travel;
    orbit.velocityYaw*=decay;orbit.velocityPitch*=decay;this.publishOrbit();
  }

  setZoom(zoom){const orbit=this.orbitState();orbit.zoom=clamp(Number.isFinite(zoom)?zoom:1,.5,2.5);this.stopOrbitMomentum();this.applyOrbitCamera();this.publishOrbit();return orbit.zoom;}
  zoomBy(factor){return this.setZoom((this.orbitState().zoom??1)*(Number.isFinite(factor)&&factor>0?factor:1));}

  updateCameraEnvelope(){
    const v=this.effectiveVisual||this.getVisual()||{},major=value(v,'ringRadius',1.7),minor=value(v,'ringThickness',.55),scale=value(v,'scale',1,.5,1.8),depth=value(v,'depth',1,.3,2),react=value(v,'reactivity',.6,0,2);
    const key=[this.geometrySignature,major,minor,scale,depth,react,this.size.w,this.size.h,this.camera.fov].join('|');
    if(this.cameraEnvelope?.key===key)return this.cameraEnvelope;
    // Circumscribe the actual expanded artwork, not the empty corners of its
    // box. This sphere is invariant under every camera/artwork orientation.
    let localRadius=0;const instances=this.beads?.instanceMatrix.array,depthScale=Math.max(1,depth);
    if(instances)for(let i=0;i<instances.length;i+=16){
      const beadScale=Math.max(Math.hypot(instances[i],instances[i+1],instances[i+2]),Math.hypot(instances[i+4],instances[i+5],instances[i+6]),Math.hypot(instances[i+8],instances[i+9],instances[i+10]));
      localRadius=Math.max(localRadius,Math.hypot(instances[i+12],instances[i+13],instances[i+14]*depth)+beadScale*MAX_BEAD_EXPANSION*depthScale);
    }
    else localRadius=major+minor*depthScale;
    // Bound all core waveform, filter, detune and envelope phases, rather
    // than following a live cell and introducing audio-driven camera pumping.
    let petalRadius=1;const positions=this.coreCells?.geometry.attributes.position;
    if(positions){petalRadius=0;for(let i=0;i<positions.count;i++)petalRadius=Math.max(petalRadius,Math.hypot(positions.getX(i),positions.getY(i),positions.getZ(i)));}
    const coreScale=Math.max(.3,Math.max(0,major-minor)*.96),opening=1.06+react*.05;
    for(const cell of [{radius:0,size:.24,band:0},{radius:.28,size:.32,band:1},{radius:.62,size:.36,band:2}]){
      const petal=petalRadius*cell.size*Math.max(opening*1.18,opening*1.13*1.15,1.13*(1+react*.05),1.07),xy=(cell.radius+react*.085)*1.12,z=.035+(2-cell.band)*.175+react*.035+cell.radius*.09;
      localRadius=Math.max(localRadius,(Math.hypot(xy,z*depth)+petal*depthScale)*coreScale);
    }
    const maxScale=scale*(1+react*.022),radius=localRadius*maxScale,padding=clamp(Math.min(this.size.w,this.size.h)*.055,16,32),tanY=Math.tan(this.camera.fov*Math.PI/360),tanX=tanY*this.camera.aspect;
    const safeX=Math.max(.25,1-padding*2/this.size.w),safeY=Math.max(.25,1-padding*2/this.size.h),halfAngle=Math.atan(Math.min(tanX*safeX,tanY*safeY));
    return this.cameraEnvelope={key,radius,localRadius,padding,maxScale,depth,headroom:sizeHeadroom(scale),safeDistance:radius/Math.sin(halfAngle)};
  }

  updateCageOverflow(v={}) {
    if(!this.cage?.visible){if(this.cageOverflow)this.cageOverflow.svg.style.display='none';return;}
    if(!this.host||!document.createElementNS)return;
    if(!this.cageOverflow){
      const workspace=this.host.closest('.workspace')||this.host,ns='http://www.w3.org/2000/svg',make=name=>document.createElementNS(ns,name),svg=make('svg'),defs=make('defs'),clip=make('clipPath'),hole=make('path'),path=make('path');
      const id='ring-cage-outside-'+Math.random().toString(36).slice(2);clip.id=id;clip.setAttribute('clipPathUnits','userSpaceOnUse');hole.setAttribute('clip-rule','evenodd');hole.setAttribute('fill-rule','evenodd');clip.append(hole);defs.append(clip);svg.append(defs,path);
      path.setAttribute('fill','none');path.setAttribute('clip-path',`url(#${id})`);path.setAttribute('stroke-linecap','butt');
      svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('ring-cage-overflow');svg.style.cssText='position:absolute;overflow:visible;pointer-events:none;z-index:0;';workspace.prepend(svg);
      this.cageOverflow={svg,path,hole,workspace,point:new THREE.Vector3()};
    }
    const {svg,path,hole,workspace,point}=this.cageOverflow;svg.style.display=this.cage.visible?'':'none';if(!this.cage.visible)return;
    const rect=this.host.getBoundingClientRect(),parent=workspace.getBoundingClientRect(),{w,h}=this.size,extent=Math.max(w,h)*8;
    svg.style.left=(rect.left-parent.left)+'px';svg.style.top=(rect.top-parent.top)+'px';svg.style.width=w+'px';svg.style.height=h+'px';svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    // Only continue beyond the WebGL rectangle. Inside it, the original cage
    // keeps its exact depth occlusion against the beads and crystal core.
    hole.setAttribute('d',`M${-extent},${-extent}H${extent}V${extent}H${-extent}Z M0,0H${w}V${h}H0Z`);
    this.cage.updateWorldMatrix(true,false);const positions=this.cage.geometry.attributes.position;let d='';
    for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(this.cage.matrixWorld).project(this.camera);d+=(i%2?'L':'M')+((point.x*.5+.5)*w).toFixed(3)+','+((.5-point.y*.5)*h).toFixed(3);}
    path.setAttribute('d',d);path.setAttribute('stroke-width',String(1/(this.renderer?.getPixelRatio()||1)));
    // Match the linear source color through the same grade as the canvas.
    const c=this.cageMaterial.color.clone(),lum=c.r*.2126+c.g*.7152+c.b*.0722,saturation=value(v,'saturation',1,0,2);c.r=lum+(c.r-lum)*saturation;c.g=lum+(c.g-lum)*saturation;c.b=lum+(c.b-lum)*saturation;
    const hue=value(v,'hue',0,-180,180)*Math.PI/180,cos=Math.cos(hue),sin=Math.sin(hue),average=(c.r+c.g+c.b)/3,r=c.r,g=c.g,b=c.b;
    c.setRGB(r*cos+(b-g)/Math.sqrt(3)*sin+average*(1-cos),g*cos+(r-b)/Math.sqrt(3)*sin+average*(1-cos),b*cos+(g-r)/Math.sqrt(3)*sin+average*(1-cos));
    const contrast=value(v,'contrast',1.08,.5,1.8),temperature=value(v,'temperature',0,-1,1),tint=value(v,'tint',0,-1,1),exposure=value(v,'exposure',1,.3,2.5),gain=[1+temperature*.18+tint*.07,1-tint*.09,1-temperature*.18+tint*.07];
    const graded=[c.r,c.g,c.b].map((channel,i)=>{const x=Math.max(0,((channel-.18)*contrast+.18)*gain[i]*exposure);return Math.pow(clamp(x*(2.51*x+.03)/(x*(2.43*x+.59)+.14),0,1),1/2.2);});
    path.setAttribute('stroke',`rgb(${graded.map(channel=>Math.round(channel*255)).join(' ')})`);path.setAttribute('opacity',String(this.cageMaterial.opacity*(1-value(v,'vignette',.35,0,1)*.42)));
  }

  applyOrbitCamera(distance) {
    if(this.fallback||!this.camera)return;const orbit=this.orbitState();
    this._orbitEuler??=new THREE.Euler(0,0,0,'YXZ');this._orbitEuler.set(-orbit.pitch,orbit.yaw,0,'YXZ');this.camera.quaternion.setFromEuler(this._orbitEuler);
    this.cameraTarget??=new THREE.Vector3(0,.1,0);this.ringGroup.updateMatrixWorld(true);this.cameraTarget.setFromMatrixPosition(this.ringGroup.matrixWorld);
    const envelope=this.updateCameraEnvelope(),base=Number.isFinite(distance)?Math.max(distance,envelope.safeDistance):envelope.safeDistance*envelope.headroom;
    const radius=base*zoomClearance(orbit.zoom??1);this.cameraDistance=radius;this.camera.position.set(0,0,radius).applyQuaternion(this.camera.quaternion).add(this.cameraTarget);
    const far=Math.max(60,radius+envelope.radius+10);if(this.camera.far!==far){this.camera.far=far;this.camera.updateProjectionMatrix();}this.camera.updateMatrixWorld(true);
    // QA/projection consumers can inspect current corners, but these points do
    // not drive camera distance. Orbit and artwork rotation change no fit input.
    const bounds=this.cage?.visible?this.cageBounds:this.cageContentBounds||this.beadContentBounds;this.cameraFramePoints??=Array.from({length:8},()=>new THREE.Vector3());
    if(bounds)for(let i=0;i<8;i++)this.cameraFramePoints[i].set(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z).applyMatrix4(this.ringGroup.matrixWorld);
  }

  fallbackPose(v){const orbit=this.orbitState();return{rotation:orbit.yaw,tilt:value(v,'tilt',.55)+orbit.pitch};}
  fallbackUnit(v){
    const major=value(v,'ringRadius',1.7),minor=value(v,'ringThickness',.55),scale=value(v,'scale',1,.5,1.8);
    // Circumscribe both wireframe faces for every tilt/roll, including the
    // maximum bead pulse and fixed minimum canvas stroke/radius allowances.
    const extent=Math.SQRT2*(major+minor+major*(.026*1.35+.07+.12)),pixels=Math.max(1,Math.min(this.size.w,this.size.h)*.46-12);
    return pixels/(extent*sizeHeadroom(scale)*zoomClearance(this.orbitState().zoom??1));
  }

  /** Pick the visible artwork in its current rendered pose, never in screen polar space. */
  pickClientPoint(clientX,clientY,{surfaceOnly=false,tolerance=0}={}) {
    if(this.disposed||!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;
    const box=this.canvas.getBoundingClientRect();if(!box.width||!box.height)return null;
    const x=(clientX-box.left)/box.width*this.size.w,y=(clientY-box.top)/box.height*this.size.h;
    const v=this.effectiveVisual||this.getVisual()||{},shape=this.renderedGeometry||{major:value(v,'ringRadius',1.7),minor:value(v,'ringThickness',.55)};
    let local,kind='plane',instanceId=null;
    if(this.fallback){
      // The fallback paints an orthographic ellipse; invert that exact ellipse.
      const pose=this.fallbackPose(v),unit=this.fallbackUnit(v),cos=Math.cos(pose.tilt),dx=x-this.size.w*.5,dy=y-this.size.h*.48;
      if(unit<.0001)return null;
      const px=dx*Math.cos(pose.rotation)+dy*Math.sin(pose.rotation),py=-dx*Math.sin(pose.rotation)+dy*Math.cos(pose.rotation);
      local=new THREE.Vector3(px/unit,Math.abs(cos)<.04?0:-py/(unit*cos),0);
      const bead=this.fallbackBeads?.findLast(b=>Math.hypot(x-b.screenX,y-b.screenY)<=b.radius+tolerance);
      if(bead){local.set(bead.local.x,bead.local.y,bead.local.z);kind='bead';instanceId=bead.instanceId;}
      else{for(const polygon of this.fallbackCore||[]){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;}if(inside){kind='core';break;}}}
      if(kind==='plane'&&(surfaceOnly||Math.abs(cos)<.04))return null;
    }else{
      this._picker??={raycaster:new THREE.Raycaster(),ndc:new THREE.Vector2(),inverse:new THREE.Matrix4(),localRay:new THREE.Ray(),plane:new THREE.Plane(new THREE.Vector3(0,0,1),0),point:new THREE.Vector3()};
      const pick=this._picker;this.ringGroup.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
      pick.ndc.set(x/this.size.w*2-1,1-y/this.size.h*2);pick.raycaster.setFromCamera(pick.ndc,this.camera);
      // Only sounding surfaces are hit targets: decorative cages, labels, trails
      // and modulation markers must never steal a touch from a bead underneath.
      const targets=[];if(this.beads?.visible)targets.push(this.beads);
      if(this.coreGroup?.visible&&this.coreCells?.visible){this.coreCells.computeBoundingSphere();targets.push(this.coreCells);}
      let hit=pick.raycaster.intersectObjects(targets,false)[0];
      // Initial touch admission can bridge a tiny packing gap without turning
      // the empty hole or the surrounding stage into a sounding surface.
      if(!hit&&surfaceOnly&&tolerance>0){for(let i=0;i<8&&!hit;i++){const angle=i/8*TAU;pick.ndc.set((x+Math.cos(angle)*tolerance)/this.size.w*2-1,1-(y+Math.sin(angle)*tolerance)/this.size.h*2);pick.raycaster.setFromCamera(pick.ndc,this.camera);hit=pick.raycaster.intersectObjects(targets,false)[0];}}
      if(hit){local=this.ringGroup.worldToLocal(hit.point.clone());kind=hit.object===this.beads?'bead':'core';instanceId=hit.instanceId;}
      else{
        if(surfaceOnly)return null;
        // Keep the hole, bead gaps and outer drag area playable in the ring's
        // own plane. Near edge-on views retain the previous note instead of
        // producing an unbounded intersection and an accidental octave jump.
        pick.inverse.copy(this.ringGroup.matrixWorld).invert();pick.localRay.copy(pick.raycaster.ray).applyMatrix4(pick.inverse);
        if(Math.abs(pick.localRay.direction.z)<.025)return null;
        if(!pick.localRay.intersectPlane(pick.plane,pick.point))return null;
        local=pick.point.clone();
      }
    }
    if(![local.x,local.y,local.z].every(Number.isFinite))return null;
    const radius=Math.hypot(local.x,local.y),outer=Math.max(.01,shape.major+shape.minor);
    const angle=((Math.atan2(-local.y,local.x)+Math.PI)/TAU+1)%1;
    return{local:{x:local.x,y:local.y,z:local.z},angle,radius,radial:clamp(radius/outer,0,.999999),kind,instanceId,screen:{x,y}};
  }

  createSurfaceAnchor(hit){
    if(!hit||!['bead','core'].includes(hit.kind))return null;
    const anchor={kind:hit.kind,instanceId:hit.instanceId,point:new THREE.Vector3(hit.local.x,hit.local.y,hit.local.z),geometrySignature:this.geometrySignature};
    this._anchorMatrix??=new THREE.Matrix4();const matrix=this._anchorMatrix;
    if(this.fallback){const bead=this.fallbackBeads?.find(b=>b.instanceId===hit.instanceId);if(hit.kind==='bead'&&bead){anchor.u=bead.u;anchor.tubePhase=bead.w;}return anchor;}
    if(hit.kind==='bead'&&Number.isInteger(hit.instanceId)){
      const uv=this.beadCoordinates[hit.instanceId];anchor.u=uv.u;anchor.tubePhase=uv.tubePhase;
      this.beads.getMatrixAt(hit.instanceId,matrix);anchor.offset=anchor.point.clone().applyMatrix4(matrix.invert());
    }else if(hit.kind==='core'&&Number.isInteger(hit.instanceId)){
      this.coreGroup.updateMatrix();this.coreCells.getMatrixAt(hit.instanceId,matrix);matrix.premultiply(this.coreGroup.matrix);anchor.offset=anchor.point.clone().applyMatrix4(matrix.invert());
    }
    return anchor;
  }

  resolveSurfaceAnchor(anchor){
    if(!anchor)return null;const v=this.effectiveVisual||this.getVisual()||{};
    if(this.fallback){if(anchor.kind==='bead'&&Number.isFinite(anchor.u)){const major=value(v,'ringRadius',1.7),minor=value(v,'ringThickness',.55),r=major+minor*Math.cos(anchor.tubePhase);anchor.point.set(r*Math.cos(anchor.u),-r*Math.sin(anchor.u),minor*Math.sin(anchor.tubePhase));}return anchor.point;}
    this._anchorMatrix??=new THREE.Matrix4();const matrix=this._anchorMatrix;
    if(anchor.kind==='bead'&&anchor.offset){
      if(anchor.geometrySignature!==this.geometrySignature){
        let best=Infinity;this.beadCoordinates.forEach((uv,index)=>{const du=Math.acos(clamp(Math.cos(uv.u-anchor.u),-1,1)),dw=Math.acos(clamp(Math.cos(uv.tubePhase-anchor.tubePhase),-1,1)),distance=du*du+dw*dw;if(distance<best){best=distance;anchor.instanceId=index;}});anchor.geometrySignature=this.geometrySignature;
      }
      this.beads.getMatrixAt(anchor.instanceId,matrix);anchor.point.copy(anchor.offset).applyMatrix4(matrix);
    }else if(anchor.kind==='core'&&anchor.offset){this.coreGroup.updateMatrix();this.coreCells.getMatrixAt(anchor.instanceId,matrix);anchor.point.copy(anchor.offset).applyMatrix4(matrix).applyMatrix4(this.coreGroup.matrix);}
    return anchor.point;
  }

  projectSurfaceAnchor(anchor){
    const local=this.resolveSurfaceAnchor(anchor);if(!local)return null;
    if(this.fallback){const v=this.effectiveVisual||this.getVisual()||{},unit=this.fallbackUnit(v),{tilt,rotation}=this.fallbackPose(v),x=local.x*unit,y=-local.y*unit*Math.cos(tilt)-local.z*unit*Math.sin(tilt);return{x:this.size.w*.5+x*Math.cos(rotation)-y*Math.sin(rotation),y:this.size.h*.48+x*Math.sin(rotation)+y*Math.cos(rotation),visible:true,local};}
    this.ringGroup.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);const point=local.clone().applyMatrix4(this.ringGroup.matrixWorld).project(this.camera);
    return{x:(point.x*.5+.5)*this.size.w,y:(1-point.y)*.5*this.size.h,visible:point.z>=-1&&point.z<=1,local};
  }

  showContact(pointerId,clientX,clientY,hit=this.pickClientPoint(clientX,clientY)) {
    const anchor=this.createSurfaceAnchor(hit);if(!anchor){this.suspendContact(pointerId,clientX,clientY);return;}

    this.contacts??=new Map();let contact=this.contacts.get(pointerId);
    if(!contact){
      const element=document.createElement('span');element.className='ring-contact';element.setAttribute('aria-hidden','true');
      element.style.cssText='position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border:1px solid var(--fg,#fff);border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#ffe579) 18%,transparent),0 0 10px color-mix(in srgb,var(--accent,#ffe579) 45%,transparent);pointer-events:none;z-index:8;';
      const centre=document.createElement('i');centre.style.cssText='position:absolute;left:5px;top:5px;width:2px;height:2px;background:var(--accent,#ffe579);border-radius:50%;';element.append(centre);this.host.append(element);contact={element,clientX,clientY,startedAt:performance.now()/1000,active:true};this.contacts.set(pointerId,contact);
      this.contactHistory??=new Map();const originId='pointer-'+pointerId,history=this.contactHistory.get(originId)||[];history.push(contact);if(history.length>16)history.shift();this.contactHistory.set(originId,history);
    }
    contact.anchor=anchor;contact.clientX=clientX;contact.clientY=clientY;contact.suspended=false;contact.updatedAt=performance.now()/1000;this.updateContacts();
  }

  updateContacts(){
    if(!this.contacts?.size)return;const rect=this.host.getBoundingClientRect();
    for(const contact of this.contacts.values()){
      const projected=contact.anchor?this.projectSurfaceAnchor(contact.anchor):null,x=projected?.x??contact.clientX-rect.left,y=projected?.y??contact.clientY-rect.top;
      contact.element.style.left=x+'px';contact.element.style.top=y+'px';contact.element.hidden=!!contact.suspended||projected?.visible===false||x<0||y<0||x>rect.width||y>rect.height;
    }
  }
  suspendContact(pointerId,clientX,clientY){
    const contact=this.contacts?.get(pointerId);if(!contact)return;
    contact.suspended=true;if(Number.isFinite(clientX))contact.clientX=clientX;if(Number.isFinite(clientY))contact.clientY=clientY;
    if(contact.element)contact.element.hidden=true;
  }
  releaseContact(pointerId){const contact=this.contacts?.get(pointerId);if(contact){contact.active=false;contact.updatedAt=performance.now()/1000;contact.element?.remove();this.contacts.delete(pointerId);}}
  clearContacts(){for(const contact of this.contacts?.values()||[])contact.element.remove();this.contacts?.clear();this.contactHistory?.clear();this.contactVoices?.clear();for(const touch of this.rippleUniforms?.uTouches.value||[])touch.z=0;}

  // Provenance identifies the held gesture; its material anchor, rather than
  // the last screen position, drives both local bead lighting and connection arcs.
  updateContactSignals(activity) {
    this.contactVoices??=new Map();const voices=activity.voices||[],box=this.canvas.getBoundingClientRect();
    this.rippleUniforms?.uViewport.value.set(this.size.w,this.size.h);
    for(let index=0;index<8;index++){
      const voice=voices.find(v=>v.index===index),source=voice?.source;
      const sounding=(source==='live'||source==='arp')&&(!Number.isFinite(activity.time)||!Number.isFinite(voice.started)||voice.started<=activity.time+.000001);
      const identity=voice?[voice.generation??'',voice.started,source,voice.originId??''].join('|'):'';
      let contact=this.contactVoices.get(index);
      if(!sounding||contact?.identity!==identity){this.contactVoices.delete(index);contact=null;}
      if(sounding&&!contact&&Number.isFinite(voice.pointerId)){
        const originId=voice.originId||'pointer-'+voice.pointerId,history=this.contactHistory?.get(originId)||[],active=this.contacts?.get(voice.pointerId);
        // originTime belongs to the original held note, not the queued arp
        // onset. A new gesture reusing pointerId must not capture an old tail.
        const pointer=Number.isFinite(voice.originTime)
          ? [...history,active].filter(Boolean).findLast(item=>Number.isFinite(item.startedAt)&&item.startedAt<=voice.originTime)
          : active||history.at(-1);
        if(pointer){contact={identity,started:voice.started,generation:voice.generation,originId,pointerId:voice.pointerId,pointer};this.contactVoices.set(index,contact);}
      }
      const uniform=this.rippleUniforms?.uTouches.value[index];if(uniform)uniform.z=0;
      if(!contact)continue;
      // The record survives pointerup for Hold/arp and the actual ADSR tail;
      // while down, its coordinates update in place with that same gesture.
      const projected=contact.pointer.anchor?this.projectSurfaceAnchor(contact.pointer.anchor):null;
      contact.clientX=contact.pointer.clientX;contact.clientY=contact.pointer.clientY;
      contact.strength=clamp(Number(voice.envelope)||0,0,1);contact.visualStrength=contact.pointer.suspended?0:contact.strength;contact.radius=clamp(Math.min(this.size.w,this.size.h)*.095,22,44);
      contact.x=projected?.x??(contact.clientX-box.left)/box.width*this.size.w;contact.y=projected?.y??(contact.clientY-box.top)/box.height*this.size.h;
      contact.local=projected?.local;contact.localRadius=clamp((this.renderedGeometry?.minor??.55)*.8+(this.renderedGeometry?.major??1.7)*.08,.3,1.2);
      const localUniform=this.rippleUniforms?.uTouchLocal?.value[index];if(localUniform&&contact.local)localUniform.set(contact.local.x,contact.local.y,contact.local.z,contact.localRadius);
      if(uniform){uniform.set(contact.x/this.size.w*2-1,1-contact.y/this.size.h*2,contact.visualStrength,contact.radius);this.rippleUniforms.uVoices.value[index]=0;}
      if(this.voiceLabels?.[index]&&contact.strength>.005)this.voiceLabels[index].sprite.visible=false;
    }
    // Closed gestures need only outlive the release/queued-audio window unless
    // Hold is keeping their arpeggios alive. Existing voices retain their record.
    if(!activity.hold&&this.contactHistory){const now=performance.now()/1000;for(const [id,history]of this.contactHistory){const kept=history.filter(item=>item.active||now-(item.updatedAt??item.startedAt)<12);if(kept.length)this.contactHistory.set(id,kept);else this.contactHistory.delete(id);}}
  }

  projectSector(index) {
    const contact=this.contactVoices?.get(Number(index));if(contact?.strength>.005)return{x:contact.x,y:contact.y};
    const angle=((Number(index)||0)%8)/8*TAU,v=this.effectiveVisual||this.getVisual()||{},major=this.renderedGeometry?.major??value(v,'ringRadius',1.7),minor=this.renderedGeometry?.minor??value(v,'ringThickness',.55);
    if(this.fallback){const unit=this.fallbackUnit(v),{tilt,rotation}=this.fallbackPose(v),x=Math.cos(angle)*major*unit,y=Math.sin(angle)*major*unit*Math.cos(tilt)-minor*unit*.6*Math.sin(tilt);return{x:this.size.w*.5+x*Math.cos(rotation)-y*Math.sin(rotation),y:this.size.h*.48+x*Math.sin(rotation)+y*Math.cos(rotation)};}
    this.ringGroup.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
    const point=new THREE.Vector3(Math.cos(angle)*major,Math.sin(angle)*major,minor*.6);this.ringGroup.localToWorld(point);point.project(this.camera);
    return{x:(point.x*.5+.5)*this.size.w,y:(-.5*point.y+.5)*this.size.h};
  }

  projectCore() {
    if(this.fallback)return{x:this.size.w*.5,y:this.size.h*.48};
    this.ringGroup.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
    const point=new THREE.Vector3().setFromMatrixPosition(this.ringGroup.matrixWorld).project(this.camera);
    return{x:(point.x*.5+.5)*this.size.w,y:(-.5*point.y+.5)*this.size.h};
  }

  setParticleLayerProvider(provider){this.releaseParticleLayer();this.getParticleLayer=typeof provider==='function'?provider:null;}

  releaseParticleLayer(){
    this.particleDepthReady=false;if(this.postMaterial)this.postMaterial.uniforms.particleEnabled.value=0;
    this.particleLayer?.onUnavailable?.();this.particleLayer=null;
  }

  prepareParticleLayer(now){
    if(!this.getParticleLayer||this.contextLost||(!this.fallback&&!this.depthSupported)){this.releaseParticleLayer();return null;}
    let layer;try{layer=this.getParticleLayer(now);}catch(error){this.releaseParticleLayer();return null;}
    const rect=layer?.ring;
    if(!layer?.canvas?.width||!layer.canvas.height||!(layer.width>0&&layer.height>0&&rect?.w>0&&rect?.h>0)||![rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)){this.releaseParticleLayer();layer?.onUnavailable?.();return null;}
    this.particleLayer=layer;if(this.fallback)return layer;
    // WebGL2 texture storage is immutable: a resized canvas needs fresh storage.
    if(this.particleTexture?.image!==layer.canvas||this.particleTextureWidth!==layer.canvas.width||this.particleTextureHeight!==layer.canvas.height){this.particleTexture?.dispose();this.particleTexture=new THREE.CanvasTexture(layer.canvas);this.particleTextureWidth=layer.canvas.width;this.particleTextureHeight=layer.canvas.height;this.particleTexture.colorSpace=THREE.NoColorSpace;this.particleTexture.premultiplyAlpha=true;this.particleTexture.generateMipmaps=false;this.particleTexture.minFilter=THREE.LinearFilter;this.particleTexture.magFilter=THREE.LinearFilter;this.particleTextureVersion=null;}
    if(this.particleTextureVersion!==layer.version){this.particleTexture.needsUpdate=true;this.particleTextureVersion=layer.version;}
    const u=this.postMaterial.uniforms;u.particleSource.value=this.particleTexture;u.particleRect.value.set(rect.x/layer.width,rect.y/layer.height,rect.w/layer.width,rect.h/layer.height);
    this._particleCenter??=new THREE.Vector3();this._particleCenter.setFromMatrixPosition(this.ringGroup.matrixWorld).project(this.camera);u.particleDepth.value=this._particleCenter.z*.5+.5;u.particleEnabled.value=1;
    return layer;
  }

  presentParticleLayer(){
    if(!this.particleLayer)return;this.particleDepthReady=true;this.particlePresentedVersion=this.particleLayer.version;this.particleLayer.onPresented?.(this.particleLayer.version);
  }

  drawFallbackParticleLayer(){
    const layer=this.particleLayer;if(!layer)return;const c=this.ctx,rect=layer.ring,ratio=this.canvas.width/this.size.w,sx=layer.canvas.width/layer.width,sy=layer.canvas.height/layer.height;
    c.save();c.setTransform(ratio,0,0,this.canvas.height/this.size.h,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.drawImage(layer.canvas,rect.x*sx,rect.y*sy,rect.w*sx,rect.h*sy,0,0,this.size.w,this.size.h);c.restore();
  }

  buildParticles(seed) {
    if(this.particles){this.scene.remove(this.particles);this.particles.geometry.dispose();this.particleMaterial.dispose();}
    const random=rng(seed+17),count=1800,positions=new Float32Array(count*3),sizes=new Float32Array(count),phases=new Float32Array(count);
    for(let i=0;i<count;i++){const t=random()*TAU,r=2.1+random()*1.8;positions[i*3]=Math.cos(t)*r;positions[i*3+1]=Math.sin(t)*r*.8;positions[i*3+2]=(random()-.5)*3.6; sizes[i]=.35+Math.pow(random(),5)*2.5;phases[i]=random()*TAU;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));g.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));
    this.particleMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{t:{value:0},tint:{value:new THREE.Color('#d89b61')},size:{value:1},energy:{value:0},opacity:{value:.5}},vertexShader:`attribute float aSize;attribute float aPhase;uniform float t,size,energy;varying float alpha;void main(){vec3 p=position;p.x+=sin(t*.12+aPhase)*.055;p.y+=cos(t*.16+aPhase)*.055;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*size*22./-mv.z,1.,12.);alpha=(.25+.75*pow(.5+.5*sin(t*.3+aPhase),4.))*(.7+energy*.5);}`,fragmentShader:`uniform vec3 tint;uniform float opacity;varying float alpha;void main(){float d=length(gl_PointCoord-.5)*2.;float a=exp(-d*d*5.)*(1.-smoothstep(.75,1.,d));gl_FragColor=vec4(tint,a*alpha*opacity);}`});
    this.particles=new THREE.Points(g,this.particleMaterial);this.scene.add(this.particles);
    this.particleSeed=seed;
  }

  buildTrails() {
    this.trails=new THREE.Group();this.ringGroup.add(this.trails);this.trailMaterials=[];
    for(let k=0;k<4;k++){
      const points=[];for(let j=0;j<=240;j++){const u=j/240*TAU*1.35;const r=2.36+Math.sin(u*2+k*.7)*(.12+k*.035);points.push(new THREE.Vector3(Math.cos(u+k*.65)*r,Math.sin(u+k*.65)*r,.32*Math.sin(u*3+k)));}
      const material=new THREE.LineBasicMaterial({color:'#f4c28a',transparent:true,opacity:.3,blending:THREE.AdditiveBlending,depthWrite:false});
      this.trailMaterials.push(material);this.trails.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),material));
    }
  }

  setupPost() {
    const floatOK=this.renderer.extensions.has('EXT_color_buffer_float')||this.renderer.extensions.has('EXT_color_buffer_half_float');
    const options={minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat,type:floatOK?THREE.HalfFloatType:THREE.UnsignedByteType};
    this.depthSupported=this.renderer.capabilities.isWebGL2||this.renderer.extensions.has('WEBGL_depth_texture');
    this.target=new THREE.WebGLRenderTarget(1,1,options);if(this.depthSupported)this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);this.target.samples=this.renderer.capabilities.isWebGL2?Math.min(4,this.renderer.capabilities.maxSamples):0;
    this.bloomA=new THREE.WebGLRenderTarget(1,1,{...options,depthBuffer:false}); this.bloomB=new THREE.WebGLRenderTarget(1,1,{...options,depthBuffer:false});
    this.postScene=new THREE.Scene();this.postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.blurMaterial=new THREE.ShaderMaterial({vertexShader:postVertex,fragmentShader:blurFragment,depthTest:false,depthWrite:false,uniforms:{source:{value:null},direction:{value:new THREE.Vector2()},threshold:{value:.5}}});
    this.postMaterial=new THREE.ShaderMaterial({blending:THREE.NoBlending,vertexShader:postVertex,fragmentShader:finishFragment,depthTest:false,depthWrite:false,uniforms:{source:{value:this.target.texture},bloom:{value:this.bloomB.texture},resolution:{value:new THREE.Vector2(1,1)},glow:{value:.45},grain:{value:.06},vignette:{value:.35},contrast:{value:1.08},saturation:{value:1},hue:{value:0},phase:{value:0},blur:{value:0},scanlines:{value:0},fringe:{value:0},exposure:{value:1},temperature:{value:0},tint:{value:0},background:{value:new THREE.Color('#101311')},particleSource:{value:null},sceneDepth:{value:this.target.depthTexture||null},particleRect:{value:new THREE.Vector4()},particleDepth:{value:1},particleEnabled:{value:0}}});
    this.postQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.postMaterial);this.postScene.add(this.postQuad);
  }

  updatePalette(v, p) {
    const signature=JSON.stringify([p.accent,p.secondary,p.bg,p.fg,v.hue,v.temperature,v.tint,p.reference]);if(signature===this.paletteSignature)return;this.paletteSignature=signature;
    const accent=color(p.accent,'#e8a269'),secondary=color(p.secondary,'#7ba49c'),fg=color(p.fg,'#e9dfd0'),bg=color(p.bg,'#101311');
    const reference=!!p.reference;
    const lightTheme=bg.r*.2126+bg.g*.7152+bg.b*.0722>.35;
    const illumination=lightTheme?new THREE.Color('#fffaf1'):fg;
    this.material.clearcoat=reference?.08:lightTheme?.85:.22;
    this.material.emissive.set(reference?'#4d426e':'#000000'); this.material.emissiveIntensity=reference?.16:0;
    this.rippleUniforms.uReference.value=reference?1:0;
    this.postMaterial.uniforms.background.value.copy(bg).convertLinearToSRGB();this.keyLight.color.copy(illumination).lerp(accent,.15);this.fillLight.color.copy(secondary);this.rimLight.color.copy(accent);this.ambient.color.copy(illumination);
    const dark=accent.clone().multiplyScalar(.22),c=new THREE.Color();
    this.beadCoordinates.forEach((b,i)=>{
      const band=.5+.5*Math.sin(b.u*2+b.w*.45), highlight=Math.pow(.5+.5*Math.cos(b.u*3-b.w),6);
      if(reference){c.set('#746a9a').lerp(new THREE.Color('#aaa1c1'),.2+.2*Math.sin(b.w)).lerp(secondary,.08).multiplyScalar(.82+b.random*.22);this.beads.setColorAt(i,c);return;}
      if(lightTheme)c.copy(accent).lerp(secondary,band).lerp(illumination,.62+highlight*.2);
      else{c.copy(dark).lerp(accent,.08+band*.61).lerp(fg,highlight*.36);if(Math.sin(b.u*2.3+b.w*.9)>.9)c.lerp(secondary,.66);}
      const occlusion=(lightTheme?.7:.3)+(lightTheme?.3:.7)*(.5+.5*Math.cos(b.w));
      const sculpturalShade=(lightTheme?.65:.2)+(lightTheme?.35:.8)*Math.pow(.5+.5*Math.sin(b.u+.65),.7);
      c.multiplyScalar((.72+b.random*.43)*occlusion*sculpturalShade);this.beads.setColorAt(i,c);
    });this.beads.instanceColor.needsUpdate=true;
    this.orbitMaterials.forEach(m=>m.color.copy(accent).lerp(fg,.2));this.axisMaterial.color.copy(fg);this.particleMaterial.uniforms.tint.value.copy(accent);
    this.trailMaterials.forEach((m,i)=>m.color.copy(i===3?secondary:accent).lerp(fg,.2).multiplyScalar(2.4));this.rippleUniforms.uSignalColor.value.copy(accent);if(!reference)this.rippleUniforms.uSignalColor.value.lerp(fg,.15);
    this.cageMaterial.color.set(reference?'#bd4f44':p.accent||'#bd945e');this.coreMaterial.color.set('#ffffff');this.coreMaterial.emissive.copy(secondary).lerp(fg,.24);
    this.coreLineMaterial.color.copy(secondary);
    const cc=new THREE.Color();this.coreCellData.forEach((cell,i)=>{if(reference)cc.copy(secondary).offsetHSL(i%4===0?-.12:i%3===0?.025:0,0,-.1+(i%3)*.04).lerp(fg,i===0?.6:i%3===0?.25:.07);else cc.copy(secondary).lerp(fg,(i%5)/7);this.coreCells.setColorAt(i,cc);});this.coreCells.instanceColor.needsUpdate=true;
  }

  resize() {
    if(this.disposed)return;const rect=this.host.getBoundingClientRect();const w=Math.max(1,rect.width),h=Math.max(1,rect.height);this.size={w,h};
    const ratio=Math.min(devicePixelRatio||1,1.7);
    if(this.fallback){this.canvas.width=Math.round(w*ratio);this.canvas.height=Math.round(h*ratio);this.ctx?.setTransform(ratio,0,0,ratio,0,0);return;}
    this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    const rw=Math.round(w*this.renderer.getPixelRatio()),rh=Math.round(h*this.renderer.getPixelRatio());this.target.setSize(rw,rh);this.bloomA.setSize(Math.max(1,Math.round(rw/2)),Math.max(1,Math.round(rh/2)));this.bloomB.setSize(Math.max(1,Math.round(rw/2)),Math.max(1,Math.round(rh/2)));this.postMaterial.uniforms.resolution.value.set(rw,rh);
  }

  tick(now) {
    if(this.disposed)return;this.raf=requestAnimationFrame(this.tick);if(document.hidden||this.contextLost){this.lastFrame=now;return;}
    const elapsed=(now-this.lastFrame)/1000,dt=Math.min(.045,elapsed);this.lastFrame=now;const v=this.getVisual()||{},p=this.getPalette()||{},a=this.getActivity()||{};
    this.updateOrbit(dt);
    const frozen=!!v.freeze; const motion=this.reducedMotion.matches?.13:1;
    if(!frozen)this.time+=dt*motion;const phase=frozen?value(v,'phase',0,0,1)*TAU*5:this.time;
    const target=clamp(Number(a.energy)||0,0,1);if(!frozen)this.energy+=(target-this.energy)*(1-Math.exp(-dt*(target>this.energy?18:5)));
    const signal=this.signalActivity(a,frozen),response=this.parameterState(signal,Math.min(.2,elapsed)),effective=this.shapeForSound(v,response);this.effectiveVisual=effective;
    if(this.fallback){this.prepareParticleLayer(now);this.drawFallback(effective,p,signal,phase);this.updateContacts();this.presentParticleLayer();return;}
    this.updateGeometry(effective);if(value(v,'seed',42)!==this.particleSeed){this.buildParticles(value(v,'seed',42));this.paletteSignature='';}this.updatePalette(v,p);this.updateSignalObjects(effective,p,signal,phase,frozen);
    const speed=value(v,'speed',.12,-2,2),idle=value(v,'idle',.35,0,1),reaction=value(v,'reactivity',.6,0,2);
    const targetRotation=value(v,'rotation',0,-6.3,6.3)+phase*speed*.16;
    this.rotationZ??=targetRotation;this.rotationZ+=(targetRotation-this.rotationZ)*(frozen?1:1-Math.exp(-dt*(3+(1-value(v,'damping',.55,0,1))*14)));
    this.ringGroup.rotation.set(-value(v,'tilt',.55,-1.5,1.5),-.16+Math.sin(phase*.08)*.06*idle,this.rotationZ,p.reference?'ZXY':'XYZ');this.ringGroup.position.y=.16;
    const scale=value(v,'scale',1,.5,1.8)*(1+this.energy*.022*reaction);this.ringGroup.scale.set(scale,scale,scale*value(v,'depth',1,.3,2));
    this.rippleUniforms.uBreath.value=this.reducedMotion.matches?0:value(v,'beadBreath',.14,0,.25);this.rippleUniforms.uBreathRate.value=value(v,'beadBreathRate',8,2,20);this.rippleUniforms.uBreathTime.value=this.time;
    this.rippleUniforms.uTime.value=phase;this.rippleUniforms.uEnergy.value=this.energy*reaction;this.rippleUniforms.uTurbulence.value=value(v,'turbulence',.2,0,2);if(!frozen&&a.note!=null)this.rippleUniforms.uNote.value=(Number(a.note)%12)/12*TAU;
    const trail=value(v,'trail',.35,0,1);this.trails.rotation.z=phase*speed*.13;this.trails.scale.setScalar((value(v,'ringRadius',1.7)+value(v,'ringThickness',.55))/2.25);this.trails.children.forEach((line,i)=>{line.geometry.setDrawRange(0,Math.round(24+trail*217));line.material.opacity=(.18+this.energy*.5)*trail*(1-i*.12);});
    this.material.roughness=clamp(value(v,'roughness',p.reference?.7:.32,.05,1)*(1-response.focus*.16),.05,1);this.material.metalness=p.reference?value(v,'metalness',.1)*.35:value(v,'metalness',.75,0,1);this.material.envMapIntensity=p.reference?.28:.78+value(v,'glow',.45,0,2)*.25;
    this.keyLight.intensity=(p.reference?1.25:2.1)*(.8+response.brightness*.28);this.fillLight.intensity=p.reference?.65:.85;this.rimLight.intensity=p.reference?3.5:42;
    const la=value(v,'lightAngle',45,-360,360)*Math.PI/180;this.keyLight.position.set(Math.cos(la)*4,Math.sin(la)*4,5);this.ambient.intensity=value(v,'ambient',.6,0,2)*1.5;
    this.renderer.toneMappingExposure=value(v,'exposure',1,.3,2.5);
    const fov=value(v,'perspective',35,20,65);if(fov!==this.camera.fov){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    this.updateCageBounds();this.applyOrbitCamera();
    this.updateOrbitGuides(v,p,phase,speed);this.trails.visible=!p.reference;
    this.particles.visible=!p.reference;this.particles.geometry.setDrawRange(0,Math.floor(1800*value(v,'particleDensity',.5,0,1.2)/1.2));this.particleMaterial.uniforms.t.value=phase;this.particleMaterial.uniforms.size.value=value(v,'particleSize',1,.2,3);this.particleMaterial.uniforms.energy.value=this.energy;this.particleMaterial.uniforms.opacity.value=.35+value(v,'trail',.35,0,1)*.5;
    const u=this.postMaterial.uniforms;for(const[k,d,min,max]of[['glow',.45,0,2],['grain',.06,0,1],['vignette',.35,0,1],['contrast',1.08,.5,1.8],['saturation',1,0,2],['blur',0,0,1],['scanlines',0,0,1],['fringe',0,0,1]])u[k].value=value(v,k,d,min,max);
    u.blur.value=value(v,'blur',0,0,4)/4;u.exposure.value=value(v,'exposure',1,.3,2.5);u.temperature.value=value(v,'temperature',0,-1,1);u.tint.value=value(v,'tint',0,-1,1);u.hue.value=value(v,'hue',0,-180,180)*Math.PI/180;u.phase.value=frozen?phase:Math.floor(phase*12);
    this.updateContactSignals(a);this.updateContacts();this.updateCageOverflow(v);this.prepareParticleLayer(now);
    this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);
    if(u.glow.value>.001){this.postQuad.material=this.blurMaterial;this.blurMaterial.uniforms.source.value=this.target.texture;this.blurMaterial.uniforms.threshold.value=value(v,'glowThreshold',.55,0,1);const radius=.7+value(v,'glowRadius',.4,0,1)*3.4;
    this.blurMaterial.uniforms.direction.value.set(radius/this.bloomA.width,0);this.renderer.setRenderTarget(this.bloomA);this.renderer.render(this.postScene,this.postCamera);
    this.blurMaterial.uniforms.source.value=this.bloomA.texture;this.blurMaterial.uniforms.threshold.value=0;this.blurMaterial.uniforms.direction.value.set(0,radius/this.bloomA.height);this.renderer.setRenderTarget(this.bloomB);this.renderer.render(this.postScene,this.postCamera);}
    this.postQuad.material=this.postMaterial;this.renderer.setRenderTarget(null);this.renderer.render(this.postScene,this.postCamera);this.presentParticleLayer();
    this.frame++;
    this.frameAverage=(this.frameAverage??.016)*.96+elapsed*.04;
    if(this.frame>90&&!this.qualityReduced&&this.frameAverage>.028){this.qualityReduced=true;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1));this.target.samples=0;this.target.dispose();this.resize();}
  }

  drawFallback(v,p,a,t) {
    a=this.signalActivity(a,!!v.freeze);
    const c=this.ctx;if(!c)return;const{w,h}=this.size,reference=!!p.reference;c.clearRect(0,0,w,h);
    const cx=w*.5,cy=h*.48,R=this.fallbackUnit(v)*value(v,'ringRadius',1.7),r=R*value(v,'ringThickness',.55)/value(v,'ringRadius',1.7),{tilt,rotation}=this.fallbackPose(v);
    const screen=(x,y)=>({x:cx+(x-cx)*Math.cos(rotation)-(y-cy)*Math.sin(rotation),y:cy+(x-cx)*Math.sin(rotation)+(y-cy)*Math.cos(rotation)});
    c.save();c.translate(cx,cy);c.rotate(rotation);c.translate(-cx,-cy);this.fallbackCore=[];
    const accent=p.accent||'#ffe579',fg=p.fg||'#f4f4ff',voices=Array.isArray(a.voices)?a.voices:[];
    this.updateContactSignals(this.getActivity());
    const envelopes=Array.from({length:8},(_,i)=>this.contactVoices.has(i)?0:clamp(Number(voices.find(x=>x.index===i)?.envelope)||0,0,1));
    if(reference){
      const padding=Math.max(4,R*.07),beadRadius=Math.max(1.3,R*.026)*1.35,halfWidth=R+r+beadRadius+padding,halfHeight=R*Math.abs(Math.cos(tilt))+r+beadRadius+padding;
      this.fallbackCageBounds={left:cx-halfWidth,right:cx+halfWidth,top:cy-halfHeight,bottom:cy+halfHeight,rotation};
      c.strokeStyle=accent;c.lineWidth=.8;
      const spacing=value(v,'gridSpacing',1,.4,2.5),grid=value(v,'gridOpacity',.2,0,1);
      for(let i=0;i<7;i++){const radius=(R+r)*(1.08+spacing*.2)*(1+i*.075/2.45),inclination=[.96,.64,.36,.78,.49,.22,.57][i];c.globalAlpha=grid*(i%2?.34:.55);c.beginPath();c.ellipse(cx,cy,radius,radius*inclination,i*.39+t*value(v,'speed',.12)*.025,0,TAU);c.stroke();}
      c.globalAlpha=1;
    }
    const response=this.response||this.parameterState(a,.016),coreRadius=R*(.46+response.brightness*.27),polySides=response.waveform==='square'?4:response.waveform==='triangle'?3:response.waveform==='sawtooth'?5:8;
    const drawCore=()=>{for(let i=0;i<(reference?30:0);i++){const angle=i*2.39996,radius=Math.sqrt(i/30)*coreRadius,x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius*Math.cos(tilt),size=R*.14*(1+this.energy*.1),polygon=[];c.beginPath();for(let j=0;j<polySides;j++){const theta=j/polySides*TAU,px=x+Math.cos(theta)*size,py=y+Math.sin(theta)*size*.8;polygon.push(screen(px,py));if(j)c.lineTo(px,py);else c.moveTo(px,py);}c.closePath();this.fallbackCore.push(polygon);c.fillStyle=reference?['#4ae2ef','#59d4fa','#47ceac','#54b9d8'][i%4]:p.secondary;c.globalAlpha=.6+this.energy*.3;c.fill();c.strokeStyle=reference?'#8defff':fg;c.lineWidth=.5;c.stroke();}c.globalAlpha=1;};
    const beads=[];const rows=reference?80:100,cols=reference?20:25;
    for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){const u=i/rows*TAU,vv=j/cols*TAU;const x=(R+r*Math.cos(vv))*Math.cos(u),y=(R+r*Math.cos(vv))*Math.sin(u),z=r*Math.sin(vv);const sector=Math.round(u/TAU*8)%8;beads.push({x:cx+x,y:cy+y*Math.cos(tilt)-z*Math.sin(tilt),z:y*Math.sin(tilt)+z*Math.cos(tilt),lit:.55+.45*(.5+.5*Math.sin(vv-u)),sector,instanceId:i*cols+j,u,w:vv,local:{x:x/(R/value(v,'ringRadius',1.7)),y:-y/(R/value(v,'ringRadius',1.7)),z:z/(R/value(v,'ringRadius',1.7))}});}
    beads.sort((a,b)=>a.z-b.z);const size=Math.max(1.3,R*(reference?.026:.023));
    let midplanePainted=false;const drawMidplane=()=>{this.drawFallbackParticleLayer();drawCore();midplanePainted=true;};
    for(const b of beads){if(!midplanePainted&&b.z>=0)drawMidplane();const point=screen(b.x,b.y);b.screenX=point.x;b.screenY=point.y;let active=sectorEnvelope(b.u,envelopes);for(const touch of this.contactVoices.values()){const radius=touch.local?touch.localRadius:touch.radius,distance=touch.local?Math.hypot(b.local.x-touch.local.x,b.local.y-touch.local.y,b.local.z-touch.local.z):Math.hypot(point.x-touch.x,point.y-touch.y),t=clamp((distance-radius*.3)/(radius*.7),0,1);active=Math.max(active,(1-t*t*(3-2*t))*touch.visualStrength);}const gradient=c.createRadialGradient(b.x-size*.32,b.y-size*.4,size*.08,b.x,b.y,size);gradient.addColorStop(0,active>.08?'#fffdd3':reference?'#e4deef':fg);gradient.addColorStop(.45,active>.08?'#fff1a2':reference?'#b3a8cb':accent);gradient.addColorStop(1,reference?'#5a527a':'#171a18');c.fillStyle=gradient;c.globalAlpha=.78+b.lit*.22;c.beginPath();b.radius=size*(beadBreathing(b.u,b.w,this.time||0,this.reducedMotion?.matches?0:value(v,'beadBreath',.14,0,.25),value(v,'beadBreathRate',8,2,20),value(v,'seed',42))+active*.1);c.arc(b.x,b.y,b.radius,0,TAU);c.fill();}this.fallbackBeads=beads;if(!midplanePainted)drawMidplane();c.globalAlpha=1;
    // The low-cost fallback retains the same parameter guides on a clear canvas.
    const total=response.attack+response.decay+.5+response.release;
    c.strokeStyle=p.secondary||'#79d9ff';c.globalAlpha=.38;c.lineWidth=1;c.beginPath();
    for(let i=0;i<=128;i++){const at=i/128*total;let env;if(at<response.attack)env=at/response.attack;else if(at<response.attack+response.decay)env=response.sustain+(1-response.sustain)*(1-(at-response.attack)/response.decay)**2;else if(at<response.attack+response.decay+.5)env=response.sustain;else env=response.sustain*Math.max(0,1-(at-response.attack-response.decay-.5)/response.release)**2;const angle=i/128*TAU-Math.PI*.5,radius=R*(.67-.15*(1-env));const x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius*Math.cos(tilt)-R*.08;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.stroke();
    c.strokeStyle=accent;for(let k=0;k<1+Math.ceil(response.feedback/.7*4);k++){c.globalAlpha=response.delay*.5*(.25+response.feedback)**k;c.beginPath();c.ellipse(cx,cy,R*(1.35+k*(.03+response.delay*.12)),R*(1.35+k*(.03+response.delay*.12))*Math.abs(Math.cos(tilt)),0,-.35-k*.2,.45+response.delay*2-k*.2);c.stroke();}c.globalAlpha=1;
    if(reference){c.font='bold '+Math.max(9,Math.round(R*.085))+'px '+UI_FONT;c.textAlign='center';c.textBaseline='middle';for(let i=0;i<8;i++){const theta=i/8*TAU,voice=voices.find(x=>x.index===i&&x.envelope>.02&&!this.contactVoices.has(i));c.fillStyle=voice?'#fff7ae':'#ecedff';c.fillText(voice?String(voice.midi):String(i+1).padStart(2,'0'),cx+Math.cos(theta)*R*1.4,cy+Math.sin(theta)*R*1.4*Math.cos(tilt));}
      const phase=markerTime(a,t,response.lfoRate);c.strokeStyle='#69ff8c';c.lineWidth=1.2;c.beginPath();c.ellipse(cx+Math.cos(phase)*R*(1.4+response.lfoDepth*.3),cy+Math.sin(phase)*R*Math.cos(tilt)*(1.4+response.lfoDepth*.3),R*.055,R*.04,phase,0,TAU);c.stroke();}
    c.restore();
  }

  capture() { try { return this.canvas.toDataURL('image/png'); } catch { return null; } }
  dispose() {
    this.disposed=true;this.releaseParticleLayer();this.particleTexture?.dispose();this.clearContacts();cancelAnimationFrame(this.raf);this.observer?.disconnect();this.cageOverflow?.svg.remove();
    if(this.scene)this.scene.traverse(o=>{o.geometry?.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
    this.voiceLabels?.forEach(item=>item.texture.dispose());this.target?.dispose();this.bloomA?.dispose();this.bloomB?.dispose();this.postMaterial?.dispose();this.blurMaterial?.dispose();this.postQuad?.geometry.dispose();this.environment?.dispose();this.renderer?.dispose();this.canvas.remove();
  }
}
