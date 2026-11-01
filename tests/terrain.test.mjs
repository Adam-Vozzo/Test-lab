import test from 'node:test';
import assert from 'node:assert/strict';
import {definition as terrainDefinition,mount as terrainMount} from '../instruments/terrain.js';

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

test('Terrain orbit does not start a voice, and scheduling does not move a held map contact early',()=>{
 const f=fixture(terrainDefinition,terrainMount);try{const before=f.controller.getData();f.canvas.emit('pointerdown',900,180);f.canvas.emit('pointermove',960,220);f.canvas.emit('pointerup',960,220);assert.equal(f.calls.on.length,0);assert.notEqual(f.controller.getData().yaw,before.yaw);f.canvas.emit('pointerdown',240,260,3);const selected=f.controller.getData().selected;f.controller.onStep(8,12);assert.deepEqual(f.controller.getData().selected,selected);assert.equal(f.calls.pulse[0][3],12);f.canvas.emit('pointercancel',240,260,3);assert.deepEqual(f.calls.off,[['geo-3']]);}finally{f.destroy();}
});

test('Terrain zoom requires two terrain contacts; a playing finger never becomes a pinch',()=>{
 const f=fixture(terrainDefinition,terrainMount);try{const start=f.controller.getData();f.canvas.emit('pointerdown',200,200,1);f.canvas.emit('pointerdown',860,180,2);f.canvas.emit('pointermove',880,185,2);assert.equal(f.controller.getData().zoom,start.zoom);const yaw=f.controller.getData().yaw;f.canvas.emit('pointerdown',1000,180,3);f.canvas.emit('pointermove',1100,180,3);assert.ok(f.controller.getData().zoom<start.zoom);assert.equal(f.controller.getData().yaw,yaw);f.canvas.emit('pointerup',1100,180,3);const zoom=f.controller.getData().zoom;f.canvas.emit('pointermove',885,190,2);assert.equal(f.controller.getData().zoom,zoom);assert.equal(f.calls.on.length,1);}finally{f.destroy();}
});

test('Terrain envelope controls own their gesture without stealing a sounding map contact',()=>{
 const f=fixture(terrainDefinition,terrainMount);try{f.canvas.emit('pointerdown',240,260,1);f.canvas.emit('pointerdown',280,606,2);assert.equal(f.calls.on.length,1);const attack=f.state.sound.attack,yaw=f.controller.getData().yaw;f.canvas.emit('pointermove',400,606,2);assert.ok(f.state.sound.attack>attack);f.canvas.emit('pointermove',900,180,2);assert.equal(f.controller.getData().yaw,yaw);f.canvas.emit('pointercancel',900,180,2);assert.deepEqual(f.calls.off,[]);f.canvas.emit('pointerup',240,260,1);assert.deepEqual(f.calls.off,[['geo-1']]);}finally{f.destroy();}
});
