"""Native PWA update and offline regression using the archived v18 worker.
Run after source edits finish: python3 tests/collection-offline.browser.py
Requires Python Playwright. Uses a private loopback server, no WebGL or remote assets.
"""
import asyncio
import functools
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import unquote,urlsplit
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'collection-offline'
CURRENT=(ROOT/'sw.js').read_text()
PREVIOUS=(ROOT/'tests/fixtures/sw-v18.js').read_text()
VERSION=re.search(r'\$\{CACHE_PREFIX\}([^`]+)',CURRENT).group(1)
OLD_VERSION=re.search(r'\$\{CACHE_PREFIX\}([^`]+)',PREVIOUS).group(1)
NEW='duo-ember-shell-'+VERSION
OLD='duo-ember-shell-'+OLD_VERSION
phase={'new':False}
FIXTURE='''<!doctype html><meta charset="utf-8"><title>Update regression</title><style>input{width:300px;touch-action:none}body{padding:40px}</style><input id="range" type="range" value="40"><script type="module">
import {setupPWA} from './pwa.js';import {enableRangeScrubbing} from './range-scrub.js';window.playing=false;window.scrubbing=enableRangeScrubbing();window.pwa=setupPWA({isPlaying:()=>playing||scrubbing.active});window.ready=true;
</script>'''

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def translate_path(self,path):
        relative=unquote(urlsplit(path).path).removeprefix('/Test-lab/').lstrip('/')
        return str(ROOT/relative)
    def do_GET(self):
        if self.path=='/Test-lab/sw.js':body=(CURRENT if phase['new'] else PREVIOUS).encode();kind='text/javascript'
        elif self.path=='/Test-lab/update-fixture.html':body=FIXTURE.encode();kind='text/html; charset=utf-8'
        else:return super().do_GET()
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)

async def run(base):
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        browser=await p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
        report={'previousWorker':OLD_VERSION,'currentWorker':VERSION};errors=[];failed=[]
        try:
            context=await browser.new_context(viewport={'width':1180,'height':820},has_touch=True,reduced_motion='reduce');page=await context.new_page()
            page.on('pageerror',lambda error:errors.append(str(error)));page.on('requestfailed',lambda request:failed.append({'url':request.url,'error':request.failure}))
            await page.goto(base+'update-fixture.html');await page.wait_for_function('window.ready')
            await asyncio.wait_for(page.evaluate('navigator.serviceWorker.ready.then(r=>r.scope)'),30)
            await page.wait_for_function('!!navigator.serviceWorker.controller')
            assert await page.evaluate('caches.keys()')==[OLD]
            await page.reload();await page.wait_for_function('window.ready');await page.evaluate("caches.open('unrelated-app')")
            await page.evaluate('playing=true');phase['new']=True
            await page.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update())')
            await page.wait_for_function('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)')
            await page.wait_for_timeout(2200)
            assert await page.evaluate('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)')
            assert set(await page.evaluate('caches.keys()'))=={OLD,NEW,'unrelated-app'};report['deferredDuringPlayback']=True
            # Stop playback while a native range drag is still physically held.
            bounds=await page.locator('#range').bounding_box();await page.mouse.move(bounds['x']+bounds['width']*.6,bounds['y']+bounds['height']/2);await page.mouse.down()
            assert await page.evaluate('scrubbing.active')
            await page.evaluate("playing=false;dispatchEvent(new Event('duo:transport'))");await page.wait_for_timeout(2200)
            assert await page.evaluate('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)');report['deferredDuringRangeScrub']=True
            async with page.expect_navigation(wait_until='load'):
                await page.mouse.up();await page.evaluate("dispatchEvent(new Event('duo:transport'))")
            await page.wait_for_function('window.ready');report['activatedAfterRelease']=True
            cache=await page.evaluate('''async()=>{const names=await caches.keys(),name=names.find(n=>n.startsWith('duo-ember-shell-')),c=await caches.open(name),assets=[];for(const request of await c.keys()){const bytes=await(await c.match(request)).arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);assets.push({path:new URL(request.url).pathname.split('/Test-lab/')[1],sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')});}return{names,name,assets};}''')
            assert set(cache['names'])=={NEW,'unrelated-app'};assert len(cache['assets'])==47,len(cache['assets'])
            def verify_hashes():
                for asset in cache['assets']:assert hashlib.sha256((ROOT/asset['path']).read_bytes()).hexdigest()==asset['sha256'],asset['path']
            verify_hashes();report['cachedFiles']=cache['assets'];report['cacheCount']=len(cache['assets']);report['unrelatedCachePreserved']=True
            cdp=await context.new_cdp_session(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{'cacheDisabled':True});await cdp.send('Network.setBypassServiceWorker',{'bypass':False})
            await context.set_offline(True)
            assert await page.evaluate("fetch('./uncached-probe.txt?private=1').then(()=>false).catch(()=>true)")
            report['ordinaryHttpCacheDisabled']=True
            response=await page.goto(base+'collection.html#carrier',wait_until='domcontentloaded');assert response.from_service_worker and response.status==200
            assert hashlib.sha256(await response.body()).hexdigest()==hashlib.sha256((ROOT/'collection.html').read_bytes()).hexdigest()
            await page.wait_for_function("document.querySelector('#stage').dataset.instrument==='carrier'&&!document.querySelector('#stage').hasAttribute('aria-busy')")
            assert await page.evaluate("typeof Tone.start==='function'");await page.locator('#play').click();await page.wait_for_function("Tone.getContext().rawContext.state==='running'");await page.locator('#play').click();report['offlineToneStartup']=True
            ids=await page.evaluate("import('./instruments/catalog.js').then(m=>m.INSTRUMENTS.filter(i=>i.load).map(i=>i.id))")
            report['offlineRoutes']=['carrier']
            for id in ids:
                if id=='carrier':continue
                print('offline',id,flush=True)
                await page.goto(base+'collection.html#'+id,wait_until='domcontentloaded');response=await page.reload(wait_until='domcontentloaded')
                assert response.from_service_worker and response.status==200
                await page.wait_for_function("id=>document.querySelector('#stage').dataset.instrument===id&&!document.querySelector('#stage').hasAttribute('aria-busy')&&!document.querySelector('.load-error')",arg=id)
                report['offlineRoutes'].append(id)
            assert len(report['offlineRoutes'])==12
            response=await page.goto(base+'index.html#signal',wait_until='domcontentloaded');assert response.from_service_worker and response.status==200
            assert hashlib.sha256(await response.body()).hexdigest()==hashlib.sha256((ROOT/'index.html').read_bytes()).hexdigest()
            await page.wait_for_function("!!document.querySelector('.galaxy-controls')");report['offlineSignal']=True
            verify_hashes();report['finalDiskHashesMatch']=True;report['errors']=errors;assert not errors,errors
            report['passed']=True;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='cachedFiles'},indent=2))
        except Exception as error:
            report.update(passed=False,error=str(error),errors=errors,failedRequests=failed);(OUT/'report.json').write_text(json.dumps(report,indent=2));raise
        finally:await browser.close()

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}/Test-lab/'),180))
    finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()
