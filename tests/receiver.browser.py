#!/usr/bin/env python3
"""Receiver production-host touch, persistence and audio regression.

Uses trusted Chromium touch events and decoded master PCM. WebGL is disabled
so the fallback remains playable. This is not native iOS performance testing.
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
OUT = ROOT / 'qa' / 'receiver-functional'
CAPTURE = r'''() => {
  const audio=__receiverHost.audio;
  if(!audio.context)audio._createContext();
  const ctx=audio.context,destination=ctx.createMediaStreamDestination();
  audio._master.connect(destination);
  const mime=['audio/webm;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(destination.stream,mime?{mimeType:mime}:{}),chunks=[];
  recorder.ondataavailable=event=>chunks.push(event.data);
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  window.finishReceiverCapture=async()=>{
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
    def log_message(self, *args): pass


async def run(base):
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'webgl':False, 'device':'Chromium touch emulation', 'checks':{}}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=shutil.which('chromium'), headless=True,
            args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
        context = await browser.new_context(viewport={'width':844,'height':390},has_touch=True,service_workers='block')
        async def expose(route):
            source = (ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__receiverHost',{get:()=>({audio,state,controller,currentId,definition,controls})});"
            await route.fulfill(content_type='text/javascript',body=source)
        await context.route('**/collection.js',expose)
        page = await context.new_page()
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        cdp=await context.new_cdp_session(page);contacts={}

        async def loaded(id='receiver'):
            await page.wait_for_function("id=>window.__receiverHost?.currentId===id&&__receiverHost.controller&&!document.querySelector('#stage').hasAttribute('aria-busy')",arg=id)

        async def point(nx=.5,ny=.5):
            return await page.evaluate("""async ([nx,ny])=>{
              const m=await import('./instruments/receiver.js'),b=document.querySelector('#stage').getBoundingClientRect();
              const l=m.receiverLayout(b.width,b.height),p=m.receiverPoint(nx,ny,l);
              return{x:b.x+p.x,y:b.y+p.y};
            }""",[nx,ny])

        async def beacon(index):
            return await page.evaluate("""async index=>{
              const m=await import('./instruments/receiver.js'),b=document.querySelector('#stage').getBoundingClientRect(),l=m.receiverLayout(b.width,b.height);
              const data=__receiverHost.controller.getData().beacons[index],p=m.receiverBeaconPose(data,performance.now()/1000,__receiverHost.state.appearance,false,index);
              const screen=m.receiverPoint(p.x??p.nx,p.y??p.ny,l);return{x:b.x+screen.x,y:b.y+screen.y};
            }""",index)

        async def touch(kind,id=1,position=None):
            ended=None
            if kind in ('touchStart','touchMove'):
                contacts[id]={'id':id,**(position or await point()),'radiusX':4,'radiusY':4,'force':.7}
            else: ended=contacts.pop(id,None)
            if kind=='touchCancel': contacts.clear()
            points=[ended] if kind=='touchEnd' and contacts and ended else list(contacts.values())
            await cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})

        async def sources():
            return await page.evaluate("[...__receiverHost.audio.sources.values()].map(s=>({id:s.id,midi:s.midi,physical:s.physical,options:s.options}))")

        async def count(number):
            await page.wait_for_function('n=>__receiverHost.audio.sources.size===n',arg=number)

        async def slider(kind,key,value):
            descriptor=await page.evaluate("([kind,key])=>__receiverHost.controls[kind].find(c=>c.key===key)",[kind,key]);assert descriptor,(kind,key)
            panel='#sound-popover' if kind=='sound' else '#appearance'
            if await page.locator(panel).is_hidden(): await page.locator(f'#{kind}-toggle').click()
            await page.locator(f'[data-tabs={kind}] [data-group="{descriptor["section"]}"]').click()
            await page.locator(f'#{kind}-{key}').evaluate("(e,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}",value)

        async def close_panels():
            for panel in ['sound-popover','appearance']:
                if await page.locator('#'+panel).is_visible():await page.locator(f'[data-close={panel}]').click()

        def audible(pcm):
            assert pcm['rms']>.0004 and pcm['peak']<1 and pcm['nonFinite']==0,pcm

        try:
            await page.goto(base+'/collection.html#receiver');await loaded()
            assert not await page.evaluate('__receiverHost.state.playing')
            assert await page.evaluate('__receiverHost.state.sound.waveform')=='receiver'
            assert len(await page.evaluate('__receiverHost.controller.getData().beacons'))==5
            await page.evaluate(CAPTURE)
            await touch('touchStart',position=await point(.35,.46));await count(1)
            await page.wait_for_function('__receiverHost.audio.snapshot().rms>.0004',timeout=5000)
            first=(await sources())[0]
            await page.wait_for_timeout(250)
            await touch('touchMove',position=await point(.63,.40));await page.wait_for_timeout(200)
            moved=(await sources())[0]
            assert moved['midi']!=first['midi'] and moved['id']==first['id'],(first,moved)
            await touch('touchEnd');await count(0);await page.wait_for_timeout(200)
            pcm=await page.evaluate('finishReceiverCapture()');audible(pcm)
            assert not await page.evaluate('__receiverHost.state.playing')
            report['checks']['directTouchBeforePlay']={**pcm,'startMidi':first['midi'],'endMidi':moved['midi']}

            await slider('appearance','targetDrift',1);await slider('appearance','driftRate',0);await close_panels()
            original=await page.evaluate('__receiverHost.controller.getData()')
            start=await beacon(1)
            await touch('touchStart',id=11,position=start);await count(1)
            held=(await sources())[0]
            assert await page.evaluate('__receiverHost.controller.getData().beacons')==original['beacons'], 'Grabbing a drifting target changed its stored note'
            destination=await point(.60,.59)
            await touch('touchMove',id=11,position=destination)
            dragged=(await sources())[0]
            await touch('touchEnd',id=11);await count(0)
            data=await page.evaluate('__receiverHost.controller.getData()')
            assert abs(data['beacons'][1]['x']-original['beacons'][1]['x'])>.08,(original,data)
            assert data['beacons'][0]==original['beacons'][0]
            assert dragged['midi']!=held['midi'],(held,dragged)
            dropped=await beacon(1)
            assert ((dropped['x']-destination['x'])**2+(dropped['y']-destination['y'])**2)**.5<2,(destination,dropped)
            report['checks']['beaconDragChangesStoredPitch']=True
            report['checks']['driftingBeaconDropContinuity']=True

            await touch('touchStart',id=14,position=await beacon(4));await count(1)
            await touch('touchMove',id=14,position=await point(1.04,1.08))
            high=await page.evaluate('__receiverHost.controller.getData().beacons[4]')
            assert .93<=high['x']<=1 and .92<=high['y']<=1,high
            await touch('touchMove',id=14,position=await point(-.04,-.08))
            low=await page.evaluate('__receiverHost.controller.getData().beacons[4]')
            assert 0<=low['x']<=.06 and 0<=low['y']<=.07,low
            await touch('touchEnd',id=14);await count(0)
            await page.evaluate('data=>__receiverHost.controller.setData(data)',data)
            report['checks']['capturedBeaconDragStaysBounded']={'low':low,'high':high}

            same_data=await page.evaluate('__receiverHost.controller.getData()')
            same_point=await beacon(2)
            await touch('touchStart',id=15,position=same_point)
            await touch('touchStart',id=16,position=same_point);await count(2)
            same_sources=await sources()
            await touch('touchMove',id=16,position=await point(.14,.43))
            assert await page.evaluate('__receiverHost.controller.getData().beacons')==same_data['beacons']
            second=next(s for s in await sources() if s['id']==same_sources[1]['id'])
            await touch('touchMove',id=15,position=await point(.56,.30))
            assert await page.evaluate('__receiverHost.controller.getData().beacons[2]')!=same_data['beacons'][2]
            assert next(s for s in await sources() if s['id']==second['id'])['midi']==second['midi']
            await touch('touchEnd',id=15);await count(1)
            assert (await sources())[0]['id']==second['id']
            await touch('touchEnd',id=16);await count(0)
            await page.evaluate('data=>__receiverHost.controller.setData(data)',same_data)
            report['checks']['sameBeaconContactOwnership']=True

            await touch('touchStart',id=21,position=await point(.30,.45))
            await touch('touchStart',id=22,position=await point(.69,.43));await count(2)
            pair=await sources();assert len({s['midi'] for s in pair})==2,pair
            await touch('touchEnd',id=21);await count(1)
            assert (await sources())[0]['id']==pair[1]['id']
            await touch('touchEnd',id=22);await count(0)
            report['checks']['independentContacts']=True

            # Calibration rails are playable controls, including a second
            # contact while the first continues sounding in the field.
            rails=await page.evaluate("""async()=>{const m=await import('./instruments/receiver.js'),b=document.querySelector('#stage').getBoundingClientRect(),l=m.receiverLayout(b.width,b.height);const absolute=r=>({x:b.x+r.x,y:b.y+r.y,w:r.w,h:r.h});return{pitch:absolute(l.pitchRail),bandwidth:absolute(l.bandwidthRail)};}""")
            pitch=rails['pitch']
            await touch('touchStart',id=24,position={'x':pitch['x']+pitch['w']*.25,'y':pitch['y']});await count(1)
            rail_first=(await sources())[0]
            await touch('touchMove',id=24,position={'x':pitch['x']+pitch['w']*.75,'y':pitch['y']})
            rail_last=(await sources())[0]
            assert rail_last['midi']>rail_first['midi'] and rail_last['id']==rail_first['id'],(rail_first,rail_last)
            await touch('touchEnd',id=24);await count(0)
            await touch('touchStart',id=25,position=await point(.36,.46));await count(1)
            field=(await sources())[0];band=rails['bandwidth']
            await touch('touchStart',id=26,position={'x':band['x'],'y':band['y']+band['h']*.25});await count(2)
            before_bandwidth=await page.evaluate('__receiverHost.state.sound.bandwidth')
            await touch('touchMove',id=26,position={'x':band['x'],'y':band['y']+band['h']*.75})
            after_bandwidth=await page.evaluate('__receiverHost.state.sound.bandwidth')
            assert abs(after_bandwidth-before_bandwidth)>.3,(before_bandwidth,after_bandwidth)
            retained=next(s for s in await sources() if s['id']==field['id'])
            assert retained['midi']==field['midi'],(field,retained)
            await touch('touchEnd',id=26);await count(1)
            await touch('touchEnd',id=25);await count(0)
            report['checks']['pitchAndBandwidthRails']={'pitchStart':rail_first['midi'],'pitchEnd':rail_last['midi'],'bandwidthStart':before_bandwidth,'bandwidthEnd':after_bandwidth}

            await page.locator('#hold').click()
            for id,nx in [(31,.28),(32,.68)]:
                await touch('touchStart',id=id,position=await point(nx,.48));await page.wait_for_timeout(80);await touch('touchEnd',id=id)
            await count(2);held=await sources();assert all(not s['physical'] for s in held)
            await page.locator('#arp').click()
            heard=await page.evaluate("""async()=>{const notes=new Set();for(let i=0;i<28;i++){for(const voice of __receiverHost.audio.snapshot().voices)if(voice.kind==='arp'&&voice.gate)notes.add(voice.midi);await new Promise(r=>setTimeout(r,50));}return [...notes];}""")
            assert all(s['midi'] in heard for s in held),(held,heard)
            await touch('touchStart',id=33,position=await point(.9,.4));await count(3)
            await touch('touchCancel',id=33);await count(2)
            await page.locator('#hold').click();await count(0);await page.locator('#arp').click()
            report['checks']['holdArpCancel']={'held':[s['midi'] for s in held],'arpeggiated':heard}

            await page.locator('#hold').click()
            await touch('touchStart',id=41,position=await point(.23,.37));await touch('touchEnd',id=41);await count(1)
            expressive=(await sources())[0]
            appearance=await page.evaluate("__receiverHost.controls.appearance.find(c=>(!c.kind||c.kind==='range')&&c.section!=='Post-processing')")
            visual_value=appearance['min']+(appearance['max']-appearance['min'])*.6
            await slider('appearance',appearance['key'],visual_value);await close_panels()
            assert (await sources())[0]['options']==expressive['options']
            report['checks']['appearancePreservesExpression']=True
            # A narrow global sound edit must not reset per-contact pan/position.
            await slider('sound','release',1.67);await close_panels()
            changed=(await sources())[0]
            assert changed['id']==expressive['id'] and abs(changed['options']['release']-1.67)<.001
            for key,value in expressive['options'].items():
                if key!='release':assert changed['options'][key]==value,(key,value,changed['options'][key])
            await page.locator('#hold').click();await count(0)
            report['checks']['soundEditingPreservesExpression']=True

            await page.locator('#stage canvas[role=application]:not([aria-hidden=true])').focus()
            await page.keyboard.down('a');await count(1)
            assert (await sources())[0]['id']=='key-a' and (await sources())[0]['options']['waveform']=='receiver'
            await page.wait_for_function("async()=>{const {noteName}=await import('./instruments/kit.js');const source=__receiverHost.audio.sources.get('key-a');return source&&document.querySelector('#instrument-status').textContent.startsWith(noteName(source.midi));}")
            await page.keyboard.up('a');await count(0)
            report['checks']['keyboardNotesAndReadout']=True

            # All five saved targets must remain in the scan at every interval,
            # including acquisitions beyond the host's sixteen-step wrap.
            scan_cycles=await page.evaluate("""()=>{const h=__receiverHost,audio=h.audio,original=audio.pulse,originalRate=h.state.sound.scanRate,result={};try{for(const rate of [1,2,4]){const ids=[];audio.pulse=(id,midi,options,when,duration)=>ids.push({id,midi,when,duration});h.state.sound.scanRate=String(rate);h.controller.setPlaying?.(false);h.controller.setPlaying?.(true);for(let step=0;step<48;step++)h.controller.onStep(step%16,10+step*.125);result[rate]=ids;}}finally{audio.pulse=original;h.state.sound.scanRate=originalRate;h.controller.setPlaying?.(false);}return result;}""")
            for rate,events in scan_cycles.items():
                assert len(events)==48//int(rate),(rate,events)
                ids=[int(event['id'].rsplit('-',1)[1]) for event in events]
                assert ids==[i%5 for i in range(len(events))],(rate,ids)
                assert all(event['duration']>0 for event in events)
            report['checks']['allBeaconsAcrossTransportWrap']={rate:[event['id'] for event in events] for rate,events in scan_cycles.items()}

            await page.evaluate(CAPTURE);await page.locator('#play').click()
            await page.wait_for_function("__receiverHost.audio.snapshot().voices.some(v=>v.kind==='sequence')")
            await page.wait_for_timeout(1700)
            sequence=await page.evaluate('finishReceiverCapture()');audible(sequence)
            await page.locator('#play').click();serial=await page.evaluate('__receiverHost.audio._serial');await page.wait_for_timeout(650)
            assert await page.evaluate('__receiverHost.audio._serial')==serial
            report['checks']['sequenceAudio']=sequence;report['checks']['pauseCancelsFutureNotes']=True

            await page.locator('#sound-toggle').click();await page.locator('#appearance-toggle').click()
            assert await page.locator('#sound-popover').is_visible() and await page.locator('#appearance').is_visible()
            assert await page.evaluate("document.activeElement.tagName")!='SELECT'
            await close_panels();report['checks']['independentPanelsAndNeutralFocus']=True

            await page.wait_for_timeout(250)
            saved=await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.receiver.v1'))")
            await page.reload();await loaded()
            assert await page.evaluate('__receiverHost.state.appearance')==saved['appearance']
            assert await page.evaluate('__receiverHost.controller.getData()')==saved['data']
            report['checks']['appearanceAndBeaconPersistence']=True

            sizes=[]
            for width,height in [(1366,1024),(390,844),(844,390)]:
                await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(220)
                await touch('touchStart',id=51,position=await point(.36,.42));await count(1)
                value=(await sources())[0]
                await touch('touchEnd',id=51);await count(0)
                bounds=await page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,stage:document.querySelector('#stage').getBoundingClientRect().toJSON(),footer:document.querySelector('.bottom-bar').getBoundingClientRect().toJSON()})")
                assert bounds['scroll']<=width+1 and bounds['stage']['bottom']<=bounds['footer']['top']+1,bounds
                sizes.append({'width':width,'height':height,'midi':value['midi']})
            assert len({s['midi'] for s in sizes})==1,sizes
            report['checks']['responsivePicking']=sizes

            await page.locator('#hold').click();await touch('touchStart',id=61);await touch('touchEnd',id=61);await count(1)
            await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));")
            await count(0);assert not await page.evaluate('__receiverHost.state.hold||__receiverHost.state.playing')
            count_before=await page.locator('#stage canvas').count()
            for id in ['relay','cellular','receiver']:
                await page.evaluate('(id)=>location.hash=id',id);await loaded(id)
                assert await page.evaluate('__receiverHost.audio.sources.size')==0
            assert await page.locator('#stage canvas').count()==count_before
            report['checks']['backgroundAndSwitchCleanup']=True
            await page.screenshot(path=str(OUT/'fallback-landscape.png'))
            assert not errors,errors
            report['passed']=True;print(json.dumps({'passed':True,'checks':list(report['checks']),'directTouchAudio':report['checks']['directTouchBeforePlay'],'sequenceAudio':report['checks']['sequenceAudio']},indent=2))
        finally:
            report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2))
            await context.close();await browser.close()


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),180))
    finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':main()
