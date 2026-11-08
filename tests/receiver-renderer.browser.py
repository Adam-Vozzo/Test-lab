"""Actual Canvas2D phosphor rendering, label bounds and lifecycle regression.

Run: python3 tests/receiver-renderer.browser.py
Uses Chromium without WebGL. This does not establish native iOS performance.
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
OUT = ROOT / 'qa' / 'receiver-review'


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == '/__receiver_renderer_test__':
            body = b'<!doctype html><meta charset="utf-8"><title>Receiver rendering test</title>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


SCRIPT = r'''async () => {
 const {ReceiverRenderer,rasterText,__textCache}=await import('/instruments/receiver-renderer.js');
 const {definition,receiverLayout}=await import('/instruments/receiver.js');
 const canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;
 const context=canvas.getContext('2d',{willReadFrequently:true}),renderer=new ReceiverRenderer();
 const defaults={...definition.defaultAppearance};
 const paint=(appearance=defaults,time=0,reduced=false)=>{
  renderer.draw(context,receiverLayout(canvas.width,canvas.height,appearance),appearance,time,reduced);
  return context.getImageData(0,0,canvas.width,canvas.height).data;
 };
 const luminance=(data,x,y)=>{const i=(y*canvas.width+x)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];};
 const metrics=data=>{
  let sum=0,bright=0;for(let i=0;i<data.length;i+=4){const light=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];sum+=light;if(light>220)bright++;}
  return {mean:sum/(data.length/4),brightFraction:bright/(data.length/4),center:luminance(data,300,300),edge:luminance(data,5,5)};
 };
 const differences=(a,b)=>{let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])count++;return count/(a.length/4);};
 const idle=paint(),first=metrics(idle);
 const moving=paint(defaults,.13);const animatedDifference=differences(idle,moving);
 const stillA=paint(defaults,0,true),stillB=paint(defaults,83,true);
 const reducedDifference=differences(stillA,stillB);
 const quiet={...defaults,grain:0,scanlines:0,rasterDrift:0};
 const dark=metrics(paint({...quiet,exposure:.45})),light=metrics(paint({...quiet,exposure:1.6}));
 canvas.width=390;canvas.height=844;paint(defaults,2,true);
 const portraitBacking=[renderer.background.width,renderer.background.height];
 canvas.width=600;canvas.height=600;const restored=paint(defaults,0,true);
 const resizeDifference=differences(stillA,restored);
 // The test-only export exposes cache size without adding production globals.
 __textCache.clear();
 for(let i=0;i<400;i++)rasterText(context,'RX '+i,40,40,11.5,'rgba(198,208,200,.8)');
 const textEntries=__textCache.size;
 const previous=textEntries;
 for(let i=0;i<50;i++)rasterText(context,'RX 399',40,40,11.5,`rgba(198,208,200,${i/50})`);
 const opacityDoesNotAllocate=__textCache.size===previous;
 const noise=[...renderer.noise],backdrop=renderer.background;
 renderer.dispose();renderer.dispose();
 const disposed=renderer.noise.length===0&&backdrop.width===1&&backdrop.height===1&&noise.every(c=>c.width===1&&c.height===1);
 return {first,animatedDifference,reducedDifference,dark,light,portraitBacking,resizeDifference,textEntries,opacityDoesNotAllocate,disposed};
}'''


async def run(url):
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=shutil.which('chromium'), headless=True,
            args=['--no-sandbox', '--disable-webgl', '--disable-dev-shm-usage'],
        )
        try:
            context = await browser.new_context(service_workers='block')

            async def expose_cache(route):
                source = (ROOT / 'instruments/receiver-renderer.js').read_text()
                source = source.replace('draw(c,l,v,t,reduced=false){', 'draw(c,l,v,t,reduced=false){if(window.__receiverInspect)window.__receiverTextBounds=[];', 1)
                source = source.replace('export function rasterText(', 'function baseRasterText(', 1)
                source += '''
export const __textCache=TEXT_CACHE;
export function rasterText(c,text,x,y,size=10,colour='#c4d0cd',align='left',spacing=1){
 const width=baseRasterText(c,text,x,y,size,colour,align,spacing);
 if(window.__receiverInspect){const left=x-(align==='right'?width:align==='center'?width*.5:0);window.__receiverTextBounds.push({text:String(text),x:left,y:y-size*.5,w:width,h:size});}
 return width;
}
'''
                await route.fulfill(content_type='text/javascript', body=source)

            async def expose_host(route):
                source = (ROOT / 'collection.js').read_text()
                await route.fulfill(content_type='text/javascript', body=source+"\nObject.defineProperty(window,'__receiverHost',{get:()=>({state,controller,currentId})});")

            await context.route('**/instruments/receiver-renderer.js', expose_cache)
            await context.route('**/collection.js', expose_host)
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(url+'/__receiver_renderer_test__')
            result = await page.evaluate(SCRIPT)
            assert result['first']['center'] > result['first']['edge'] * 3, result
            assert result['animatedDifference'] > .1, result
            assert result['reducedDifference'] == 0, result
            assert result['light']['mean'] > result['dark']['mean'] * 1.5, result
            assert result['light']['brightFraction'] < .001, result
            assert result['portraitBacking'] == [390, 844], result
            assert result['resizeDifference'] == 0, result
            assert result['textEntries'] <= 192 and result['opacityDoesNotAllocate'], result
            assert result['disposed'] and not errors, (result, errors)
            # Record the actual bitmap rectangles emitted by the production
            # instrument at the largest allowed labels and corner positions.
            await page.emulate_media(reduced_motion='reduce')
            await page.goto(url+'/collection.html#receiver')
            await page.wait_for_function("window.__receiverHost?.currentId==='receiver'&&!document.querySelector('#stage').hasAttribute('aria-busy')")
            await page.evaluate('''()=>{
              window.__receiverInspect=true;
              Object.assign(__receiverHost.state.appearance,{markScale:1.8,readoutScale:1.5,curvature:1,targetDrift:1});
              __receiverHost.controller.setData({beacons:[{x:.025,y:.035},{x:.975,y:.035},{x:.025,y:.965},{x:.975,y:.965},{x:.5,y:.5}]});
            }''')
            labels = []
            for width, height in [(844,390),(390,844),(667,375),(1180,820)]:
                await page.set_viewport_size({'width':width,'height':height})
                await page.wait_for_timeout(300)
                check = await page.evaluate(r'''()=>{
                  const all=window.__receiverTextBounds,notes=all.filter(r=>/^[A-G][#♯♭]?-?\d$/.test(r.text)),beacons=notes.slice(0,5);
                  const fixed=[...notes.slice(5),...all.filter(r=>r.text.endsWith(' HZ')||r.text.startsWith('RX ')||r.text.startsWith('SCAN '))];
                  const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
                  return {viewport:[innerWidth,innerHeight],noteCount:notes.length,collisions:beacons.flatMap(a=>fixed.filter(b=>overlaps(a,b)).map(b=>({beacon:a,fixed:b}))),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};
                }''')
                assert check['noteCount']==8 and not check['collisions'] and not check['overflow'],check
                labels.append(check)
            result['reservedLabelBounds']=labels
            async def screen_luminance(halation):
                await page.evaluate('(value)=>{__receiverHost.state.appearance.phosphorHalo=value;}', halation)
                await page.wait_for_timeout(200)
                return await page.evaluate('''()=>{
                  const canvas=document.querySelector('#stage canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
                  let sum=0;for(let i=0;i<data.length;i+=4)sum+=data[i]+data[i+1]+data[i+2];return sum;
                }''')
            no_halo = await screen_luminance(0)
            full_halo = await screen_luminance(1)
            assert full_halo > no_halo, (no_halo, full_halo)
            result['localHalationOffAndOn'] = {'off':no_halo,'on':full_halo}
            assert not errors, errors
            result.update(passed=True, nativeIOS=False, errors=errors)
            (OUT/'renderer-report.json').write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
        finally:
            await browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'), 120))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
