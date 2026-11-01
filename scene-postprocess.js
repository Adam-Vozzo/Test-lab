const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
let serial=0,grainImage='';
const NS='http://www.w3.org/2000/svg';
const element=(name,attributes={})=>{const node=document.createElementNS(NS,name);for(const[key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;};

export function sceneEffectSettings(appearance={}){
  return{bloom:clamp(appearance.sceneBloom,0,1),radius:clamp(appearance.sceneBloomRadius??12,1,28),threshold:clamp(appearance.sceneBloomThreshold??.65,.2,.95),blur:clamp(appearance.sceneBlur,0,6),grain:clamp(appearance.sceneGrain,0,.35),grainSize:clamp(appearance.sceneGrainSize??1,.5,2.5)};
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
  const svg=element('svg',{width:0,height:0,'aria-hidden':'true'});svg.classList.add('scene-filter-defs');
  const defs=element('defs'),id=`scene-bloom-${++serial}`,filter=element('filter',{id,x:'-15%',y:'-15%',width:'130%',height:'130%','color-interpolation-filters':'sRGB'});
  const luminance=element('feColorMatrix',{in:'SourceGraphic',type:'matrix',values:'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0',result:'luminance'});
  const threshold=element('feComponentTransfer',{in:'luminance',result:'highlight-mask'}),thresholdAlpha=element('feFuncA',{type:'linear',slope:1,intercept:0});threshold.append(thresholdAlpha);
  const isolate=element('feComposite',{in:'SourceGraphic',in2:'highlight-mask',operator:'in',result:'highlights'});
  const bloomBlur=element('feGaussianBlur',{in:'highlights',stdDeviation:6,result:'spread'});
  const intensity=element('feComponentTransfer',{in:'spread',result:'glow'}),intensityAlpha=element('feFuncA',{type:'linear',slope:0});intensity.append(intensityAlpha);
  const combine=element('feBlend',{in:'SourceGraphic',in2:'glow',mode:'screen',result:'bloomed'});
  const finish=element('feGaussianBlur',{in:'bloomed',stdDeviation:0});
  filter.append(luminance,threshold,isolate,bloomBlur,intensity,combine,finish);defs.append(filter);svg.append(defs);host.append(svg);
  const grain=document.createElement('div');grain.className='scene-film-grain';grain.setAttribute('aria-hidden','true');grain.style.backgroundImage=`url("${grainTexture()}")`;host.append(grain);
  let key='';
  return{scene,update(appearance){
    const settings=sceneEffectSettings(appearance),next=Object.values(settings).join(':');if(next===key)return;key=next;
    const {bloom,radius,threshold:value,blur,grain:amount,grainSize}=settings;
    thresholdAlpha.setAttribute('slope',1/(1-value));thresholdAlpha.setAttribute('intercept',-value/(1-value));
    bloomBlur.setAttribute('stdDeviation',radius*.5);intensityAlpha.setAttribute('slope',bloom*.8);finish.setAttribute('stdDeviation',blur);
    // A zero-effect look never incurs the SVG compositor pass.
    scene.style.filter=bloom>0?`url("#${id}")`:blur>0?`blur(${blur}px)`:'none';
    grain.style.opacity=amount;grain.style.display=amount>0?'block':'none';grain.style.backgroundSize=`${96*grainSize}px ${96*grainSize}px`;
    host.dataset.postprocess=bloom>0?'bloom-blur-grain':blur>0?'blur-grain':amount>0?'grain':'none';
  },destroy(){scene.remove();svg.remove();grain.remove();delete host.dataset.postprocess;}};
}
