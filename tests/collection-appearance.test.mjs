import test from 'node:test';
import assert from 'node:assert/strict';
import {FIRST_RELEASE_APPEARANCE,APPEARANCE_REVISION,migrateAppearance,FIRST_RELEASE_SOUND,SOUND_REVISION,migrateSound} from '../instruments/appearance-migration.js';

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
