import test from 'node:test';
import assert from 'node:assert/strict';
import {installViewportFit} from '../viewport-fit.js';

function fixture({standalone=true,probe=true}={}){
  const win=new EventTarget(),doc=new EventTarget(),visual=new EventTarget(),frames=new Map(),timers=new Map(),properties=new Map(),children=[];
  const standaloneMode=new EventTarget();standaloneMode.matches=standalone;
  let serial=0,clock=0;
  const metrics={large:900,dynamic:850};
  const element={style:{},setAttribute(){},getBoundingClientRect(){return{height:this.style.height==='100lvh'?metrics.large:metrics.dynamic};},remove(){children.splice(children.indexOf(this),1);}};
  Object.assign(doc,{hidden:false,activeElement:null,createElement:probe?()=>element:undefined});
  Object.assign(visual,{height:900,scale:1});
  Object.assign(win,{document:doc,navigator:{},visualViewport:visual,innerHeight:900,matchMedia:query=>query.includes('standalone')?standaloneMode:Object.assign(new EventTarget(),{matches:false}),
    requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);},
    setTimeout(fn,delay){timers.set(++serial,{fn,at:clock+delay});return serial;},clearTimeout(id){timers.delete(id);}});
  const root={ownerDocument:doc,clientHeight:900,appendChild:el=>children.push(el),style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)}};
  const event=(target,type)=>target.dispatchEvent(new Event(type));
  const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
  return{win,doc,visual,root,metrics,element,standaloneMode,properties,frames,timers,children,event,flush,
    get height(){return properties.get('--app-height');},
    advance(ms){clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}flush();},
    focus(editor){doc.activeElement=editor;const e=new Event('focusin');Object.defineProperty(e,'target',{value:editor});doc.dispatchEvent(e);flush();},
    blur(){doc.activeElement=null;event(doc,'focusout');flush();},
  };
}

test('repeated installed-PWA background cycles cannot latch shrinking visual viewport snapshots',()=>{
  const f=fixture(),dispose=installViewportFit(f.win,f.root);assert.equal(f.height,'900px');
  for(const height of [840,780,720,660]){
    f.doc.hidden=true;f.event(f.doc,'visibilitychange');f.event(f.win,'pagehide');
    f.visual.height=height;f.event(f.visual,'resize');f.event(f.win,'resize');f.flush();assert.equal(f.height,'900px');
    f.doc.hidden=false;f.event(f.win,'pageshow');f.event(f.doc,'visibilitychange');f.flush();f.advance(650);
    assert.equal(f.height,'900px');
  }
  dispose();assert.equal(f.children.length,0);assert.equal(f.properties.size,0);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});

test('orientation and genuine smaller windows follow current CSS metrics, including late settling',()=>{
  const f=fixture(),dispose=installViewportFit(f.win,f.root);
  f.metrics.large=430;f.event(f.win,'orientationchange');f.event(f.win,'resize');assert.equal(f.frames.size,1);f.flush();assert.equal(f.height,'430px');
  f.metrics.large=450;f.advance(80);assert.equal(f.height,'450px');
  f.metrics.large=390;f.event(f.win,'resize');f.flush();assert.equal(f.height,'390px');
  f.doc.hidden=true;f.event(f.doc,'visibilitychange');f.metrics.large=850;f.doc.hidden=false;f.event(f.doc,'visibilitychange');f.flush();assert.equal(f.height,'850px');
  f.metrics.large=900;f.advance(250);assert.equal(f.height,'900px');dispose();
});

test('browser chrome uses dynamic CSS height while standalone uses large CSS height',()=>{
  const f=fixture({standalone:false}),dispose=installViewportFit(f.win,f.root);assert.equal(f.height,'850px');assert.equal(f.element.style.height,'100dvh');
  f.metrics.dynamic=790;f.visual.height=700;f.event(f.visual,'resize');f.flush();assert.equal(f.height,'790px');
  f.standaloneMode.matches=true;f.event(f.standaloneMode,'change');f.flush();assert.equal(f.height,'900px');assert.equal(f.element.style.height,'100lvh');dispose();
});

test('only a focused text keyboard temporarily reduces the instrument, and resume clears that reduction',()=>{
  const f=fixture(),dispose=installViewportFit(f.win,f.root);
  f.visual.height=540;f.event(f.visual,'resize');f.flush();assert.equal(f.height,'900px');
  f.focus({tagName:'INPUT',type:'range'});assert.equal(f.height,'900px');
  f.focus({tagName:'INPUT',type:'text'});assert.equal(f.height,'540px');
  f.blur();assert.equal(f.height,'900px');
  f.focus({tagName:'TEXTAREA'});assert.equal(f.height,'540px');
  f.doc.hidden=true;f.event(f.doc,'visibilitychange');f.visual.height=480;f.doc.hidden=false;f.event(f.doc,'visibilitychange');f.flush();assert.equal(f.height,'900px');
  f.event(f.visual,'resize');f.flush();assert.equal(f.height,'900px','a stale focused editor must not restore a background keyboard snapshot');
  f.blur();f.focus({isContentEditable:true});assert.equal(f.height,'480px');
  f.visual.height=840;f.event(f.visual,'resize');f.flush();assert.equal(f.height,'900px','small chrome changes are not keyboard sizing');dispose();
});

test('pinch zoom preserves playing targets and layout metrics are the no-probe fallback',()=>{
  const f=fixture({probe:false}),dispose=installViewportFit(f.win,f.root);assert.equal(f.height,'900px');
  f.visual.scale=2;f.visual.height=450;f.root.clientHeight=800;f.event(f.visual,'resize');f.flush();assert.equal(f.height,'900px');
  f.visual.scale=1;f.event(f.visual,'resize');f.flush();assert.equal(f.height,'800px');
  f.win.visualViewport=null;f.root.clientHeight=0;f.win.innerHeight=620;f.event(f.win,'resize');f.flush();assert.equal(f.height,'620px');
  dispose();f.event(f.win,'resize');f.event(f.doc,'visibilitychange');assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
