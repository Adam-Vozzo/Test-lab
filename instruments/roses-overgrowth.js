import {clamp,seeded,rgba} from './kit.js';

// One continuous ecosystem, deliberately crossing the console and sculpture seams.
export function createOvergrowth(canvas,api){
 const c=canvas.getContext('2d'),terrain=document.createElement('canvas'),g=terrain.getContext('2d');
 let key='',vines=[],spores=[],ripples=[],drops=[],serial=0;
 const snap=(n,p)=>Math.round(n/p)*p;
 function rebuild(v,layout,pad){
  const w=canvas.width,h=canvas.height,p=Math.max(1,v.pixelScale||2),random=seeded(7834),left=layout.left;
  terrain.width=w;terrain.height=h;vines=[];spores=[];
  // Broken copper traces, solder pads and stratified substrate under the growth.
  for(let i=0;i<110;i++){
   const x=random()*w,y=random()*h,len=20+random()*100;
   g.strokeStyle=rgba(i%4?'#4e7465':'#825277',.10+random()*.15);g.lineWidth=1;g.beginPath();g.moveTo(x,y);g.lineTo(x+len*.4,y);g.lineTo(x+len*.6,y+len*.22);g.lineTo(x+len,y+len*.22);g.stroke();
   g.fillStyle='#426b5d36';g.fillRect(x-1,y-1,3,3);
  }
  // Ruined machine ribs, offset slivers, exposed traces; no enclosing frame.
  const seam=layout.wide?left.x+left.w+layout.gap*.5:w*.56;
  for(let k=0;k<28;k++){
   const y=h*k/28,xx=seam+Math.sin(k*.8)*14,ww=8+random()*28;
   g.fillStyle=k%3?'#17312f':'#2e293e';g.fillRect(snap(xx,p),snap(y,p),ww,4+random()*13);
   g.fillStyle='#63ad8636';g.fillRect(xx,y,ww*.8,1);
   if(k%3===0){g.strokeStyle='#5a87894a';g.beginPath();g.moveTo(xx,y);g.lineTo(xx-28,y+17);g.lineTo(xx-70,y+17);g.stroke();}
  }
  // Asymmetric root systems, hanging vines and branching coral, not repeated fern stamps.
  const anchors=[
   [.02,.98,.45,-.65],[.04,.97,.08,-.75],[.17,.97,.32,-.35],
   [.47,.96,.48,-.36],[.52,.91,.63,-.7],[.48,.65,.4,-.45],
   [.99,.03,.82,.68],[.98,.02,.93,.44],[.72,0,.6,.22],
   [.02,.04,.27,.13],[.01,.45,.2,.34],[.99,.99,.78,.75]
  ];
  for(let a=0;a<anchors.length;a++){
   const [ax,ay,bx,by]=anchors[a],points=[];const length=48;
   for(let j=0;j<=length;j++){
    const f=j/length,x=(ax+(bx-ax)*f)*w+Math.sin(f*8+a)*Math.sin(f*Math.PI)*w*.035,
     y=ay*h+(by<0?by*h*f:(by-ay)*h*f)+Math.sin(f*9+a)*Math.sin(f*Math.PI)*h*.035;
    points.push({x:snap(x,p),y:snap(y,p),f});
   }
   vines.push({points,phase:random()*6.28,type:a%4,thick:a%3===0,seed:random(),branches:Array.from({length:24},()=>random())});
  }
  for(let i=0;i<150;i++)spores.push({x:random()*w,y:random()*h,phase:random()*6.28,speed:3+random()*12,seed:random()});
  // Dense moss colonies with scalloped, uneven silhouettes rooted in the floor and seams.
  for(let i=0;i<34000*(v.growthDensity??1);i++){
   const x=random()*w,y=random()*h;
   const floor=Math.pow(y/h,12)*(Math.sin(x/w*16)*.5+.5),edge=Math.exp(-Math.abs(x-seam)/42)*(.2+.8*Math.pow(Math.sin(y*.011),2)),ceiling=Math.exp(-y/30)*Math.pow(x/w,3);
   if(random()>Math.max(floor*.9,edge*.7,ceiling*.7))continue;
   const colour=['#183c34','#295743','#4b7d59','#326675','#603655','#906293'][Math.floor(random()*6)];
   g.fillStyle=rgba(colour,.55+random()*.4);g.fillRect(snap(x,p),snap(y,p),p*(1+Math.floor(random()*3)),p*(1+Math.floor(random()*4)));
  }
 }
 function draw(v,t,snapShot,layout,pad){
  const w=canvas.width,h=canvas.height,p=Math.max(1,v.pixelScale||2),density=v.growthDensity??1,glow=v.bioGlow??.8,life=clamp(snapShot.rms*9),mt=api.reducedMotion?0:t*(v.growthMotion??.45);
  const next=[w,h,p,density,layout.left.w,layout.left.h].join('/');if(next!==key){key=next;rebuild(v,layout,pad);}
  c.clearRect(0,0,w,h);c.drawImage(terrain,0,0);
  // Quiet bioluminescent fog sits behind bright, individually resolved pixel tips.
  for(const q of [[.49,.7,120,'#26d6bc'],[.05,.91,120,'#68ab6c'],[.95,.09,110,'#d94d9e']]){
   const r=q[2]*Math.min(w/1000,1),a=c.createRadialGradient(q[0]*w,q[1]*h,0,q[0]*w,q[1]*h,r);a.addColorStop(0,rgba(q[3],(.045+life*.04)*glow));a.addColorStop(1,'transparent');c.fillStyle=a;c.fillRect(q[0]*w-r,q[1]*h-r,r*2,r*2);
  }
  for(let n=0;n<Math.min(vines.length,Math.ceil(vines.length*density));n++){
   const vine=vines[n],pts=vine.points;c.beginPath();
   for(let j=0;j<pts.length;j++){const q=pts[j],sway=Math.sin(mt+vine.phase+q.f*4)*q.f*5,x=q.x+sway,y=q.y;if(j){c.lineTo(x,pts[j-1].y);c.lineTo(x,y);}else c.moveTo(x,y);}
   c.strokeStyle=rgba('#0d2220',.98);c.lineWidth=(vine.thick?3:2)*p;c.stroke();
   c.strokeStyle=rgba(v.mossColour||'#62a58c',.48+life*.2);c.lineWidth=p;c.stroke();
   for(let j=3;j<pts.length-2;j+=1){
    const q=pts[j],f=q.f;
    // Bare weathered spans alternate with dense colonies; the plant has a hierarchy.
    const colony=n===0||n===2?f<.55:n===4?f<.40:n===9?f>.12&&f<.8:n===6?f>.35&&f<.72:n===11?f<.5:(j%7===0);
    if(!colony)continue;
    const sway=Math.sin(mt+vine.phase+f*4)*f*5,x=q.x+sway,y=q.y,side=j%4===1?-1:1,r=vine.branches[j%24],length=(15+r*32)*(1-f*.35)*Math.min(w/1050,1);
    if(vine.type===2){ // thin hanging roots with luminous terminal seed pods
     c.strokeStyle=rgba(v.mossColour,.42);c.lineWidth=p;c.beginPath();c.moveTo(x,y);c.lineTo(x+side*length*.5,y+length*.3);c.lineTo(x+side*length*.5,y+length);c.stroke();
     const xx=x+side*length*.5,yy=y+length;c.fillStyle=rgba('#8fe2bc',(.5+.3*Math.sin(mt*2+j))*glow);c.fillRect(xx-p,yy,3*p,2*p);
    }else if(vine.type===3){ // branching pink coral / fungal cups
     c.fillStyle=rgba('#543450',.9);c.fillRect(x+side*length*.3,y-3*p,length*.6,4*p);c.fillStyle=rgba('#d775b5',.6*glow);c.fillRect(x+side*length*.3,y-4*p,length*.6,p);c.fillStyle='#6e4879';c.fillRect(x+side*length*.3+p*2,y-5*p,length*.6-p*4,p);if(j%4===0){c.shadowBlur=10;c.shadowColor='#ef60bb';c.fillStyle=rgba('#ffc2e7',.9*glow);c.fillRect(x+side*length*.3,y-4*p,p*2,p);c.shadowBlur=0;}
    }else{
     for(const dir of [-1,1]){
      const ll=length*(dir===1?1:.7),offset=j%2?5:-3;
      for(let k=0;k<ll;k+=p){const f2=k/ll,ww=Math.max(p,Math.sin(f2*Math.PI)*ll*.48),xx=x+dir*k*.88,yy=y-k*.5+offset;
       c.fillStyle=rgba('#142e2a',.98);c.fillRect(snap(xx-ww/2,p)-p,snap(yy,p),snap(ww,p)+p*2,p*2);
       c.fillStyle=rgba(j%5?'#34654c':'#534267',.9);c.fillRect(snap(xx-ww/2,p),snap(yy,p),snap(ww,p),p*2);
       c.fillStyle=rgba(v.mossColour,.65);c.fillRect(snap(xx,p),snap(yy,p),p,p);
       if(k%(p*3)===0){c.fillStyle=rgba('#a4d6a0',.5*glow);c.fillRect(snap(xx+ww*.25,p),snap(yy,p),p,p);c.fillStyle=rgba('#79b299',.45);c.fillRect(snap(xx-ww*.3,p),snap(yy+p,p),p,p);}
      }
     }
    }
    // Rare high-luminance tips, not a uniform global glow.
    if(j%13===3){const a=(.75+.25*Math.sin(mt*1.5+vine.phase+j))*glow;const tint=n%3?'#45ffd0':'#ff72c2';const halo=c.createRadialGradient(x,y,0,x,y,17);halo.addColorStop(0,rgba(tint,.32*a));halo.addColorStop(1,'transparent');c.fillStyle=halo;c.fillRect(x-17,y-17,34,34);c.shadowBlur=12;c.shadowColor=tint;c.fillStyle=rgba(n%3?'#c8ffe7':'#ffe0f4',a);c.fillRect(snap(x,p),snap(y,p),p*3,p*2);c.shadowBlur=0;}
   }
  }
  // Mycelium flowing through the living timbre surface, its branching shaped by sound.
  if(pad){const {x,y,w:pw,h:ph}=pad,glass=api.state.sound.roseGlass,body=api.state.sound.roseBody;
   c.save();c.beginPath();c.rect(x,y,pw,ph);c.clip();
   for(let k=0;k<26;k++){
    c.beginPath();for(let j=0;j<46;j++){const f=j/45,xx=x+f*pw,yy=y+ph*(.18+k/37)+Math.sin(f*6+k*.2+mt*.3)*ph*(.08+body*.12)+Math.sin(f*17+k)*glass*8;j?c.lineTo(snap(xx,2),snap(yy,2)):c.moveTo(xx,yy);}
    c.strokeStyle=rgba(k%5?v.mossColour:v.petalColour,.17+life*.28);c.lineWidth=1;c.setLineDash(k%3?[2,5]:[11,4]);c.stroke();
   }c.setLineDash([]);c.restore();
  }
  // Slowly drifting fragments emerge from broken traces. No full-screen strobes.
  if(density>0)for(let i=0;i<Math.min(spores.length,50+density*60);i++){
   const s=spores[i],x=(s.x+Math.sin(mt*.5+s.phase)*18+w)%w,y=(s.y-mt*s.speed%h+h)%h,a=(.12+.35*Math.pow(Math.sin(mt+s.phase),4))*glow;
   c.fillStyle=rgba(i%5?'#80ddbd':'#f0a3e1',a);if(i%7===0){c.font='9px monospace';c.fillText(['+','∴','┐','0','░'][i%5],x,y);}else c.fillRect(snap(x,p),snap(y,p),p,p);
  }
  const glitch=v.corrosion??.55;
  if(!api.reducedMotion&&glitch>0){const beat=Math.floor(t*7),r=seeded(beat+221);if(r()<glitch*.38){const y=r()*h,x=r()*w;for(let k=0;k<9;k++){c.fillStyle=rgba(k%2?'#86e9cc':'#dd569c',.16+r()*.24);c.fillRect(x+r()*65,y+k*2,2+r()*35,1);}}}
 }
 return{draw,
  queue(petal,when,velocity=.65){if(drops.length<24)drops.push({id:++serial,petal,when,velocity,hit:false});},
  rain(v,t,snapshot,box,points,impact){
   const w=canvas.width,h=canvas.height,p=Math.max(1,v.pixelScale||2),speed=api.state.sound.rainWind??.25,amount=api.state.sound.rainDensity??.7;
   if(api.state.playing&&!api.reducedMotion){for(let i=0;i<Math.round(90*amount);i++){const f=(t*(.35+(i%7)*.05)+i*.618)%1,x=((i*137.3+f*speed*100)%w),y=f*h;c.strokeStyle=rgba(i%9?'#66a49f':'#c7f5df',i%9?.15:.45);c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+speed*4,y+4+(i%5)*3);c.stroke();}}
   for(const d of drops){const point=points[d.petal];if(!point?.visible)continue;const f=clamp((snapshot.time-d.when)/.65),x=box.x+point.x-speed*80*(1-f),y=box.y+point.y*f-16*(1-f);
    if(snapshot.time>=d.when+.65){if(!d.hit){d.hit=true;if(api.state.playing){impact(d.petal,d.velocity);ripples.push({x:box.x+point.x,y:box.y+point.y,t,petal:d.petal});}}}
    else if(snapshot.time>=d.when){c.shadowBlur=6;c.shadowColor='#88ffe4';c.strokeStyle='#b4ffe3';c.lineWidth=1.5;c.beginPath();c.moveTo(x-speed*4,y-11);c.lineTo(x,y);c.stroke();c.shadowBlur=0;}
   }
   drops=drops.filter(d=>!d.hit&&snapshot.time<d.when+1.5);
   ripples=ripples.filter(r=>t-r.t<.8);for(const r of ripples){const age=t-r.t;c.strokeStyle=rgba('#d2ffe7',(1-age/.8)*.8);c.lineWidth=1;c.beginPath();c.ellipse(r.x,r.y,4+age*25,2+age*9,0,0,Math.PI*2);c.stroke();}
  },clear(){drops=[];ripples=[];},destroy(){terrain.width=terrain.height=0;vines=[];spores=[];drops=[];ripples=[];}};
}
