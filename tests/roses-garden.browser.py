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
  await page.goto(base+'/collection.html#roses');await page.wait_for_selector('[data-organ^="flower"]');await page.wait_for_timeout(900)
  await page.evaluate(shared.CAPTURE);await page.locator('[data-organ^="flower"]').nth(3).click();await page.wait_for_timeout(650)
  pcm=await page.evaluate('finishRosesCapture()');assert pcm['rms']>.0005 and pcm['peak']<1 and pcm['nonFinite']==0,pcm;assert not await page.evaluate('__rosesHost.state.playing');report['flowerButtonsAudibleBeforePlay']=pcm
  notes=[]
  for i in range(5):
   b=await page.locator(f'[data-organ="flower{i}"]').bounding_box();await page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2);await page.mouse.down();await page.wait_for_timeout(70);notes.append(await page.evaluate('[...__rosesHost.audio.sources.values()][0].midi'));await page.mouse.up()
  assert len(set(notes))==5 and max(notes)-min(notes)>=12,notes;report['fiveDistinctFlowerRegisters']=notes
  pad=await page.locator('[data-organ="mix"]').bounding_box();await page.mouse.move(pad['x']+pad['width']*.8,pad['y']+pad['height']*.25);await page.mouse.down();await page.wait_for_timeout(150)
  sound=await page.evaluate('__rosesHost.state.sound');assert .6<sound['roseGlass']<.8 and .6<sound['roseBody']<.8,sound
  assert await page.evaluate('__rosesHost.audio.sources.size')==1
  await page.mouse.up();await page.wait_for_function('__rosesHost.audio.sources.size===0');report['padAuditionsAndUpdatesVoice']=True
  assert await page.locator('.rg-console input[type=range]').count()==0
  await page.locator('[data-organ="filter"]').focus();before=await page.evaluate('__rosesHost.state.sound.cutoff');await page.keyboard.press('ArrowDown')
  assert await page.evaluate('__rosesHost.state.sound.cutoff')==before-500
  old=await page.evaluate('__rosesHost.controller.getData().pattern');await page.locator('[data-organ^="step"]').first.click();changed=await page.evaluate('__rosesHost.controller.getData().pattern');assert changed[0]==old[0]+1
  await page.wait_for_timeout(450);await page.reload();await page.wait_for_selector('[data-organ^="step"]');assert await page.evaluate('__rosesHost.controller.getData().pattern')==changed;report['sequenceAndSoundPersist']=True
  await page.evaluate(shared.CAPTURE);await page.locator('#play').click();await page.wait_for_timeout(1200);assert await page.locator('[data-current=true]').count()==1;pcm=await page.evaluate('finishRosesCapture()');assert pcm['rms']>.001;await page.locator('#play').click();report['memoryRunsWithAudiblePCM']=pcm
  sizes=[]
  for w,h in [(844,390),(1280,900),(390,844),(320,700)]:
   await page.set_viewport_size({'width':w,'height':h});await page.wait_for_timeout(200)
   fit=await page.evaluate("()=>{const p=document.querySelector('.rg-console'),r=p.getBoundingClientRect();return [...p.querySelectorAll('button')].map(e=>{const b=e.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1})}")
   assert all(fit),(w,h,fit);sizes.append([w,h])
  report['compactLayouts']=sizes
  await page.goto(base+'/collection.html#crawl');await page.wait_for_function('__rosesHost.currentId==="crawl"');assert await page.evaluate('__rosesHost.audio.sources.size')==0
  assert not errors,errors;report['passed']=True;report['errors']=errors;(OUT/'console-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await browser.close()
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(H,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:asyncio.run(run(f'http://127.0.0.1:{s.server_port}'))
finally:s.shutdown();s.server_close()
