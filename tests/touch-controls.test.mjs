import test from 'node:test';
import assert from 'node:assert/strict';
import {enableSecondaryButtonTaps} from '../touch-controls.js';

function fixture(){
  const listeners=new Map();
  const root={hidden:false,hit:null,addEventListener(type,listener,options={}){
    const item={listener,options};const group=listeners.get(type)||[];group.push(item);listeners.set(type,group);
    options.signal?.addEventListener('abort',()=>{const index=group.indexOf(item);if(index>=0)group.splice(index,1);},{once:true});
  },elementFromPoint(){return this.hit;}};
  const emit=(type,extra={})=>{
    const event={type,target:root.hit,pointerId:3,pointerType:'touch',isPrimary:false,clientX:40,clientY:30,isTrusted:true,detail:1,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const {listener}of [...(listeners.get(type)||[])]){listener(event);if(event.stopped)break;}
    if(type==='click'&&!event.stopped)event.target.clicks++;
    return event;
  };
  const button=(allowed=true)=>{const b={isConnected:true,disabled:false,clicks:0,matches:()=>allowed,closest(selector){return selector==='button'?this:null;},getAttribute:()=>null,click(){emit('click',{target:this,isTrusted:false,detail:0,pointerId:-1,pointerType:''});}};return b;};
  const a=button(),b=button(),excluded=button(false);root.hit=a;
  return{root,a,b,excluded,emit,destroy:enableSecondaryButtonTaps(root)};
}

test('a secondary touch activates once and suppresses only its matching native click',()=>{
  const f=fixture();f.emit('pointerdown');f.emit('pointerup');assert.equal(f.a.clicks,1);
  assert.equal(f.emit('click').stopped,true);assert.equal(f.a.clicks,1);
  // Another gesture is intentional even at the same button and reused ID.
  f.emit('pointerdown');f.emit('pointerup');assert.equal(f.a.clicks,2);f.destroy();
});

test('primary touches, keyboard clicks, other buttons and subsequent mouse input stay native',()=>{
  const f=fixture();f.emit('pointerdown',{isPrimary:true});f.emit('pointerup',{isPrimary:true});assert.equal(f.a.clicks,0);f.emit('click',{pointerId:8,isPrimary:true});assert.equal(f.a.clicks,1);
  f.emit('pointerdown');f.emit('pointerup');assert.equal(f.a.clicks,2);
  f.emit('click',{detail:0,pointerId:-1,pointerType:''});assert.equal(f.a.clicks,3);
  f.emit('click',{target:f.b});assert.equal(f.b.clicks,1);
  f.emit('pointerdown',{pointerId:1,pointerType:'mouse',isPrimary:true});f.emit('pointerup',{pointerId:1,pointerType:'mouse',isPrimary:true});f.emit('click',{pointerId:1,pointerType:'mouse'});assert.equal(f.a.clicks,4);f.destroy();
});

test('legacy native touch clicks dedupe without swallowing a later intentional click',()=>{
  const f=fixture();f.emit('pointerdown');f.emit('pointerup');assert.equal(f.a.clicks,1);
  assert.equal(f.emit('click',{pointerId:undefined,pointerType:undefined}).stopped,true);assert.equal(f.a.clicks,1);
  f.emit('pointerdown');f.emit('pointerup');assert.equal(f.a.clicks,2);
  f.emit('pointerdown',{pointerId:1,pointerType:'mouse',isPrimary:true});f.emit('pointerup',{pointerId:1,pointerType:'mouse',isPrimary:true});
  f.emit('click',{pointerId:undefined,pointerType:undefined});assert.equal(f.a.clicks,3);f.destroy();
});

test('drag, cancellation, lost capture and off-button release never activate a tap',()=>{
  const f=fixture();
  f.emit('pointerdown');f.emit('pointermove',{clientX:55});f.emit('pointerup');assert.equal(f.a.clicks,0);
  for(const event of ['pointercancel','lostpointercapture']){f.emit('pointerdown');f.emit(event);f.emit('pointerup');assert.equal(f.a.clicks,0);}
  f.emit('pointerdown');f.root.hit=f.b;f.emit('pointerup',{target:f.a});assert.equal(f.a.clicks,0);
  f.root.hit=f.excluded;f.emit('pointerdown');f.emit('pointerup');assert.equal(f.excluded.clicks,0);
  f.root.hit=f.a;f.emit('pointerdown');f.a.disabled=true;f.emit('pointerup');assert.equal(f.a.clicks,0);f.destroy();
});

test('hidden page and cleanup discard incomplete secondary gestures',()=>{
  const f=fixture();f.emit('pointerdown');f.root.hidden=true;f.emit('visibilitychange');f.emit('pointerup');assert.equal(f.a.clicks,0);
  f.root.hidden=false;f.emit('pointerdown');f.destroy();f.emit('pointerup');assert.equal(f.a.clicks,0);
});
