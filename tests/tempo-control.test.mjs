import test from 'node:test';
import assert from 'node:assert/strict';
import {createTempoControl} from '../tempo-control.js';

function fixture(){
  const make=()=>{
    const element=new EventTarget(),classes=new Set(),attributes=new Map(),styles=new Map();
    Object.assign(element,{textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},style:{setProperty:(k,v)=>styles.set(k,v)},setAttribute:(k,v)=>attributes.set(k,v),getAttribute:k=>attributes.get(k),focus(){},getBoundingClientRect:()=>({left:62,top:730,width:64,height:42})});
    return element;
  };
  const host=make(),doc=make(),win=make(),trigger=make(),input=make(),popup=make(),readout=make(),popupValue=make(),capture=new Set(),events=[];
  Object.assign(win,{innerWidth:1180,innerHeight:820});Object.assign(doc,{defaultView:win,hidden:false});host.ownerDocument=doc;
  doc.body=make();doc.body.append=node=>{node.parentNode=doc.body;};
  host.insertBefore=node=>{node.parentNode=host;};popup.parentNode=host;
  Object.assign(input,{min:'40',max:'220',value:'112',getBoundingClientRect:()=>({width:236})});
  const elements={'#tempo-trigger':trigger,'#bpm':input,'#tempo-popup':popup,'#bpm-readout':readout,'#tempo-popup-value':popupValue};host.querySelector=id=>elements[id];
  trigger.setPointerCapture=id=>capture.add(id);trigger.hasPointerCapture=id=>capture.has(id);trigger.releasePointerCapture=id=>{capture.delete(id);emit(trigger,'lostpointercapture',{pointerId:id});};
  for(const type of ['input','change'])input.addEventListener(type,()=>events.push({type,value:Number(input.value)}));
  const control=createTempoControl(host);
  return{host,doc,win,trigger,input,popup,readout,popupValue,capture,events,control};
}
function emit(element,type,properties={}){const event=new Event(type,{cancelable:true,bubbles:true});Object.assign(event,properties);element.dispatchEvent(event);return event;}
const down=(f,id=2,x=95)=>emit(f.trigger,'pointerdown',{pointerType:'touch',isPrimary:false,pointerId:id,clientX:x,button:0});
const move=(f,x,id=2)=>emit(f.trigger,'pointermove',{pointerId:id,clientX:x});
const up=(f,id=2)=>emit(f.trigger,'pointerup',{pointerId:id});

test('a held secondary pointer reveals the slider without jumping and scrubs outside the trigger',()=>{
  const f=fixture();down(f);assert.equal(f.input.value,'112');assert.equal(f.events.length,0);assert.ok(f.control.active&&f.capture.has(2)&&f.host.classList.contains('is-open'));assert.equal(f.popup.parentNode,f.doc.body);assert.ok(f.popup.classList.contains('is-open'));
  move(f,155,9);assert.equal(f.input.value,'112');
  move(f,155);const forward=Number(f.input.value);assert.ok(forward>112);assert.equal(f.readout.textContent,String(forward));assert.equal(f.trigger.getAttribute('aria-valuenow'),String(forward));
  move(f,120);assert.ok(Number(f.input.value)<forward&&Number(f.input.value)>112);
  up(f,9);assert.ok(f.control.active);up(f);assert.ok(!f.control.active&&!f.host.classList.contains('is-open')&&!f.capture.size);assert.equal(f.events.at(-1).type,'change');f.control.destroy();
});

test('clamping, a new gesture, cancellation and lost capture never leave the slider open',()=>{
  const f=fixture();down(f);move(f,2000);assert.equal(f.input.value,'220');move(f,-2000);assert.equal(f.input.value,'40');up(f);
  down(f,4,200);move(f,200,4);assert.equal(f.input.value,'40');emit(f.trigger,'pointercancel',{pointerId:4});assert.ok(!f.control.active&&!f.capture.size);
  down(f,7);emit(f.trigger,'lostpointercapture',{pointerId:7});assert.ok(!f.control.active&&!f.host.classList.contains('is-open'));f.control.destroy();
});

test('keyboard slider commands expose the same control and announce the actual tempo',()=>{
  const f=fixture();const key=(name,extra={})=>emit(f.trigger,'keydown',{key:name,...extra}),release=name=>emit(f.trigger,'keyup',{key:name});
  assert.ok(key('ArrowRight').defaultPrevented);assert.equal(f.input.value,'113');assert.ok(f.control.active);release('ArrowRight');assert.ok(!f.control.active);
  key('ArrowDown',{shiftKey:true});assert.equal(f.input.value,'103');release('ArrowDown');
  key('End');assert.equal(f.input.value,'220');release('End');key('PageDown');assert.equal(f.input.value,'210');release('PageDown');key('Home');assert.equal(f.input.value,'40');release('Home');
  key(' ');assert.ok(f.control.active);assert.equal(f.input.value,'40');assert.ok(key('Escape').defaultPrevented);assert.ok(!f.control.active);assert.equal(f.trigger.getAttribute('aria-valuetext'),'40 beats per minute');f.control.destroy();
});

test('resizing repositions the bubble without changing an active drag sensitivity',()=>{
  const f=fixture();down(f);move(f,120);const before=Number(f.input.value);f.win.innerWidth=320;emit(f.win,'resize');assert.equal(Number(f.input.value),before);assert.equal(f.popup.style.left,'12px');move(f,145);assert.ok(Number(f.input.value)>before);up(f);f.control.destroy();
});

test('external values synchronize and hidden-page or teardown releases capture and handlers',()=>{
  const f=fixture();f.input.value='97';f.control.sync();assert.equal(f.readout.textContent,'97');f.input.value='142';emit(f.input,'input');assert.equal(f.trigger.getAttribute('aria-valuenow'),'142');
  down(f);f.doc.hidden=true;emit(f.doc,'visibilitychange');assert.ok(!f.control.active&&!f.capture.size&&!f.popup.classList.contains('is-open'));f.doc.hidden=false;down(f);f.control.destroy();assert.ok(!f.control.active&&!f.capture.size);assert.equal(f.popup.parentNode,f.host);
  down(f);move(f,600);assert.equal(f.input.value,'142');assert.ok(!f.host.classList.contains('is-open'));
});
