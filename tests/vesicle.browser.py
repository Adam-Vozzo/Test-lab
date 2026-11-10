#!/usr/bin/env python3
"""Actual WebGL + audio smoke checks for Vesicle, with a playable CPU fallback."""
import asyncio,functools,json,shutil,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa'/'vesicle'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required'])
  context=await browser.new_context(viewport={'width':1280,'height':900},has_touch=True,service_workers='block');errors=[]
  async def host(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__vesicleHost',{get:()=>({audio,state,controller})});")
  async def module(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'instruments/vesicle.js').read_text().replace('const renderer=new VesicleRenderer','const renderer=window.__vesicleRenderer=new VesicleRenderer'))
  await context.route('**/collection.js',host);await context.route('**/instruments/vesicle.js',module)
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   await page.goto(base+'/collection.html#vesicle');await page.wait_for_function('window.__vesicleHost?.controller&&window.__vesicleRenderer')
   assert await page.evaluate('__vesicleRenderer.ready'),'Three.js scene must render in SwiftShader'
   # Check actual transformed vertices against the asymmetric egg, not the viewport.
   report['containment']=await page.evaluate("""async()=>{
    const r=__vesicleRenderer,{definition}=await import('./instruments/vesicle.js'),v={...definition.defaultAppearance,floatMotion:1.6},render=r.renderer.render;r.renderer.render=()=>{};
    let maximum=0,dustMaximum=0,projectedMaximum=0,vertices=0,meshes=0;
    try{for(let sample=0;sample<232;sample++){
     const t=sample<200?sample*.8:sample;v.eggScale=sample%2?.65:1.15;r.draw(t,v,{yaw:t*.13,pitch:t*.09},1,false);
     // Independent extrema are stricter than the phases available in normal animation.
     if(sample>=200){const n=sample-200,sign=bit=>(n&bit)?1:-1;r.creature.position.y=sign(1)*.064;r.creature.rotation.z=sign(2)*.096;r.creature.scale.setScalar(1.035);r.tendrils.forEach(g=>g.rotation.y=sign(4)*.208);r.fins.forEach(f=>{f.mesh.rotation.x=sign(8)*.072;f.mesh.rotation.y=sign(16)*.352;});}
     r.root.updateMatrixWorld(true);const inverse=r.root.matrixWorld.clone().invert();
     const inspect=(mesh,dust=false)=>{const m=inverse.clone().multiply(mesh.matrixWorld),p=mesh.geometry.attributes.position,vec=r.root.position.clone();if(sample===0&&!dust){meshes++;vertices+=p.count;}for(let i=0;i<p.count;i++){vec.fromBufferAttribute(p,i).applyMatrix4(m);const y=vec.y/1.35,rad=1.02*(1-y*.12),score=(vec.x*vec.x+vec.z*vec.z)/(rad*rad)+y*y;if(dust)dustMaximum=Math.max(dustMaximum,score);else maximum=Math.max(maximum,score);}};
     r.creature.traverse(mesh=>{if(mesh.isMesh)inspect(mesh);});inspect(r.dust,true);
     if(sample%8===0){r.camera.updateMatrixWorld(true);const egg=r.root.children.find(m=>m.material===r.shell),projection=r.camera.projectionMatrix.clone().multiply(r.camera.matrixWorldInverse).multiply(egg.matrixWorld),p=egg.geometry.attributes.position,vec=r.root.position.clone();for(let i=0;i<p.count;i++){vec.fromBufferAttribute(p,i).applyMatrix4(projection);projectedMaximum=Math.max(projectedMaximum,Math.abs(vec.x),Math.abs(vec.y));}}

    }}finally{r.renderer.render=render;}
    return{maximum,dustMaximum,projectedMaximum,vertices,meshes,poses:232};
   }""")
   assert report['containment']['maximum']<.96,report['containment']
   assert report['containment']['dustMaximum']<.96,report['containment']
   assert report['containment']['projectedMaximum']<.98,report['containment']
   await page.wait_for_timeout(1500);await page.screenshot(path=str(OUT/'desktop.png'))
   canvas=page.locator('canvas.instrument-canvas');box=await canvas.bounding_box();await page.mouse.move(box['x']+box['width']*.25,box['y']+box['height']*.46);await page.mouse.down();await page.wait_for_timeout(100)
   await page.wait_for_function('__vesicleHost.audio.snapshot().rms>.0005');rms=await page.evaluate('__vesicleHost.audio.snapshot().rms');assert not await page.evaluate('__vesicleHost.state.playing');await page.mouse.up();report['directTouchRms']=rms
   await page.wait_for_function('__vesicleHost.audio.sources.size===0');await page.locator('#play').click();await page.wait_for_timeout(1200);assert await page.evaluate('__vesicleHost.audio.snapshot().rms')>.0001
   await page.screenshot(path=str(OUT/'playing.png'));await page.locator('#play').click()
   # Resonator organs audition notes while dragging and change real synthesis parameters.
   box=await canvas.bounding_box();before=await page.evaluate('__vesicleHost.state.sound.ratio');x=box['x']+box['width']*.887;y=box['y']+box['height']*.27
   await page.mouse.move(x,y);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.sources.size===1');await page.mouse.move(x,y-36);await page.mouse.up();await page.wait_for_function('__vesicleHost.audio.sources.size===0');assert await page.evaluate('__vesicleHost.state.sound.ratio')>before;report['harmonicOrganAudition']=True
   # Field height changes tone brightness, while horizontal travel changes pitch.
   await page.mouse.move(box['x']+box['width']*.75,box['y']+box['height']*.25);await page.mouse.down();high=await page.evaluate('__vesicleHost.state.sound.cutoff');await page.mouse.move(box['x']+box['width']*.82,box['y']+box['height']*.55);low=await page.evaluate('__vesicleHost.state.sound.cutoff');await page.mouse.up();assert low<high;report['fieldBrightnessGesture']=True
   # Vortex rotation and pulling echo afterimages are distinct physical gestures.
   geo=await page.evaluate('''async()=>{const {splitLayout}=await import('./instrument-layout.js'),b=document.querySelector('canvas.instrument-canvas').getBoundingClientRect(),r=splitLayout(b.width,b.height,__vesicleHost.state.appearance,{pad:8,gap:18,stackPortrait:true}).right;return{...r,x:r.x+b.x,y:r.y+b.y};}''')
   for key,nx,ny,kind in [('currentStrength',.20,.35,'swirl'),('echo',.84,.60,'pull')]:
    before=await page.evaluate(f'__vesicleHost.state.sound.{key}');cx=geo['x']+geo['w']*nx;cy=geo['y']+geo['h']*ny;radius=max(20,min(geo['w']*.1,geo['h']*.085));start=radius*.5 if kind=='swirl' else 4
    await page.mouse.move(cx+start,cy);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.sources.size===1');await page.mouse.move(cx if kind=='swirl' else cx+radius*.8,cy+radius*.5 if kind=='swirl' else cy,steps=6);after=await page.evaluate(f'__vesicleHost.state.sound.{key}');assert after>before,(key,before,after);await page.mouse.up();await page.wait_for_function('__vesicleHost.audio.sources.size===0');report[kind+'Gesture']={'before':before,'after':after}
   # Different biological gestures map to size, resonance and decay, with physical audition sources.
   report['specimenGestures']={}
   for key,xfrac,yfrac,dx,dy in [('bubbleSize',.60,.80,28,-14),('index',.76,.60,36,-12),('release',.82,.90,70,0)]:
    before=await page.evaluate(f'__vesicleHost.state.sound.{key}');x=box['x']+box['width']*xfrac;y=box['y']+box['height']*yfrac
    await page.mouse.move(x,y);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.sources.size===1');await page.mouse.move(x+dx,y+dy,steps=4);await page.wait_for_timeout(50);after=await page.evaluate(f'__vesicleHost.state.sound.{key}');assert after>before,(key,before,after);assert await page.evaluate('__vesicleHost.audio.snapshot().rms')>.0001;await page.screenshot(path=str(OUT/f'specimen-{key}.png'));await page.mouse.up();await page.wait_for_function('__vesicleHost.audio.sources.size===0');report['specimenGestures'][key]={'before':before,'after':after}
   # Real two-finger input expands the bubble; touch-action keeps the page fixed.
   cdp=await context.new_cdp_session(page);x=geo['x']+geo['w']*.19;y=geo['y']+geo['h']*.80;before=await page.evaluate('__vesicleHost.state.sound.bubbleSize')
   def fingers(spread):return [{'x':x-spread,'y':y,'id':41},{'x':x+spread,'y':y,'id':42}]
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':fingers(8)});await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(15)});await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(32)});after=await page.evaluate('__vesicleHost.state.sound.bubbleSize');assert after>before,(before,after);await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await page.wait_for_function('__vesicleHost.audio.sources.size===0');report['bubblePinch']={'before':before,'after':after};await cdp.detach()
   await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(500);await page.screenshot(path=str(OUT/'phone.png'))
   # A touch on the right field produces a separate physical source.
   box=await canvas.bounding_box();await page.mouse.move(box['x']+box['width']*.74,box['y']+box['height']*.34);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.sources.size===1');await page.mouse.move(box['x']+box['width']*.88,box['y']+box['height']*.44);await page.mouse.up();await page.wait_for_function('__vesicleHost.audio.sources.size===0');report['rightField']=True
   await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(400);await page.screenshot(path=str(OUT/'portrait.png'))
   data=await page.evaluate('__vesicleHost.controller.getData()');await page.evaluate('d=>__vesicleHost.controller.setData(d)',data);assert await page.evaluate('__vesicleHost.controller.getData()')==data
   await page.set_viewport_size({'width':1280,'height':900});await page.evaluate('d=>__vesicleHost.controller.setData({...d,pose:{yaw:.78,pitch:.16}})',data);await page.wait_for_timeout(500);await page.screenshot(path=str(OUT/'orbit.png'));await page.evaluate('__vesicleHost.state.appearance.floatMotion=1.6;__vesicleHost.state.appearance.eggScale=1.15');await page.wait_for_timeout(800);await page.screenshot(path=str(OUT/'containment.png'));await page.evaluate('__vesicleHost.state.appearance.floatMotion=1;__vesicleHost.state.appearance.eggScale=1');await page.evaluate('d=>__vesicleHost.controller.setData(d)',data)
   await page.goto(base+'/collection.html#crawl');await page.wait_for_function('document.querySelector("#stage").dataset.instrument==="crawl"');report['switchCleanup']=True
   await page.add_init_script("const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:get.call(this,kind,...args)};")
   await page.goto(base+'/collection.html#vesicle');await page.reload();await page.wait_for_function('window.__vesicleRenderer&&window.__vesicleHost?.controller');assert not await page.evaluate('__vesicleRenderer.ready')
   box=await page.locator('canvas.instrument-canvas').bounding_box();await page.mouse.move(box['x']+box['width']*.25,box['y']+box['height']*.46);await page.mouse.down();await page.wait_for_function('__vesicleHost.audio.snapshot().rms>.0005');await page.mouse.up();report['playableWithoutWebGL']=True
   assert not errors,errors;report['passed']=True
  finally:report['errors']=errors;(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));await context.close();await browser.close()
def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(run(f'http://127.0.0.1:{server.server_port}'))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
