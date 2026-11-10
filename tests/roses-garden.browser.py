"""Split Roses console: actual audio, edits, memory persistence and compact layout."""
import asyncio,functools,importlib.util,json,shutil,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa/rose-garden'
spec=importlib.util.spec_from_file_location('roses_checks',ROOT/'tests/roses.browser.py');shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
class H(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={};errors=[]
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-webgl','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block')
  async def expose(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__rosesHost',{get:()=>({audio,state,controller,currentId})});")
  await context.route('**/collection.js',expose);page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(base+'/collection.html#roses');await page.wait_for_selector('.rg-flowers button');await page.wait_for_timeout(900)
  await page.evaluate(shared.CAPTURE);await page.locator('.rg-flowers button').nth(3).click();await page.wait_for_timeout(650)
  pcm=await page.evaluate('finishRosesCapture()');assert pcm['rms']>.0005 and pcm['peak']<1 and pcm['nonFinite']==0,pcm;assert not await page.evaluate('__rosesHost.state.playing');report['flowerButtonsAudibleBeforePlay']=pcm
  pad=await page.locator('.rg-pad').bounding_box();await page.mouse.move(pad['x']+pad['width']*.8,pad['y']+pad['height']*.25);await page.mouse.down();await page.wait_for_timeout(150)
  sound=await page.evaluate('__rosesHost.state.sound');assert .76<sound['roseGlass']<.84 and .7<sound['roseBody']<.8,sound
  assert await page.evaluate('__rosesHost.audio.sources.size')==1
  await page.mouse.up();await page.wait_for_function('__rosesHost.audio.sources.size===0');report['padAuditionsAndUpdatesVoice']=True
  await page.locator('.rg-sliders input[aria-label="LOW-PASS"]').evaluate('(e)=>{e.value=3200;e.dispatchEvent(new Event("input",{bubbles:true}))}')
  assert await page.evaluate('__rosesHost.state.sound.cutoff')==3200
  old=await page.evaluate('__rosesHost.controller.getData().pattern');await page.locator('.rg-seq button').first.click();changed=await page.evaluate('__rosesHost.controller.getData().pattern');assert changed[0]==old[0]+1
  await page.wait_for_timeout(450);await page.reload();await page.wait_for_selector('.rg-seq button');assert await page.evaluate('__rosesHost.controller.getData().pattern')==changed;report['sequenceAndSoundPersist']=True
  await page.evaluate(shared.CAPTURE);await page.locator('#play').click();await page.wait_for_timeout(1200);assert await page.locator('.rg-seq [data-current=true]').count()==1;pcm=await page.evaluate('finishRosesCapture()');assert pcm['rms']>.001;await page.locator('#play').click();report['memoryRunsWithAudiblePCM']=pcm
  sizes=[]
  for w,h in [(844,390),(1280,900),(390,844),(320,700)]:
   await page.set_viewport_size({'width':w,'height':h});await page.wait_for_timeout(200)
   fit=await page.evaluate("()=>{const p=document.querySelector('.rg-console'),r=p.getBoundingClientRect();return{scroll:p.scrollHeight,client:p.clientHeight,children:[...p.querySelectorAll('button,input,.rg-pad')].map(e=>{const b=e.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1&&b.top>=r.top&&b.bottom<=r.bottom+1})}}")
   assert fit['scroll']<=fit['client']+1 and all(fit['children']),(w,h,fit);sizes.append([w,h])
  report['compactLayouts']=sizes
  await page.goto(base+'/collection.html#crawl');await page.wait_for_function('__rosesHost.currentId==="crawl"');assert await page.evaluate('__rosesHost.audio.sources.size')==0
  assert not errors,errors;report['passed']=True;report['errors']=errors;(OUT/'console-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await browser.close()
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(H,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:asyncio.run(run(f'http://127.0.0.1:{s.server_port}'))
finally:s.shutdown();s.server_close()
