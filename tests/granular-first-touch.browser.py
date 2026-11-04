#!/usr/bin/env python3
"""Native first-touch regression for Past / Future's separate buffer engine.

Records decoded PCM, confirms quick end-only unlock produces a finite audition,
and proves cancelled/expired touches stay silent after later unlock. End-only
policy is explicitly simulated; this is not a native iOS assertion.
"""
import asyncio,functools,json,shutil,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'granular-first-touch'
CAPTURE=r'''window.capture=()=>{
 const ctx=__qa.audio.context;if(!ctx||window.recorder)return;
 window.captureTarget=ctx.createMediaStreamDestination();__qa.audio._master.connect(captureTarget);
 window.chunks=[];const mime=['audio/webm;codecs=opus','audio/mp4'].find(s=>MediaRecorder.isTypeSupported(s));
 window.recorder=new MediaRecorder(captureTarget.stream,mime?{mimeType:mime}:{});recorder.ondataavailable=e=>chunks.push(e.data);window.stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
};
const originalCreate=__qa.audio._createContext.bind(__qa.audio);__qa.audio._createContext=(...args)=>{originalCreate(...args);capture();};capture();
window.finish=async()=>{
 const ctx=__qa.audio.context,clock=ctx.createOscillator(),zero=ctx.createGain();zero.gain.value=0;clock.connect(zero);zero.connect(captureTarget);clock.start();await new Promise(r=>setTimeout(r,220));clock.stop();clock.disconnect();zero.disconnect();
 recorder.stop();await stopped;const buffer=await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());let sum=0,peak=0,n=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const s of buffer.getChannelData(ch)){sum+=s*s;peak=Math.max(peak,Math.abs(s));n++;}
 __qa.audio._master.disconnect(captureTarget);captureTarget.stream.getTracks().forEach(t=>t.stop());captureTarget.disconnect();return{rms:Math.sqrt(sum/n),peak,playing:__qa.state.playing,events:__cloud.events.map(e=>({id:e.id,contactId:e.contactId,pitch:e.pitch})),pool:__cloud.pool.size,serial:__cloud.serial};
};
window.originalStart=__qa.audio.start.bind(__qa.audio);window.allowStart=false;
__qa.audio.start=(...args)=>allowStart?originalStart(...args):Promise.resolve(false);
const prime=document.createElement('button');prime.id='qa-prime';prime.textContent='Unlock only';prime.style.cssText='position:fixed;top:0;left:0;z-index:9999';prime.addEventListener('click',()=>{allowStart=true;originalStart({completeGesture:true});});document.body.append(prime);
'''
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

async def run(base):
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required']);report={}
  try:
   for mode in ['fresh','ending-unlock','cancel','expiry']:
    context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block')
    async def host(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__qa',{get:()=>({audio,state,controller})});")
    async def module(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/granular.js').read_text().replace('const cloud=new GrainCloud(api.audio),contacts','const cloud=window.__cloud=new GrainCloud(api.audio),contacts'))
    await context.route('**/collection.js',host);await context.route('**/instruments/granular.js',module)
    page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(base+'/collection.html#granular');await page.wait_for_function('window.__cloud && __qa.controller');await page.evaluate(CAPTURE)
    if mode=='fresh':await page.evaluate('allowStart=true')
    if mode=='ending-unlock':await page.evaluate("window.addEventListener('touchend',()=>{allowStart=true;originalStart({completeGesture:true})},{capture:true,once:true})")
    box=await page.locator('#stage').bounding_box();cdp=await context.new_cdp_session(page);point={'id':1,'x':box['x']+box['width']*.5,'y':box['y']+box['height']*.36,'radiusX':4,'radiusY':4,'force':.6}
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]});await page.wait_for_timeout(25);await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel' if mode=='cancel' else 'touchEnd','touchPoints':[]})
    if mode in ['fresh','ending-unlock']:
     await page.wait_for_function('__qa.audio.snapshot().rms>.001',timeout=3000);await page.wait_for_timeout(650)
    else:
     await page.wait_for_timeout(220);await page.tap('#qa-prime');await page.wait_for_function('__qa.audio.context?.state===\'running\'');await page.wait_for_timeout(650)
    serial=await page.evaluate('__cloud.serial');value=await page.evaluate('finish()');value['errors']=errors;assert not errors and not value['playing'] and value['pool']==0 and serial==value['serial'],value
    if mode in ['fresh','ending-unlock']:assert value['rms']>.001 and value['peak']<1 and value['events'] and all(e['contactId'] is not None for e in value['events']),value
    else:assert value['rms']<.00001 and not value['events'] and value['serial']==0,value
    report[mode]=value;print(mode,value,flush=True);await context.close()
  finally:
   (OUT/'report.json').write_text(json.dumps(report,indent=2));await browser.close()

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),70))
 finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()
