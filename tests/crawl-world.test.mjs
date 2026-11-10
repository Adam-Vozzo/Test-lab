import test from 'node:test';
import assert from 'node:assert/strict';
import {CrawlWorld,buildCrawlPanel,crawlActuatorPoint,crawlControlValue,crawlAnatomy,CRAWL_SPECIES} from '../instruments/crawl-world.js';
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
const fullAudio=()=>({level:1,bass:1,mid:1,treble:1,attack:1,segments:Array(13).fill(1)});
const checkAppendages=(c,w,h)=>{
 const inside=p=>assert.ok(Number.isFinite(p.x+p.y)&&p.x>=0&&p.x<=w&&p.y>=0&&p.y<=h,`${c.kind} appendage ${p.x},${p.y} escaped ${w}×${h}`);
 for(const feeler of c.feelers)for(const p of[feeler.base,feeler.knee,feeler.tip])inside(p);
 for(const claw of c.claws){for(const p of[claw.base,claw.knee,claw.tip,claw.innerTip,claw.outerTip])inside(p);close(dist(claw.base,claw.knee),claw.upper);close(dist(claw.knee,claw.tip),claw.lower);}
 for(const [index,p]of c.tail.entries()){inside(p);if(index)close(dist(p,c.tail[index-1]),crawlAnatomy(c.kind).tail.length*c.scale);}
};

// Test the same physical geometry drawn in production, not an independent hit map.
test('all 56 responsive controls and actuator grips remain inside their panel',()=>{
 let ids;
 for(const [w,h]of [[844,327],[1280,820],[390,740]]){
  const p=buildCrawlPanel(w,h);assert.equal(p.controls.length,56);assert.equal(p.zones.length,4);
  const current=p.controls.map(q=>q.id);if(ids)assert.deepEqual(current,ids);else ids=current;
  for(const q of p.controls)for(const value of[0,1]){const grip=crawlActuatorPoint({...q,value},p.unit);assert.ok(grip.x>0&&grip.x<w&&grip.y>56&&grip.y<h,q.id);}
  const ys=new Set(p.controls.filter(q=>q.lane===0).map(q=>q.cy));assert.equal(ys.size,w<h?5:2);
 }
});

test('creature scale grows independently of controls and is capped on tiny arenas',()=>{
 for(const [w,h]of [[844,327],[1280,820],[390,740]]){
  const world=new CrawlWorld();world.resize(w,h);const panel=buildCrawlPanel(w,h);
  assert.deepEqual(world.controls.map(q=>[q.cx,q.cy,q.w,q.h]),panel.controls.map(q=>[q.cx,q.cy,q.w,q.h]));
  for(const c of world.creatures)close(c.scale/world.panel.unit,1.22);
 }
 const tiny=new CrawlWorld();tiny.resize(240,180);assert.ok(tiny.creatures.every(c=>c.scale<tiny.panel.unit*1.22));
});

test('guidance cannot edit controls; only a reached, planted manipulator emits a change',()=>{
 const world=new CrawlWorld(92);world.resize(844,327);const before=world.getData().controls,q=world.controls.find(c=>c.id==='v0-tone');
 world.setGuide(7,q.cx,q.cy);world.setGuide(7,q.cx+10,q.cy+8);world.releaseGuide(7,true);
 assert.deepEqual(world.getData().controls,before);
 let actions=0,visibleTravel=0,followed=0;
 for(let frame=0;frame<1800;frame++){
  const previous=world.getData().controls,events=world.update(1/60,{population:3,mode:'guide',speed:1,activity:1});
  const changed=world.controls.filter(c=>c.value!==previous[c.id]).map(c=>c.id).sort();assert.deepEqual(changed,events.map(e=>e.controlId).sort());
  for(const event of events){const creature=world.creatures.find(c=>c.id===event.creatureId),control=world.controls.find(c=>c.id===event.controlId);assert.equal(creature.state,'operate');assert.ok(creature.reach.contact);close(dist(creature.reach.tip,crawlActuatorPoint(control,world.panel.unit,world.time)),0);assert.equal(event.oldValue,previous[control.id]);assert.equal(event.value,control.value);assert.notEqual(event.value,event.oldValue);actions++;}
  for(const c of world.creatures)if(c.reach&&c.state==='operate'){
   const control=world.controls.find(q=>q.id===c.targetId),grip=crawlActuatorPoint(control,world.panel.unit,world.time);close(dist(c.reach.tip,grip),0);followed++;
   if(world.time-control.changedAt>0&&world.time-control.changedAt<.18&&Math.abs(crawlControlValue(control,world.time)-control.value)>.001)visibleTravel++;
  }
 }
 assert.ok(actions>20,actions);assert.ok(followed>100,followed);assert.ok(visibleTravel>25,visibleTravel);
});

test('planted feet do not skate and both IK bones keep their lengths through turns and edges',()=>{
 for(const [w,h]of [[844,327],[1280,820],[390,740]]){
  const world=new CrawlWorld(417);world.resize(w,h);const previous=new Map();let steps=0,actions=0;
  for(let frame=0;frame<3600;frame++){
   if(frame%800===0)world.setGuide(1,frame%1600===0?15:w-15,frame%2400===0?65:h-15);
   actions+=world.update(1/60,{speed:1,activity:1,motionEnergy:1,population:5}).length;
   for(const c of world.creatures){
    checkAppendages(c,w,h);
    for(const s of c.segments)assert.ok(Number.isFinite(s.x+s.y+s.angle)&&s.x>=0&&s.x<=w&&s.y>=0&&s.y<=h,`${c.id} escaped the panel`);
    for(const [index,leg]of c.legs.entries()){
     const key=c.id+'-'+index,old=previous.get(key);if(old?.planted&&leg.planted)close(dist(old,leg.foot),0);if(old?.planted&&!leg.planted)steps++;
     close(dist(leg.hip,leg.knee),leg.upper);close(dist(leg.knee,leg.foot),leg.lower);for(const joint of[leg.hip,leg.knee,leg.foot])assert.ok(joint.x>=0&&joint.x<=w&&joint.y>=0&&joint.y<=h,'a limb escaped the viewport');previous.set(key,{...leg.foot,planted:leg.planted});
    }
    if(c.reach){close(dist(c.reach.base,c.reach.knee),34*c.scale);close(dist(c.reach.knee,c.reach.tip),34*c.scale);}
   }
  }
  assert.ok(actions>40,actions);assert.ok(steps>500,steps);
 }
});

test('seeded traversal is reproducible; reduced motion keeps control operations functional',()=>{
 const a=new CrawlWorld(0),b=new CrawlWorld(0);a.resize(1000,620);b.resize(1000,620);let events=0;
 for(let frame=0;frame<1200;frame++){
  const ea=a.update(1/60,{population:5,reducedMotion:false}),eb=b.update(1/60,{population:5,reducedMotion:true});assert.deepEqual(ea,eb);events+=ea.length;
  assert.deepEqual(a.getData().controls,b.getData().controls);
  for(const c of b.creatures){assert.ok(c.legs.every(l=>l.lift===0));assert.equal(c.bodySway,0);assert.equal(c.breathe,0);}
 }
 assert.ok(events>8,events);assert.equal(a.seed,0);
});

test('all five species operate controls, with distinct gaits and optional bursts and pauses',()=>{
 const runs=[];
 for(const energy of[0,1]){
  const world=new CrawlWorld(417);world.resize(844,327);const stats=Object.fromEntries(CRAWL_SPECIES.map(kind=>[kind,{actions:0,pauses:0,maxSpeed:0}]));
  for(let frame=0;frame<3600;frame++){
   const events=world.update(1/60,{population:5,motionEnergy:energy});
   for(const event of events){
    const c=world.creatures.find(c=>c.id===event.creatureId),q=world.controls.find(q=>q.id===event.controlId);
    assert.equal(c.state,'operate');assert.ok(c.reach.contact);close(dist(c.reach.tip,crawlActuatorPoint(q,world.panel.unit,world.time)),0);stats[c.kind].actions++;
   }
   for(const c of world.creatures){const s=stats[c.kind];s.maxSpeed=Math.max(s.maxSpeed,c.velocity/c.scale);if(c.gaitPhase==='pause'&&['wander','approach'].includes(c.state)){s.pauses++;assert.equal(c.velocity,0);}}
  }
  assert.deepEqual(world.creatures.map(c=>c.kind),CRAWL_SPECIES);assert.deepEqual(world.creatures.map(c=>c.legs.length),[22,8,6,4,8]);assert.deepEqual(world.creatures.map(c=>c.claws.length),[0,0,0,2,2]);assert.equal(world.creatures[4].tail.length,8);
  for(const s of Object.values(stats)){assert.ok(s.actions>8,'every species must reach and operate controls');if(energy===0)assert.equal(s.pauses,0);else assert.ok(s.pauses>0,'lively travel includes pauses');}
  assert.ok(stats.spider.maxSpeed>stats.beetle.maxSpeed*1.4);runs.push(stats);
 }
 for(const kind of CRAWL_SPECIES)assert.ok(runs[1][kind].maxSpeed>runs[0][kind].maxSpeed*1.1,'motion energy increases the '+kind+' burst speed');
});

test('all species retain bounded limbs at low frame rates and maximum movement energy',()=>{
 for(const [w,h]of [[844,327],[390,740],[1280,820],[240,180]]){
  const world=new CrawlWorld(999);world.resize(w,h);world.update(0,{population:5});
  for(let frame=0;frame<1200;frame++){
   if(frame%300===0)world.setGuide(1,frame%600?20:w-20,frame%900?60:h-20);
   for(const c of world.creatures)c.audio=fullAudio();
   world.update(.05,{population:5,speed:1,motionEnergy:1,audioMotion:1,activity:1});
   for(const c of world.creatures){
    checkAppendages(c,w,h);
    for(const leg of c.legs){close(dist(leg.hip,leg.knee),leg.upper);close(dist(leg.knee,leg.foot),leg.lower);for(const p of[leg.hip,leg.knee,leg.foot])assert.ok(p.x>=0&&p.x<=w&&p.y>=0&&p.y<=h);}
   }
  }
 }
});

test('measured audio articulates appendages without changing stance, contact, or musical choices',()=>{
 const worlds=Array.from({length:5},()=>{const w=new CrawlWorld(417);w.resize(844,327);w.update(0,{population:5});return w;});
 const [silent,reactive,disabled,silentReduced,reactiveReduced]=worlds,peakResponse=new Map(CRAWL_SPECIES.map(kind=>[kind,0]));let contacts=0;
 const pose=c=>({feelers:c.feelers,claws:c.claws,tail:c.tail,bodySway:c.bodySway,breathe:c.breathe});
 for(let frame=0;frame<1200;frame++){
  for(const world of[reactive,disabled,reactiveReduced])for(const c of world.creatures)c.audio={level:.8,bass:(Math.sin(frame*.12)+1)/2,mid:.7,treble:(Math.cos(frame*.16)+1)/2,attack:frame%24<6?1:0,segments:Array(13).fill(.9)};
  const results=worlds.map((world,index)=>world.update(1/60,{population:5,speed:1,motionEnergy:1,audioMotion:index===2?0:1,reducedMotion:index>=3}));
  for(const events of results)assert.deepEqual(events,results[0]);contacts+=results[0].length;
  for(const world of worlds)assert.deepEqual(world.getData(),silent.getData());
  for(let index=0;index<5;index++){
   const base=silent.creatures[index],active=reactive.creatures[index];
   assert.deepEqual(active.segments,base.segments);assert.deepEqual(active.legs,base.legs);assert.deepEqual(active.reach,base.reach);
   assert.deepEqual(pose(disabled.creatures[index]),pose(base));assert.deepEqual(pose(reactiveReduced.creatures[index]),pose(silentReduced.creatures[index]));
   checkAppendages(active,844,327);
   const difference=Math.max(...active.feelers.map((feeler,i)=>dist(feeler.tip,base.feelers[i].tip)),...active.claws.map((claw,i)=>dist(claw.tip,base.claws[i].tip)),...active.tail.map((p,i)=>dist(p,base.tail[i])))/active.scale;
   peakResponse.set(active.kind,Math.max(peakResponse.get(active.kind),difference));
  }
 }
 assert.ok(contacts>20);
 for(const [kind,difference]of peakResponse)assert.ok(difference>3,kind+' should visibly articulate from measured audio');
 assert.ok(reactive.getData().creatures.every(c=>!('audio'in c)),'audio envelopes must not enter exported presets');
 // Muting actual output returns the same appendage pose as the silent world.
 for(const c of reactive.creatures)c.audio={level:0,bass:0,mid:0,treble:0,attack:0,segments:[]};
 reactive.update(0);silent.update(0);for(let index=0;index<5;index++)assert.deepEqual(pose(reactive.creatures[index]),pose(silent.creatures[index]));
});

test('resize, restore, and population changes preserve values without orphaning guidance or contact',()=>{
 const world=new CrawlWorld(18);world.resize(1280,820);for(let i=0;i<800;i++)world.update(1/60,{population:5});
 world.setGuide('a',world.creatures[4].x,world.creatures[4].y);world.releaseGuide('a',true);world.mode='guide';
 const saved=JSON.parse(JSON.stringify(world.getData())),restored=new CrawlWorld();restored.resize(390,740);restored.setData(saved);
 assert.deepEqual(restored.getData().controls,saved.controls);assert.equal(restored.creatures.length,5);assert.equal(restored.mode,'guide');assert.equal(restored.getData().randomState,saved.randomState);
 assert.equal(restored.guides.size,1);restored.resize(844,327);assert.deepEqual(restored.getData().controls,saved.controls);assert.ok(restored.controls.every(c=>c.activeBy===null));
 const removed=new Set(restored.creatures.slice(1).map(c=>c.id));restored.update(1/60,{population:1});assert.equal(restored.creatures.length,1);assert.ok([...restored.guides.values()].every(g=>!removed.has(g.creatureId)));assert.ok(restored.controls.every(c=>!removed.has(c.activeBy)));
 restored.setData({controls:{'v0-tone':Infinity,'v0-decay':-100,'step-00':2},creatures:[{id:'crawl-0',x:NaN,y:Infinity}]});assert.equal(restored.controls.find(q=>q.id==='v0-decay').value,0);assert.equal(restored.controls.find(q=>q.id==='step-00').value,1);assert.ok(restored.controls.every(q=>Number.isFinite(q.value)));
});

test('edge saves and responsive resets reconstruct bounded bodies before their first update',()=>{
 const viewports=[[1280,820],[844,327],[390,740],[1366,960],[240,180]],positions=[[.04,.1],[.96,.1],[.04,.95],[.96,.95],[.5,.5]];
 // These two real saves previously projected the centipede tail up to 73px
 // outside the display even though the live, curved body remained inside it.
 const repros=[{x:.8827939976070569,y:.1727535851868305,angle:-3.2576251608912408},{x:.848986818447884,y:.15299480322956396,angle:-9.771823324938795}];
 const assertReset=world=>{
  const {w,h}=world.panel;
  const inside=p=>assert.ok(Number.isFinite(p.x+p.y)&&p.x>=0&&p.x<=w&&p.y>=0&&p.y<=h,`reset point ${p.x},${p.y} escaped ${w}×${h}`);
  for(const c of world.creatures){
   checkAppendages(c,w,h);
   inside(c);assert.equal(c.reach,null);assert.equal(c.state,'wander');
   for(const [index,s]of c.segments.entries()){inside(s);if(index)close(dist(s,c.segments[index-1]),crawlAnatomy(c.kind).gap*c.scale);}
   for(const leg of c.legs){for(const p of[leg.hip,leg.knee,leg.foot])inside(p);close(dist(leg.hip,leg.knee),leg.upper);close(dist(leg.knee,leg.foot),leg.lower);}
   for(const feeler of c.feelers)for(const p of[feeler.base,feeler.knee,feeler.tip])inside(p);
  }
 };
 for(let heading=0;heading<10;heading++)for(const [w,h]of viewports){
  const world=new CrawlWorld(417);world.resize(w,h);world.update(0,{population:5,audioMotion:1});for(const c of world.creatures)c.audio=fullAudio();
  const data={randomState:892317,controls:{'v0-tone':.73,'step-02':0},creatures:positions.map(([x,y],index)=>({id:'crawl-'+index,x,y,angle:heading*Math.PI/4}))};
  if(heading>=8)Object.assign(data.creatures[0],repros[heading-8]);
  world.setData(data);const values=world.getData().controls;assertReset(world);assert.equal(world.getData().randomState,data.randomState);
  const planted=world.creatures.map(c=>c.legs.map(l=>({...l.foot,planted:l.planted})));
  world.update(0,{population:5});assertReset(world);
  for(const [ci,c]of world.creatures.entries())for(const [li,leg]of c.legs.entries())if(planted[ci][li].planted&&leg.planted)close(dist(planted[ci][li],leg.foot),0);
  for(const [nextW,nextH]of viewports){world.resize(nextW,nextH);assertReset(world);assert.deepEqual(world.getData().controls,values);}
 }
});
