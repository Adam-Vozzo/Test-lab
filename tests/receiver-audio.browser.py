"""Receiver's production voice and master graph rendered to real PCM.

Checks independent timbre controls, sustained output, bounded polyphony, release,
and repeated live parameter edits. Runs without WebGL; not native iOS testing.
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

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'receiver-audio'


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


SCRIPT = r'''async () => {
  const {CollectionAudio}=await import('/collection-audio.js');
  const defaults={waveform:'receiver',sideband:.34,spread:.22,air:.045,drift:.22,bandwidth:.68,attack:.045,decay:.45,sustain:.72,release:.4,gain:.72,cutoff:10000,resonance:.65,echo:0,feedback:.24,delayTime:.29,glide:.07,detune:0,pan:0};
  const rms=(data,from,to)=>{let power=0;for(let i=from;i<to;i++)power+=data[i]*data[i];return Math.sqrt(power/(to-from));};
  async function render(options={},poly=1,edits=[]){
    const sampleRate=48000,context=new OfflineAudioContext(2,sampleRate*4,sampleRate);
    function Context(){return context;}
    const audio=new CollectionAudio({AudioContext:Context,setInterval:()=>0,clearInterval:()=>{}});
    audio._createContext();audio.configure({...defaults,...options},{replace:true});
    const voices=[];
    for(let i=0;i<poly;i++){
      const voice=audio._newVoice({id:'receiver-pcm-'+i,generation:i,midi:57+i%8,options:audio.sound},.02+i*.005,'pulse');
      if(!voice.receiver)throw new Error('Receiver adapter was not selected');
      voices.push(voice);audio._releaseVoice(voice,2.8,.4);
    }
    // The renderer actually pauses at the edit boundary: AudioParam values and
    // time-dependent smoothing are inspected at the live graph's current time.
    const changes=edits.map(edit=>context.suspend(edit.time).then(async()=>{
      audio.configure(edit.patch);
      await context.resume();
    }));
    const buffer=await context.startRendering();await Promise.all(changes);
    const data=buffer.getChannelData(0),window=(a,b)=>rms(data,Math.floor(a*sampleRate),Math.floor(b*sampleRate));
    let peak=0,nonFinite=0,dc=0,differencePower=0,maxStep=0;
    for(let i=0;i<data.length;i++){
      const value=data[i];if(!Number.isFinite(value))nonFinite++;
      peak=Math.max(peak,Math.abs(value));dc+=value;
      if(i>0&&i>.5*sampleRate&&i<2.6*sampleRate){const delta=value-data[i-1];differencePower+=delta*delta;maxStep=Math.max(maxStep,Math.abs(delta));}
    }
    const editSteps=edits.map(({time})=>{let max=0;const centre=Math.floor(time*sampleRate);for(let i=centre-256;i<centre+2048;i++)max=Math.max(max,Math.abs(data[i]-data[i-1]));return max;});
    const sustained=[window(.7,.9),window(1.2,1.4),window(1.7,1.9),window(2.2,2.4)];
    // Compare spectral shape independently of the filter's fundamental gain.
    // A one-second window contains whole cycles of the 220 Hz fixture note.
    const harmonicAmplitudes=[1,3,5,7].map(multiple=>{
      const coefficient=2*Math.cos(2*Math.PI*220*multiple/sampleRate);let a=0,b=0;
      for(let i=sampleRate;i<sampleRate*2;i++){const next=data[i]+coefficient*a-b;b=a;a=next;}
      return 2*Math.sqrt(Math.max(0,a*a+b*b-coefficient*a*b))/sampleRate;
    });
    const upperHarmonicRatio=Math.hypot(...harmonicAmplitudes.slice(1))/Math.max(.000001,harmonicAmplitudes[0]);
    const fingerprint=[];for(let i=Math.floor(1.1*sampleRate);i<Math.floor(1.2*sampleRate);i+=3)fingerprint.push(data[i]);
    const record={peak,nonFinite,dc:dc/data.length,onset:window(.08,.25),body:window(.7,2.5),tail:window(3.5,3.9),sustained,maxStep,editSteps,upperHarmonicRatio,roughness:Math.sqrt(differencePower/(2.1*sampleRate)),fingerprint};
    for(const voice of voices)audio._destroyVoice(voice);
    record.cleanedVoices=audio._voices.length;
    return record;
  }
  const cases={default:await render()};
  const neutral={sideband:0,spread:0,air:0,drift:0,bandwidth:1};
  const pairs={
    sideband:[{...neutral,sideband:0},{...neutral,sideband:1}],
    spread:[{...neutral,sideband:.8,spread:0},{...neutral,sideband:.8,spread:1}],
    air:[{...neutral,air:0},{...neutral,air:1}],
    drift:[{...neutral,drift:0},{...neutral,drift:1}],
    bandwidth:[{...neutral,sideband:1,air:.5,bandwidth:0},{...neutral,sideband:1,air:.5,bandwidth:1}]
  };
  const differences={};
  for(const [key,pair]of Object.entries(pairs)){
    const a=cases[key+'Low']=await render(pair[0]),b=cases[key+'High']=await render(pair[1]);
    differences[key]=Math.sqrt(a.fingerprint.reduce((sum,value,i)=>sum+(value-b.fingerprint[i])**2,0)/a.fingerprint.length);
  }
  cases.poly=await render({gain:1,sideband:1,spread:.8,air:1,drift:1,bandwidth:1,echo:.3},16);
  const edits=Array.from({length:12},(_,i)=>({time:.6+i*.12,patch:{sideband:i%2,spread:(i%3)/2,air:(i%2)*.7,drift:i%2,bandwidth:i%2?1:.05}}));
  cases.liveEdits=await render({},1,edits);
  for(const value of Object.values(cases))delete value.fingerprint;
  return {cases,differences};
}'''


async def run(url):
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True,
            args=['--no-sandbox', '--disable-webgl', '--disable-dev-shm-usage'],
        )
        try:
            page = await browser.new_page()
            # An ordinary empty document avoids concurrently mounting a synth.
            await page.goto(url + '/icons/icon.svg')
            result = await page.evaluate(SCRIPT)
            result['nativeIOS'] = False
            (OUT / 'report.json').write_text(json.dumps(result, indent=2))
            for name, case in result['cases'].items():
                assert case['nonFinite'] == 0 and 0 < case['peak'] < .95, (name, case)
                assert case['onset'] > .003 and abs(case['dc']) < .003, (name, case)
                assert case['cleanedVoices'] == 0, (name, case)
                if name != 'poly':
                    assert case['tail'] < .00001, (name, case)
            for parameter, difference in result['differences'].items():
                assert difference > .0001, (parameter, difference)
            held = result['cases']['default']['sustained']
            assert min(held) > .005 and max(held) / min(held) < 3.5, held
            edited = result['cases']['liveEdits']
            assert max(edited['editSteps']) < .02, edited
            assert result['cases']['bandwidthHigh']['upperHarmonicRatio'] > result['cases']['bandwidthLow']['upperHarmonicRatio'] * 2, result['cases']
            result['passed'] = True
            (OUT / 'report.json').write_text(json.dumps(result, indent=2))
            print(json.dumps({'passed':True,'cases':len(result['cases']),'defaultPeak':result['cases']['default']['peak'],'polyPeak':result['cases']['poly']['peak'],'liveEditMaxStep':max(edited['editSteps']),'parameterDifferences':result['differences']},indent=2))
        finally:
            await browser.close()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'), 120))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
