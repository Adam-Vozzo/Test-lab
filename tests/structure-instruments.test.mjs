import test from 'node:test';
import assert from 'node:assert/strict';

// Gesture/state tests use a real module controller and a small DOM stand-in.
// Rendering and sound output are verified separately in a native browser.
globalThis.window={devicePixelRatio:1};
globalThis.devicePixelRatio=1;
globalThis.matchMedia=()=>({matches:false});
const context=new Proxy({}, {get(target,key){if(key in target)return target[key];return ()=>{};},set(target,key,value){target[key]=value;return true;}});
function canvas(){
  const listeners=new Map(),captured=new Set();
  return {style:{},width:0,height:0,setAttribute(){},getContext:()=>context,getBoundingClientRect:()=>({left:0,top:0,width:900,height:600}),remove(){},focus(){},
    addEventListener(type,fn,options={}){const entries=listeners.get(type)||[];entries.push(fn);listeners.set(type,entries);options.signal?.addEventListener('abort',()=>this.removeEventListener(type,fn),{once:true});},
    removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(v=>v!==fn));},
    setPointerCapture(id){captured.add(id);},hasPointerCapture:id=>captured.has(id),releasePointerCapture(id){captured.delete(id);},
    emit(type,id,x,y){const event={pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y,pressure:.5,preventDefault(){}};for(const fn of listeners.get(type)||[])fn(event);}
  };
}
globalThis.document={createElement:()=>canvas(),createElementNS(){throw new Error('No WebGL in gesture fixture');}};
const hand=await import('../instruments/hand.js'),structure=await import('../instruments/structure.js');
function fixture(module){
  const children=[],calls=[],host={append(value){children.push(value);}},state={bpm:112,playing:false,hold:false,arp:false,root:50,scale:'dorian',sound:{...module.definition.defaultSound},appearance:{...module.definition.defaultAppearance}};
  const api={state,quantize:n=>50+n*2,noteName:n=>String(n),save(){},setStatus(){},setSound(patch){Object.assign(state.sound,patch);calls.push(['sound',patch]);},noteOn:(...args)=>calls.push(['on',...args]),noteUpdate:(...args)=>calls.push(['update',...args]),noteOff:(...args)=>calls.push(['off',...args]),audio:{snapshot:()=>({time:1,step:0,rms:0,voices:[],waveform:[],frequency:[]}),configure(){},pulse:(...args)=>calls.push(['pulse',...args])}};
  const controller=module.mount(host,api);return {canvas:children[0],controller,calls,state};
}

test('Hand keyboard drag changes the same source and cancellation releases it once',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',4,90,520);f.canvas.emit('pointermove',4,260,520);
  const on=f.calls.find(v=>v[0]==='on'),update=f.calls.find(v=>v[0]==='update');assert.ok(on);assert.equal(on[1],update[1]);assert.notEqual(on[2],update[2]);
  f.canvas.emit('pointercancel',4,260,520);f.canvas.emit('lostpointercapture',4,260,520);assert.equal(f.calls.filter(v=>v[0]==='off').length,1);f.controller.destroy();
});

test('Hand reuses no gesture voice IDs when a held touch identifier returns',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',4,90,520);f.canvas.emit('pointerup',4,90,520);f.canvas.emit('pointerdown',4,140,520);const ids=f.calls.filter(v=>v[0]==='on').map(v=>v[1]);assert.equal(new Set(ids).size,2);f.controller.destroy();
});

test('Hand printed rotary controls edit sound without admitting a playing touch',()=>{
  const f=fixture(hand),before=f.state.sound.cutoff;f.canvas.emit('pointerdown',1,42,81);f.canvas.emit('pointermove',1,42,50);f.canvas.emit('pointerup',1,42,50);
  assert.ok(f.state.sound.cutoff>before);assert.equal(f.calls.filter(v=>v[0]==='on').length,0);f.controller.destroy();
});

test('score import validates every pitch and preserves finite camera state',()=>{
  for(const module of [hand,structure]){
    const f=fixture(module);f.controller.setData({pattern:[-20,Infinity,4.6,200,...Array(12).fill(3)],camera:{yaw:.6,pitch:Infinity,zoom:100}});
    const data=f.controller.getData();assert.equal(data.pattern.length,16);assert.ok(data.pattern.every(v=>Number.isInteger(v)&&v>=0&&v<=7));assert.equal(data.pattern[0],0);assert.equal(data.pattern[2],5);assert.equal(data.pattern[3],7);
    if(data.camera){assert.equal(data.camera.yaw,.6);assert.ok(Number.isFinite(data.camera.pitch));assert.equal(data.camera.zoom,1.5);}
    f.controller.destroy();
  }
});

test('Structure orbit cannot zoom or retune a simultaneously held loop contact',()=>{
  const f=fixture(structure);f.canvas.emit('pointerdown',1,788,315);const voice=f.calls.find(v=>v[0]==='on');assert.ok(voice);
  const before=f.controller.getData().camera;f.canvas.emit('pointerdown',2,678,315);f.canvas.emit('pointermove',2,708,325);
  const after=f.controller.getData().camera;assert.notEqual(after.yaw,before.yaw);assert.equal(after.zoom,before.zoom);assert.equal(f.calls.filter(v=>v[0]==='update').length,0);assert.equal(f.calls.filter(v=>v[0]==='off').length,0);
  f.canvas.emit('pointerup',2,708,325);f.canvas.emit('pointerup',1,788,315);assert.deepEqual(f.calls.filter(v=>v[0]==='off').map(v=>v[1]),[voice[1]]);f.controller.destroy();
});

test('Structure needs two navigation contacts to pinch and reuses no gesture voice IDs',()=>{
  const f=fixture(structure);f.canvas.emit('pointerdown',1,788,315);f.canvas.emit('pointerup',1,788,315);f.canvas.emit('pointerdown',1,788,315);const ids=f.calls.filter(v=>v[0]==='on').map(v=>v[1]);assert.equal(new Set(ids).size,2);
  const before=f.controller.getData().camera.zoom;f.canvas.emit('pointerdown',2,678,315);f.canvas.emit('pointerdown',3,650,315);f.canvas.emit('pointermove',3,610,315);assert.ok(f.controller.getData().camera.zoom>before);assert.equal(f.calls.filter(v=>v[0]==='on').length,2);
  f.controller.cancel();assert.equal(f.calls.filter(v=>v[0]==='off').length,2);f.controller.destroy();
});

test('Structure polar pitch field edits the same score values while retaining one voice',()=>{
  const f=fixture(structure);f.canvas.emit('pointerdown',9,118,471);const first=f.calls.find(v=>v[0]==='on');assert.ok(first);assert.equal(f.controller.getData().pattern[0],5);
  f.canvas.emit('pointermove',9,24,568);const update=f.calls.find(v=>v[0]==='update');assert.ok(update);assert.equal(update[1],first[1]);assert.equal(f.controller.getData().pattern[4],6);
  f.canvas.emit('pointerup',9,24,568);assert.equal(f.calls.filter(v=>v[0]==='off').length,1);f.controller.destroy();
});

test('both sequencers preserve the audio scheduler timestamp and validated pattern',()=>{
  for(const module of [hand,structure]){
    const f=fixture(module);f.controller.setData({pattern:Array(16).fill(6)});f.controller.onStep(3,12.345);const pulse=f.calls.find(v=>v[0]==='pulse');assert.equal(pulse[2],62);assert.equal(pulse[4],12.345);assert.ok(pulse[5]>0);f.controller.destroy();
  }
});
