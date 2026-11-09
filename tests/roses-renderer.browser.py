"""Roses pixels, density controls, reduced motion and renderer budgets.

Chromium emulation measures bounded work; it does not establish native iOS FPS.
Run: python3 tests/roses-renderer.browser.py
"""
import asyncio
import functools
import json
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa/roses-review'
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path=='/__roses_renderer_test__':
            body=b'<!doctype html><meta charset="utf-8"><title>Roses renderer test</title>'
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else: super().do_GET()

SCRIPT=r'''async()=>{
 const {RosesRenderer}=await import('./instruments/roses-renderer.js');
 const {definition}=await import('./instruments/roses.js');
 const canvas=document.createElement('canvas');canvas.width=720;canvas.height=900;
 const c=canvas.getContext('2d',{willReadFrequently:true}),r=new RosesRenderer(canvas,{mobile:true});r.resize(720,900,1);
 const v={...definition.defaultAppearance},camera={yaw:-.2,pitch:-.08,zoom:1},energy=new Float32Array(240);
 const paint=(appearance=v,time=0,reduced=true,reveal=1)=>{r.draw(appearance,time,camera,energy,reveal,reduced);return c.getImageData(0,0,canvas.width,canvas.height).data;};
 const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])n++;return n/(a.length/4);};
 const stats=p=>{let sum=0,lit=0;for(let i=0;i<p.length;i+=4){sum+=(p[i]+p[i+1]+p[i+2])*p[i+3]/255;if(Math.max(p[i],p[i+1],p[i+2])*p[i+3]/255>25)lit++;}return{sum,lit};};
 const stillA=paint(),stillB=paint(v,43,true),reducedDifference=diff(stillA,stillB);
 const animatedA=paint(v,0,false),animatedB=paint(v,2.7,false),ambientDifference=diff(animatedA,animatedB);
 const start=stats(paint(v,0,true,.01)),grown=stats(paint(v,0,true,1));
 const small=paint({...v,glyphSize:.65}),smallGrid=[r.field.width,r.field.height],large=paint({...v,glyphSize:1.6}),largeGrid=[r.field.width,r.field.height];
 const glyphDifference=diff(small,large);
 paint({...v,glyphDensity:.45});const sparseGrid=[r.field.width,r.field.height];paint({...v,glyphDensity:1.6});const denseGrid=[r.field.width,r.field.height];
 const noGlow=stats(paint({...v,glow:0})),fullGlow=stats(paint({...v,glow:1}));
 paint(v);const faces=r.faces,firstFace=r.faces[0],atlas=r.atlas,field=r.field,depth=r.depth,buffer=r.rasterPixels;
 for(let i=0;i<30;i++)paint(v,i/60,false);
 const reused=faces===r.faces&&firstFace===r.faces[0]&&atlas===r.atlas&&field===r.field&&depth===r.depth&&buffer===r.rasterPixels;
 const geometry={faces:r.faces.length,petals:r.petals.length,lines:r.lines.length};
 const costs=[];for(let i=0;i<36;i++){const t=performance.now();r.draw(v,i/60,camera,energy,1,false);if(i>=6)costs.push(performance.now()-t);}costs.sort((a,b)=>a-b);
 const frameCost={median:costs[Math.floor(costs.length*.5)],p95:costs[Math.floor(costs.length*.95)],max:costs.at(-1)};
 const sizes=[];for(const [w,h] of [[816,327],[1152,740],[374,764],[2048,1440]]){canvas.width=w;canvas.height=h;r.resize(w,h,1);paint({...v,glyphSize:.65,glyphDensity:1.6});sizes.push({size:[w,h],grid:[r.field.width,r.field.height],cells:r.field.width*r.field.height});}
 canvas.width=720;canvas.height=900;r.resize(720,900,1);const restored=paint(v,0,true),resizeDifference=diff(stillA,restored);
 // Shed glyphs retain world-space positions through camera changes, then expire.
 paint(v,0,false);const petal=r.hitPoints[0].petal;r.emitPetal(petal,0,1);const emitted=r.fragments.length;
 const finiteFragments=r.fragments.every(f=>[f.x,f.y,f.z,f.vx,f.vy,f.vz].every(Number.isFinite));
 c.clearRect(0,0,720,900);r.drawFragments(.5,v,false,r.step);const fragmentA=c.getImageData(0,0,720,900).data;
 r.draw(v,.5,{...camera,yaw:camera.yaw+.7},energy,1,false);c.clearRect(0,0,720,900);r.drawFragments(.5,v,false,r.step);const fragmentB=c.getImageData(0,0,720,900).data;
 const fragmentOrbitDifference=diff(fragmentA,fragmentB);r.draw(v,3,camera,energy,1,false);const expired=r.fragments.length===0;
 r.emitPetal(petal,3,1);r.draw(v,3.1,camera,energy,1,true);const reducedFragments=r.fragments.length===0;
 const framing=[];
 const extreme={...v,sceneScale:1.15,bloomScale:1.3,bouquetSpread:1.3,leafSize:1.5,glyphSize:1.6,glow:1,glowRadius:1,response:1.5,idleMotion:1.5};energy.fill(1);
 for(const [w,h] of [[816,327],[1152,740]]){
  canvas.width=w;canvas.height=h;r.resize(w,h,1);const scales=[],angles=[[0,0],[.7,.4],[1.5,1.1],[2.4,2],[3.5,3.4],[5.8,4.8],[-2.3,-1.8]];
  for(const [yaw,pitch]of angles){r.draw(extreme,11.7,{yaw,pitch,zoom:1.08},energy,1,false);scales.push(r.scale);
   const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
   const add=p=>{bounds.left=Math.min(bounds.left,p.x);bounds.top=Math.min(bounds.top,p.y);bounds.right=Math.max(bounds.right,p.x);bounds.bottom=Math.max(bounds.bottom,p.y);};
   for(const face of r.faces)for(const p of face.screen)add(p);
   for(const line of r.lines)for(const vertex of[line.a,line.b]){const p=r.world(vertex,extreme,11.7*extreme.motionRate,energy,{});add(r.transform(p.x,p.y,p.z));}
   framing.push({size:[w,h],angle:[yaw,pitch],bounds,scale:r.scale,contained:bounds.left>=4&&bounds.top>=4&&bounds.right<=w-4&&bounds.bottom<=h-4});
  }
  if(Math.max(...scales)-Math.min(...scales)>1e-9)throw new Error('Orbit changed render scale');
 }
 const backing=[r.atlas,r.field,r.ids,r.glowField];r.dispose();r.dispose();
 const disposed=backing.every(x=>x.width===0&&x.height===0)&&r.faces.length===0&&r.lines.length===0&&r.hitPoints.length===0;
 return{reducedDifference,ambientDifference,start,grown,glyphDifference,smallGrid,largeGrid,sparseGrid,denseGrid,noGlow,fullGlow,reused,geometry,frameCost,sizes,resizeDifference,disposed,emitted,finiteFragments,fragmentOrbitDifference,expired,reducedFragments,framing};
}'''

async def run(base):
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-webgl','--disable-dev-shm-usage'])
        try:
            context=await browser.new_context(service_workers='block')
            page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            await page.goto(base+'/__roses_renderer_test__')
            result=await page.evaluate(SCRIPT)
            assert result['reducedDifference']==0,result
            assert result['ambientDifference']>.001,result
            assert result['grown']['lit']>result['start']['lit']*4,result
            assert result['smallGrid'][0]>result['largeGrid'][0] and result['glyphDifference']>.005,result
            assert result['denseGrid'][0]>result['sparseGrid'][0],result
            assert result['fullGlow']['sum']>result['noGlow']['sum']*1.02,result
            assert result['reused'] and result['disposed'] and result['resizeDifference']==0,result
            assert all(s['cells']<=81000 for s in result['sizes']),result
            assert result['geometry']['faces']<10000,result
            assert 0<result['emitted']<=100 and result['finiteFragments'] and result['fragmentOrbitDifference']>0,result
            assert result['expired'] and result['reducedFragments'],result
            assert all(frame['contained'] for frame in result['framing']),result['framing']
            await context.close()
            devices=[]
            for name,width,height,ua,platform in [
                ('desktop-identifying iPad',1180,820,'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15','MacIntel'),
                ('phone',844,390,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1','iPhone')]:
                ctx=await browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2,has_touch=True,user_agent=ua,service_workers='block')
                await ctx.add_init_script("Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});Object.defineProperty(navigator,'platform',{get:()=>"+json.dumps(platform)+"});")
                async def expose(route):
                    source=(ROOT/'instruments/roses.js').read_text().replace('renderer=new RosesRenderer','renderer=window.__rosesRenderer=new RosesRenderer')
                    await route.fulfill(content_type='text/javascript',body=source)
                await ctx.route('**/instruments/roses.js',expose)
                page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                await page.goto(base+'/collection.html#roses')
                await page.wait_for_function("window.__rosesRenderer?.frameId>3")
                await page.wait_for_timeout(3200)
                device=await page.evaluate("""()=>{const r=__rosesRenderer;return{mobile:r.mobile,backing:[r.canvas.width,r.canvas.height],css:[r.width,r.height],grid:[r.field.width,r.field.height],glyphHits:r.hitPoints.length};}""")
                assert device['mobile'] and device['backing'][0]*device['backing'][1]<=1003000,device
                assert device['grid'][0]*device['grid'][1]<=81000 and device['glyphHits']>0,device
                devices.append({'device':name,**device});await ctx.close()
            assert not errors,errors
            result.update(devices=devices,errors=errors,passed=True,nativeIOS=False)
            (OUT/'renderer-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
        finally: await browser.close()

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try: asyncio.run(asyncio.wait_for(run(f'http://127.0.0.1:{server.server_port}'),150))
    finally: server.shutdown();server.server_close();thread.join()
