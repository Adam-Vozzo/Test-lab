import {Matrix4,Euler} from '../vendor/three.module.min.js';
import {clamp,lerp,rgba} from './kit.js';
import {buildRoseGeometry,ROSE_CENTRES} from './roses-geometry.js';
export {ROSE_CENTRES} from './roses-geometry.js';
const GLYPHS='.,:-/\\|+=018%#@';
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const mix=(a,b,t)=>{a=a.replace('#','');b=b.replace('#','');return '#'+[0,2,4].map(i=>Math.round(lerp(parseInt(a.slice(i,i+2),16),parseInt(b.slice(i,i+2),16),t)).toString(16).padStart(2,'0')).join('');};

// Render continuous three-dimensional surfaces to a bounded colour/ID field,
// then read it through a fixed screen-space ASCII grid. The ID field shares the
// exact depth order and growth transform, so a touch selects the visible petal.
export class RosesRenderer{
 constructor(canvas,{mobile=false}={}){
  this.canvas=canvas;this.c=canvas.getContext('2d');this.mobile=mobile;this.matrix=new Matrix4();this.euler=new Euler();this.width=1;this.height=1;this.key='';this.atlasKey='';this.faces=[];this.lines=[];this.petals=[];this.hitPoints=[];this.projectedPetals=[];this.drawFaces=[];this.reveal=1;this.frameId=0;this.camera={yaw:-.2,pitch:-.08,zoom:1};
  this.glowField=document.createElement('canvas');this.glowC=this.glowField.getContext('2d');this.field=document.createElement('canvas');this.ids=document.createElement('canvas');this.fieldC=this.field.getContext('2d',{willReadFrequently:true});this.idC=this.ids.getContext('2d',{willReadFrequently:true});this.atlas=document.createElement('canvas');this.hits=new Map();this.fragments=[];this.flowerPoses=[];this.petalPoses=[];this._world={};this._screen={};
 }
 resize(w,h,dpr){this.width=w;this.height=h;this.dpr=dpr;}
 build(v){
  const key=[v.petalWidth,v.petalCurl,v.petalLayers,v.bloomScale,v.bouquetSpread,v.leafSize].join('|');if(key===this.key)return;this.key=key;
  const geometry=buildRoseGeometry(v);this.faces=geometry.faces;this.lines=geometry.lines;this.petals=geometry.petals;this.drawFaces=this.faces.slice();this.petalsById=new Map(this.petals.map(p=>[p.id,p]));let radius=2.05;for(const face of this.faces)for(const p of face.vertices){let x=p.x,y=p.y,z=p.z;if(p.flower>=0){const f=ROSE_CENTRES[p.flower],ax=f[4],ay=f[5];x*=1.18;y*=1.18;z+=.14;const yy=y*Math.cos(ax)-z*Math.sin(ax),zz=y*Math.sin(ax)+z*Math.cos(ax),xx=x*Math.cos(ay)+zz*Math.sin(ay);z=-x*Math.sin(ay)+zz*Math.cos(ay)+f[2];x=xx+f[0]*(v.bouquetSpread??1);y=yy+f[1];}radius=Math.max(radius,Math.hypot(x,y,z)+.035);}this.boundRadius=radius;
 }
 makeAtlas(v){
  const key=[v.petalColour,v.leafColour,v.glow,v.glowRadius,v.glyphStyle].join('|');if(key===this.atlasKey)return;this.atlasKey=key;const cell=24;this.atlas.width=GLYPHS.length*cell;this.atlas.height=3*8*cell;const c=this.atlas.getContext('2d');c.clearRect(0,0,this.atlas.width,this.atlas.height);c.font='bold 11px "SFMono-Regular",Consolas,monospace';c.textAlign='center';c.textBaseline='middle';
  for(let ink=0;ink<3;ink++)for(let level=0;level<8;level++)for(let ch=0;ch<GLYPHS.length;ch++){
   const col=ink===0?level<3?mix('#250414',v.petalColour,level/3):mix(v.petalColour,'#ffe3e6',Math.pow((level-3)/4,1.4)*.85):ink===1?mix(v.leafColour,'#e2ead1',level/7*.48):mix('#c8b583','#fff0c0',level/7*.6),x=ch*cell+12,y=(ink*8+level)*cell+12;
   c.globalAlpha=.13+Math.pow(level/7,.8)*.87;c.shadowColor=col;c.shadowBlur=(v.glow??.54)*(2+(v.glowRadius??.55)*6);c.fillStyle=col;if(v.glyphStyle==='dots')c.fillRect(x-1.4,y-1.4,2.8,2.8);else c.fillText(GLYPHS[ch],x,y+.5);
  }c.globalAlpha=1;c.shadowBlur=0;
 }
 transform(x,y,z,out={}){const e=this.matrix.elements,xx=e[0]*x+e[4]*y+e[8]*z,yy=e[1]*x+e[5]*y+e[9]*z,zz=e[2]*x+e[6]*y+e[10]*z,p=6.8/(6.8-zz),s=this.scale*p;out.x=this.width*.5+xx*s;out.y=this.height*.53-yy*s;out.z=zz;out.s=p;return out;}
 preparePose(v,t,energy){
  for(let f=0;f<ROSE_CENTRES.length;f++){const centre=ROSE_CENTRES[f],ax=centre[4],ay=centre[5],growth=.08+.92*smooth((this.reveal-.27-f*.025)/(.69-f*.025)),breath=1+(v.idleMotion??.5)*Math.sin(t*.65+f*2.2)*.012;this.flowerPoses[f]={cx:centre[0]*(v.bouquetSpread??1)+(v.idleMotion??.5)*Math.sin(t*.31+f)*.018,cy:centre[1],cz:centre[2],ca:Math.cos(ax),sa:Math.sin(ax),cb:Math.cos(ay),sb:Math.sin(ay),growth,breath};}
  for(const face of this.faces)if(!face.bloomNormal){let [nx,ny,nz]=face.normal;if(face.flower>=0){const f=this.flowerPoses[face.flower],yy=ny*f.ca-nz*f.sa,zz=ny*f.sa+nz*f.ca,xx=nx*f.cb+zz*f.sb;nz=-nx*f.sb+zz*f.cb;nx=xx;ny=yy;}face.bloomNormal=[nx,ny,nz];}
  for(const petal of this.petals){const p=this.flowerPoses[petal.flower],strength=energy[petal.id]||0;this.petalPoses[petal.id]={scale:(p.breath+strength*(v.response??.85)*.09)*p.growth,z:strength*(v.response??.85)*.075};}
 }
 world(p,v,t,energy,out){let x=p.x,y=p.y,z=p.z;
  if(p.flower>=0){const f=this.flowerPoses[p.flower],q=this.petalPoses[p.petal],scale=q?q.scale:f.breath*f.growth;x*=scale;y*=scale;z=z*f.growth+(q?q.z:0);const yy=y*f.ca-z*f.sa,zz=y*f.sa+z*f.ca,xx=x*f.cb+zz*f.sb;z=-x*f.sb+zz*f.cb;x=xx+f.cx;y=yy+f.cy;z+=f.cz;
  }else if(p.leaf>=0){const b=p.leaf,sy=p.leafBase??[-.44,-.82,-1.19,-1.48,.02][b],growth=smooth((this.reveal-.13-b*.025)/.35);x*=.08+.92*growth;y=sy+(y-sy)*growth;z*=growth;}
  out.x=x;out.y=y;out.z=z;return out;
 }
 projectPetal(id){return this.projectedPetals[id]||null;}
 pick(x,y){let best=null,distance=15*15;for(const p of this.hitPoints){const d=(x-p.x)**2+(y-p.y)**2;if(d<distance){distance=d;best=p;}}return best?{id:best.petal,flower:best.flower,x:best.x,y:best.y}:null;}
 draw(v,time,camera,energy,reveal=1,reduced=false){
  this.build(v);this.makeAtlas(v);this.camera={...camera};this.lastAppearance=v;this.lastEnergy=energy;this.lastMotionTime=reduced?0:time*(v.motionRate??1);this.reveal=reveal;this.frameId++;const c=this.c,w=this.width,h=this.height;c.clearRect(0,0,w,h);this.matrix.makeRotationFromEuler(this.euler.set(camera.pitch,camera.yaw,0,'YXZ'));const radius=this.boundRadius,projectedRadius=radius*6.8/Math.sqrt(6.8*6.8-radius*radius),available=Math.max(20,Math.min(w*.5,h*.47)-14);this.scale=available/projectedRadius/(1.08*1.15)*(v.sceneScale??1)*Math.min(1.08,camera.zoom);
  const t=reduced?0:time*(v.motionRate??1);this.preparePose(v,t,energy);const step=Math.max(Math.sqrt(w*h/80000),Math.max(3,Math.min(w,h)/164)*(v.glyphSize??1)/Math.sqrt(v.glyphDensity??1)),cols=Math.ceil(w/step),rows=Math.ceil(h/step),fieldScale=1/step;
  if(this.field.width!==cols||this.field.height!==rows){this.field.width=this.ids.width=this.glowField.width=cols;this.field.height=this.ids.height=this.glowField.height=rows;this.blurTemp=new Float32Array(cols*rows*4);this.blurPixels=new Uint8ClampedArray(cols*rows*4);this.rasterPixels=new Uint8ClampedArray(cols*rows*4);this.depth=new Float32Array(cols*rows);this.surfaceIds=new Uint16Array(cols*rows);this.density=new Uint8Array(cols*rows);}const fc=this.fieldC,ic=this.idC;fc.clearRect(0,0,cols,rows);ic.clearRect(0,0,cols,rows);const stemLevel=-2.1+smooth(reveal/.58)*4.3;
  for(const face of this.faces){let z=0,visible=true;for(let i=0;i<face.vertices.length;i++){const p=this.world(face.vertices[i],v,t,energy,this._world);if(p.y>stemLevel)visible=false;const screen=this.transform(p.x,p.y,p.z,face.screen[i]);z+=screen.z;}face.z=z/face.vertices.length;let [nx,ny,nz]=face.bloomNormal;const e=this.matrix.elements,rx=e[0]*nx+e[4]*ny+e[8]*nz,ry=e[1]*nx+e[5]*ny+e[9]*nz,rz=e[2]*nx+e[6]*ny+e[10]*nz;const sign=rz<0?-1:1;face.shade=.12+.79*Math.max(0,(-rx*.35+ry*.6+rz*.72)*sign)+.09*Math.pow(1-Math.abs(rz),3);face.visible=visible&&(face.flower<0||reveal>.26+face.flower*.025);}
  this.depth.fill(-1e9);this.density.fill(0);this.surfaceIds.fill(0);this.rasterPixels.fill(0);this.cols=cols;this.rows=rows;this.step=step;
  const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),pink=rgb(v.petalColour),green=rgb(v.leafColour);
  for(const face of this.faces){if(!face.visible)continue;const strength=face.petal>=0?(energy[face.petal]||0):0,light=clamp((face.shade-.14)*1.1+face.light*.17+strength*.18),low=face.ink===0?[29,1,13]:face.ink===1?[9,21,15]:[170,155,103],high=face.ink===0?pink:face.ink===1?green:[255,244,191],colour=low.map((v,i)=>Math.round(lerp(v,high[i],light))),code=face.petal>=0?(face.petal+1)|(face.ink===2?256:0):0;this.rasterTriangle(face.screen[0],face.screen[1],face.screen[2],colour,code);this.rasterTriangle(face.screen[0],face.screen[2],face.screen[3],colour,code);}
  // Thin structural traces share the sampled field, with fractional coverage.
  const a={},b={};for(const ln of this.lines){if(ln.ink===0)continue;this.world(ln.a,v,t,energy,this._world);if(this._world.y>stemLevel)continue;this.transform(this._world.x,this._world.y,this._world.z,a);this.world(ln.b,v,t,energy,this._world);if(this._world.y>stemLevel)continue;this.transform(this._world.x,this._world.y,this._world.z,b);this.rasterLine(a,b,green,ln.alpha);}
  const pixels=this.rasterPixels;fc.putImageData(new ImageData(pixels,cols,rows),0,0);
  this.drawGlow(pixels,cols,rows,v,w,h);let hitCount=0;const stamp=step*2.35,exposure=v.exposure??1;for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const offset=(y*cols+x)*4,r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2],alpha=pixels[offset+3]/255;if(alpha<.13)continue;const semantic=this.surfaceIds[y*cols+x],petalId=(semantic&255)-1,petal=petalId>=0?this.petalsById.get(petalId):null,ink=petal?(semantic&256?2:0):1,brightness=Math.max(r,g,b)/255,noise=((Math.imul(x+19,374761393)^Math.imul(y+31,668265263))>>>0)%100/100;
   const materialDensity=Math.min(1,.20+Math.log2(1+this.density[y*cols+x])*.27),level=clamp(Math.floor(Math.pow(brightness,.85)*8.2+(noise-.5)*.65),0,7),char=clamp(Math.floor(Math.pow(clamp(brightness*materialDensity*1.45+(noise-.5)*.12),.85)*(GLYPHS.length-1)),0,GLYPHS.length-1),sx=(x+.5)*step,sy=(y+.5)*step;c.globalAlpha=clamp(exposure*Math.sqrt(alpha)*(.86+noise*.14));c.drawImage(this.atlas,char*24,(ink*8+level)*24,24,24,sx-stamp*.5,sy-stamp*.5,stamp,stamp);
   if(petal){const hit=this.hitPoints[hitCount]||(this.hitPoints[hitCount]={});hit.x=sx;hit.y=sy;hit.z=this.depth[y*cols+x];hit.petal=petal.id;hit.flower=petal.flower;hit.visible=true;hitCount++;}
  }this.hitPoints.length=hitCount;c.globalAlpha=1;
  // Curved edge traces stay subordinate to the sampled rose sheets.
  if(v.wireContrast>0){for(const ink of [0,1]){c.beginPath();for(const ln of this.lines){if(ln.ink!==ink)continue;this.world(ln.a,v,t,energy,this._world);if(this._world.y>stemLevel||ln.a.flower>=0&&reveal<.6)continue;this.transform(this._world.x,this._world.y,this._world.z,a);this.world(ln.b,v,t,energy,this._world);this.transform(this._world.x,this._world.y,this._world.z,b);c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}c.strokeStyle=rgba(ink?v.leafColour:v.petalColour,v.wireContrast*(ink?.43:.065));c.lineWidth=.6*(v.lineWeight??1);c.stroke();}}
  this.drawFragments(time,v,reduced,step);this.projectedPetals=[];for(const petal of this.petals){this.world({x:petal.centre[0],y:petal.centre[1],z:petal.centre[2],flower:petal.flower,petal:petal.id},v,t,energy,this._world);const p=this.transform(this._world.x,this._world.y,this._world.z);this.projectedPetals[petal.id]={...p,id:petal.id,flower:petal.flower,layer:petal.layer,visible:reveal>.5};}
 }
 emitPetal(id,time,amount=1){
  const v=this.lastAppearance;if(!v)return;const samples=this.hitPoints.filter(p=>p.petal===id);if(!samples.length)return;
  for(let i=0;i<Math.round((v.spray??.7)*8*amount);i++){const n=this.fragments.length+i+id,p=samples[(n*17)%samples.length],perspective=6.8/(6.8-p.z),x=(p.x-this.width*.5)/this.scale/perspective,y=(this.height*.53-p.y)/this.scale/perspective,z=p.z,e=this.matrix.elements;this.fragments.push({x:e[0]*x+e[1]*y+e[2]*z,y:e[4]*x+e[5]*y+e[6]*z,z:e[8]*x+e[9]*y+e[10]*z,born:time,vx:Math.sin(n*8.39)*.11,vy:.10+((n*23)%37)/100,vz:Math.cos(n*4.13)*.10,char:6+n%(GLYPHS.length-6),ink:0,phase:n*.37});}
  if(this.fragments.length>100)this.fragments.splice(0,this.fragments.length-100);
 }
 drawFragments(time,v,reduced,step){
  if(reduced){this.fragments.length=0;return;}const c=this.c;
  for(let i=this.fragments.length-1;i>=0;i--){const f=this.fragments[i],age=time-f.born;if(age>2.6){this.fragments.splice(i,1);continue;}const p=this.transform(f.x+f.vx*age+Math.sin(age*1.3+f.phase)*age*.035,f.y+f.vy*age,f.z+f.vz*age),size=step*2.35*clamp(p.s,.65,1.3),ix=Math.floor(p.x/step),iy=Math.floor(p.y/step);if(ix>=0&&iy>=0&&ix<this.cols&&iy<this.rows&&p.z+.025<this.depth[iy*this.cols+ix])continue;c.globalAlpha=clamp((1-age/2.6)*.72*(v.exposure??1));c.drawImage(this.atlas,f.char*24,(f.ink*8+6)*24,24,24,p.x-size*.5,p.y-size*.5,size,size);}c.globalAlpha=1;
 }
 rasterLine(a,b,colour,alpha){
  const ax=a.x/this.step,ay=a.y/this.step,bx=b.x/this.step,by=b.y/this.step,steps=Math.max(1,Math.ceil(Math.max(Math.abs(bx-ax),Math.abs(by-ay))*2));
  for(let n=0;n<=steps;n++){const t=n/steps,x=Math.floor(lerp(ax,bx,t)),y=Math.floor(lerp(ay,by,t));if(x<0||y<0||x>=this.cols||y>=this.rows)continue;const index=y*this.cols+x,z=lerp(a.z,b.z,t);if(z+.01<this.depth[index]&&this.surfaceIds[index])continue;const i=index*4;if(this.surfaceIds[index]&&z<this.depth[index])continue;this.rasterPixels[i]=colour[0];this.rasterPixels[i+1]=colour[1];this.rasterPixels[i+2]=colour[2];this.rasterPixels[i+3]=Math.max(this.rasterPixels[i+3],alpha*255);this.density[index]=Math.max(1,this.density[index]);}
 }
 rasterTriangle(a,b,c,colour,code){
  const step=this.step,cols=this.cols,rows=this.rows,ax=a.x/step,ay=a.y/step,bx=b.x/step,by=b.y/step,cx=c.x/step,cy=c.y/step,area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(area)<1e-8)return;
  const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(cols-1,Math.ceil(Math.max(ax,bx,cx))),minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(rows-1,Math.ceil(Math.max(ay,by,cy)));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const px=x+.5,py=y+.5,w1=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/area,w2=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/area,w3=1-w1-w2;if(w1<-.00001||w2<-.00001||w3<-.00001)continue;const index=y*cols+x,z=w1*a.z+w2*b.z+w3*c.z;this.density[index]=Math.min(15,this.density[index]+1);if(z<this.depth[index])continue;this.depth[index]=z;this.surfaceIds[index]=code;const i=index*4;this.rasterPixels[i]=colour[0];this.rasterPixels[i+1]=colour[1];this.rasterPixels[i+2]=colour[2];this.rasterPixels[i+3]=255;}
 }
 drawGlow(pixels,cols,rows,v,w,h){
  if(!(v.glow>0))return;const radius=1+Math.round((v.glowRadius??.55)*3),temp=this.blurTemp,out=this.blurPixels,span=radius*2+1;
  for(let y=0;y<rows;y++){let sr=0,sg=0,sb=0,sa=0;const row=y*cols;
   for(let k=-radius;k<=radius;k++){const i=(row+Math.max(0,Math.min(cols-1,k)))*4,a=pixels[i+3]/255;sr+=pixels[i]*a;sg+=pixels[i+1]*a;sb+=pixels[i+2]*a;sa+=pixels[i+3];}
   for(let x=0;x<cols;x++){const i=(row+x)*4;temp[i]=sr/span;temp[i+1]=sg/span;temp[i+2]=sb/span;temp[i+3]=sa/span;const ni=(row+Math.min(cols-1,x+radius+1))*4,oi=(row+Math.max(0,x-radius))*4,na=pixels[ni+3]/255,oa=pixels[oi+3]/255;sr+=pixels[ni]*na-pixels[oi]*oa;sg+=pixels[ni+1]*na-pixels[oi+1]*oa;sb+=pixels[ni+2]*na-pixels[oi+2]*oa;sa+=pixels[ni+3]-pixels[oi+3];}
  }
  for(let x=0;x<cols;x++){let sr=0,sg=0,sb=0,sa=0;
   for(let k=-radius;k<=radius;k++){const i=(Math.max(0,Math.min(rows-1,k))*cols+x)*4;sr+=temp[i];sg+=temp[i+1];sb+=temp[i+2];sa+=temp[i+3];}
   for(let y=0;y<rows;y++){const i=(y*cols+x)*4,alpha=sa/span,unpremultiply=alpha>0?255/alpha:0;out[i]=sr/span*unpremultiply;out[i+1]=sg/span*unpremultiply;out[i+2]=sb/span*unpremultiply;out[i+3]=alpha;const ni=(Math.min(rows-1,y+radius+1)*cols+x)*4,oi=(Math.max(0,y-radius)*cols+x)*4;sr+=temp[ni]-temp[oi];sg+=temp[ni+1]-temp[oi+1];sb+=temp[ni+2]-temp[oi+2];sa+=temp[ni+3]-temp[oi+3];}
  }
  this.glowC.putImageData(new ImageData(out,cols,rows),0,0);this.c.globalAlpha=v.glow*.78;this.c.drawImage(this.glowField,0,0,w,h);this.c.globalAlpha=1;
 }
 dispose(){for(const canvas of [this.atlas,this.field,this.ids,this.glowField])canvas.width=canvas.height=0;this.fragments.length=0;this.faces.length=0;this.drawFaces.length=0;this.lines.length=0;this.petals.length=0;this.hitPoints.length=0;this.projectedPetals.length=0;this.idLookup?.clear();this.petalsById?.clear();this.hits.clear();this.blurTemp=this.blurPixels=this.rasterPixels=this.depth=this.surfaceIds=this.density=null;this.lastAppearance=this.lastEnergy=null;}
}
