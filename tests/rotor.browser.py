#!/usr/bin/env python3
"""Production Rotor touch/audio/layout and saved-memory smoke checks."""
import asyncio, functools, importlib.util, json, shutil, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa'/'rotor'
spec=importlib.util.spec_from_file_location('crawl_checks',ROOT/'tests/crawl.browser.py');shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
CAPTURE=shared.CAPTURE.replace('__crawlHost','__rotorHost').replace('finishCrawlCapture','finishRotorCapture')
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={};errors=[]
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':1280,'height':900},has_touch=True,service_workers='block')
  async def host(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__rotorHost',{get:()=>({audio,state,controller,currentId})});")
  async def catalog(route):
   s=(ROOT/'instruments/catalog.js').read_text()
   if "id:'rotor'"not in s:s=s.replace('export const INSTRUMENTS=[',"export const INSTRUMENTS=[{id:'rotor',name:'Rotor',colors:['#ffab25','#4ce9e3'],load:()=>import('./rotor.js')},")
   await route.fulfill(content_type='text/javascript',body=s)
  await context.route('**/collection.js',host);await context.route('**/instruments/catalog.js',catalog)
  page=await context.new_page();cdp=await context.new_cdp_session(page);page.on('pageerror',lambda e:errors.append(str(e)))
  async def layout():return await page.evaluate("async()=>{const r=document.querySelector('#stage canvas').getBoundingClientRect(),m=await import('./instruments/rotor.js');return{...m.rotorLayout(r.width,r.height,__rotorHost.state.appearance),offset:{x:r.x,y:r.y},phase:__rotorHost.controller.getData().phase}}")
  async def touch(kind,points):await cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'id':i+1,'x':q['x'],'y':q['y'],'radiusX':4,'radiusY':4,'force':.7}for i,q in enumerate(points)]})
  await page.goto(base+'/collection.html#rotor');await page.wait_for_function("window.__rotorHost?.currentId==='rotor'&&__rotorHost.controller")
  await page.wait_for_timeout(500);l=await layout();d=l['pitch'];point={'x':l['offset']['x']+d['x'],'y':l['offset']['y']+d['y']-d['r']*.9}
  await page.evaluate(CAPTURE);await touch('touchStart',[point]);await page.wait_for_timeout(650);before=await page.evaluate('__rotorHost.controller.getData().phase');await page.wait_for_timeout(400);after=await page.evaluate('__rotorHost.controller.getData().phase');assert before==after
  assert not await page.evaluate('__rotorHost.state.playing');assert await page.evaluate('__rotorHost.audio.sources.size')==1
  await touch('touchEnd',[]);pcm=await page.evaluate('finishRotorCapture()');assert pcm['rms']>.001 and pcm['peak']<1,pcm;report['directTouchPCM']=pcm
  d=l['spectrum'];point={'x':l['offset']['x']+d['x']+d['r']*.45,'y':l['offset']['y']+d['y']-d['r']*.4}
  await touch('touchStart',[point]);await page.wait_for_timeout(200);sound=await page.evaluate('__rotorHost.state.sound');assert sound['cutoff']>4000 and sound['index']>2,sound;await touch('touchEnd',[]);report['timbreXY']=True
  await page.evaluate(CAPTURE);await page.locator('#play').click();await page.wait_for_timeout(1700);pcm=await page.evaluate('finishRotorCapture()');assert pcm['rms']>.001 and pcm['peak']<1;report['sequencePCM']=pcm
  await page.screenshot(path=str(OUT/'desktop-playing.png'));await page.locator('#play').click()
  await page.emulate_media(reduced_motion='reduce');await page.wait_for_timeout(100);frozen=await page.evaluate('__rotorHost.controller.getData()');await page.wait_for_timeout(250);still=await page.evaluate('__rotorHost.controller.getData()');assert frozen['phase']==still['phase'] and frozen['meshPhase']==still['meshPhase'];report['reducedMotionStopsRotationAndMesh']=True;await page.emulate_media(reduced_motion='no-preference')
  l=await layout();r=l['left'];point={'x':l['offset']['x']+r['x']+8+(r['w']-16)/32,'y':l['offset']['y']+r['y']+r['h']-18}
  await page.touchscreen.tap(point['x'],point['y']);assert await page.evaluate('__rotorHost.controller.getData().muted[0]')
  await page.wait_for_timeout(500);await page.reload();await page.wait_for_function("__rotorHost?.currentId==='rotor'&&__rotorHost.controller");assert await page.evaluate('__rotorHost.controller.getData().muted[0]');report['memoryPersists']=True
  for name,width,height in [('phone',844,390),('portrait',390,844)]:
   await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(300);l=await layout();assert l['pitch']['r']>20 and l['spectrum']['r']>20;await page.screenshot(path=str(OUT/(name+'.png')))
  await page.goto(base+'/collection.html#crawl');await page.wait_for_function("__rotorHost.currentId==='crawl'");assert await page.evaluate('__rotorHost.audio.sources.size')==0;report['cleanup']=True
  assert not errors,errors;report['passed']=True;report['errors']=errors
  (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await browser.close()
def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(run(f'http://127.0.0.1:{server.server_port}'))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
