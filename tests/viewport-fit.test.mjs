import test from 'node:test';
import assert from 'node:assert/strict';
import {installViewportFit} from '../viewport-fit.js';

function fixture(){
  const win=new EventTarget(),visual=new EventTarget(),frames=new Map(),properties=new Map();let serial=0;
  Object.assign(visual,{height:390,scale:1});Object.assign(win,{visualViewport:visual,innerHeight:360,requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);}});
  const root={clientHeight:360,style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)}};
  return{win,visual,root,properties,frames,flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}

test('visible viewport changes fill installed displays and coalesce resize events',()=>{
  const f=fixture(),dispose=installViewportFit(f.win,f.root);assert.equal(f.properties.get('--app-height'),'390px');
  f.visual.height=844;f.visual.dispatchEvent(new Event('resize'));f.win.dispatchEvent(new Event('orientationchange'));assert.equal(f.frames.size,1);f.flush();assert.equal(f.properties.get('--app-height'),'844px');
  f.visual.height=390;f.win.dispatchEvent(new Event('pageshow'));f.flush();assert.equal(f.properties.get('--app-height'),'390px');
  dispose();assert.equal(f.properties.size,0);f.win.dispatchEvent(new Event('resize'));assert.equal(f.frames.size,0);
});

test('browser zoom cannot resize active playing targets, and unavailable VisualViewport falls back to innerHeight',()=>{
  const f=fixture(),dispose=installViewportFit(f.win,f.root);f.visual.scale=2;f.visual.height=195;f.visual.dispatchEvent(new Event('resize'));f.flush();assert.equal(f.properties.get('--app-height'),'390px');
  f.win.visualViewport=null;f.win.innerHeight=420;f.win.dispatchEvent(new Event('resize'));f.flush();assert.equal(f.properties.get('--app-height'),'420px');
  f.win.dispatchEvent(new Event('resize'));dispose();assert.equal(f.frames.size,0);
});
