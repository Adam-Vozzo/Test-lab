#!/usr/bin/env python3
"""Relay's production-host touch, sound, persistence and lifecycle regression.

Native Chromium touch events and decoded master PCM, with WebGL disabled to
exercise the playable fallback. This does not claim native iOS or device FPS.
"""
import asyncio
import functools
import json
import shutil
import threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'relay-functional'

CAPTURE = r'''() => {
  const audio=__relayHost.audio;
  if(!audio.context)audio._createContext();
  const ctx=audio.context,destination=ctx.createMediaStreamDestination();
  audio._master.connect(destination);
  const mime=['audio/webm;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(destination.stream,mime?{mimeType:mime}:{}),chunks=[];
  recorder.ondataavailable=event=>chunks.push(event.data);
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  window.finishRelayCapture=async()=>{
    recorder.stop();await stopped;
    const bytes=await new Blob(chunks).arrayBuffer(),byteLength=bytes.byteLength,buffer=await ctx.decodeAudioData(bytes);
    let power=0,peak=0,count=0,nonFinite=0;
    for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const value of buffer.getChannelData(ch)){
      if(!Number.isFinite(value)){nonFinite++;continue;}
      power+=value*value;peak=Math.max(peak,Math.abs(value));count++;
    }
    audio._master.disconnect(destination);destination.stream.getTracks().forEach(track=>track.stop());destination.disconnect();
    return{rms:Math.sqrt(power/Math.max(1,count)),peak,nonFinite,duration:buffer.duration,bytes:byteLength};
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
            executable_path=shutil.which('chromium'), headless=True,
            args=['--no-sandbox', '--disable-webgl', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'],
        )
        context = await browser.new_context(viewport={'width':844, 'height':390}, has_touch=True, service_workers='block')

        async def expose_host(route):
            source = (ROOT / 'collection.js').read_text()
            source += "\nObject.defineProperty(window,'__relayHost',{get:()=>({audio,state,controller,currentId,definition,controls})});"
            await route.fulfill(content_type='text/javascript', body=source)

        await context.route('**/collection.js', expose_host)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        cdp = await context.new_cdp_session(page)
        contacts = {}

        async def loaded(id='relay'):
            await page.wait_for_function("id=>window.__relayHost?.currentId===id&&__relayHost.controller&&!document.querySelector('#stage').hasAttribute('aria-busy')", arg=id)

        async def point(tine=2):
            # Use the same public layout geometry that is rendered, rather
            # than a hardcoded screen position that can miss after rotation.
            return await page.evaluate("""async index=>{
              const{relayLayout}=await import('./instruments/relay.js');
              const b=document.querySelector('#stage').getBoundingClientRect();
              const layout=relayLayout(b.width,b.height),t=layout.tines[index];
              return{x:b.x+t.x+t.w*.5,y:b.y+t.y+t.h*.45};
            }""", tine)

        async def touch(kind, id=1, position=None):
            ended = None
            if kind in ('touchStart', 'touchMove'):
                position = position or await point()
                contacts[id] = {'id':id, **position, 'radiusX':4, 'radiusY':4, 'force':.7}
            else:
                ended = contacts.pop(id, None)
            if kind == 'touchCancel':
                contacts.clear()
            points = [ended] if kind == 'touchEnd' and contacts and ended else list(contacts.values())
            await cdp.send('Input.dispatchTouchEvent', {'type':kind, 'touchPoints':points})

        async def sources():
            return await page.evaluate("[...__relayHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,physical:s.physical,options:s.options}))")

        async def source_count(count):
            await page.wait_for_function('count=>__relayHost.audio.sources.size===count', arg=count)

        async def slider(kind, key, value):
            descriptor = await page.evaluate("([kind,key])=>__relayHost.controls[kind].find(c=>c.key===key)", [kind,key])
            assert descriptor, f'Missing {kind} control {key}'
            selector = '#sound-popover' if kind == 'sound' else '#appearance'
            if await page.locator(selector).is_hidden():
                await page.locator(f'#{kind}-toggle').click()
            await page.locator(f'[data-tabs={kind}] [data-group="{descriptor["section"]}"]').click()
            await page.locator(f'#{kind}-{key}').evaluate("(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}", value)

        async def close_panels():
            for selector, close in [('#sound-popover','sound-popover'),('#appearance','appearance')]:
                if await page.locator(selector).is_visible():
                    await page.locator(f'[data-close={close}]').click()

        def audible(pcm):
            assert pcm['rms'] > .0004 and pcm['peak'] < 1 and not pcm['nonFinite'], pcm

        try:
            await context.add_init_script("if(!localStorage.getItem('relay-qa-seeded')){localStorage.setItem('duo.instrument.carrier.v1',JSON.stringify({schema:1,instrument:'carrier',sound:{index:5.8,ratio:7.5},appearance:{paper:'#ffffff',ribbonWidth:1.7},data:{ends:[{nx:.1,ny:.2}]}}));localStorage.setItem('relay-qa-seeded','1');}")
            await page.goto(base + '/collection.html#carrier')
            await loaded()
            assert await page.evaluate('location.hash') == '#relay'
            assert await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.carrier.v1')).sound.index") == 5.8
            assert await page.evaluate('__relayHost.state.sound.waveform') == 'resonator'
            assert not await page.evaluate("Object.hasOwn(__relayHost.state.appearance,'paper')")
            report['checks']['oldRoutePreservesOldStorage'] = True
            assert not await page.evaluate('__relayHost.state.playing')
            assert not await page.locator('[data-instrument=carrier]').count()
            await page.evaluate(CAPTURE)
            await touch('touchStart', position=await point(1))
            await source_count(1)
            await page.wait_for_function('__relayHost.audio.snapshot().rms>.0004', timeout=4000)
            before = (await sources())[0]
            assert before['options']['waveform'] == 'resonator', before
            before_serial = await page.evaluate('__relayHost.audio._serial')
            await page.wait_for_timeout(300)
            await touch('touchMove', position=await point(6))
            await page.wait_for_timeout(200)
            after = (await sources())[0]
            assert after['midi'] != before['midi'] and after['id'] == before['id'], (before, after)
            restrike = await page.evaluate("id=>__relayHost.audio._voices.filter(v=>v.id===id&&v.releaseAt===null).map(v=>({serial:v.serial,midi:v.midi,modal:!!v.resonator}))", after['id'])
            assert len(restrike)==1 and restrike[0]['serial']>before_serial and restrike[0]['modal'] and restrike[0]['midi']==after['midi'], restrike
            await touch('touchEnd')
            await source_count(0)
            await page.wait_for_timeout(250)
            direct = await page.evaluate('finishRelayCapture()')
            audible(direct)
            assert not await page.evaluate('__relayHost.state.playing')
            report['checks']['directTouchAudio'] = {**direct, 'startMidi':before['midi'], 'endMidi':after['midi']}
            report['checks']['crossingReedRestrikesModalVoice'] = True

            # Independent contacts must survive the other pointer's release.
            await touch('touchStart', id=11, position=await point(1))
            await touch('touchStart', id=12, position=await point(5))
            await source_count(2)
            pair = await sources()
            assert len({s['midi'] for s in pair}) == 2, pair
            await touch('touchEnd', id=11)
            await source_count(1)
            survivor = (await sources())[0]
            assert survivor['id'] == pair[1]['id']
            await touch('touchEnd', id=12)
            await source_count(0)
            report['checks']['independentContacts'] = True

            chamber = await page.evaluate("""async()=>{const{relayLayout}=await import('./instruments/relay.js'),b=document.querySelector('#stage').getBoundingClientRect(),r=relayLayout(b.width,b.height).chamber;return{x:b.x+r.x,y:b.y+r.y,w:r.w,h:r.h};}""")
            await touch('touchStart', id=14, position={'x':chamber['x']+chamber['w']*.25,'y':chamber['y']+chamber['h']*.3})
            await source_count(1)
            current = (await sources())[0]
            await touch('touchMove', id=14, position={'x':chamber['x']+chamber['w']*.75,'y':chamber['y']+chamber['h']*.65})
            updated = (await sources())[0]
            sound = await page.evaluate('__relayHost.state.sound')
            assert abs(sound['material']-.75)<.01 and abs(sound['damping']-.65)<.01, sound
            assert updated['id']==current['id'] and updated['midi']==current['midi']
            await touch('touchStart', id=13, position=await point(1))
            await source_count(2)
            other = next(s for s in await sources() if s['id']!=current['id'])
            assert other['midi'] != current['midi'], (other,current)
            await touch('touchMove', id=14, position={'x':chamber['x']+chamber['w']*.6,'y':chamber['y']+chamber['h']*.45})
            preserved = next(s for s in await sources() if s['id']==current['id'])
            assert preserved['midi']==current['midi'], (current,preserved,other)
            await touch('touchEnd', id=13)
            await source_count(1)
            await touch('touchEnd', id=14)
            await source_count(0)
            report['checks']['chamberMaterialAndDamping'] = True
            report['checks']['chamberPitchIndependentOfOtherContact'] = {'chamberMidi':current['midi'],'reedMidi':other['midi']}

            await touch('touchStart', id=15, position=await point(2))
            await source_count(1)
            identity=(await sources())[0]['id']
            dial = await page.evaluate("""async()=>{const{relayLayout}=await import('./instruments/relay.js'),b=document.querySelector('#stage').getBoundingClientRect(),r=relayLayout(b.width,b.height).dials[0];return{x:b.x+r.x,y:b.y+r.y};}""")
            brightness = await page.evaluate('__relayHost.state.sound.brightness')
            await touch('touchStart', id=16, position=dial)
            await touch('touchMove', id=16, position={'x':dial['x']+20,'y':dial['y']-30})
            await source_count(1)
            assert (await sources())[0]['id']==identity
            assert await page.evaluate('__relayHost.state.sound.brightness') > brightness+.1
            await touch('touchEnd', id=16)
            await source_count(1)
            await touch('touchEnd', id=15)
            await source_count(0)
            report['checks']['dialDuringHeldContact'] = True

            seq = await page.evaluate("""async()=>{const{relayLayout}=await import('./instruments/relay.js'),b=document.querySelector('#stage').getBoundingClientRect(),r=relayLayout(b.width,b.height).sequence;return{x:b.x+r.x+r.w/32,y:b.y+r.y+r.h*.5};}""")
            original = await page.evaluate('__relayHost.controller.getData()')
            await touch('touchStart', id=17, position=seq)
            await source_count(1)
            await touch('touchEnd', id=17)
            await source_count(0)
            muted = await page.evaluate('__relayHost.controller.getData()')
            assert muted['enabled'][0] != original['enabled'][0]
            await touch('touchStart', id=18, position=seq)
            await touch('touchMove', id=18, position={'x':seq['x'],'y':seq['y']-45})
            await touch('touchEnd', id=18)
            await source_count(0)
            raised = await page.evaluate('__relayHost.controller.getData()')
            assert raised['pattern'][0] > original['pattern'][0] and raised['enabled'][0], raised
            report['checks']['sequenceEditing'] = {'before':original['pattern'][0],'after':raised['pattern'][0],'tapMutes':True}

            await page.locator('#hold').click()
            for id, tine in [(21,1),(22,5)]:
                await touch('touchStart', id=id, position=await point(tine))
                await page.wait_for_timeout(100)
                await touch('touchEnd', id=id)
            await source_count(2)
            held = await sources()
            assert all(not s['physical'] for s in held), held
            await page.locator('#arp').click()
            heard = await page.evaluate("""async()=>{const notes=new Set();for(let i=0;i<28;i++){for(const v of __relayHost.audio.snapshot().voices)if(v.kind==='arp'&&v.gate)notes.add(v.midi);await new Promise(r=>setTimeout(r,50));}return[...notes];}""")
            assert len(heard) >= 2 and all(s['midi'] in heard for s in held), (held, heard)
            await touch('touchStart', id=23, position=await point(7))
            await source_count(3)
            await touch('touchCancel', id=23)
            await source_count(2)
            await page.locator('#hold').click()
            await source_count(0)
            await page.locator('#arp').click()
            report['checks']['holdArpCancel'] = {'held':[s['midi'] for s in held], 'arpeggiated':heard}

            # Actual shared controls must reach the new synthesis mode while
            # a latched voice is live, without resetting or duplicating it.
            await page.locator('#hold').click()
            await touch('touchStart', id=31, position=await point(3))
            await touch('touchEnd', id=31)
            await source_count(1)
            identity = (await sources())[0]['id']
            note_options = (await sources())[0]['options']
            await slider('appearance', 'packetSize', 2.7)
            await close_panels()
            assert (await sources())[0]['options'] == note_options, 'Appearance editing changed the touched reed sound'
            report['checks']['appearanceDoesNotChangeNoteTimbre'] = True
            for key, value in [('material',.81),('damping',.27),('brightness',.73)]:
                await slider('sound', key, value)
                current = (await sources())[0]
                assert current['id'] == identity and abs(current['options'][key]-value) < .0001, current
                assert current['options']['strike']==note_options['strike'] and current['options']['pan']==note_options['pan'], (key,note_options,current)
            await close_panels()
            await page.locator('#hold').click()
            await source_count(0)
            report['checks']['liveSoundControls'] = True
            report['checks']['soundEditingPreservesContactExpression'] = True

            await page.locator('#stage canvas[role=application]:not([aria-hidden=true])').focus()
            await page.keyboard.down('a')
            await source_count(1)
            assert (await sources())[0]['id'] == 'key-a'
            assert (await sources())[0]['options']['waveform'] == 'resonator'
            await page.keyboard.up('a')
            await source_count(0)
            report['checks']['keyboardNotes'] = True

            await page.evaluate(CAPTURE)
            await page.locator('#play').click()
            await page.wait_for_function("__relayHost.audio.snapshot().voices.some(v=>v.kind==='sequence')")
            await page.wait_for_timeout(1800)
            sequence = await page.evaluate('finishRelayCapture()')
            audible(sequence)
            await page.locator('#play').click()
            serial = await page.evaluate('__relayHost.audio._serial')
            await page.wait_for_timeout(650)
            assert await page.evaluate('__relayHost.audio._serial') == serial
            report['checks']['sequenceAudio'] = sequence
            report['checks']['pauseCancelsFutureNotes'] = True

            # One real appearance edit, persisted through production controls.
            descriptor = await page.evaluate("__relayHost.controls.appearance.find(c=>(!c.kind||c.kind==='range')&&c.section!=='Post-processing')")
            value = descriptor['min'] + (descriptor['max']-descriptor['min'])*.6
            await slider('appearance', descriptor['key'], value)
            await close_panels()
            await page.wait_for_timeout(250)
            saved = await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.relay.v1'))")
            await page.reload()
            await loaded()
            assert await page.evaluate('__relayHost.state.appearance') == saved['appearance']
            assert await page.evaluate('__relayHost.controller.getData()') == saved['data']
            report['checks']['appearanceAndDataPersistence'] = True

            sizes = []
            for width,height in [(1366,1024),(390,844),(844,390)]:
                await page.set_viewport_size({'width':width,'height':height})
                await page.wait_for_timeout(250)
                await touch('touchStart', id=41, position=await point(4))
                await source_count(1)
                selected = (await sources())[0]['midi']
                await touch('touchEnd', id=41)
                await source_count(0)
                bounds = await page.evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth,stage:document.querySelector('#stage').getBoundingClientRect().toJSON(),footer:document.querySelector('.bottom-bar').getBoundingClientRect().toJSON()})")
                assert bounds['scroll'] <= width+1 and bounds['stage']['bottom'] <= bounds['footer']['top']+1, bounds
                sizes.append({'width':width,'height':height,'midi':selected})
            assert len({entry['midi'] for entry in sizes}) == 1, sizes
            report['checks']['responsivePicking'] = sizes

            await page.locator('#hold').click()
            await touch('touchStart', id=51, position=await point(2))
            await touch('touchEnd', id=51)
            await source_count(1)
            await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));")
            await source_count(0)
            assert not await page.evaluate('__relayHost.state.hold||__relayHost.state.playing')
            canvas_count = await page.locator('#stage canvas').count()
            for _ in range(2):
                await page.evaluate("location.hash='cellular'")
                await loaded('cellular')
                await page.evaluate("location.hash='relay'")
                await loaded()
                assert await page.locator('#stage canvas').count() == canvas_count
                assert await page.evaluate('__relayHost.audio.sources.size') == 0
            report['checks']['backgroundAndSwitchCleanup'] = True
            await page.screenshot(path=str(OUT / 'fallback-landscape.png'))
            assert not errors, errors
            report['passed'] = True
            print(json.dumps(report, indent=2))
        finally:
            report['errors'] = errors
            (OUT / 'report.json').write_text(json.dumps(report, indent=2))
            await context.close()
            await browser.close()


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),180))
    finally:
        server.shutdown();server.server_close();thread.join()


if __name__ == '__main__':
    main()
