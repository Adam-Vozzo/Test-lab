import {clamp,rgba,seeded,roundedRect} from './kit.js';

// The glass and raster are rendered in CSS coordinates. Optical distortion is
// confined to the glass, so a displayed target and its touch target stay aligned.
export class ReceiverRenderer {
  constructor(){
    this.background=document.createElement('canvas');this.key='';
    this.noise=[];const random=seeded(1983);
    for(let f=0;f<6;f++){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
      const c=canvas.getContext('2d'),pixels=c.createImageData(128,128);
      for(let i=0;i<pixels.data.length;i+=4){const n=Math.floor(random()*255);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=n;pixels.data[i+3]=255;}
      c.putImageData(pixels,0,0);this.noise.push(canvas);
    }
  }
  draw(c,l,v,t,reduced=false){
    const f=l.frame,key=[l.w,l.h,v.screenColour,v.exposure,v.curvature,v.edgeShade].join(':');
    if(key!==this.key){
      this.key=key;const canvas=this.background;canvas.width=Math.ceil(l.w);canvas.height=Math.ceil(l.h);const b=canvas.getContext('2d');
      b.fillStyle='#040708';b.fillRect(0,0,l.w,l.h);b.save();roundedRect(b,f.x,f.y,f.w,f.h,l.radius);b.clip();
      const base=parseInt(v.screenColour.slice(1),16),channels=[base>>16,(base>>8)&255,base&255].map(n=>Math.round(clamp(n*v.exposure,0,190)));b.fillStyle=`rgb(${channels.join(',')})`;b.fillRect(f.x,f.y,f.w,f.h);
      const lift=b.createRadialGradient(l.w*.47,l.h*.54,10,l.w*.5,l.h*.5,Math.hypot(l.w,l.h)*.58);
      lift.addColorStop(0,`rgba(134,162,169,${.13*v.exposure})`);lift.addColorStop(.54,`rgba(67,99,114,${.08*v.exposure})`);lift.addColorStop(1,'rgba(5,14,19,.3)');b.fillStyle=lift;b.fillRect(f.x,f.y,f.w,f.h);
      // Broad mottling is baked once, avoiding a per-frame full-screen noise shader.
      const random=seeded(61);for(let i=0;i<23;i++){const x=random()*l.w,y=random()*l.h,r=(.08+random()*.2)*Math.max(l.w,l.h),g=b.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(${i%2?'98,132,143':'3,15,23'},.055)`);g.addColorStop(1,'rgba(0,0,0,0)');b.fillStyle=g;b.fillRect(0,0,l.w,l.h);}
      const haze=document.createElement('canvas');haze.width=haze.height=96;const hc=haze.getContext('2d'),hp=hc.createImageData(96,96),grids=[7,17,41].map(n=>({n,data:Array.from({length:(n+1)*(n+1)},()=>random())}));
      for(let y=0;y<96;y++)for(let x=0;x<96;x++){let value=0;for(let layer=0;layer<grids.length;layer++){const{n,data}=grids[layer],xx=x/96*n,yy=y/96*n,ix=Math.floor(xx),iy=Math.floor(yy),tx=xx-ix,ty=yy-iy,a=data[iy*(n+1)+ix]*(1-tx)+data[iy*(n+1)+ix+1]*tx,d=data[(iy+1)*(n+1)+ix]*(1-tx)+data[(iy+1)*(n+1)+ix+1]*tx;value+=(a*(1-ty)+d*ty)*[.6,.28,.12][layer];}const i=(y*96+x)*4,n=Math.round(128+(value-.5)*195);hp.data[i]=hp.data[i+1]=hp.data[i+2]=n;hp.data[i+3]=255;}hc.putImageData(hp,0,0);b.save();b.globalCompositeOperation='soft-light';b.globalAlpha=.72;b.drawImage(haze,f.x,f.y,f.w,f.h);b.restore();
      const vignette=b.createRadialGradient(l.w*.5,l.h*.5,Math.min(l.w,l.h)*.15,l.w*.5,l.h*.5,Math.hypot(l.w,l.h)*.55);
      vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(.65,`rgba(0,4,6,${v.edgeShade*.18})`);vignette.addColorStop(1,`rgba(0,2,4,${v.edgeShade*.78})`);b.fillStyle=vignette;b.fillRect(0,0,l.w,l.h);
      for(const [axis,reverse]of [['x',false],['x',true],['y',false],['y',true]]){
        const horizontal=axis==='x',span=(horizontal?f.w:f.h)*(.025+v.curvature*.035),start=reverse?(horizontal?f.x+f.w:f.y+f.h):(horizontal?f.x:f.y),end=start+(reverse?-span:span),g=horizontal?b.createLinearGradient(start,0,end,0):b.createLinearGradient(0,start,0,end);
        g.addColorStop(0,`rgba(0,2,3,${.7+v.edgeShade*.25})`);g.addColorStop(.42,`rgba(0,3,5,${v.edgeShade*.35})`);g.addColorStop(1,'rgba(0,3,5,0)');b.fillStyle=g;if(horizontal)b.fillRect(Math.min(start,end),f.y,span,f.h);else b.fillRect(f.x,Math.min(start,end),f.w,span);
      }
      b.restore();b.strokeStyle='rgba(132,160,171,.025)';b.lineWidth=.8;roundedRect(b,f.x+.8,f.y+.8,f.w-1.6,f.h-1.6,l.radius);b.stroke();
    }
    c.drawImage(this.background,0,0,l.w,l.h);c.save();roundedRect(c,f.x,f.y,f.w,f.h,l.radius);c.clip();
    if(v.grain>0){const noise=this.noise[reduced?0:Math.floor(t*12)%this.noise.length];c.globalCompositeOperation='soft-light';c.globalAlpha=v.grain;c.save();c.imageSmoothingEnabled=false;c.scale(v.grainScale,v.grainScale);c.fillStyle=c.createPattern(noise,'repeat');c.fillRect(0,0,l.w/v.grainScale,l.h/v.grainScale);c.restore();c.globalAlpha=1;c.globalCompositeOperation='source-over';}
    if(v.scanlines>0){c.fillStyle=rgba('#020709',v.scanlines*.2);for(let y=f.y;y<f.y+f.h;y+=3){c.fillRect(f.x,y,f.w,.7);}}
    if(v.rasterDrift>0&&!reduced){const y=f.y+((t*.013)%1)*f.h,h=Math.max(20,f.h*.14),band=c.createLinearGradient(0,y-h,0,y+h);band.addColorStop(0,'rgba(150,172,178,0)');band.addColorStop(.5,`rgba(150,172,178,${v.rasterDrift*.018})`);band.addColorStop(1,'rgba(150,172,178,0)');c.fillStyle=band;c.fillRect(f.x,y-h,f.w,h*2);}
    c.restore();
  }
  dispose(){this.background.width=this.background.height=1;for(const noise of this.noise)noise.width=noise.height=1;this.noise.length=0;}
}

// Compact raster lettering, independent of installed fonts. Non-ASCII musical
// accidentals fall back to their conventional ASCII spelling at the call site.
const GLYPHS={
 A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['111','010','010','010','010','010','111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
 '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['010','110','010','010','010','010','111'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],
 '.':['0','0','0','0','0','1','1'],':':['0','1','1','0','1','1','0'],'-':['000','000','000','111','000','000','000'],'/':['00001','00001','00010','00100','01000','10000','10000'],'+':['000','010','010','111','010','010','000'],'#':['01010','11111','01010','01010','11111','01010','00000']
};
const TEXT_CACHE=new Map();
export function rasterText(c,text,x,y,size=10,colour='#c4d0cd',align='left',spacing=1){
  const value=String(text).toUpperCase().replaceAll('♯','#').replaceAll('♭','B'),scale=size/7;
  const widths=[...value].map(char=>(GLYPHS[char]?.[0].length||3)+spacing),width=widths.reduce((a,b)=>a+b,0)*scale;
  const match=/^rgba\((.*),([\d.]+)\)$/.exec(colour),opacity=match?Number(match[2]):1,ink=match?'rgb('+match[1]+')':colour;
  const key=[value,size,ink,spacing].join('|');let bitmap=TEXT_CACHE.get(key);
  if(!bitmap){
    bitmap=document.createElement('canvas');bitmap.width=Math.max(1,Math.ceil(width*2));bitmap.height=Math.max(1,Math.ceil(size*2));const b=bitmap.getContext('2d');b.scale(2,2);b.fillStyle=ink;let px=0;
    for(const char of value){const glyph=GLYPHS[char];if(glyph)for(let yy=0;yy<7;yy++)for(let xx=0;xx<glyph[yy].length;xx++)if(glyph[yy][xx]==='1')b.fillRect(px+xx*scale,yy*scale,scale*.88,scale*.78);px+=((glyph?.[0].length||3)+spacing)*scale;}
    TEXT_CACHE.set(key,bitmap);if(TEXT_CACHE.size>192)TEXT_CACHE.delete(TEXT_CACHE.keys().next().value);
  }
  if(align==='right')x-=width;else if(align==='center')x-=width*.5;
  // One local halation operation per complete text block, rather than one blur
  // for every illuminated pixel; this keeps the raster affordable on iPad.
  c.save();c.globalAlpha*=opacity;c.drawImage(bitmap,x,y-size*.5,width,size);c.restore();return width;
}
