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
const {splitLayout}=await import('../instrument-layout.js');
const hand=await import('../instruments/hand.js'),structure=await import('../instruments/structure.js');
function fixture(module){
  const children=[],calls=[],host={append(value){children.push(value);}},state={bpm:112,playing:false,hold:false,arp:false,root:50,scale:'dorian',sound:{...module.definition.defaultSound},appearance:{...module.definition.defaultAppearance}};
  const api={state,quantize:n=>50+n*2,noteName:n=>String(n),save(){},setStatus(){},setSound(patch){Object.assign(state.sound,patch);calls.push(['sound',patch]);},noteOn:(...args)=>calls.push(['on',...args]),noteUpdate:(...args)=>calls.push(['update',...args]),noteOff:(...args)=>calls.push(['off',...args]),noteCancel:(...args)=>calls.push(['cancel',...args]),audio:{snapshot:()=>({time:1,step:0,rms:0,voices:[],waveform:[],frequency:[]}),configure(){},pulse:(...args)=>calls.push(['pulse',...args])}};
  const controller=module.mount(host,api);return {canvas:children[0],controller,calls,state};
}

test('Hand keyboard drag changes the same source and cancellation releases it once',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',4,90,520);f.canvas.emit('pointermove',4,260,520);
  const on=f.calls.find(v=>v[0]==='on'),update=f.calls.find(v=>v[0]==='update');assert.ok(on);assert.equal(on[1],update[1]);assert.notEqual(on[2],update[2]);
  f.canvas.emit('pointercancel',4,260,520);f.canvas.emit('lostpointercapture',4,260,520);assert.equal(f.calls.filter(v=>v[0]==='cancel').length,1);assert.equal(f.calls.filter(v=>v[0]==='off').length,0);f.controller.destroy();
});

test('Hand reuses no gesture voice IDs when a held touch identifier returns',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',4,90,520);f.canvas.emit('pointerup',4,90,520);f.canvas.emit('pointerdown',4,140,520);const ids=f.calls.filter(v=>v[0]==='on').map(v=>v[1]);assert.equal(new Set(ids).size,2);f.controller.destroy();
});

test('Hand printed rotary controls edit sound without admitting a playing touch',()=>{
  const f=fixture(hand),before=f.state.sound.cutoff;f.canvas.emit('pointerdown',1,42,81);f.canvas.emit('pointermove',1,42,50);f.canvas.emit('pointerup',1,42,50);
  assert.ok(f.state.sound.cutoff>before);assert.equal(f.calls.filter(v=>v[0]==='on').length,0);f.controller.destroy();
});

test('Etching keyboard distinguishes real chromatic black keys from the white key below',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',3,72,460);assert.equal(f.calls.find(v=>v[0]==='on')[2],51);f.canvas.emit('pointermove',3,72,570);assert.equal(f.calls.find(v=>v[0]==='update')[2],52);f.controller.destroy();
});

test('Etching prism drags edit sequence pitch and audition that same pitch',()=>{
  const f=fixture(hand);const before=f.controller.getData().pattern[3];f.canvas.emit('pointerdown',5,108,390);f.canvas.emit('pointermove',5,108,420);const note=f.controller.getData().pattern[3];assert.ok(note<before);assert.equal(f.calls.find(v=>v[0]==='update')[2],50+note*2);f.controller.destroy();
});

test('Machine circular cutoff and vertical envelope controls change sound without adding voices',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',7,625,54);const cutoff=f.state.sound.cutoff;f.canvas.emit('pointermove',7,738,153);assert.ok(f.state.sound.cutoff>cutoff);f.canvas.emit('pointerup',7,738,153);
  f.canvas.emit('pointerdown',8,785,120);const attack=f.state.sound.attack;f.canvas.emit('pointermove',8,785,80);assert.ok(f.state.sound.attack>attack);assert.equal(f.calls.filter(v=>v[0]==='on').length,0);f.controller.destroy();
});

test('Etching ring contact stays the same voice while another contact orbits, without zoom',()=>{
  const f=fixture(hand);f.canvas.emit('pointerdown',21,326,164);const voice=f.calls.find(v=>v[0]==='on');assert.ok(voice);const before=f.controller.getData().ringCamera;
  f.canvas.emit('pointerdown',22,249,163);f.canvas.emit('pointermove',22,279,173);f.canvas.emit('pointermove',21,326,164);const after=f.controller.getData().ringCamera;assert.notEqual(after.yaw,before.yaw);assert.equal(after.zoom,before.zoom);assert.equal(f.calls.filter(v=>v[0]==='update').length,0);assert.equal(f.calls.filter(v=>v[0]==='off').length,0);
  f.canvas.emit('pointerup',22,279,173);f.canvas.emit('pointerup',21,326,164);assert.deepEqual(f.calls.filter(v=>v[0]==='off').map(v=>v[1]),[voice[1]]);f.controller.destroy();
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
  const f=fixture(structure);f.canvas.emit('pointerdown',1,741,312);const voice=f.calls.find(v=>v[0]==='on');assert.ok(voice);
  const before=f.controller.getData().camera;f.canvas.emit('pointerdown',2,629,312);f.canvas.emit('pointermove',2,659,322);f.canvas.emit('pointermove',1,741,312);
  const after=f.controller.getData().camera;assert.notEqual(after.yaw,before.yaw);assert.equal(after.zoom,before.zoom);assert.equal(f.calls.filter(v=>v[0]==='update').length,0);assert.equal(f.calls.filter(v=>v[0]==='off').length,0);
  f.canvas.emit('pointerup',2,659,322);f.canvas.emit('pointerup',1,741,312);assert.deepEqual(f.calls.filter(v=>v[0]==='off').map(v=>v[1]),[voice[1]]);f.controller.destroy();
});

test('Structure needs two navigation contacts to pinch and reuses no gesture voice IDs',()=>{
  const f=fixture(structure);f.canvas.emit('pointerdown',1,741,312);f.canvas.emit('pointerup',1,741,312);f.canvas.emit('pointerdown',1,741,312);const ids=f.calls.filter(v=>v[0]==='on').map(v=>v[1]);assert.equal(new Set(ids).size,2);
  const before=f.controller.getData().camera.zoom;f.canvas.emit('pointerdown',2,629,312);f.canvas.emit('pointerdown',3,610,312);f.canvas.emit('pointermove',3,580,312);assert.ok(f.controller.getData().camera.zoom>before);assert.equal(f.calls.filter(v=>v[0]==='on').length,2);
  f.controller.cancel();assert.equal(f.calls.filter(v=>v[0]==='off').length,1);assert.equal(f.calls.filter(v=>v[0]==='cancel').length,1);f.controller.destroy();
});

test('Structure full-circle crosshair changes filter parameters without editing the sequence',()=>{
  const f=fixture(structure),before=f.controller.getData().pattern;f.canvas.emit('pointerdown',9,100,462);const cutoff=f.state.sound.cutoff;f.canvas.emit('pointermove',9,150,440);assert.ok(f.state.sound.cutoff>cutoff);assert.ok(f.state.sound.resonance>5);assert.deepEqual(f.controller.getData().pattern,before);assert.equal(f.calls.filter(v=>v[0]==='on').length,0);f.controller.destroy();
});

test('Structure string strum admits a chord and releases every independently played string',()=>{
  const f=fixture(structure);f.canvas.emit('pointerdown',11,320,354);f.canvas.emit('pointermove',11,320,443);const notes=f.calls.filter(v=>v[0]==='on');assert.deepEqual(notes.map(v=>v[2]),[64,62,60,58]);assert.equal(new Set(notes.map(v=>v[1])).size,4);f.canvas.emit('pointerup',11,320,443);assert.equal(f.calls.filter(v=>v[0]==='off').length,4);f.controller.destroy();
});

test('cancelled strums under Hold force-release every source once',()=>{
  const f=fixture(structure);f.state.hold=true;f.canvas.emit('pointerdown',31,320,354);f.canvas.emit('pointermove',31,320,443);const ids=f.calls.filter(v=>v[0]==='on').map(v=>v[1]);f.canvas.emit('pointercancel',31,320,443);f.canvas.emit('lostpointercapture',31,320,443);assert.deepEqual(f.calls.filter(v=>v[0]==='cancel').map(v=>v[1]),ids);assert.equal(f.calls.filter(v=>v[0]==='off').length,0);f.controller.destroy();
});

test('repeated strums keep one source identity per string within the held gesture',()=>{
  const f=fixture(structure);f.canvas.emit('pointerdown',24,320,354);f.canvas.emit('pointermove',24,320,443);f.canvas.emit('pointermove',24,320,400);const notes=f.calls.filter(v=>v[0]==='on');assert.equal(notes.length,5);assert.equal(new Set(notes.map(v=>v[1])).size,4);assert.equal(notes[2][1],notes[4][1]);f.controller.destroy();
});

test('Structure perpendicular waveform blocks alter synthesis, leaving pitch sequence intact',()=>{
  const f=fixture(structure),before=f.controller.getData().pattern;f.canvas.emit('pointerdown',12,271,139);assert.equal(f.state.sound.waveform,'sawtooth');const ratio=f.state.sound.ratio;f.canvas.emit('pointermove',12,349,100);assert.ok(f.state.sound.ratio>ratio);assert.deepEqual(f.controller.getData().pattern,before);assert.equal(f.calls.filter(v=>v[0]==='on').length,0);f.controller.destroy();
});

test('asymmetric pane widths keep keyboard and timbre-circle hit targets aligned',()=>{
  const h=fixture(hand);Object.assign(h.state.appearance,{leftWidth:65,rightWidth:25,layoutGap:40});const hp=splitLayout(900,600,h.state.appearance,{pad:0,gap:12,portraitRatio:.83});h.canvas.emit('pointerdown',17,hp.right.x+hp.right.w*(.045+.91/8*1.5),546);assert.equal(h.calls.find(v=>v[0]==='on')[2],52);h.controller.destroy();
  const s=fixture(structure);Object.assign(s.state.appearance,{leftWidth:65,rightWidth:25,layoutGap:40});const sp=splitLayout(900,600,s.state.appearance,{pad:0,gap:12,portraitRatio:.83});s.canvas.emit('pointerdown',18,sp.left.x+sp.left.w*.225,sp.left.y+sp.left.h*.77);assert.ok(s.calls.some(v=>v[0]==='sound'));assert.equal(s.calls.filter(v=>v[0]==='on').length,0);s.controller.destroy();
});

test('both sequencers preserve the audio scheduler timestamp and validated pattern',()=>{
  for(const module of [hand,structure]){
    const f=fixture(module);f.controller.setData({pattern:Array(16).fill(6)});f.controller.onStep(3,12.345);const pulse=f.calls.find(v=>v[0]==='pulse');assert.equal(pulse[2],62);assert.equal(pulse[4],12.345);assert.ok(pulse[5]>0);f.controller.destroy();
  }
});
