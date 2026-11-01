"""Verify range-track gestures and the real native scene compositor.
Run: python3 tests/shared-instrument.browser.py (requires Python Playwright/Pillow).
"""
import asyncio
import functools
import io
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'shared-regression'
FIXTURE = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/collection.css">
<main class="collection-instrument"><div id="stage" class="collection-stage"></div><footer class="bottom-bar"><label>TEST RANGE <input id="range" type="range" min="0" max="100" step="1" value="30"></label></footer></main>
<script type="module">
import {createScenePostprocess} from '/scene-postprocess.js';import {enableRangeScrubbing} from '/range-scrub.js';
const stage=document.querySelector('#stage');window.fx=createScenePostprocess(stage);window.scrub=enableRangeScrubbing();
const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%;';fx.scene.append(canvas);window.events=[];
const slider=document.querySelector('#range');for(const type of ['input','change'])slider.addEventListener(type,()=>events.push({type,value:+slider.value}));
window.draw=()=>{const r=stage.getBoundingClientRect();canvas.width=r.width;canvas.height=r.height;const c=canvas.getContext('2d');c.fillStyle='#05070a';c.fillRect(0,0,r.width,r.height);c.strokeStyle='#ffffe4';c.lineWidth=3;c.beginPath();c.moveTo(r.width*.5,20);c.lineTo(r.width*.5,r.height-20);c.stroke();c.fillStyle='#b8e8ff';c.fillRect(r.width*.7,70,30,30);c.fillStyle='#e5d27c';c.font='13px monospace';c.fillText('LUMINANCE / COMPOSITOR',24,40);};draw();fx.update({});window.ready=true;
addEventListener('resize',draw);
</script>'''

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/shared-fixture.html':
            body=FIXTURE.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else: super().do_GET()

async def run(base):
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        browser=await p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
        try:
            context=await browser.new_context(viewport={'width':900,'height':560},device_scale_factor=1,has_touch=True)
            page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            await page.goto(base+'/shared-fixture.html');await page.wait_for_function('window.ready')
            slider=page.locator('#range');bounds=await slider.bounding_box();x=bounds['x'];y=bounds['y']+bounds['height']/2;w=bounds['width']
            await page.mouse.move(x+w*.75,y);await page.mouse.down();assert await page.evaluate('scrub.active');assert int(await slider.input_value())>=75
            await page.mouse.move(x+w+150,y-30);assert await slider.input_value()=='100'
            await page.mouse.move(x-100,y-30);assert await slider.input_value()=='0'
            await page.mouse.up();assert not await page.evaluate('scrub.active')
            await slider.press('ArrowRight');assert await slider.input_value()=='1'
            assert await page.evaluate("events.some(e=>e.type==='change')")
            # A second touch can scrub while the first remains on the playing field.
            cdp=await context.new_cdp_session(page)
            first={'x':70,'y':100,'id':1};second={'x':x+w*.5,'y':y,'id':2}
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[first]})
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[first,second]})
            assert await page.evaluate('scrub.active');assert abs(int(await slider.input_value())-50)<=2
            second['x']=x+w*.8;await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[first,second]});assert int(await slider.input_value())>=80
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]});assert not await page.evaluate('scrub.active')
            geometry=await page.locator('#stage').bounding_box()
            async def capture(name,settings):
                await page.evaluate('(v)=>fx.update(v)',settings);await page.wait_for_timeout(180)
                data=await page.screenshot(path=str(OUT/(name+'.png')))
                assert await page.locator('#stage').bounding_box()==geometry
                return Image.open(io.BytesIO(data)).convert('RGB')
            default=await capture('default',{})
            bloom=await capture('bloom',{'sceneBloom':1,'sceneBloomRadius':22,'sceneBloomThreshold':.5})
            cx=geometry['x']+geometry['width']*.5;cy=geometry['y']+geometry['height']*.5
            region=(int(cx+6),int(cy-30),int(cx+22),int(cy+30))
            bloom_delta=sum(ImageStat.Stat(ImageChops.difference(default,bloom).crop(region)).mean)/3
            assert bloom_delta>1, f'Bloom produced no measurable halo: {bloom_delta}'
            blurred=await capture('bloom-blur',{'sceneBloom':1,'sceneBloomRadius':22,'sceneBloomThreshold':.5,'sceneBlur':3})
            grain=await capture('bloom-blur-grain',{'sceneBloom':1,'sceneBloomRadius':22,'sceneBloomThreshold':.5,'sceneBlur':3,'sceneGrain':.3})
            grain_region=(35,80,170,200);grain_delta=sum(ImageStat.Stat(ImageChops.difference(blurred,grain).crop(grain_region)).mean)/3
            assert grain_delta>8,f'Grain is not visible after blur: {grain_delta}'
            sequence=await page.evaluate("[...document.querySelector('filter').children].map(n=>n.tagName)")
            assert sequence[-2:]==['feBlend','feGaussianBlur'];assert await page.evaluate("document.querySelector('.scene-film-grain').previousElementSibling.tagName.toLowerCase()")=='svg'
            await page.evaluate('fx.update({})');await page.wait_for_timeout(100);assert await page.evaluate("document.querySelector('.instrument-scene').style.filter")=='none'
            for width,height in [(1180,820),(844,390),(390,844)]:
                await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(80)
                layout=await page.evaluate("({bottom:document.querySelector('.bottom-bar').getBoundingClientRect().bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})")
                assert abs(layout['bottom']-layout['viewport'])<1 and not layout['overflow'],layout
            assert not errors,errors
            report={'rangeTrackCapture':True,'secondaryTouchScrub':True,'keyboardPreserved':True,'cancelReleasesCapture':True,'bloomHaloDelta':bloom_delta,'grainAfterBlurDelta':grain_delta,'footerAtViewportBottom':True,'errors':errors}
            (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
        finally: await browser.close()

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),90))
    finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()
