#!/usr/bin/env python3
"""Isolated Crawl work-cost sampling on the production iPad render profile.

Run without other browser captures or benchmarks. Cloud Chromium timings are
diagnostic evidence, not a native Safari or M1 iPad frame-rate claim.
"""
import asyncio
import functools
import json
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'crawl-performance'
FRAME_START='frame(t,dt){if(destroyed||!gate.due(t*1000))return;'
FRAME_END='if(status!==lastStatus){api.setStatus(status);lastStatus=status;}'
SUMMARY=r'''() => {
 const data=window.__crawlTiming,stats=values=>{
  const sorted=values.toSorted((a,b)=>a-b),pick=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;
  return{count:sorted.length,median:pick(.5),p95:pick(.95),max:sorted.at(-1)??0};
 },intervals=data.frames.slice(1).map((frame,i)=>frame.at-data.frames[i].at),canvas=document.querySelector('#stage canvas');
 return{population:__crawlPerfHost.state.sound.population,frames:data.frames.length,
  elapsedMs:performance.now()-data.started,frameWorkMs:stats(data.frames.map(f=>f.cost)),
  simulationMs:stats(data.simulation),drawMs:stats(data.draw),renderIntervalMs:stats(intervals),
  observedRenderHz:intervals.length?1000*intervals.length/intervals.reduce((a,b)=>a+b,0):0,
  longTasks:window.__crawlLongTasks.filter(entry=>entry.startTime>=data.started),
  canvas:{width:canvas.width,height:canvas.height,pixels:canvas.width*canvas.height},
  cache:{width:__crawlCache.width,height:__crawlCache.height,pixels:__crawlCache.width*__crawlCache.height},
  playing:__crawlPerfHost.state.playing,audioRms:__crawlPerfHost.audio.snapshot().rms};
}'''

class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*_args):pass

async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'device':'Chromium with iPad detection inputs','samples':[]};errors=[]
 async with async_playwright()as playwright:
  browser=await playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
  context=await browser.new_context(viewport={'width':1366,'height':1024},device_scale_factor=2,has_touch=True,service_workers='block')
  await context.add_init_script("Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});window.__crawlLongTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())__crawlLongTasks.push({startTime:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});")
  async def route_host(route):
   await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__crawlPerfHost',{get:()=>({state,audio,controller})});")
  async def route_controller(route):
   source=(ROOT/'instruments/crawl.js').read_text();assert source.count(FRAME_START)==1 and source.count(FRAME_END)==1
   source=source.replace(FRAME_START,FRAME_START+'const __frameStart=performance.now();').replace(FRAME_END,FRAME_END+'if(window.__crawlTiming)window.__crawlTiming.frames.push({at:__frameStart,cost:performance.now()-__frameStart});')
   await route.fulfill(content_type='text/javascript',body=source)
  async def route_world(route):
   source=(ROOT/'instruments/crawl-world.js').read_text()+"\nconst __crawlUpdate=CrawlWorld.prototype.update;CrawlWorld.prototype.update=function(...args){const start=performance.now(),result=__crawlUpdate.apply(this,args);if(window.__crawlTiming)window.__crawlTiming.simulation.push(performance.now()-start);return result;};"
   await route.fulfill(content_type='text/javascript',body=source)
  async def route_renderer(route):
   source=(ROOT/'instruments/crawl-renderer.js').read_text()+"\nconst __crawlDraw=CrawlRenderer.prototype.draw;CrawlRenderer.prototype.draw=function(...args){const start=performance.now(),result=__crawlDraw.apply(this,args);window.__crawlCache=this.background;if(window.__crawlTiming)window.__crawlTiming.draw.push(performance.now()-start);return result;};"
   await route.fulfill(content_type='text/javascript',body=source)
  await context.route('**/collection.js',route_host);await context.route('**/instruments/crawl.js',route_controller)
  await context.route('**/instruments/crawl-world.js',route_world);await context.route('**/instruments/crawl-renderer.js',route_renderer)
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(m.text)if m.type=='error'and 'favicon'not in m.text else None)
  try:
   await page.goto(base+'/collection.html#crawl');await page.wait_for_function('window.__crawlPerfHost?.controller&&document.querySelector("#stage canvas")')
   report['profile']=await page.evaluate("async()=>{const m=await import('./render-performance.js');return m.signalRenderProfile();}")
   assert report['profile']['mobile'],report['profile']
   await page.locator('#play').click();await page.wait_for_function('__crawlPerfHost.audio.snapshot().rms>.0004')
   for population in [3,5]:
    if population!=3:
     await page.locator('#sound-toggle').click();await page.locator('[data-tabs=sound] [data-group="Behaviour"]').click()
     await page.locator('#sound-population').evaluate('(e,n)=>{e.value=n;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}',population)
     await page.locator('[data-close=sound-popover]').click()
    await page.wait_for_timeout(2000)
    await page.evaluate('window.__crawlTiming={started:performance.now(),frames:[],simulation:[],draw:[]}')
    await page.wait_for_timeout(8000)
    result=await page.evaluate(SUMMARY);await page.evaluate('window.__crawlTiming=null')
    assert result['population']==population and result['playing']and result['frames']>=100,result
    assert result['canvas']['pixels']<=1005000 and result['cache']['pixels']<=1005000,result
    report['samples'].append(result)
   assert not errors,errors
   report['passed']=True
  finally:
   report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
   await context.close();await browser.close()

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),75))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
