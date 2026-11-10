#!/usr/bin/env python3
"""Crawl production-host regression: physical control operation and real audio.

Trusted Chromium touch drives guidance. Test-only module routing exposes the
existing world and records its contact events; no production debug API is added.
These checks use browser device emulation, not native iOS measurements.
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
OUT=ROOT/'qa'/'crawl-functional'
CAPTURE=r'''() => {
 const audio=__crawlHost.audio;if(!audio.context)audio._createContext();
 const ctx=audio.context,destination=ctx.createMediaStreamDestination();audio._master.connect(destination);
 const mime=['audio/webm;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
 const recorder=new MediaRecorder(destination.stream,mime?{mimeType:mime}:{}),chunks=[];
 recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
 window.finishCrawlCapture=async()=>{
  recorder.stop();await stopped;const bytes=await new Blob(chunks).arrayBuffer(),buffer=await ctx.decodeAudioData(bytes);
  let power=0,peak=0,count=0,nonFinite=0;const windows=[];
  for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const sample of buffer.getChannelData(ch)){if(!Number.isFinite(sample)){nonFinite++;continue;}power+=sample*sample;peak=Math.max(peak,Math.abs(sample));count++;}
  const data=buffer.getChannelData(0),size=Math.round(buffer.sampleRate*.1);for(let start=0;start<data.length;start+=size){let energy=0;const end=Math.min(data.length,start+size);for(let n=start;n<end;n++)energy+=data[n]*data[n];windows.push(Math.sqrt(energy/Math.max(1,end-start)));}
  audio._master.disconnect(destination);destination.stream.getTracks().forEach(track=>track.stop());destination.disconnect();
  return{rms:Math.sqrt(power/Math.max(1,count)),peak,nonFinite,duration:buffer.duration,bytes:bytes.byteLength,windows};
 };
}'''

WORLD_INSTRUMENTATION=r'''
const __originalCrawlUpdate=CrawlWorld.prototype.update;
CrawlWorld.prototype.update=function(dt,settings){
 window.__crawlWorld=this;
 if(window.__freezeCrawl)return[];
 const before=new Map((this.panel?.controls||[]).map(c=>[c.id,c.value]));
 const actions=__originalCrawlUpdate.call(this,dt,settings)||[];
 window.__crawlActions ||= [];window.__crawlMutationViolations ||= [];
 for(const action of actions){const creature=this.creatures.find(c=>c.id===action.creatureId),control=this.panel.controls.find(c=>c.id===action.controlId),tip=creature?.reach?.tip,endpoint=control?crawlActuatorPoint(control,this.panel.unit,this.time):null;window.__crawlActions.push({...action,tip:tip?{...tip}:null,control:control?{...endpoint,value:control.value}:null,creatureState:creature?.state});}
 if(window.__crawlActions.length>1000)window.__crawlActions.splice(0,window.__crawlActions.length-1000);
 for(const c of this.panel?.controls||[]){if(before.has(c.id)&&before.get(c.id)!==c.value&&!actions.some(a=>a.controlId===c.id))window.__crawlMutationViolations.push({id:c.id,before:before.get(c.id),value:c.value,time:this.time});}
 return actions;
};
'''

class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*_args):pass

async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'device':'Chromium touch emulation','checks':{}}
 async with async_playwright()as playwright:
  browser=await playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':1280,'height':900},device_scale_factor=2,has_touch=True,service_workers='block')
  await context.add_init_script("Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});")
  async def expose_host(route):
   source=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__crawlHost',{get:()=>({audio,state,controller,currentId,definition,controls})});"
   await route.fulfill(content_type='text/javascript',body=source)
  async def expose_world(route):
   await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/crawl-world.js').read_text()+WORLD_INSTRUMENTATION)
  async def expose_renderer(route):
   source=(ROOT/'instruments/crawl-renderer.js').read_text()+"\nconst __originalCrawlDraw=CrawlRenderer.prototype.draw;CrawlRenderer.prototype.draw=function(...args){window.__crawlRenderer=this;return __originalCrawlDraw.apply(this,args);};"
   await route.fulfill(content_type='text/javascript',body=source)
  await context.route('**/collection.js',expose_host);await context.route('**/instruments/crawl-world.js',expose_world)
  await context.route('**/instruments/crawl-renderer.js',expose_renderer)
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(m.text) if m.type=='error' and 'favicon' not in m.text else None)
  cdp=await context.new_cdp_session(page);contacts={}
  async def loaded(instrument='crawl'):
   await page.wait_for_function("id=>window.__crawlHost?.currentId===id&&__crawlHost.controller&&!document.querySelector('#stage').hasAttribute('aria-busy')",arg=instrument)
  async def control_point(key='tone',lane=0):
   return await page.evaluate("([key,lane])=>{const b=document.querySelector('#stage canvas').getBoundingClientRect(),c=__crawlWorld.panel.controls.find(c=>c.key===key&&c.lane===lane);if(!c)throw Error('Missing control '+key);return{x:b.x+c.cx,y:b.y+c.cy,id:c.id};}",[key,lane])
  async def touch(kind,id=1,position=None):
   ended=None
   if kind in ('touchStart','touchMove'):contacts[id]={'id':id,'x':position['x'],'y':position['y'],'radiusX':4,'radiusY':4,'force':.7}
   else:ended=contacts.pop(id,None)
   if kind=='touchCancel':contacts.clear()
   points=[ended]if kind=='touchEnd'and contacts and ended else list(contacts.values())
   await cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
  async def sources():return await page.evaluate("[...__crawlHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,physical:s.physical,options:s.options}))")
  async def values():return await page.evaluate("Object.fromEntries(__crawlWorld.panel.controls.map(c=>[c.id,c.value]))")
  async def count(n):await page.wait_for_function('n=>__crawlHost.audio.sources.size===n',arg=n)
  async def slider(kind,key,value):
   descriptor=await page.evaluate("([kind,key])=>__crawlHost.controls[kind].find(c=>c.key===key)",[kind,key]);assert descriptor,(kind,key)
   panel='#sound-popover'if kind=='sound'else'#appearance'
   if await page.locator(panel).is_hidden():await page.locator(f'#{kind}-toggle').click()
   await page.locator(f'[data-tabs={kind}] [data-group="{descriptor["section"]}"]').click()
   await page.locator(f'#{kind}-{key}').evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}",value)
  async def close_panels():
   for panel in ['sound-popover','appearance']:
    if await page.locator('#'+panel).is_visible():await page.locator(f'[data-close={panel}]').click()
  def audible(pcm):assert pcm['rms']>.0004 and pcm['peak']<1 and pcm['nonFinite']==0,pcm
  try:
   await page.goto(base+'/collection.html#crawl');await loaded();await page.wait_for_function('window.__crawlWorld?.panel.controls.length===56')
   assert not await page.evaluate('__crawlHost.state.playing')
   assert await page.locator('#arp').is_hidden()and await page.locator('#hold').is_hidden()
   report['checks']['newInstrumentAndCreatureOnlyPanel']=True
   # Freeze only the simulation clock to isolate input handling from naturally
   # concurrent creature actions. A finger is allowed to move a guide, not a dial.
   await page.evaluate('window.__freezeCrawl=true');before=await values()
   await page.evaluate(CAPTURE)
   await touch('touchStart',position=await control_point('tone',0))
   await page.wait_for_function('__crawlHost.audio.sources.size>0')
   await page.wait_for_function('__crawlHost.audio.snapshot().rms>.0004',timeout=5000)
   first=await sources();await page.wait_for_timeout(250)
   await touch('touchMove',position=await control_point('pitch',1));await page.wait_for_timeout(160)
   assert await values()==before,'Guiding directly changed a panel control'
   assert not await page.evaluate('__crawlHost.state.playing')
   await touch('touchEnd');await count(0);await page.wait_for_timeout(180)
   pcm=await page.evaluate('finishCrawlCapture()');audible(pcm)
   report['checks']['trustedGuideProducesAudioBeforePlay']={**pcm,'sources':first}
   report['checks']['touchAndDragCannotDirectlyChangeControls']=True
   await page.evaluate('window.__freezeCrawl=false')
   await page.evaluate('window.__freezeCrawl=true')
   await touch('touchStart',id=11,position=await control_point('decay',0));await page.wait_for_timeout(50)
   assert await page.evaluate('__crawlWorld.guides.size')==1
   await touch('touchEnd',id=11);await count(0)
   assert await page.evaluate('__crawlWorld.guides.size')==0
   report['checks']['wanderGuideReleasesOnLift']=True
   await page.locator('.crawl-mode [data-mode="guide"]').click()
   await touch('touchStart',id=12,position=await control_point('tone',2));await touch('touchEnd',id=12);await count(0)
   assert await page.evaluate('__crawlWorld.guides.size')==1
   await page.locator('.crawl-mode [data-mode="wander"]').click()
   assert await page.evaluate('__crawlWorld.guides.size')==0
   report['checks']['guideModeKeepsDestinationUntilWander']=True
   await touch('touchStart',id=13,position=await control_point('pitch',0))
   await touch('touchStart',id=14,position=await control_point('pitch',3));await count(2)
   pair=await sources();assert len({source['id']for source in pair})==2
   await touch('touchEnd',id=13);await count(1)
   assert (await sources())[0]['id']in [source['id']for source in pair]
   await touch('touchCancel',id=14);await count(0)
   assert await page.evaluate('__crawlWorld.guides.size')==0
   report['checks']['independentGuidesAndPointerCancel']=True
   await page.locator('#stage canvas').focus();await page.keyboard.press('g')
   assert await page.evaluate('__crawlHost.controller.getData().mode')=='guide'
   keyboard_values=await values();await page.keyboard.down('ArrowRight');await count(1)
   assert (await sources())[0]['id']=='crawl-touch-keyboard'
   await page.keyboard.up('ArrowRight');await count(0)
   assert await values()==keyboard_values
   await page.keyboard.press('w');assert await page.evaluate('__crawlWorld.guides.size')==0
   report['checks']['keyboardGuidanceUsesSameIndirectControlPath']=True
   await page.keyboard.down('ArrowLeft');await count(1)
   await page.locator('.crawl-mode [data-mode="wander"]').focus();await count(0)
   await page.keyboard.up('ArrowLeft')
   assert await page.evaluate('__crawlWorld.guides.size')==0
   report['checks']['keyboardFocusTransferReleasesAudition']=True
   # Real simulation actions must coincide with a reaching fingertip and be the
   # only path by which the visible panel changes during normal playback.
   await page.evaluate('window.__freezeCrawl=false;window.__crawlActions=[];window.__crawlMutationViolations=[]')
   await slider('sound','speed',1);await slider('sound','activity',1);await close_panels()
   await page.wait_for_function('window.__crawlActions.length>=3',timeout=30000)
   actions=await page.evaluate('__crawlActions')
   assert await page.evaluate('__crawlMutationViolations')==[]
   assert all(0<=action['value']<=1 and action['value']!=action['oldValue']for action in actions),actions
   assert len({(action['creatureId'],action['controlId'],action['time'])for action in actions})==len(actions)
   contact_errors=[((a['tip']['x']-a['control']['x'])**2+(a['tip']['y']-a['control']['y'])**2)**.5 for a in actions if a['tip']and a['control']]
   assert len(contact_errors)==len(actions)and max(contact_errors)<1.0,actions
   report['checks']['panelMutationsRequirePhysicalCreatureContact']={'actions':len(actions),'maxContactError':max(contact_errors),'keys':sorted({a['key']for a in actions})}
   # Log actual scheduled notes without replacing the real audio method.
   await page.evaluate("""()=>{const audio=__crawlHost.audio,pulse=audio.pulse;window.__crawlPulseTrace=[];audio.pulse=function(id,midi,options,when,duration){__crawlPulseTrace.push({id,midi,options:{...options},when,duration,worldTime:__crawlWorld.time,actions:__crawlActions.length});return pulse.call(this,id,midi,options,when,duration);};}""")
   await page.evaluate(CAPTURE);await page.locator('#play').click()
   await page.wait_for_function('__crawlHost.audio.snapshot().voices.some(v=>v.kind==="sequence")')
   await page.wait_for_timeout(4200)
   sequence=await page.evaluate('finishCrawlCapture()');audible(sequence)
   trace=await page.evaluate('__crawlPulseTrace');assert len(trace)>=6,trace
   assert len({note['midi']for note in trace})>=2,trace
   assert len({note['options']['waveform']for note in trace})>=2,trace
   assert all(note['duration']>0 for note in trace)
   await page.locator('#play').click();serial=await page.evaluate('__crawlHost.audio._serial');await page.wait_for_timeout(700)
   assert await page.evaluate('__crawlHost.audio._serial')==serial
   await count(0)
   report['checks']['autonomousSequenceHasRealMultivoiceAudio']={**sequence,'scheduledNotes':len(trace),'notes':sorted({note['midi']for note in trace}),'waveforms':sorted({note['options']['waveform']for note in trace})}
   report['checks']['pauseStopsFutureNotes']=True
   # At least one creature changes the patch while a real guide note is held.
   await page.evaluate('()=>{window.__crawlActions=[];window.__crawlUpdates=[];const a=__crawlHost.audio,u=a.noteUpdate;a.noteUpdate=function(id,midi,options){__crawlUpdates.push({id,midi,options:{...options},actions:__crawlActions.length});return u.call(this,id,midi,options);};}')
   await touch('touchStart',id=21,position=await control_point('tone',0));await count(1)
   await page.wait_for_function('__crawlActions.length>0&&__crawlUpdates.some(x=>x.actions>0)',timeout=30000)
   updates=await page.evaluate('__crawlUpdates');assert updates,updates
   assert (await sources())[0]['id']==updates[-1]['id']
   await touch('touchEnd',id=21);await count(0)
   report['checks']['physicalActuationUpdatesHeldVoice']={'actions':await page.evaluate('__crawlActions.length'),'updates':len(updates)}
   # Freeze world time while comparing serialization. Resize may relayout the
   # board, but control identities and values must remain stable.
   await page.evaluate('window.__freezeCrawl=true')
   preserved=await values();sizes=[]
   for width,height in [(844,390),(390,844),(1366,1024)]:
    await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(180)
    assert await values()==preserved
    geometry=await page.evaluate("""()=>{const w=__crawlWorld,b=document.querySelector('#stage').getBoundingClientRect(),canvas=document.querySelector('#stage canvas'),cache=__crawlRenderer.background,footer=document.querySelector('.bottom-bar').getBoundingClientRect(),points=w.creatures.flatMap(c=>[c,...c.segments,...c.legs.flatMap(l=>[l.hip,l.knee,l.foot])]);return{canvasPixels:canvas.width*canvas.height,cachePixels:cache.width*cache.height,css:[b.width,b.height],controlsInside:w.panel.controls.every(c=>c.cx>=0&&c.cy>=0&&c.cx<=b.width&&c.cy<=b.height),finite:points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),scroll:document.documentElement.scrollWidth,stageBottom:b.bottom,footerTop:footer.top};}""")
    assert geometry['canvasPixels']<=1005000 and geometry['cachePixels']<=1005000 and geometry['controlsInside']and geometry['finite'],geometry
    assert geometry['scroll']<=width+1 and geometry['stageBottom']<=geometry['footerTop']+1,geometry
    sizes.append({'size':[width,height],**geometry})
   report['checks']['responsivePanelAndIKStayFiniteWithinMobileBudget']=sizes
   await page.locator('.crawl-mode [data-mode="guide"]').click();await page.wait_for_timeout(260)
   expected=await page.evaluate('__crawlHost.controller.getData()')
   await page.locator('#appearance-toggle').click()
   async with page.expect_download()as download_info:await page.locator('#export-look').click()
   download=await download_info.value;download_path=await download.path();export=json.loads(Path(download_path).read_text())
   assert export['instrument']=='crawl'and export['format']=='duo-instrument'and export['data']==expected
   await close_panels()
   await page.locator('.crawl-mode [data-mode="wander"]').click()
   await page.locator('#import-look').set_input_files({'name':'crawl-roundtrip.json','mimeType':'application/json','buffer':json.dumps(export).encode()})
   await page.wait_for_timeout(200)
   assert await values()==preserved
   assert await page.evaluate('__crawlHost.controller.getData().mode')==expected['mode']
   report['checks']['realExportImportRestoresPatchAndGuidanceMode']=True
   await page.wait_for_timeout(300)
   stored=await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.crawl.v1'))")
   await page.reload();await loaded();await page.wait_for_function('window.__crawlWorld?.panel.controls.length===56')
   assert await values()==preserved
   assert await page.evaluate('__crawlHost.state.appearance')==stored['appearance']
   assert await page.evaluate('__crawlHost.controller.getData().mode')==stored['data']['mode']
   report['checks']['reloadPreservesDesignerState']=True
   await page.locator('.crawl-mode [data-mode="wander"]').click()
   await touch('touchStart',id=31,position=await control_point('tone',0));await page.wait_for_function('__crawlHost.audio.sources.size>0')
   await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));")
   await touch('touchCancel',id=31);await count(0)
   assert not await page.evaluate('__crawlHost.state.playing')
   assert await page.evaluate('__crawlWorld.guides.size')==0
   report['checks']['backgroundClearsGuidesAndNotes']=True
   await page.evaluate('window.__oldWorld=__crawlWorld;window.__oldTime=__crawlWorld.time;location.hash="roses"');await loaded('roses');await count(0)
   await page.evaluate('window.__oldTime=__oldWorld.time');await page.wait_for_timeout(200)
   assert await page.evaluate('__oldWorld.time===__oldTime')
   await page.evaluate('location.hash="crawl"');await loaded();await page.wait_for_function('__crawlWorld!==__oldWorld')
   assert await page.locator('#stage canvas').count()==1
   report['checks']['switchingDestroysOldSimulationAndVoices']=True
   await page.screenshot(path=str(OUT/'final-landscape.png'),scale='css')
   assert not errors,errors
   report['passed']=True
  finally:
   report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'passed':report.get('passed',False),'checks':list(report['checks']),'errors':errors},indent=2))
   await context.close();await browser.close()

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),180))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
