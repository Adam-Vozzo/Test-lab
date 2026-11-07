"""Signal tablet rendering budget, visual evidence and native WebGL regression.

Run: python3 tests/ipad-performance.browser.py
Chromium/SwiftShader proves buffer budgets and interaction correctness; it does
not measure M1 iPad hardware frame rate or native Safari behavior.
"""
import asyncio
import functools
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa/ipad-performance'
BASELINE = os.environ.get('SIGNAL_BASELINE', 'b136d63b794167ac27e7c985cd7af8571a462c9a')
MAC_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
IPHONE_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

PROBE = '''
window.__qa={scene,galaxy,signalField,state,engine};
window.pauseArtwork=()=>{for(const object of [scene,galaxy,signalField])cancelAnimationFrame(object.raf)};
window.drawArtwork=()=>{const now=performance.now();signalField.updateParticleLayer(now);galaxy.render(0);scene.frameGate?.reset();scene.tick(now);pauseArtwork()};
window.buffers=()=>{
 const dims=c=>({width:c.width,height:c.height,pixels:c.width*c.height});
 const gl=scene.renderer.getContext(),raw=scene.renderer.properties.get(scene.target).__webglColorRenderbuffer,rb=Array.isArray(raw)?raw[0]:raw;
 let actualSamples=0;
 if(rb){const previous=gl.getParameter(gl.RENDERBUFFER_BINDING);gl.bindRenderbuffer(gl.RENDERBUFFER,rb);actualSamples=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_SAMPLES);gl.bindRenderbuffer(gl.RENDERBUFFER,previous)};
 const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
 return {ring:{...dims(scene.canvas),target:dims(scene.target),samples:scene.target.samples,actualSamples,maxSamples:scene.renderer.capabilities.maxSamples,ratio:scene.renderer.getPixelRatio(),preserved:scene.renderer.getContext().getContextAttributes().preserveDrawingBuffer,qualityReduced:!!scene.qualityReduced,profile:scene.renderProfile||null},
 galaxy:{...dims(galaxy.renderer.domElement),ratio:galaxy.renderer.getPixelRatio(),overlay:dims(galaxy.overlay)},
 particles:{...dims(signalField.particleCanvas),ratio:signalField.pixelRatio},
 css:{ring:box(scene.host),galaxy:box(galaxy.host),workspace:box(signalField.host)},
 footer:document.querySelector('.bottom-bar').getBoundingClientRect().bottom,
 viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},overflow:document.documentElement.scrollWidth>innerWidth};
};
window.playablePoint=()=>{const r=scene.host.getBoundingClientRect();for(let i=0;i<8;i++){const p=scene.projectSector(i),x=r.x+p.x,y=r.y+p.y;if(scene.pickClientPoint(x,y,{surfaceOnly:true}))return{x,y}}throw Error('No visible ring hit')};
'''

async def run(base):
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'baseline': BASELINE, 'hardwareMeasured': False, 'cases': {}, 'errors': []}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'])
        try:
            for mode in ['baseline-ipad', 'current-ipad', 'current-iphone', 'current-desktop']:
                ipad = 'ipad' in mode
                phone = 'iphone' in mode
                desktop = 'desktop' in mode
                width, height = (1366, 1024) if ipad else (844, 390) if phone else (1180, 820)
                context = await browser.new_context(viewport={'width': width, 'height': height},
                    device_scale_factor=2, has_touch=not desktop, user_agent=IPHONE_AGENT if phone else MAC_AGENT,
                    service_workers='block')
                await context.add_init_script("Object.defineProperties(navigator,{platform:{get:()=>%s},maxTouchPoints:{get:()=>%d}})" % (json.dumps('iPhone' if phone else 'MacIntel'), 0 if desktop else 5))
                if mode.startswith('baseline'):
                    for filename in ['ring.js', 'galaxy.js', 'signal-field.js']:
                        source = subprocess.check_output(['git', 'show', f'{BASELINE}:{filename}'], cwd=ROOT, text=True)
                        async def old(route, request, source=source):
                            await route.fulfill(content_type='text/javascript', body=source)
                        await context.route('**/' + filename, old)
                async def host(route):
                    source = (ROOT / 'app.js').read_text().replace('const scene=new RingScene', 'state.visual.freeze=true;\nconst scene=new RingScene')
                    await route.fulfill(content_type='text/javascript', body=source + PROBE)
                await context.route('**/app.js', host)
                page = await context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(base + '/index.html', wait_until='domcontentloaded', timeout=90000)
                await page.wait_for_function('window.__qa && __qa.scene.frame>=2', timeout=90000)
                await page.evaluate('pauseArtwork()')
                value = await page.evaluate('buffers()')
                assert not value['ring']['qualityReduced'], value
                assert not value['overflow'] and abs(value['footer']-height) < 1, value
                if mode.startswith('current'):
                    assert value['ring']['profile']['mobile'] != desktop, value
                    assert value['ring']['preserved'] is False, value
                    if not desktop:
                        assert value['ring']['target']['pixels'] <= 702000, value
                        assert value['galaxy']['pixels'] <= 502000, value
                        assert value['particles']['pixels'] <= 1002000, value
                        assert value['ring']['samples'] == min(value['ring']['profile']['ring']['samples'], value['ring']['maxSamples']), value
                        assert value['ring']['actualSamples'] >= value['ring']['samples'], value
                    else:
                        assert value['ring']['ratio'] == 1.7 and value['galaxy']['ratio'] == 1.5, value
                await page.screenshot(path=str(OUT / f'{mode}.png'))
                report['cases'][mode] = value
                if ipad:
                    await page.evaluate('__qa.state.visual.freeze=false;drawArtwork()')
                    held=await page.evaluate('playablePoint()');held.update(id=7,radiusX=5,radiusY=5,force=.7)
                    touch=await context.new_cdp_session(page)
                    await touch.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[held]})
                    await page.wait_for_function('__qa.engine.ready && __qa.engine.getOutputLevel()>.0001',timeout=15000)
                    await page.evaluate('drawArtwork()');await page.wait_for_timeout(60);await page.evaluate('drawArtwork()')
                    value['activeMatrix']=await page.evaluate('({stats:__qa.signalField.lastFilamentStats?.cells,ratio:__qa.signalField.pixelRatio,version:__qa.signalField.particleVersion,presented:__qa.signalField.presentedParticleVersion,rms:__qa.engine.getOutputLevel()})')
                    assert value['activeMatrix']['stats']>0 and value['activeMatrix']['version']==value['activeMatrix']['presented'],value['activeMatrix']
                    await page.screenshot(path=str(OUT / f'{mode}-playing.png'))
                    await touch.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                print(mode, json.dumps(value), flush=True)
                if mode == 'current-ipad':
                    # Detection still applies when an attached trackpad makes
                    # the primary pointer fine, unlike a width/media-only rule.
                    report['trackpadProfile'] = await page.evaluate("async()=>{const m=await import('./render-performance.js');return m.signalRenderProfile({navigator,matchMedia:()=>({matches:false})})}")
                    assert report['trackpadProfile']['ipad'] and report['trackpadProfile']['mobile']
                    capture = await page.evaluate('''async()=>{const url=__qa.scene.capture();if(!url)throw Error('No capture');const image=new Image;image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let covered=0;for(let i=3;i<d.length;i+=4)if(d[i]>8)covered++;return{bytes:url.length,width:image.width,height:image.height,coverage:covered/(d.length/4)}}''')
                    assert capture['coverage'] > .03 and capture['bytes'] > 10000, capture
                    report['capture'] = capture
                    # A rotated/zoomed scene still maps the visible bead to its
                    # CSS touch coordinate, independent of backing resolution.
                    await page.evaluate("__qa.state.visual.freeze=false;__qa.scene.nudgeOrbit(.42,.28);__qa.scene.setZoom(1.12);drawArtwork()")
                    point = await page.evaluate('playablePoint()')
                    point.update(id=1, radiusX=5, radiusY=5, force=.7)
                    cdp = await context.new_cdp_session(page)
                    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[point]})
                    await page.wait_for_function('__qa.engine.ready && __qa.engine.live.size===1 && __qa.engine.getOutputLevel()>.0001', timeout=15000)
                    report['touchOutput'] = await page.evaluate('({rms:__qa.engine.getOutputLevel(),voices:__qa.engine.live.size,contacts:__qa.scene.contacts.size,playing:__qa.state.playing})')
                    assert report['touchOutput']['contacts'] == 1 and not report['touchOutput']['playing'], report['touchOutput']
                    await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                    assert await page.evaluate('__qa.engine.live.size') == 0
                    await page.evaluate('drawArtwork()')
                    before = await page.evaluate('({camera:__qa.galaxy.getInteractionState().camera,sound:{...__qa.state.sound},point:__qa.galaxy.projectCrosshair(),box:buffers().css.galaxy})')
                    x, y = before['box']['x']+before['point']['x'], before['box']['y']+before['point']['y']
                    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x+28, y-18, steps=4); await page.mouse.up()
                    after = await page.evaluate('({camera:__qa.galaxy.getInteractionState().camera,sound:{...__qa.state.sound}})')
                    assert before['camera'] == after['camera'], (before,after)
                    assert before['sound']['cutoff'] != after['sound']['cutoff'], (before,after)
                    report['crosshairDoesNotPan'] = True
                    report['resizes'] = []
                    for size in [(1024,1366),(1366,1024)]:
                        await page.set_viewport_size({'width':size[0],'height':size[1]})
                        await page.evaluate('dispatchEvent(new Event("pageshow"))')
                        await page.wait_for_function('size=>innerWidth===size[0]&&innerHeight===size[1]&&Math.abs(document.querySelector(".bottom-bar").getBoundingClientRect().bottom-size[1])<1',arg=list(size),timeout=5000)
                        await page.wait_for_timeout(100)
                        await page.evaluate('drawArtwork()')
                        check = await page.evaluate('buffers()')
                        assert abs(check['footer']-size[1])<1 and not check['overflow'], check
                        assert check['ring']['target']['pixels'] <= 702000 and check['particles']['pixels'] <= 1002000, check
                        report['resizes'].append(check)
                    # The existing shader regression checks both unsampled and
                    # multisampled alpha, bloom, guide colour and front/rear depth.
                    report['compositing'] = await page.evaluate("import('./tests/rendering.browser.mjs').then(m=>m.runRenderingChecks())")
                report['errors'].extend(errors)
                assert not errors, errors
                await context.close()
            old, new = report['cases']['baseline-ipad'], report['cases']['current-ipad']
            assert old['css'] == new['css'], (old['css'],new['css'])
            assert old['galaxy']['overlay'] == new['galaxy']['overlay'], 'Technical text raster must remain sharp'
            report['pixelReduction'] = {key:1-new[key]['pixels']/old[key]['pixels'] for key in ['ring','galaxy','particles']}
            assert report['pixelReduction']['ring'] > .15 and report['pixelReduction']['particles'] > .3, report['pixelReduction']
            report['passed'] = True
        finally:
            (OUT/'report.json').write_text(json.dumps(report, indent=2))
            await browser.close()
    print(json.dumps({'passed':report.get('passed'), 'pixelReduction':report.get('pixelReduction'), 'errors':report['errors']},indent=2))

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),300))
    finally:
        server.shutdown();server.server_close();thread.join()

if __name__=='__main__':
    main()
