import {seeded} from './kit.js';

// Paint at a fixed pixel pitch; the finished plate lives in the panel cache.
// The strata follow the margins, leaving clearings for the controls and animals.
export function paintCrawlHabitat(ctx,panel,amount){
 if(!amount)return;
 const {w,h}=panel,pitch=Math.max(1.4,Math.min(w,h)/290);
 const layer=document.createElement('canvas');
 const width=layer.width=Math.ceil(w/pitch),height=layer.height=Math.ceil(h/pitch);
 const c=layer.getContext('2d'),random=seeded(1407);
 const pixel=(x,y,dx,dy,colour)=>{c.fillStyle=colour;c.fillRect(Math.floor(x),Math.floor(y),dx,dy);};
 const shelf=(x,anchor,radius)=>Math.exp(-((x-anchor)**2)/(radius*radius));
 const roof=[],floor=[];
 const relief=Math.min(height,width*.66);
 for(let x=0;x<width;x++){
  const t=x/width,crag=Math.sin(x*.095)*2+Math.sin(x*.34)*1.2+random()*2;
  roof[x]=Math.round(2+crag+relief*(.14*shelf(t,.29,.12)+.06*shelf(t,.73,.075)+.05*shelf(t,.97,.13)));
  floor[x]=Math.round(height-2+crag-relief*(.09*shelf(t,.06,.085)+.09*shelf(t,.72,.12)));
 }
 // Distant grottoes: broken masonry recedes through cold mineral light.
 for(const [centre,y,spread,tint] of [[.27,.15,.34,'55,104,124'],[.71,.74,.30,'55,76,109'],[.08,.90,.18,'46,99,88']]){
  c.save();c.translate(width*centre,height*y);c.scale(width*spread,height*.48);
  const pool=c.createRadialGradient(0,0,0,0,0,1);
  pool.addColorStop(0,'rgba('+tint+',.65)');pool.addColorStop(.55,'rgba('+tint+',.21)');pool.addColorStop(1,'rgba('+tint+',0)');
  c.fillStyle=pool;c.fillRect(-1,-1,2,2);c.restore();
 }
 // Recessed uprights and ledges behind the nearer lip break up the flat field.
 for(let j=0;j<24;j++){
  const x=Math.floor(random()*width),y=roof[x],drop=4+Math.floor(random()*random()*relief*.34);
  pixel(x,y,1+Math.floor(random()*3),drop,'#15212b78');
  pixel(x-2,y+drop-1,4+Math.floor(random()*6),1,'#3a57604d');
  pixel(x+1,y+drop,1,Math.floor(drop*.4),'#32445244');
 }
 for(let x=0;x<width;x++){
  const y=roof[x],bottom=floor[x],rear=y+4+Math.sin(x*.055)*3;
  pixel(x,0,1,rear,'#192832');pixel(x,0,1,y,'#0d171e');
  if(random()<.48)pixel(x,y-1,1,1,random()<.4?'#395351':'#273e43');
  pixel(x,bottom,1,height-bottom,'#0d191e');
  if(random()<.65)pixel(x,bottom,1,1,random()<.2?'#436660':'#293e42');
 }
 // Chipped strata are lit along their lower edges.
 for(let j=0;j<width*.75;j++){
  const x=Math.floor(random()*width),deep=Math.floor(random()**2*9);
  const y=random()<.55?roof[x]-deep:floor[x]+deep;
  pixel(x,y,1+Math.floor(random()**2*6),1,random()<.5?'#344553':'#22313b');
 }
 // Ferns and mycelium hang in irregular groups from the lip of the roof.
 for(const centre of [.06,.24,.31,.61,.76,.96]){
  for(let j=0;j<11;j++){
   let x=Math.floor(width*(centre+(random()-.5)*.075));if(x<0||x>=width)continue;
   let y=roof[x],length=(3+random()**2*relief*.11),curl=random()*6;
   for(let i=0;i<length;i++){
    const px=x+Math.round(Math.sin(i*.18+curl)*1.9);
    pixel(px,y+i,1,1,i%4===0?'#3e6259':'#254445');
    if(i%4===1&&i<length*.74)pixel(px+(i%8===1?-2:1),y+i-1,2,1,'#395856');
    if(i===Math.floor(length)-1&&j%3===0)pixel(px,y+i,1,2,'#83b99a');
   }
  }
 }
 // Clusters of cup fungi on the lower shelf, with bright gills under dark caps.
 for(const centre of [.06,.12,.69,.74,.91]){
  for(let j=0;j<5;j++){
   const x=Math.floor((centre+(random()-.5)*.045)*width),base=floor[x];
   const stem=3+Math.round(random()*5),r=1+Math.round(random()*2),y=base-stem;
   const light=c.createRadialGradient(x,y,0,x,y,r*4);
   light.addColorStop(0,'#83dfb85c');light.addColorStop(.4,'#4aceab25');light.addColorStop(1,'#306f7100');
   c.fillStyle=light;c.fillRect(x-r*4,y-r*4,r*8,r*8);
   pixel(x,y,1,stem,'#586254');pixel(x-r,y,r*2+1,1,'#75a48d');
   pixel(x-r+1,y-1,r*2-1,1,j%3?'#435c64':'#765d78');
   pixel(x-r,y+1,1,1,'#c2c6a6');
  }
 }
 // Very fine grit in the exposed glass, baked once per plate.
 for(let i=0;i<width*height*.065;i++)pixel(random()*width,random()*height,1,1,random()<.5?'#8eb2c00c':'#03060d25');
 ctx.save();ctx.globalAlpha=amount;ctx.imageSmoothingEnabled=false;
 ctx.drawImage(layer,0,0,w,h);ctx.restore();
}
