"""Opening a panel must not focus/activate a native picker on the user's behalf.

Native Chromium pointer/touch/keyboard regression. MENU_BASELINE=611f440 runs the
same opening probe against the old focus policy. Chromium's focus behaviour does
not reproduce WebKit's native picker; the explicit select-focus cause is recorded.
"""
import asyncio,functools,json,os,shutil,subprocess,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa'/'menu-focus';BASELINE=os.environ.get('MENU_BASELINE')
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

PROBE=r'''window.__focusLog=[];window.__selectionLog=[];document.addEventListener('focusin',e=>__focusLog.push({tag:e.target.tagName,id:e.target.id,label:e.target.getAttribute('aria-label')}),true);document.addEventListener('change',e=>{if(e.target.tagName==='SELECT')__selectionLog.push({id:e.target.id,value:e.target.value,trusted:e.isTrusted})},true);window.__menuSnapshot=panel=>{const el=document.querySelector(panel),a=document.activeElement;return{hidden:el.hidden,focus:{tag:a.tagName,id:a.id,class:a.className,inside:el.contains(a)},selectFocus:__focusLog.filter(e=>e.tag==='SELECT'),changes:[...__selectionLog],openSelects:[...document.querySelectorAll('select')].filter(e=>{try{return e.matches(':open')}catch{return false}}).map(e=>e.id)}};'''
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'baseline':BASELINE,'nativeWebKit':False,'cases':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  try:
   for route in ['index.html','collection.html#carrier']:
    for modality in ['mouse','touch','keyboard']:
     context=await browser.new_context(viewport={'width':1180,'height':820},has_touch=True,service_workers='block');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
     if BASELINE:
      for file in ['app.js','collection.js','floating-panels.js']:
       source=subprocess.check_output(['git','show',f'{BASELINE}:{file}'],cwd=ROOT,text=True)
       async def old(route,request,source=source):await route.fulfill(content_type='text/javascript',body=source)
       await context.route('**/'+file,old)
     await page.goto(base+'/'+route);await page.wait_for_selector('#play');await page.wait_for_timeout(150);await page.evaluate('() => {'+PROBE+'}')
     case={'route':route,'modality':modality,'panels':[]}
     for panel,toggle in [('#sound-popover','#sound-toggle'),('#appearance','#appearance-toggle'),('#performance-popover','#performance-toggle')]:
      before=await page.locator('select').evaluate_all('(els)=>els.map(e=>[e.id,e.value])');await page.evaluate('__focusLog=[];__selectionLog=[]')
      if modality=='keyboard':await page.locator(toggle).focus();await page.keyboard.press('Enter')
      elif modality=='touch':await page.locator(toggle).tap()
      else:await page.locator(toggle).click()
      await page.wait_for_function('p=>!document.querySelector(p).hidden',arg=panel);await page.wait_for_timeout(120)
      opened=await page.evaluate('__menuSnapshot',panel);opened['panel']=panel
      assert before==await page.locator('select').evaluate_all('(els)=>els.map(e=>[e.id,e.value])'),opened
      if not BASELINE:
       assert opened['focus']['inside'] and opened['focus']['tag']=='BUTTON' and not opened['selectFocus'] and not opened['changes'] and not opened['openSelects'],opened
       # Keyboard entry is useful and safe: Tab reaches a real select only after
       # an explicit navigation action, without changing its value.
       if modality=='keyboard':
        for _ in range(18):
         await page.keyboard.press('Tab')
         if await page.evaluate("document.activeElement.tagName==='SELECT'"):break
        assert await page.evaluate("document.activeElement.tagName==='SELECT'"),opened
        assert before==await page.locator('select').evaluate_all('(els)=>els.map(e=>[e.id,e.value])')
       # A deliberate user selection still opens/changes the native control.
       select=page.locator(panel+' select:visible').first
       if await select.count():
        count=await select.locator('option:enabled').count();original=await select.input_value()
        if modality=='touch':await select.tap()
        elif modality=='keyboard':await page.keyboard.press('Space')
        else:await select.click()
        await page.wait_for_timeout(80)
        opened['explicitSelectFocused']=await select.evaluate('(e)=>e===document.activeElement');assert opened['explicitSelectFocused']
        opened['explicitPickerOpen']=await select.evaluate("e=>{try{return e.matches(':open')}catch{return null}}")
        if count>1:
         # End then Home choose a predictable different option through the
         # browser's own picker, rather than dispatching an application change.
         await page.keyboard.press('End');await page.keyboard.press('Enter');await page.wait_for_timeout(100)
         if await select.input_value()==original:
          await select.click();await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.wait_for_timeout(100)
         opened['explicitValue']=await select.input_value();opened['explicitChanges']=await page.evaluate('__selectionLog');assert opened['explicitValue']!=original,(panel,original,opened)
         assert any(e['trusted'] for e in opened['explicitChanges']),opened
        else:await page.keyboard.press('Escape')
      else:await page.keyboard.press('Escape')
      # Restore through the panel's own close control, not another disclosure.
      if not await page.locator(panel).evaluate('(e)=>e.hidden'):
       await page.locator(panel+' [data-close]').click()
      await page.wait_for_timeout(50);assert await page.locator(toggle).get_attribute('aria-expanded')=='false'
      case['panels'].append(opened)
     case['errors']=errors;assert not errors,errors;report['cases'].append(case);await context.close()
   if not BASELINE:
    # The special secondary-finger path calls button.click() during pointerup.
    # It must also land on a neutral header and suppress the duplicate click.
    report['secondaryTouch']=[]
    for route,width,height in [(route,w,h) for route in ['index.html','collection.html#carrier'] for w,h in [(844,390),(390,844)]]:
     context=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block');page=await context.new_page();await page.goto(base+'/'+route);await page.wait_for_selector('#play');await page.wait_for_timeout(180);await page.evaluate('() => {'+PROBE+'}');cdp=await context.new_cdp_session(page)
     stage=await page.locator('.workspace' if route=='index.html' else '#stage').bounding_box();held={'id':1,'x':stage['x']+stage['width']*.2,'y':stage['y']+stage['height']*.35};button=await page.locator('#appearance-toggle').bounding_box();tap={'id':2,'x':button['x']+button['width']/2,'y':button['y']+button['height']/2}
     await page.evaluate("window.__pointerLog=[];for(const type of ['pointerdown','pointerup'])document.addEventListener(type,e=>__pointerLog.push({type,id:e.pointerId,primary:e.isPrimary}),true)");await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[held]});await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[held,tap]});await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[tap]});await page.wait_for_timeout(300)
     opened=await page.evaluate('__menuSnapshot','#appearance');assert not opened['hidden'] and opened['focus']['inside'] and opened['focus']['tag']=='BUTTON' and not opened['selectFocus'] and not opened['changes'],opened
     events=await page.evaluate('__pointerLog');secondary=next(e for e in events if e['type']=='pointerdown' and not e['primary']);assert any(e['type']=='pointerup' and e['id']==secondary['id'] for e in events),events;assert not any(e['type']=='pointerup' and e['primary'] for e in events),events
     await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});report['secondaryTouch'].append({'route':route,'viewport':[width,height],**opened,'pointerEvents':events})
     # Restoring both saved editors must not focus a control or reopen a picker.
     await page.locator('#sound-toggle').tap()
     await page.add_init_script(PROBE);await page.reload();await page.wait_for_timeout(200)
     restored=[await page.evaluate('__menuSnapshot',p) for p in ['#sound-popover','#appearance']]
     assert all(not p['hidden'] and p['focus']['tag']=='BODY' and not p['selectFocus'] and not p['openSelects'] for p in restored),restored
     report['secondaryTouch'][-1]['restored']=restored;await context.close()
   report['automaticSelectFocusCount']=sum(len(panel['selectFocus']) for case in report['cases'] for panel in case['panels'])
   if BASELINE:assert report['automaticSelectFocusCount']>=5,report
   else:assert report['automaticSelectFocusCount']==0
   report['passed']=True
  finally:
   (OUT/('baseline.json' if BASELINE else 'report.json')).write_text(json.dumps(report,indent=2));await browser.close()
 print(json.dumps({'baseline':BASELINE,'cases':len(report['cases']),'automaticSelectFocusCount':report['automaticSelectFocusCount'],'passed':report['passed']},indent=2))
if __name__=='__main__':
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),150))
 finally:server.shutdown();server.server_close();thread.join()
