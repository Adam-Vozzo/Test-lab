"""Actual rain-impact and growth audio, swapped layout, presets and lifecycle checks."""
import asyncio,functools,importlib.util,json,shutil,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa/rose-ecology'
spec=importlib.util.spec_from_file_location('roses_checks',ROOT/'tests/roses.browser.py');shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
class H(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={};errors=[]
 async with async_playwright()as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-webgl','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':1280,'height':900},has_touch=True,service_workers='block')
  async def expose(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__rosesHost',{get:()=>({audio,state,controller,currentId,setSound})});")
  await context.route('**/collection.js',expose);page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(base+'/collection.html#roses');await page.wait_for_selector('[data-organ="regrow"]');await page.wait_for_timeout(6500)
  pos=await page.evaluate("()=>{let a=document.querySelector('.rg-console').getBoundingClientRect(),b=document.querySelector('.rg-flower').getBoundingClientRect();return {controls:a.x,flower:b.x}}")
  assert pos['controls']<pos['flower'];report['controlsLeftFlowerRight']=pos
  await page.evaluate("()=>{window.events=[];const a=__rosesHost.audio,pulse=a.pulse.bind(a);a.pulse=(id,midi,options,when,duration)=>{events.push({id,midi,time:a.now,when});return pulse(id,midi,options,when,duration)}}")
  await page.evaluate(shared.CAPTURE);await page.locator('[data-organ="regrow"]').click();await page.wait_for_timeout(2400);await page.screenshot(path=str(OUT/'growth.png'));await page.wait_for_timeout(4000)
  growth=await page.evaluate("events.filter(e=>e.id.startsWith('roses-growth'))");assert len(growth)==11,growth;assert growth[-1]['time']-growth[0]['time']>4.5,growth;assert len(set(e['midi']for e in growth))>=8
  pcm=await page.evaluate('finishRosesCapture()');assert pcm['rms']>.0005 and pcm['peak']<1 and pcm['nonFinite']==0,pcm;report['growthMilestones']={'events':growth,'pcm':pcm}
  await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(300);await page.emulate_media(reduced_motion='reduce');await page.wait_for_timeout(300);assert await page.evaluate("events.filter(e=>e.id.startsWith('roses-growth')).length")==11
  await page.emulate_media(reduced_motion='no-preference');await page.set_viewport_size({'width':1280,'height':900})
  reactions={}
  for key,param in [('rain','rainDensity'),('echo','echo'),('filter','cutoff'),('decay','roseDecay')]:
   box=await page.locator(f'[data-organ="{key}"]').bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2;before=await page.evaluate(f'__rosesHost.state.sound.{param}')
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y-35,steps=8);await page.wait_for_timeout(180);assert await page.evaluate('__rosesHost.audio.sources.size')==1;await page.mouse.up()
   after=await page.evaluate(f'__rosesHost.state.sound.{param}');assert after>before,(key,before,after);reactions[key]=[before,after]
  report['directOrganGestures']=reactions
  await page.evaluate("__rosesHost.setSound({bedLevel:0,rainDensity:1,growthVoice:0})");await page.wait_for_timeout(2600);await page.evaluate('events=[]');await page.evaluate(shared.CAPTURE);await page.locator('#play').click();await page.wait_for_timeout(2200);await page.screenshot(path=str(OUT/'playing-desktop.png'));await page.wait_for_timeout(1000)
  rain=await page.evaluate("events.filter(e=>e.id.startsWith('roses-rain'))");assert len(rain)>=5,rain;assert all(abs(e['time']-e['when'])<.02 for e in rain),rain
  pcm=await page.evaluate('finishRosesCapture()');assert pcm['rms']>.001 and pcm['peak']<1 and pcm['nonFinite']==0,pcm;report['rainImpactNotes']={'count':len(rain),'pcm':pcm}
  await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(700);await page.screenshot(path=str(OUT/'playing-phone.png'))
  await page.locator('#play').click();n=await page.evaluate("events.filter(e=>e.id.startsWith('roses-rain')).length");await page.wait_for_timeout(1000);assert await page.evaluate("events.filter(e=>e.id.startsWith('roses-rain')).length")==n
  await page.evaluate("__rosesHost.setSound({rainDensity:0})");await page.locator('#play').click();await page.wait_for_timeout(1200);assert await page.evaluate("events.filter(e=>e.id.startsWith('roses-rain')).length")==n;await page.locator('#play').click();report['rainStopsAndZeroDensityMutes']=True
  await page.goto(base+'/collection.html#rotor');await page.wait_for_function('__rosesHost.currentId==="rotor"');assert await page.locator('.rose-garden').count()==0;assert await page.evaluate('__rosesHost.audio.sources.size')==0
  assert not errors,errors;report['errors']=errors;report['passed']=True;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await context.close();await browser.close()
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(H,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:asyncio.run(run(f'http://127.0.0.1:{s.server_port}'))
finally:s.shutdown();s.server_close()
