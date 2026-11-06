#!/usr/bin/env python3
"""MilkDrop production-host audio, controls and lifecycle regression.

Runs on Chromium with WebGL disabled to exercise the Canvas fallback. Captures
actual decoded master PCM; it does not claim to test an iPhone's speakers or
native WebKit. The separate visual review exercises the feedback shader.
"""
import asyncio
import functools
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'milkdrop-functional'

CAPTURE = r'''async () => {
  const audio = __milkdropHost.audio;
  audio._createContext();
  const ctx = audio.context, destination = ctx.createMediaStreamDestination();
  audio._master.connect(destination);
  const mime = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(destination.stream, mime ? {mimeType:mime} : {}), chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  const stopped = new Promise(resolve => recorder.onstop = resolve);
  recorder.start();
  window.finishMilkdropCapture = async () => {
    recorder.stop(); await stopped;
    const bytes = await new Blob(chunks).arrayBuffer(), byteLength = bytes.byteLength, buffer = await ctx.decodeAudioData(bytes);
    let sum = 0, peak = 0, count = 0, nonFinite = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const value of buffer.getChannelData(ch)) {
      if(!Number.isFinite(value)){nonFinite++;continue;}
      sum += value * value; peak = Math.max(peak, Math.abs(value)); count++;
    }
    audio._master.disconnect(destination);
    destination.stream.getTracks().forEach(track => track.stop()); destination.disconnect();
    return {rms: Math.sqrt(sum / count), peak, nonFinite, duration: buffer.duration, bytes: byteLength};
  };
}'''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def run(base):
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'webgl': False, 'device': 'Chromium touch emulation', 'checks': {}}
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True,
            args=['--no-sandbox', '--disable-webgl', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'],
        )
        context = await browser.new_context(viewport={'width':844, 'height':390}, has_touch=True, service_workers='block')

        async def expose_host(route):
            source = (ROOT / 'collection.js').read_text()
            source += "\nObject.defineProperty(window,'__milkdropHost',{get:()=>({audio,state,controller,currentId,definition,controls})});"
            await route.fulfill(content_type='text/javascript', body=source)

        await context.route('**/collection.js', expose_host)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        cdp = await context.new_cdp_session(page)
        contacts = {}

        async def loaded(id='milkdrop'):
            await page.wait_for_function("id => window.__milkdropHost?.currentId === id && __milkdropHost.controller && !document.querySelector('#stage').hasAttribute('aria-busy')", arg=id)

        async def touch(kind, id=1, nx=.3, ny=.5):
            ended = None
            if kind in ('touchStart', 'touchMove'):
                bounds = await page.locator('#stage').bounding_box()
                contacts[id] = {'id':id, 'x':bounds['x'] + bounds['width'] * nx, 'y':bounds['y'] + bounds['height'] * ny, 'radiusX':4, 'radiusY':4, 'force':.7}
            else:
                ended = contacts.pop(id, None)
            if kind == 'touchCancel':
                contacts.clear()
            # CDP touchEnd lists the ended contact when another remains. An
            # empty list releases all contacts; it does not mean "one lifted".
            points = [ended] if kind == 'touchEnd' and contacts and ended else list(contacts.values())
            await cdp.send('Input.dispatchTouchEvent', {'type':kind, 'touchPoints':points})

        async def secondary_tap(selector, id=90):
            bounds = await page.locator(selector).bounding_box()
            point = {'id':id,'x':bounds['x']+bounds['width']/2,'y':bounds['y']+bounds['height']/2,'radiusX':4,'radiusY':4,'force':.6}
            contacts[id] = point
            await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':list(contacts.values())})
            await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[point]})
            contacts.pop(id)

        async def sources():
            return await page.evaluate("[...__milkdropHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,physical:s.physical,options:s.options}))")

        async def source_count(count):
            await page.wait_for_function('count => __milkdropHost.audio.sources.size === count', arg=count)

        async def mute_settle():
            await page.wait_for_function('__milkdropHost.audio.snapshot().rms < .0001', timeout=10000)

        async def spectrum():
            return await page.evaluate("""async () => {
              const audio=__milkdropHost.audio, analyser=audio.context.createAnalyser();
              analyser.fftSize=4096;analyser.smoothingTimeConstant=0;audio._master.connect(analyser);
              const bins=new Float32Array(analyser.frequencyBinCount),binHz=audio.context.sampleRate/analyser.fftSize;
              let energy=0,weighted=0,high=0;
              await new Promise(resolve=>setTimeout(resolve,120));
              for(let n=0;n<10;n++){
                analyser.getFloatFrequencyData(bins);
                for(let i=1;i<bins.length;i++)if(Number.isFinite(bins[i])){const power=10**(bins[i]/10),hz=i*binHz;energy+=power;weighted+=power*hz;if(hz>1200)high+=power;}
                await new Promise(resolve=>setTimeout(resolve,35));
              }
              audio._master.disconnect(analyser);analyser.disconnect();
              return{centroidHz:weighted/Math.max(1e-12,energy),highShare:high/Math.max(1e-12,energy)};
            }""")

        try:
            await page.goto(base + '/collection.html#milkdrop')
            await loaded()
            assert not await page.evaluate('__milkdropHost.state.playing')
            assert await page.locator('#stage canvas').count() >= 1
            await page.evaluate(CAPTURE)
            await touch('touchStart', nx=.2, ny=.55)
            await source_count(1)
            await page.wait_for_function('__milkdropHost.audio.snapshot().rms > .0005', timeout=4000)
            before = (await sources())[0]
            await page.wait_for_timeout(350)
            await touch('touchMove', nx=.76, ny=.3)
            await page.wait_for_timeout(350)
            after = (await sources())[0]
            assert after['midi'] > before['midi'], (before, after)
            assert after['options']['cutoff'] != before['options']['cutoff'], (before, after)
            await touch('touchEnd')
            await source_count(0)
            await page.wait_for_timeout(350)
            direct = await page.evaluate('finishMilkdropCapture()')
            assert direct['rms'] > .0005 and direct['peak'] < 1 and not direct['nonFinite'] and not await page.evaluate('__milkdropHost.state.playing'), direct
            report['checks']['directTouchAudio'] = direct | {'startMidi':before['midi'], 'endMidi':after['midi']}

            # Measure filtering in the PCM spectrum with pitch held constant,
            # rather than treating a changed slider/source value as proof.
            await page.locator('#sound-toggle').click()
            cutoff = page.locator('#sound-cutoff')
            await cutoff.evaluate("(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}", 1000)
            await page.locator('[data-close=sound-popover]').click()
            await mute_settle()
            await touch('touchStart', id=11, nx=.38, ny=.86)
            await page.wait_for_timeout(500)
            dim_pitch = (await sources())[0]['midi']
            dim = await spectrum()
            await touch('touchMove', id=11, nx=.38, ny=.18)
            await page.wait_for_timeout(500)
            bright = await spectrum()
            assert (await sources())[0]['midi'] == dim_pitch
            assert bright['centroidHz'] > dim['centroidHz'] * 1.05, (dim, bright)
            await touch('touchEnd', id=11)
            await source_count(0)
            report['checks']['verticalAudioSpectrum'] = {'midi':dim_pitch,'low':dim,'high':bright}
            await page.locator('#sound-toggle').click()
            await page.locator('#sound-cutoff').evaluate("(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}",6800)
            await page.locator('[data-close=sound-popover]').click()

            polyphony = []
            for count in (1,4,8):
                await mute_settle()
                await page.evaluate(CAPTURE)
                for i in range(count):
                    await touch('touchStart', id=21+i, nx=.12+i*.1, ny=.35+(i%2)*.1)
                await source_count(count)
                await page.wait_for_timeout(750)
                pcm = await page.evaluate('finishMilkdropCapture()')
                assert pcm['rms'] > .0005 and pcm['peak'] < 1 and not pcm['nonFinite'], pcm
                polyphony.append({'contacts':count,**pcm})
                for i in range(count):
                    await touch('touchEnd', id=21+i)
                await source_count(0)
            report['checks']['sustainedPolyphony'] = polyphony

            # Hold retains independent contacts. Arp changes voice scheduling,
            # and a cancelled contact still releases its own source.
            await page.locator('#hold').click()
            await touch('touchStart', nx=.25, ny=.52)
            await page.wait_for_timeout(120)
            await touch('touchEnd')
            await source_count(1)
            assert (await sources())[0]['physical'] is False
            await touch('touchStart', id=2, nx=.65, ny=.45)
            await page.wait_for_timeout(120)
            await touch('touchEnd', id=2)
            await source_count(2)
            held = await sources()
            await page.locator('#arp').click()
            await page.wait_for_function("__milkdropHost.audio.snapshot().voices.some(v=>v.kind==='arp')")
            heard = await page.evaluate("""async () => {const notes=new Set(); for(let i=0;i<20;i++){for(const v of __milkdropHost.audio.snapshot().voices)if(v.kind==='arp'&&v.gate)notes.add(v.midi);await new Promise(r=>setTimeout(r,50));}return [...notes];}""")
            assert len(heard) >= 2 and all(s['midi'] in heard for s in held), (held, heard)
            await touch('touchStart', id=3, nx=.85, ny=.6)
            await source_count(3)
            await touch('touchCancel', id=3)
            await source_count(2)
            await page.locator('#hold').click()
            await source_count(0)
            await page.locator('#arp').click()
            report['checks']['holdArpAndCancel'] = {'latchedMidi':[s['midi'] for s in held], 'arpMidi':heard}

            # A–K must remain usable after the instrument's on-stage controls.
            await page.locator('#stage canvas[role=application]').first.focus()
            await page.keyboard.down('a')
            await source_count(1)
            assert (await sources())[0]['id'] == 'key-a'
            await page.keyboard.up('a')
            await source_count(0)
            report['checks']['keyboardNotes'] = True

            await mute_settle()
            await page.evaluate(CAPTURE)
            await page.locator('#play').click()
            await page.wait_for_function("__milkdropHost.audio.snapshot().voices.some(v=>v.kind==='sequence')")
            await page.wait_for_timeout(1400)
            sequence = await page.evaluate('finishMilkdropCapture()')
            assert sequence['rms'] > .0005 and sequence['peak'] < 1 and not sequence['nonFinite'], sequence
            await page.locator('#play').click()
            serial = await page.evaluate('__milkdropHost.audio._serial')
            await page.wait_for_timeout(700)
            assert await page.evaluate('__milkdropHost.audio._serial') == serial
            report['checks']['sequenceAudio'] = sequence
            report['checks']['pauseCancelsFutureNotes'] = True

            presets = page.locator('[data-milkdrop-preset]')
            values = await presets.locator('option').evaluate_all("items=>items.map(x=>x.value).filter(x=>x!=='custom')")
            assert len(values) >= 16, values
            await touch('touchStart', id=4, nx=.47, ny=.5)
            await source_count(1)
            original_source = (await sources())[0]['id']
            original_sound = await page.evaluate('({...__milkdropHost.state.sound})')
            initial_preset = await presets.input_value()
            await secondary_tap('[data-milkdrop-action=next]')
            await page.wait_for_timeout(350)
            assert await presets.input_value() == values[(values.index(initial_preset)+1)%len(values)]
            assert len(await sources()) == 1 and (await sources())[0]['id'] == original_source
            report['checks']['secondaryTouchPreset'] = {'oneStep':True,'voicePreserved':True}
            await presets.select_option(values[1])
            await page.locator('[data-milkdrop-action=next]').click()
            await page.locator('[data-milkdrop-action=previous]').click()
            assert await presets.input_value() == values[1]
            # Interrupt transitions before they settle. This must not restart
            # the synth or lose the physically held pointer.
            for value in (values[5], values[-1], values[3], values[0]):
                await presets.select_option(value)
                await page.wait_for_timeout(40)
            assert (await sources())[0]['id'] == original_source
            assert await page.evaluate('({...__milkdropHost.state.sound})') == original_sound
            assert await page.evaluate('__milkdropHost.audio.snapshot().rms') > .0005
            await touch('touchEnd', id=4)
            await source_count(0)
            report['checks']['presetsDuringHeldNote'] = {'presets':len(values), 'voicePreserved':True}

            # Adjustment uses the actual appearance input event path and the
            # panel remains closed until requested; no private renderer hooks.
            await page.locator('#appearance-toggle').click()
            assert await page.evaluate("!['SELECT','INPUT','TEXTAREA'].includes(document.activeElement.tagName)")
            descriptor = await page.evaluate("__milkdropHost.controls.appearance.find(c=>c.key==='feedback')")
            assert descriptor, 'Missing feedback control'
            await page.locator(f'[data-tabs=appearance] [data-group="{descriptor["section"]}"]').click()
            feedback = page.locator('#appearance-feedback')
            await feedback.focus()
            await feedback.press('Home')
            assert await page.evaluate('__milkdropHost.state.appearance.feedback') == descriptor['min']
            await page.locator('[data-close=appearance]').click()
            await page.wait_for_timeout(300)
            saved = await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.milkdrop.v1'))")
            await page.reload()
            await loaded()
            restored = await page.evaluate('({appearance:__milkdropHost.state.appearance,data:__milkdropHost.controller.getData()})')
            assert restored['appearance'] == saved['appearance'], (saved, restored)
            assert restored['data'] == saved['data'], (saved, restored)
            report['checks']['appearancePersistence'] = True

            # Every effect remains mountable in the CPU fallback. The visual
            # reviewer separately checks actual GL output and visual variety.
            for value in values:
                await presets.select_option(value)
                await page.wait_for_timeout(35)
                assert await page.evaluate('!!__milkdropHost.controller')
            await page.locator('[data-milkdrop-action=random]').click()
            assert await presets.input_value() in values
            await page.locator('[data-milkdrop-action=clear]').click()
            report['checks']['allPresetsFallback'] = len(values)

            # Invalid persisted values use bounded defaults; malformed metadata
            # may not poison the animation, sound engine or preset picker.
            invalid = await page.evaluate("""() => {
              const state={schema:1,instrument:'milkdrop',appearance:{},sound:{},data:{version:1,lastPreset:{bad:true}}};
              __milkdropHost.controls.appearance.forEach((c,i)=>state.appearance[c.key]=c.kind==='select'?'__invalid__':c.kind==='toggle'?{}:i%2?null:1e300);
              __milkdropHost.controls.sound.forEach((c,i)=>state.sound[c.key]=c.kind==='select'?'__invalid__':i%2?null:1e300);
              return JSON.stringify(state);
            }""")
            # Write only after leaving MilkDrop, because navigation correctly
            # saves the previous controller's data before loading a new route.
            await page.evaluate("location.hash='carrier'")
            await loaded('carrier')
            await page.evaluate("value=>{localStorage.setItem('duo.instrument.milkdrop.v1',value);location.hash='milkdrop';}", invalid)
            await loaded()
            sanitized = await page.evaluate("""() => {
              const host=__milkdropHost, failures=[];
              for(const kind of ['sound','appearance'])for(const c of host.controls[kind]){
                const value=host.state[kind][c.key];
                if(c.kind==='select'){if(!c.options.some(([v])=>v===value))failures.push(c.key);}
                else if(c.kind==='toggle'){if(typeof value!=='boolean')failures.push(c.key);}
                else if(c.kind!=='color'&&(!Number.isFinite(value)||value<c.min||value>c.max))failures.push(c.key);
              }
              return {failures,data:host.controller.getData()};
            }""")
            assert not sanitized['failures'], sanitized
            await touch('touchStart', id=5, nx=.4, ny=.55)
            await source_count(1)
            await page.wait_for_function('__milkdropHost.audio.snapshot().rms > .0001')
            await touch('touchEnd', id=5)
            await source_count(0)
            report['checks']['invalidPersistedState'] = sanitized

            # Backgrounding must silence held contacts, and switching must
            # dispose the scene rather than accumulate canvases and listeners.
            await page.locator('#hold').click()
            await touch('touchStart', id=6, nx=.35, ny=.55)
            await touch('touchEnd', id=6)
            await source_count(1)
            await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));")
            await source_count(0)
            assert not await page.evaluate('__milkdropHost.state.playing || __milkdropHost.state.hold')
            for _ in range(2):
                await page.evaluate("location.hash='carrier'")
                await loaded('carrier')
                assert await page.locator('.milkdrop-root').count() == 0
                await page.evaluate("location.hash='milkdrop'")
                await loaded()
                assert await page.locator('.milkdrop-root').count() == 1
            await page.locator('#stage canvas[role=application]').first.focus()
            await page.keyboard.down('a')
            await source_count(1)
            await page.keyboard.up('a')
            await source_count(0)
            report['checks']['backgroundAndSwitchCleanup'] = True

            for width,height in ((1180,820),(390,844),(844,390)):
                await page.set_viewport_size({'width':width,'height':height})
                await page.wait_for_timeout(180)
                geometry = await page.evaluate("""() => {
                  const stage=document.querySelector('#stage').getBoundingClientRect(), play=document.querySelector('.milkdrop-play-surface').getBoundingClientRect();
                  return {overflow:document.documentElement.scrollWidth>innerWidth,stage:[stage.width,stage.height],play:[play.width,play.height],footer:document.querySelector('.bottom-bar').getBoundingClientRect().bottom};
                }""")
                assert not geometry['overflow'] and abs(geometry['footer']-height)<1 and geometry['play'][0]>width*.8 and geometry['play'][1]>height*.5, geometry
            report['checks']['responsiveGeometry'] = True
            report['errors'] = errors
            assert not errors, errors
            report['passed'] = True
        except Exception as error:
            report.update(passed=False, failure=str(error), errors=errors)
            try:
                report['stateAtFailure'] = await page.evaluate('({id:__milkdropHost.currentId,state:__milkdropHost.state,data:__milkdropHost.controller?.getData?.()})')
                await page.screenshot(path=str(OUT / 'failure.png'))
            except Exception:
                pass
            raise
        finally:
            (OUT / 'report.json').write_text(json.dumps(report, indent=2))
            print(json.dumps(report, indent=2), flush=True)
            await browser.close()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'), 180))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
