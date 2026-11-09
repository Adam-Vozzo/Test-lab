import {Matrix4,Euler} from '../vendor/three.module.min.js';
import {clamp,lerp,rgba} from './kit.js';
import {buildRoseGeometry,ROSE_CENTRES} from './roses-geometry.js';
export {ROSE_CENTRES} from './roses-geometry.js';
// A fixed 5×7 bitmap alphabet keeps one-pixel strokes and open counters intact
// on iOS as well as desktop. Glyphs are ordered by ink coverage, not font order.
const GLYPH_ROWS={
 '.':[0,0,0,0,0,0,4],':':[0,4,4,0,4,4,0],'-':[0,0,0,14,0,0,0],
 '/':[1,2,2,4,8,8,16],'\\':[16,8,8,4,2,2,1],'|':[4,4,4,4,4,4,4],
 '+':[0,4,4,31,4,4,0],'=':[0,0,31,0,31,0,0],'<':[2,4,8,16,8,4,2],'>':[8,4,2,1,2,4,8],
 '!':[4,4,4,4,4,0,4],'i':[4,0,12,4,4,4,14],'l':[12,4,4,4,4,4,14],
 'x':[0,0,17,10,4,10,17],'v':[0,0,17,17,17,10,4],'t':[4,4,14,4,4,5,2],
 'c':[0,0,14,16,16,17,14],'o':[0,0,14,17,17,17,14],'n':[0,0,22,25,17,17,17],
 's':[0,0,15,16,14,1,30],'z':[0,0,31,2,4,8,31],
 '0':[14,17,19,21,25,17,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,2,4,8,31],
 '3':[30,1,1,14,1,1,30],'4':[2,6,10,18,31,2,2],'5':[31,16,16,30,1,1,30],
 '6':[14,16,16,30,17,17,14],'7':[31,1,2,4,8,8,8],'8':[14,27,27,14,27,27,14],'9':[14,17,17,15,1,1,14],
 'H':[17,17,17,31,17,17,17],'M':[17,27,21,21,17,17,17],'W':[17,17,17,21,21,27,17],
 '%':[25,25,2,4,8,19,19],'#':[10,31,10,31,10,31,10],'@':[14,31,27,29,23,16,14],
 'B':[30,27,27,30,27,27,30]
};
const inkCount=rows=>rows.reduce((sum,row)=>sum+row.toString(2).replace(/0/g,'').length,0);
const GLYPHS=Object.keys(GLYPH_ROWS).sort((a,b)=>inkCount(GLYPH_ROWS[a])-inkCount(GLYPH_ROWS[b])).join('');
const TRACE_GLYPHS=['-','|','/','\\'].map(char=>GLYPHS.indexOf(char));
const LIGHT_GLYPHS=['-','/','\\','|','=','+','<','>'].map(char=>GLYPHS.indexOf(char));

const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const brightened=hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),peak=Math.max(...rgb,1);return '#'+rgb.map(n=>Math.round(n*255/peak).toString(16).padStart(2,'0')).join('');};
const saturated=(hex,amount)=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),peak=Math.max(...rgb);return '#'+rgb.map(n=>Math.round(clamp(peak+(n-peak)*amount,0,255)).toString(16).padStart(2,'0')).join('');};
const mix=(a,b,t)=>{a=a.replace('#','');b=b.replace('#','');return '#'+[0,2,4].map(i=>Math.round(lerp(parseInt(a.slice(i,i+2),16),parseInt(b.slice(i,i+2),16),t)).toString(16).padStart(2,'0')).join('');};

// Render continuous three-dimensional surfaces to a bounded colour/ID field,
// then read it through a fixed screen-space ASCII grid. The ID field shares the
// exact depth order and growth transform, so a touch selects the visible petal.
export class RosesRenderer{
 constructor(canvas,{mobile=false}={}){
  this.canvas=canvas;this.c=canvas.getContext('2d');this.mobile=mobile;this.matrix=new Matrix4();this.euler=new Euler();this.width=1;this.height=1;this.key='';this.atlasKey='';this.faces=[];this.lines=[];this.petals=[];this.hitPoints=[];this.projectedPetals=[];this.drawFaces=[];this.reveal=1;this.frameId=0;this.camera={yaw:-.2,pitch:-.08,zoom:1};
  this.glowField=document.createElement('canvas');this.glowC=this.glowField.getContext('2d');this.field=document.createElement('canvas');this.ids=document.createElement('canvas');this.fieldC=this.field.getContext('2d',{willReadFrequently:true});this.idC=this.ids.getContext('2d',{willReadFrequently:true});this.atlas=document.createElement('canvas');this.hits=new Map();this.fragments=[];this.flowerPoses=[];this.petalPoses=[];this.interactionPoints=[];this.projectedInteractions=[];this.flowerMotion=Array.from({length:5},()=>({angle:0,velocity:0}));this.leafMotion=new Map();this.leafPoses=new Map();this.stemMotion={angle:0,velocity:0};this.lastPhysicsTime=null;this.intro={stem:1,branches:[1,1,1,1,1],leaves:[1,1,1],buds:[1,1,1,1,1],open:[1,1,1,1,1]};this._world={};this._screen={};
 }
 resize(w,h,dpr){this.width=w;this.height=h;this.dpr=dpr;}
 build(v){
  const key=[v.petalWidth,v.petalCurl,v.petalLayers,v.bloomScale,v.bouquetSpread,v.leafSize].join('|');if(key===this.key)return;this.key=key;
  const geometry=buildRoseGeometry(v);this.faces=geometry.faces;this.lines=geometry.lines;this.petals=geometry.petals;this.interactions=geometry.interactions;this.interactionsById=new Map(this.interactions.map(p=>[p.id,p]));this.drawFaces=this.faces.slice();this.petalsById=new Map(this.petals.map(p=>[p.id,p]));let radius=2.05;for(const face of this.faces)for(const p of face.vertices){let x=p.x,y=p.y,z=p.z;if(p.flower>=0){const f=ROSE_CENTRES[p.flower],ax=f[4],ay=f[5];x*=1.18;y*=1.18;z+=.14;const yy=y*Math.cos(ax)-z*Math.sin(ax),zz=y*Math.sin(ax)+z*Math.cos(ax),xx=x*Math.cos(ay)+zz*Math.sin(ay);z=-x*Math.sin(ay)+zz*Math.cos(ay)+f[2];x=xx+f[0]*(v.bouquetSpread??1);y=yy+f[1];}radius=Math.max(radius,Math.hypot(x,y,z)+.035);}this.boundRadius=radius;
 }
 makeAtlas(v){
  const key=[v.petalColour,v.leafColour,v.glyphStyle,v.saturation].join('|');if(key===this.atlasKey)return;this.atlasKey=key;const cell=24;this.atlas.width=GLYPHS.length*cell;this.atlas.height=3*8*cell;const c=this.atlas.getContext('2d');c.clearRect(0,0,this.atlas.width,this.atlas.height);const pink=saturated(v.petalColour,v.saturation??1.3),hot=brightened(pink),petalRamp=[mix('#17000e',pink,.10),mix('#1c0011',pink,.30),mix('#240018',pink,.60),pink,mix(pink,hot,.72),mix(hot,'#fff0f5',.18),mix(hot,'#ffd5e1',.56),mix(hot,'#fff2de',.95)];this.inkPalette=Array.from({length:3},()=>[]);this.glowTint=[1,3,5].map(i=>parseInt(hot.slice(i,i+2),16));
  for(let ink=0;ink<3;ink++)for(let level=0;level<8;level++)for(let ch=0;ch<GLYPHS.length;ch++){
   const col=ink===0?petalRamp[level]:ink===1?mix(v.leafColour,'#e2ead1',level/7*.48):mix('#c8b583','#fff0c0',level/7*.6),x=ch*cell,y=(ink*8+level)*cell;
   if(ch===0)this.inkPalette[ink][level]=[1,3,5].map(i=>parseInt(col.slice(i,i+2),16));c.globalAlpha=.2+Math.pow(level/7,.8)*.8;c.fillStyle=col;
   if(v.glyphStyle==='dots')c.fillRect(x+11,y+11,2,2);
   else{const rows=GLYPH_ROWS[GLYPHS[ch]];for(let row=0;row<7;row++)for(let column=0;column<5;column++)if(rows[row]&(1<<(4-column)))c.fillRect(x+10+column,y+9+row,1,1);}
  }c.globalAlpha=1;
 }

 transform(x,y,z,out={}){const e=this.matrix.elements,xx=e[0]*x+e[4]*y+e[8]*z,yy=e[1]*x+e[5]*y+e[9]*z,zz=e[2]*x+e[6]*y+e[10]*z,p=6.8/(6.8-zz),s=this.scale*p;out.x=this.width*(.5+(this.camera.offsetX||0))+xx*s;out.y=this.height*(.53+(this.camera.offsetY||0))-yy*s;out.z=zz;out.s=p;return out;}
 updatePhysics(time,reduced){
  const previous=this.lastPhysicsTime;this.lastPhysicsTime=time;if(reduced||previous!==null&&time-previous>.5){for(const p of this.flowerMotion)p.angle=p.velocity=0;for(const p of this.leafMotion.values())p.angle=p.velocity=0;this.stemMotion.angle=this.stemMotion.velocity=0;return;}
  const dt=previous===null?0:Math.max(0,Math.min(.1,time-previous)),steps=Math.max(1,Math.ceil(dt/.02)),step=dt/steps;
  for(let i=0;i<steps;i++){const stem=this.stemMotion;stem.velocity+=(-25*stem.angle-7*stem.velocity)*step;stem.angle=clamp(stem.angle+stem.velocity*step,-.045,.14);for(const p of this.flowerMotion){p.velocity+=(-49*p.angle-8.2*p.velocity)*step;p.angle+=p.velocity*step;if(p.angle>.92){p.angle=.92;p.velocity=Math.min(0,p.velocity)*.3;}if(p.angle<-.25){p.angle=-.25;p.velocity=Math.max(0,p.velocity)*.3;}}for(const p of this.leafMotion.values()){p.velocity+=(-81*p.angle-10*p.velocity)*step;p.angle=clamp(p.angle+p.velocity*step,-.18,.45);}}
 }
 strike(id,time,strength=.8){
  const item=this.interactionsById?.get(id);if(!item)return;const amount=clamp(strength,0,1.2)*(this.lastAppearance?.response??.85);if(item.kind==='petal'||id>=245&&id<=249){const f=item.kind==='petal'?item.flower:id-245,p=this.flowerMotion[f];p.velocity=Math.min(12,p.velocity+14.8*amount);}
  else if(item.kind==='leaf'){const p=this.leafMotion.get(id)||{angle:0,velocity:0};p.velocity=Math.min(9.5,p.velocity+14.8*amount);this.leafMotion.set(id,p);}else if(id===244){this.stemMotion.velocity=Math.min(2.2,this.stemMotion.velocity+1.45*amount);}else if(id>=250){for(const leaf of this.interactions)if(leaf.kind==='leaf'&&leaf.leaf===id-250){const p=this.leafMotion.get(leaf.id)||{angle:0,velocity:0};p.velocity=Math.min(6,p.velocity+3*amount);this.leafMotion.set(leaf.id,p);}}
 }
 preparePose(v,t,energy){
  const r=this.reveal,budStart=[4.9,4.4,3.55,5.2,5.6],openStart=[5.7,5.5,5.0,5.9,6.1];this.intro.stem=smooth(r/.286);for(let b=0;b<3;b++)this.intro.leaves[b]=smooth((r-(.51-b*.03))/.20);
  for(let f=0;f<ROSE_CENTRES.length;f++){const centre=ROSE_CENTRES[f],nod=this.flowerMotion[f].angle,idle=(v.idleMotion??.5)*this.intro.stem,swayX=idle*.026*Math.sin(t*.40+f*1.91),swayY=idle*.034*Math.sin(t*.31+f*2.37),ax=centre[4]+nod+swayX,ay=centre[5]+nod*.07*Math.sin(f*2.1)+swayY,baseAx=centre[4],baseAy=centre[5],pivot=-.39*centre[3]*(v.bloomScale??1),ca=Math.cos(ax),sa=Math.sin(ax),cb=Math.cos(ay),sb=Math.sin(ay),delta={x:Math.sin(f*1.7)*nod*.035+idle*Math.sin(t*.31+f)*.012,y:-Math.abs(nod)*.075,z:nod*.025+idle*Math.sin(t*.27+f*2.2)*.006};
   this.intro.branches[f]=f===2?smooth((r-2.6/10.5)/(1.1/10.5)):smooth((r-(3.1+f*.06)/10.5)/(2.05/10.5));this.intro.buds[f]=smooth((r-budStart[f]/10.5)/(1.15/10.5));this.intro.open[f]=smooth((r-openStart[f]/10.5)/(1-openStart[f]/10.5));
   const by=-pivot*Math.sin(baseAx),bz=pivot*Math.cos(baseAx),base={x:centre[0]*(v.bouquetSpread??1)+bz*Math.sin(baseAy),y:centre[1]+by,z:centre[2]+bz*Math.cos(baseAy)},py=-pivot*sa,pz=pivot*ca;
   this.flowerPoses[f]={cx:base.x-pz*sb+delta.x,cy:base.y-py+delta.y,cz:base.z-pz*cb+delta.z,ca,sa,cb,sb,delta,growth:this.intro.buds[f],opening:this.intro.open[f],breath:1+(v.idleMotion??.5)*Math.sin(t*.65+f*2.2)*.003};
  }
  for(const petal of this.petals){const f=this.flowerPoses[petal.flower],delay=Math.max(0,3-petal.layer)*.025,opening=clamp((f.opening-delay)/(1-delay));this.petalPoses[petal.id]={scale:f.breath*f.growth*(.10+.90*opening),depthScale:f.growth*(.38+.62*opening),z:0};}
  for(const item of this.interactions)if(item.kind==='leaf'){const angle=this.leafMotion.get(item.id)?.angle||0,pose=this.leafPoses.get(item.id)||{};pose.c=Math.cos(angle);pose.s=Math.sin(angle);pose.axis=item.leafAxis;this.leafPoses.set(item.id,pose);}
 }
 visible(p){if(p.kind==='stem'&&p.leaf<0)return (p.y+2.02)/3.57<=this.intro.stem;if(p.kind==='branch')return p.path<=this.intro.branches[p.branch];if(p.flower>=0)return this.intro.buds[p.flower]>.012;if(p.leaf>=0)return this.intro.leaves[p.leaf]>.015;return true;}
 world(p,v,t,energy,out){let x=p.x,y=p.y,z=p.z;
  if(p.flower>=0){const f=this.flowerPoses[p.flower],q=this.petalPoses[p.petal],scale=q?q.scale:f.breath*f.growth*(.45+.55*f.opening);x*=scale;y*=scale;const pivot=-.39*ROSE_CENTRES[p.flower][3]*(v.bloomScale??1);z=pivot+(z-pivot)*(q?q.depthScale:f.growth);const yy=y*f.ca-z*f.sa,zz=y*f.sa+z*f.ca,xx=x*f.cb+zz*f.sb;z=-x*f.sb+zz*f.cb;x=xx+f.cx;y=yy+f.cy;z+=f.cz;
  }else if(p.kind==='branch'||p.branch!==undefined){const f=this.flowerPoses[p.branch],bend=smooth(p.path);x+=f.delta.x*bend;y+=f.delta.y*bend;z+=f.delta.z*bend;
  }else if(p.leaf>=0){const growth=this.intro.leaves[p.leaf],sy=p.leafBase??0,pose=this.leafPoses.get(p.interaction);if(pose&&p.leafAnchor){const a=p.leafAnchor,vx=x-a[0],vy=y-a[1],vz=z-a[2],[ax,ay,az]=pose.axis,dot=ax*vx+ay*vy+az*vz,weight=.35+.65*(p.leafT??.5),rx=vx*pose.c+(ay*vz-az*vy)*pose.s+ax*dot*(1-pose.c),ry=vy*pose.c+(az*vx-ax*vz)*pose.s+ay*dot*(1-pose.c),rz=vz*pose.c+(ax*vy-ay*vx)*pose.s+az*dot*(1-pose.c);x=a[0]+lerp(vx,rx,weight);y=a[1]+lerp(vy,ry,weight);z=a[2]+lerp(vz,rz,weight);}x*=.02+.98*growth;y=sy+(y-sy)*growth;z*=growth;}
  const rise=Math.max(0,y+2.02),bend=this.stemMotion.angle;x+=Math.sin(bend)*rise*rise/7.14;y-=(1-Math.cos(bend))*rise*rise*rise/38.23;
  out.x=x;out.y=y;out.z=z;return out;
 }
 projectInteraction(id){return this.projectedInteractions[id]||null;}
 projectPetal(id){return this.projectInteraction(id);}
 pick(x,y){let best=null,distance=15*15;for(const p of this.interactionPoints){const d=(x-p.x)**2+(y-p.y)**2;if(d<distance){distance=d;best=p;}}return best?{id:best.id,kind:best.kind,flower:best.flower,x:best.x,y:best.y}:null;}
 draw(v,time,camera,energy,reveal=1,reduced=false){
  this.build(v);this.makeAtlas(v);this.camera={...camera};this.lastAppearance=v;this.lastEnergy=energy;this.lastMotionTime=reduced?0:time*(v.motionRate??1);this.reveal=reveal;this.frameId++;const c=this.c,w=this.width,h=this.height;c.clearRect(0,0,w,h);this.matrix.makeRotationFromEuler(this.euler.set(camera.pitch,camera.yaw,0,'YXZ'));const radius=this.boundRadius,projectedRadius=radius*6.8/Math.sqrt(6.8*6.8-radius*radius),available=Math.max(20,Math.min(w*.5,h*.47)-14);this.scale=available/projectedRadius/(1.08*1.15)*(v.sceneScale??1)*camera.zoom;
  const t=reduced?0:time*(v.motionRate??1);this.updatePhysics(time,reduced);this.preparePose(v,t,energy);const pitch=Math.max(4,Math.max(7.5,Math.min(w,h)/120)*(v.glyphSize??1)/Math.sqrt(v.glyphDensity??1)),step=Math.max(Math.sqrt(w*h/(80000*.75)),pitch/2),stepX=step*.75,cols=Math.ceil(w/stepX),rows=Math.ceil(h/step);this.glyphPitch=step*2;
  if(!this.depth||this.field.width!==cols||this.field.height!==rows){this.field.width=this.ids.width=this.glowField.width=cols;this.field.height=this.ids.height=this.glowField.height=rows;this.glowSource=new Float32Array(cols*rows*4);this.wideGlowSource=new Float32Array(cols*rows*4);this.blurTemp=new Float32Array(cols*rows*4);this.blurPixels=new Uint8ClampedArray(cols*rows*4);this.rasterPixels=new Uint8ClampedArray(cols*rows*4);this.depth=new Float32Array(cols*rows);this.surfaceIds=new Uint16Array(cols*rows);this.density=new Uint8Array(cols*rows);}const fc=this.fieldC,ic=this.idC;fc.clearRect(0,0,cols,rows);ic.clearRect(0,0,cols,rows);
  for(const face of this.faces){let z=0,visible=true;for(let i=0;i<face.vertices.length;i++){const p=this.world(face.vertices[i],v,t,energy,this._world);if(!this.visible(face.vertices[i]))visible=false;const screen=this.transform(p.x,p.y,p.z,face.screen[i]);z+=screen.z;}face.z=z/face.vertices.length;let [nx,ny,nz]=face.normal;if(face.flower>=0){const f=this.flowerPoses[face.flower],yy=ny*f.ca-nz*f.sa,zz=ny*f.sa+nz*f.ca,xx=nx*f.cb+zz*f.sb;nz=-nx*f.sb+zz*f.cb;nx=xx;ny=yy;}else{const leaf=this.leafPoses.get(face.vertices[0].interaction);if(leaf){const [ax,ay,az]=leaf.axis,dot=ax*nx+ay*ny+az*nz,xx=nx*leaf.c+(ay*nz-az*ny)*leaf.s+ax*dot*(1-leaf.c),yy=ny*leaf.c+(az*nx-ax*nz)*leaf.s+ay*dot*(1-leaf.c),zz=nz*leaf.c+(ax*ny-ay*nx)*leaf.s+az*dot*(1-leaf.c);nx=xx;ny=yy;nz=zz;}}const e=this.matrix.elements,rx=e[0]*nx+e[4]*ny+e[8]*nz,ry=e[1]*nx+e[5]*ny+e[9]*nz,rz=e[2]*nx+e[6]*ny+e[10]*nz;const sign=rz<0?-1:1;face.shade=.12+.79*Math.max(0,(-rx*.35+ry*.6+rz*.72)*sign)+.09*Math.pow(1-Math.abs(rz),3);face.highlight=Math.pow(Math.max(0,(-rx*.19+ry*.33+rz*.925)*sign),18);face.visible=visible;}
  this.depth.fill(-1e9);this.density.fill(0);this.surfaceIds.fill(0);this.rasterPixels.fill(0);this.cols=cols;this.rows=rows;this.step=step;this.stepX=stepX;
  const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),pink=rgb(saturated(v.petalColour,v.saturation??1.3)),green=rgb(v.leafColour);
  for(const face of this.faces){if(!face.visible)continue;const interaction=face.vertices[0].interaction,strength=energy[interaction]||0,light=clamp((face.shade-.14)*1.1+face.light*.17+strength*.28+(face.ink!==1?face.highlight*.22*(v.highlightGain??1.25):0)),low=face.ink===0?[29,1,13]:face.ink===1?[9,21,15]:[170,155,103],high=face.ink===0?pink:face.ink===1?green:[255,244,191],colour=low.map((value,i)=>Math.round(lerp(value,high[i],light)+(face.ink===0?Math.max(0,light-.70)*110*(v.highlightGain??1.25):0))),code=(interaction+1)|(face.ink===2?256:0);this.rasterTriangle(face.screen[0],face.screen[1],face.screen[2],colour,code);this.rasterTriangle(face.screen[0],face.screen[2],face.screen[3],colour,code);}
  // Thin structural traces share the sampled field, with fractional coverage.
  const a={},b={};for(const ln of this.lines){if(ln.ink===0)continue;this.world(ln.a,v,t,energy,this._world);if(!this.visible(ln.a))continue;this.transform(this._world.x,this._world.y,this._world.z,a);this.world(ln.b,v,t,energy,this._world);if(!this.visible(ln.b))continue;this.transform(this._world.x,this._world.y,this._world.z,b);const strength=energy[ln.a.interaction]||0;this.rasterLine(a,b,strength>.02?green.map((v,i)=>Math.round(lerp(v,[245,241,205][i],strength*.5))):green,Math.min(1,ln.alpha+strength*.3),ln.a.interaction+1);}
  const pixels=this.rasterPixels;fc.putImageData(new ImageData(pixels,cols,rows),0,0);
  this.drawGlow(pixels,cols,rows,v,w,h);let hitCount=0,interactionCount=0;
  // Picking keeps the finer geometry raster. Four samples feed each visible
  // character so narrow lit folds survive without making the type microscopic.
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const index=y*cols+x;if(pixels[index*4+3]<34)continue;const id=(this.surfaceIds[index]&255)-1,item=this.interactionsById.get(id);if(!item)continue;const sx=(x+.5)*stepX,sy=(y+.5)*step;
   if(item.kind==='petal'){const hit=this.hitPoints[hitCount]||(this.hitPoints[hitCount]={});hit.x=sx;hit.y=sy;hit.z=this.depth[index];hit.petal=id;hit.flower=item.flower;hit.visible=true;hitCount++;}
   const hit=this.interactionPoints[interactionCount]||(this.interactionPoints[interactionCount]={});hit.x=sx;hit.y=sy;hit.z=this.depth[index];hit.id=id;hit.petal=id;hit.flower=item.flower;hit.kind=item.kind;hit.visible=true;interactionCount++;
  }
  this.hitPoints.length=hitCount;this.interactionPoints.length=interactionCount;
  const stamp=this.glyphPitch*3,exposure=v.exposure??1,smoothing=c.imageSmoothingEnabled;c.imageSmoothingEnabled=false;
  for(let y=0;y<rows;y+=2)for(let x=0;x<cols;x+=2){
   let coverage=0,rr=0,gg=0,bb=0,material=0,peak=-1,chosen=0,solid=false;
   for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){if(x+dx>=cols||y+dy>=rows)continue;const index=(y+dy)*cols+x+dx,off=index*4,a=pixels[off+3]/255;if(a<=0)continue;const light=Math.max(pixels[off],pixels[off+1],pixels[off+2]);coverage+=a;rr+=pixels[off]*a;gg+=pixels[off+1]*a;bb+=pixels[off+2]*a;material+=this.density[index]*a;solid||=a>.98;if(light>peak){peak=light;chosen=index;}}
   if(coverage<.25)continue;const off=chosen*4,r=lerp(rr/coverage,pixels[off],.6),g=lerp(gg/coverage,pixels[off+1],.6),b=lerp(bb/coverage,pixels[off+2],.6),semantic=this.surfaceIds[chosen],item=this.interactionsById.get((semantic&255)-1),ink=item?.kind==='petal'?(semantic&256?2:0):1,brightness=Math.max(r,g,b)/255,density=material/coverage,materialDensity=Math.min(1,.20+Math.log2(1+density)*.27),noise=((Math.imul(x+19,374761393)^Math.imul(y+31,668265263))>>>0)%100/100,evolution=reduced?0:Math.sin(t*.65+noise*11+y*.06)*(v.idleMotion??.5)*.035;
   const level=clamp(Math.floor(Math.pow(brightness,.85)*8.2+(noise-.5)*.65),0,7);let char=clamp(Math.floor(Math.pow(clamp(brightness*materialDensity*1.45+(noise-.5)*.12+evolution),.85)*(GLYPHS.length-1)),0,GLYPHS.length-1);
   if(density<1.5)char=LIGHT_GLYPHS[Math.min(7,Math.floor(brightness*5+noise*3))];
   if(!solid){const at=(xx,yy)=>xx<0||xx>=cols||yy<0||yy>=rows?0:pixels[(yy*cols+xx)*4+3],directions=[at(x-1,y)+at(x+2,y),at(x,y-1)+at(x,y+2),at(x+2,y-1)+at(x-1,y+2),at(x-1,y-1)+at(x+2,y+2)];let best=1;for(let i=0;i<4;i++)if(directions[i]>directions[best])best=i;char=TRACE_GLYPHS[best];}
   c.globalAlpha=clamp(exposure*(solid?Math.sqrt(coverage/4):Math.max(.85,Math.sqrt(coverage/4)))*(.9+noise*.1));const sx=(x+1)*stepX,sy=(y+1)*step;c.drawImage(this.atlas,char*24,(ink*8+level)*24,24,24,sx-stamp*.5,sy-stamp*.5,stamp,stamp);
  }c.globalAlpha=1;c.imageSmoothingEnabled=smoothing;
  // Curved edge traces stay subordinate to the sampled rose sheets.
  if(v.wireContrast>0){for(const ink of [0,1]){c.beginPath();for(const ln of this.lines){if(ln.ink!==ink)continue;this.world(ln.a,v,t,energy,this._world);if(!this.visible(ln.a)||!this.visible(ln.b)||ln.a.flower>=0&&this.intro.open[ln.a.flower]<.06)continue;this.transform(this._world.x,this._world.y,this._world.z,a);this.world(ln.b,v,t,energy,this._world);this.transform(this._world.x,this._world.y,this._world.z,b);c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}c.strokeStyle=rgba(ink?v.leafColour:v.petalColour,v.wireContrast*(ink?.43:.065));c.lineWidth=.6*(v.lineWeight??1);c.stroke();}}
  this.drawFragments(time,v,reduced,this.glyphPitch);this.projectedPetals=[];this.projectedInteractions=[];for(const item of this.interactions){const point={...item,x:item.centre[0],y:item.centre[1],z:item.centre[2],petal:item.kind==='petal'?item.id:-1,interaction:item.id,kind:item.kind==='stem'&&item.branch!==undefined?'branch':item.kind};this.world(point,v,t,energy,this._world);const p=this.transform(this._world.x,this._world.y,this._world.z),pose={...p,id:item.id,kind:item.kind,flower:item.flower,layer:item.layer,visible:this.visible(point),bend:item.id===244?this.stemMotion.angle:item.flower>=0?this.flowerMotion[item.flower].angle:item.id>=245&&item.id<=249?this.flowerMotion[item.id-245].angle:this.leafMotion.get(item.id)?.angle||0};this.projectedInteractions[item.id]=pose;if(item.kind==='petal')this.projectedPetals[item.id]=pose;}
 }
 emitPetal(id,time,amount=1){
  const v=this.lastAppearance;if(!v)return;const samples=this.interactionPoints.filter(p=>p.id===id);if(!samples.length)return;
  for(let i=0;i<Math.round((v.spray??.7)*8*amount);i++){const n=this.fragments.length+i+id,p=samples[(n*17)%samples.length],perspective=6.8/(6.8-p.z),x=(p.x-this.width*(.5+(this.camera.offsetX||0)))/this.scale/perspective,y=(this.height*(.53+(this.camera.offsetY||0))-p.y)/this.scale/perspective,z=p.z,e=this.matrix.elements;this.fragments.push({x:e[0]*x+e[1]*y+e[2]*z,y:e[4]*x+e[5]*y+e[6]*z,z:e[8]*x+e[9]*y+e[10]*z,born:time,vx:Math.sin(n*8.39)*.11,vy:.10+((n*23)%37)/100,vz:Math.cos(n*4.13)*.10,char:3+n%(GLYPHS.length-3),ink:p.kind==='petal'?(n%4===0?2:0):1,scale:.52+(n%7)*.055,phase:n*.37});}
  if(this.fragments.length>100)this.fragments.splice(0,this.fragments.length-100);
 }
 drawFragments(time,v,reduced,step){
  if(reduced){this.fragments.length=0;return;}const c=this.c,smoothing=c.imageSmoothingEnabled;c.imageSmoothingEnabled=false;
  for(let i=this.fragments.length-1;i>=0;i--){const f=this.fragments[i],age=time-f.born;if(age>2.6){this.fragments.splice(i,1);continue;}const p=this.transform(f.x+f.vx*age+Math.sin(age*1.3+f.phase)*age*.035,f.y+f.vy*age,f.z+f.vz*age),size=step*3*f.scale*clamp(p.s,.65,1.3),ix=Math.floor(p.x/this.stepX),iy=Math.floor(p.y/this.step);if(ix>=0&&iy>=0&&ix<this.cols&&iy<this.rows&&p.z+.025<this.depth[iy*this.cols+ix])continue;c.globalAlpha=clamp((1-age/2.6)*.72*(v.exposure??1));c.drawImage(this.atlas,f.char*24,(f.ink*8+6)*24,24,24,p.x-size*.5,p.y-size*.5,size,size);}c.globalAlpha=1;c.imageSmoothingEnabled=smoothing;
 }
 rasterLine(a,b,colour,alpha,code=0){
  const ax=a.x/this.stepX,ay=a.y/this.step,bx=b.x/this.stepX,by=b.y/this.step,steps=Math.max(1,Math.ceil(Math.max(Math.abs(bx-ax),Math.abs(by-ay))*2));
  for(let n=0;n<=steps;n++){const t=n/steps,x=Math.floor(lerp(ax,bx,t)),y=Math.floor(lerp(ay,by,t));if(x<0||y<0||x>=this.cols||y>=this.rows)continue;const index=y*this.cols+x,z=lerp(a.z,b.z,t);if(z+.01<this.depth[index]&&this.surfaceIds[index])continue;const i=index*4;if(this.surfaceIds[index]&&z<this.depth[index])continue;this.rasterPixels[i]=colour[0];this.rasterPixels[i+1]=colour[1];this.rasterPixels[i+2]=colour[2];this.rasterPixels[i+3]=Math.max(this.rasterPixels[i+3],alpha*255);this.surfaceIds[index]=code;this.depth[index]=Math.max(this.depth[index],z);this.density[index]=Math.max(1,this.density[index]);}
 }
 rasterTriangle(a,b,c,colour,code){
  const step=this.step,stepX=this.stepX,cols=this.cols,rows=this.rows,ax=a.x/stepX,ay=a.y/step,bx=b.x/stepX,by=b.y/step,cx=c.x/stepX,cy=c.y/step,area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(area)<1e-8)return;
  const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(cols-1,Math.ceil(Math.max(ax,bx,cx))),minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(rows-1,Math.ceil(Math.max(ay,by,cy)));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const px=x+.5,py=y+.5,w1=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/area,w2=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/area,w3=1-w1-w2;if(w1<-.00001||w2<-.00001||w3<-.00001)continue;const index=y*cols+x,z=w1*a.z+w2*b.z+w3*c.z;this.density[index]=Math.min(15,this.density[index]+1);if(z<this.depth[index])continue;this.depth[index]=z;this.surfaceIds[index]=code;const i=index*4;this.rasterPixels[i]=colour[0];this.rasterPixels[i+1]=colour[1];this.rasterPixels[i+2]=colour[2];this.rasterPixels[i+3]=255;}
 }
 drawGlow(pixels,cols,rows,v,w,h){
  if(!(v.glow>0))return;const source=this.glowSource,wideSource=this.wideGlowSource,temp=this.blurTemp,out=this.blurPixels;
  // Only luminous surface samples emit. Keep the diffuse field saturated and
  // reserve pale spill for the brightest ridges, leaving black between glyphs.
  for(let i=0;i<pixels.length;i+=4){const a=pixels[i+3]/255,brightness=Math.max(pixels[i],pixels[i+1],pixels[i+2])/255,semantic=this.surfaceIds[i/4],item=this.interactionsById.get((semantic&255)-1),petal=item?.kind==='petal',weight=a*(petal?.06+.94*smooth((brightness-.22)/.70):.22*smooth((brightness-.30)/.65)),ink=petal?(semantic&256?2:0):1,level=clamp(Math.pow(brightness,.85)*8.2,0,7),low=Math.floor(level),high=Math.min(7,low+1),fraction=level-low,palette=this.inkPalette[ink];
   for(let channel=0;channel<3;channel++){const colour=lerp(palette[low][channel],palette[high][channel],fraction);source[i+channel]=colour*weight;wideSource[i+channel]=(petal?lerp(colour,this.glowTint[channel],.72):colour)*weight;}source[i+3]=wideSource[i+3]=weight*255;
  }
  const c=this.c,mode=c.globalCompositeOperation,smoothing=c.imageSmoothingEnabled;c.globalCompositeOperation='screen';c.imageSmoothingEnabled=true;
  const tight=1+Math.round((v.glowRadius??.6)*2),wide=tight+2+Math.round((v.glowRadius??.6)*3);
  for(const [radius,strength] of [[wide,.50],[tight,.72]]){const span=radius*2+1,emission=radius===wide?wideSource:source;
   for(let y=0;y<rows;y++){let sr=0,sg=0,sb=0,sa=0;const row=y*cols;
    for(let k=-radius;k<=radius;k++){const i=(row+Math.max(0,Math.min(cols-1,k)))*4;sr+=emission[i];sg+=emission[i+1];sb+=emission[i+2];sa+=emission[i+3];}
    for(let x=0;x<cols;x++){const i=(row+x)*4;temp[i]=sr/span;temp[i+1]=sg/span;temp[i+2]=sb/span;temp[i+3]=sa/span;const ni=(row+Math.min(cols-1,x+radius+1))*4,oi=(row+Math.max(0,x-radius))*4;sr+=emission[ni]-emission[oi];sg+=emission[ni+1]-emission[oi+1];sb+=emission[ni+2]-emission[oi+2];sa+=emission[ni+3]-emission[oi+3];}
   }
   for(let x=0;x<cols;x++){let sr=0,sg=0,sb=0,sa=0;
    for(let k=-radius;k<=radius;k++){const i=(Math.max(0,Math.min(rows-1,k))*cols+x)*4;sr+=temp[i];sg+=temp[i+1];sb+=temp[i+2];sa+=temp[i+3];}
    for(let y=0;y<rows;y++){const i=(y*cols+x)*4,alpha=sa/span,unpremultiply=alpha>0?255/alpha:0;out[i]=sr/span*unpremultiply;out[i+1]=sg/span*unpremultiply;out[i+2]=sb/span*unpremultiply;out[i+3]=alpha;const ni=(Math.min(rows-1,y+radius+1)*cols+x)*4,oi=(Math.max(0,y-radius)*cols+x)*4;sr+=temp[ni]-temp[oi];sg+=temp[ni+1]-temp[oi+1];sb+=temp[ni+2]-temp[oi+2];sa+=temp[ni+3]-temp[oi+3];}
   }
   this.glowC.putImageData(new ImageData(out,cols,rows),0,0);c.globalAlpha=v.glow*strength;c.drawImage(this.glowField,0,0,w,h);
  }c.globalAlpha=1;c.globalCompositeOperation=mode;c.imageSmoothingEnabled=smoothing;
 }

 dispose(){for(const canvas of [this.atlas,this.field,this.ids,this.glowField])canvas.width=canvas.height=0;this.fragments.length=0;this.faces.length=0;this.drawFaces.length=0;this.lines.length=0;this.petals.length=0;this.hitPoints.length=0;this.projectedPetals.length=0;this.projectedInteractions.length=0;this.interactionPoints.length=0;if(this.interactions)this.interactions.length=0;this.interactionsById?.clear();this.flowerPoses.length=0;this.petalPoses.length=0;for(const p of this.flowerMotion)p.angle=p.velocity=0;this.leafMotion.clear();this.leafPoses.clear();this.stemMotion.angle=this.stemMotion.velocity=0;this.lastPhysicsTime=null;this.idLookup?.clear();this.petalsById?.clear();this.hits.clear();this.wideGlowSource=this.glowSource=this.blurTemp=this.blurPixels=this.rasterPixels=this.depth=this.surfaceIds=this.density=null;this.lastAppearance=this.lastEnergy=this.inkPalette=this.glowTint=null;}
}
