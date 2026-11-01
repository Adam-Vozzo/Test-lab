import test from 'node:test';
import assert from 'node:assert/strict';
import {splitLayout,withSharedAppearance,SHARED_APPEARANCE_DEFAULTS} from '../instrument-layout.js';
import {enableRangeScrubbing,rangeValueAt} from '../range-scrub.js';

test('independent pane widths retain their outside anchors and expose centre space',()=>{
  const normal=splitLayout(1200,760,{}, {pad:20,gap:24});
  assert.deepEqual(normal.left,{x:20,y:20,w:568,h:720});
  assert.deepEqual(normal.right,{x:612,y:20,w:568,h:720});
  const narrower=splitLayout(1200,760,{leftWidth:30,rightWidth:45,layoutGap:60},{pad:20});
  assert.equal(narrower.left.x,20);assert.equal(narrower.right.x+narrower.right.w,1180);
  assert.equal(narrower.left.w,330);assert.equal(narrower.right.w,495);assert.equal(narrower.gap,335);
  const fitted=splitLayout(1200,760,{leftWidth:80,rightWidth:40,layoutGap:60},{pad:20});
  assert.ok(Math.abs(fitted.left.w/fitted.right.w-2)<1e-8);assert.ok(Math.abs(fitted.gap-60)<1e-8);
});

test('portrait stacking keeps the entire width playable and both vertical edges anchored',()=>{
  const {left,right,wide,gap}=splitLayout(390,770,{leftWidth:40,rightWidth:60,layoutGap:20},{pad:10});
  assert.equal(wide,false);assert.equal(left.w,370);assert.equal(right.w,370);assert.equal(left.y,10);assert.equal(right.y+right.h,760);assert.equal(gap,20);
  assert.ok(Math.abs(left.h/right.h-2/3)<1e-8);
  for(const [width,height]of [[1,1],[40,30],[844,390]]){
    const panes=splitLayout(width,height,{leftWidth:80,rightWidth:80,layoutGap:120});
    for(const p of [panes.left,panes.right])for(const n of Object.values(p))assert.ok(Number.isFinite(n));
    assert.ok(panes.gap>=0);assert.ok(panes.left.w>0&&panes.right.w>0);
  }
});

test('shared definitions preserve module ownership and omit irrelevant split controls on single plots',()=>{
  const original={name:'Example',defaultAppearance:{colour:'#123456'},appearanceControls:[{key:'colour',section:'Field'}]};
  const combined=withSharedAppearance(original);
  assert.equal(combined.defaultAppearance.leftWidth,50);assert.equal(combined.appearanceControls[0].key,'colour');
  combined.defaultAppearance.colour='#abcdef';assert.equal(original.defaultAppearance.colour,'#123456');
  assert.equal(original.appearanceControls.length,1);assert.equal(combined.defaultAppearance.sceneGrain,SHARED_APPEARANCE_DEFAULTS.sceneGrain);
  const single=withSharedAppearance({...original,layoutMode:'single'});
  assert.ok(!single.appearanceControls.some(c=>c.section==='Layout'));assert.ok(!Object.hasOwn(single.defaultAppearance,'leftWidth'));
  assert.ok(single.appearanceControls.some(c=>c.key==='sceneBloom'));
});

function fixture(){
  const root=new EventTarget(),win=new EventTarget(),input=new EventTarget(),other=new EventTarget(),capture=new Set(),events=[];
  root.defaultView=win;root.hidden=false;
  Object.assign(input,{min:'0',max:'100',step:'1',value:'30',dataset:{},isConnected:true,disabled:false,readOnly:false,matches:selector=>selector==='input[type="range"]',focus(){},getBoundingClientRect:()=>({left:100,width:212}),setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)});
  for(const type of ['input','change'])input.addEventListener(type,()=>events.push({type,value:input.value}));
  const stop=enableRangeScrubbing(root);
  const emit=(type,{target=input,...props}={})=>{const e=new Event(type,{cancelable:true,bubbles:true});Object.defineProperty(e,'target',{value:target});Object.assign(e,{pointerId:2,pointerType:'touch',button:0,...props});root.dispatchEvent(e);return e;};
  return{root,win,input,other,capture,events,emit,stop};
}

test('pressing the middle of any range track starts a captured drag and allows movement outside it',()=>{
  const f=fixture();assert.ok(f.emit('pointerdown',{clientX:206,isPrimary:false}).defaultPrevented);assert.equal(f.input.value,'50');assert.ok(f.capture.has(2));
  f.emit('pointermove',{target:f.other,clientX:500});assert.equal(f.input.value,'100');
  f.emit('pointermove',{target:f.other,clientX:50});assert.equal(f.input.value,'0');
  f.emit('pointermove',{clientX:250,pointerId:9});assert.equal(f.input.value,'0');
  f.emit('pointerup');assert.equal(f.events.at(-1).type,'change');assert.equal(f.capture.size,0);f.stop();
});

test('range cancellation, a second pointer, and teardown never retain a drag owner',()=>{
  const f=fixture();f.emit('pointerdown',{clientX:206});f.emit('pointerdown',{pointerId:4,clientX:300});assert.equal(f.input.value,'50');
  f.emit('pointercancel');assert.equal(f.capture.size,0);f.emit('pointerdown',{pointerId:4,clientX:306});assert.equal(f.input.value,'100');
  f.emit('lostpointercapture',{pointerId:4});assert.equal(f.capture.size,0);f.emit('pointerdown',{clientX:200});f.stop();assert.equal(f.capture.size,0);
  const before=f.input.value;f.emit('pointermove',{clientX:300});assert.equal(f.input.value,before);
});

test('disabled inputs and native keyboard shortcuts pass through while fractional steps stay exact',()=>{
  const f=fixture();f.input.disabled=true;assert.ok(!f.emit('pointerdown',{clientX:206}).defaultPrevented);assert.equal(f.input.value,'30');
  f.input.disabled=false;assert.ok(!f.emit('keydown',{key:'ArrowRight'}).defaultPrevented);
  Object.assign(f.input,{min:'-1',max:'1',step:'.005'});assert.equal(rangeValueAt(f.input,256),.5);assert.equal(rangeValueAt(f.input,-999),-1);assert.equal(rangeValueAt(f.input,999),1);f.stop();
});
