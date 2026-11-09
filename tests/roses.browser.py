#!/usr/bin/env python3
"""Production-host Roses touch, camera, audio and lifecycle regression.

Trusted Chromium touch events drive the real instrument; master recordings are
then decoded to verify actual PCM. This is browser emulation, not native iOS QA.
The route instrumentation exposes existing closures only in this test process.
"""
import asyncio
import functools
import json
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'roses-functional'

CAPTURE = r'''() => {
  const audio=__rosesHost.audio;
  if(!audio.context)audio._createContext();
  const ctx=audio.context,destination=ctx.createMediaStreamDestination();
  audio._master.connect(destination);
  const mime=['audio/webm;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(destination.stream,mime?{mimeType:mime}:{}),chunks=[];
  recorder.ondataavailable=event=>chunks.push(event.data);
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  window.finishRosesCapture=async()=>{
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
    def log_message(self, *_args): pass


async def run(base):
    OUT.mkdir(parents=True, exist_ok=True)
    report={'device':'Chromium touch emulation','checks':{}}
    async with async_playwright() as playwright:
        browser=await playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True,
            args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
        context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block')
        async def expose_host(route):
            source=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__rosesHost',{get:()=>({audio,state,controller,currentId,definition,controls})});"
            await route.fulfill(content_type='text/javascript',body=source)
        await context.route('**/collection.js',expose_host)
        async def expose_renderer(route):
            source=(ROOT/'instruments/roses.js').read_text().replace('renderer=new RosesRenderer','renderer=window.__rosesRenderer=new RosesRenderer')
            await route.fulfill(content_type='text/javascript',body=source)
        await context.route('**/instruments/roses.js',expose_renderer)
        page=await context.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        cdp=await context.new_cdp_session(page);contacts={}

        async def loaded(instrument='roses'):
            await page.wait_for_function("id=>window.__rosesHost?.currentId===id&&__rosesHost.controller&&!document.querySelector('#stage').hasAttribute('aria-busy')",arg=instrument)

        async def touch(kind,id=1,position=None):
            ended=None
            if kind in ('touchStart','touchMove'):
                contacts[id]={'id':id,'x':position['x'],'y':position['y'],'radiusX':4,'radiusY':4,'force':.7}
            else: ended=contacts.pop(id,None)
            if kind=='touchCancel':contacts.clear()
            points=[ended] if kind=='touchEnd' and contacts and ended else list(contacts.values())
            await cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})

        async def sources():
            return await page.evaluate("[...__rosesHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,physical:s.physical,options:s.options}))")

        async def count(number):
            await page.wait_for_function('n=>__rosesHost.audio.sources.size===n',arg=number)

        async def slider(kind,key,value):
            descriptor=await page.evaluate("([kind,key])=>__rosesHost.controls[kind].find(c=>c.key===key)",[kind,key]);assert descriptor,(kind,key)
            panel='#sound-popover' if kind=='sound' else '#appearance'
            if await page.locator(panel).is_hidden():await page.locator(f'#{kind}-toggle').click()
            await page.locator(f'[data-tabs={kind}] [data-group="{descriptor["section"]}"]').click()
            await page.locator(f'#{kind}-{key}').evaluate("(e,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}",value)

        async def close_panels():
            for panel in ['sound-popover','appearance']:
                if await page.locator('#'+panel).is_visible():await page.locator(f'[data-close={panel}]').click()

        def audible(pcm):
            assert pcm['rms']>.0004 and pcm['peak']<1 and pcm['nonFinite']==0,pcm

        async def petals():
            # Choose actual rendered glyph positions whose frontmost picker
            # reports the same petal. No assumed screen centres or DOM shims.
            return await page.evaluate("""async()=>{const m=await import('./instruments/roses.js'),r=__rosesRenderer,b=document.querySelector('#stage canvas').getBoundingClientRect(),seen=new Set(),out=[];for(const p of r.hitPoints){if(!p.visible||p.petal<0||seen.has(p.petal))continue;const hit=r.pick(p.x,p.y);if(hit?.id!==p.petal)continue;seen.add(p.petal);out.push({x:b.x+p.x,y:b.y+p.y,petal:p.petal,flower:p.flower,layer:r.petals.find(q=>q.id===p.petal)?.layer,degree:m.rosePetalDegree(p.petal,p.flower)});}return out;}""")

        async def petal(index=None,flower=None,exclude=None):
            points=await petals()
            found=next((p for p in points if (index is None or p['petal']==index) and (flower is None or p['flower']==flower) and p['petal']!=exclude),None)
            assert found,{'index':index,'flower':flower,'available':points}
            return found

        async def empty(nx=.1,ny=.5):
            return await page.evaluate("""([nx,ny])=>{const r=__rosesRenderer,b=document.querySelector('#stage canvas').getBoundingClientRect(),x=b.width*nx,y=b.height*ny;if(r.pick(x,y))throw Error('Expected empty camera point');return{x:b.x+x,y:b.y+y};}""",[nx,ny])

        async def camera():
            return await page.evaluate('__rosesHost.controller.getData().camera')

        try:
            await page.goto(base+'/collection.html#roses');await loaded()
            await page.evaluate("""()=>{window.__touchTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{__touchTrace.push({type,id:e.pointerId,x:e.clientX,y:e.clientY});if(__touchTrace.length>30)__touchTrace.shift();},{capture:true});}""")
            await page.wait_for_function('window.__rosesRenderer?.reveal>=1')
            assert not await page.evaluate('__rosesHost.state.playing')
            assert await page.evaluate('__rosesHost.state.sound.waveform')=='roses'
            visible=await petals();coverage={flower:len({p['petal'] for p in visible if p['flower']==flower}) for flower in range(5)}
            assert all(count>=2 for count in coverage.values()),coverage
            report['checks']['visibleFlowersHaveIndependentPetalTargets']=coverage
            await page.evaluate(CAPTURE)
            first_point=await petal(flower=0)
            first_camera=await camera()
            await touch('touchStart',position=first_point);await count(1)
            await page.wait_for_function('__rosesHost.audio.snapshot().rms>.0004',timeout=5000)
            first=(await sources())[0]
            assert first['id'].endswith('-'+str(first_point['petal'])),(first,first_point)
            await page.wait_for_timeout(450)
            await touch('touchEnd');await count(0);await page.wait_for_timeout(150)
            pcm=await page.evaluate('finishRosesCapture()');audible(pcm)
            assert not await page.evaluate('__rosesHost.state.playing')
            report['checks']['directPetalTouchBeforePlay']={**pcm,'petal':first_point['petal'],'midi':first['midi']}

            await slider('appearance','idleMotion',0);await close_panels()
            first_point=await petal(flower=0)
            second_point=next(p for p in await petals() if p['flower']==first_point['flower'] and p['degree']!=first_point['degree'])
            await touch('touchStart',id=11,position=first_point);await count(1)
            initial=(await sources())[0]
            await touch('touchMove',id=11,position=second_point);await count(1)
            moved=(await sources())[0]
            assert moved['midi']!=initial['midi'] and moved['id'].endswith('-'+str(second_point['petal'])),(initial,moved,second_point)
            assert await camera()==first_camera,'Petal gesture also orbited the camera'
            await touch('touchEnd',id=11);await count(0)
            report['checks']['individualPetalPitches']={'first':initial['midi'],'second':moved['midi'],'flower':first_point['flower']}

            available=await petals();responding=next(p for p in available if p['petal'] not in [first_point['petal'],second_point['petal']]);unrelated=next(p for p in available if p['flower']!=responding['flower'] and p['petal'] not in [first_point['petal'],second_point['petal']])
            before_positions=await page.evaluate("ids=>ids.map(id=>({...__rosesRenderer.projectPetal(id)}))",[responding['petal'],unrelated['petal']])
            await touch('touchStart',id=12,position=responding);await count(1);await page.wait_for_timeout(90)
            after_positions=await page.evaluate("ids=>ids.map(id=>({...__rosesRenderer.projectPetal(id)}))",[responding['petal'],unrelated['petal']])
            movement=[((a['x']-b['x'])**2+(a['y']-b['y'])**2)**.5 for a,b in zip(after_positions,before_positions)]
            assert movement[0]>.25 and movement[1]<.05,movement
            await touch('touchEnd',id=12);await count(0)
            report['checks']['localPetalDisplacement']={'playedPixels':movement[0],'unrelatedPixels':movement[1]}

            serial=await page.evaluate('__rosesHost.audio._serial')
            origin=await empty();destination={'x':origin['x']+95,'y':origin['y']+30}
            before=await camera()
            await touch('touchStart',id=21,position=origin)
            await touch('touchMove',id=21,position=destination)
            await touch('touchEnd',id=21);await count(0)
            after=await camera()
            assert abs(after['yaw']-before['yaw'])>.2 and after['zoom']==before['zoom'],(before,after)
            assert await page.evaluate('__rosesHost.audio._serial')==serial,'Background orbit played a note'
            await page.wait_for_timeout(100)
            rotated=await petal()
            await touch('touchStart',id=22,position=rotated);await count(1)
            assert (await sources())[0]['id'].endswith('-'+str(rotated['petal']))
            await touch('touchEnd',id=22);await count(0)
            report['checks']['orbitDoesNotPlayOrZoom']={'before':before,'after':after}
            report['checks']['pickingAfterOrbit']=True

            left=await empty(.08,.42);right=await empty(.92,.42)
            before=await camera();serial=await page.evaluate('__rosesHost.audio._serial')
            await touch('touchStart',id=23,position=left);await touch('touchStart',id=24,position=right)
            await touch('touchMove',id=24,position={'x':right['x']-125,'y':right['y']})
            after=await camera()
            assert after['zoom']<before['zoom']-.08 and after['yaw']==before['yaw'] and after['pitch']==before['pitch'],(before,after)
            await touch('touchEnd',id=24)
            await touch('touchMove',id=23,position={'x':left['x']+24,'y':left['y']+4})
            await page.wait_for_function('yaw=>__rosesHost.controller.getData().camera.yaw!==yaw',arg=after['yaw'],timeout=3000)
            remaining=await camera()
            assert remaining['zoom']==after['zoom'] and remaining['yaw']!=after['yaw'],(after,remaining)
            await touch('touchEnd',id=23);await count(0)
            assert await page.evaluate('__rosesHost.audio._serial')==serial
            report['checks']['backgroundPinchOnlyChangesZoom']={'before':before,'after':after}

            # A held petal remains attached to its object-space identity while
            # another finger orbits the sculpture in empty space.
            held_point=await petal()
            await touch('touchStart',id=31,position=held_point);await count(1)
            held=(await sources())[0];before=await camera()
            origin=await empty(.1,.55)
            await touch('touchStart',id=32,position=origin)
            await touch('touchMove',id=32,position={'x':origin['x']+70,'y':origin['y']-22})
            after=await camera();still=(await sources())[0]
            assert still['id']==held['id'] and still['midi']==held['midi'] and after['zoom']==before['zoom'],(held,still,before,after)
            assert after['yaw']!=before['yaw']
            await touch('touchEnd',id=32);await count(1)
            await touch('touchEnd',id=31);await count(0)
            report['checks']['petalAndOrbitOwnership']=True

            # Two petals have independent source lifetimes, including latching
            # and arpeggiation; cancelling a third does not release either.
            available=await petals();pair=[available[0],next(p for p in reversed(available) if p['degree']!=available[0]['degree'])]
            await touch('touchStart',id=41,position=pair[0]);await touch('touchStart',id=42,position=pair[1]);await count(2)
            pair_sources=await sources()
            await touch('touchEnd',id=41);await count(1)
            assert (await sources())[0]['id']==pair_sources[1]['id']
            await touch('touchEnd',id=42);await count(0)
            await page.locator('#hold').click()
            for pointer,point in [(43,pair[0]),(44,pair[1])]:
                await touch('touchStart',id=pointer,position=point);await page.wait_for_timeout(70);await touch('touchEnd',id=pointer)
            await count(2);held=await sources();assert all(not s['physical'] for s in held)
            await page.locator('#arp').click()
            heard=await page.evaluate("""async()=>{const ids=new Set();for(let i=0;i<32;i++){for(const v of __rosesHost.audio.snapshot().voices)if(v.kind==='arp'&&v.gate)ids.add(v.id);await new Promise(r=>setTimeout(r,50));}return [...ids];}""")
            assert all(s['id'] in heard for s in held),(held,heard)
            await touch('touchStart',id=45,position=await petal());await count(3)
            await touch('touchCancel',id=45);await count(2)
            await page.locator('#hold').click();await count(0);await page.locator('#arp').click()
            report['checks']['independentContactsAndHoldArpCancel']={'held':[s['id'] for s in held],'arpeggiated':heard}

            # A single held swipe owns every petal it visits. Cancellation must
            # clear that gesture's whole chord without touching another latch.
            await page.locator('#hold').click()
            await touch('touchStart',id=46,position=await petal());await touch('touchEnd',id=46);await count(1)
            independent=(await sources())[0]
            visited=set();previous=None
            for step in range(3):
                choices=[p for p in await petals() if p['petal'] not in visited]
                target=max(choices,key=lambda p:(p['x']-previous['x'])**2+(p['y']-previous['y'])**2) if previous else choices[0]
                previous=target
                await touch('touchStart' if step==0 else 'touchMove',id=47,position=target)
                visited.add(target['petal']);await count(step+2);await page.wait_for_timeout(40)
            chord=await sources();assert len(chord)==4
            await touch('touchCancel',id=47);await count(1)
            assert (await sources())[0]['id']==independent['id']
            await page.locator('#hold').click();await count(0)
            await page.locator('#hold').click();visited=set();previous=None
            for step in range(3):
                choices=[p for p in await petals() if p['petal'] not in visited]
                target=max(choices,key=lambda p:(p['x']-previous['x'])**2+(p['y']-previous['y'])**2) if previous else choices[0]
                previous=target
                await touch('touchStart' if step==0 else 'touchMove',id=48,position=target)
                visited.add(target['petal']);await count(step+1);await page.wait_for_timeout(40)
            await touch('touchEnd',id=48);await count(3)
            assert all(not s['physical'] for s in await sources())
            await page.locator('#hold').click();await count(0)
            report['checks']['heldSwipeCancelIsScopedAndReleasePreservesChord']=True

            await page.locator('#hold').click()
            await touch('touchStart',id=51,position=await petal());await touch('touchEnd',id=51);await count(1)
            expressive=(await sources())[0]
            await slider('appearance','glyphSize',1.25);await close_panels()
            assert (await sources())[0]['options']==expressive['options']
            await slider('sound','release',1.75);await close_panels()
            changed=(await sources())[0]
            assert changed['id']==expressive['id'] and abs(changed['options']['release']-1.75)<.001
            for key,value in expressive['options'].items():
                if key!='release':assert changed['options'][key]==value,(key,value,changed['options'][key])
            await page.locator('#hold').click();await count(0)
            report['checks']['settingsPreserveContactExpression']=True

            stable_point=next(p for p in await petals() if p['flower']>0 and p['layer']==0)
            stable_id=stable_point['petal']
            await page.locator('#hold').click()
            await touch('touchStart',id=52,position=stable_point);await touch('touchEnd',id=52);await count(1)
            stable_source=(await sources())[0]
            for layers in [2,5,4]:
                await slider('appearance','petalLayers',layers);await close_panels();await page.wait_for_timeout(100)
                identity=await page.evaluate('id=>{const p=__rosesRenderer.petals.find(p=>p.id===id);return p&&{id:p.id,flower:p.flower,layer:p.layer};}',stable_id)
                assert identity=={'id':stable_id,'flower':stable_point['flower'],'layer':0},identity
                assert (await sources())[0]['id']==stable_source['id'] and (await sources())[0]['midi']==stable_source['midi']
                projected=await petal(index=stable_id)
                assert projected['flower']==stable_point['flower']
            await page.locator('#hold').click();await count(0)
            report['checks']['petalIdentitySurvivesLayerEditing']=True

            await page.locator('#stage canvas[role=application]').focus()
            await page.keyboard.down('a');await count(1)
            assert (await sources())[0]['id']=='key-a' and (await sources())[0]['options']['waveform']=='roses'
            await page.keyboard.up('a');await count(0)
            report['checks']['keyboardVoice']=True

            sequence_coverage={}
            for layers in [2,4,5]:
                await slider('appearance','petalLayers',layers);await close_panels();await page.wait_for_timeout(100)
                cycles=await page.evaluate("""()=>{const h=__rosesHost,audio=h.audio,original=audio.pulse,old=h.state.sound.scanRate,out={};try{for(const rate of [1,2,4]){const events=[];audio.pulse=(id,midi,options,when,duration)=>events.push({id,midi,when,duration});h.state.sound.scanRate=String(rate);h.controller.setPlaying(false);h.controller.setPlaying(true);for(let s=0;s<64;s++)h.controller.onStep(s%16,10+s*.125);out[rate]=events;}}finally{audio.pulse=original;h.state.sound.scanRate=old;h.controller.setPlaying(false);}return out;}""")
                petal_flowers=await page.evaluate('Object.fromEntries(__rosesRenderer.petals.map(p=>[p.id,p.flower]))')
                for rate,events in cycles.items():
                    petals_events=[e for e in events if e['id'].startswith('roses-seq-')]
                    assert len(petals_events)==64//int(rate),(rate,events)
                    flowers={petal_flowers[e['id'].rsplit('-',1)[1]] for e in petals_events}
                    assert flowers==set(range(5)),(rate,flowers,petals_events)
                    assert all(e['duration']>0 for e in events)
                sequence_coverage[layers]={rate:len(events) for rate,events in cycles.items()}
            await slider('appearance','petalLayers',4);await close_panels()
            report['checks']['sequenceVisitsEveryFlowerAtEveryLayerCount']=sequence_coverage

            await page.evaluate(CAPTURE);await page.locator('#play').click()
            await page.wait_for_function("__rosesHost.audio.snapshot().voices.some(v=>v.kind==='sequence')")
            await page.wait_for_timeout(1700)
            sequence=await page.evaluate('finishRosesCapture()');audible(sequence)
            await page.locator('#play').click();serial=await page.evaluate('__rosesHost.audio._serial');await page.wait_for_timeout(700)
            assert await page.evaluate('__rosesHost.audio._serial')==serial
            report['checks']['sequencePCM']=sequence;report['checks']['pauseCancelsFutureNotes']=True

            await page.locator('#sound-toggle').click();await page.locator('#appearance-toggle').click()
            assert await page.locator('#sound-popover').is_visible() and await page.locator('#appearance').is_visible()
            assert await page.evaluate('document.activeElement.tagName')!='SELECT'
            await close_panels();report['checks']['independentPanelsAndNeutralFocus']=True

            await page.wait_for_timeout(300)
            saved=await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.roses.v1'))")
            await page.reload();await loaded();await page.wait_for_function('window.__rosesRenderer?.reveal>=1')
            assert await page.evaluate('__rosesHost.state.appearance')==saved['appearance']
            assert await page.evaluate('__rosesHost.controller.getData()')==saved['data']
            report['checks']['settingsAndCameraPersistence']=True

            sizes=[]
            for width,height in [(1366,1024),(390,844),(844,390)]:
                await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(250)
                selected=await petal()
                await touch('touchStart',id=61,position=selected);await count(1)
                value=(await sources())[0]
                assert value['id'].endswith('-'+str(selected['petal']))
                await touch('touchEnd',id=61);await count(0)
                bounds=await page.evaluate("({scroll:document.documentElement.scrollWidth,stage:document.querySelector('#stage').getBoundingClientRect().toJSON(),footer:document.querySelector('.bottom-bar').getBoundingClientRect().toJSON()})")
                assert bounds['scroll']<=width+1 and bounds['stage']['bottom']<=bounds['footer']['top']+1,bounds
                sizes.append({'width':width,'height':height,'petal':selected['petal'],'midi':value['midi']})
            report['checks']['responsiveProjectedPicking']=sizes

            await page.locator('#hold').click();await touch('touchStart',id=71,position=await petal());await touch('touchEnd',id=71);await count(1)
            await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));")
            await count(0);assert not await page.evaluate('__rosesHost.state.hold||__rosesHost.state.playing')
            canvas_count=await page.locator('#stage canvas').count()
            old=await page.evaluate('()=>{window.oldRosesRenderer=__rosesRenderer;return true;}')
            for instrument in ['relay','cellular','roses']:
                await page.evaluate('(id)=>location.hash=id',instrument);await loaded(instrument)
                assert await page.evaluate('__rosesHost.audio.sources.size')==0
            assert await page.locator('#stage canvas').count()==canvas_count
            assert await page.evaluate('oldRosesRenderer.faces.length===0&&oldRosesRenderer.hitPoints.length===0&&oldRosesRenderer.atlas.width===0&&oldRosesRenderer.field.width===0&&oldRosesRenderer.ids.width===0')
            report['checks']['backgroundAndNavigationCleanup']=True
            await page.wait_for_function('__rosesRenderer.reveal>=1')
            await page.screenshot(path=str(OUT/'landscape.png'))
            assert not errors,errors
            report['passed']=True;print(json.dumps(report,indent=2))
        except Exception as error:
            report['passed']=False;report['failure']=str(error);report['touchTrace']=await page.evaluate('window.__touchTrace||[]');report['sourcesAtFailure']=await sources();report['holdAtFailure']=await page.evaluate('__rosesHost.state.hold');raise
        finally:
            report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2))
            await context.close();await browser.close()


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),240))
    finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':main()
