import {clamp,lerp,seeded} from './kit.js';

const TAU=Math.PI*2;
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
export const ROSE_CENTRES=Object.freeze([
 [-.77,1.09,.24,.58,-.90,-.34],[-.37,1.51,-.15,.51,-1.14,.08],
 [.29,1.53,.13,.56,-.98,.19],[.83,1.16,-.19,.50,-1.16,.30],[.48,.78,.42,.45,-.76,.23]
].map(Object.freeze));

/** Object-space botanical geometry, independent of raster size and camera.
 * Each petal is a folded bowl wall rather than a radial disk. Stable petal IDs
 * preserve a sounding note when density, layer count, or camera pose changes. */
export function buildRoseGeometry(v={}){
 const faces=[],lines=[],petals=[],rand=seeded(74619);
 const vertex=(p,flower,petal,leaf=-1,leafBase=0)=>({x:p[0],y:p[1],z:p[2],flower,petal,leaf,leafBase});
 const face=(points,flower,petal,ink,light,leaf=-1,leafBase=0)=>{
  const a=points[0],b=points[1],c=points[2],ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const normal=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],length=Math.hypot(...normal)||1;
  faces.push({vertices:points.map(p=>vertex(p,flower,petal,leaf,leafBase)),normal:normal.map(n=>n/length),flower,petal,ink,light,screen:points.map(()=>({})),z:0});
 };
 const line=(a,b,flower,petal,ink,alpha=.3,leaf=-1,leafBase=0)=>lines.push({a:vertex(a,flower,petal,leaf,leafBase),b:vertex(b,flower,petal,leaf,leafBase),ink,alpha});
 const layers=Math.round(clamp(v.petalLayers??4,2,5)),counts=[6,5,4,3,3],radii=[1,.76,.51,.31,.18];
 const curl=clamp(v.petalCurl??.7,0,1.5),width=clamp(v.petalWidth??1,.55,1.5);
 for(let flower=0;flower<ROSE_CENTRES.length;flower++){
  const size=ROSE_CENTRES[flower][3]*(v.bloomScale??1);
  for(let layer=0;layer<layers;layer++){
   const count=counts[layer],closed=layer/4;
   for(let p=0;p<count;p++){
    const id=flower*40+layer*8+p,seed=p*2.39+layer*.83+flower*1.71;
    const theta=p/count*TAU+layer*1.13+flower*.43+.055*Math.sin(seed*2);
    const radius=size*radii[layer]*(1+.10*Math.sin(seed)),halfWidth=Math.PI/count*(1.34+.24*width);
    const at=(u,vv)=>{
     // Rounded, irregular top edge. Unlike a fan, the side corners end lower
     // on the bowl; they never become repeated spikes around the silhouette.
     const round=.78+.22*Math.sqrt(Math.max(0,1-u*u));
     const t=vv*round,lip=smooth((t-.70)/.30),opening=Math.sin(t*Math.PI*.5);
     const angle=theta+u*halfWidth*(.22+.78*Math.pow(opening,.72))+.34*closed*t*t;
     const coreTurn=layer>=3?(p===0?.48:.12)*smooth((t-.58)/.42):0;
     const r=radius*(.18+.70*opening+.14*(1-closed)*lip)*(1+.035*Math.sin(u*3.7+seed)*t*t)*(1-coreTurn);
     // Tall inner petals interleave above the turned-out outer lips. A side
     // fold and a gentle oblique crease make each sheet catch light distinctly.
     const wall=size*(-.40+(.79+.07*closed)*t+.035*layer);
     const roll=radius*(.23+.12*curl)*(1-.52*closed)*lip;
     const side=radius*(.06+.08*curl)*u*u*Math.sin(t*Math.PI*.85);
     const crease=radius*.052*Math.sin(u*3.1+seed)*Math.sin(t*Math.PI);
     const ruffle=radius*.027*Math.sin(u*7.2+seed*1.3)*lip;
     return[Math.cos(angle)*r,Math.sin(angle)*r,wall-roll+side+crease+ruffle];
    };
    petals.push({id,flower,layer,centre:at(0,.75),radius:radius*.60});
    const rows=6,cols=6;
    for(let j=0;j<rows;j++)for(let k=0;k<cols;k++){
     const t0=j/rows,t1=(j+1)/rows,u0=k/cols*2-1,u1=(k+1)/cols*2-1;
     // Tiny warm seams at the inner curl, never a flat yellow centre disk.
     const ink=layer>=2&&j===rows-2&&k===2&&Math.cos(theta-.6)>.35?2:0;
     const light=clamp(.41+.20*Math.cos(theta+.7)+.10*(j/rows)+.05*Math.sin(seed+k*.6));
     face([at(u0,t0),at(u1,t0),at(u1,t1),at(u0,t1)],flower,id,ink,light);
    }
    let previous=at(-1,1);
    for(let i=1;i<=14;i++){const next=at(-1+i/7,1);line(previous,next,flower,id,0,.18);previous=next;}
    // One displaced crease follows each sheet, with a small gap at its base.
    previous=at(.34,.35);
    for(let i=1;i<=6;i++){const next=at(.34,.35+i*.10);line(previous,next,flower,id,0,.07);previous=next;}
   }
  }
  // The narrow calyx joins the bowl base to its supporting branch.
  for(let p=0;p<5;p++){
   const angle=p/5*TAU,base=[0,0,-.42*size],tip=[Math.cos(angle)*size*.26,Math.sin(angle)*size*.26,-.22*size],tangent=[-Math.sin(angle)*size*.065,Math.cos(angle)*size*.065,0];
   face([base,[tip[0]-tangent[0],tip[1]-tangent[1],tip[2]-.03],tip,[tip[0]+tangent[0],tip[1]+tangent[1],tip[2]-.03]],flower,-1,1,.48);
   line(base,tip,flower,-1,1,.60);
  }
 }
 const stem=t=>[.025*Math.sin(t*4.6),lerp(-2.02,1.55,t),.013*Math.sin(t*3)];
 for(let i=1;i<=70;i++){
  const a=stem((i-1)/70),b=stem(i/70);
  line(a,b,-1,-1,1,.80);
  for(const side of [-1,1])line([a[0]+side*.016,a[1],a[2]+side*.008],[b[0]+side*.016,b[1],b[2]+side*.008],-1,-1,1,side<0?.27:.45);
 }
 for(let flower=0;flower<ROSE_CENTRES.length;flower++){
  const centre=ROSE_CENTRES[flower],start=[0,.10+flower*.055,0],ax=centre[4],ay=centre[5],localZ=-.39*centre[3]*(v.bloomScale??1),y=-localZ*Math.sin(ax),z=localZ*Math.cos(ax);
  const end=[centre[0]*(v.bouquetSpread??1)+z*Math.sin(ay),centre[1]+y,centre[2]+z*Math.cos(ay)];
  for(let i=1;i<=25;i++){
   const a=(i-1)/25,b=i/25,at=t=>[lerp(start[0],end[0],t)+.018*Math.sin(Math.PI*t),lerp(start[1],end[1],t),lerp(start[2],end[2],t)];
   line(at(a),at(b),-1,-1,1,.65);
   if(i%3)line(at(a).map((x,j)=>x+(j===0?.012:0)),at(b).map((x,j)=>x+(j===0?.012:0)),-1,-1,1,.26);
  }
 }
 // Three compound clusters at unequal heights. Leaf blades alternate around
 // their rachis, with distinct folds and fine diagonal veins.
 const branches=[
  {base:[-.01,-.18,.12],tip:[-.98,.01,.21],length:.38,leafCount:3,phase:.4},
  {base:[.02,-.54,-.04],tip:[1.08,-.32,.12],length:.42,leafCount:4,phase:1.9},
  {base:[-.02,-1.02,.11],tip:[-.80,-.78,.25],length:.40,leafCount:3,phase:3.1}
 ];
 const leafScale=clamp(v.leafSize??1,.5,1.5);
 for(let branch=0;branch<branches.length;branch++){
  const spec=branches[branch],[sx,sy,sz]=spec.base,tip=[sx+(spec.tip[0]-sx)*leafScale,sy+(spec.tip[1]-sy)*leafScale,spec.tip[2]],side=Math.sign(tip[0]-sx);
  line(spec.base,tip,-1,-1,1,.74,branch,sy);
  for(let leaf=0;leaf<spec.leafCount;leaf++){
   const terminal=leaf===spec.leafCount-1,along=terminal?.83:.24+leaf*.21,bladeSide=leaf%2?-1:1,base=[lerp(sx,tip[0],along),lerp(sy,tip[1],along),lerp(sz,tip[2],along)];
   const length=spec.length*leafScale*(terminal?1.12:.84+.12*Math.sin(leaf+branch)),angle=(side<0?Math.PI:0)+(terminal?-.10*side:bladeSide*.62),dx=Math.cos(angle)*length,dy=Math.sin(angle)*length;
   const at=(u,t)=>{
    const serration=1+.07*Math.sin(t*Math.PI*12),width=Math.pow(Math.sin(Math.PI*t),.80)*length*(terminal?.29:.32)*serration;
    const fold=length*(.13*Math.abs(u)-.08*u)*Math.sin(Math.PI*t),arch=length*.16*Math.sin(Math.PI*t);
    return[base[0]+dx*t-u*width*Math.sin(angle),base[1]+dy*t+u*width*Math.cos(angle),base[2]+arch+fold+length*.07*Math.sin(spec.phase+leaf)*t];
   };
   for(let j=0;j<7;j++)for(let k=0;k<2;k++){
    const t0=j/7,t1=(j+1)/7,u0=k-1,u1=k;
    face([at(u0,t0),at(u1,t0),at(u1,t1),at(u0,t1)],-1,-1,1,.30+.12*k+.16*rand(),branch,sy);
   }
   for(const edge of [-1,0,1]){
    let previous=at(edge,0);
    for(let i=1;i<=14;i++){const next=at(edge,i/14);line(previous,next,-1,-1,1,edge===0?.84:.40,branch,sy);previous=next;}
   }
   for(let vein=1;vein<=5;vein++){
    const t=.10+vein*.13;
    for(const edge of [-1,1])line(at(0,t),at(edge,Math.min(.95,t+.13)),-1,-1,1,.50,branch,sy);
   }
  }
 }
 return{faces,lines,petals,centres:ROSE_CENTRES};
}
