import test from 'node:test';
import assert from 'node:assert/strict';
import {FIRST_RELEASE_APPEARANCE,SECOND_RELEASE_APPEARANCE,APPEARANCE_REVISION,migrateAppearance,FIRST_RELEASE_SOUND,SECOND_RELEASE_SOUND,SOUND_REVISION,migrateSound,preserveStudySessions} from '../instruments/appearance-migration.js';

test('untouched first-release looks adopt the revised reference defaults across all instruments',()=>{
  for(const [id,old] of Object.entries(FIRST_RELEASE_APPEARANCE)){
    const saved={appearance:{...old},sound:{cutoff:3210},data:{pattern:[2,5,1]}};
    const revised={...old,newVisualParameter:.7};
    const numeric=Object.keys(old).find(key=>typeof old[key]==='number');revised[numeric]=old[numeric]+.25;
    assert.deepEqual(migrateAppearance(id,saved,revised),revised,id);
    assert.deepEqual(saved.appearance,old,'migration never mutates persisted data');
    assert.deepEqual(saved.sound,{cutoff:3210});assert.deepEqual(saved.data,{pattern:[2,5,1]});
  }
});

test('a single user adjustment, unknown key or newer revision prevents automatic replacement',()=>{
  const old=FIRST_RELEASE_APPEARANCE.cellular,next={...old,bodyRadius:82};
  for(const appearance of [{...old,cellSize:1.3},{...old,customGeometry:true}])assert.deepEqual(migrateAppearance('cellular',{appearance},next),appearance);
  assert.deepEqual(migrateAppearance('cellular',{appearance:{...old},appearanceRevision:APPEARANCE_REVISION},next),old);
});

test('missing or malformed saved looks remain available to the host sanitizer',()=>{
  for(const appearance of [undefined,null,[],false,'invalid'])assert.equal(migrateAppearance('carrier',{appearance},{}),appearance);
  assert.equal(migrateAppearance('unknown',{appearance:{a:1}},{}).a,1);
});

test('the reference waveform upgrades only when the whole old sound preset is untouched',()=>{
  const old=FIRST_RELEASE_SOUND.graticule,next={...old,waveform:'sawtooth'};
  assert.deepEqual(migrateSound('graticule',{sound:{...old}},next),next);
  const edited={...old,index:2.4};assert.deepEqual(migrateSound('graticule',{sound:edited},next),edited);
  assert.deepEqual(migrateSound('graticule',{sound:{...old},soundRevision:SOUND_REVISION},next),old);
  assert.equal(migrateSound('graticule',{},next),undefined);
});

test('second-release defaults upgrade to the behavior revision without erasing designer edits',()=>{
 for(const [id,old]of Object.entries(SECOND_RELEASE_APPEARANCE)){
  const next={newParameter:.5,leftWidth:50};assert.deepEqual(migrateAppearance(id,{appearanceRevision:2,appearance:{...old}},next),next);
  const custom={...old,customParameter:1};assert.deepEqual(migrateAppearance(id,{appearanceRevision:2,appearance:custom},next),custom);
 }
 const old=SECOND_RELEASE_SOUND.geo,next={...old,waveform:'wavetable',tablePosition:.5};
 assert.deepEqual(migrateSound('geo',{soundRevision:2,sound:{...old}},next),next);
 const custom={...old,cutoff:1234};assert.deepEqual(migrateSound('geo',{soundRevision:2,sound:custom},next),custom);
});

test('replaced studies retain legacy sound, appearance, camera and looks without overwriting either session',()=>{
 const legacy={instrument:'geo',appearanceRevision:2,soundRevision:2,sound:{cutoff:1234},appearance:{terrainHeight:.8},data:{yaw:2.5,zoom:4.8}},phase={instrument:'graticule',appearanceRevision:2,appearance:{phaseAngle:.8}},looks=[{name:'My terrain',appearance:{terrainHeight:.6}}];
 const values=new Map([['duo.instrument.geo.v1',JSON.stringify(legacy)],['duo.instrument.graticule.v1',JSON.stringify(phase)],['duo.instrument.geo.looks.v1',JSON.stringify(looks)]]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 preserveStudySessions(storage);
 assert.deepEqual(JSON.parse(values.get('duo.instrument.terrain.v1')),{...legacy,instrument:'terrain'});assert.deepEqual(JSON.parse(values.get('duo.instrument.phase-volume.v1')),{...phase,instrument:'phase-volume'});assert.deepEqual(JSON.parse(values.get('duo.instrument.geo.v1')),legacy);assert.deepEqual(JSON.parse(values.get('duo.instrument.terrain.looks.v1')),looks);
 values.set('duo.instrument.terrain.v1','{"instrument":"terrain","bpm":99}');values.delete('duo.instrument.terrain.looks.v1');preserveStudySessions(storage);assert.equal(JSON.parse(values.get('duo.instrument.terrain.v1')).bpm,99);assert.deepEqual(JSON.parse(values.get('duo.instrument.terrain.looks.v1')),looks);values.set('duo.instrument.terrain.looks.v1','[]');preserveStudySessions(storage);assert.equal(values.get('duo.instrument.terrain.looks.v1'),'[]');
 values.clear();values.set('duo.instrument.geo.v1',JSON.stringify({...legacy,soundRevision:3}));preserveStudySessions(storage);assert.equal(values.has('duo.instrument.terrain.v1'),false);
 values.set('duo.instrument.geo.v1','invalid');assert.doesNotThrow(()=>preserveStudySessions(storage));assert.doesNotThrow(()=>preserveStudySessions({getItem(){throw new Error('denied')}}));
});
