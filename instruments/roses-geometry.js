import {clamp,lerp,seeded} from './kit.js';

const TAU=Math.PI*2;
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
export const ROSE_CENTRES=Object.freeze([
 [-.77,1.09,.36,.58,-.68,-.52],[-.37,1.51,-.25,.51,-1.24,-.18],
 [.29,1.53,.16,.56,-.94,.23],[.83,1.16,-.27,.50,-1.10,.58],[.48,.78,.53,.45,-.62,.10]
].map(Object.freeze));

/** Object-space botanical geometry, independent of raster size and camera.
 * Each petal is a folded bowl wall rather than a radial disk. Stable petal IDs
 * preserve a sounding note when density, layer count, or camera pose changes. */
export function buildRoseGeometry(v={}){
 const faces=[],lines=[],petals=[],interactions=[],rand=seeded(74619);
 const vertex=(p,flower,petal,leaf=-1,leafBase=0)=>({x:p[0],y:p[1],z:p[2],flower,petal,leaf,leafBase,interaction:petal>=0?petal:flower>=0?245+flower:leaf>=0?250+leaf:244,kind:petal>=0?'petal':flower>=0?'calyx':leaf>=0?'leaf':'stem'});
 const face=(points,flower,petal,ink,light,leaf=-1,leafBase=0)=>{
  const a=points[0],b=points[1],c=points[2],ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const normal=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],length=Math.hypot(...normal)||1;
  faces.push({vertices:points.map(p=>vertex(p,flower,petal,leaf,leafBase)),normal:normal.map(n=>n/length),flower,petal,ink,light,screen:points.map(()=>({})),z:0});
 };
 const line=(a,b,flower,petal,ink,alpha=.3,leaf=-1,leafBase=0)=>lines.push({a:vertex(a,flower,petal,leaf,leafBase),b:vertex(b,flower,petal,leaf,leafBase),ink,alpha});
 const branchLine=(a,b,branch,ta,tb,alpha)=>{line(a,b,-1,-1,1,alpha);const ln=lines.at(-1);Object.assign(ln.a,{kind:'branch',branch,path:ta,interaction:245+branch});Object.assign(ln.b,{kind:'branch',branch,path:tb,interaction:245+branch});};
 const layers=Math.round(clamp(v.petalLayers??4,2,5)),counts=[6,5,4,3,3],radii=[1,.76,.51,.31,.18];
 const curl=clamp(v.petalCurl??.7,0,1.5),width=clamp(v.petalWidth??1,.55,1.5);
 for(let flower=0;flower<ROSE_CENTRES.length;flower++){
  const size=ROSE_CENTRES[flower][3]*(v.bloomScale??1);
  for(let layer=0;layer<layers;layer++){
   const count=counts[layer],closed=layer/4;
   for(let p=0;p<count;p++){
    const id=flower*40+layer*8+p,seed=p*2.39+layer*.83+flower*1.71;
    const theta=p/count*TAU+layer*1.13+flower*.43+.055*Math.sin(seed*2);
    const radius=size*radii[layer]*(1+.08*Math.sin(seed)),halfWidth=Math.PI/count*(1.37+.24*width);
    const at=(u,vv)=>{
     // Rounded, irregular top edge. Unlike a fan, the side corners end lower
     // on the bowl; they never become repeated spikes around the silhouette.
     const round=.82+.18*Math.sqrt(Math.max(0,1-u*u));
     const t=vv*round,lip=smooth((t-.70)/.30),opening=Math.sin(t*Math.PI*.5);
     const angle=theta+u*halfWidth*(.20+.80*Math.pow(opening,.66))+.42*closed*t*t;
     const coreTurn=layer>=3?(p===0?.43:.18)*smooth((t-.58)/.42):.07*closed*lip;
     // A broad shoulder makes every head round in profile. All petals attach
     // within the receptacle, then swell outward before their rolled rim.
     const root=size*(.075+.007*layer),shoulder=Math.pow(opening,.57);
     const r=(root+(radius-root)*shoulder+radius*.075*Math.sin(Math.PI*t)+radius*.05*(1-closed)*lip)*(1+.028*Math.sin(u*3.7+seed)*t*t)*(1-coreTurn);
     // Tall inner petals interleave above the turned-out outer lips. A side
     // fold and a gentle oblique crease make each sheet catch light distinctly.
     const wall=size*(-.335+(1.13+.045*closed)*t+.020*layer*t);
     const roll=radius*(.23+.12*curl)*(1-.42*closed)*lip;
     const side=radius*(.07+.085*curl)*u*u*Math.sin(t*Math.PI*.85);
     const crease=radius*.065*Math.sin(u*3.1+seed)*Math.sin(t*Math.PI);
     const ruffle=radius*.025*Math.sin(u*7.2+seed*1.3)*lip;
     return[Math.cos(angle)*r,Math.sin(angle)*r,wall-roll+side+crease+ruffle];
    };
    petals.push({id,flower,layer,centre:at(0,.75),radius:radius*.60,kind:'petal'});
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
  // A closed, rounded receptacle unifies every petal root and the branch.
  // Its bottom stays on the renderer's z=-.39*size nodding pivot.
  const rings=[[-.39,.035],[-.30,.16],[-.13,.22]],segments=10;
  const ring=(row,angle)=>[Math.cos(angle)*rings[row][1]*size,Math.sin(angle)*rings[row][1]*size,rings[row][0]*size];
  for(let p=0;p<segments;p++){
   const a=p/segments*TAU,b=(p+1)/segments*TAU;
   for(let row=0;row<rings.length-1;row++)face([ring(row,a),ring(row,b),ring(row+1,b),ring(row+1,a)],flower,-1,1,.40+.10*Math.sin(a));
   face([[0,0,-.39*size],ring(0,b),ring(0,a),[0,0,-.39*size]],flower,-1,1,.35);
  }
  // Five narrow sepals wrap up the lower bowl; they do not form a separate
  // star behind it. Their creases remain readable in rear and side views.
  for(let p=0;p<5;p++){
   const angle=p/5*TAU+.15,at=(u,t)=>{
    const r=size*(.15+.37*t),width=size*.085*Math.sin(Math.PI*t),z=size*(-.34+.12*t-.025*Math.sin(Math.PI*t));
    return[Math.cos(angle)*r-Math.sin(angle)*u*width,Math.sin(angle)*r+Math.cos(angle)*u*width,z+Math.abs(u)*size*.025*Math.sin(Math.PI*t)];
   };
   for(let row=0;row<3;row++)face([at(-1,row/3),at(1,row/3),at(1,(row+1)/3),at(-1,(row+1)/3)],flower,-1,1,.42+.08*Math.cos(angle));
   let previous=at(0,0);for(let row=1;row<=5;row++){const next=at(0,row/5);line(previous,next,flower,-1,1,.65);previous=next;}
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
   branchLine(at(a),at(b),flower,a,b,.65);
   if(i%3)branchLine(at(a).map((x,j)=>x+(j===0?.012:0)),at(b).map((x,j)=>x+(j===0?.012:0)),flower,a,b,.26);
  }
  interactions.push({id:245+flower,kind:'stem',flower:-1,branch:flower,path:.62,centre:start.map((v,i)=>lerp(v,end[i],.62)),leaf:-1});
 }
 interactions.push({id:244,kind:'stem',flower:-1,centre:stem(.32),leaf:-1});
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
  line(spec.base,tip,-1,-1,1,.74,branch,sy);interactions.push({id:250+branch,kind:'stem',flower:-1,leaf:branch,leafBase:sy,centre:spec.base.map((v,i)=>lerp(v,tip[i],.45))});
  for(let leaf=0;leaf<spec.leafCount;leaf++){
   const faceStart=faces.length,lineStart=lines.length,interaction=220+branch*8+leaf;
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
   const axisLength=Math.hypot(dx,dy,Math.hypot(dx,dy)*.30),leafAxis=[dy/axisLength,-dx/axisLength,Math.hypot(dx,dy)*.30/axisLength];
   const tag=p=>{p.interaction=interaction;p.leafAnchor=base;p.leafAxis=leafAxis;p.leafT=clamp(((p.x-base[0])*dx+(p.y-base[1])*dy)/(dx*dx+dy*dy));};
   for(let i=faceStart;i<faces.length;i++){faces[i].interaction=interaction;faces[i].vertices.forEach(tag);}for(let i=lineStart;i<lines.length;i++){tag(lines[i].a);tag(lines[i].b);}
   interactions.push({id:interaction,kind:'leaf',flower:-1,leaf:branch,leafBase:sy,leafAnchor:base,leafAxis,leafT:.6,centre:at(0,.6)});
  }
 }
 return{faces,lines,petals,interactions:[...petals,...interactions],centres:ROSE_CENTRES};
}
