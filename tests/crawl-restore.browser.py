#!/usr/bin/env python3
"""Keep saved edge-facing Crawl bodies inside the stage after import/resize.

The simulation is frozen so normal walking cannot conceal malformed restored
skeletons. The real import input and responsive host layout remain active.
"""
import asyncio
import functools
import json
import math
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'crawl-restore'
GEOMETRY=r'''() => {
 const w=__crawlRestoreWorld,points=w.creatures.flatMap(c=>[
  {id:c.id,kind:'head',...c},...c.segments.map(p=>({id:c.id,kind:'segment',...p})),
  ...c.legs.flatMap(l=>['hip','knee','foot'].map(key=>({id:c.id,kind:key,...l[key]}))),
  ...(c.reach?['base','knee','tip'].map(key=>({id:c.id,kind:'arm-'+key,...c.reach[key]})):[])
 ]),invalid=points.filter(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<-.01||p.y<-.01||p.x>w.panel.w+.01||p.y>w.panel.h+.01);
 return{size:[w.panel.w,w.panel.h],population:w.creatures.length,time:w.time,points:points.length,
  invalid:invalid.map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y})),controls:w.getData().controls};
}'''

class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*_args):pass

async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'cases':[]};errors=[]
 async with async_playwright()as playwright:
  browser=await playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
  context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block')
  async def route_host(route):
   await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__crawlRestoreHost',{get:()=>({state,controller,data:persisted()})});")
  async def route_world(route):
   await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/crawl-world.js').read_text()+"\nCrawlWorld.prototype.update=function(){window.__crawlRestoreWorld=this;return[];};")
  await context.route('**/collection.js',route_host);await context.route('**/instruments/crawl-world.js',route_world)
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(m.text)if m.type=='error'and 'favicon'not in m.text else None)
  try:
   await page.goto(base+'/collection.html#crawl');await page.wait_for_function('window.__crawlRestoreWorld&&window.__crawlRestoreHost?.controller')
   template=await page.evaluate('({...__crawlRestoreHost.data,format:"duo-instrument"})')
   template['sound']['population']=5;template['data']['controls']['v0-tone']=.27
   positions=[(.04,.10),(.96,.10),(.04,.95),(.96,.95),(.5,.5)]
   cases=[{'angle':i*math.pi/4,'positions':positions,'sizes':[(844,390),(390,844),(1366,1024)]}for i in range(8)]
   for x,y,angle in [(0.8827939976070569,0.1727535851868305,-3.2576251608912408),(.848986818447884,.15299480322956396,-9.771823324938795)]:
    cases.append({'angle':angle,'positions':[(x,y),*positions[1:]],'sizes':[(1308,900),(390,844),(844,390)]})
   for case,spec in enumerate(cases):
    payload=json.loads(json.dumps(template));payload['data']['seed']=7160+case
    payload['data']['creatures']=[{'id':f'crawl-{i}','x':x,'y':y,'angle':spec['angle']}for i,(x,y)in enumerate(spec['positions'])]
    for size_index,(width,height) in enumerate(spec['sizes']):
     await page.set_viewport_size({'width':width,'height':height})
     await page.wait_for_function('()=>{const b=document.querySelector("#stage canvas").getBoundingClientRect();return __crawlRestoreWorld.panel.w===b.width&&__crawlRestoreWorld.panel.h===b.height;}')
     # The first size exercises imported edge headings; later sizes first
     # validate resize of that imported body before importing again in-place.
     if size_index>0:
      geometry=await page.evaluate(GEOMETRY)
      assert not geometry['invalid'],{'case':case,'operation':'resize',**geometry}
     payload['data']['seed']+=10
     await page.locator('#import-look').set_input_files({'name':'crawl-edge.json','mimeType':'application/json','buffer':json.dumps(payload).encode()})
     await page.wait_for_function('seed=>__crawlRestoreWorld.seed===seed',arg=payload['data']['seed'])
     geometry=await page.evaluate(GEOMETRY)
     assert geometry['population']==5 and geometry['time']==0 and not geometry['invalid'],{'case':case,'operation':'import',**geometry}
     assert geometry['controls']==payload['data']['controls']
     report['cases'].append({'angle':spec['angle'],'viewport':[width,height],**{k:v for k,v in geometry.items()if k!='controls'}})
   assert not errors,errors
   report['passed']=True
  finally:
   report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'passed':report.get('passed',False),'cases':len(report['cases']),'errors':errors},indent=2))
   await context.close();await browser.close()

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),90))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
