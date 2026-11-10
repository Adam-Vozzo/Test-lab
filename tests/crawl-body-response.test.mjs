import test from 'node:test';
import assert from 'node:assert/strict';
import {CrawlWorld} from '../instruments/crawl-world.js';
import {crawlReactivePose} from '../instruments/crawl-renderer.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
test('reactive bodies visibly articulate while feet, contacts and simulation stay authoritative',()=>{
 const world=new CrawlWorld(417);world.resize(844,327);world.update(0,{population:5});let peak=0;
 for(let frame=0;frame<600;frame++){
  world.update(1/60,{population:5,speed:1,activity:1});
  for(const c of world.creatures){
   c.audio={level:.5,mid:.3,segments:c.segments.map(()=>.5)};
   const before=structuredClone(c),pose=crawlReactivePose(c,1,world.time);
   assert.deepEqual(c,before);assert.deepEqual(pose.reach,c.reach);assert.deepEqual(pose.segments[0],c.segments[0]);
   for(const [i,l]of pose.legs.entries()){
    assert.deepEqual(l.foot,c.legs[i].foot);
    assert.ok(Math.abs(distance(l.hip,l.knee)-l.upper)<.001);
    assert.ok(Math.abs(distance(l.knee,l.foot)-l.lower)<.001);
   }
   peak=Math.max(peak,...pose.segments.map((p,i)=>distance(p,c.segments[i])/c.scale));
   assert.equal(crawlReactivePose(c,0,world.time),c);assert.equal(crawlReactivePose(c,1,world.time,true),c);
   c.audio.level=0;assert.equal(crawlReactivePose(c,1,world.time),c);
  }
 }
 assert.ok(peak>6,'ordinary measured output should visibly bend the body at maximum movement');
});
