import test from 'node:test';
import assert from 'node:assert/strict';
import {CrawlAudioResponse} from '../instruments/crawl-audio.js';

const tone=(hz=120,rms=.06,sampleRate=48000)=>{const frequency=new Float32Array(256);frequency[Math.max(1,Math.round(hz/(sampleRate/512)))]=.86;return{rms,frequency};};
const advance=(response,snapshot,seconds=1,fps=60,options={})=>{for(let i=0;i<Math.round(seconds*fps);i++)response.update(snapshot,1/fps,options);return response.envelope;};
const creatures=()=>['centipede','spider','beetle','mantis','scorpion'].map(kind=>({kind,segments:Array.from({length:kind==='centipede'?13:4},()=>({}))}));

test('measured output is required even if note and transport metadata claim activity',()=>{
 const response=new CrawlAudioResponse(),silent={...tone(),rms:0,playing:true,step:8,voices:[{level:1,midi:80}]};
 advance(response,silent,2);assert.deepEqual(response.envelope,{level:0,bass:0,mid:0,treble:0,attack:0});
 advance(response,tone(),.5);assert.ok(response.envelope.level>.4);
 advance(response,silent,3);for(const value of Object.values(response.envelope))assert.equal(value,0,'stale spectrum must not sustain response');
 const bodies=creatures();response.assign(bodies);assert.ok(bodies.every(c=>Object.values(c.audio).flat().every(v=>v===0)));
});

test('FFT bands follow physical frequency across sample rates and scale with output level',()=>{
 for(const sampleRate of[44100,48000,96000])for(const[hz,key]of[[120,'bass'],[1000,'mid'],[6000,'treble']]){
  const response=new CrawlAudioResponse();advance(response,tone(hz,.06,sampleRate),1,60,{sampleRate});
  assert.ok(response.envelope[key]>.4,`${hz}Hz ${sampleRate}Hz`);
  for(const other of['bass','mid','treble'])if(other!==key)assert.equal(response.envelope[other],0);
 }
 const quiet=new CrawlAudioResponse(),loud=new CrawlAudioResponse();advance(quiet,tone(120,.012));advance(loud,tone(120,.08));
 assert.ok(loud.envelope.level>quiet.envelope.level*2);
});

test('species respond differently to bass and high frequencies without changing their source data',()=>{
 const response=new CrawlAudioResponse(),bodies=creatures();advance(response,tone(120));response.assign(bodies);
 assert.ok(bodies[2].audio.level>bodies[1].audio.level*1.5,'beetle favours bass over spider');
 response.reset();advance(response,tone(6000));response.assign(bodies);
 assert.ok(bodies[1].audio.level>bodies[2].audio.level*1.5,'spider favours highs over beetle');
 assert.deepEqual(bodies.map(c=>({kind:c.kind,segments:c.segments})),creatures());
});

test('note attacks settle on sustained sound and travel through segment delays',()=>{
 const response=new CrawlAudioResponse(),body=creatures()[0],snapshot=tone();
 advance(response,snapshot,.05);response.assign([body]);
 assert.ok(response.envelope.attack>.1);assert.ok(body.audio.segments[0]>0);assert.equal(body.audio.segments.at(-1),0);
 advance(response,snapshot,.4);response.assign([body]);assert.ok(body.audio.segments.at(-1)>.2);
 advance(response,snapshot,2);assert.ok(response.envelope.attack<.001,'a sustained tone must not make endless fake beats');
});

test('envelope timing is stable across rendering rates and visual sensitivity does not mutate audio',()=>{
 const snapshot=tone(1000),copy=snapshot.frequency.slice(),results=[];
 for(const fps of[30,60,120]){const response=new CrawlAudioResponse();advance(response,snapshot,.5,fps);advance(response,{rms:0},.3,fps);results.push(response.envelope);}
 for(const result of results)for(const key of['level','mid'])assert.ok(Math.abs(result[key]-results[1][key])<.003,key);
 const low=new CrawlAudioResponse(),high=new CrawlAudioResponse();advance(low,snapshot,1,60,{sensitivity:.25});advance(high,snapshot,1,60,{sensitivity:3});
 assert.ok(high.envelope.level>low.envelope.level*2);assert.deepEqual(snapshot.frequency,copy);assert.equal(snapshot.rms,.06);
});

test('invalid samples, bounded history and reset cannot leave stale reactions',()=>{
 const response=new CrawlAudioResponse();response.update({rms:Infinity,frequency:[NaN,Infinity]},NaN);assert.equal(response.envelope.level,0);
 for(let i=0;i<2000;i++)response.update(tone(),.001,{sensitivity:Infinity,sampleRate:NaN});
 assert.ok(response.history.length<=180);for(const value of Object.values(response.envelope))assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
 response.reset();const bodies=creatures();response.assign(bodies);assert.equal(response.history.length,0);assert.ok(bodies.every(c=>Object.values(c.audio).flat().every(v=>v===0)));
});
