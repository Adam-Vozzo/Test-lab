"""Small real-WebGL regression for the original Milkdrop feedback renderer.

Run with: python tests/milkdrop-renderer.browser.py
Uses Chromium/SwiftShader at 160 x 100; pixel readback exists only in this test.
The native phone/Safari GPU remains a separate device-validation requirement.
"""
import asyncio
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = b'''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#03050a}#host{position:relative;width:160px;height:100px}</style>
<div id="host"></div><script type="module">
import {MilkdropRenderer} from '/instruments/milkdrop-renderer.js';
window.renderer = new MilkdropRenderer(document.querySelector('#host'),{onUnavailable:error=>window.failure=String(error)});
window.ready = true;
</script>'''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == '/__milkdrop_renderer_test__':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(HTML)))
            self.end_headers()
            self.wfile.write(HTML)
        else:
            super().do_GET()


HELPERS = '''() => {
  window.read = (index=renderer.readIndex) => {
    const r=renderer, gl=r.gl, data=new Uint8Array(r.canvas.width*r.canvas.height*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,r.targets[index].framebuffer);
    gl.readPixels(0,0,r.canvas.width,r.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return data;
  };
  window.metrics = data => {
    let total=0, bright=0, white=0, max=0;
    for(let i=0;i<data.length;i+=4){
      const value=(data[i]+data[i+1]+data[i+2])/3;
      total+=value;if(value>12)bright++;
      if(data[i]>230&&data[i+1]>230&&data[i+2]>230)white++;
      max=Math.max(max,data[i],data[i+1],data[i+2]);
    }
    return {mean:total/(data.length/4),bright:bright/(data.length/4),white:white/(data.length/4),max};
  };
  window.difference=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)if(i%4!==3)sum+=Math.abs(a[i]-b[i]);return sum/(a.length/4*3)};
  window.frames=async(count,options)=>{for(let i=0;i<count;i++){renderer.frame(options);if(i%8===7)await new Promise(requestAnimationFrame)}};
  window.seedHistory=value=>{
    const r=renderer,gl=r.gl,bytes=new Uint8Array(r.canvas.width*r.canvas.height*4);
    for(let i=0;i<bytes.length;i+=4){bytes[i]=bytes[i+1]=bytes[i+2]=value;bytes[i+3]=255}
    for(const target of r.targets){gl.bindTexture(gl.TEXTURE_2D,target.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,r.canvas.width,r.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes)}
  };
  window.cornerMean=()=>{
    const bytes=read(),width=renderer.canvas.width;let sum=0,count=0;
    for(let y=10;y<22;y++)for(let x=20;x<40;x++){sum+=bytes[(y*width+x)*4];count++}
    return sum/count;
  };
}'''


async def run(url):
    report = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path='/usr/bin/chromium', headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        try:
            page = await browser.new_page(viewport={'width': 320, 'height': 240}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(url + '/__milkdrop_renderer_test__')
            await page.wait_for_function('window.ready')
            backend = await page.evaluate('({backend:renderer.backend,failure:window.failure})')
            assert backend['backend'] == 'webgl', backend
            await page.evaluate(HELPERS)

            report['families'] = await page.evaluate('''async()=>{
              const result=[];
              for(let family=0;family<8;family++){
                renderer.reset();
                await frames(12,{dt:1/30,params:{family,feedback:.91,warp:.78,motion:.42,scale:1.1,detail:.78}});
                result.push(metrics(read()));
              }
              return result;
            }''')
            for family, result in enumerate(report['families']):
                assert result['max'] > 24 and result['bright'] > .005, (family, result)
                assert result['white'] < .2, (family, result)

            report['extremes'] = await page.evaluate('''async()=>{
              const result=[],waveform=Float32Array.from({length:512},(_,i)=>Math.sin(i*.7)),frequency=new Float32Array(256).fill(1);
              for(let family=0;family<8;family++){
                renderer.reset();
                await frames(16,{dt:1/30,waveform,frequency,rms:1,params:{family,feedback:.98,warp:1.5,motion:2,scale:.4,symmetry:12,lineWidth:2.5,detail:1,exposure:1.8,colourSeparation:1,response:2,zoom:1,rotation:1,mirror:1,raster:1}});
                result.push(metrics(read()));
              }
              return result;
            }''')
            for family, result in enumerate(report['extremes']):
                assert result['white'] < .35 and result['mean'] < 180, (family, result)
                assert result['max'] > 16, (family, result)

            report['historyDifference'] = await page.evaluate('''async()=>{
              renderer.reset();
              await frames(24,{dt:1/30,params:{family:0,feedback:.94,detail:1,motion:1}});
              const options={dt:1/30,params:{family:7,feedback:.94,motion:0,response:0}};
              renderer.frame(options);const retained=read();
              renderer.reset();renderer.frame(options);return difference(retained,read());
            }''')
            assert report['historyDifference'] > 1, report

            report['fade'] = await page.evaluate('''async()=>{
              const params={family:7,scale:.4,motion:0,response:0,feedback:.96,colourSeparation:0};
              renderer.reset();seedHistory(24);const initial=cornerMean();
              await frames(90,{dt:.05,params});const lowRate=cornerMean();
              renderer.reset();seedHistory(24);
              await frames(270,{dt:1/60,params});const highRate=cornerMean();
              return {initial,lowRate,highRate};
            }''')
            assert report['fade']['lowRate'] < 11, report['fade']
            assert report['fade']['highRate'] < 11, report['fade']
            assert abs(report['fade']['lowRate'] - report['fade']['highRate']) < 2, report['fade']

            report['motion'] = await page.evaluate('''async()=>{
              const base={family:0,feedback:.4,motion:0,mirror:0,response:0,colourSeparation:1,rotation:1,zoom:1};
              renderer.reset();renderer.clock=.7;await frames(60,{dt:1/30,params:base});const stopped=read(),clock=renderer.clock;
              renderer.reset();await frames(60,{dt:1/30,params:{...base,mirror:1}});const mirrorDifference=difference(stopped,read());
              renderer.reset();await frames(60,{dt:1/30,params:{...base,motion:2,mirror:1},reducedMotion:true});
              return {clock,finalClock:renderer.clock,mirrorDifference,reducedDifference:difference(stopped,read())};
            }''')
            assert report['motion']['clock'] == report['motion']['finalClock'], report['motion']
            assert report['motion']['mirrorDifference'] < .01, report['motion']
            assert report['motion']['reducedDifference'] < .01, report['motion']

            report['resize'] = await page.evaluate('''()=>{
              renderer.reset();const cleared=metrics(read()).max;
              renderer.resize(240,150,1);
              return {cleared,size:[renderer.canvas.width,renderer.canvas.height],targets:renderer.targets.map((_,i)=>metrics(read(i)).max),error:renderer.gl.getError()};
            }''')
            assert report['resize'] == {'cleared': 0, 'size': [240, 150], 'targets': [0, 0], 'error': 0}, report['resize']

            supported = await page.evaluate('''()=>{window.lossExtension=renderer.gl.getExtension('WEBGL_lose_context');if(lossExtension)lossExtension.loseContext();return Boolean(lossExtension)}''')
            if supported:
                await page.wait_for_function('renderer.lost')
                await page.evaluate('lossExtension.restoreContext()')
                await page.wait_for_function('!renderer.lost && renderer.targets.length===2')
                report['restored'] = await page.evaluate('''()=>{renderer.frame({params:{family:3}});return{backend:renderer.backend,error:renderer.gl.getError(),max:metrics(read()).max}}''')
                assert report['restored']['backend'] == 'webgl' and report['restored']['error'] == 0, report['restored']
                assert report['restored']['max'] > 0, report['restored']

            report['disposed'] = await page.evaluate('''()=>{const canvas=renderer.canvas;renderer.destroy();return !canvas.isConnected&&renderer.gl===null}''')
            assert report['disposed']
            assert not errors, errors
            report['pageErrors'] = errors
            print(json.dumps(report, indent=2))
        finally:
            await browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'), 180))
    finally:
        server.shutdown()
