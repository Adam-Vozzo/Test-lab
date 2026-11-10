import {clamp,lerp,TAU} from './kit.js';

const KEYS=['pitch','range','shape','tone','resonance','decay','detune','gate','division','accent'];
const TYPES=['dial','toggle','dial','fader','dial','fader','dial','toggle','dial','toggle'];
const LABELS=['OSC / 01','OSC / 02','OSC / 03','OSC / 04'];
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const point=(x,y)=>({x,y});
const finite=(v,fallback)=>Number.isFinite(v)?v:fallback;
const creatureScale=panel=>Math.min(panel.unit*1.22,panel.arena.w/240,panel.arena.h/260);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

/** One responsive geometry source for drawing, feet, reach and control contact. */
export function buildCrawlPanel(width,height){
 const w=Math.max(120,finite(width,1000)),h=Math.max(160,finite(height,620));
 const unit=clamp(Math.min(w/1000,h/620),.42,1.65),pad=Math.max(12,17*unit),header=56;
 const sequenceH=Math.max(42,52*unit),gapX=Math.max(20,34*unit),gapY=Math.max(25,35*unit);
 const innerW=w-pad*2,zoneW=(innerW-gapX)/2,top=header+4,bottom=h-sequenceH-15;
 const zoneH=Math.max(36,(bottom-top-gapY)/2),zones=[],controls=[];
 for(let lane=0;lane<4;lane++){
  const x=pad+(lane%2)*(zoneW+gapX),y=top+Math.floor(lane/2)*(zoneH+gapY);
  const zone={id:'voice-'+lane,lane,label:LABELS[lane],x,y,w:zoneW,h:zoneH};zones.push(zone);
  const title=Math.min(22,zoneH*.19),columns=w<600&&h>w?2:5,rows=10/columns,cellW=zoneW/columns,cellH=(zoneH-title)/rows;
  for(let index=0;index<KEYS.length;index++){
   const cx=x+cellW*(index%columns+.5),cy=y+title+cellH*(Math.floor(index/columns)+.48);
   const values=[[0,2/7,4/7,6/7][lane],[.15,.75,.65,.25][lane],[0,1/3,2/3,1/3][lane],.52+lane*.08,.18,.42+lane*.09,.16+lane*.08,1,[1/3,2/3,0,1/3][lane],lane===0?1:0];
   const cw=Math.max(10,cellW*.64),ch=Math.max(10,cellH*.64);
   controls.push({id:'v'+lane+'-'+KEYS[index],key:KEYS[index],lane,index,type:TYPES[index],x:cx-cw/2,y:cy-ch/2,w:cw,h:ch,cx,cy,value:values[index],previous:values[index],changedAt:-Infinity,activeBy:null});
  }
 }
 const sequence={x:pad,y:h-sequenceH-5,w:innerW,h:sequenceH},cellW=innerW/16;
 for(let index=0;index<16;index++){
  const cx=sequence.x+(index+.5)*cellW,cy=sequence.y+sequence.h*.52,value=[3,7,11,15].includes(index)?0:1;
  controls.push({id:'step-'+String(index).padStart(2,'0'),key:'step',lane:-1,index,type:'key',x:cx-cellW*.32,y:cy-sequenceH*.21,w:cellW*.64,h:sequenceH*.42,cx,cy,value,previous:value,changedAt:-Infinity,activeBy:null});
 }
 return{w,h,unit,zones,controls,sequence,meter:{x:pad+8,y:top+zoneH+4,w:innerW-16,h:Math.max(16,gapY-8)},arena:{x:pad,y:header,w:innerW,h:Math.max(30,h-header-11)}};
}


export const crawlControlRadius=(q,unit=1)=>Math.max(7.5,Math.min(30*unit,q.w*.40,q.h*.43));
export function crawlControlValue(q,time=Infinity){const since=time-finite(q.changedAt,-Infinity);return since>=0&&since<.18?lerp(finite(q.previous,q.value),q.value,smooth(since/.18)):q.value;}
/** The exact visible grip used by both the control renderer and manipulator. */
export function crawlActuatorPoint(q,unit=1,time=Infinity){
 const value=crawlControlValue(q,time),r=crawlControlRadius(q,unit);
 if(q.type==='dial'){const a=Math.PI*.75+value*Math.PI*1.5;return{x:q.cx+Math.cos(a)*r*.63,y:q.cy+Math.sin(a)*r*.63};}
 if(q.type==='fader')return{x:q.cx,y:q.cy+r*.85-value*r*1.7};
 if(q.type==='toggle')return{x:q.cx+Math.min(q.w*.42,24*unit)*.18,y:q.cy+lerp(r*.68,-r*.68,value)};
 return{x:q.cx,y:q.cy};
}

/** Analytic two-bone solve: hip and foot are authoritative; elbow bends out. */
export function solveCrawlIK(hip,foot,upper,lower,bend=1){
 const dx=foot.x-hip.x,dy=foot.y-hip.y,d=Math.max(.0001,Math.hypot(dx,dy));
 const reach=clamp(d,Math.abs(upper-lower)+.0001,upper+lower-.0001),along=(upper*upper-lower*lower+reach*reach)/(2*reach),height=Math.sqrt(Math.max(0,upper*upper-along*along));
 return{x:hip.x+dx/d*along-dy/d*height*bend,y:hip.y+dy/d*along+dx/d*height*bend};
}

export class CrawlWorld{
 constructor(seed=417){
  this.seed=(Number.isFinite(seed)?seed:417)>>>0;this._randomState=this.seed;this.time=0;this.mode='wander';this.creatures=[];this.guides=new Map();this.panel=buildCrawlPanel(1000,620);this.controls=this.panel.controls;this._population=3;this._settings={speed:.65,activity:.65,curiosity:.65,population:3,mode:'wander',reducedMotion:false};this._createPopulation(3);
 }
 random(){this._randomState=(Math.imul(this._randomState,1664525)+1013904223)>>>0;return this._randomState/4294967296;}
 _createPopulation(count){
  while(this.creatures.length<count){
   const index=this.creatures.length,positions=[[.62,.36],[.29,.68],[.79,.69],[.27,.30],[.50,.55]],p=positions[index],kind=index===0?'centipede':'spider';
   const creature={id:'crawl-'+index,index,kind,colourIndex:index%4,x:this.panel.w*p[0],y:this.panel.h*p[1],angle:-1.6+index*1.8,scale:this.panel.unit,segments:[],legs:[],feelers:[],state:'wander',targetId:null,reach:null,pulse:0,phase:this.random()*TAU,timer:.15+index*.42,velocity:0,travel:0,lastAct:-Infinity,visited:[],destination:null,_swing:0};
   this.creatures.push(creature);this._resetSkeleton(creature);
  }
  if(this.creatures.length>count){const removed=new Set(this.creatures.splice(count).map(c=>c.id));for(const [key,g]of this.guides)if(removed.has(g.creatureId))this.guides.delete(key);for(const control of this.controls)if(removed.has(control.activeBy))control.activeBy=null;}
  this._population=count;
 }
 _resetSkeleton(c){
  const u=creatureScale(this.panel),gap=(c.kind==='centipede'?12:14)*u,count=c.kind==='centipede'?13:3;c.scale=u;c.segments=[];c.legs=[];
  // Saved heads do not include their curved tails. Reconstruct inside the same
  // walking margin, bending the spine at an edge instead of projecting a long
  // straight tail outside the viewport. Every link retains its physical length.
  const a=this.panel.arena,margin=36*u,left=a.x+margin,right=a.x+a.w-margin,top=a.y+margin,bottom=a.y+a.h-margin;
  c.x=clamp(c.x,left,right);c.y=clamp(c.y,top,bottom);c.segments.push({x:c.x,y:c.y,angle:c.angle,index:0});
  for(let index=1;index<count;index++){
   const previous=c.segments[index-1],back=previous.angle+Math.PI;let best=null,bestScore=Infinity;
   for(let step=0;step<=48;step++){
    const offset=(step%2?1:-1)*Math.ceil(step/2)*Math.PI/24,angle=back+offset,x=previous.x+Math.cos(angle)*gap,y=previous.y+Math.sin(angle)*gap;
    if(x<left||x>right||y<top||y>bottom)continue;
    const clearance=Math.min(x-left,right-x,y-top,bottom-y),score=Math.abs(offset)+Math.max(0,3*gap-clearance)/gap*.28;
    if(score<bestScore){bestScore=score;best={x,y,angle:Math.atan2(previous.y-y,previous.x-x),index};}
   }
   c.segments.push(best);
  }
  const attachments=c.kind==='centipede'?Array.from({length:11},(_,i)=>i+1):[0,0,1,1];
  for(let pair=0;pair<attachments.length;pair++)for(const side of[-1,1]){
   const s=c.segments[attachments[pair]],length=c.kind==='centipede'?38:46,forward=c.kind==='centipede'?7:(1.5-pair)*16;
   const hip=this._hip(c,s,side),foot=this._limitFoot(point(hip.x+Math.cos(s.angle)*forward*u-Math.sin(s.angle)*side*length*u,hip.y+Math.sin(s.angle)*forward*u+Math.cos(s.angle)*side*length*u));
   c.legs.push({index:pair,segment:attachments[pair],side,hip,knee:point(hip.x,hip.y),foot,planted:true,lift:0,phase:pair*.29+(side>0?.5:0),swing:0,from:{...foot},to:{...foot},lastStep:this.time+pair*.025,upper:(c.kind==='centipede'?26:32)*u,lower:(c.kind==='centipede'?29:35)*u});
  }
  this._pose(c,0,false);
 }
 _hip(c,s,side){const width=(c.kind==='centipede'?5.8:8)*c.scale;return{x:s.x-Math.sin(s.angle)*side*width,y:s.y+Math.cos(s.angle)*side*width};}
 _limitFoot(p){const a=this.panel.arena;return{x:clamp(p.x,a.x-5,a.x+a.w+5),y:clamp(p.y,a.y-8,a.y+a.h+5)};}
 resize(width,height){
  const w=Math.max(120,finite(width,1000)),h=Math.max(160,finite(height,620));if(this.panel.w===w&&this.panel.h===h)return;
  const old=this.panel,sx=w/old.w,sy=h/old.h,values=new Map(old.controls.map(c=>[c.id,c]));this.panel=buildCrawlPanel(w,h);this.controls=this.panel.controls;
  for(const control of this.controls){const previous=values.get(control.id);if(previous)Object.assign(control,{value:previous.value,previous:previous.previous,changedAt:previous.changedAt,activeBy:null});}
  for(const c of this.creatures){c.x*=sx;c.y*=sy;c.reach=null;c.state='wander';c.targetId=null;c.destination=null;c.timer=.15+c.index*.1;this._resetSkeleton(c);}
  for(const g of this.guides.values()){g.x=clamp(g.x*sx,0,w);g.y=clamp(g.y*sy,0,h);}
 }
 setGuide(pointerId,x,y){
  let guide=this.guides.get(pointerId);
  if(!guide){const claimed=new Set([...this.guides.values()].filter(g=>!g.persistent).map(g=>g.creatureId)),available=this.creatures.filter(c=>!claimed.has(c.id));if(!available.length)return null;const c=available.reduce((a,b)=>Math.hypot(a.x-x,a.y-y)<=Math.hypot(b.x-x,b.y-y)?a:b);for(const [key,g]of this.guides)if(g.creatureId===c.id)this.guides.delete(key);guide={pointerId,creatureId:c.id,x:clamp(x,0,this.panel.w),y:clamp(y,56,this.panel.h),persistent:false};this.guides.set(pointerId,guide);c.timer=0;}
  guide.x=clamp(finite(x,guide.x),this.panel.arena.x,this.panel.arena.x+this.panel.arena.w);guide.y=clamp(finite(y,guide.y),this.panel.arena.y,this.panel.arena.y+this.panel.arena.h);guide.persistent=false;
  const c=this.creatures.find(c=>c.id===guide.creatureId);
  if(c&&(c.state==='wander'||c.state==='approach')){const target=this._chooseTarget(c,guide);if(target&&target.id!==c.targetId){c.targetId=target.id;c.state='approach';c.reach=null;c.timer=0;}}
  return guide.creatureId;
 }
 releaseGuide(pointerId,persist=false){const guide=this.guides.get(pointerId);if(!guide)return;guide.persistent=Boolean(persist);if(!persist)this.guides.delete(pointerId);}
 clearGuides(){this.guides.clear();}
 _guideFor(c){return[...this.guides.values()].find(g=>g.creatureId===c.id);}
 _chooseTarget(c,guide){
  const occupied=new Set(this.creatures.filter(other=>other!==c&&['reach','operate','approach'].includes(other.state)).map(other=>other.targetId)),u=this.panel.unit,curiosity=clamp(this._settings.curiosity??.65),origin=guide||c;
  let best=null,score=Infinity;
  for(const control of this.controls){
   if(occupied.has(control.id))continue;
   // Retain a few live sequence contacts so autonomous exploration has a pulse.
   if(control.key==='step'&&control.value>=.5&&this.controls.filter(q=>q.key==='step'&&q.value>=.5).length<=3)continue;
   const dx=control.cx-origin.x,dy=control.cy-origin.y,dist=Math.hypot(dx,dy),cooldown=Math.max(0,4-(this.time-control.changedAt))*24*u,seen=c.visited.includes(control.id)?46*u:0;
   const scoreValue=dist+(guide?0:this.random()*(25+curiosity*130)*u)+cooldown+seen+(control.key==='step'&&!guide?20*u:0);
   if(scoreValue<score){score=scoreValue;best=control;}
  }return best;
 }
 _beginApproach(c){const target=this._chooseTarget(c,this._guideFor(c));if(!target)return;c.targetId=target.id;c.state='approach';c.timer=0;c.destination=null;}
 _walk(c,target,dt,settings){
  const u=c.scale,dx=target.x-c.x,dy=target.y-c.y,dist=Math.hypot(dx,dy),speed=clamp(settings.speed??.65),desired=Math.atan2(dy,dx),diff=angleDiff(desired,c.angle),turn=(c.kind==='centipede'?2.8:5.6)*(0.45+speed);
  c.angle+=clamp(diff,-turn*dt,turn*dt);
  const gait=c.kind==='spider'?.56+.44*smooth(Math.sin(this.time*(3.6+speed*2.7)+c.phase)*.5+.5):.84+.16*Math.sin(this.time*2.2+c.phase),rate=(18+speed*72)*u*gait,advance=Math.min(dist,rate*dt)*Math.max(.1,Math.cos(Math.min(Math.abs(diff),Math.PI/2)));
  const previous=point(c.x,c.y);c.x+=Math.cos(c.angle)*advance;c.y+=Math.sin(c.angle)*advance;
  const a=this.panel.arena,margin=36*u;c.x=clamp(c.x,a.x+margin,a.x+a.w-margin);c.y=clamp(c.y,a.y+margin,a.y+a.h-margin);c.velocity=distance(c,previous)/Math.max(.001,dt);c.travel+=distance(c,previous);
  return dist;
 }
 _startReach(c,target){
  c.state='reach';c.timer=0;c.velocity=0;const u=c.scale,base=point(c.x+Math.cos(c.angle)*7*u,c.y+Math.sin(c.angle)*7*u),from=point(base.x+Math.cos(c.angle)*12*u-Math.sin(c.angle)*15*u,base.y+Math.sin(c.angle)*12*u+Math.cos(c.angle)*15*u);
  c.reach={base,knee:solveCrawlIK(base,from,34*u,34*u,c.index%2?-1:1),tip:from,from:{...from},progress:0,contact:false};
 }
 _reachPose(c,target,p){
  const r=c.reach;if(!r)return;const u=c.scale;r.base.x=c.x+Math.cos(c.angle)*7*u;r.base.y=c.y+Math.sin(c.angle)*7*u;r.progress=clamp(p);const t=smooth(r.progress);
  const grip=crawlActuatorPoint(target,this.panel.unit,this.time);r.tip.x=lerp(r.from.x,grip.x,t);r.tip.y=lerp(r.from.y,grip.y,t);r.knee=solveCrawlIK(r.base,r.tip,34*u,34*u,c.index%2?-1:1);r.contact=r.progress>=.999;
 }
 _operate(c,target){
  const oldValue=target.value;if(target.key==='step'&&oldValue>=.5&&this.controls.filter(q=>q.key==='step'&&q.value>=.5).length<=3)return null;let value=oldValue;
  if(['toggle','key'].includes(target.type))value=oldValue>=.5?0:1;
  else if(target.key==='pitch'){const previous=Math.round(oldValue*7),delta=[-3,-2,-1,1,2,3,4][Math.floor(this.random()*7)];value=clamp(previous+delta,0,7)/7;if(value===oldValue)value=previous>3?(previous-2)/7:(previous+2)/7;}
  else if(['shape','division'].includes(target.key)){value=((Math.round(oldValue*3)+1+Math.floor(this.random()*2))%4)/3;}
  else{const delta=(.15+this.random()*.31)*(this.random()<.5?-1:1);value=clamp(oldValue+delta,.04,.96);if(Math.abs(value-oldValue)<.08)value=clamp(oldValue-delta,.04,.96);}
  target.previous=oldValue;target.value=value;target.changedAt=this.time;target.activeBy=c.id;c.pulse=1;c.lastAct=this.time;c.visited.push(target.id);if(c.visited.length>4)c.visited.shift();
  return{creatureId:c.id,controlId:target.id,key:target.key,lane:target.lane,oldValue,value,time:this.time};
 }
 _pose(c,dt,reduced){
  const u=c.scale,head=c.segments[0];head.x=c.x;head.y=c.y;head.angle=c.angle;
  const gap=(c.kind==='centipede'?12:14)*u;
  for(let i=1;i<c.segments.length;i++){const p=c.segments[i-1],s=c.segments[i],dx=p.x-s.x,dy=p.y-s.y,d=Math.hypot(dx,dy)||1,angle=Math.atan2(dy,dx);s.x=p.x-dx/d*gap;s.y=p.y-dy/d*gap;s.angle=angle;}
  const moving=c.velocity>u*2,gaitRate=1.4+(this._settings.speed??.65)*1.8;
  for(const leg of c.legs){
   const segment=c.segments[leg.segment];leg.hip=this._hip(c,segment,leg.side);
   const forward=c.kind==='centipede'?11:(1.5-leg.index)*14,span=c.kind==='centipede'?38:45;
   const goal=this._limitFoot(point(leg.hip.x+Math.cos(segment.angle)*forward*u-Math.sin(segment.angle)*leg.side*span*u,leg.hip.y+Math.sin(segment.angle)*forward*u+Math.cos(segment.angle)*leg.side*span*u)),separation=distance(leg.foot,goal),extension=distance(leg.hip,leg.foot),phase=(this.time*gaitRate+leg.phase)%1;
   if(leg.planted&&((moving&&separation>14*u&&phase<.22)||extension>(leg.upper+leg.lower)*.91)){
    leg.planted=false;leg.swing=0;leg.from={...leg.foot};leg.to=goal;
   }
   if(!leg.planted){leg.swing=Math.min(1,leg.swing+dt/(.16+.11/(.5+(this._settings.speed??.65))));const t=smooth(leg.swing);leg.foot.x=lerp(leg.from.x,leg.to.x,t);leg.foot.y=lerp(leg.from.y,leg.to.y,t);leg.lift=reduced?0:Math.sin(leg.swing*Math.PI)*7*u;if(leg.swing>=1){leg.planted=true;leg.lift=0;leg.lastStep=this.time;}}
   else leg.lift=0;
   // A fast turn can carry a hip beyond a foot that is already in flight.
   // Fold that lifted foot back within the two real bone lengths; never stretch
   // a lower bone to an unreachable screen point or slide a planted stance.
   const dx=leg.foot.x-leg.hip.x,dy=leg.foot.y-leg.hip.y,d=Math.hypot(dx,dy),near=Math.abs(leg.upper-leg.lower)+.001,far=leg.upper+leg.lower-.001;
   if(d>far||d<near){const reach=clamp(d,near,far),a=d>.0001?Math.atan2(dy,dx):segment.angle+leg.side*Math.PI/2;leg.foot.x=leg.hip.x+Math.cos(a)*reach;leg.foot.y=leg.hip.y+Math.sin(a)*reach;if(leg.planted){leg.planted=false;leg.swing=.98;leg.to=goal;}leg.lift=reduced?0:Math.max(leg.lift,2*u);}
   // Feet remain fixed during stance; only the knee changes as the body passes.
   leg.knee=solveCrawlIK(leg.hip,leg.foot,leg.upper,leg.lower,leg.side*(c.kind==='centipede'?1:-1));
  }
  c.feelers=[-1,1].map(side=>{const a=c.angle+side*(.30+(reduced?0:Math.sin(this.time*2.7+c.phase+side)*.10)),base=point(c.x+Math.cos(c.angle)*7*u,c.y+Math.sin(c.angle)*7*u),knee=point(base.x+Math.cos(a)*16*u,base.y+Math.sin(a)*16*u),tip=point(knee.x+Math.cos(a+side*.21)*12*u,knee.y+Math.sin(a+side*.21)*12*u);return{base,knee,tip};});
 }
 update(dt,settings={}){
  dt=clamp(finite(dt,0),0,.05);this._settings={...this._settings,...settings};settings=this._settings;this.mode=settings.mode==='guide'?'guide':settings.mode==='wander'?'wander':this.mode;
  const population=Math.round(clamp(settings.population??this._population,1,5));if(population!==this._population)this._createPopulation(population);this.time+=dt;const actions=[],activity=clamp(settings.activity??.65);
  for(const c of this.creatures){
   c.scale=creatureScale(this.panel);c.timer-=dt;c.pulse*=Math.exp(-dt*5.5);const control=this.controls.find(q=>q.id===c.targetId);
   if(c.state==='wander'){
    if(!c.destination){const a=this.panel.arena;c.destination={x:clamp(c.x+(this.random()-.5)*160*c.scale,a.x+20*c.scale,a.x+a.w-20*c.scale),y:clamp(c.y+(this.random()-.5)*130*c.scale,a.y+20*c.scale,a.y+a.h-20*c.scale)};}
    this._walk(c,c.destination,dt,settings);if(c.timer<=0||this._guideFor(c))this._beginApproach(c);
   }else if(c.state==='approach'&&control){
    const grip=crawlActuatorPoint(control,this.panel.unit,this.time),dist=Math.hypot(grip.x-c.x,grip.y-c.y),stop=31*c.scale;
    if(dist<=stop+2*c.scale&&Math.abs(angleDiff(Math.atan2(grip.y-c.y,grip.x-c.x),c.angle))<.28){this._startReach(c,control);}
    else{const angle=Math.atan2(grip.y-c.y,grip.x-c.x),target={x:grip.x-Math.cos(angle)*stop,y:grip.y-Math.sin(angle)*stop};if(dist<stop-3*c.scale){c.angle+=angleDiff(angle,c.angle)*Math.min(1,dt*8);c.velocity=0;this._startReach(c,control);}else{this._walk(c,dist<stop+3*c.scale?{x:grip.x,y:grip.y}:target,dt,settings);}}
   }else if(c.state==='reach'&&control){
    c.velocity=0;this._reachPose(c,control,(c.reach?.progress||0)+dt/(.43+(1-activity)*.24));if(c.reach.contact){c.state='operate';c.timer=.12;c._operated=false;}
   }else if(c.state==='operate'&&control){
    c.velocity=0;this._reachPose(c,control,1);if(c.timer<=0&&!c._operated){const action=this._operate(c,control);if(action)actions.push(action);c._operated=true;c.timer=.20+(1-activity)*.14;}else if(c.timer<=0&&c._operated){c.state='recover';c.timer=.36;}
   }else if(c.state==='recover'&&control){c.velocity=0;this._reachPose(c,control,Math.max(0,c.timer/.36));if(c.timer<=0){if(control.activeBy===c.id)control.activeBy=null;c.reach=null;c.targetId=null;c.destination=null;c.state='wander';c.timer=.12+(1-activity)*1.3+this.random()*.5;}}
   else{c.state='wander';c.timer=.1;c.targetId=null;c.reach=null;}
   this._pose(c,dt,Boolean(settings.reducedMotion));
  }
  return actions;
 }
 getData(){return{seed:this.seed,randomState:this._randomState,mode:this.mode,controls:Object.fromEntries(this.controls.map(c=>[c.id,c.value])),creatures:this.creatures.map(c=>({id:c.id,x:c.x/this.panel.w,y:c.y/this.panel.h,angle:c.angle})),guides:[...this.guides.values()].filter(g=>g.persistent).map(g=>({creatureId:g.creatureId,x:g.x/this.panel.w,y:g.y/this.panel.h}))};}
 setData(data){
  if(!data||typeof data!=='object')return;
  if(Number.isFinite(data.seed))this.seed=data.seed>>>0;if(Number.isFinite(data.randomState))this._randomState=data.randomState>>>0;else this._randomState=this.seed;
  if(data.mode==='guide'||data.mode==='wander')this.mode=data.mode;
  if(data.controls&&typeof data.controls==='object'&&!Array.isArray(data.controls))for(const c of this.controls)if(Number.isFinite(data.controls[c.id])){c.value=c.previous=clamp(data.controls[c.id]);c.changedAt=-Infinity;c.activeBy=null;}
  if(Array.isArray(data.creatures)&&data.creatures.length>=1&&data.creatures.length<=5)this._createPopulation(data.creatures.length);
  if(Array.isArray(data.creatures))for(const saved of data.creatures){const c=this.creatures.find(q=>q.id===saved?.id);if(!c||!Number.isFinite(saved.x)||!Number.isFinite(saved.y))continue;c.x=clamp(saved.x,.04,.96)*this.panel.w;c.y=clamp(saved.y,.1,.95)*this.panel.h;c.angle=finite(saved.angle,c.angle);c.state='wander';c.timer=.1;c.reach=null;c.targetId=null;c.destination=null;this._resetSkeleton(c);}
  // Constructing additional bodies seeds their individual phases; an imported
  // random stream resumes after construction, rather than consuming new draws.
  if(Number.isFinite(data.randomState))this._randomState=data.randomState>>>0;
  this.guides.clear();if(this.mode==='guide'&&Array.isArray(data.guides))for(const [index,g]of data.guides.slice(0,5).entries()){if(!this.creatures.some(c=>c.id===g?.creatureId)||!Number.isFinite(g.x)||!Number.isFinite(g.y))continue;this.guides.set('saved-'+index,{pointerId:'saved-'+index,creatureId:g.creatureId,x:clamp(g.x)*this.panel.w,y:clamp(g.y)*this.panel.h,persistent:true});}
 }
}
