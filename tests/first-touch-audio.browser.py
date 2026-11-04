#!/usr/bin/env python3
"""First-touch Web Audio regression for both engines, without pressing Play.

Uses real trusted touch events and records/decodes the master output. The ending-
touch case models Safari eligibility by gating both resume and silent priming;
this is explicit simulation of that policy, not a native iOS claim.
"""
import argparse,asyncio,functools,json,shutil,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'first-touch-audio'
HARNESS='''<!doctype html><meta charset="utf-8"><style>button{width:220px;height:140px;touch-action:none;font:20px monospace}body{margin:24px}</style><button id="pad">Touch instrument</button><button id="prime">Unlock only</button>
<script src="./vendor/Tone.js"></script><script type="module">
import {CollectionAudio} from './collection-audio.js';import {AudioEngine} from './audio.js';
window.ready=true;window.nativeEvents=[];window.lastEvent='';window.allowEnding=false;window.voiceCount=0;
const state={sound:{volume:.7,waveform:'sine',attack:.012,decay:.1,sustain:.7,release:.18,cutoff:12000,resonance:.6,delay:0,feedback:0,reverb:0,detune:0},sequence:{bpm:112,swing:0,root:50,scale:'dorian',length:16,steps:[],arp:false,arpRate:8}};
window.prepare=async(kind,policy)=>{
 window.kind=kind;window.policy=policy;window.engine=kind==='collection'?new CollectionAudio():new AudioEngine(()=>state);
 const allowed=()=>policy==='fresh'||(policy==='end-only'||allowEnding)&&['pointerup','touchend','click'].includes(lastEvent);
 const wrapper=Object.create(Tone);Object.defineProperty(wrapper,'start',{value:()=>allowed()?Tone.start():new Promise(()=>{})});
 if(kind==='collection'){engine._Tone=wrapper;engine._createContext();engine.configure({waveform:'sine',attack:.012,release:.18,cutoff:12000,resonance:.6,echo:0,gain:.8,index:0});}
 else engine.Tone=wrapper;
 const originalPrime=engine._primeOutput.bind(engine);engine._primeOutput=(...args)=>{if(allowed())return originalPrime(...args);};
 window.ctx=kind==='collection'?engine.context:Tone.getContext().rawContext;await ctx.suspend();
 const beginCapture=()=>{
  if(window.recorder)return;window.target=ctx.createMediaStreamDestination();window.master=kind==='collection'?engine._master:engine.master;
  master.connect(target);window.chunks=[];const mime=['audio/webm;codecs=opus','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));window.recorder=new MediaRecorder(target.stream,mime?{mimeType:mime}:{});recorder.ondataavailable=e=>chunks.push(e.data);window.stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
 };
 if(kind==='collection'){beginCapture();const original=engine._newVoice.bind(engine);engine._newVoice=(...args)=>{const result=original(...args);if(result)voiceCount++;return result;};}
 else {const original=engine._build.bind(engine);engine._build=()=>{original();beginCapture();};const sound=engine._soundNote.bind(engine);engine._soundNote=(...args)=>{const result=sound(...args);if(result)voiceCount++;return result;};}
 const activate=completeGesture=>{const promise=kind==='collection'?engine.start({completeGesture}):engine.init({completeGesture});Promise.resolve(promise).catch(e=>window.error=e.message);};
 for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click'])document.addEventListener(type,e=>{
  lastEvent=type;nativeEvents.push({type,trusted:e.isTrusted,target:e.target.id});
  if(type!=='pointercancel')activate(type==='pointerup'||type==='touchend');
 },{capture:true,passive:true});
 pad.addEventListener('pointerdown',e=>{e.preventDefault();pad.setPointerCapture(e.pointerId);engine.noteOn('touch',60);});
 pad.addEventListener('pointerup',e=>{e.preventDefault();engine.noteOff('touch');});
 pad.addEventListener('pointercancel',()=>engine.noteOff('touch',{force:true}));
};
window.finish=async()=>{
 if(!recorder)throw Error('Output graph was never built');const clock=ctx.createOscillator(),zero=ctx.createGain();zero.gain.value=0;clock.connect(zero);zero.connect(target);clock.start();await new Promise(resolve=>setTimeout(resolve,220));clock.stop();clock.disconnect();zero.disconnect();recorder.stop();await stopped;const bytes=await new Blob(chunks).arrayBuffer();let buffer;try{buffer=await ctx.decodeAudioData(bytes.slice(0));}catch(e){throw Error('decode '+bytes.byteLength+' bytes '+recorder.mimeType+' chunks '+chunks.length+' voices '+voiceCount+' ctx '+ctx.state+' '+e.message);} let sum=0,peak=0,n=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const s of buffer.getChannelData(ch)){sum+=s*s;peak=Math.max(peak,Math.abs(s));n++;}
 master.disconnect(target);target.stream.getTracks().forEach(t=>t.stop());target.disconnect();
 return{rms:Math.sqrt(sum/n),peak,voices:voiceCount,sources:(kind==='collection'?engine.sources:engine.live).size,playing:kind==='collection'?engine.transport.playing:engine.running,pending:engine._completedTaps.size,events:nativeEvents,error:window.error||null};
};
</script>'''

class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

async def run(base,options):
 options.report.parent.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  report={'cases':[],'cpuThrottle':options.cpu_throttle}
  try:
   for kind in ([options.kind] if options.kind else ['collection','signal']):
    for policy in ([options.policy] if options.policy else ['fresh','end-only','cancel','expired'])*options.iterations:
     context=await browser.new_context(has_touch=True,viewport={'width':700,'height':400},service_workers='block');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
     await page.route('**/__first_touch__.html',lambda route:route.fulfill(content_type='text/html',body=HARNESS));await page.goto(base+'/__first_touch__.html');await page.wait_for_function('window.ready');cdp=await context.new_cdp_session(page);await cdp.send('Emulation.setCPUThrottlingRate',{'rate':options.cpu_throttle});await page.evaluate('([kind,policy])=>prepare(kind,policy)',[kind,policy])
     point={'x':130,'y':90,'id':1};await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]});await page.wait_for_timeout(160 if policy=='fresh' else 25)
     if policy=='cancel':
      await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]});await page.wait_for_timeout(200);await page.evaluate('allowEnding=true');await page.tap('#prime')
     elif policy=='expired':
      await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await page.wait_for_timeout(220);await page.evaluate('allowEnding=true');await page.tap('#prime')
     else:await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
     await page.wait_for_function('ctx.state===\'running\'');await page.wait_for_timeout(650);result=await page.evaluate('finish()');result.update(kind=kind,policy=policy,pageErrors=errors)
     assert not errors and not result['error'],result;assert not result['playing'] and result['sources']==0 and result['pending']==0,result;assert all(e['trusted'] for e in result['events']),result
     if policy in ['fresh','end-only']:assert result['rms']>.0008 and result['peak']<1 and result['voices']==1,result
     else:assert result['rms']<.00001 and result['voices']==0,result
     report['cases'].append(result);print(kind,policy,result['rms'],result['voices'],flush=True);await context.close()
   report['passed']=True
  finally:
   options.report.write_text(json.dumps(report,indent=2));await browser.close()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--kind',choices=['collection','signal']);parser.add_argument('--policy',choices=['fresh','end-only','cancel','expired']);parser.add_argument('--iterations',type=int,default=1);parser.add_argument('--cpu-throttle',type=float,default=1);parser.add_argument('--report',type=Path,default=OUT/'report.json');options=parser.parse_args()
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}',options),max(100,options.iterations*30)))
 finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()
