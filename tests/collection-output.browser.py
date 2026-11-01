"""Record and decode real output from every collection route, then check pause cancellation.
Run: python3 tests/collection-output.browser.py (requires Python Playwright and Chromium).
This checks the master output, not physical device speakers.
"""
import asyncio,functools,json,os,shutil,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa/collection-output'
IDS=['carrier','cellular','census','swarm','graticule','waveform','geo','hand','structure','granular','terrain','phase-volume']
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox','--disable-webgl','--autoplay-policy=user-gesture-required','--disable-dev-shm-usage'])
  context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block')
  async def inspect(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__qa',{get:()=>({audio,state,controller,currentId,controls,definition,loadInstrument})});")
  await context.route('**/collection.js',inspect)
  page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));report={'instruments':[]}
  try:
   for id in IDS:
    if id==IDS[0]:await page.goto(base+'/collection.html#'+id)
    else:await page.evaluate('(id)=>location.hash=id',id)
    await page.wait_for_function("id=>window.__qa?.currentId===id&&!document.querySelector('#stage').hasAttribute('aria-busy')",arg=id)
    await page.locator('#play').click()
    await page.wait_for_function("__qa.audio.snapshot().rms>.0005",timeout=9000)
    value=await page.evaluate("""async()=>{
      const audio=__qa.audio,ctx=audio.context,dest=ctx.createMediaStreamDestination(),chunks=[];audio._master.connect(dest);
      const recorder=new MediaRecorder(dest.stream,{mimeType:'audio/webm;codecs=opus'});recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);
      recorder.start();await new Promise(resolve=>setTimeout(resolve,1200));recorder.stop();await done;const bytes=await new Blob(chunks).arrayBuffer(),length=bytes.byteLength,buffer=await ctx.decodeAudioData(bytes);let sum=0,peak=0,count=0;
      for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const v of buffer.getChannelData(ch)){sum+=v*v;peak=Math.max(peak,Math.abs(v));count++;}
      audio._master.disconnect(dest);dest.stream.getTracks().forEach(t=>t.stop());dest.disconnect();
      return {rms:Math.sqrt(sum/count),peak,bytes:length,context:ctx.state,tone:ctx===Tone.getContext().rawContext,voices:audio._voices.length};
    }""")
    value['id']=id;assert value['rms']>.0001 and value['peak']<1 and value['tone'],value
    await page.locator('#play').click();serial=await page.evaluate('__qa.audio._serial');await page.wait_for_timeout(2200)
    value['postPauseNewVoices']=await page.evaluate('__qa.audio._serial')-serial;assert value['postPauseNewVoices']==0,value
    report['instruments'].append(value);print(id,value,flush=True)
   report['errors']=errors;assert not errors,errors;report['passed']=True
  finally:
   (OUT/'audio-collection-report.json').write_text(json.dumps(report,indent=2));await browser.close()
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),180))
 finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()
