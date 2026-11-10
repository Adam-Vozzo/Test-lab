import test from 'node:test';
import assert from 'node:assert/strict';
import {FOURTH_RELEASE_SOUND,FOURTH_RELEASE_APPEARANCE,FIRST_RELEASE_APPEARANCE,THIRD_RELEASE_APPEARANCE,THIRD_RELEASE_SOUND,SECOND_RELEASE_APPEARANCE,APPEARANCE_REVISION,migrateAppearance,FIRST_RELEASE_SOUND,SECOND_RELEASE_SOUND,SOUND_REVISION,migrateSound,preserveStudySessions} from '../instruments/appearance-migration.js';

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

test('v20 defaults update for the phone revision while edits and other instruments stay intact',()=>{
 for(const [id,appearance]of Object.entries(THIRD_RELEASE_APPEARANCE)){
  const revised={sceneGrain:.1,newMaterial:.8};assert.deepEqual(migrateAppearance(id,{appearanceRevision:3,appearance},revised),revised);
  const custom={...appearance,sceneGrain:.27};assert.deepEqual(migrateAppearance(id,{appearanceRevision:3,appearance:custom},revised),custom);
 }
 const old=THIRD_RELEASE_SOUND.carrier,revised={...old,index:.55};assert.deepEqual(migrateSound('carrier',{soundRevision:3,sound:old},revised),revised);
 const custom={...old,cutoff:2340};assert.deepEqual(migrateSound('carrier',{soundRevision:3,sound:custom},revised),custom);
});


test('Roses revision5 upgrades only its untouched fourth-release appearance and preserves camera/sound',()=>{
 const old={sceneBlur:0,sceneGrain:0,sceneGrainSize:1,petalColour:'#d82c75',leafColour:'#82aa8e',petalWidth:1,petalCurl:.7,petalLayers:4,bloomScale:1,bouquetSpread:1,leafSize:1,glyphStyle:'ascii',glyphDensity:1,glyphSize:1,exposure:1,wireContrast:.55,lineWeight:1,glow:.54,glowRadius:.55,sceneScale:1.1,revealDuration:10.5,idleMotion:.5,motionRate:1,response:.85,spray:.7,readoutContrast:.88,readoutSize:1.15};
 assert.deepEqual(FOURTH_RELEASE_APPEARANCE,{roses:old},'the migration snapshot remains independent of current defaults');
 const revised={...old,petalWidth:1.25,petalCurl:.55,petalLayers:5,bloomScale:1.1,bouquetSpread:1.05,leafSize:.9,glyphDensity:1.4,glyphSize:1.45,exposure:1.1,wireContrast:.4,lineWeight:.5,glow:.85,glowRadius:.6,sceneScale:1.15,revealDuration:6,idleMotion:1.5,motionRate:.8,response:.2,spray:1,readoutSize:1,saturation:1.3,highlightGain:1.25,idleRotation:.035};
 const saved={appearanceRevision:4,appearance:{...old},sound:{cutoff:4210},data:{camera:{yaw:.9,pitch:6.3,zoom:1.4,offsetX:.1,offsetY:-.03}},bpm:117},copy=structuredClone(saved);
 assert.deepEqual(migrateAppearance('roses',saved,revised),revised);
 assert.deepEqual(saved,copy,'appearance upgrade must not mutate camera, sound, tempo or input');
 for(const appearance of [{...old,petalWidth:1.25},{...old,glow:.84},{...old,saturation:1.3},Object.fromEntries(Object.entries(old).filter(([key])=>key!=='glow'))]){
  assert.deepEqual(migrateAppearance('roses',{appearanceRevision:4,appearance},revised),appearance,'even a single designer edit stays intact');
 }
 assert.deepEqual(migrateAppearance('roses',{appearanceRevision:5,appearance:{...old}},revised),old);
 assert.deepEqual(migrateAppearance('cellular',{appearanceRevision:4,appearance:{...old}},revised),old,'other instruments are not swept into the Roses migration');
});

test('Crawl adds the full colony only to untouched sound defaults, preserving customized sessions',()=>{
 const old=FOURTH_RELEASE_SOUND.crawl,next={...old,population:5,motionEnergy:.65};
 const saved={soundRevision:4,sound:{...old},appearance:{creatureLime:'#cf4488'},data:{controls:{'v0-tone':.81},guides:[{creatureId:'crawl-0',x:.3,y:.8}]}};
 const original=structuredClone(saved);
 assert.deepEqual(migrateSound('crawl',saved,next),next);
 assert.deepEqual(saved,original,'the migration does not mutate the patch, palette or guides');
 for(const sound of [{...old,population:2},{...old,echo:.11},{...old,motionEnergy:.25}])assert.deepEqual(migrateSound('crawl',{soundRevision:4,sound},next),sound);
 assert.deepEqual(migrateSound('crawl',{soundRevision:5,sound:old},next),old);
 assert.deepEqual(migrateSound('roses',{soundRevision:4,sound:old},next),old);
});
