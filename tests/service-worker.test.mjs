import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source=await fs.readFile(new URL('../sw.js',import.meta.url),'utf8');
const base='https://example.test/Test-lab/';
function fixture({fail}={}){
  const handlers={},stores=new Map(),requested=[];let offline=false,active=0,peak=0,skipped=0;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);return{put:async(url,response)=>entries.set(url,response),match:async url=>entries.get(url)};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);},async match(url,{cacheName}){return stores.get(cacheName)?.get(url);}};
  const self={location:{href:base+'sw.js'},clients:{claim:async()=>{}},skipWaiting:()=>skipped++,addEventListener:(type,fn)=>handlers[type]=fn};
  const fetch=async input=>{const url=typeof input==='string'?input:input.url;requested.push(url);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;if(offline||url.endsWith(fail||'__never'))throw new Error('offline');return {ok:true,type:'basic',redirected:false,url,body:url};};
  vm.runInNewContext(source,{self,caches,fetch,URL,Set,Promise,Error});
  const lifecycle=type=>{let task;handlers[type]({waitUntil:p=>task=p});return task;};
  const request=(path,mode='cors',method='GET')=>{let response;handlers.fetch({request:{url:new URL(path,base).href,mode,method},respondWith:p=>response=p});return response;};
  return{stores,requested,lifecycle,request,handlers,setOffline:()=>offline=true,get peak(){return peak;},get skipped(){return skipped;}};
}

test('complete instrument dependency graph installs with bounded downloads',async()=>{
  const f=fixture();await f.lifecycle('install');assert.equal(f.stores.size,1);assert.equal(f.peak,4);assert.equal(f.skipped,0);
  const cache=[...f.stores.values()][0],paths=[...cache.keys()].map(url=>url.slice(base.length));
  assert.equal(paths.length,47);
  for(const path of paths){
    const file=new URL('../'+path,import.meta.url);await fs.access(file);
    if(!path.endsWith('.js'))continue;
    const text=await fs.readFile(file,'utf8');
    for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){
      const dependency=new URL(match[2],base+path).href;
      assert.ok(cache.has(dependency),`${path} missing offline dependency ${dependency}`);
    }
  }
});

test('failed installation removes only the incomplete cache',async()=>{
  const f=fixture({fail:'instruments/cellular.js'});f.stores.set('unrelated-app',new Map());f.stores.set('duo-ember-shell-old',new Map());
  await assert.rejects(f.lifecycle('install'),/unavailable/);
  assert.deepEqual([...f.stores.keys()],['unrelated-app','duo-ember-shell-old']);
});

test('offline navigation returns the matching shell and leaves other routes alone',async()=>{
  const f=fixture();await f.lifecycle('install');f.setOffline();
  assert.equal((await f.request('collection.html','navigate')).body,base+'collection.html');
  assert.equal((await f.request('index.html','navigate')).body,base+'index.html');
  assert.equal((await f.request('./','navigate')).body,base+'index.html');
  assert.equal((await f.request('instruments/granular.js')).body,base+'instruments/granular.js');
  for(const path of ['account','auth/callback','collection.html?token=private','https://other.test/app.js'])assert.equal(f.request(path,'navigate'),undefined);
  assert.equal(f.request('collection.html','cors','POST'),undefined);
});

test('offline fragment navigation resolves the instrument shell without widening query or account caching',async()=>{
  const f=fixture();await f.lifecycle('install');f.setOffline();
  for(const path of ['collection.html#carrier','collection.html#granular']){
    assert.equal((await f.request(path,'navigate')).body,base+'collection.html');
  }
  for(const path of ['index.html#signal','./#signal']){
    assert.equal((await f.request(path,'navigate')).body,base+'index.html');
  }
  assert.equal((await f.request('vendor/Tone.js#version')).body,base+'vendor/Tone.js');
  for(const path of ['collection.html?token=private#carrier','account#profile','auth/callback#token','https://other.test/index.html#signal']){
    assert.equal(f.request(path,'navigate'),undefined);
  }
});

test('activation preserves unrelated caches and waits for the idle update message',async()=>{
  const f=fixture();f.stores.set('unrelated-app',new Map());f.stores.set('duo-ember-shell-old',new Map());await f.lifecycle('install');
  f.handlers.message({data:{type:'OTHER'}});assert.equal(f.skipped,0);f.handlers.message({data:{type:'ACTIVATE_IDLE_UPDATE'}});assert.equal(f.skipped,1);
  await f.lifecycle('activate');assert.ok(f.stores.has('unrelated-app'));assert.ok(!f.stores.has('duo-ember-shell-old'));assert.equal(f.stores.size,2);
});
