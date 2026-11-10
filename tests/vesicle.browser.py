#!/usr/bin/env python3
"""Actual WebGL + audio smoke checks for Vesicle, with a playable CPU fallback."""
import asyncio,functools,json,shutil,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa'/'vesicle'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':1280,'height':900},has_touch=True,service_workers='block');errors=[]
  async def host(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__vesicleHost',{get:()=>({audio,state,controller})});")
  async def module(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/vesicle.js').read_text().replace('const renderer=new VesicleRenderer','const renderer=window.__vesicleRenderer=new VesicleRenderer'))
  await context.route('**/collection.js',host);await context.route('**/instruments/vesicle.js',module)
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   await page.goto(base+'/collection.html#vesicle');await page.wait_for_function('window.__vesicleHost?.controller&&window.__vesicleRenderer')
   assert await page.evaluate('__vesicleRenderer.ready'),'Three.js scene must render in SwiftShader'
   await page.wait_for_timeout(1500);await page.screenshot(path=str(OUT/'desktop.png'))
   canvas=page.locator('canvas.instrument-canvas');box=await canvas.bounding_box();await page.mouse.move(box['x']+box['width']*.25,box['y']+box['height']*.46);await page.mouse.down();await page.wait_for_timeout(100)
   await page.wait_for_function('__vesicleHost.audio.snapshot().rms>.0005');rms=await page.evaluate('__vesicleHost.audio.snapshot().rms');assert not await page.evaluate('__vesicleHost.state.playing');await page.mouse.up();report['directTouchRms']=rms
   await page.wait_for_function('__vesicleHost.audio.sources.size===0');await page.locator('#play').click();await page.wait_for_timeout(1200);assert await page.evaluate('__vesicleHost.audio.snapshot().rms')>.0001
   await page.screenshot(path=str(OUT/'playing.png'));await page.locator('#play').click();await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(500);await page.screenshot(path=str(OUT/'phone.png'))
   # A touch on the right field produces a separate physical source.
   box=await canvas.bounding_box();await page.mouse.move(box['x']+box['width']*.74,box['y']+box['height']*.34);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.sources.size===1');await page.mouse.move(box['x']+box['width']*.88,box['y']+box['height']*.44);await page.mouse.up();await page.wait_for_function('__vesicleHost.audio.sources.size===0');report['rightField']=True
   await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(400);await page.screenshot(path=str(OUT/'portrait.png'))
   data=await page.evaluate('__vesicleHost.controller.getData()');await page.evaluate('d=>__vesicleHost.controller.setData(d)',data);assert await page.evaluate('__vesicleHost.controller.getData()')==data
   await page.goto(base+'/collection.html#crawl');await page.wait_for_function('document.querySelector("#stage").dataset.instrument==="crawl"');report['switchCleanup']=True
   await page.add_init_script("const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:get.call(this,kind,...args)};")
   await page.goto(base+'/collection.html#vesicle');await page.reload();await page.wait_for_function('window.__vesicleRenderer&&window.__vesicleHost?.controller');assert not await page.evaluate('__vesicleRenderer.ready')
   box=await page.locator('canvas.instrument-canvas').bounding_box();await page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.23);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.snapshot().rms>.0005');await page.mouse.up();report['playableWithoutWebGL']=True
   assert not errors,errors;report['passed']=True
  finally:report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));await context.close();await browser.close()
def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(run(f'http://127.0.0.1:{server.server_port}'))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
