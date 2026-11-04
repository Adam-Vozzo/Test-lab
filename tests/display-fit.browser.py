"""Check live viewport filling and controls inside a rounded phone display.
Run: python3 tests/display-fit.browser.py (Python Playwright and Chromium).
"""
import asyncio,functools,json,os,shutil,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa/phone-display'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
  try:
   context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,is_mobile=True,device_scale_factor=1,service_workers='block')
   page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));report=[]
   for path in ['collection.html#carrier','index.html']:
    await page.goto(base+'/'+path);await page.wait_for_selector('#play');await page.wait_for_timeout(400)
    for w,h in [(844,390),(1024,768),(390,844),(320,700),(1180,820)]:
     await page.set_viewport_size({'width':w,'height':h});await page.wait_for_timeout(130)
     value=await page.evaluate("""()=>{
      const main=document.querySelector('main'),footer=document.querySelector('.bottom-bar'),r=main.getBoundingClientRect(),f=footer.getBoundingClientRect();
      const buttons=[...footer.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0&&!e.closest('.tempo-popup')).map(e=>{const b=e.getBoundingClientRect();return{id:e.id,x:b.x,y:b.y,w:b.width,h:b.height}});
      return{height:innerHeight,visualHeight:visualViewport.height,appHeight:getComputedStyle(document.documentElement).getPropertyValue('--app-height'),main:{top:r.top,bottom:r.bottom},footer:{bottom:f.bottom,top:f.top},overflow:document.documentElement.scrollWidth>innerWidth,buttons};
     }""")
     assert not value['overflow'],(path,w,h,value)
     assert abs(value['footer']['bottom']-h)<1,(path,w,h,value)
     if path.startswith('collection') or w>640:assert abs(value['main']['bottom']-h)<1,(path,w,h,value)
     buttons=value['buttons'];radius=44
     for b in buttons:
      for x,y in [(b['x'],b['y']),(b['x']+b['w'],b['y']),(b['x'],b['y']+b['h']),(b['x']+b['w'],b['y']+b['h'])]:
       assert 0<=x<=w+.1 and 0<=y<=h+.1,(path,w,h,b)
       cx=radius if x<radius else w-radius if x>w-radius else x
       cy=radius if y<radius else h-radius if y>h-radius else y
       assert (x-cx)**2+(y-cy)**2<=radius**2,(path,w,h,'rounded corner clips',b)
     for i,a in enumerate(buttons):
      for b in buttons[i+1:]:
       overlap=min(a['x']+a['w'],b['x']+b['w'])-max(a['x'],b['x']);vertical=min(a['y']+a['h'],b['y']+b['h'])-max(a['y'],b['y'])
       assert overlap<=.1 or vertical<=.1,(path,w,h,'overlap',a,b)
     report.append({'route':path,'viewport':[w,h],**value})
     if w in [844,390]:await page.screenshot(path=str(OUT/(path.split('.')[0]+f'-{w}.png')))
    toggle='#collection-toggle';await page.locator(toggle).click();menu='#collection-list' if path.startswith('collection') else '#instrument-menu'
    assert 'BATCH' not in await page.locator(menu).inner_text()
   assert not errors,errors
   (OUT/'report.json').write_text(json.dumps({'checks':report,'errors':errors},indent=2));print('Passed rounded-corner, viewport and menu checks for',len(report),'layouts')
  finally:await browser.close()
def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),90))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
