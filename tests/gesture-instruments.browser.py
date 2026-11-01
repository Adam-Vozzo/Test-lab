"""Native gesture/audio regressions for Carrier, Cellular and Graticule.
Start a preview with `npm start`, then run:
PREVIEW_URL=http://127.0.0.1:4173 python tests/gesture-instruments.browser.py
CHROMIUM_PATH optionally selects a local browser; otherwise Chromium/Chrome
from PATH or Playwright's bundled Chromium is used.
"""
import asyncio
import json
import os
import shutil
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'gesture-regression'

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as playwright:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        browser=await playwright.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
        try:
            context=await browser.new_context(viewport={'width':1180,'height':820},device_scale_factor=1,has_touch=True,service_workers='block')
            async def instrument(route):
                await route.fulfill(status=200,content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__gestureQA',{get:()=>({audio,state,controller,currentId})});")
            await context.route('**/collection.js',instrument)
            await context.add_init_script('''window.__invalidCanvasRects=[];const original=CanvasRenderingContext2D.prototype.rect;CanvasRenderingContext2D.prototype.rect=function(...args){if(args.some(x=>!Number.isFinite(x)))__invalidCanvasRects.push(args.map(String));return original.apply(this,args);};''')
            page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            await page.goto(os.environ.get('PREVIEW_URL','http://127.0.0.1:4173')+'/collection.html#carrier',wait_until='load')
            async def switch(name):
                await page.evaluate('(id)=>location.hash=id',name)
                await page.wait_for_function('(id)=>window.__gestureQA?.currentId===id&&!document.querySelector("#stage").hasAttribute("aria-busy")',arg=name)
                await page.wait_for_timeout(200)
            async def panes():
                return await page.evaluate('''async()=>{const {splitLayout}=await import('/instrument-layout.js'),r=document.querySelector('#stage').getBoundingClientRect(),p=splitLayout(r.width,r.height,__gestureQA.state.appearance,{pad:12,gap:16,stackPortrait:true,portraitRatio:.95});for(const side of['left','right']){p[side].x+=r.x;p[side].y+=r.y;}return p;}''')
            async def snapshot():
                return await page.evaluate('({rms:__gestureQA.audio.snapshot().rms,voices:__gestureQA.audio.snapshot().voices.length,sources:__gestureQA.audio.sources.size,sound:{...__gestureQA.state.sound},data:__gestureQA.controller.getData?.()})')
            results={}
            await switch('carrier');p=await panes();left=p['left'];before=await snapshot()
            await page.mouse.move(left['x']+left['w']*.32,left['y']+left['h']*.4);await page.mouse.down();await page.mouse.move(left['x']+left['w']*.44,left['y']+left['h']*.26,steps=8);await page.wait_for_timeout(300);during=await snapshot();await page.mouse.up()
            assert during['sources']>=1 and during['rms']>0,'Carrier contact did not reach audio output'
            assert during['data']!=before['data'],'Carrier gesture did not edit its note/path model'
            baseline=(await snapshot())['sound'];right=p['right'];cdp=await context.new_cdp_session(page)
            def touch(identifier,x,y):return {'id':identifier,'x':x,'y':y,'radiusX':5,'radiusY':5,'force':1}
            x=right['x']+right['w']*.38;y=right['y']+right['h']*.49
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[touch(1,x,y)]})
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[touch(1,x,y),touch(2,x+55,y+35)]})
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[touch(1,x-25,y-15),touch(2,x+110,y+65)]})
            await page.wait_for_timeout(120);pinched=(await snapshot())['sound']
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            assert abs(pinched['cutoff']-baseline['cutoff'])<1e-6,'Pinch retained an unrelated first-finger cutoff edit'
            assert abs(pinched['ratio']-baseline['ratio'])<1e-6,'Pinch retained an unrelated first-finger ratio edit'
            assert pinched['index']>baseline['index'],'Pinch did not alter FM depth'
            results['carrier']={'contact_rms':during['rms'],'pinch_index':[baseline['index'],pinched['index']]}
            await page.screenshot(path=str(OUT/'carrier-blob-gesture.png'))

            await switch('cellular');p=await panes();left=p['left'];await page.evaluate('__gestureQA.state.sound.attack=.8;__gestureQA.state.sound.release=.8;__gestureQA.audio.configure(__gestureQA.state.sound);__gestureQA.controller.update()')
            await page.mouse.move(left['x']+left['w']*.46,left['y']+left['h']*.48);await page.mouse.down();await page.wait_for_timeout(130);attack=await page.evaluate('__gestureQA.audio.snapshot().voices.reduce((m,v)=>Math.max(m,v.level),0)');await page.wait_for_timeout(800);held=await snapshot();await page.screenshot(path=str(OUT/'cellular-held.png'));await page.mouse.up();await page.wait_for_timeout(1100);released=await snapshot()
            assert held['rms']>0 and held['voices']>=1,'Cellular contact did not produce audio'
            assert released['sources']==0 and released['voices']==0,'Cellular contact remained stuck after release'
            before=await snapshot();expected=await page.evaluate("async()=>{const {lifeStep}=await import('/instruments/cellular.js');return Array.from(lifeStep(__gestureQA.controller.getData().board,24,24).cells)}")
            right=p['right'];await page.mouse.click(right['x']+right['w']*.84,right['y']+right['h']-23);await page.wait_for_function('(generation)=>__gestureQA.controller.getData().generation>generation',arg=before['data']['generation']);after=await snapshot()
            assert after['data']['board']==expected,'Life STEP does not execute Conway B3/S23'
            results['cellular']={'early_attack_level':attack,'held_rms':held['rms'],'released_voices':released['voices'],'generation':after['data']['generation']}

            await switch('graticule');await page.evaluate('__gestureQA.state.appearance.leftWidth=34;__gestureQA.state.appearance.rightWidth=56;__gestureQA.state.appearance.layoutGap=42');await page.wait_for_timeout(150);before=await snapshot()
            g=await page.evaluate("async()=>{const {splitLayout}=await import('/instrument-layout.js'),{sonarGeometry}=await import('/instruments/graticule.js'),r=document.querySelector('#stage').getBoundingClientRect(),pane=splitLayout(r.width,r.height,__gestureQA.state.appearance).left,g=sonarGeometry(pane);return {...g,x:g.x+r.x,y:g.y+r.y}}")
            await page.mouse.move(g['x']+g['r']*.04,g['y']+g['r']*.03);await page.mouse.down();await page.mouse.move(g['x']+g['r']*.35,g['y']+g['r']*.3,steps=6);await page.wait_for_timeout(240);playing=await snapshot();await page.mouse.up()
            assert len(playing['data']['stars'])==len(before['data']['stars'])+1,'Star creation missed after independent pane resizing'
            pair=await page.evaluate("__gestureQA.audio.snapshot().voices.filter(v=>v.id.startsWith('map-contact')).map(v=>({id:v.id,midi:v.midi}))")
            assert any(v['id'].endswith('-A') for v in pair) and any(v['id'].endswith('-B') for v in pair),'Lissajous gesture did not create the audible oscillator pair'
            await page.locator('#play').click();await page.wait_for_timeout(1000);sonar=await page.evaluate("__gestureQA.audio.snapshot().voices.filter(v=>v.id.startsWith('sonar-')).length");assert sonar>0,'Sonar did not emit notes at star crossings'
            await page.screenshot(path=str(OUT/'graticule-sonar.png'))
            await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(300);await page.screenshot(path=str(OUT/'graticule-compact.png'))
            results['graticule']={'stars':len(playing['data']['stars']),'pair':pair,'sonar_voices':sonar}
            canceled=[]
            for name in ['carrier','cellular','graticule']:
                await switch(name)
                if await page.evaluate('__gestureQA.state.playing'):await page.locator('#play').click()
                if not await page.evaluate('__gestureQA.state.hold'):await page.locator('#hold').click()
                await page.evaluate('__gestureQA.state.sound.release=.1;__gestureQA.audio.configure(__gestureQA.state.sound);__gestureQA.controller.update()')
                left=(await panes())['left'];tx=left['x']+left['w']*.32;ty=left['y']+left['h']*.4
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[touch(71,tx,ty)]})
                await page.wait_for_timeout(180)
                assert (await snapshot())['sources']>0,f'{name} cancel test did not own an active source'
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]})
                await page.wait_for_timeout(650)
                canceled_state=await snapshot()
                assert canceled_state['sources']==0,f'{name} canceled contact remained latched under Hold'
                assert canceled_state['voices']==0,f'{name} canceled voices failed to release'
                canceled.append(name)
                await page.locator('#hold').click()
            results['canceled_under_hold']=canceled
            invalid=await page.evaluate('__invalidCanvasRects');assert not invalid,invalid;assert not errors,errors
            print(json.dumps({'results':results,'page_errors':errors,'invalid_rects':invalid},indent=2))
        finally:
            await browser.close()

asyncio.run(main())
