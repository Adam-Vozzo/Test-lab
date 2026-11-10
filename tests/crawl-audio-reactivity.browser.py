#!/usr/bin/env python3
"""Real audio drives Crawl appearance without altering synthesis or IK.

Trusted browser touch and the actual sequencer generate PCM. Renderer comparisons
reuse measured response envelopes with fixed poses, isolating sound-driven colour
and deformation from normal locomotion. This is not native iOS hardware testing.
"""
import asyncio
import base64
import functools
import importlib.util
import json
import shutil
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'crawl-audio-reactivity'
spec=importlib.util.spec_from_file_location('crawl_browser_checks',ROOT/'tests'/'crawl.browser.py')
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
CAPTURE=shared.CAPTURE

WORLD=r'''
const __audioWorldUpdate=CrawlWorld.prototype.update;
CrawlWorld.prototype.update=function(...args){
 window.__crawlWorld=this;if(window.__freezeCrawl)return[];
 const before=this.creatures.map(c=>c.legs.map(l=>({planted:l.planted,x:l.foot.x,y:l.foot.y})));
 const actions=__audioWorldUpdate.apply(this,args),violations=window.__crawlIKViolations ||= [],distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 for(const [ci,c]of this.creatures.entries())for(const [li,l]of c.legs.entries()){
  const old=before[ci]?.[li];if(old?.planted&&l.planted&&distance(old,l.foot)>1e-6)violations.push('planted foot moved');
  if(Math.abs(distance(l.hip,l.knee)-l.upper)>1e-5||Math.abs(distance(l.knee,l.foot)-l.lower)>1e-5)violations.push('leg length changed');
 }
 for(const action of actions){const c=this.creatures.find(c=>c.id===action.creatureId),q=this.controls.find(q=>q.id===action.controlId),error=distance(c.reach.tip,crawlActuatorPoint(q,this.panel.unit,this.time));(window.__crawlAudioContacts ||= []).push(error);}
 return actions;
};
'''
RENDERER=r'''
const __audioDraw=CrawlRenderer.prototype.draw;
CrawlRenderer.prototype.draw=function(c,world,appearance,snapshot,meta){
 const result=__audioDraw.call(this,c,world,appearance,snapshot,meta);window.__crawlRenderer=this;
 const response=world.creatures.map(c=>({kind:c.kind,...c.audio,segments:[...(c.audio?.segments||[])]}));
 window.__crawlLiveFrame={rms:snapshot.rms,time:world.time,response};
 if(window.__recordCrawlAudio)(window.__crawlAudioTrace ||= []).push(window.__crawlLiveFrame);
 return result;
};
'''
PIXELS=r'''response => {
 const source=__crawlWorld,world={...source,panel:{...source.panel,controls:source.panel.controls.map(q=>({...q,changedAt:-Infinity}))},guides:new Map(),time:10};
 const canvas=document.createElement('canvas');canvas.width=Math.round(world.panel.w);canvas.height=Math.round(world.panel.h);
 const context=canvas.getContext('2d'),renderer=new __crawlRenderer.constructor(),appearance={...__crawlHost.state.appearance,colourFlow:0,audioMotion:0,audioColour:0,audioGlow:0};
 const render=(active,amounts,reducedMotion=false)=>{
  world.creatures=source.creatures.map((c,i)=>({...c,state:'wander',reach:null,targetId:null,pulse:0,audio:active?response[i]:{level:0,bass:0,mid:0,treble:0,attack:0,segments:response[i].segments.map(()=>0)}}));
  renderer.draw(context,world,{...appearance,...amounts},{},{playing:false,reducedMotion,time:10});return context.getImageData(0,0,canvas.width,canvas.height).data;
 };
 const difference=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])n++;return n;};
 const disabled=difference(render(false,{}),render(true,{}));
 const colour=difference(render(false,{audioColour:1}),render(true,{audioColour:1}));
 const motion=difference(render(false,{audioMotion:1}),render(true,{audioMotion:1}));
 const reducedMotion=difference(render(false,{audioMotion:1},true),render(true,{audioMotion:1},true));
 const reducedColour=difference(render(false,{audioColour:1},true),render(true,{audioColour:1},true));
 const live=__crawlHost.state.appearance,amounts={audioMotion:live.audioMotion,audioColour:live.audioColour,audioGlow:live.audioGlow};
 render(false,amounts);const silentImage=canvas.toDataURL();render(true,amounts);const measuredImage=canvas.toDataURL();
 const brightPaletteViolations=[];
 for(const anchor of['#ffffff','#f7efe7'])for(const [active,audioColour]of[[false,0],[false,1],[true,0]]){
  const a=renderer.palette({...appearance,creatureLime:anchor,creatureViolet:anchor,creatureCoral:anchor,creatureTeal:anchor,chroma:0,audioColour});
  for(const [i,c]of source.creatures.entries()){
   const audio=active?response[i]:{level:0,bass:0,mid:0,treble:0,attack:0,segments:response[i].segments.map(()=>0)},ink=renderer.inkAt({...c,audio},a,.42,1,10);
   if(ink.primary.toLowerCase()!==anchor||ink.secondary.toLowerCase()!==anchor)brightPaletteViolations.push({anchor,active,audioColour,kind:c.kind,primary:ink.primary,secondary:ink.secondary});
  }
 }
 renderer.dispose();return{disabled,colour,motion,reducedMotion,reducedColour,brightPaletteViolations,silentImage,measuredImage};
}'''

class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*_args):pass

async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'checks':{}};errors=[]
 async with async_playwright()as playwright:
  browser=await playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':1280,'height':900},has_touch=True,service_workers='block')
  async def route_host(route):
   await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__crawlHost',{get:()=>({audio,state,controller,controls})});")
  async def route_world(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/crawl-world.js').read_text()+WORLD)
  async def route_renderer(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/crawl-renderer.js').read_text()+RENDERER)
  await context.route('**/collection.js',route_host);await context.route('**/instruments/crawl-world.js',route_world);await context.route('**/instruments/crawl-renderer.js',route_renderer)
  page=await context.new_page();cdp=await context.new_cdp_session(page)
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text)if m.type=='error'and 'favicon'not in m.text else None)
  async def slider(kind,key,value):
   group=await page.evaluate('([kind,key])=>__crawlHost.controls[kind].find(c=>c.key===key).section',[kind,key]);panel='appearance'if kind=='appearance'else'sound-popover'
   if await page.locator('#'+panel).is_hidden():await page.locator('#'+kind+'-toggle').click()
   await page.locator(f'[data-tabs={kind}] [data-group="{group}"]').click()
   await page.locator(f'#{kind}-{key}').evaluate('(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}',value)
  async def close_panels():
   for panel in ['appearance','sound-popover']:
    if await page.locator('#'+panel).is_visible():await page.locator(f'[data-close={panel}]').click()
  async def guide(start):
   point=await page.evaluate('()=>{const b=document.querySelector("#stage canvas").getBoundingClientRect(),c=__crawlWorld.creatures[0];return{x:b.x+c.x,y:b.y+c.y};}')
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart'if start else'touchEnd','touchPoints':[{'id':1,**point,'radiusX':4,'radiusY':4,'force':.7}]if start else[]})
  def audible(pcm):assert pcm['rms']>.0004 and pcm['peak']<1 and pcm['nonFinite']==0,pcm
  try:
   await page.goto(base+'/collection.html#crawl');await page.wait_for_function('window.__crawlLiveFrame?.response.length===5')
   assert all(r.get('level',0)==0 for r in await page.evaluate('__crawlLiveFrame.response'))
   await slider('appearance','colourFlow',0);await close_panels()
   await page.evaluate('window.__recordCrawlAudio=true;window.__crawlAudioTrace=[]')
   await page.evaluate(CAPTURE);await guide(True)
   await page.wait_for_function('__crawlLiveFrame.rms>.0004&&__crawlLiveFrame.response.some(c=>c.level>.02)',timeout=7000)
   await page.wait_for_timeout(600);await guide(False);await page.wait_for_timeout(180)
   pcm=await page.evaluate('finishCrawlCapture()');audible(pcm)
   assert not await page.evaluate('__crawlHost.state.playing')
   trace=await page.evaluate('__crawlAudioTrace');responsive=[f for f in trace if f['rms']>.0004]
   assert len(responsive)>5 and all(any(c['level']>0 for c in f['response'])for f in responsive),responsive[-3:]
   peak=max(responsive,key=lambda f:sum(c['level']for c in f['response']))
   for frame in trace:
    for creature in frame['response']:
     assert all(0<=creature[key]<=1 for key in ['level','bass','mid','treble','attack']),creature
     assert creature['segments']and all(0<=v<=1 for v in creature['segments']),creature
   report['checks']['realTouchPCMDrivesResponseBeforePlay']={'rms':pcm['rms'],'peak':pcm['peak'],'responsiveFrames':len(responsive),'peakResponse':peak}
   pixels=await page.evaluate(PIXELS,peak['response'])
   for key,name in [('silentImage','fixed-pose-silent.png'),('measuredImage','fixed-pose-measured.png')]:
    (OUT/name).write_bytes(base64.b64decode(pixels.pop(key).split(',',1)[1]))
   assert pixels['disabled']==0 and pixels['colour']>100 and pixels['motion']>100 and pixels['reducedMotion']==0 and pixels['reducedColour']>100,pixels
   assert pixels['brightPaletteViolations']==[],pixels['brightPaletteViolations']
   report['checks']['soundChangesColourWithIdleFlowOffAndRespectsEffectControls']=pixels
   if '--capture-only'in sys.argv:report['passed']=True;return
   await page.wait_for_function('__crawlLiveFrame.rms<.0003',timeout=10000)
   await page.evaluate(CAPTURE)
   await page.wait_for_function('__crawlLiveFrame.response.every(c=>[c.level,c.bass,c.mid,c.treble,c.attack,...c.segments].every(v=>v===0))',timeout=6000)
   await page.wait_for_timeout(350);silence_pcm=await page.evaluate('finishCrawlCapture()')
   assert silence_pcm['rms']<.001 and silence_pcm['peak']<.01,silence_pcm
   report['checks']['releasedAudioDecaysToSilence']={'response':await page.evaluate('__crawlLiveFrame'),'rms':silence_pcm['rms'],'peak':silence_pcm['peak']}
   # Keep the sound patch fixed while testing that sensitivity changes only
   # the response envelope, not the sounding note or its synthesis options.
   await page.evaluate('window.__freezeCrawl=true;window.__cachedPanel=__crawlRenderer.background.toDataURL()')
   sound=await page.evaluate('__crawlHost.state.sound');await guide(True)
   await page.wait_for_function('__crawlHost.audio.sources.size===1')
   source=await page.evaluate('[...__crawlHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,options:s.options}))')
   sensitivity=await page.evaluate('__crawlHost.controls.appearance.find(c=>c.key==="audioSensitivity")')
   low=max(sensitivity['min'],.4);high=min(sensitivity['max'],2)
   await slider('appearance','audioSensitivity',low);await page.wait_for_timeout(1200)
   low_response=await page.evaluate('Math.max(...__crawlLiveFrame.response.map(c=>c.level))')
   await slider('appearance','audioSensitivity',high);await page.wait_for_timeout(1200)
   high_response=await page.evaluate('Math.max(...__crawlLiveFrame.response.map(c=>c.level))')
   assert high_response>low_response*1.15 and high_response>.02,{'low':low_response,'high':high_response}
   for key,value in [('audioMotion',.8),('audioColour',.9),('audioGlow',.6),('audioSensitivity',1.4)]:await slider('appearance',key,value)
   await close_panels();assert await page.evaluate('__crawlHost.state.sound')==sound
   assert await page.evaluate('[...__crawlHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,options:s.options}))')==source
   assert await page.evaluate('__crawlRenderer.background.toDataURL()===__cachedPanel')
   await guide(False);report['checks']['sensitivityScalesResponseWithoutChangingAudioOrPanel']={'low':low_response,'high':high_response}
   await page.locator('#appearance-toggle').click()
   async with page.expect_download()as download_info:await page.locator('#export-look').click()
   downloaded=await download_info.value;export=json.loads(Path(await downloaded.path()).read_text());await close_panels()
   for key,value in [('audioMotion',.8),('audioColour',.9),('audioGlow',.6),('audioSensitivity',1.4)]:assert export['appearance'][key]==value
   await page.locator('#import-look').set_input_files({'name':'crawl-audio-response.json','mimeType':'application/json','buffer':json.dumps(export).encode()})
   await page.wait_for_timeout(250);await page.reload();await page.wait_for_function('window.__crawlLiveFrame?.response.length===5')
   for key,value in [('audioMotion',.8),('audioColour',.9),('audioGlow',.6),('audioSensitivity',1.4)]:assert await page.evaluate('key=>__crawlHost.state.appearance[key]',key)==value
   report['checks']['audioAppearanceExportImportReload']=True
   await slider('sound','speed',1);await slider('sound','activity',1);await close_panels()
   await page.evaluate('window.__crawlAudioTrace=[];window.__recordCrawlAudio=true;window.__crawlIKViolations=[];window.__crawlAudioContacts=[]')
   await page.evaluate(CAPTURE);await page.locator('#play').click()
   await page.wait_for_function('__crawlLiveFrame.rms>.0004&&__crawlLiveFrame.response.some(c=>c.level>.02)')
   await page.wait_for_function('__crawlAudioContacts.length>=3',timeout=30000)
   sequence_pcm=await page.evaluate('finishCrawlCapture()');audible(sequence_pcm)
   contacts=await page.evaluate('__crawlAudioContacts');assert max(contacts)<1e-5,contacts
   assert await page.evaluate('__crawlIKViolations')==[]
   report['checks']['sequenceAudioReactsWithoutFootSlipOrContactDrift']={'rms':sequence_pcm['rms'],'peak':sequence_pcm['peak'],'contacts':len(contacts),'maxContactError':max(contacts)}
   await page.locator('#play').click();await page.wait_for_function('__crawlLiveFrame.rms<.001&&__crawlLiveFrame.response.every(c=>c.level<.03)',timeout=12000)
   assert not errors,errors
   report['passed']=True
  finally:
   report['errors']=errors;(OUT/('capture-report.json'if '--capture-only'in sys.argv else'report.json')).write_text(json.dumps(report,indent=2));print(json.dumps({'passed':report.get('passed',False),'checks':list(report['checks']),'errors':errors},indent=2))
   await context.close();await browser.close()

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),150))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
