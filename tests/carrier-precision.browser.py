"""Carrier mobile precision regression: native WebGL1/mediump alpha readback.
Run with Python Playwright + Chromium. Desktop ANGLE may evaluate mediump at
float32; the arithmetic checks separately model half-precision normal limits.
"""
import asyncio,functools,json,math,os,shutil,struct,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'qa/carrier-precision'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

PROBE=r'''if(window.__carrierFault==='coincident'||window.__carrierFault==='close'){for(let k=1;k<9;k++){u.nodes.value[k].x=u.nodes.value[0].x+k*(window.__carrierFault==='close'?.000001:0);u.nodes.value[k].y=u.nodes.value[0].y;}}
if(window.__carrierFault==='distance')u.nodes.value[0].x=NaN;
if(window.__carrierFault==='alpha')u.shape.value.z=NaN;
liquidRenderer.render(liquidScene,liquidCamera);
if(window.__carrierProbe&&!window.__carrierProbe.frames[side]){
 const gl=liquidRenderer.getContext(),pr=liquidRenderer.getPixelRatio(),w=Math.floor(r.w*pr),h=Math.floor(r.h*pr),pixels=new Uint8Array(w*h*4);gl.readPixels(Math.floor(r.x*pr),Math.floor((surface.height-r.y-r.h)*pr),w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 const nodes=u.nodes.value.map(n=>n.toArray()),extra=.025+u.shape.value.y*4.5;let visible=0,far=0,escaped=0,samples=0,maxAlpha=0;
 const segmentDistance=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],f=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/Math.max(1e-20,dx*dx+dy*dy)));return Math.hypot(x-a[0]-dx*f,y-a[1]-dy*f)};
 for(let yy=0;yy<h;yy+=3)for(let xx=0;xx<w;xx+=3){const x=(xx+.5)/w*u.resolution.value.x,y=(1-(yy+.5)/h)*u.resolution.value.y,a=pixels[(yy*w+xx)*4+3];samples++;maxAlpha=Math.max(maxAlpha,a);if(a>2)visible++;
  let near=nodes.some(n=>Math.hypot(x-n[0],y-n[1])<=n[2]+extra);for(let k=0;k<8&&!near;k++)near=segmentDistance(x,y,nodes[k],nodes[k+1])<=Math.max(nodes[k][2],nodes[k+1][2])+extra;
  near ||= Math.hypot(x-nodes[0][0],y-nodes[0][1])<=nodes[0][2]*1.8+extra;
  if(!near){far++;if(a>2)escaped++;}
 }
 window.__carrierProbe.frames[side]={width:r.w,height:r.h,samples,visible,far,escaped,maxAlpha,phases:[u.finish.value.x,u.finish.value.w],precision:gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.MEDIUM_FLOAT).precision};
}'''

def arithmetic():
 f32=lambda value:struct.unpack('f',struct.pack('f',value))[0]
 def half(value):
  try:return struct.unpack('e',struct.pack('e',value))[0]
  except OverflowError:return math.copysign(math.inf,value)
 def flush(value):
  n=half(value);return 0 if abs(n)<2**-14 else n
 old_sin=math.sin(f32(math.pi))
 assert old_sin<0 and not math.isfinite(half(1e5))
 assert flush(.00001)==0 and flush(.0001)>0
 return {'oldEndpointSin':old_sin,'oldHalfSentinelOverflows':True,'oldCoincidentDenominatorFlushesToZero':True,'normalDenominator':flush(.0001)}

async def run(base):
 OUT.mkdir(parents=True,exist_ok=True);report={'arithmetic':arithmetic(),'cases':{}}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
  try:
   context=await browser.new_context(viewport={'width':844,'height':390},has_touch=True,device_scale_factor=3,service_workers='block')
   await context.add_init_script("const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:get.call(this,type,...args)}")
   async def host(route):await route.fulfill(content_type='text/javascript',body=(ROOT/'collection.js').read_text()+"\nObject.defineProperty(window,'__precisionHost',{get:()=>({state,currentId})});")
   async def carrier(route):
    source=(ROOT/'instruments/carrier.js').read_text().replace('frame(t,dt){now=t;','frame(t,dt){if(Number.isFinite(window.__carrierTime))t=window.__carrierTime;now=t;').replace('liquidRenderer.render(liquidScene,liquidCamera);',PROBE)
    await route.fulfill(content_type='text/javascript',body=source)
   await context.route('**/collection.js',host);await context.route('**/instruments/carrier.js',carrier)
   page=await context.new_page();errors=[];shader_errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:shader_errors.append(m.text) if 'Shader Error' in m.text else None)
   await page.goto(base+'/collection.html#carrier');await page.wait_for_function('window.__precisionHost?.currentId==="carrier"')
   cases=[('compact',844,390,{},None,0),('portrait',390,844,{},None,0),('max-material',844,390,{'ribbonWidth':1.8,'ribbonOpacity':1,'blobOverlap':.8,'ribbonMotion':1.5},None,0),('coincident',844,390,{},'coincident',0),('near-coincident',844,390,{},'close',0),('day-one',844,390,{},None,86400),('day-thirty',844,390,{},None,2592000),('invalid-distance',844,390,{},'distance',0),('invalid-alpha',844,390,{},'alpha',0)]
   for name,w,h,patch,fault,time in cases:
    await page.set_viewport_size({'width':w,'height':h});await page.wait_for_timeout(150)
    await page.evaluate('(data)=>{Object.assign(__precisionHost.state.appearance,data.patch);window.__carrierFault=data.fault;window.__carrierTime=data.time;window.__carrierProbe={frames:{}}}',dict(patch=patch,fault=fault,time=time))
    await page.wait_for_function('Object.keys(__carrierProbe.frames).length===2',timeout=20000)
    # A live viewport event can precede its CSS-height animation frame. Read a
    # second complete frame so probes never mistake an old-size surface for fit.
    await page.evaluate('__carrierProbe={frames:{}}');await page.wait_for_function('Object.keys(__carrierProbe.frames).length===2',timeout=20000)
    frames=await page.evaluate('__carrierProbe.frames');report['cases'][name]=frames
    for value in frames.values():
     if fault in ['distance','alpha']:assert value['visible']==0,(name,value)
     else:
      assert 0<value['visible']<value['samples']*.65,(name,value)
      assert value['far']>value['samples']*.15 and value['escaped']==0,(name,value)
      assert all(math.isfinite(x) and 0<=x<math.tau for x in value['phases']),(name,value)
    if name in ['compact','portrait','max-material','day-thirty']:await page.screenshot(path=str(OUT/(name+'.png')))
   # Real multi-touch, not a programmatic slider change, at devicePixelRatio=3.
   await page.evaluate('window.__carrierFault=null;window.__carrierTime=0')
   before=await page.evaluate('({...__precisionHost.state.sound})')
   pane=await page.evaluate("async()=>{const {splitLayout}=await import('/instrument-layout.js'),r=document.querySelector('#stage').getBoundingClientRect(),p=splitLayout(r.width,r.height,__precisionHost.state.appearance).right;return {...p,x:p.x+r.x,y:p.y+r.y}}")
   x=pane['x']+pane['w']*.38;y=pane['y']+pane['h']*.49;cdp=await context.new_cdp_session(page)
   def touch(id,x,y):return {'id':id,'x':x,'y':y,'radiusX':5,'radiusY':5,'force':.7}
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[touch(1,x,y)]})
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[touch(1,x,y),touch(2,x+55,y+35)]})
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[touch(1,x-25,y-15),touch(2,x+110,y+65)]})
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
   after=await page.evaluate('({...__precisionHost.state.sound})')
   assert after['index']>before['index'] and after['ratio']==before['ratio'] and after['cutoff']==before['cutoff'],(before,after)
   await page.evaluate('__carrierProbe={frames:{}}');await page.wait_for_function('Object.keys(__carrierProbe.frames).length===2',timeout=20000)
   frames=await page.evaluate('__carrierProbe.frames');assert all(v['escaped']==0 and v['visible']>0 for v in frames.values()),frames
   report['touch']={'indexBefore':before['index'],'indexAfter':after['index'],'unrelatedParametersPreserved':True,'frames':frames}
   await page.screenshot(path=str(OUT/'interactive.png'))
   assert not errors,errors;assert not shader_errors,shader_errors
   report.update(errors=errors,shaderErrors=shader_errors);(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
  finally:await browser.close()

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:asyncio.run(run(f'http://127.0.0.1:{server.server_port}'))
 finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
