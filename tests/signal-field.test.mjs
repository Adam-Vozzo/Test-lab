import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=await readFile(new URL('../signal-field.js',import.meta.url),'utf8');
const {SignalField,ElasticTrail,ASCII_GLYPHS,asciiGlyphIndex,sampleCellRadiance,filamentPoint,matrixValue,blurAlpha,flowPacket,directionalPacket,outputExposure}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Independent canvases and a tiny area-sampling raster exercise the actual
// emission→readback→matrix pass rather than mocking its result into existence.
function makeCanvas(raster=false,filter=true){
 const canvas={style:{},width:1,height:1,setAttribute(){},remove(){this.removed=true;}};
 let pixels,scaleX=1,scaleY=1,path=[],stack=[];
 const c={rects:[],arcs:[],images:[],texts:[],filters:[],beziers:[],strokes:0,clears:0,globalAlpha:1,globalCompositeOperation:'source-over',fillStyle:'#fff',
  setTransform(a,b,cc,d){scaleX=a;scaleY=d;},
  clearRect(){pixels=raster?new Float32Array(canvas.width*canvas.height):null;this.rects.length=0;this.arcs.length=0;this.images.length=0;this.beziers.length=0;this.strokes=0;this.clears++;},
  save(){stack.push([this.globalAlpha,this.globalCompositeOperation]);},restore(){[this.globalAlpha,this.globalCompositeOperation]=stack.pop();},
  beginPath(){path=[];},moveTo(){},lineTo(){},bezierCurveTo(...args){this.beziers.push(args);},stroke(){this.strokes++;},
  rect(...a){assert.ok(a.every(Number.isFinite));this.rects.push(a);path.push(a);},
  arc(x,y,r){assert.ok([x,y,r].every(Number.isFinite));this.arcs.push([x,y,r]);path.push([x-r,y-r,r*2,r*2]);},
  fill(){if(raster)for(const a of path)this.fillRect(...a);},
  fillRect(x,y,w,h){
   assert.ok([x,y,w,h].every(Number.isFinite));this.rects.push([x,y,w,h]);if(!raster)return;
   if(!pixels||pixels.length!==canvas.width*canvas.height)pixels=new Float32Array(canvas.width*canvas.height);
   x*=scaleX;y*=scaleY;w*=scaleX;h*=scaleY;
   for(let yy=Math.max(0,Math.floor(y));yy<Math.min(canvas.height,Math.ceil(y+h));yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(canvas.width,Math.ceil(x+w));xx++){
    const coverage=Math.max(0,Math.min(x+w,xx+1)-Math.max(x,xx))*Math.max(0,Math.min(y+h,yy+1)-Math.max(y,yy))*this.globalAlpha;
    const i=yy*canvas.width+xx;pixels[i]=this.globalCompositeOperation==='lighter'?Math.min(1,pixels[i]+coverage):coverage+pixels[i]*(1-coverage);
   }
  },
  getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let i=0;i<canvas.width*canvas.height;i++){data[i*4]=data[i*4+1]=data[i*4+2]=255;data[i*4+3]=(pixels?.[i]||0)*255;}return{data,width:canvas.width,height:canvas.height};},
  putImageData(frame){this.output=frame;},
  measureText(){return{actualBoundingBoxAscent:8,actualBoundingBoxDescent:2};},
  fillText(...args){this.texts.push(args);},
  drawImage(...args){this.images.push({args,filter:this.filter,alpha:this.globalAlpha});},
 };
 if(filter){let current='none';Object.defineProperty(c,'filter',{get:()=>current,set:v=>{current=v;c.filters.push(v);}});}
 canvas.getContext=()=>c;canvas.context=c;return canvas;
}
function fixture({filter=true}={}){
 const canvases=[];
 globalThis.document={hidden:false,createElement:()=>{const canvas=makeCanvas([2,3].includes(canvases.length),filter);canvases.push(canvas);return canvas;}};globalThis.devicePixelRatio=1.5;
 globalThis.matchMedia=()=>({matches:false});globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const visual={particleDensity:.8,reactivity:1,strandCount:38,strandLength:.65,strandChaos:.7,fieldSpread:1,fieldDepth:.7,trailDotCount:80,trailDotSize:5.2,matrixPitch:5.5,matrixGap:.28,matrixShape:'square',trailMotionSpeed:.22,trailMotionAmount:.65,trailFlowSpeed:.28,matrixAudioResponse:.8,matrixExposure:.6,matrixContrast:1,matrixThreshold:.06,matrixValueSize:.35,particleBloom:.4,particleBloomRadius:5,particleBloomThreshold:.45,connections:0};
 const anchors={sky:{x:20,y:40,w:600,h:330},ring:{x:650,y:40,w:600,h:500},filter:{x:380.25,y:250.75},core:{x:920.5,y:330.125}};
 const activity={time:3,level:.36,outputLevel:.1,sequence:{bpm:112},cutoff:2400,resonance:4.5,sound:{detune:8,reverb:.2},voices:[{index:0,midi:50,envelope:.7,velocity:.7,source:'live',started:1}]};
 const field=new SignalField({append(){},getBoundingClientRect:()=>({width:1280,height:760})},{getVisual:()=>visual,getPalette:()=>({secondary:'#79d9ff',fg:'#ffffff',accent:'#ffe579'}),getActivity:()=>activity,getAnchors:()=>anchors});
 const render=()=>{field.render(1/30);return field.lastFilamentStats;};
 return{field,visual,activity,anchors,render,canvases,rects:field.particleCtx.rects,canvas:field.particleCanvas,visibleCanvas:canvases[0]};
}

test('paths retain exact projected endpoints while every visible cell stays on one fixed matrix',()=>{
 const f=fixture();const stats=f.render();assert.equal(stats.strands,38);assert.match(f.visibleCanvas.style.cssText,/z-index:0/);
 for(const path of stats.paths){assert.deepEqual(path.source,{...f.anchors.filter,z:0});assert.deepEqual(path.destination,{...f.anchors.core,z:0});}
 for(const bucket of f.field.buckets)for(let i=0;i<bucket.length;i+=4){assert.ok(Math.abs(bucket[i]/5.5-.5-Math.round(bucket[i]/5.5-.5))<1e-8);assert.ok(Math.abs(bucket[i+1]/5.5-.5-Math.round(bucket[i+1]/5.5-.5))<1e-8);}
 f.anchors.filter={x:-15.7,y:370.1};f.anchors.core={x:780.11,y:600.33};
 for(const path of f.render().paths){assert.deepEqual(path.source,{...f.anchors.filter,z:0});assert.deepEqual(path.destination,{...f.anchors.core,z:0});}
 f.field.dispose();assert.ok(f.canvas.removed);
});

test('offscreen area sampling produces graded cells; path count and emission width independently change occupancy',()=>{
 const f=fixture();f.visual.freeze=true;f.visual.trailDotCount=12;const few=f.render();
 assert.notEqual(f.field.emissionCanvas,f.canvas);assert.equal(f.field.emissionCanvas.width,Math.ceil(1280/5.5));
 const occupied=[...f.field.matrixFrame.luminance].filter(x=>x>0);assert.ok(occupied.some(x=>x<.5));assert.ok(occupied.some(x=>x>.5));
 f.visual.trailDotCount=240;const many=f.render();assert.ok(many.matrix.valueSum>few.matrix.valueSum*2);assert.equal(many.dotsPerPath,240);
 f.visual.trailDotSize=.6;const small=f.render();f.visual.trailDotSize=12;const large=f.render();
 assert.ok(large.cells>small.cells*2);assert.ok(large.matrix.valueSum>small.matrix.valueSum*3);assert.equal(large.pathSamples,small.pathSamples);
});

test('matrix gap/shape/size mapping alter masks, pitch alters sampling, and tone never lights empty cells',()=>{
 const f=fixture();f.visual.freeze=true;f.visual.matrixValueSize=0;f.visual.matrixGap=0;f.render();assert.ok(f.rects.every(r=>r[2]===5.5));
 f.visual.matrixGap=.8;f.render();assert.ok(f.rects.every(r=>Math.abs(r[2]-1.1)<1e-8));
 f.visual.matrixShape='circle';f.render();assert.ok(f.canvas.context.arcs.length>0);assert.equal(f.rects.length,0);
 f.visual.matrixPitch=18;const coarse=f.render();assert.equal(coarse.matrix.cols,Math.ceil(1280/18));
 f.visual.matrixPitch=2;const fine=f.render();assert.ok(fine.matrix.cols>coarse.matrix.cols*8);
 assert.equal(matrixValue(0,{matrixExposure:2,matrixContrast:.4}),0);
 assert.ok(matrixValue(.3,{matrixExposure:1})>matrixValue(.3,{matrixExposure:0}));assert.equal(matrixValue(.2,{matrixThreshold:.5}),0);
});

test('maximum density honors every path sample and remains finite at extreme raster settings',()=>{
 const f=fixture();f.visual.strandCount=72;f.visual.particleDensity=1.2;f.visual.trailDotCount=240;f.visual.matrixPitch=18;f.visual.trailDotSize=12;
 const stats=f.render();assert.equal(stats.strands,96);assert.equal(stats.paths.length,96);assert.equal(stats.pathSamples,23040);assert.equal(stats.dotsPerPath,240);
 assert.ok(stats.paths.every(path=>path.samples===stats.dotsPerPath&&path.visible>0));assert.ok([...f.field.matrixFrame.luminance].every(x=>Number.isFinite(x)&&x>=0&&x<=1));
});

test('selective Gaussian bloom processes only particle highlights, with independent strength/radius/threshold',()=>{
 const f=fixture();f.visual.freeze=true;f.visual.particleBloom=0;let s=f.render();assert.equal(s.bloom.cells,0);assert.equal(f.canvas.context.images.length,0);
 f.visual.particleBloom=1;f.visual.particleBloomThreshold=0;s=f.render();assert.equal(s.bloom.cells,s.cells);assert.equal(f.canvas.context.images.length,1);assert.equal(f.canvas.context.images[0].args[0],f.field.bloomCanvas);
 assert.equal(f.field.bloomCtx.images.at(-1).args[0],f.field.bloomSeed);assert.equal(f.field.bloomCtx.images.at(-1).filter,'blur(2.5px)');
 f.visual.particleBloomRadius=24;f.visual.particleBloom=2;s=f.render();assert.equal(f.field.bloomCtx.images.at(-1).filter,'blur(12px)');assert.equal(f.canvas.context.images.length,2);
 f.visual.particleBloomThreshold=.8;const selected=f.render();assert.ok(selected.bloom.cells>0&&selected.bloom.cells<s.bloom.cells);
 f.visual.particleBloomThreshold=1;s=f.render();assert.equal(s.bloom.cells,0);assert.equal(f.canvas.context.images.length,0);
});

test('Safari fallback creates a finite soft convolution and wider radius spreads isolated highlights',()=>{
 const image=new Uint8ClampedArray(41*41*4);image[(20*41+20)*4+3]=255;
 const minimum=blurAlpha(image,41,41,.5);assert.ok(minimum[20*41+21]>0);assert.ok(minimum[20*41+20]<255);
 const small=blurAlpha(image,41,41,2),large=blurAlpha(image,41,41,6);
 assert.ok(small[20*41+20]>large[20*41+20]);assert.ok(large[20*41+28]>small[20*41+28]);assert.ok([...large].every(x=>Number.isFinite(x)&&x>=0));
 const sum=x=>x.reduce((a,b)=>a+b,0);assert.ok(Math.abs(sum(small)-255)<.001);assert.ok(Math.abs(sum(large)-255)<.01);
 const f=fixture({filter:false});const stats=f.render();assert.equal(stats.bloom.method,'gaussian-box');assert.ok(f.field.bloomCtx.output.data.some((x,i)=>i%4===3&&x>0));
});

test('forward packets retain freeze state, reduced motion holds flow, and silence clears the composite',()=>{
 const f=fixture();const before=f.render().paths.map(p=>p.head);f.activity.time+=.1;const after=f.render().paths.map(p=>p.head);
 after.forEach((v,i)=>{const forward=(v-before[i]+1)%1;assert.ok(forward>0&&forward<.1);});
 f.visual.freeze=true;const frozen=JSON.stringify(f.render());f.activity.time+=20;f.activity.sound.detune=40;f.activity.voices[0].envelope=.1;assert.equal(JSON.stringify(f.render()),frozen);
 f.visual.freeze=false;f.field.reducedMotion.matches=true;const heads=f.render().paths.map(p=>p.head);f.activity.time+=1;assert.deepEqual(f.render().paths.map(p=>p.head),heads);
 f.activity.voices=[];f.activity.level=0;f.activity.outputLevel=0;for(let i=0;i<300;i++)f.render();assert.equal(f.field.lastFilamentStats.cells,0);assert.equal(f.rects.length,0);assert.equal(f.canvas.context.images.length,0);
});

test('path samples remain finite across extreme curve settings and portrait anchors',()=>{
 const f=fixture();f.field.seedStrands(42);const config={width:390,height:1250,length:1.5,chaos:1,spread:1.8,depth:1.5,cutoff:1,resonance:1,detune:1,reverb:.65,delay:.65};
 for(const strand of f.field.strands)for(let j=0;j<=100;j++){const p=filamentPoint({x:200,y:90},{x:170,y:650},strand,j/100,config,80);assert.ok([p.x,p.y,p.z].every(Number.isFinite));}
});


test('motion and flow integrate speed without jumping at edits or audio-clock discontinuities',()=>{
 const f=fixture();f.activity.time=120;f.render();const before=f.field.lastFilamentStats;
 f.visual.trailMotionSpeed=.9;f.visual.trailFlowSpeed=1.3;f.activity.time=9000;f.field.render(0);const edited=f.field.lastFilamentStats;
 assert.deepEqual(edited.motion,before.motion);assert.deepEqual(edited.paths.map(p=>p.midpoint),before.paths.map(p=>p.midpoint));assert.deepEqual(edited.paths.map(p=>p.head),before.paths.map(p=>p.head));
 f.field.render(.05);const after=f.field.lastFilamentStats;assert.ok(after.motion.phase>before.motion.phase);assert.ok(after.motion.flowPhase>before.motion.flowPhase);
 const a=fixture(),b=fixture();for(let i=0;i<60;i++)a.field.render(1/60);for(let i=0;i<30;i++)b.field.render(1/30);
 assert.ok(Math.abs(a.field.motionPhase-b.field.motionPhase)<1e-12);assert.ok(Math.abs(a.field.flowPhase-b.field.flowPhase)<1e-12);
 f.visual.trailMotionSpeed=0;f.visual.trailFlowSpeed=0;const held={...after.motion};f.field.render(.1);assert.equal(f.field.motionPhase,held.phase);assert.equal(f.field.flowPhase,held.flowPhase);
});

test('wrapped packets and broad trajectory have continuous value and position around loop boundaries',()=>{
 const epsilon=1e-6;
 for(const t of [0,.1,.5,.999999,1])assert.ok(Math.abs(flowPacket(t,1-epsilon)-flowPacket(t,1+epsilon))<.0001);
 assert.ok(Math.abs(flowPacket(.5-epsilon,.5)-flowPacket(.5+epsilon,.5))<1e-10);
 const f=fixture();f.render();const pointA=f.field.lastFilamentStats.paths[10].midpoint;f.field.render(.001);const pointB=f.field.lastFilamentStats.paths[10].midpoint;
 assert.ok(Math.hypot(pointB.x-pointA.x,pointB.y-pointA.y)<.05);
});

test('exposure follows raw output RMS independently of voice count, including above legacy meter saturation',()=>{
 const f=fixture();f.visual.trailMotionSpeed=0;f.visual.trailFlowSpeed=0;
 let previous=-Infinity;
 for(const output of [.02,.08,.3,.8]){
  f.activity.outputLevel=output;f.activity.level=1;for(let i=0;i<80;i++)f.field.render(.1);
  const exposure=f.field.lastFilamentStats.loudness.effectiveExposure;assert.ok(exposure>previous);previous=exposure;
 }
 f.activity.outputLevel=.1;for(let i=0;i<100;i++)f.field.render(.1);const one=f.field.lastFilamentStats;
 f.activity.voices=Array.from({length:8},(_,i)=>({...f.activity.voices[0],index:i}));f.field.render(0);const eight=f.field.lastFilamentStats;
 assert.equal(eight.loudness.effectiveExposure,one.loudness.effectiveExposure);assert.equal(eight.matrix.valueSum,one.matrix.valueSum);
 f.visual.matrixAudioResponse=0;f.activity.outputLevel=.01;for(let i=0;i<100;i++)f.field.render(.1);assert.equal(f.field.lastFilamentStats.loudness.effectiveExposure,.6);
 f.activity.outputLevel=0;f.activity.level=1;f.field.render(.1);assert.equal(f.field.lastFilamentStats.cells,0);assert.equal(f.canvas.context.images.length,0);
 assert.equal(outputExposure(NaN),0);assert.equal(outputExposure(0),0);
});

test('loudness attack and release ease toward the meter while freeze preserves its displayed exposure',()=>{
 const f=fixture();f.activity.outputLevel=.02;f.render();f.activity.outputLevel=.2;f.field.render(.03);
 const rising=f.field.outputLevel;assert.ok(rising>.02&&rising<.2);
 f.visual.freeze=true;const frozen=f.render();f.activity.outputLevel=.8;f.activity.time+=100;f.field.render(.1);assert.deepEqual(f.field.lastFilamentStats.loudness,frozen.loudness);
 f.visual.freeze=false;f.activity.outputLevel=.01;f.field.render(.03);assert.ok(f.field.outputLevel>.01&&f.field.outputLevel<rising);
 f.activity.outputLevel=NaN;f.field.render(.1);assert.equal(f.field.lastFilamentStats.cells,0);assert.ok(Number.isFinite(f.field.motionPhase));
});


test('endpoint pulses cross the flow wrap smoothly and freezing mid-ease captures the displayed amount',()=>{
 const f=fixture();f.render();const strand=f.field.strands[0];
 f.field.flowPhase=1-strand.phase/(Math.PI*2)-1e-7;f.field.render(0);const before=f.field.lastFilamentStats.endpointPulse;
 f.field.flowPhase+=2e-7;f.field.render(0);const after=f.field.lastFilamentStats.endpointPulse;
 assert.ok(Math.abs(after.emission-before.emission)<.0001);assert.ok(Math.abs(after.arrival-before.arrival)<.0001);
 f.visual.trailMotionAmount=1.5;f.field.render(.05);const displayed=f.field.motionAmount;assert.ok(displayed>.65&&displayed<1.5);
 f.visual.freeze=true;f.field.render(0);assert.equal(f.field.motionAmount,displayed);
 f.visual.trailMotionAmount=1.3;f.field.render(0);assert.ok(Math.abs(f.field.motionAmount-(displayed-.2))<1e-12);
});


test('exposure easing follows elapsed time through a slow frame while motion remains bounded',()=>{
 const f=fixture();f.activity.outputLevel=.1;f.render();const before=f.field.motionPhase;
 f.activity.outputLevel=.01;f.field.render(.6);
 assert.ok(Math.abs(f.field.outputLevel-(.01+.09*Math.exp(-1)))<1e-12);
 assert.ok(f.field.motionPhase-before<=.1*.22*.8+1e-12);
});


test('source drag leaves the elastic interior behind and a tug travels downstream before settling',()=>{
 const chain=new ElasticTrail();chain.step({x:0,y:90},1/60);
 assert.deepEqual(chain.sample(0),{x:0,y:0});assert.deepEqual(chain.sample(1),{x:0,y:0});
 assert.ok(chain.sample(.1).y<-60);assert.ok(chain.sample(.7).y<-20);
 for(let i=0;i<12;i++)chain.step({x:0,y:0},1/60);
 assert.ok(Math.abs(chain.sample(.1).y)<15);assert.ok(chain.sample(.7).y<-20,'far end still lags after near end follows');
 for(let i=0;i<40;i++)chain.step({x:0,y:0},1/60);
 assert.ok(chain.sample(.7).y>0,'travelling tug rebounds downstream after release');
 for(let i=0;i<600;i++)chain.step({x:0,y:0},1/60);
 assert.equal(chain.stats().maxOffset,0);assert.equal(chain.stats().maxVelocity,0);
});

test('spring substeps preserve slow-drag lag across frame rates and remain bounded at extreme gestures',()=>{
 const drag=frames=>{const chain=new ElasticTrail();for(const dt of frames)chain.step({x:60*dt,y:35*dt},dt);return chain;};
 const a=drag(Array(30).fill(1/30)),b=drag(Array(60).fill(1/60));
 assert.ok(a.stats().maxOffset>10,'normal slow movement creates visible inertia');
 a.stats().profile.forEach((p,i)=>assert.ok(Math.hypot(p.x-b.x[i],p.y-b.y[i])<1e-8));
 const frames=[];let remaining=1;for(let i=0;remaining>1e-8;i++){const dt=Math.min(remaining,[.022,.047,.015,.08][i%4]);frames.push(dt);remaining-=dt;}
 const varied=drag(frames);a.stats().profile.forEach((p,i)=>assert.ok(Math.hypot(p.x-varied.x[i],p.y-varied.y[i])<1));
 const wild=new ElasticTrail();for(let i=0;i<60;i++)wild.step({x:i%2?9000:-9000,y:3000},[1/120,.05,.3,1][i%4],{tension:1,damping:.15,limit:100});
 for(const p of wild.stats().profile){assert.ok([p.x,p.y,p.vx,p.vy].every(Number.isFinite));assert.ok(Math.hypot(p.x,p.y)<=100.001);}
 wild.step({x:NaN,y:Infinity},.05);assert.deepEqual(wild.input,{x:0,y:0});
 assert.deepEqual(wild.sample(0),{x:0,y:0});assert.deepEqual(wild.sample(1),{x:0,y:0});
});

test('world-aware input ignores camera and layout changes but responds to the actual crosshair drag',()=>{
 const f=fixture();let camera={x:0,y:0};f.anchors.filterWorld=[0,0,0];
 f.anchors.projectFilterWorld=w=>({x:380+camera.x+w[0]*90,y:250+camera.y+w[1]*80});
 const update=()=>{f.anchors.filter=f.anchors.projectFilterWorld(f.anchors.filterWorld);f.render();};update();
 camera={x:150,y:-70};update();assert.equal(f.field.elastic.stats().maxOffset,0);
 f.anchors.filterWorld=[.6,.2,0];update();assert.ok(f.field.elastic.stats().maxOffset>30);assert.deepEqual(f.field.elastic.input,{x:54,y:16});
 camera={x:-80,y:90};update();assert.deepEqual(f.field.elastic.input,{x:0,y:0});
 f.anchors.sky.w+=10;update();assert.equal(f.field.elastic.stats().maxOffset,0);
 f.anchors.filterWorld=[1,.2,0];update();assert.ok(f.field.elastic.stats().maxOffset>10);
 f.field.resize();update();assert.equal(f.field.elastic.stats().maxOffset,0);
});

test('physical deformation retains exact anchors, fixed matrix cells and output-RMS exposure',()=>{
 const f=fixture();f.visual.trailMotionSpeed=0;f.visual.trailFlowSpeed=0;f.render();
 const exposure=f.field.lastFilamentStats.loudness.effectiveExposure;f.anchors.filter.y+=80;const dragged=f.render();
 assert.ok(dragged.elastic.maxOffset>40);assert.equal(dragged.loudness.effectiveExposure,exposure);
 for(const path of dragged.paths){assert.deepEqual(path.source,{...f.anchors.filter,z:0});assert.deepEqual(path.destination,{...f.anchors.core,z:0});}
 for(const bucket of f.field.buckets)for(let i=0;i<bucket.length;i+=4){assert.ok(Math.abs(bucket[i]/5.5-.5-Math.round(bucket[i]/5.5-.5))<1e-8);assert.ok(Math.abs(bucket[i+1]/5.5-.5-Math.round(bucket[i+1]/5.5-.5))<1e-8);}
 f.visual.trailDragStrength=0;f.field.render(0);const bypass=f.field.lastFilamentStats.paths[0].midpoint;
 assert.ok(Math.hypot(bypass.x-dragged.paths[0].midpoint.x,bypass.y-dragged.paths[0].midpoint.y)>20);
});

test('freeze holds the spring state without replaying pointer motion; reduced motion clears elastic recoil',()=>{
 const f=fixture();f.render();f.anchors.filter.x+=70;f.render();assert.ok(f.field.elastic.stats().maxOffset>30);
 f.visual.freeze=true;f.render();const frozen=f.field.elastic.stats();f.anchors.filter.x+=80;f.render();assert.deepEqual(f.field.elastic.stats(),frozen);
 f.visual.freeze=false;f.field.render(0);assert.deepEqual(f.field.elastic.input,{x:0,y:0});
 f.field.reducedMotion.matches=true;f.anchors.filter.y+=80;f.render();assert.equal(f.field.elastic.stats().maxOffset,0);
 f.field.reducedMotion.matches=false;f.render();assert.equal(f.field.elastic.stats().maxOffset,0);
});


test('particle flow is exactly proportional to BPM, remains phase-continuous and uses full elapsed time',()=>{
 const f=fixture();f.visual.trailMotionSpeed=0;f.field.render(0);let phase=f.field.flowPhase;
 for(const bpm of [60,120,180]){
  f.activity.sequence.bpm=bpm;const before=f.field.lastFilamentStats.paths.map(p=>p.head);f.field.render(0);
  assert.deepEqual(f.field.lastFilamentStats.paths.map(p=>p.head),before,'BPM edit cannot relocate packets');
  f.field.render(.2);const expected=.2*bpm/60*.28;assert.ok(Math.abs(f.field.flowPhase-phase-expected)<1e-12);
  assert.equal(f.field.lastFilamentStats.flow.cyclesPerSecond,bpm/60*.28);phase=f.field.flowPhase;
 }
 f.activity.sequence.bpm=112;f.field.render(2.5);assert.ok(Math.abs(f.field.flowPhase-phase-2.5*112/60*.28)<1e-12,'long frame must not slow beat motion');
 assert.equal(f.field.motionPhase,0);const held=f.field.flowPhase;f.activity.time=50000;f.field.render(0);assert.equal(f.field.flowPhase,held);
 f.visual.trailFlowSpeed=0;f.field.render(3);assert.equal(f.field.flowPhase,held);
});

test('directional packet has a compact head, fading trailing wake and continuous source/core wrap',()=>{
 const atHead=directionalPacket(.6,.6),behind=directionalPacket(.52,.6),ahead=directionalPacket(.68,.6),farBehind=directionalPacket(.3,.6);
 assert.ok(atHead.light>behind.light*3);assert.ok(behind.light>ahead.light*50);assert.ok(behind.light>farBehind.light*5);
 const epsilon=1e-6;for(const t of [0,.02,.5,.98,1]){
  assert.ok(Math.abs(directionalPacket(t,1-epsilon).light-directionalPacket(t,1+epsilon).light)<.001);
 }
 assert.ok(Math.abs(directionalPacket(.6-epsilon,.6).light-directionalPacket(.6+epsilon,.6).light)<.001);
});

test('all packet heads advance toward the exact core at the same beat rate on live elastic paths',()=>{
 const f=fixture();f.visual.trailMotionSpeed=0;f.field.render(0);const before=f.field.lastFilamentStats;
 f.anchors.filter.y+=60;f.field.render(.03);const after=f.field.lastFilamentStats;const delta=.03*112/60*.28;
 after.paths.forEach((path,i)=>{
  assert.ok(Math.abs(((path.head-before.paths[i].head+1)%1)-delta)<1e-12);
  assert.deepEqual(path.source,{...f.anchors.filter,z:0});assert.deepEqual(path.destination,{...f.anchors.core,z:0});
  assert.ok([path.headPoint.x,path.headPoint.y,path.tailPoint.x,path.tailPoint.y].every(Number.isFinite));
 });
 assert.ok(after.elastic.maxOffset>20);assert.ok(after.matrix.litCells>0);
});


test('ASCII uses its visible character spacing without changing dot spacing and maps luminance to glyphs',()=>{
 const f=fixture();f.visual.freeze=true;f.visual.matrixShape='ascii';f.visual.matrixAsciiPitch=12;f.visual.particleBloom=0;
 const s=f.render();assert.equal(s.matrix.shape,'ascii');assert.equal(s.matrix.pitch,12);assert.equal(s.matrix.cols,Math.ceil(1280/12));assert.equal(f.visual.matrixPitch,5.5);
 assert.equal(s.matrix.glyphRamp,ASCII_GLYPHS);assert.equal(Object.values(s.matrix.glyphCounts).reduce((a,b)=>a+b,0),s.cells);
 assert.ok(Object.values(s.matrix.glyphCounts).filter(x=>x>0).length>=4);assert.equal(f.canvas.context.images.length,s.cells);
 assert.equal(f.rects.length,0);assert.equal(f.canvas.context.arcs.length,0);
 for(const bucket of f.field.buckets)for(let i=0;i<bucket.length;i+=4){assert.equal(bucket[i]%12,6);assert.equal(bucket[i+1]%12,6);assert.equal(bucket[i+2],12);}
 const before=JSON.stringify(s.matrix.glyphCounts);f.visual.matrixValueSize=1;assert.equal(JSON.stringify(f.render().matrix.glyphCounts),before);
 f.visual.matrixShape='square';const square=f.render();assert.equal(square.matrix.pitch,5.5);assert.ok(f.rects.length>0);
 f.visual.matrixShape='ascii';assert.equal(f.render().matrix.pitch,12);
});

test('ASCII atlas is cached, honors inset and palette changes, and particle bloom uses the same glyph masks',()=>{
 const f=fixture();f.visual.freeze=true;f.visual.matrixShape='ascii';f.visual.matrixAsciiPitch=12;f.visual.particleBloomThreshold=0;
 const stats=f.render(),atlas=f.field.asciiAtlas,draws=atlas.canvas.context.texts.length;
 assert.equal(draws,ASCII_GLYPHS.length*2);assert.ok(f.field.bloomSeedCtx.images.length>0);
 assert.ok(f.field.bloomSeedCtx.images.every(image=>image.args[0]===atlas.canvas&&image.args[2]===atlas.tile));
 assert.ok(f.canvas.context.images.some(image=>image.args[0]===atlas.canvas));assert.ok(f.canvas.context.images.some(image=>image.args[0]===f.field.bloomCanvas));
 assert.equal(stats.bloom.cells,stats.cells);f.render();assert.equal(f.field.asciiAtlas,atlas);assert.equal(atlas.canvas.context.texts.length,draws);
 f.visual.matrixGap=.5;f.render();assert.ok(f.field.asciiAtlas.fontSize<atlas.fontSize);
 f.field.getPalette=()=>({secondary:'#ff8800'});const prior=f.field.asciiAtlas.key;f.render();assert.notEqual(f.field.asciiAtlas.key,prior);
 assert.equal(asciiGlyphIndex(0),0);assert.equal(asciiGlyphIndex(1),ASCII_GLYPHS.length-1);assert.ok(asciiGlyphIndex(.7)>asciiGlyphIndex(.2));
});

test('ASCII preserves anchored elastic flow, output exposure and silence at both spacing extremes',()=>{
 const f=fixture();f.visual.matrixShape='ascii';f.render();f.anchors.filter.y+=60;
 for(const pitch of [8,24]){
  f.visual.matrixAsciiPitch=pitch;const stats=f.render();assert.equal(stats.matrix.pitch,pitch);assert.ok(stats.cells>0);assert.ok(stats.elastic.maxOffset>0);
  for(const p of stats.paths){assert.deepEqual(p.source,{...f.anchors.filter,z:0});assert.deepEqual(p.destination,{...f.anchors.core,z:0});}
  assert.equal(stats.flow.bpm,112);assert.ok(Number.isFinite(stats.loudness.effectiveExposure));
 }
 f.activity.outputLevel=0;assert.equal(f.render().cells,0);assert.equal(f.canvas.context.images.length,0);
});


test('ASCII reconstructs narrow packet radiance before perceptual glyph encoding without changing dot samples',()=>{
 const pixels=new Uint8ClampedArray(8*4*4);pixels[(2*8+1)*4+3]=204;
 assert.equal(sampleCellRadiance(pixels,8,0,0,4),.8);assert.equal(sampleCellRadiance(pixels,8,1,0,4),0);
 assert.equal(sampleCellRadiance(pixels,8,1,2,1),.8);
 assert.ok(asciiGlyphIndex(.2)>=4,'mid-dim packet values remain recognizable characters');
 const f=fixture();f.visual.matrixShape='ascii';const stats=f.render();assert.equal(stats.matrix.reconstruction,'peak');assert.equal(stats.matrix.samplePitch,3);
 assert.equal(f.field.emissionCanvas.width,stats.matrix.cols*4);
 f.visual.matrixShape='square';const dots=f.render();assert.equal(f.field.emissionCanvas.width,dots.matrix.cols);assert.equal(dots.matrix.pitch,5.5);
});


test('particle texture isolates matrix and bloom while connection arcs remain on the shared visible canvas',()=>{
 const f=fixture();f.visual.connections=1;f.render();const layer=f.field.getParticleLayer();
 assert.equal(layer.canvas,f.canvas);assert.notEqual(layer.canvas,f.visibleCanvas);assert.equal(layer.width,1280);assert.equal(layer.height,760);
 assert.equal(layer.canvas.width,f.visibleCanvas.width);assert.equal(layer.canvas.height,f.visibleCanvas.height);
 assert.deepEqual(layer.ring,f.anchors.ring);assert.deepEqual(layer.source,f.anchors.filter);assert.deepEqual(layer.core,f.anchors.core);
 assert.equal(f.field.particleCtx.beziers.length,0);assert.ok(f.visibleCanvas.context.beziers.length>0);
 assert.ok(f.field.particleCtx.images.some(image=>image.args[0]===f.field.bloomCanvas));
 assert.deepEqual(f.field.lastParticleComposite.regions,[[0,0,1280,760]]);
});

test('only an acknowledged current texture clips blue from the ring viewport, without black fills or changing arcs',()=>{
 const f=fixture();f.visual.connections=1;f.render();const layer=f.field.getParticleLayer(),arcCount=f.visibleCanvas.context.beziers.length;
 assert.equal(f.field.acceptParticleLayer(layer.version-1),false);assert.equal(f.field.lastParticleComposite.depthAccepted,false);
 assert.equal(layer.onPresented(layer.version),true);assert.equal(f.field.lastParticleComposite.depthAccepted,true);
 const regions=f.field.lastParticleComposite.regions,ring=f.anchors.ring;
 assert.equal(regions.reduce((sum,[x,y,w,h])=>sum+w*h,0),1280*760-ring.w*ring.h);
 for(const [x,y,w,h]of regions)assert.ok(x+w<=ring.x||x>=ring.x+ring.w||y+h<=ring.y||y>=ring.y+ring.h);
 assert.equal(f.visibleCanvas.context.rects.length,0,'mask never paints a rectangle');assert.equal(f.visibleCanvas.context.beziers.length,arcCount);
 assert.ok(f.visibleCanvas.context.images.every(image=>image.args[0]===layer.canvas));
 f.render();assert.ok(f.field.getParticleLayer().version>layer.version);assert.equal(f.field.lastParticleComposite.depthAccepted,false);
 assert.equal(f.field.acceptParticleLayer(layer.version),false);assert.equal(f.field.lastParticleComposite.depthAccepted,false);
 f.field.getParticleLayer().onPresented(f.field.particleVersion);assert.equal(f.field.lastParticleComposite.depthAccepted,true);
 f.field.getParticleLayer().onUnavailable();assert.equal(f.field.lastParticleComposite.depthAccepted,false);assert.deepEqual(f.field.lastParticleComposite.regions,[[0,0,1280,760]]);
});

test('ring-driven updates share one frame and autonomous rendering resumes safely after loss of the consumer',()=>{
 const f=fixture();const layer=f.field.updateParticleLayer(100);layer.onPresented(layer.version);
 const version=layer.version,phase=f.field.flowPhase;f.field.tick(110);assert.equal(f.field.particleVersion,version);assert.equal(f.field.flowPhase,phase);
 const next=f.field.updateParticleLayer(140);assert.ok(next.version>version);next.onPresented(next.version);
 const rendered=next.version;f.field.tick(141);assert.equal(f.field.particleVersion,rendered);assert.equal(f.field.lastParticleComposite.depthAccepted,true);
 f.field.tick(300);assert.ok(f.field.particleVersion>rendered);assert.equal(f.field.lastParticleComposite.depthAccepted,false);
});

test('circle and ASCII texture acknowledgement preserves pixels and phase; silence publishes a cleared new version',()=>{
 const f=fixture();f.visual.freeze=true;
 for(const shape of ['circle','ascii']){
  f.visual.matrixShape=shape;const stats=f.render();const before=JSON.stringify(stats),layer=f.field.getParticleLayer();
  layer.onPresented(layer.version);assert.equal(JSON.stringify(f.field.lastFilamentStats),before);assert.equal(layer.canvas,f.field.particleCanvas);
  assert.equal(f.field.lastParticleComposite.depthAccepted,true);assert.ok(stats.cells>0);
 }
 f.visual.freeze=false;f.activity.outputLevel=0;const old=f.field.particleVersion;f.render();
 const silent=f.field.getParticleLayer();assert.ok(silent.version>old);assert.equal(f.field.lastFilamentStats.cells,0);
 assert.equal(f.field.particleCtx.rects.length,0);assert.equal(f.field.particleCtx.images.length,0);silent.onPresented(silent.version);assert.equal(f.field.lastParticleComposite.depthAccepted,true);
 f.field.resize();assert.equal(f.field.getParticleLayer(),null);assert.equal(f.field.acceptParticleLayer(silent.version),false);
});
