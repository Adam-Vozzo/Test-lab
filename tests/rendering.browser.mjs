// Native Canvas2D/WebGL regression checks. Run from a served project in a browser:
// await (await import('./tests/rendering.browser.mjs')).runRenderingChecks()
// Uses the production renderer/shader, not a JS approximation of its color math.
import * as THREE from '../vendor/three.module.min.js';
import {RingScene} from '../ring.js';

const require=(condition,message)=>{if(!condition)throw new Error(message);};
const pixel=(data,width,x,y)=>Array.from(data.slice((y*width+x)*4,(y*width+x)*4+4));
const painted=canvas=>{const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,copy.width,copy.height).data;};
const error=(actual,expected)=>{let total=0,max=0,alpha=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let k=0;k<3;k++){const difference=Math.abs(actual[i+k]*actual[i+3]/255-expected[i+k]*expected[i+3]/255);total+=difference;max=Math.max(max,difference);}}return{mean:total/(actual.length*.75),max,alpha};};

export async function runRenderingChecks(){
  const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:192px;height:128px;pointer-events:none;';document.body.append(host);
  const ring=new RingScene(host);cancelAnimationFrame(ring.raf);
  require(!ring.fallback,'Native WebGL is required for the rendering regression');
  const report={premultiplied: ring.renderer.getContext().getContextAttributes().premultipliedAlpha,cases:[]};
  require(report.premultiplied,'Browser canvas must use premultiplied alpha');
  const originalScene=ring.scene;ring.scene=new THREE.Scene();ring.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);ring.camera.position.z=2;ring.camera.updateMatrixWorld();ring.ringGroup.position.set(0,0,0);ring.ringGroup.updateMatrixWorld(true);
  ring.renderer.setPixelRatio(1);ring.resize();
  const u=ring.postMaterial.uniforms;
  for(const [key,val]of Object.entries({glow:0,grain:0,vignette:0,contrast:1,saturation:1,hue:0,blur:0,scanlines:0,fringe:0,exposure:1,temperature:0,tint:0}))u[key].value=val;
  const source=document.createElement('canvas'),ctx=source.getContext('2d');source.width=ring.canvas.width*2;source.height=ring.canvas.height;
  const w=ring.canvas.width,h=ring.canvas.height;
  const layer={canvas:source,width:source.width,height:h,version:1,ring:{x:w,y:0,w,h}};ring.setParticleLayerProvider(()=>layer);
  const render=()=>{ring.prepareParticleLayer(0);ring.renderer.setRenderTarget(ring.target);ring.renderer.render(ring.scene,ring.camera);ring.postQuad.material=ring.postMaterial;ring.renderer.setRenderTarget(null);ring.renderer.render(ring.postScene,ring.postCamera);return painted(ring.canvas);};
  const expected=()=>{const copy=document.createElement('canvas');copy.width=w;copy.height=h;const c=copy.getContext('2d');c.drawImage(source,w,0,w,h,0,0,w,h);return c.getImageData(0,0,w,h).data;};
  try{
    for(const samples of [0,Math.min(4,ring.renderer.capabilities.maxSamples)]){
      ring.target.samples=samples;ring.target.dispose();
      for(const color of ['#ff0088','#79d9ff','#ffffff']){
        ctx.clearRect(0,0,source.width,h);ctx.globalCompositeOperation='source-over';
        for(let i=0;i<8;i++){ctx.globalAlpha=[0,.01,.08,.25,.5,.75,.99,1][i];ctx.fillStyle=color;ctx.fillRect(w+i*w/8,0,w/8,h);}
        ctx.globalAlpha=1;layer.version++;const result=error(render(),expected());report.cases.push({kind:'alpha-ramp',samples,color,...result});
        require(result.max<2&&result.alpha<2,'Particle alpha ramp differs across canvas boundary: '+JSON.stringify(report.cases.at(-1)));
      }
      // High-signal additive bloom must retain the transparent gaps between dots.
      ctx.clearRect(0,0,source.width,h);ctx.globalCompositeOperation='lighter';ctx.filter='blur(14px)';ctx.fillStyle='#ff0088';ctx.fillRect(w+12,12,w-24,h-24);ctx.filter='none';
      for(let y=4;y<h;y+=8)for(let x=w+4;x<w*2;x+=8){ctx.beginPath();ctx.arc(x,y,2.7,0,Math.PI*2);ctx.fill();}
      layer.version++;const bloom=error(render(),expected());report.cases.push({kind:'saturated-bloom',samples,...bloom});require(bloom.max<2&&bloom.alpha<2,'Additive bloom loses coverage: '+JSON.stringify(bloom));

      // Opaque front surfaces occlude BOTH color and alpha; rear surfaces stay
      // underneath the centre-plane field, including under an inverted camera.
      for(const cameraZ of [2,-2]){
        ring.camera.position.z=cameraZ;ring.camera.lookAt(0,0,0);ring.camera.updateMatrixWorld();
        const surface=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:'#315c84',side:THREE.DoubleSide}));ring.scene.add(surface);
        ctx.clearRect(0,0,source.width,h);ctx.fillStyle='#ff0088';ctx.globalCompositeOperation='source-over';ctx.globalAlpha=.75;ctx.fillRect(0,0,source.width,h);ctx.globalAlpha=1;layer.version++;
        surface.position.z=Math.sign(cameraZ)*.3;u.particleEnabled.value=0;ring.setParticleLayerProvider(null);const frontBefore=render();ring.setParticleLayerProvider(()=>layer);const front=render();
        const frontError=error(front,frontBefore);require(frontError.max===0&&frontError.alpha===0,'Particles leak through the front surface');
        surface.position.z=-Math.sign(cameraZ)*.3;const rear=render(),center=Math.floor(h/2)*w+Math.floor(w/2);require(rear[center*4]>front[center*4]+50,'Particles fail to cover the rear surface');report.cases.push({kind:'depth',samples,cameraZ,frontError});ring.scene.remove(surface);surface.geometry.dispose();surface.material.dispose();
      }
      ring.camera.position.z=2;ring.camera.lookAt(0,0,0);ring.camera.updateMatrixWorld();ring.setParticleLayerProvider(null);

      // A translucent pink guide has the same chroma as an opaque pink surface.
      // Fringe/blur must not attenuate R/B by alpha while leaving G unchanged.
      const guide=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:'#e83b77',transparent:true}));ring.scene.add(guide);
      Object.assign(u.hue,{value:-31*Math.PI/180});u.fringe.value=.25;u.blur.value=.25;
      guide.material.opacity=1;const opaque=pixel(render(),w,Math.floor(w*.7),Math.floor(h*.4));guide.material.opacity=.17;const translucent=pixel(render(),w,Math.floor(w*.7),Math.floor(h*.4));const chromaError=Math.max(...opaque.slice(0,3).map((v,i)=>Math.abs(v-translucent[i])*translucent[3]/255));report.cases.push({kind:'guide-chroma',samples,opaque,translucent,chromaError});require(chromaError<1.1,'Translucent guide changes hue under fringe/blur: '+JSON.stringify(report.cases.at(-1)));
      ring.scene.remove(guide);guide.geometry.dispose();guide.material.dispose();u.hue.value=0;u.fringe.value=0;u.blur.value=0;ring.setParticleLayerProvider(()=>layer);
    }
    return report;
  }finally{ring.scene=originalScene;ring.dispose();host.remove();}
}
