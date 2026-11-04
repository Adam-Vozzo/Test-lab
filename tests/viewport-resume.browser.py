"""Independent viewport-resume and rapid-tap regression.

The stale VisualViewport and installed display-mode are explicit injected
conditions on a real Chromium layout. This is not physical iPhone validation.
Run BASELINE=1 for the archived failing implementation; normal mode asserts fixes.
"""
import asyncio,functools,json,os,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa/newcycle';BASELINE=os.environ.get('BASELINE')=='1';SERVE=OUT/'baseline-source' if BASELINE else ROOT
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
INIT='''(installed)=>{const vv=visualViewport,proto=Object.getPrototypeOf(vv),h=Object.getOwnPropertyDescriptor(proto,'height').get,s=Object.getOwnPropertyDescriptor(proto,'scale').get;window.__nativeViewport=()=>({height:h.call(vv),scale:s.call(vv)});window.__mockHeight=840;Object.defineProperty(vv,'height',{get:()=>__mockHeight,configurable:true});window.__hidden=false;Object.defineProperty(document,'hidden',{get:()=>__hidden});Object.defineProperty(document,'visibilityState',{get:()=>__hidden?'hidden':'visible'});if(installed){Object.defineProperty(navigator,'standalone',{value:true,configurable:true});const match=matchMedia.bind(window);window.matchMedia=q=>{const m=match(q);if(q.includes('display-mode: standalone'))Object.defineProperty(m,'matches',{value:true});return m}}window.__resume=(height)=>{__hidden=true;document.dispatchEvent(new Event('visibilitychange'));__mockHeight=height;__hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));vv.dispatchEvent(new Event('resize'))};window.__setVisual=height=>{__mockHeight=height;vv.dispatchEvent(new Event('resize'))};window.__trusted=[];document.addEventListener('touchend',e=>__trusted.push(e.isTrusted),true)}'''
SNAP='''()=>{const f=document.querySelector('.bottom-bar').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect(),play=document.querySelector('#play').getBoundingClientRect();return{layoutHeight:innerHeight,layoutWidth:innerWidth,rootHeight:document.documentElement.clientHeight,visual:visualViewport.height,nativeVisual:__nativeViewport(),appHeight:getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),main:{top:m.top,bottom:m.bottom,height:m.height},footer:{top:f.top,bottom:f.bottom},play:{x:play.x,y:play.y,w:play.width,h:play.height},rootTouch:getComputedStyle(document.documentElement).touchAction,bodyTouch:getComputedStyle(document.body).touchAction,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}}'''
async def settle(page,ms=180):await page.wait_for_timeout(ms)
async def rapid_tap(cdp,x,y):
 for _ in range(2):
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'id':1,'x':x,'y':y}]});await asyncio.sleep(.035);await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await asyncio.sleep(.08)
async def run(base):
 OUT.mkdir(exist_ok=True,parents=True);report={'mode':'baseline' if BASELINE else 'candidate','simulation':'Injected stale visualViewport height and installed-mode flag on native Chromium; no physical iOS or native keyboard available. Rapid taps are trusted native touch and actual browser scale is recorded.','cases':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
  try:
   for installed in [True,False]:
    for path in ['collection.html#carrier','index.html']:
     context=await browser.new_context(viewport={'width':1280,'height':900},has_touch=True,is_mobile=True,device_scale_factor=1,service_workers='block');await context.add_init_script('('+INIT+')('+str(installed).lower()+')');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(base+'/'+path);await page.wait_for_selector('#play');await settle(page,400);cdp=await context.new_cdp_session(page);case={'route':path,'installed':installed,'cycles':[],'initial':await page.evaluate(SNAP)}
     for height in [780,720,660,600]:
      await page.evaluate('__resume',height);await settle(page);case['cycles'].append(await page.evaluate(SNAP))
     prefix=('baseline' if BASELINE else 'candidate')+('-installed' if installed else '-browser')+('-collection' if path.startswith('collection')else'-signal');await page.screenshot(path=str(OUT/(prefix+'-resume.png')))
     if not BASELINE:
      for value in [case['initial']]+case['cycles']:
       assert abs(value['footer']['bottom']-900)<1 and value['appHeight']=='900px',(prefix,'shrunk',value)
       assert not value['horizontalOverflow'],value
       button=value['play'];radius=44
       for x,y in [(button['x'],button['y']),(button['x']+button['w'],button['y']+button['h'])]:
        cx=radius if x<radius else 1280-radius if x>1280-radius else x
        cy=radius if y<radius else 900-radius if y>900-radius else y
        assert (x-cx)**2+(y-cy)**2<=radius**2,(prefix,'corner clips',button)
      # Real CSS/layout changes must still resize the app, including a smaller window.
      await page.set_viewport_size({'width':900,'height':1280});await page.evaluate('__setVisual(1150)');await page.evaluate("dispatchEvent(new Event('orientationchange'))");await settle(page,300);case['orientation']=await page.evaluate(SNAP);assert abs(case['orientation']['footer']['bottom']-1280)<1
      await page.set_viewport_size({'width':1280,'height':720});await page.evaluate('__setVisual(610)');await settle(page,300);case['smallerLayout']=await page.evaluate(SNAP);assert abs(case['smallerLayout']['footer']['bottom']-720)<1
      # Native page scaling must not move instrument targets.
      await cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':2});await page.evaluate('__setVisual(350)');await settle(page);case['pinch']=await page.evaluate(SNAP);assert case['pinch']['appHeight']=='720px';assert case['pinch']['nativeVisual']['scale']>1.8
      await cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1});await page.evaluate('__setVisual(720)');await settle(page)
      hold=await page.locator('#hold').bounding_box();await rapid_tap(cdp,hold['x']+hold['width']/2,hold['y']+hold['height']/2);await settle(page,300);case['rapidTap']=await page.evaluate(SNAP);case['trustedTouchEnds']=await page.evaluate('__trusted');assert case['rapidTap']['nativeVisual']['scale']==1 and all(case['trustedTouchEnds']);assert case['rapidTap']['rootTouch']=='manipulation' and case['rapidTap']['bodyTouch']=='manipulation'
      collection=path.startswith('collection')
      await page.locator('#appearance-toggle').click();await page.locator('#save-look' if collection else '#appearance [data-action=save]').click();name=page.locator('#look-name' if collection else '#appearance .ae-save-form input');await name.press_sequentially('Resume test',delay=10);case['textFont']=await name.evaluate('(e)=>getComputedStyle(e).fontSize');assert case['textFont']=='16px',case['textFont'];await page.evaluate('__setVisual(440)');await settle(page,250);case['keyboard']=await page.evaluate(SNAP);case['textValue']=await name.input_value();assert case['textValue']=='Resume test';assert case['keyboard']['appHeight']=='440px',case['keyboard'];await name.evaluate('(input)=>input.blur()');await settle(page);case['keyboardBlur']=await page.evaluate(SNAP);assert case['keyboardBlur']['appHeight']=='720px'
      await name.focus();await page.evaluate('__setVisual(420)');await settle(page);case['keyboardRefocus']=await page.evaluate(SNAP);assert case['keyboardRefocus']['appHeight']=='420px';await page.evaluate('__resume(420)');await settle(page,300);case['editorResume']=await page.evaluate(SNAP);assert case['editorResume']['appHeight']=='720px',case['editorResume'];await page.locator('#cancel-save' if collection else '#appearance [data-action=cancel-save]').click();await page.evaluate('__setVisual(720)')
      if not collection:
       await page.locator('#appearance [data-action=tools]').click();seed=page.locator('#appearance .ae-seed input');case['seedFont']=await seed.evaluate('(e)=>getComputedStyle(e).fontSize');assert case['seedFont']=='16px';await seed.fill('137');await seed.press('Tab');case['seedValue']=await seed.input_value();assert case['seedValue']=='137'
      await page.set_viewport_size({'width':844,'height':390});await page.evaluate('__setVisual(390)');await settle(page,250);scroll=page.locator('#appearance .settings-scroll' if collection else '#appearance .ae-scroll');box=await scroll.bounding_box();await scroll.evaluate('(e)=>e.scrollTop=0');before=await scroll.evaluate('(e)=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight})');assert before['total']>before['height'],before
      x=box['x']+4;y=box['y']+box['height']*.8;await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'id':5,'x':x,'y':y}]})
      for i in range(1,12):await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'id':5,'x':x,'y':y-box['height']*.55*i/11}]});await asyncio.sleep(.02)
      await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await settle(page,300);case['panelScroll']={'before':before,'after':await scroll.evaluate('(e)=>e.scrollTop')};assert case['panelScroll']['after']>before['top']+5,case['panelScroll']
     case['errors']=errors;assert not errors,errors;report['cases'].append(case);(OUT/('viewport-baseline.json' if BASELINE else 'viewport-report.json')).write_text(json.dumps(report,indent=2));await context.close()
   report['passed']=True if not BASELINE else None;report['baselineReproducedProgressiveShrink']=all(c['cycles'][-1]['footer']['bottom']<c['initial']['footer']['bottom']-150 for c in report['cases']) if BASELINE else None
  finally:
   (OUT/('viewport-baseline.json' if BASELINE else 'viewport-report.json')).write_text(json.dumps(report,indent=2));await browser.close()
classServer=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(SERVE)));thread=threading.Thread(target=classServer.serve_forever,daemon=True);thread.start()
try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{classServer.server_port}'),150))
finally:classServer.shutdown();classServer.server_close();thread.join()
