#!/usr/bin/env python3
"""Full production-route native first-touch audio regression, without Play.

Runs actual host gesture listeners and instrument schedulers. End-only activation
is an explicit WebKit-policy simulation on Chromium, not a native iOS claim.
Captures decoded master PCM and checks delayed Geo/Waveform handoffs, cancellation
and expiry. WebGL is disabled so this test exercises available CPU fallbacks.
"""
import asyncio,functools,json,os,shutil,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'instrument-first-touch'
POINTS={'relay':(.20,.42),'cellular':(.22,.44),'census':(.24,.32),'swarm':(.75,.42),'graticule':(.25,.50),'waveform':(.75,.30),'geo':(.24,.32),'hand':(.05,.90),'structure':(.35,.59),'granular':(.50,.36),'terrain':(.25,.32),'phase-volume':(.25,.50),'milkdrop':(.35,.52)}
PREPARE=r'''async ({kind,policy})=>{
 window.kind=kind;window.policy=policy;window.engine=__qa.audio;window.lastNative='';window.allowEnding=false;window.voices=[];window.nativeEvents=[];window.calls=[];
 const allowed=()=>policy==='fresh'||(policy==='end-only'||allowEnding)&&['pointerup','touchend','click'].includes(lastNative);
 const wrapper=Object.create(Tone);Object.defineProperty(wrapper,'start',{value:()=>allowed()?Tone.start():new Promise(()=>{})});
 if(kind==='signal')engine.Tone=wrapper;else engine._Tone=wrapper;
 for(const name of ['noteOn','noteOff','_drainCompletedTaps']){const original=engine[name].bind(engine);engine[name]=(...args)=>{calls.push({name,args:name==='_drainCompletedTaps'?[]:args,wall:performance.now(),pending:[...engine._completedTaps.values()].map(t=>({deadline:t.deadline})),ready:engine.ready});return original(...args);};}const originalPrime=engine._primeOutput.bind(engine);engine._primeOutput=(...args)=>{if(allowed())return originalPrime(...args);};
 if(kind!=='signal')engine._createContext();window.ctx=kind==='signal'?Tone.getContext().rawContext:engine.context;await ctx.suspend();
 const capture=()=>{if(window.recorder)return;window.target=ctx.createMediaStreamDestination();window.master=kind==='signal'?engine.master:engine._master;master.connect(target);window.chunks=[];const mime=['audio/webm;codecs=opus','audio/mp4'].find(s=>MediaRecorder.isTypeSupported(s));window.recorder=new MediaRecorder(target.stream,mime?{mimeType:mime}:{});recorder.ondataavailable=e=>chunks.push(e.data);window.stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();window.captureClock=ctx.createOscillator();window.captureZero=ctx.createGain();captureZero.gain.value=0;captureClock.connect(captureZero);captureZero.connect(target);captureClock.start();};
 if(kind==='signal'){const build=engine._build.bind(engine);engine._build=(...args)=>{build(...args);capture();};const original=engine._soundNote.bind(engine);engine._soundNote=(...args)=>{const value=original(...args);if(value)voices.push({id:args[5]?.originId||args[4],midi:args[0],when:args[2],now:ctx.currentTime,wall:performance.now()});return value;};}
 else{capture();const original=engine._newVoice.bind(engine);engine._newVoice=(source,when,voiceKind)=>{const value=original(source,when,voiceKind);if(value)voices.push({id:source.id,midi:source.midi,when,now:ctx.currentTime,wall:performance.now(),kind:voiceKind});return value;};}
 for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click'])document.addEventListener(type,e=>{lastNative=type;nativeEvents.push({type,trusted:e.isTrusted,at:ctx.currentTime,wall:performance.now()});},{capture:true,passive:true});
 const prime=document.createElement('button');prime.id='qa-prime';prime.textContent='Unlock only';prime.style.cssText='position:fixed;top:0;left:0;z-index:9999';prime.addEventListener('click',()=>{allowEnding=true;(kind==='signal'?engine.init({completeGesture:true}):engine.start({completeGesture:true}));});document.body.append(prime);
 window.finish=async()=>{
  if(!recorder)throw Error('Output graph never built');await new Promise(resolve=>setTimeout(resolve,220));captureClock.stop();captureClock.disconnect();captureZero.disconnect();recorder.stop();await stopped;const buffer=await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());let sum=0,peak=0,n=0,onset=null;const mono=buffer.getChannelData(0);for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const v of buffer.getChannelData(ch)){sum+=v*v;peak=Math.max(peak,Math.abs(v));n++;}for(let i=0;i<mono.length;i+=256){let power=0;for(let j=i;j<Math.min(i+256,mono.length);j++)power+=mono[j]*mono[j];if(Math.sqrt(power/256)>.0003){onset=i/buffer.sampleRate;break;}}
  master.disconnect(target);target.stream.getTracks().forEach(t=>t.stop());target.disconnect();return{rms:Math.sqrt(sum/n),peak,onset,duration:buffer.duration,voices,calls,playing:__qa.state.playing,sources:(kind==='signal'?engine.live:engine.sources).size,pending:engine._completedTaps.size,events:nativeEvents,grainEvents:window.__cloud?.events.map(e=>({id:e.id,contactId:e.contactId,when:e.when}))||[]};
 };
}'''
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'cases':[],'failures':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  try:
   selected=os.environ.get('INSTRUMENTS','signal,'+','.join(POINTS)).split(',')
   for instrument in selected:
    for policy in ['fresh','end-only']+(['cancel','expired'] if instrument in ['geo','waveform'] else []):
     context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block');errors=[];value={'instrument':instrument,'policy':policy}
     try:
      async def host(route):
       filename='app.js' if instrument=='signal' else 'collection.js';expose='({audio:engine,state,scene})' if instrument=='signal' else '({audio,state,controller})'
       await route.fulfill(content_type='text/javascript',body=(ROOT/filename).read_text()+f"\nObject.defineProperty(window,'__qa',{{get:()=>{expose}}});")
      await context.route('**/'+('app.js' if instrument=='signal' else 'collection.js'),host)
      if instrument=='granular':
       async def module(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/granular.js').read_text().replace('const cloud=new GrainCloud(api.audio),contacts','const cloud=window.__cloud=new GrainCloud(api.audio),contacts'))
       await context.route('**/instruments/granular.js',module)
      page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));await page.goto(base+('/index.html' if instrument=='signal' else '/collection.html#'+instrument));await page.wait_for_function('window.__qa && (__qa.controller || __qa.scene)');await page.wait_for_timeout(100);await page.evaluate(PREPARE,{'kind':instrument,'policy':policy})
      if instrument=='signal':
       point=await page.evaluate("()=>{const b=document.querySelector('#ring-host').getBoundingClientRect();for(let i=0;i<8;i++){const p=__qa.scene.projectSector(i),x=b.x+p.x,y=b.y+p.y;if(__qa.scene.pickClientPoint(x,y,{surfaceOnly:true}))return{x,y};}throw Error('No playable projected ring point');}")
      elif instrument in ['hand','structure']:
       point=await page.evaluate("async id=>{const {splitLayout}=await import('./instrument-layout.js'),b=document.querySelector('#stage').getBoundingClientRect(),l=splitLayout(b.width,b.height,__qa.state.appearance,{pad:0,gap:12,stackPortrait:true,portraitRatio:.83}).left;return{x:b.x+l.x+l.w*(id==='hand'?.10:.70),y:b.y+l.y+l.h*(id==='hand'?.90:.59)};}",instrument)
      else:
       box=await page.locator('#stage').bounding_box();u,v=POINTS[instrument];point={'x':box['x']+box['width']*u,'y':box['y']+box['height']*v}
      point.update(id=1,radiusX=4,radiusY=4,force=.6);cdp=await context.new_cdp_session(page);await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]});await page.wait_for_timeout(25);await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel' if policy=='cancel' else 'touchEnd','touchPoints':[]})
      if policy in ['cancel','expired']:await page.wait_for_timeout(220);await page.tap('#qa-prime')
      await page.wait_for_function("ctx.state==='running'",timeout=3000);await page.wait_for_timeout(3200 if instrument in ['geo','waveform'] else 2200);value.update(await page.evaluate('finish()'));value['errors']=errors
      assert not errors and not value['playing'] and value['sources']==0 and value['pending']==0,value
      assert all(event['trusted'] for event in value['events']),value
      if policy in ['fresh','end-only']:
       assert value['rms']>.0004 and value['peak']<1 and (value['voices'] or value['grainEvents']),value
       if instrument in ['geo','waveform']:
        start=next(e['at'] for e in value['events'] if e['type']=='touchend');delay=min(v['when'] for v in value['voices'])-start;value['handoffDelay']=delay;assert delay>.4 and value['onset']>.35,value
      else:assert value['rms']<.00001 and not value['voices'] and not value['grainEvents'],value
      value['passed']=True
     except Exception as error:
      message=str(error);value['passed']=False;value['failure']=message;value['errors']=errors;report['failures'].append({'instrument':instrument,'policy':policy,'failure':message})
     finally:
      report['cases'].append(value);(OUT/'report.json').write_text(json.dumps(report,indent=2));print(instrument,policy,'PASS' if value.get('passed') else 'FAIL',value.get('rms'),value.get('handoffDelay'),value.get('failure','')[:500],flush=True);await context.close()
   report['passed']=not report['failures'];assert report['passed'],report['failures']
  finally:(OUT/'report.json').write_text(json.dumps(report,indent=2));await browser.close()
def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),240))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
