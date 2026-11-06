import test from 'node:test';
import assert from 'node:assert/strict';
import {definition,MILKDROP_PRESETS,milkdropTouch,milkdropParams,milkdropMorph,milkdropPresetIndex,milkdropSequence} from '../instruments/milkdrop.js';

test('touch pitch spans two scale octaves while vertical expression changes timbre independently',()=>{
  for(let degree=0;degree<=14;degree++)assert.equal(milkdropTouch(degree/14,.5).degree,degree);
  const left=milkdropTouch(0,.5),right=milkdropTouch(1,.5),low=milkdropTouch(.5,1),high=milkdropTouch(.5,0);
  assert.equal(left.cutoff,right.cutoff);assert.equal(low.degree,high.degree);assert.ok(high.cutoff>low.cutoff*4);assert.ok(high.tablePosition>low.tablePosition);assert.ok(left.pan<0&&right.pan>0);
  const disabled={...definition.defaultSound,expression:0};assert.equal(milkdropTouch(.3,0,disabled).cutoff,milkdropTouch(.3,1,disabled).cutoff);
  assert.equal(milkdropTouch(.3,0,disabled).tablePosition,milkdropTouch(.3,1,disabled).tablePosition);
});

test('all five scale selections span exactly two octaves with ascending notes and a stable midpoint',()=>{
  const scales={dorian:[0,2,3,5,7,9,10],minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],pentatonic:[0,3,5,7,10],chromatic:[0,1,2,3,4,5,6,7,8,9,10,11]};
  for(const[scale,intervals]of Object.entries(scales)){
    const pitch=x=>{const degree=milkdropTouch(x,.5,definition.defaultSound,scale).degree;return 50+intervals[degree%intervals.length]+12*Math.floor(degree/intervals.length);};
    assert.equal(pitch(0),50,scale);assert.equal(pitch(.5),62,scale);assert.equal(pitch(1),74,scale);
    assert.equal(pitch(-1),50,scale);assert.equal(pitch(2),74,scale);
    let previous=50;const heard=new Set();for(let sample=0;sample<=240;sample++){const midi=pitch(sample/240);assert.ok(midi>=previous&&midi<=74,`${scale}: monotonic pitch`);assert.ok(intervals.includes((midi-50)%12),`${scale}: selected pitch classes`);previous=midi;heard.add(midi);}
    assert.equal(heard.size,intervals.length*2+1,`${scale}: every note reachable`);
  }
});

test('off-stage touch and extreme sound settings remain bounded without silencing the source',()=>{
  for(const x of[-20,0,.5,1,100,NaN])for(const y of[-20,0,.5,1,100,NaN])for(const cutoff of[120,6800,18000]){
    const mapped=milkdropTouch(x,y,{...definition.defaultSound,cutoff,expression:1});
    assert.ok(mapped.degree>=0&&mapped.degree<=14);assert.ok(mapped.cutoff>=120&&mapped.cutoff<=18000);assert.ok(mapped.tablePosition>=0&&mapped.tablePosition<=1);assert.ok(Math.abs(mapped.pan)<=.275);assert.ok(mapped.velocity>0&&mapped.velocity<=1);
  }
});

test('effect bank covers eight geometries with different spatial settings rather than recolours',()=>{
  assert.ok(MILKDROP_PRESETS.length>=16);assert.equal(new Set(MILKDROP_PRESETS.map(p=>p.id)).size,MILKDROP_PRESETS.length);
  const families=new Map();for(const preset of MILKDROP_PRESETS){const p=milkdropParams(preset.appearance);if(!families.has(p.family))families.set(p.family,[]);families.get(p.family).push(p);assert.equal(MILKDROP_PRESETS[milkdropPresetIndex(preset.appearance)].id,preset.id);}
  assert.equal(families.size,8);
  for(const variants of families.values()){
    assert.ok(variants.length>=2);
    assert.ok(['warp','scale','detail','lineWidth','zoom','rotation','mirror'].filter(key=>Math.abs(variants[0][key]-variants[1][key])>.05).length>=3);
  }
  assert.equal(milkdropPresetIndex({...MILKDROP_PRESETS[0].appearance,autoCycle:true,touchResponse:.2}),0);
  assert.equal(milkdropPresetIndex({...MILKDROP_PRESETS[0].appearance,warp:0}),-1);
});

test('preset values fit their published controls, including native string selections',()=>{
  for(const preset of MILKDROP_PRESETS)for(const control of definition.appearanceControls){
    const value=preset.appearance[control.key]??definition.defaultAppearance[control.key];
    if(control.kind==='select')assert.ok(control.options.some(([option])=>option===value),`${preset.id}: ${control.key}`);
    else if(control.kind==='toggle')assert.equal(typeof value,'boolean');
    else assert.ok(Number.isFinite(value)&&value>=control.min&&value<=control.max,`${preset.id}: ${control.key}`);
  }
  for(const controls of[definition.soundControls,definition.appearanceControls])assert.equal(new Set(controls.map(c=>c.key)).size,controls.length);
});

test('morph crosses hue wrap by the shortest route and exposes both source geometries',()=>{
  const from=milkdropParams({...MILKDROP_PRESETS[0].appearance,hue:.98}),to=milkdropParams({...MILKDROP_PRESETS[5].appearance,hue:.02});
  const first=milkdropMorph(from,to,0),middle=milkdropMorph(from,to,.5),last=milkdropMorph(from,to,1);
  assert.equal(first.familyFrom,from.family);assert.equal(first.familyMix,0);assert.equal(last.family,to.family);assert.equal(last.familyMix,1);
  assert.equal(first.paletteFrom,from.palette);assert.equal(last.paletteMix,1);assert.ok(middle.hue<.001||middle.hue>.999);
  assert.equal(first.warp,from.warp);assert.equal(last.warp,to.warp);assert.ok(Math.abs(middle.scale-(from.scale+to.scale)/2)<1e-12);
  for(let p=0;p<=1;p+=.01)for(const value of Object.values(milkdropMorph(from,to,p)))assert.ok(Number.isFinite(value));
});

test('three sequence modes differ rhythmically while staying within bounded chord density and pitch',()=>{
  const counts={};for(const mode of['drift','pulse','chords']){
    counts[mode]=0;for(let step=0;step<16;step++){
      const notes=milkdropSequence(step,mode);counts[mode]+=notes.length;assert.ok(notes.length<=3);
      for(const n of notes){assert.ok(n.degree>=0&&n.degree<=10);assert.ok(n.octave>=-1&&n.octave<=0);assert.ok(n.gain>0&&n.gain<=.55);}
    }
  }
  assert.deepEqual(counts,{drift:10,pulse:16,chords:12});assert.equal(milkdropSequence(1,'chords').length,0);assert.equal(milkdropSequence(4,'chords').length,3);
  assert.deepEqual(milkdropSequence(0),milkdropSequence(16));
});
