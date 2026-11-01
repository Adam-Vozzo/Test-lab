import test from 'node:test';
import assert from 'node:assert/strict';
import {definition as censusDefinition,mount as censusMount} from '../instruments/census.js';
import {definition as waveformDefinition,mount as waveformMount} from '../instruments/waveform.js';
import {definition as geoDefinition,mount as geoMount} from '../instruments/geo.js';

// Small DOM fixture for gesture ownership and saved musical data. Visual quality
// and actual WebGL output are checked separately in the browser.
function fixture(definition,mount){
 const previous={document:globalThis.document,window:globalThis.window,devicePixelRatio:globalThis.devicePixelRatio};
 const viewport={width:1180,height:760};
 const context=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(target,key)=>key in target?target[key]:()=>{}});
 class Element{
  constructor(tag){this.tag=tag;this.style={};this.children=[];this.listeners=new Map();this.capture=new Set();this.width=1;this.height=1;}
  append(el){this.children.push(el);el.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(el=>el!==this);}
  setAttribute(){}focus(){}getBoundingClientRect(){return{left:0,top:0,...viewport};}
  getContext(type){return type==='2d'?context:null;}
  addEventListener(type,fn,options={}){const items=this.listeners.get(type)||[];items.push(fn);this.listeners.set(type,items);options.signal?.addEventListener('abort',()=>{this.listeners.set(type,items.filter(item=>item!==fn));},{once:true});}
  setPointerCapture(id){this.capture.add(id);}hasPointerCapture(id){return this.capture.has(id);}releasePointerCapture(id){this.capture.delete(id);}
  emit(type,x,y,id=1){const event={pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y,pressure:.5,preventDefault(){}};for(const fn of this.listeners.get(type)||[])fn(event);}
 }
 globalThis.document={createElement:tag=>new Element(tag),createElementNS(){throw new Error('No GPU in the gesture fixture');}};
 globalThis.window={devicePixelRatio:1};globalThis.devicePixelRatio=1;
 const calls={on:[],update:[],off:[],pulse:[],save:0,sound:[]},state={bpm:112,root:50,scale:'dorian',playing:false,hold:false,arp:false,sound:{...definition.defaultSound},appearance:{...definition.defaultAppearance}};
 const api={state,quantize:n=>50+n,noteName:n=>String(n),save(){calls.save++;},setStatus(){},toast(){},setSound(patch){Object.assign(state.sound,patch);calls.sound.push(patch);},noteOn:(...args)=>calls.on.push(args),noteUpdate:(...args)=>calls.update.push(args),noteOff:(...args)=>calls.off.push(args),audio:{pulse:(...args)=>calls.pulse.push(args),snapshot:()=>({time:0,rms:0,step:0,waveform:[],frequency:[],voices:[]})}};
 const host=new Element('div'),controller=mount(host,api),canvas=host.children.find(el=>el.tag==='canvas');
 return{controller,canvas,state,calls,resize(width,height){Object.assign(viewport,{width,height});controller.frame(0,.016);},destroy(){controller.destroy();Object.assign(globalThis,previous);}};
}

test('Census timbre pane dragging owns its pointer and never plays or edits a route',()=>{
 const f=fixture(censusDefinition,censusMount);try{const before=f.controller.getData();f.canvas.emit('pointerdown',694,283);f.canvas.emit('pointermove',774,313);f.canvas.emit('pointerup',774,313);const after=f.controller.getData();assert.deepEqual(f.calls.on,[]);assert.deepEqual(after.route,before.route);assert.notDeepEqual(after.panes,before.panes);assert.equal(f.calls.save,1);}finally{f.destroy();}
});

test('Census cancelled contacts release their own voice without editing the sequence',()=>{
 const f=fixture(censusDefinition,censusMount);try{const before=f.controller.getData();f.canvas.emit('pointerdown',80,180,2);f.canvas.emit('pointerdown',260,260,3);f.canvas.emit('pointercancel',80,180,2);assert.equal(f.calls.on.length,2);assert.deepEqual(f.calls.off,[['census-2']]);assert.deepEqual(f.controller.getData().route,before.route);f.canvas.emit('pointerup',260,260,3);assert.equal(f.controller.getData().editStep,1);assert.deepEqual(f.calls.off,[['census-2'],['census-3']]);}finally{f.destroy();}
});

test('Census sanitizes saved route/panes and schedules notes at the supplied audio time',()=>{
 const f=fixture(censusDefinition,censusMount);try{f.controller.setData({route:Array.from({length:16},()=>({u:99,v:-20})),panes:[{u:-7,v:14}],editStep:99});const saved=f.controller.getData();assert.equal(saved.route[0].u,.98);assert.equal(saved.route[0].v,.02);assert.equal(saved.panes[0].u,.05);assert.equal(saved.panes[0].v,.94);assert.equal(saved.editStep,15);f.controller.onStep(3,12.75);assert.equal(f.calls.pulse[0][3],12.75);assert.ok(f.calls.pulse[0][4]>0);}finally{f.destroy();}
});

test('Waveform card dragging edits pitch while tapping toggles its gate',()=>{
 const f=fixture(waveformDefinition,waveformMount);try{const index=1,before=f.controller.getData().steps[index];f.canvas.emit('pointerdown',115,680);f.canvas.emit('pointermove',115,610);f.canvas.emit('pointerup',115,610);const dragged=f.controller.getData().steps[index];assert.ok(dragged.note>before.note);assert.equal(dragged.active,true);f.canvas.emit('pointerdown',115,680);f.canvas.emit('pointerup',115,680);assert.equal(f.controller.getData().steps[index].active,false);assert.equal(f.calls.off.length,2);}finally{f.destroy();}
});

test('Waveform surfaces use the shared sound-change path and inactive steps stay silent',()=>{
 const f=fixture(waveformDefinition,waveformMount);try{f.canvas.emit('pointerdown',200,180);f.canvas.emit('pointermove',200,110);assert.ok(f.calls.sound.some(patch=>Number.isFinite(patch.crush)));f.canvas.emit('pointerup',200,110);f.controller.onStep(3,9);assert.equal(f.calls.pulse.length,0);f.controller.onStep(0,9.25);assert.equal(f.calls.pulse[0][3],9.25);}finally{f.destroy();}
});

test('Geo terrain orbit does not start a voice, and scheduling does not move a held map contact early',()=>{
 const f=fixture(geoDefinition,geoMount);try{const before=f.controller.getData();f.canvas.emit('pointerdown',900,180);f.canvas.emit('pointermove',960,220);f.canvas.emit('pointerup',960,220);assert.equal(f.calls.on.length,0);assert.notEqual(f.controller.getData().yaw,before.yaw);f.canvas.emit('pointerdown',240,260,3);const selected=f.controller.getData().selected;f.controller.onStep(8,12);assert.deepEqual(f.controller.getData().selected,selected);assert.equal(f.calls.pulse[0][3],12);f.canvas.emit('pointercancel',240,260,3);assert.deepEqual(f.calls.off,[['geo-3']]);}finally{f.destroy();}
});

test('Geo zoom requires two terrain contacts; a playing finger never becomes a pinch',()=>{
 const f=fixture(geoDefinition,geoMount);try{const start=f.controller.getData();f.canvas.emit('pointerdown',200,200,1);f.canvas.emit('pointerdown',860,180,2);f.canvas.emit('pointermove',880,185,2);assert.equal(f.controller.getData().zoom,start.zoom);const yaw=f.controller.getData().yaw;f.canvas.emit('pointerdown',1000,180,3);f.canvas.emit('pointermove',1100,180,3);assert.ok(f.controller.getData().zoom<start.zoom);assert.equal(f.controller.getData().yaw,yaw);f.canvas.emit('pointerup',1100,180,3);const zoom=f.controller.getData().zoom;f.canvas.emit('pointermove',885,190,2);assert.equal(f.controller.getData().zoom,zoom);assert.equal(f.calls.on.length,1);}finally{f.destroy();}
});

test('Census sequence pitch is independent of hex density and viewport shape',()=>{
 const f=fixture(censusDefinition,censusMount);try{for(let i=0;i<16;i++)f.controller.onStep(i,i);const notes=f.calls.pulse.map(call=>call[1]);f.state.appearance.cellScale=1.4;f.resize(390,766);for(let i=0;i<16;i++)f.controller.onStep(i,i+20);assert.deepEqual(f.calls.pulse.slice(16).map(call=>call[1]),notes);f.state.appearance.cellScale=.65;f.resize(844,333);for(let i=0;i<16;i++)f.controller.onStep(i,i+40);assert.deepEqual(f.calls.pulse.slice(32).map(call=>call[1]),notes);}finally{f.destroy();}
});
