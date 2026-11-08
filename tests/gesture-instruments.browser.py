"""Native gesture/audio regressions for Cellular and Graticule.
Start a preview with `npm start`, then run:
PREVIEW_URL=http://127.0.0.1:4173 python tests/gesture-instruments.browser.py
CHROMIUM_PATH optionally selects a local browser; otherwise Chromium/Chrome
from PATH or Playwright's bundled Chromium is used.
FORCE_WEBGL1=1 exercises the mobile-compatible shader path.
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
        browser=await playwright.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
        try:
            context=await browser.new_context(viewport={'width':1180,'height':820},device_scale_factor=1,has_touch=True,service_workers='block')
            async def instrument(route):
                await route.fulfill(status=200,content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__gestureQA',{get:()=>({audio,state,controller,currentId})});")
            await context.route('**/collection.js',instrument)
            if os.environ.get('FORCE_WEBGL1')=='1':
                await context.add_init_script("const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:getContext.call(this,type,...args)}")
            async def cell_probe(route):
                source=(ROOT/'instruments/cellular.js').read_text().replace('cells.count=n;','cells.count=n;window.__cellPool={count:n,gather:bodies.map(b=>b.gather)};')
                source=source.replace('frame(time,dt){t=time;','frame(time,dt){t=Number.isFinite(window.__idleTime)?window.__idleTime:time;window.__renderedIdleTime=t;').replace('function drawLife(v,snap){const r=layout.right,g=boardGeometry(r),age=snap.time-lastBirthTime;','function drawLife(v,snap){const r=layout.right,g=boardGeometry(r),age=snap.time-lastBirthTime;window.__lifeGeometry={...g,dpr:surface.dpr};')
                await route.fulfill(status=200,content_type='text/javascript',body=source)
            async def radar_probe(route):
                source=(ROOT/'instruments/graticule.js').read_text().replace('function drawMap(v,snap){const r=layout.left,g=radar(r);','function drawMap(v,snap){const r=layout.left,g=radar(r);window.__radar={...g,zoom:radarZoom};')
                await route.fulfill(status=200,content_type='text/javascript',body=source)
            await context.route('**/instruments/cellular.js',cell_probe)
            await context.route('**/instruments/graticule.js',radar_probe)
            await context.add_init_script('''window.__invalidCanvasRects=[];const original=CanvasRenderingContext2D.prototype.rect;CanvasRenderingContext2D.prototype.rect=function(...args){if(args.some(x=>!Number.isFinite(x)))__invalidCanvasRects.push(args.map(String));return original.apply(this,args);};''')
            page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));shader_errors=[];page.on('console',lambda message:shader_errors.append(message.text) if 'Shader Error' in message.text else None)
            await page.goto(os.environ.get('PREVIEW_URL','http://127.0.0.1:4173')+'/collection.html#cellular',wait_until='load')
            async def switch(name):
                await page.evaluate('(id)=>location.hash=id',name)
                await page.wait_for_function('(id)=>window.__gestureQA?.currentId===id&&!document.querySelector("#stage").hasAttribute("aria-busy")',arg=name)
                await page.wait_for_timeout(200)
            async def panes():
                return await page.evaluate('''async()=>{const {splitLayout}=await import('/instrument-layout.js'),r=document.querySelector('#stage').getBoundingClientRect(),p=splitLayout(r.width,r.height,__gestureQA.state.appearance,{pad:12,gap:16,stackPortrait:true,portraitRatio:.95});for(const side of['left','right']){p[side].x+=r.x;p[side].y+=r.y;}return p;}''')
            async def snapshot():
                return await page.evaluate('({rms:__gestureQA.audio.snapshot().rms,voices:__gestureQA.audio.snapshot().voices.length,sources:__gestureQA.audio.sources.size,sound:{...__gestureQA.state.sound},data:__gestureQA.controller.getData?.()})')
            results={}
            cdp=await context.new_cdp_session(page)
            def touch(identifier,x,y):return {'id':identifier,'x':x,'y':y,'radiusX':5,'radiusY':5,'force':1}

            await switch('cellular');p=await panes();left=p['left'];await page.wait_for_function('window.__cellPool?.count>300');idle_pool=await page.evaluate('__cellPool');paused_before=await snapshot()
            async def idle_pixels(time,baseline=False):
                await page.evaluate('(time)=>window.__idleTime=time',time);await page.wait_for_function('(time)=>__renderedIdleTime===time',arg=time)
                return await page.evaluate('''(baseline)=>{const g=__lifeGeometry,c=document.querySelector('.instrument-canvas').getContext('2d'),pixels=c.getImageData(Math.floor(g.x*g.dpr),Math.floor(g.y*g.dpr),Math.floor(g.w*g.dpr),Math.floor(g.h*g.dpr)).data;if(baseline){window.__idlePixels=pixels;return 0;}let changed=0;for(let i=0;i<pixels.length;i+=4){if(Math.max(...[0,1,2,3].map(k=>Math.abs(pixels[i+k]-__idlePixels[i+k])))>8)changed++;}return changed;}''',baseline)
            await idle_pixels(10,True);idle_changes=await idle_pixels(12);assert idle_changes>500,'Paused Life board should visibly breathe and drift'
            paused_after=await snapshot();assert paused_after['data']==paused_before['data'],'Ambient motion must not evolve Conway state';assert paused_after['sources']==0 and paused_after['voices']==0,'Ambient motion must remain silent'
            await page.emulate_media(reduced_motion='reduce');await idle_pixels(10,True);assert await idle_pixels(12)==0,'Reduced motion must stop ambient cell deformation'
            await page.emulate_media(reduced_motion='no-preference');await page.evaluate('delete window.__idleTime')
            await page.evaluate('__gestureQA.state.sound.attack=.8;__gestureQA.state.sound.release=.8;__gestureQA.audio.configure(__gestureQA.state.sound);__gestureQA.controller.update()')
            await page.mouse.move(left['x']+left['w']*.46,left['y']+left['h']*.48);await page.mouse.down();await page.wait_for_timeout(130);attack=await page.evaluate('__gestureQA.audio.snapshot().voices.reduce((m,v)=>Math.max(m,v.level),0)');await page.wait_for_function('__cellPool.gather.some(x=>x>.99)');held=await snapshot();await page.screenshot(path=str(OUT/'cellular-held.png'));await page.mouse.up();await page.wait_for_function('__cellPool.gather.every(x=>x<.001)');released_pool=await page.evaluate('__cellPool');await page.wait_for_timeout(300);released=await snapshot()
            assert idle_pool['count']==released_pool['count'] and idle_pool['count']>300,'Cell population should persist after dispersal'
            assert held['rms']>0 and held['voices']>=1,'Cellular contact did not produce audio'
            assert released['sources']==0 and released['voices']==0,'Cellular contact remained stuck after release'
            before=await snapshot();expected=await page.evaluate("async()=>{const {lifeStep}=await import('/instruments/cellular.js');return Array.from(lifeStep(__gestureQA.controller.getData().board,24,24).cells)}")
            right=p['right'];await page.mouse.click(right['x']+right['w']*.84,right['y']+right['h']-23);await page.wait_for_function('(generation)=>__gestureQA.controller.getData().generation>generation',arg=before['data']['generation']);after=await snapshot()
            assert after['data']['board']==expected,'Life STEP does not execute Conway B3/S23'
            results['cellular']={'early_attack_level':attack,'held_rms':held['rms'],'released_voices':released['voices'],'generation':after['data']['generation'],'persistent_cells':idle_pool['count'],'idle_changed_pixels':idle_changes,'idle_state_unchanged':True,'reduced_motion_pixels_unchanged':True}

            await switch('graticule');await page.evaluate('__gestureQA.state.appearance.leftWidth=34;__gestureQA.state.appearance.rightWidth=56;__gestureQA.state.appearance.layoutGap=42');await page.wait_for_timeout(150);before=await snapshot()
            g=await page.evaluate("async()=>{const {splitLayout}=await import('/instrument-layout.js'),{sonarGeometry}=await import('/instruments/graticule.js'),r=document.querySelector('#stage').getBoundingClientRect(),pane=splitLayout(r.width,r.height,__gestureQA.state.appearance).left,g=sonarGeometry(pane);return {...g,x:g.x+r.x,y:g.y+r.y}}")
            await page.mouse.move(g['x']+g['r']*.04,g['y']+g['r']*.03);await page.mouse.down();await page.mouse.move(g['x']+g['r']*.35,g['y']+g['r']*.3,steps=6);await page.wait_for_timeout(240);playing=await snapshot();await page.mouse.up()
            assert len(playing['data']['stars'])==len(before['data']['stars'])+1,'Star creation missed after independent pane resizing'
            pair=await page.evaluate("__gestureQA.audio.snapshot().voices.filter(v=>v.id.startsWith('map-contact')).map(v=>({id:v.id,midi:v.midi}))")
            assert any(v['id'].endswith('-A') for v in pair) and any(v['id'].endswith('-B') for v in pair),'Lissajous gesture did not create the audible oscillator pair'
            # Deletion is a captured drag, even after it leaves the plot rectangle.
            star=playing['data']['stars'][-1];radar=await page.evaluate('__radar');stage=await page.locator('#stage').bounding_box()
            import math
            sx=stage['x']+radar['x']+math.sin(star['angle'])*star['radius']*radar['r'];sy=stage['y']+radar['y']-math.cos(star['angle'])*star['radius']*radar['r']
            await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(stage['x']+radar['x']+radar['r']*1.3,stage['y']+radar['y'],steps=8);await page.mouse.up()
            deleted=await snapshot();assert len(deleted['data']['stars'])==len(playing['data']['stars'])-1,'Dragging a star beyond the radar did not remove it'
            # Actual waveform buttons animate different camera scales without changing pitch.
            left=(await panes())['left'];wave_width=max(88,min(172,left['w']-76));wx=left['x']+left['w']-wave_width;wy=left['y']+16
            await page.mouse.click(wx+wave_width*.875,wy);await page.wait_for_function('Math.abs(__radar.zoom-.78)<.01');sine_r=await page.evaluate('__radar.r')
            await page.mouse.click(wx+wave_width*.625,wy);await page.wait_for_function('Math.abs(__radar.zoom-1.16)<.01');triangle_r=await page.evaluate('__radar.r')
            assert triangle_r>sine_r*1.3,'Waveform selection did not change radar magnification'
            await page.locator('#play').click();await page.wait_for_timeout(1000);sonar=await page.evaluate("__gestureQA.audio.snapshot().voices.filter(v=>v.id.startsWith('sonar-')).length");assert sonar>0,'Sonar did not emit notes at star crossings'
            await page.screenshot(path=str(OUT/'graticule-sonar.png'))
            await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(300);await page.screenshot(path=str(OUT/'graticule-compact.png'))
            results['graticule']={'stars':len(playing['data']['stars']),'pair':pair,'sonar_voices':sonar,'deleted_stars':len(deleted['data']['stars']),'wave_radii':[sine_r,triangle_r]}
            canceled=[]
            for name in ['cellular','graticule']:
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
            invalid=await page.evaluate('__invalidCanvasRects');assert not invalid,invalid;assert not errors,errors;assert not shader_errors,shader_errors
            print(json.dumps({'results':results,'page_errors':errors,'invalid_rects':invalid,'shader_errors':shader_errors,'webgl1':os.environ.get('FORCE_WEBGL1')=='1'},indent=2))
        finally:
            await browser.close()

asyncio.run(main())
