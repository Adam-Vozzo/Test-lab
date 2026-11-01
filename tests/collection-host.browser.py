"""Production collection host regression: routing, presets, lifecycle and layouts.
Run: python3 tests/collection-host.browser.py. Add --gpu to exercise Three renderers.
The default CPU run complements the separate visual/GPU review.
"""
import argparse
import asyncio
import functools
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'collection-host'

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

async def run(base,gpu=False):
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required']+(['--use-angle=swiftshader','--enable-unsafe-swiftshader'] if gpu else ['--disable-webgl'])
        browser=await p.chromium.launch(executable_path=executable,headless=True,args=args)
        try:
            context=await browser.new_context(viewport={'width':1180,'height':820},device_scale_factor=1,has_touch=True,service_workers='block')
            async def host_probe(route):
                await route.fulfill(status=200,content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__host',{get:()=>({audio,state,controller,currentId,loadInstrument,definition})});")
            async def geometry_probe(route):
                source=(ROOT/'instrument-layout.js').read_text().replace('export function splitLayout(','function originalSplitLayout(')
                source+="\nexport function splitLayout(...args){const result=originalSplitLayout(...args);if(window.__host){window.__layoutRecords ||= {};window.__layoutRecords[__host.currentId]={args:[args[0],args[1],args[2]?.leftWidth,args[2]?.rightWidth,args[2]?.layoutGap],result};}return result;}"
                await route.fulfill(status=200,content_type='text/javascript',body=source)
            await context.route('**/collection.js',host_probe);await context.route('**/instrument-layout.js',geometry_probe)
            page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));report={'gpu':gpu}
            async def loaded(id):
                await page.wait_for_function("id=>window.__host?.currentId===id&&!document.querySelector('#stage').hasAttribute('aria-busy')&&!document.querySelector('.load-error')",arg=id)
            await page.goto(base+'/collection.html#carrier');await loaded('carrier')
            ids=await page.evaluate("import('./instruments/catalog.js').then(m=>m.INSTRUMENTS.filter(i=>i.load).map(i=>i.id))")
            print('host loaded',flush=True)
            canvas=page.locator('canvas[role=application]').first;canvas_bounds=await canvas.bounding_box();px=canvas_bounds['x']+canvas_bounds['width']*.2;py=canvas_bounds['y']+canvas_bounds['height']*.3
            await page.mouse.click(px,py);assert await canvas.evaluate("e=>getComputedStyle(e).outlineStyle")=='none'
            await page.locator('#play').focus();await page.keyboard.press('Shift+Tab');assert await canvas.evaluate("e=>e===document.activeElement&&getComputedStyle(e).outlineStyle!=='none'")
            await page.touchscreen.tap(px,py);assert await canvas.evaluate("e=>getComputedStyle(e).outlineStyle")=='none';report['keyboardOnlyCanvasFocus']=True
            # A pending audio activation cannot resurrect a cancelled Play.
            await page.evaluate("window.originalStart=__host.audio.start;__host.audio.start=()=>new Promise(resolve=>window.finishStart=resolve);void 0")
            await page.locator('#play').click();assert await page.evaluate('__host.state.playing')
            await page.locator('#play').click();await page.evaluate('finishStart(true)');await page.wait_for_timeout(50)
            assert not await page.evaluate('__host.state.playing');await page.evaluate('__host.audio.start=originalStart;void 0');report['pendingPlayCancellation']=True;print('pending play passed',flush=True)
            # Lifecycle notification happens once per transition, not on every tempo edit.
            await page.evaluate("window.transitions=[];window.originalPlaying=__host.controller.setPlaying;__host.controller.setPlaying=function(v){transitions.push(v);return originalPlaying?.call(this,v)};void 0")
            await page.locator('#play').click();await page.wait_for_function('__host.audio.context?.state===\'running\'')
            await page.locator('#bpm').evaluate("e=>{e.value=127;e.dispatchEvent(new Event('input',{bubbles:true}))}")
            await page.locator('#play').click();assert await page.evaluate('transitions')==[True,False]
            report['transportTransitions']=True;print('transport hooks passed',flush=True)
            # Async route replacement must save the outgoing state only once.
            await page.evaluate("__host.state.bpm=139")
            async def delayed(route):await asyncio.sleep(.3);await route.continue_()
            await context.route('**/instruments/cellular.js',delayed)
            await page.evaluate("__host.loadInstrument('cellular');__host.loadInstrument('census')");await loaded('census')
            assert await page.evaluate("JSON.parse(localStorage.getItem('duo.instrument.carrier.v1')).bpm")==139
            await page.evaluate("location.hash='carrier'");await loaded('carrier');assert await page.evaluate('__host.state.bpm')==139
            report['rapidSwitchPersistence']=True;print('switching passed',flush=True)
            # Shared settings participate in named presets, undo, export/import and reload.
            await page.locator('#appearance-toggle').click();await page.locator('[data-tabs=appearance] [data-group=Layout]').click()
            slider=page.locator('[data-key=leftWidth]');original=await slider.input_value()
            await slider.evaluate("e=>{e.value=63;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}")
            await page.locator('#save-look').click();await page.locator('#look-name').fill('Layout regression');await page.locator('#save-look-form button[type=submit]').click()
            await page.locator('#reset-look').click();assert await slider.input_value()==original
            await page.locator('#undo-look').click();assert await slider.input_value()=='63'
            await page.locator('#appearance-preset').select_option('reference');await page.locator('#appearance-preset').select_option('0');assert await slider.input_value()=='63'
            async with page.expect_download() as download:await page.locator('#export-look').click()
            export=OUT/'carrier-settings.json';await (await download.value).save_as(export)
            await page.locator('#reset-look').click();await page.locator('#import-look').set_input_files(export);await page.wait_for_function("JSON.parse(localStorage.getItem('duo.instrument.carrier.v1')).appearance.leftWidth===63");assert await slider.input_value()=='63'
            await page.reload();await loaded('carrier');assert await page.evaluate('__host.state.appearance.leftWidth')==63
            report['sharedPresetRoundTrip']=True;print('presets passed',flush=True)
            # Independent floating panels coexist and can be repositioned.
            if await page.locator('#appearance').is_hidden():await page.locator('#appearance-toggle').click()
            await page.locator('#sound-toggle').click();assert await page.locator('#appearance').is_visible() and await page.locator('#sound-popover').is_visible()
            await page.locator('#appearance-toggle').click()
            header=await page.locator('#appearance .panel-heading').bounding_box();before=await page.locator('#appearance').bounding_box()
            await page.mouse.move(header['x']+60,header['y']+18);await page.mouse.down();await page.mouse.move(header['x']+110,header['y']+48,steps=5);await page.mouse.up()
            after=await page.locator('#appearance').bounding_box();assert after['x']!=before['x'] or after['y']!=before['y']
            await page.locator('#appearance [data-close]').click();await page.locator('#sound-popover [data-close]').click();report['independentDraggablePanels']=True
            report['routes']=[]
            for id in ids:
                print('checking',id,flush=True);await page.evaluate('(id)=>location.hash=id',id);await loaded(id)
                await page.wait_for_timeout(80)
                single=await page.evaluate("__host.definition.layoutMode==='single'")
                if not single:
                    await page.locator('#appearance-toggle').click();await page.locator('[data-tabs=appearance] [data-group=Layout]').click()
                    for key,value in [('leftWidth',28),('rightWidth',72),('layoutGap',70)]:
                        await page.locator(f'[data-key={key}]').evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}",value)
                    await page.wait_for_function("id=>window.__layoutRecords?.[id]?.args.slice(2).join(',')==='28,72,70'",arg=id,timeout=5000)
                    await page.locator('#appearance [data-close]').click()
                dimensions=[]
                for width,height in [(1180,820),(844,390),(390,844)]:
                    await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(120)
                    await page.wait_for_function("[...document.querySelectorAll('#stage canvas.instrument-canvas')].every(c=>c.clientWidth>1&&c.clientHeight>1&&Math.abs(c.width-c.clientWidth*Math.min(devicePixelRatio,1.75))<2&&Math.abs(c.height-c.clientHeight*Math.min(devicePixelRatio,1.75))<2)",timeout=5000)
                    layout=await page.evaluate("({bottom:document.querySelector('.bottom-bar').getBoundingClientRect().bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,stageHeight:document.querySelector('.instrument-scene').getBoundingClientRect().height})")
                    assert abs(layout['bottom']-height)<1 and not layout['overflow'] and layout['stageHeight']>height*.6,(id,layout)
                    dimensions.append([width,height])
                await page.set_viewport_size({'width':1180,'height':820})
                report['routes'].append({'id':id,'splitControls':not single,'dimensions':dimensions})
            # Every route is also linked from Signal's existing picker.
            await page.goto(base+'/index.html');signal_range=page.locator('#cutoff');await signal_range.wait_for(state='visible');bounds=await signal_range.bounding_box();rx=bounds['x'];ry=bounds['y']+bounds['height']/2
            await page.mouse.move(rx+bounds['width']*.7,ry);await page.mouse.down();assert float(await signal_range.input_value())>.65
            await page.mouse.move(rx+bounds['width']+80,ry);assert float(await signal_range.input_value())==1
            await page.mouse.up();await signal_range.press('ArrowLeft');assert float(await signal_range.input_value())<1;report['signalTrackScrub']=True
            await page.locator('#collection-toggle').click()
            assert await page.locator('#instrument-menu .im-entry').count()==len(ids)+1
            await page.locator('#instrument-menu a[href="./collection.html#census"]').click();await loaded('census')
            report['signalNavigation']=True;report['errors']=errors;assert not errors,errors
            report['passed']=True;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
        except Exception as error:
            report.update(passed=False,error=str(error),errors=errors)
            try:report['failureState']=await page.evaluate("({id:window.__host?.currentId,layout:window.__layoutRecords?.[window.__host?.currentId],appearance:window.__host?.state.appearance})")
            except Exception:pass
            (OUT/'report.json').write_text(json.dumps(report,indent=2));raise
        finally:await browser.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--gpu',action='store_true');args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}',args.gpu),240))
    finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()
