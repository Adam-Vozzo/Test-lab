#!/usr/bin/env python3
"""Real-browser regression for the collection's bundled Tone/audio graph.

Optional dependency: python3 -m pip install playwright
Run: python3 tests/collection-audio.browser.py
Or:  python3 tests/collection-audio.browser.py --browser webkit
An existing project server can be supplied with --server-url http://localhost:4173/.
Without it, this script serves the repository on a temporary loopback port.
Recorded PCM proves browser output generation, not a physical device's speakers.
"""
import argparse
import asyncio
import functools
import http.server
import json
from pathlib import Path
import shutil
import threading
from urllib.parse import urljoin

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
HARNESS = """<!doctype html><meta charset="utf-8"><button id="start">Start audio</button>
<script src="./vendor/Tone.js"></script><script type="module">
import {CollectionAudio} from './collection-audio.js';
window.interruptions=[];
window.audio=new CollectionAudio({onStateChange:state=>interruptions.push(state)});
window.startEvents=[];window.attempts=[];window.lastNativeEvent='';
for(const type of ['pointerdown','pointerup','touchend'])document.addEventListener(type,e=>{
  lastNativeEvent=e.type;
  if(type==='pointerdown')audio.noteOn('released-before-activation',60);
  else audio.noteOff('released-before-activation');
  attempts.push(audio.start());
},{capture:true});
window.fixtureReady=true;
</script>"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


async def run(args, base_url):
    async with async_playwright() as playwright:
        browser_type = getattr(playwright, args.browser)
        launch = {"headless": True}
        executable = args.executable or (shutil.which("chromium") if args.browser == "chromium" else None)
        if executable:
            launch["executable_path"] = executable
        if args.browser == "chromium":
            launch["args"] = ["--no-sandbox", "--disable-webgl", "--disable-dev-shm-usage", "--autoplay-policy=user-gesture-required"]
        browser = await browser_type.launch(**launch)
        try:
            context = await browser.new_context(has_touch=True, service_workers="block")
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.route("**/__collection_audio_test__.html", lambda route: route.fulfill(content_type="text/html", body=HARNESS))
            await page.goto(urljoin(base_url, "__collection_audio_test__.html"))
            await page.wait_for_function("window.fixtureReady")
            # Model Safari's ineligible initial pointerdown. The later native
            # ending-touch gesture must invoke the platform start again, while
            # the first unresolved promise cannot hold the engine hostage.
            await page.evaluate("""async()=>{
              audio._createContext();await audio.context.suspend();
              // Tone's bundled exports are getters, so replacing Tone.start
              // itself silently fails. Inject only the gesture gate wrapper.
              audio._Tone={getContext:()=>Tone.getContext(),start(){startEvents.push(lastNativeEvent);return lastNativeEvent==='pointerdown'?new Promise(()=>{}):Tone.start();}};
            }""")
            await page.tap("#start")
            await page.wait_for_function("audio.context.state==='running'")
            activation = await page.evaluate("""async()=>({events:startEvents,results:await Promise.all(attempts),voices:audio.snapshot().voices.length,pending:audio._pendingStarts.size})""")
            assert "pointerdown" in activation["events"] and "pointerup" in activation["events"], activation
            assert all(activation["results"]) and activation["voices"] == 0 and activation["pending"] == 0, activation
            await page.evaluate("audio._Tone=Tone")
            report = await page.evaluate("""async()=>{
              const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
              const read=()=>{const s=audio.snapshot();let sum=0,weight=0;for(let i=0;i<s.frequency.length;i++){sum+=i*s.frequency[i];weight+=s.frequency[i];}return {rms:s.rms,centroid:sum/Math.max(.001,weight),voices:s.voices.length};};
              // Observe the master on an independent encoded-output branch.
              // This bypasses the UI analyser, and exercises a destination sink.
              const capture=async()=>{
                const ctx=audio.context,target=ctx.createMediaStreamDestination(),chunks=[];
                const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
                audio._master.connect(target);
                try{
                  const recorder=new MediaRecorder(target.stream,type?{mimeType:type}:{});
                  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
                  const finished=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject;});
                  recorder.start();await sleep(450);recorder.stop();await finished;
                  const bytes=await new Blob(chunks).arrayBuffer(),byteLength=bytes.byteLength,buffer=await ctx.decodeAudioData(bytes);let peak=0,sum=0,count=0;
                  for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const sample of buffer.getChannelData(ch)){peak=Math.max(peak,Math.abs(sample));sum+=sample*sample;count++;}
                  return {rms:Math.sqrt(sum/count),peak,seconds:buffer.duration,bytes:byteLength};
                }finally{audio._master.disconnect(target);target.stream.getTracks().forEach(track=>track.stop());target.disconnect();}
              };
              const out={context:audio.context.state,tonePlatform:audio.context===Tone.getContext().rawContext,audioSession:navigator.audioSession?.type??'unsupported'};
              audio.configure({echo:0,cutoff:18000,resonance:.7,attack:.01,release:.2,sustain:1,waveform:'sine',gain:.75,index:0});
              audio.noteOn('tone',69);await sleep(100);out.sine={...read(),recording:await capture()};
              audio.configure({index:5,ratio:3});await sleep(150);out.fm={...read(),recording:await capture()};
              audio.configure({crush:.8});await sleep(50);out.crush=await capture();
              audio.configure({crush:0});await sleep(50);out.clean=await capture();
              audio.panic();await sleep(100);out.panic=await capture();
              audio.setPerformance({hold:true,arp:false});audio.noteOn('hold',60);audio.noteOff('hold');await sleep(100);out.hold={sources:audio.sources.size,recording:await capture()};
              audio.setPerformance({hold:false});await sleep(400);out.release=await capture();
              audio.configure({index:0,waveform:'sine',gain:1,attack:.002,decay:.01,sustain:1});
              for(let i=0;i<16;i++)audio.noteOn('poly-'+i,69);
              await sleep(150);out.polyphony={voices:audio.snapshot().voices.length,recording:await capture()};
              audio.panic();audio.setPerformance({arp:true,hold:true,bpm:120,arpRate:16});audio.noteOn('a',60);audio.noteOn('b',67);audio.noteOff('a');audio.noteOff('b');
              await sleep(100);out.arp={playing:audio.transport.playing,recording:await capture()};
              audio.setPerformance({hold:false});await sleep(400);out.arpRelease=await capture();
              audio.panic();await audio.start();
              const oscillator=audio.context.createOscillator(),gain=audio.context.createGain();gain.gain.value=.3;oscillator.connect(gain);gain.connect(audio.output);oscillator.start();
              await sleep(100);out.external={voices:audio.snapshot().voices.length,recording:await capture()};oscillator.stop();oscillator.disconnect();gain.disconnect();
              audio.noteOn('interrupted',60);audio.setTransport({playing:true});await audio.context.suspend();await sleep(20);
              out.interruption={states:interruptions,sources:audio.sources.size,playing:audio.transport.playing};return out;
            }""")
            assert report["tonePlatform"], report
            for name, value in report.items():
                if isinstance(value, dict):
                    recording = value.get("recording", value)
                    if "bytes" in recording:
                        assert recording["bytes"] > 128 and recording["seconds"] > .1, (name, recording)
            assert report["sine"]["recording"]["rms"] > .01, report
            assert report["fm"]["centroid"] > report["sine"]["centroid"] * 1.4, report
            for name in ["fm", "hold", "arp", "external"]:
                assert .001 < report[name]["recording"]["rms"] < .6, (name, report[name])
            for name in ["crush", "clean"]:
                assert .001 < report[name]["rms"] < .6, (name, report[name])
            for name in ["panic", "release", "arpRelease"]:
                assert report[name]["rms"] < .0001, (name, report[name])
            assert report["hold"]["sources"] == 1 and not report["arp"]["playing"], report
            assert report["polyphony"]["voices"] == 16 and report["polyphony"]["recording"]["peak"] < .99, report
            assert report["external"]["voices"] == 0, report
            assert report["interruption"]["states"] and report["interruption"]["sources"] == 0 and not report["interruption"]["playing"], report
            await page.tap("#start")
            await page.wait_for_function("audio.context.state==='running'")
            assert await page.evaluate("audio.snapshot().voices.length") == 0
            await page.evaluate("audio.dispose()")
            assert not errors, errors
            report.update(browser=args.browser, activation=activation, pageErrors=errors)
            return report
        finally:
            await browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-url")
    parser.add_argument("--browser", choices=["chromium", "webkit", "firefox"], default="chromium")
    parser.add_argument("--executable")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    server = None
    try:
        if args.server_url:
            base = args.server_url.rstrip("/") + "/"
        else:
            handler = functools.partial(QuietHandler, directory=str(ROOT))
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            base = f"http://127.0.0.1:{server.server_port}/"
        report = asyncio.run(asyncio.wait_for(run(args, base), timeout=70))
        output = json.dumps(report, indent=2)
        if args.report:
            args.report.write_text(output + "\n")
        print(output)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
