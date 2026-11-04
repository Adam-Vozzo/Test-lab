const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
let grainImage='';

export function sceneEffectSettings(appearance={}){
  return{blur:clamp(appearance.sceneBlur,0,6),grain:clamp(appearance.sceneGrain,0,.35),grainSize:clamp(appearance.sceneGrainSize??1,.5,2.5)};
}

function grainTexture(){
  if(grainImage)return grainImage;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const context=canvas.getContext('2d'),image=context.createImageData(96,96);
  let random=1073;for(let i=0;i<image.data.length;i+=4){random=(Math.imul(random,1664525)+1013904223)>>>0;const value=random>>>24;image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255;}
  context.putImageData(image,0,0);grainImage=canvas.toDataURL('image/png');return grainImage;
}

/** Native compositing preserves every canvas's stacking order and input bounds.
 * The only raster texture is a small, shared, tiled grain image. No GPU readback.
 */
export function createScenePostprocess(host){
  const scene=document.createElement('div');scene.className='instrument-scene';host.append(scene);
  const grain=document.createElement('div');grain.className='scene-film-grain';grain.setAttribute('aria-hidden','true');grain.style.backgroundImage=`url("${grainTexture()}")`;host.append(grain);
  let key='';
  return{scene,update(appearance){
    const settings=sceneEffectSettings(appearance),next=Object.values(settings).join(':');if(next===key)return;key=next;
    const {blur,grain:amount,grainSize}=settings;
    scene.style.filter=blur>0?`blur(${blur}px)`:'none';
    grain.style.mixBlendMode='soft-light';
    grain.style.opacity=amount;grain.style.display=amount>0?'block':'none';grain.style.backgroundSize=`${96*grainSize}px ${96*grainSize}px`;
    host.dataset.postprocess=blur>0?'blur-grain':amount>0?'grain':'none';
  },destroy(){scene.remove();grain.remove();delete host.dataset.postprocess;}};
}
