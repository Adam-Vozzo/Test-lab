"""Render the production Relay modal voice and master graph to real PCM.

This runs without a GPU and measures timbre, decay, parameter continuity,
polyphonic output bounds and the final release tail. It is not an iOS test.
"""
import asyncio
import functools
import json
import os
from pathlib import Path
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'relay-audio'

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

SCRIPT=r'''async () => {
 const {CollectionAudio}=await import('/collection-audio.js');
 const defaults={waveform:'resonator',material:.32,damping:.38,brightness:.58,strike:.28,excitation:.22,attack:.006,decay:1.5,sustain:.65,release:.22,gain:.78,cutoff:10000,resonance:.7,echo:0,feedback:.28,delayTime:.31,glide:.045};
 const rms=(a,from,to)=>{let sum=0;for(let i=from;i<to;i++)sum+=a[i]*a[i];return Math.sqrt(sum/(to-from));};
 async function render(options={},poly=1,edit=null){
  const sampleRate=48000,context=new OfflineAudioContext(2,sampleRate*3,sampleRate);
  function Context(){return context;}
  const audio=new CollectionAudio({AudioContext:Context,setInterval:()=>0,clearInterval:()=>{}});
  audio._createContext();audio.configure({...defaults,...options},{replace:true});
  const voices=[];
  for(let i=0;i<poly;i++){
   const voice=audio._newVoice({id:'modal-'+i,generation:i,midi:57+i%8,options:audio.sound},.02+i*.007,'pulse');
   voices.push(voice);audio._releaseVoice(voice,1.7,.22);
  }
  if(edit){
   const oldNow=Object.getOwnPropertyDescriptor(CollectionAudio.prototype,'now');
   // Scheduling this change at .5s exercises the real update graph before the
   // offline renderer starts. The host's public clock stays untouched.
   Object.defineProperty(audio,'now',{get:()=>.5});
   for(const voice of voices)audio._updateVoice(voice,voice.midi,{...voice.options,...edit});
   delete audio.now;
  }
  const buffer=await context.startRendering(),data=buffer.getChannelData(0);
  let peak=0,nonFinite=0,mean=0,diff=0;
  for(let i=0;i<data.length;i++){const value=data[i];if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));mean+=value;if(i>0&&i>.1*sampleRate&&i<1.5*sampleRate)diff+=(value-data[i-1])**2;}
  const onset=rms(data,Math.floor(.04*sampleRate),Math.floor(.22*sampleRate));
  const body=rms(data,Math.floor(.65*sampleRate),Math.floor(1.1*sampleRate));
  const tail=rms(data,Math.floor(2.2*sampleRate),Math.floor(2.8*sampleRate));
  const fingerprint=[];for(let i=Math.floor(.08*sampleRate);i<Math.floor(.18*sampleRate);i+=3)fingerprint.push(data[i]);
  return {peak,nonFinite,dc:mean/data.length,onset,body,tail,brightness:Math.sqrt(diff/(1.4*sampleRate))/Math.max(.00001,body),fingerprint};
 }
 const cases={};
 for(const [name,options]of Object.entries({default:{},string:{material:0},metal:{material:1},dark:{brightness:0},bright:{brightness:1},open:{damping:0},damped:{damping:1},edge:{strike:.05},centre:{strike:.5},plucked:{excitation:0},bowed:{excitation:1}}))cases[name]=await render(options);
 cases.poly=await render({gain:1,excitation:1,damping:0,brightness:1,echo:.3},16);
 cases.edit=await render({},1,{material:.95,brightness:.9,damping:.7,excitation:.6,strike:.7});
 const distance=(a,b)=>Math.sqrt(a.fingerprint.reduce((s,v,i)=>s+(v-b.fingerprint[i])**2,0)/a.fingerprint.length);
 const differences={material:distance(cases.string,cases.metal),strike:distance(cases.edge,cases.centre)};
 for(const value of Object.values(cases))delete value.fingerprint;
 return {cases,differences};
}'''

async def main(url):
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
        page=await browser.new_page()
        await page.goto(url+'/collection.html')
        result=await page.evaluate(SCRIPT)
        (OUT/'report.json').write_text(json.dumps(result,indent=2))
        for name,value in result['cases'].items():
            assert value['nonFinite']==0 and value['peak']<.95,(name,value)
            assert value['onset']>.003 and abs(value['dc'])<.003,(name,value)
            if name!='poly': assert value['tail']<.00001,(name,value)
        cases=result['cases']
        assert result['differences']['material']>.01,result['differences']
        assert result['differences']['strike']>.005,result['differences']
        assert cases['bright']['brightness']>cases['dark']['brightness']*1.3,cases
        assert cases['open']['body']>cases['damped']['body']*1.5,cases
        assert cases['bowed']['body']>cases['plucked']['body']*1.2,cases
        print(json.dumps(result,indent=2))
        await browser.close()

server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
thread=Thread(target=server.serve_forever,daemon=True);thread.start()
try: asyncio.run(main(f'http://127.0.0.1:{server.server_port}'))
finally: server.shutdown();server.server_close();thread.join()
