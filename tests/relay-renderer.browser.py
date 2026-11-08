"""Real WebGL fit, resize and resource regression for Relay's folded resonator.

Run: python3 tests/relay-renderer.browser.py
Chromium/SwiftShader verifies actual projected vertices at parameter extremes.
The touch profile emulates iPad desktop identification; it is not native iOS QA.
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
<style>html,body{margin:0;background:#080a0b}#host{position:relative}</style>
<div id="host"></div><script type="module">
import * as THREE from '/vendor/three.module.min.js';
import {RelayRenderer} from '/instruments/relay-renderer.js';
import {definition,relayLayout} from '/instruments/relay.js';
window.fixture={THREE,definition,relayLayout,renderer:new RelayRenderer(document.querySelector('#host'))};
</script>'''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == '/__relay_renderer_test__':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(HTML)))
            self.end_headers()
            self.wfile.write(HTML)
        else:
            super().do_GET()


CHECK_LAYOUT = '''async ([width,height]) => {
  const {THREE,definition,relayLayout,renderer:r}=fixture;
  const rect=relayLayout(width,height).hero, samples=[];
  const sound={...definition.defaultSound,damping:0};
  const appearance={...definition.defaultAppearance,idleMotion:1.5};
  for(const material of [0,1])for(const chamberScale of [.6,1.18])for(const time of [0,5,12,28]){
    r.gate.reset();
    r.render(rect,time,{...sound,material},{...appearance,chamberScale},1.5,false);
    let maxEdge=0,vertices=0;
    r.scene.traverse(object=>{
      if(!object.isMesh)return;
      const positions=object.geometry?.attributes?.position;
      if(!positions)return;
      for(let i=0;i<positions.count;i++){
        const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld).project(r.camera);
        if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z))throw new Error('Non-finite projected vertex');
        if(p.z < -1 || p.z > 1)throw new Error('Vertex outside near/far plane');
        maxEdge=Math.max(maxEdge,Math.abs(p.x),Math.abs(p.y));vertices++;
      }
    });
    samples.push({material,chamberScale,time,maxEdge,vertices,cameraZ:r.camera.position.z});
    await new Promise(requestAnimationFrame);
  }
  r.gate.reset();r.render(rect,35,sound,appearance,.7,false);
  const gl=r.renderer.getContext(),pixels=new Uint8Array(r.canvas.width*r.canvas.height*4);
  gl.readPixels(0,0,r.canvas.width,r.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let coloured=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>12&&(pixels[i]+pixels[i+1]+pixels[i+2])>18)coloured++;
  return {
    layout:[width,height],samples,
    backing:[r.canvas.width,r.canvas.height],css:[rect.w,rect.h],
    maxEdge:Math.max(...samples.map(s=>s.maxEdge)),
    cameraStable:new Set(samples.map(s=>s.cameraZ)).size===1,
    colouredFraction:coloured/(pixels.length/4),glError:gl.getError()
  };
}'''


async def run(url):
    report = {'nativeIOS': False, 'profiles': {}}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path='/usr/bin/chromium', headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
                  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        try:
            for mobile in [False, True]:
                name = 'ipad-desktop-identification' if mobile else 'desktop'
                context = await browser.new_context(
                    viewport={'width': 1366, 'height': 1024},
                    device_scale_factor=2, has_touch=mobile, service_workers='block')
                if mobile:
                    await context.add_init_script("Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});")
                page = await context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(url + '/__relay_renderer_test__')
                await page.wait_for_function('window.fixture?.renderer.available')
                profile = await page.evaluate('({mobile:fixture.renderer.profile.mobile,ipad:fixture.renderer.profile.ipad})')
                assert profile['mobile'] == mobile, profile
                if mobile:
                    assert profile['ipad'], profile
                results = []
                for dimensions in [[1152,740],[816,327],[374,764],[1152,740]]:
                    result = await page.evaluate(CHECK_LAYOUT, dimensions)
                    assert result['maxEdge'] < 1, (name, result)
                    assert result['cameraStable'], (name, result)
                    assert result['glError'] == 0, (name, result)
                    assert .005 < result['colouredFraction'] < .8, (name, result)
                    assert all(s['vertices'] > 1500 for s in result['samples']), result
                    assert result['backing'][0] * result['backing'][1] <= (520000 if mobile else 950000), result
                    results.append(result)
                # Backing dimensions must return to the same size after portrait.
                assert results[0]['backing'] == results[-1]['backing'], results
                disposal = await page.evaluate('''()=>{
                  const r=fixture.renderer,canvas=r.canvas;
                  let disposed=0;const resources=[...r.resources,r.env];
                  for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
                  r.destroy();r.destroy();
                  return {disposed,expected:resources.length,connected:canvas.isConnected,available:r.available};
                }''')
                assert disposal == {'disposed':disposal['expected'],'expected':disposal['expected'],'connected':False,'available':False}, disposal
                assert not errors, errors
                report['profiles'][name] = {'profile':profile,'layouts':results,'disposal':disposal,'pageErrors':errors}
                await context.close()
        finally:
            await browser.close()
    output = ROOT / 'qa' / 'relay-review'
    output.mkdir(parents=True,exist_ok=True)
    (output/'renderer-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({name:{'cases':sum(len(r['samples']) for r in data['layouts']),'maxEdge':max(r['maxEdge'] for r in data['layouts']),'resourcesDisposed':data['disposal']['disposed']} for name,data in report['profiles'].items()},indent=2))


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),180))
    finally:
        server.shutdown()
        server.server_close()
