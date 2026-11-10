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

# Values supplied by the user, independent of the instrument's defaults.
USER_APPEARANCE={'sceneBlur':0,'sceneGrain':0,'sceneGrainSize':1,'petalColour':'#d82c75','leafColour':'#82aa8e','petalWidth':1.25,'petalCurl':.55,'petalLayers':5,'bloomScale':1.1,'bouquetSpread':1.05,'leafSize':.9,'glyphStyle':'ascii','glyphDensity':1.4,'glyphSize':1.45,'exposure':1.1,'wireContrast':.4,'lineWeight':.5,'glow':.85,'glowRadius':.6,'sceneScale':1.15,'revealDuration':6,'idleMotion':1.5,'motionRate':.8,'response':.2,'spray':1,'readoutContrast':.88,'readoutSize':1}
USER_CAMERA={'yaw':.19433333333333686,'pitch':6.55833333333334,'zoom':.7590744829719918,'offsetX':0,'offsetY':0}
USER_SOUND={'waveform':'roses','roseBody':.32,'roseGlass':.72,'roseDecay':.56,'roseWidth':.18,'roseMotion':.22,'attack':.02,'decay':.35,'sustain':.72,'release':1.6,'gain':.72,'cutoff':12000,'resonance':.5,'echo':.2,'delayTime':.39,'feedback':.28,'glide':.06,'detune':0,'pan':0,'gate':.55,'scanRate':'2','bedLevel':.24,'ratio':1,'index':0}
NEW_APPEARANCE={'saturation':1.3,'highlightGain':1.25,'idleRotation':.035}

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
            source=(ROOT/'instruments/roses.js').read_text().replace('renderer=new RosesRenderer','renderer=window.__rosesRenderer=new RosesRenderer').replace('const garden=createRoseGarden','const garden=window.__rosesGarden=createRoseGarden')
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
            return await page.evaluate("""async()=>{const m=await import('./instruments/roses.js'),r=__rosesRenderer,b=document.querySelector('#stage canvas').getBoundingClientRect(),seen=new Set(),out=[];for(const p of r.hitPoints){if(!p.visible||p.petal<0||p.petal>=220||p.x<8||p.y<8||p.x>b.width-8||p.y>b.height-8||seen.has(p.petal))continue;const hit=r.pick(p.x,p.y);if(hit?.id!==p.petal)continue;seen.add(p.petal);out.push({x:b.x+p.x,y:b.y+p.y,petal:p.petal,flower:p.flower,layer:r.petals.find(q=>q.id===p.petal)?.layer,degree:m.rosePetalDegree(p.petal,p.flower)});}return out;}""")

        async def petal(index=None,flower=None,exclude=None):
            points=await petals()
            found=next((p for p in points if (index is None or p['petal']==index) and (flower is None or p['flower']==flower) and p['petal']!=exclude),None)
            assert found,{'index':index,'flower':flower,'available':points}
            return found

        async def foliage(kind=None):
            points=await page.evaluate("""()=>{const r=__rosesRenderer,b=document.querySelector('#stage canvas').getBoundingClientRect(),seen=new Set(),out=[];for(const p of r.interactionPoints){if(p.id<220||p.x<8||p.y<8||p.x>b.width-8||p.y>b.height-8||seen.has(p.id)||r.pick(p.x,p.y)?.id!==p.id)continue;seen.add(p.id);out.push({x:b.x+p.x,y:b.y+p.y,id:p.id,kind:p.kind});}return out;}""")
            if kind is None:return points
            result=next((point for point in points if point['kind']==kind),None)
            assert result,{'missingKind':kind,'points':points}
            return result

        async def empty(nx=.1,ny=.5):
            return await page.evaluate("""([nx,ny])=>{const r=__rosesRenderer,b=document.querySelector('#stage canvas').getBoundingClientRect(),x=b.width*nx,y=b.height*ny;if(r.pick(x,y))throw Error('Expected empty camera point');return{x:b.x+x,y:b.y+y};}""",[nx,ny])

        async def camera():
            return await page.evaluate('__rosesHost.controller.getData().camera')

        try:
            await page.goto(base+'/collection.html#roses');await loaded()
            initial_state=await page.evaluate('({appearance:__rosesHost.state.appearance,sound:__rosesHost.state.sound,bpm:__rosesHost.state.bpm,root:__rosesHost.state.root,scale:__rosesHost.state.scale,arp:__rosesHost.state.arp,arpRate:__rosesHost.state.arpRate})')
            for key,value in {**USER_APPEARANCE,**NEW_APPEARANCE}.items():assert initial_state['appearance'][key]==value,(key,value,initial_state['appearance'][key])
            for key,value in USER_SOUND.items():assert initial_state['sound'][key]==value,(key,value,initial_state['sound'][key])
            assert await camera()==USER_CAMERA,(await camera(),USER_CAMERA)
            assert {key:initial_state[key] for key in ['bpm','root','scale','arp','arpRate']}=={'bpm':112,'root':50,'scale':'dorian','arp':False,'arpRate':8},initial_state
            report['checks']['freshDefaultsMatchSuppliedPreset']=True
            await slider('appearance','petalLayers',2);await close_panels()
            await page.evaluate('__rosesHost.controller.setData({camera:{yaw:1.2,pitch:.3,zoom:1.5,offsetX:.1,offsetY:.1}})')
            imported={'format':'duo-instrument','schema':1,'instrument':'roses','appearance':USER_APPEARANCE,'sound':USER_SOUND,'data':{'camera':USER_CAMERA},'bpm':112,'root':50,'scale':'dorian','arp':False,'arpRate':8}
            await page.locator('#import-look').set_input_files({'name':'roses-user-preset.json','mimeType':'application/json','buffer':json.dumps(imported).encode()})
            await page.wait_for_function('__rosesHost.state.appearance.petalLayers===5&&__rosesHost.controller.getData().camera.zoom<.76')
            imported_appearance=await page.evaluate('__rosesHost.state.appearance')
            for key,value in {**USER_APPEARANCE,**NEW_APPEARANCE}.items():assert imported_appearance[key]==value,(key,value,imported_appearance[key])
            assert await camera()==USER_CAMERA
            assert not await page.evaluate('__rosesHost.state.hold||__rosesHost.state.playing')
            report['checks']['suppliedPresetImportsWithoutLosingNewControls']=True
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

            await slider('appearance','idleMotion',0);await slider('appearance','idleRotation',0);await slider('appearance','response',0);await close_panels()
            await page.evaluate('__rosesHost.controller.setData(__rosesHost.controller.getData())');await page.wait_for_timeout(1200)
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

            await slider('appearance','response',.85);await close_panels()
            available=await petals();responding=next(p for p in available if p['flower']!=first_point['flower']);unrelated=next(p for p in available if p['flower'] not in [responding['flower'],first_point['flower']])
            before_positions=await page.evaluate("ids=>ids.map(id=>({...__rosesRenderer.projectPetal(id)}))",[responding['petal'],unrelated['petal']])
            await touch('touchStart',id=12,position=responding);await count(1)
            movement=[0,0]
            for sample in range(4):
                await page.wait_for_timeout(100)
                after_positions=await page.evaluate("ids=>ids.map(id=>({...__rosesRenderer.projectPetal(id)}))",[responding['petal'],unrelated['petal']])
                for i,(a,b) in enumerate(zip(after_positions,before_positions)):
                    movement[i]=max(movement[i],((a['x']-b['x'])**2+(a['y']-b['y'])**2)**.5)
            assert movement[0]>.25 and movement[1]<.05,movement
            await touch('touchEnd',id=12);await count(0)
            report['checks']['localPetalDisplacement']={'playedPixels':movement[0],'unrelatedPixels':movement[1]}
            await slider('appearance','response',0);await close_panels();await page.wait_for_timeout(1200)

            # Foliage is musical geometry, not a decorative overlap. Record
            # after preceding tails have drained so each PCM capture establishes
            # that this leaf/stem contact itself creates audible output.
            foliage_pcm=[]
            for pointer,kind in [(13,'leaf'),(14,'stem')]:
                await page.wait_for_function('__rosesHost.audio.snapshot().voices.length===0&&__rosesHost.audio.snapshot().rms<.00005',timeout=10000)
                target=await foliage(kind);before=await camera();await page.evaluate(CAPTURE)
                await touch('touchStart',id=pointer,position=target);await count(1)
                voice=(await sources())[0]
                assert voice['id'].endswith('-'+str(target['id'])) and voice['midi']<initial['midi'],(target,voice,initial)
                await page.wait_for_timeout(300);await touch('touchEnd',id=pointer);await count(0)
                await page.wait_for_timeout(100);pcm=await page.evaluate('finishRosesCapture()');audible(pcm)
                assert await camera()==before and not await page.evaluate('__rosesHost.state.playing')
                foliage_pcm.append({'kind':kind,'id':target['id'],'midi':voice['midi'],**pcm})
            report['checks']['leavesAndStemsPlayLowerAudibleNotesBeforeTransport']=foliage_pcm
            leaf=await foliage('leaf');head=await petal()
            await touch('touchStart',id=15,position=leaf);await touch('touchStart',id=16,position=head);await count(2)
            leaf_source=next(source for source in await sources() if source['id'].endswith('-'+str(leaf['id'])))
            await touch('touchEnd',id=16);await count(1)
            assert (await sources())[0]['id']==leaf_source['id']
            await touch('touchEnd',id=15);await count(0)
            report['checks']['leafAndPetalHaveIndependentTouchOwnership']=True

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
            rotated_foliage=[]
            for pointer,kind in [(25,'leaf'),(26,'stem')]:
                target=await foliage(kind)
                await touch('touchStart',id=pointer,position=target);await count(1)
                assert (await sources())[0]['id'].endswith('-'+str(target['id']))
                await touch('touchEnd',id=pointer);await count(0);rotated_foliage.append({'kind':kind,'id':target['id']})
            report['checks']['foliagePickingAfterOrbit']=rotated_foliage

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
                cycles=await page.evaluate("""()=>{const h=__rosesHost,audio=h.audio,original=audio.pulse,originalQueue=__rosesGarden.queueRain,old=h.state.sound.scanRate,out={};try{for(const rate of [1,2,4]){const events=[];audio.pulse=(id,midi,options,when,duration)=>events.push({id,midi,when,duration});__rosesGarden.queueRain=(petal,when,velocity)=>events.push({id:"roses-seq-"+petal,when,duration:.65});h.state.sound.scanRate=String(rate);h.controller.setPlaying(false);h.controller.setPlaying(true);for(let s=0;s<64;s++)h.controller.onStep(s%16,10+s*.125);out[rate]=events;}}finally{audio.pulse=original;__rosesGarden.queueRain=originalQueue;h.state.sound.scanRate=old;h.controller.setPlaying(false);}return out;}""")
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

            # Idle rotation is a visual offset, not an edit to the saved camera.
            # Contacts pause that offset immediately; manual navigation adopts
            # the visible orientation without snapping back to the stored yaw.
            idle_base=await camera()
            await slider('appearance','idleRotation',.035);await close_panels()
            await page.evaluate('camera=>__rosesHost.controller.setData({camera})',USER_CAMERA)
            await page.wait_for_timeout(3200)
            visual_before=await page.evaluate('__rosesRenderer.camera.yaw');base_before=await camera()
            await page.wait_for_timeout(800)
            visual_after=await page.evaluate('__rosesRenderer.camera.yaw')
            assert visual_after-visual_before>.01 and await camera()==base_before,(visual_before,visual_after,base_before,await camera())
            point=await petal();visible_at_down=await page.evaluate('__rosesRenderer.camera.yaw')
            await touch('touchStart',id=91,position=point);await count(1);await page.wait_for_timeout(80)
            paused=await page.evaluate('__rosesRenderer.camera.yaw')
            assert abs(paused-visible_at_down)<.003,'Petal contact snapped the idle view'
            assert (await sources())[0]['id'].endswith('-'+str(point['petal']))
            assert await camera()==base_before
            await page.wait_for_timeout(350)
            assert abs(await page.evaluate('__rosesRenderer.camera.yaw')-paused)<1e-9
            await touch('touchEnd',id=91);await count(0);await page.wait_for_timeout(1200)
            assert abs(await page.evaluate('__rosesRenderer.camera.yaw')-paused)<1e-9
            await page.wait_for_timeout(2000)
            resumed=await page.evaluate('__rosesRenderer.camera.yaw');assert resumed-paused>.008,(paused,resumed)
            report['checks']['idleRotationPausesForContactThenResumesWithoutEditingCamera']={'visualDelta':visual_after-visual_before,'resumeDelta':resumed-paused}
            background=await empty(.08,.5);visible_at_down=await page.evaluate('__rosesRenderer.camera.yaw')
            serial=await page.evaluate('__rosesHost.audio._serial')
            await touch('touchStart',id=92,position=background);await page.wait_for_timeout(80)
            adopted=await camera();assert abs(adopted['yaw']-visible_at_down)<.003
            assert abs(await page.evaluate('__rosesRenderer.camera.yaw')-adopted['yaw'])<1e-9
            await touch('touchMove',id=92,position={'x':background['x']+70,'y':background['y']+12});await touch('touchEnd',id=92);await count(0)
            assert await page.evaluate('__rosesHost.audio._serial')==serial
            await page.wait_for_timeout(300)
            assert await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.roses.v1')).data.camera")==await camera()
            report['checks']['manualOrbitAdoptsAndSavesVisibleIdleOrientation']=True
            await page.wait_for_timeout(3000)
            await page.emulate_media(reduced_motion='reduce');await page.wait_for_timeout(100)
            reduced_yaw=await page.evaluate('__rosesRenderer.camera.yaw')
            assert abs(reduced_yaw-(await camera())['yaw'])<1e-9
            await page.wait_for_timeout(300);assert await page.evaluate('__rosesRenderer.camera.yaw')==reduced_yaw
            await slider('appearance','idleRotation',0);await close_panels()
            await page.evaluate('camera=>__rosesHost.controller.setData({camera})',idle_base)
            await page.emulate_media(reduced_motion='no-preference');await page.wait_for_timeout(100)
            report['checks']['reducedMotionDisablesIdleRotation']=True

            # Close inspection deliberately crops the sculpture. The camera
            # must zoom toward the pointed-at detail, keep touch IDs aligned,
            # and still provide a mobile route out of a petal-filled viewport.
            previous_camera=await camera()
            await page.emulate_media(reduced_motion='reduce')
            previous_response=await page.evaluate('__rosesHost.state.appearance.response')
            await slider('appearance','response',0);await close_panels()
            overview={'yaw':-.2,'pitch':-.08,'zoom':1.04,'offsetX':0,'offsetY':0}
            await page.evaluate('camera=>__rosesHost.controller.setData({camera})',overview)
            await page.wait_for_timeout(100)
            anchor_target=await petal(flower=0)
            anchor=await page.evaluate("id=>{const p=__rosesRenderer.projectPetal(id),b=document.querySelector('#stage canvas').getBoundingClientRect();return{x:p.x+b.x,y:p.y+b.y,id};}",anchor_target['petal'])
            serial=await page.evaluate('__rosesHost.audio._serial')
            await page.evaluate("window.__roseWheel=null;document.querySelector('#stage canvas').addEventListener('wheel',e=>window.__roseWheel={x:e.clientX,y:e.clientY},{once:true})")
            await page.mouse.move(anchor['x'],anchor['y']);await page.mouse.wheel(0,-3000)
            await page.wait_for_function('__rosesHost.controller.getData().camera.zoom>3.19')
            await page.wait_for_timeout(100)
            close_camera=await camera()
            anchored=await page.evaluate("id=>{const p=__rosesRenderer.projectPetal(id),b=document.querySelector('#stage canvas').getBoundingClientRect();return{x:p.x+b.x,y:p.y+b.y};}",anchor['id'])
            # Native wheel coordinates are rounded to CSS pixels; preserve the point
            # actually reported by the event, not a fractional test cursor.
            wheel=await page.evaluate('__roseWheel');ratio=close_camera['zoom']/overview['zoom']
            expected={axis:wheel[axis]+(anchor[axis]-wheel[axis])*ratio for axis in ['x','y']}
            anchor_error=((anchored['x']-expected['x'])**2+(anchored['y']-expected['y'])**2)**.5
            assert abs(close_camera['zoom']-3.2)<1e-8 and anchor_error<1.5,(close_camera,anchor,anchored)
            await page.mouse.wheel(0,-3000);await page.wait_for_timeout(100)
            assert await camera()==close_camera,'Scrolling against the zoom limit moved the camera'
            assert await page.evaluate('__rosesHost.audio._serial')==serial,'Wheel zoom sounded a note'
            close_target=await petal()
            await touch('touchStart',id=81,position=close_target);await count(1)
            assert (await sources())[0]['id'].endswith('-'+str(close_target['petal']))
            await touch('touchEnd',id=81);await count(0)
            report['checks']['cursorAnchoredCloseZoomAndPicking']={'zoom':close_camera['zoom'],'anchorErrorPixels':anchor_error}

            pan_origin=await page.evaluate("()=>{const b=document.querySelector('#stage canvas').getBoundingClientRect();return{x:b.x+b.width*.5,y:b.y+b.height*.48,w:b.width,h:b.height};}")
            pan_before=await camera();serial=await page.evaluate('__rosesHost.audio._serial')
            await page.mouse.move(pan_origin['x'],pan_origin['y']);await page.keyboard.down('Shift');await page.mouse.down()
            await page.mouse.move(pan_origin['x']+24,pan_origin['y']+16,steps=3);await page.mouse.up();await page.keyboard.up('Shift')
            await page.wait_for_timeout(80);pan_after=await camera()
            assert all(pan_before[k]==pan_after[k] for k in ['yaw','pitch','zoom'])
            assert abs((pan_after['offsetX']-pan_before['offsetX'])*pan_origin['w']-24)<1.5
            assert abs((pan_after['offsetY']-pan_before['offsetY'])*pan_origin['h']-16)<1.5
            assert await page.evaluate('__rosesHost.audio._serial')==serial
            report['checks']['shiftDragPansCloseViewWithoutPlaying']=True

            await page.mouse.wheel(0,4000)
            await page.wait_for_function('__rosesHost.controller.getData().camera.zoom<.651')
            minimum=await camera()
            assert minimum['zoom']==.65 and minimum['offsetX']==0 and minimum['offsetY']==0,minimum
            await page.mouse.wheel(0,4000);await page.wait_for_timeout(80)
            assert await camera()==minimum
            report['checks']['zoomOutRestoresOverviewAndStopsAtLimit']=True

            # A stationary second playing finger does not turn a glissando
            # into a camera gesture; pinch conversion requires both to move.
            await page.evaluate('camera=>__rosesHost.controller.setData({camera})',overview);await page.wait_for_timeout(100)
            available=await petals();first=available[0];second=max(available,key=lambda p:(p['x']-first['x'])**2+(p['y']-first['y'])**2)
            await touch('touchStart',id=82,position=first);await touch('touchStart',id=83,position=second);await count(2)
            stationary_camera=await camera()
            next_target=max((p for p in await petals() if p['petal']!=first['petal']),key=lambda p:(p['x']-first['x'])**2+(p['y']-first['y'])**2)
            await touch('touchMove',id=82,position=next_target);await page.wait_for_timeout(80)
            assert await camera()==stationary_camera
            assert len(await sources())==2
            await touch('touchEnd',id=83);await touch('touchEnd',id=82);await count(0)
            report['checks']['oneFingerGlissandoDoesNotBecomePinch']=True

            # Start zoomed in, where empty-space-only gestures would trap touch
            # users. Convert two moving petal contacts while preserving a third
            # independently latched voice, then pan by their midpoint.
            await page.evaluate('camera=>__rosesHost.controller.setData({camera})',close_camera);await page.wait_for_timeout(100)
            await page.locator('#hold').click()
            await touch('touchStart',id=84,position=await petal());await touch('touchEnd',id=84);await count(1)
            unrelated=(await sources())[0]
            available=await petals();first=available[0];second=max(available,key=lambda p:(p['x']-first['x'])**2+(p['y']-first['y'])**2)
            dx=second['x']-first['x'];dy=second['y']-first['y'];distance=(dx*dx+dy*dy)**.5
            assert distance>65,distance
            ux=dx/distance;uy=dy/distance;shift=min(45,distance*.2)
            await touch('touchStart',id=85,position=first);await touch('touchStart',id=86,position=second);await count(3)
            before_pinch=await camera()
            moved_first={'x':first['x']+ux*shift,'y':first['y']+uy*shift}
            moved_second={'x':second['x']-ux*shift,'y':second['y']-uy*shift}
            await touch('touchMove',id=85,position=moved_first);await touch('touchMove',id=86,position=moved_second)
            await page.wait_for_function('zoom=>__rosesHost.controller.getData().camera.zoom<zoom-.1',arg=before_pinch['zoom'])
            await count(1);assert (await sources())[0]['id']==unrelated['id']
            after_pinch=await camera();await page.wait_for_timeout(100)
            assert after_pinch['yaw']==before_pinch['yaw'] and after_pinch['pitch']==before_pinch['pitch']
            # Equal movement preserves separation, so final zoom stays fixed
            # while the inspected object translates with the pair's midpoint.
            midpoint_pan={'x':18,'y':12}
            projected_before=await page.evaluate('id=>({...__rosesRenderer.projectPetal(id)})',first['petal'])
            await touch('touchMove',id=85,position={'x':moved_first['x']+18,'y':moved_first['y']+12})
            await touch('touchMove',id=86,position={'x':moved_second['x']+18,'y':moved_second['y']+12})
            await page.wait_for_timeout(100)
            after_pan=await camera();projected_after=await page.evaluate('id=>({...__rosesRenderer.projectPetal(id)})',first['petal'])
            assert abs(after_pan['zoom']-after_pinch['zoom'])<1e-6,(after_pinch,after_pan)
            pan_error=((projected_after['x']-projected_before['x']-18)**2+(projected_after['y']-projected_before['y']-12)**2)**.5
            assert pan_error<2.5,(projected_before,projected_after,pan_error)
            await touch('touchCancel',id=85);await count(1)
            assert (await sources())[0]['id']==unrelated['id']
            await page.locator('#hold').click();await count(0)
            report['checks']['petalPinchZoomOutAndMidpointPanPreserveOtherLatch']={'before':before_pinch,'after':after_pinch,'panErrorPixels':pan_error}

            # Offsets use fractions of the viewport, so shape placement and the
            # chosen zoom survive a real resize and persisted reload.
            await page.wait_for_timeout(300)
            saved_close=await camera()
            await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(200)
            assert await camera()==saved_close
            await page.reload();await loaded();await page.wait_for_function('__rosesRenderer.reveal>=1')
            assert await camera()==saved_close,(saved_close,await camera())
            assert not await page.evaluate('__rosesHost.state.hold||__rosesHost.state.playing')
            await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(180)
            await page.evaluate('camera=>__rosesHost.controller.setData({camera})',previous_camera)
            await slider('appearance','response',previous_response);await close_panels();await page.wait_for_timeout(100)
            await page.emulate_media(reduced_motion='no-preference');await page.wait_for_timeout(80)
            assert await page.evaluate('__rosesRenderer.reveal')==1,'Restoring motion must not hide a completed bouquet'
            report['checks']['completedRevealSurvivesMotionPreferenceChange']=True
            await slider('appearance','revealDuration',12);await close_panels();await page.wait_for_timeout(80)
            assert await page.evaluate('__rosesRenderer.reveal')==1,'Increasing entry duration must not rewind a completed bouquet'
            report['checks']['completedRevealSurvivesEntryDurationChange']=True
            report['checks']['closeCameraResizeAndPersistence']=True

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
