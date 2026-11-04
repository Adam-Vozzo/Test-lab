import * as THREE from '../vendor/three.module.min.js';
import {MarchingCubes} from '../vendor/three-marching-cubes.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
/** Bounded, real implicit geometry. Colours blend in the volume before lighting,
 * so intersecting bodies share one surface rather than overlapping flat fills. */
export class BlobVolume {
 constructor({resolution=44,connected=false,colour='#f0e6be'}={}){
  this.material=new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.32,metalness:.14,transparent:true,opacity:.98,side:THREE.FrontSide});
  this.mesh=new MarchingCubes(resolution,this.material,false,true,18000);this.mesh.frustumCulled=false;this.mesh.isolation=80;
  this.connected=connected;this.colour=colour;this.last=-Infinity;this.lastCount=-1;this.colors=new Map();this.mixColor=new THREE.Color();this.resolution=resolution;
 }
 color(value){if(!this.colors.has(value))this.colors.set(value,new THREE.Color(value));return this.colors.get(value);}
 update(points,width,height,time,{motion=.6,opacity=.98,roughness=.32,connected=this.connected}={}){
  this.material.opacity=opacity;this.material.roughness=roughness;this.mesh.visible=points.length>0&&opacity>.001;
  if(!this.mesh.visible)return;
  if(time-this.last<1/30&&points.length===this.lastCount)return;this.last=time;this.lastCount=points.length;
  const phase=motion===0?0:time;
  const p=points.slice(-96).map((q,i)=>({...q,r:Math.max(8,q.r),color:q.color||this.colour,z:q.z??Math.sin(phase*.31+i*1.73)*q.r*.22*motion}));
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,maxR=0;
  for(const q of p){minX=Math.min(minX,q.x-q.r*2);maxX=Math.max(maxX,q.x+q.r*2);minY=Math.min(minY,q.y-q.r*2);maxY=Math.max(maxY,q.y+q.r*2);maxR=Math.max(maxR,q.r);}
  const extent=Math.max(180,maxX-minX,maxY-minY,maxR*5),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  this.mesh.position.set(cx-width/2,height/2-cy,0);this.mesh.scale.setScalar(extent/2);this.mesh.reset();
  const add=(x,y,z,r,color)=>this.mesh.addBall(.5+(x-cx)/extent,.5-(y-cy)/extent,.5+z/extent,(r/extent)**2*94,14,color);
  for(let i=0;i<p.length;i++){const q=p[i],pulse=1+Math.sin(phase*.47+i*2.19)*.065*motion;add(q.x,q.y,q.z,q.r*pulse,this.color(q.color));}
  if(connected&&p.length>1){
   // A short spatial chain avoids wasting bridges on alternating touches at
   // opposite edges. Every link gets samples before any link gains detail.
   const pending=p.slice(1),chain=[p[0]];
   while(pending.length){const a=chain.at(-1);let nearest=0,d=Infinity;for(let i=0;i<pending.length;i++){const q=pending[i],distance=(q.x-a.x)**2+(q.y-a.y)**2+(q.z-a.z)**2;if(distance<d){d=distance;nearest=i;}}chain.push(pending.splice(nearest,1)[0]);}
   const links=chain.slice(1).map((b,i)=>{const a=chain[i],distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),neck=Math.max(extent/this.resolution*.92,Math.min(a.r,b.r)*.40);return{a,b,distance,neck,want:Math.max(2,Math.ceil(distance/(neck*.8)))};});
   const extra=Math.max(0,240-links.length*2),wanted=links.reduce((sum,q)=>sum+q.want-2,0);
   for(let i=0;i<links.length;i++){const {a,b,distance,neck,want}=links[i],count=2+Math.floor((want-2)*Math.min(1,extra/Math.max(1,wanted))),radius=Math.max(neck,distance/count*.85,(distance/count-Math.min(a.r,b.r)*.45)/.8);
    for(let j=1;j<count;j++){const u=j/count,bend=Math.sin(u*Math.PI)*Math.sin(i*1.2+phase*.16)*Math.min(22,distance*.065);this.mixColor.lerpColors(this.color(a.color),this.color(b.color),u);add(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u+bend,a.z+(b.z-a.z)*u,radius*(.8+.2*Math.abs(u*2-1)),this.mixColor);}
   }
  }
  const palette=this.mesh.palette;for(let i=0;i<palette.length;i+=3){const max=Math.max(1,palette[i],palette[i+1],palette[i+2]);palette[i]/=max;palette[i+1]/=max;palette[i+2]/=max;}
  this.mesh.update();
 }
 dispose(){this.mesh.geometry.dispose();this.material.dispose();this.colors.clear();}
}
