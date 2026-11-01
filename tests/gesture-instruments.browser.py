"""Native browser regression for Graticule's active orbit clipping.
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

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'gesture-regression'

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        browser = await playwright.chromium.launch(
            executable_path=executable, headless=True,
            args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
        try:
            context = await browser.new_context(viewport={'width':1180,'height':820}, device_scale_factor=1.5, service_workers='block')
            await context.add_init_script('''
                window.__invalidCanvasRects=[];
                const original=CanvasRenderingContext2D.prototype.rect;
                CanvasRenderingContext2D.prototype.rect=function(...args){
                    if(args.some(value=>!Number.isFinite(value)))window.__invalidCanvasRects.push(args.map(String));
                    return original.apply(this,args);
                };
            ''')
            page = await context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            await page.goto(os.environ.get('PREVIEW_URL','http://127.0.0.1:4177')+'/collection.html#graticule', wait_until='load')
            await page.locator('#stage canvas[role="application"]').wait_for()
            results=[]
            for width,height in [(1180,820),(844,390)]:
                await page.set_viewport_size({'width':width,'height':height})
                await page.wait_for_timeout(1600)
                async def luminous_pixels():
                    return await page.evaluate('''()=>{
                        const canvas=document.querySelector('#stage canvas[role="application"]'),ctx=canvas.getContext('2d'),r=canvas.getBoundingClientRect(),d=canvas.width/r.width;
                        const x=Math.round(r.width*.035*d),y=Math.round(64*d),w=Math.round(r.width*.44*d),h=Math.max(1,Math.round((r.height-152)*d));
                        const pixels=ctx.getImageData(x,y,w,h).data;let count=0;
                        for(let i=0;i<pixels.length;i+=4)if(pixels[i]>210&&pixels[i+1]>200&&pixels[i+2]>180&&pixels[i+3]>100)count++;
                        return count;
                    }''')
                before=await luminous_pixels()
                bounds=await page.locator('#stage').bounding_box()
                await page.mouse.move(bounds['x']+bounds['width']*.32,bounds['y']+bounds['height']*.38)
                await page.mouse.down()
                await page.wait_for_timeout(550)
                during=await luminous_pixels()
                invalid=await page.evaluate('window.__invalidCanvasRects')
                await page.screenshot(path=str(OUT/f'graticule-{width}x{height}.png'))
                await page.mouse.up()
                result={'viewport':[width,height],'idle_luminous_pixels':before,'active_luminous_pixels':during,'invalid_rects':invalid}
                results.append(result)
                assert not invalid, f'Canvas received nonfinite clipping bounds: {invalid}'
                assert during>before+80, f'Active orbit head was not rendered at {width}×{height}: {result}'
            assert not errors, errors
            print(json.dumps({'results':results,'page_errors':errors},indent=2))
        finally:
            await browser.close()

asyncio.run(main())
