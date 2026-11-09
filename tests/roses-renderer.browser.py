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
 const v={...definition.defaultAppearance},camera={yaw:-.2,pitch:-.08,zoom:1},userCamera={yaw:.19433333333333686,pitch:6.55833333333334,zoom:.7590744829719918,offsetX:0,offsetY:0},energy=new Float32Array(256);
 const freshCanvas=document.createElement('canvas');freshCanvas.width=1033;freshCanvas.height=688;const fresh=new RosesRenderer(freshCanvas,{mobile:true});fresh.resize(1033,688,1);const initialGrid=[fresh.field.width,fresh.field.height];fresh.draw(v,0,userCamera,energy,1,true);const initialAllocation={initialGrid,grid:[fresh.field.width,fresh.field.height],depth:fresh.depth.length,wideGlow:fresh.wideGlowSource.length,hits:fresh.hitPoints.length};fresh.dispose();
 const paint=(appearance=v,time=0,reduced=true,reveal=1)=>{r.draw(appearance,time,camera,energy,reveal,reduced);return c.getImageData(0,0,canvas.width,canvas.height).data;};
 const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])n++;return n/(a.length/4);};
 const stats=p=>{let sum=0,lit=0;for(let i=0;i<p.length;i+=4){sum+=(p[i]+p[i+1]+p[i+2])*p[i+3]/255;if(Math.max(p[i],p[i+1],p[i+2])*p[i+3]/255>25)lit++;}return{sum,lit};};
 // Read the exact source/destination rectangles used for rendered glyphs,
 // then inspect their opaque cores at CSS-pixel scale. A mode flag or a pixel
 // difference alone cannot catch ASCII that has collapsed into tiny dots.
 const glyphCapture=(appearance,view=camera)=>{
  const drawImage=c.drawImage.bind(c),marks=[];
  c.drawImage=(image,...args)=>{if(image===r.atlas&&args.length===8)marks.push({source:args.slice(0,4),destination:args.slice(4),smoothing:c.imageSmoothingEnabled});return drawImage(image,...args);};
  let pixels;try{r.draw(appearance,0,view,energy,1,true);pixels=c.getImageData(0,0,canvas.width,canvas.height).data;}finally{c.drawImage=drawImage;}
  const tile=document.createElement('canvas');tile.width=tile.height=64;const tc=tile.getContext('2d',{willReadFrequently:true}),seen=new Set(),glyphs=[];
  for(const mark of marks){const [sx,sy,sw,sh]=mark.source,[dx,dy,dw,dh]=mark.destination,key=sx+':'+sy;if(seen.has(key))continue;seen.add(key);
   tc.clearRect(0,0,64,64);tc.imageSmoothingEnabled=mark.smoothing;tc.drawImage(r.atlas,sx,sy,sw,sh,32-dw/2,32-dh/2,dw,dh);
   const p=tc.getImageData(0,0,64,64).data,alphaMax=Math.max(...Array.from({length:4096},(_,i)=>p[i*4+3]));
   if(!alphaMax)continue;let left=64,top=64,right=-1,bottom=-1,ink=0;const mask=new Uint8Array(4096);
   for(let i=0;i<4096;i++)if(p[i*4+3]>=alphaMax*.55){const x=i%64,y=Math.floor(i/64);mask[i]=1;ink++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   const rows=[];for(let y=top;y<=bottom;y++)rows.push(Array.from(mask.slice(y*64+left,y*64+right+1)).join(''));
   glyphs.push({character:Math.round(sx/sw),height:bottom-top+1,width:right-left+1,rowPatterns:new Set(rows).size,ink,occupancy:ink/((right-left+1)*(bottom-top+1)),stamp:[dw,dh]});
  }
  return{marks:marks.length,glyphs,pixels,grid:[r.field.width,r.field.height]};
 };
 canvas.width=816;canvas.height=327;r.resize(816,327,1);
 const asciiCapture=glyphCapture({...v,glyphStyle:'ascii'},userCamera),dotsCapture=glyphCapture({...v,glyphStyle:'dots'},userCamera);
 const readable=glyphs=>[...new Set(glyphs.filter(g=>g.height>=6&&g.width>=3&&g.rowPatterns>=3&&g.occupancy<.86).map(g=>g.character))];
 const structured=glyphs=>[...new Set(glyphs.filter(g=>g.height>=3&&g.width>=2&&g.rowPatterns>=2&&g.occupancy<.9).map(g=>g.character))];
 const asciiDotDifference=diff(asciiCapture.pixels,dotsCapture.pixels),densityCaptures=[];
 for(const density of [.45,1.6]){const capture=glyphCapture({...v,glyphStyle:'ascii',glyphDensity:density},userCamera);densityCaptures.push({density,marks:capture.marks,grid:capture.grid,readableCharacters:readable(capture.glyphs),structuredCharacters:structured(capture.glyphs)});}
 const glyphReadability={size:[816,327],asciiMarks:asciiCapture.marks,dotMarks:dotsCapture.marks,asciiDotDifference,readableCharacters:readable(asciiCapture.glyphs),asciiGlyphs:asciiCapture.glyphs,dotGlyphs:dotsCapture.glyphs,densityCaptures};
 // Saturation and fold gain must change the rendered material, and bloom
 // must add coloured light outside the surfaces without washing the viewport.
 const lightingFrame=appearance=>{r.draw(appearance,0,userCamera,energy,1,true);const pixels=c.getImageData(0,0,816,327).data;let chroma=0,count=0;for(let i=0;i<r.surfaceIds.length;i++){const id=(r.surfaceIds[i]&255)-1;if(r.interactionsById.get(id)?.kind!=='petal'||r.surfaceIds[i]&256)continue;const o=i*4,hi=Math.max(...r.rasterPixels.slice(o,o+3)),lo=Math.min(...r.rasterPixels.slice(o,o+3));if(hi>40){chroma+=(hi-lo)/hi;count++;}}return{pixels,chroma:chroma/Math.max(1,count),light:stats(pixels)};};
 const neutral=lightingFrame({...v,glow:0,saturation:.6}),saturated=lightingFrame({...v,glow:0,saturation:1.8}),lowHighlight=lightingFrame({...v,glow:0,highlightGain:.5}),highHighlight=lightingFrame({...v,glow:0,highlightGain:1.8}),noHalo=lightingFrame({...v,glow:0}),halo=lightingFrame(v);
 let haloPixels=0,haloChroma=0,brightPixels=0;
 for(let y=0;y<327;y++)for(let x=0;x<816;x++){const i=(y*816+x)*4,p=halo.pixels,hi=Math.max(p[i],p[i+1],p[i+2]),lo=Math.min(p[i],p[i+1],p[i+2]),lit=hi*p[i+3]/255,old=Math.max(noHalo.pixels[i],noHalo.pixels[i+1],noHalo.pixels[i+2])*noHalo.pixels[i+3]/255;if(lit>200)brightPixels++;const index=Math.floor(y/r.step)*r.cols+Math.floor(x/r.stepX);if(!r.surfaceIds[index]&&lit>4&&lit>old+1){haloPixels++;haloChroma+=(hi-lo)/Math.max(1,hi);}}
 const lighting={neutralChroma:neutral.chroma,saturatedChroma:saturated.chroma,saturationPixelDifference:diff(neutral.pixels,saturated.pixels),highlightPixelDifference:diff(lowHighlight.pixels,highHighlight.pixels),lowHighlight:lowHighlight.light,highHighlight:highHighlight.light,haloPixels,haloChroma:haloChroma/Math.max(1,haloPixels),brightViewportFraction:brightPixels/(816*327)};
 canvas.width=720;canvas.height=900;r.resize(720,900,1);
 const stillA=paint(),stillB=paint(v,43,true),reducedDifference=diff(stillA,stillB);
 const animatedA=paint(v,0,false),animatedB=paint(v,2.7,false),ambientDifference=diff(animatedA,animatedB);
 const start=stats(paint(v,0,true,.01)),grown=stats(paint(v,0,true,1));
 const small=paint({...v,glyphSize:.65}),smallGrid=[r.field.width,r.field.height],large=paint({...v,glyphSize:1.6}),largeGrid=[r.field.width,r.field.height];
 const glyphDifference=diff(small,large);
 paint({...v,glyphDensity:.45});const sparseGrid=[r.field.width,r.field.height];paint({...v,glyphDensity:1.6});const denseGrid=[r.field.width,r.field.height];
 const noGlow=stats(paint({...v,glow:0})),fullGlow=stats(paint({...v,glow:1}));
 paint(v);const faces=r.faces,firstFace=r.faces[0],atlas=r.atlas,field=r.field,depth=r.depth,buffer=r.rasterPixels,glowSource=r.glowSource,wideGlowSource=r.wideGlowSource;
 for(let i=0;i<30;i++)paint(v,i/60,false);
 const reused=faces===r.faces&&firstFace===r.faces[0]&&atlas===r.atlas&&field===r.field&&depth===r.depth&&buffer===r.rasterPixels&&glowSource===r.glowSource&&wideGlowSource===r.wideGlowSource;
 const geometry={faces:r.faces.length,petals:r.petals.length,lines:r.lines.length};
 const costs=[];for(let i=0;i<36;i++){const t=performance.now();r.draw(v,i/60,camera,energy,1,false);if(i>=6)costs.push(performance.now()-t);}costs.sort((a,b)=>a-b);
 const frameCost={median:costs[Math.floor(costs.length*.5)],p95:costs[Math.floor(costs.length*.95)],max:costs.at(-1)};
 const sizes=[];for(const [w,h] of [[816,327],[1152,740],[374,764],[2048,1440]]){canvas.width=w;canvas.height=h;r.resize(w,h,1);paint({...v,glyphSize:.65,glyphDensity:1.6});sizes.push({size:[w,h],grid:[r.field.width,r.field.height],cells:r.field.width*r.field.height});}
 canvas.width=720;canvas.height=900;r.resize(720,900,1);const restored=paint(v,0,true),resizeDifference=diff(stillA,restored);
 // Shed glyphs retain world-space positions through camera changes, then expire.
 paint(v,0,false);const petal=r.hitPoints[0].petal;r.emitPetal(petal,0,1);const emitted=r.fragments.length;
 const finiteFragments=r.fragments.every(f=>[f.x,f.y,f.z,f.vx,f.vy,f.vz].every(Number.isFinite));
 c.clearRect(0,0,720,900);r.drawFragments(.5,v,false,r.glyphPitch);const fragmentA=c.getImageData(0,0,720,900).data;
 r.draw(v,.5,{...camera,yaw:camera.yaw+.7},energy,1,false);c.clearRect(0,0,720,900);r.drawFragments(.5,v,false,r.glyphPitch);const fragmentB=c.getImageData(0,0,720,900).data;
 const fragmentOrbitDifference=diff(fragmentA,fragmentB);r.draw(v,3,camera,energy,1,false);const expired=r.fragments.length===0;
 r.emitPetal(petal,3,1);r.draw(v,3.1,camera,energy,1,true);const reducedFragments=r.fragments.length===0;
 // Overview framing and close inspection have different contracts: cropping
 // at high zoom is intentional, while the cursor anchor and hit IDs stay exact.
 r.draw(v,0,{...camera,offsetX:0,offsetY:0},energy,1,true);
 const anchorId=r.hitPoints.find(p=>p.petal>=0&&p.petal<220).petal,ratio=3.2/camera.zoom;
 const closeChecks=[];
 for(const [w,h] of [[720,900],[816,327],[1152,740]]){
  canvas.width=w;canvas.height=h;r.resize(w,h,1);
  r.draw(v,0,{...camera,offsetX:0,offsetY:0},energy,1,true);
  const p={...r.projectPetal(anchorId)},origin={x:w*.5,y:h*.53},overviewScale=r.scale;
  const view={...camera,zoom:3.2,offsetX:(p.x+(origin.x-p.x)*ratio)/w-.5,offsetY:(p.y+(origin.y-p.y)*ratio)/h-.53};
  r.draw(v,0,view,energy,1,true);
  const current=r.projectPetal(anchorId),anchorError=Math.hypot(current.x-p.x,current.y-p.y),visible=r.hitPoints.filter(p=>p.x>=0&&p.y>=0&&p.x<w&&p.y<h);
  const projected=r.faces.flatMap(f=>f.screen),cropped=projected.some(p=>p.x<0||p.y<0||p.x>w||p.y>h),finite=projected.every(p=>[p.x,p.y,p.z].every(Number.isFinite));
  const selected=visible.filter((p,i)=>i%Math.max(1,Math.floor(visible.length/60))===0);
  const correctIds=selected.every(p=>r.pick(p.x,p.y)?.id===p.petal),occupiedFinite=[...r.surfaceIds].every((id,i)=>!id||Number.isFinite(r.depth[i]));
  closeChecks.push({size:[w,h],anchorError,scaleRatio:r.scale/overviewScale,cropped,finite,correctIds,occupiedFinite,visibleTargets:visible.length,cells:r.field.width*r.field.height,faces:r.faces.length});
 }
 // Every visible leaf/stem has the same depth-correct identity as its light.
 canvas.width=720;canvas.height=900;r.resize(720,900,1);energy.fill(0);
 const foliageChecks=[];
 for(const kind of ['leaf','stem']){
  r.draw({...v,idleMotion:0},0,camera,energy,1,true);
  const visibleTarget=r.interactionPoints.find(p=>p.kind===kind&&r.pick(p.x,p.y)?.id===p.id);
  if(!visibleTarget)throw new Error('Missing playable '+kind);const target={...visibleTarget};
  const before=r.rasterPixels.slice(),ids=r.surfaceIds.slice();energy[target.id]=1;
  r.draw({...v,idleMotion:0},0,camera,energy,1,true);
  let own=0,brightened=0,delta=0,unrelatedChanges=0,unrelatedIdChanges=0,sharedCoverageChanges=0;const overlapChanges=[];
  for(let i=0;i<ids.length;i++){const id=(ids[i]&255)-1,o=i*4,d=[0,1,2,3].reduce((sum,k)=>sum+Math.abs(r.rasterPixels[o+k]-before[o+k]),0);
   if(id===target.id){own++;if(d>0){brightened++;delta+=d;}}else{
    if(r.surfaceIds[i]!==ids[i])unrelatedIdChanges++;
    if(d){const rgbStable=[0,1,2].every(k=>r.rasterPixels[o+k]===before[o+k]),sharedStem=kind==='stem'&&r.interactionsById.get(id)?.kind==='stem'&&r.surfaceIds[i]===ids[i];
     if(rgbStable&&sharedStem)sharedCoverageChanges++;else unrelatedChanges++;
     if(overlapChanges.length<8)overlapChanges.push({index:i,idBefore:id,idAfter:(r.surfaceIds[i]&255)-1,before:[...before.slice(o,o+4)],after:[...r.rasterPixels.slice(o,o+4)]});
    }
   }
  }
  const views=[];
  for(const view of [{...camera,yaw:.7,pitch:.4,zoom:1},{...camera,zoom:3.2}]){
   r.draw(v,0,view,energy,1,true);const samples=r.interactionPoints.filter(p=>p.kind===kind&&p.x>=0&&p.y>=0&&p.x<720&&p.y<900);
   views.push({zoom:view.zoom,targets:samples.length,correctIds:samples.every(p=>r.pick(p.x,p.y)?.id===p.id)});
  }
  foliageChecks.push({kind,id:target.id,own,brightened,delta,unrelatedChanges,unrelatedIdChanges,sharedCoverageChanges,overlapChanges,views});energy.fill(0);
 }
 // A real spring strike now drives geometry. Check the angular peak rather
 // than treating static note energy as a proxy for physical deformation.
 const strikeFraming=[],strikeAppearance={...v,response:1.5,idleMotion:0};
 for(const [w,h]of [[816,327],[1152,740]])for(const [yaw,pitch]of [[-.2,-.08],[.7,.4]])for(let flower=0;flower<5;flower++){
  canvas.width=w;canvas.height=h;r.resize(w,h,1);const view={yaw,pitch,zoom:1.04,offsetX:0,offsetY:0};
  r.draw(strikeAppearance,0,view,energy,1,true);const id=r.petals.find(p=>p.flower===flower).id;r.strike(id,0,1.2);
  let peak=0,contained=true;const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
  const add=p=>{bounds.left=Math.min(bounds.left,p.x);bounds.top=Math.min(bounds.top,p.y);bounds.right=Math.max(bounds.right,p.x);bounds.bottom=Math.max(bounds.bottom,p.y);};
  for(let frame=1;frame<=20;frame++){
   r.draw(strikeAppearance,frame/60,view,energy,1,false);peak=Math.max(peak,r.flowerMotion[flower].angle);
   for(const face of r.faces)for(const p of face.screen)add(p);
   for(const line of r.lines)for(const vertex of[line.a,line.b]){const p=r.world(vertex,strikeAppearance,frame/60,energy,{});add(r.transform(p.x,p.y,p.z));}
  }
  contained=bounds.left>=4&&bounds.top>=4&&bounds.right<=w-4&&bounds.bottom<=h-4;
  strikeFraming.push({size:[w,h],angle:[yaw,pitch],flower,peak,bounds,contained});
 }
 const foliageMotion=[];
 canvas.width=816;canvas.height=327;r.resize(816,327,1);const live={...v,idleMotion:0,response:.85},view={...camera,zoom:1.04};
 for(const id of [231,244]){
  r.draw(live,0,view,energy,1,true);
  const point={...r.projectInteraction(id)},other={...r.projectInteraction(220)},head={...r.projectPetal(0)};
  r.strike(id,0,.75);let ownMove=0,otherMove=0,headMove=0,peak=0;
  for(let frame=1;frame<=24;frame++){
   r.draw(live,frame/60,view,energy,1,false);
   const p=r.projectInteraction(id),q=r.projectInteraction(220),h=r.projectPetal(0);
   ownMove=Math.max(ownMove,Math.hypot(p.x-point.x,p.y-point.y));otherMove=Math.max(otherMove,Math.hypot(q.x-other.x,q.y-other.y));headMove=Math.max(headMove,Math.hypot(h.x-head.x,h.y-head.y));peak=Math.max(peak,p.bend);
  }
  foliageMotion.push({id,response:live.response,ownMove,otherMove,headMove,peak});
 }
 // A side view must retain actual volume, rather than exposing a nearly
 // planar flower sheet. Use geometry extents and projected head profiles,
 // alongside frontmost visible IDs from several complete camera turns.
 const depthProfiles=[],angleProfiles=[];
 canvas.width=1152;canvas.height=740;r.resize(1152,740,1);energy.fill(0);r.draw({...v,idleMotion:0},0,camera,energy,1,true);
 for(let flower=0;flower<5;flower++){
  const points=r.faces.filter(face=>face.flower===flower&&face.petal>=0).flatMap(face=>face.vertices),span=axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]));
  depthProfiles.push({flower,diameter:Math.max(span('x'),span('y')),depth:span('z'),depthRatio:span('z')/Math.max(span('x'),span('y')),areas:[]});
 }
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
  r.draw({...v,idleMotion:0},0,{...camera,yaw,pitch:.12,zoom:1},energy,1,true);
  const visible=[...new Set(r.hitPoints.map(p=>p.flower))];
  for(const profile of depthProfiles){const points=r.faces.filter(face=>face.flower===profile.flower&&face.petal>=0).flatMap(face=>face.screen),width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));profile.areas.push(width*height);}
  angleProfiles.push({yaw,visibleFlowers:visible,correctIds:r.hitPoints.filter((_,i)=>i%11===0).every(p=>r.pick(p.x,p.y)?.id===p.petal)});
 }
 for(const profile of depthProfiles)profile.minimumAreaRatio=Math.min(...profile.areas)/Math.max(...profile.areas);
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
 const disposed=backing.every(x=>x.width===0&&x.height===0)&&r.faces.length===0&&r.lines.length===0&&r.hitPoints.length===0&&r.interactions.length===0&&r.interactionPoints.length===0&&r.projectedInteractions.length===0&&r.interactionsById.size===0&&r.leafPoses.size===0&&r.flowerPoses.length===0&&r.petalPoses.length===0&&r.stemMotion.angle===0&&r.stemMotion.velocity===0&&r.glowSource===null&&r.wideGlowSource===null;
 return{reducedDifference,ambientDifference,start,grown,glyphDifference,smallGrid,largeGrid,sparseGrid,denseGrid,noGlow,fullGlow,reused,geometry,frameCost,sizes,resizeDifference,disposed,emitted,finiteFragments,fragmentOrbitDifference,expired,reducedFragments,framing,closeChecks,foliageChecks,strikeFraming,foliageMotion,glyphReadability,lighting,depthProfiles,angleProfiles,initialAllocation};
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
            result['passed']=False
            (OUT/'renderer-report.json').write_text(json.dumps(result,indent=2))
            allocation=result['initialAllocation']
            assert allocation['initialGrid']==[300,150] and allocation['grid']==[300,150],allocation
            assert allocation['depth']==45000 and allocation['wideGlow']==180000 and allocation['hits']>0,allocation
            readability=result['glyphReadability']
            assert readability['asciiMarks']>40 and readability['asciiDotDifference']>.005,readability
            assert len(readability['readableCharacters'])>=4,readability
            assert all(len(item['structuredCharacters'])>=3 for item in readability['densityCaptures']),readability
            assert readability['densityCaptures'][1]['marks']>readability['densityCaptures'][0]['marks']*1.15,readability
            assert all(g['rowPatterns']<=2 or g['height']<6 for g in readability['dotGlyphs']),readability
            lighting=result['lighting']
            assert lighting['saturatedChroma']>lighting['neutralChroma']+.04 and lighting['saturationPixelDifference']>.0001,lighting
            assert lighting['highlightPixelDifference']>.0001 and lighting['highHighlight']['sum']>lighting['lowHighlight']['sum']*1.01,lighting
            assert lighting['haloPixels']>40 and lighting['haloChroma']>.2 and lighting['brightViewportFraction']<.2,lighting
            assert all(profile['depthRatio']>.35 and profile['minimumAreaRatio']>.2 for profile in result['depthProfiles']),result['depthProfiles']
            assert all(len(profile['visibleFlowers'])>=3 and profile['correctIds'] for profile in result['angleProfiles']),result['angleProfiles']
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
            assert all(frame['contained'] and frame['peak']>.2 for frame in result['strikeFraming']),result['strikeFraming']
            leaf_motion,stem_motion=result['foliageMotion']
            assert leaf_motion['ownMove']>.5 and leaf_motion['otherMove']<.001 and leaf_motion['headMove']<.001,leaf_motion
            assert stem_motion['ownMove']>.1 and stem_motion['headMove']>.5 and stem_motion['peak']>.02,stem_motion
            for foliage in result['foliageChecks']:
                assert foliage['id']>=220 and foliage['own']>0 and foliage['brightened']>0 and foliage['delta']>0,foliage
                assert foliage['unrelatedChanges']==0 and foliage['unrelatedIdChanges']==0,foliage
                for coverage in foliage['overlapChanges']:
                    assert foliage['kind']=='stem' and coverage['idBefore']==coverage['idAfter'] and coverage['before'][:3]==coverage['after'][:3],coverage
                assert all(view['targets']>0 and view['correctIds'] for view in foliage['views']),foliage
            for close in result['closeChecks']:
                assert close['anchorError']<1e-6 and abs(close['scaleRatio']-3.2)<1e-8,close
                assert close['cropped'] and close['finite'] and close['correctIds'] and close['occupiedFinite'],close
                assert close['visibleTargets']>10 and close['cells']<=81000 and close['faces']<10000,close
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
                await page.wait_for_function('__rosesRenderer.reveal>=1')
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
