import test from 'node:test';
import assert from 'node:assert/strict';
import {blobPitch,arcSound,synthesisBlob,definition as carrier} from '../instruments/carrier.js';
import {sonarGeometry,starsCrossed,starPitch,lissajousPoint,definition as graticule} from '../instruments/graticule.js';
import {lifeStep,contactGather,lifeModulation,definition as cellular} from '../instruments/cellular.js';
import {phasePoint,definition as phaseVolume} from '../instruments/phase-volume.js';
import {splitLayout} from '../instrument-layout.js';
const TAU=Math.PI*2;

test('blob positions address seven scale degrees and three octaves independently',()=>{
 for(let degree=0;degree<7;degree++)for(let octave=-1;octave<=1;octave++){
  const p=blobPitch(1-(degree+.5)/7,1-(octave+1.5)/3);assert.deepEqual(p,{degree,octave});
 }
 assert.deepEqual(blobPitch(-10,10),{degree:6,octave:-1});
});
test('path arcs have bounded, audible filter and FM mappings',()=>{
 const low=arcSound(0,0),high=arcSound(0,1);assert.equal(low.cutoff,160);assert.equal(high.cutoff,16000);assert.ok(high.resonance>low.resonance);assert.equal(arcSound(1,0).index,0);assert.equal(arcSound(1,1).index,12);assert.deepEqual(arcSound(1,9),arcSound(1,1));
 const keys=new Set();for(let i=0;i<8;i++){const a=synthesisBlob(i,0),b=synthesisBlob(i,1),key=Object.keys(a)[0];keys.add(key);assert.ok(b[key]>a[key]);}assert.equal(keys.size,8);
});
test('Conway Life preserves a block, oscillates a blinker and wraps the field',()=>{
 const board=new Uint8Array(25);for(const i of[6,7,11,12])board[i]=1;const still=lifeStep(board,5,5);assert.deepEqual(still.cells,board);assert.deepEqual(still.births,[]);
 const blink=new Uint8Array(25);for(const i of[11,12,13])blink[i]=1;const next=lifeStep(blink,5,5);assert.deepEqual([...next.cells.keys()].filter(i=>next.cells[i]),[7,12,17]);assert.deepEqual(lifeStep(next.cells,5,5).cells,blink);
 const wrap=new Uint8Array(25);for(const i of[14,10,11])wrap[i]=1;assert.deepEqual([...lifeStep(wrap,5,5).cells.keys()].filter(i=>lifeStep(wrap,5,5).cells[i]),[5,10,15]);
});
test('gathering follows attack duration and release starts from current assembly level',()=>{
 assert.equal(contactGather(.2,.8),.25);assert.equal(contactGather(1,.8),1);assert.equal(contactGather(0,.8,0,2,.6),.6);assert.equal(contactGather(0,.8,1,2,.6),.3);assert.equal(contactGather(0,.8,3,2,.6),0);
});
test('automata modulation is neutral at zero depth and follows actual population/birth activity',()=>{
 const base={cutoff:3000,index:.5};assert.deepEqual(lifeModulation(100,30,576,0,base),base);const sparse=lifeModulation(12,1,576,.8,base),dense=lifeModulation(220,70,576,.8,base);assert.ok(dense.cutoff>sparse.cutoff);assert.ok(dense.index>sparse.index);assert.ok(dense.cutoff<=18000&&dense.index<=12);
});
test('sonar crossing detects stars through the turn boundary, in clock order, without double hits',()=>{
 const stars=[{id:'a',angle:.1},{id:'b',angle:6.2},{id:'muted',angle:6.3,enabled:false}];const hits=starsCrossed(stars,6.1,6.5);assert.deepEqual(hits.map(h=>h.star.id),['b','a']);assert.ok(hits[0].fraction<hits[1].fraction);assert.deepEqual(starsCrossed(stars,6.5,6.6),[]);
 const regular=Array.from({length:16},(_,i)=>({id:i,angle:i/16*TAU})),heard=[];for(let step=0;step<16;step++)heard.push(...starsCrossed(regular,step/16*TAU,(step+1)/16*TAU).map(h=>h.star.id));assert.equal(heard.length,16);assert.equal(new Set(heard).size,16);
});
test('star-map pitch and plotting geometry survive independent pane widths and portrait stacking',()=>{
 for(let degree=0;degree<7;degree++)for(let octave=-1;octave<=1;octave++)assert.deepEqual(starPitch({angle:(degree+.5)/7*TAU,radius:(octave+1.5)/3}),{degree,octave});
 for(const[w,h]of[[1180,740],[844,310],[390,740]])for(const widths of[[50,50],[20,80],[80,20],[35,40]]){const panes=splitLayout(w,h,{leftWidth:widths[0],rightWidth:widths[1],layoutGap:28});for(const r of[panes.left,panes.right]){const g=sonarGeometry(r);assert.ok(g.r>0);assert.ok(g.x-g.r>=r.x&&g.x+g.r<=r.x+r.w);assert.ok(g.y-g.r>=g.top&&g.y+g.r<=g.bottom);}}
});
test('conventional Lissajous has correct in-phase line, quadrature circle and rational closure',()=>{
 for(let i=0;i<100;i++){const a=i/100*TAU,line=lissajousPoint(a,1,0),circle=lissajousPoint(a,1,Math.PI/2);assert.equal(line.x,line.y);assert.ok(Math.abs(circle.x**2+circle.y**2-1)<1e-10);const x=lissajousPoint(a,1.5,0),repeat=lissajousPoint(a+TAU*2,1.5,0);assert.ok(Math.abs(x.x-repeat.x)<1e-10&&Math.abs(x.y-repeat.y)<1e-10);}
 for(const waveform of['sine','triangle','sawtooth','square'])for(let i=0;i<100;i++)for(const value of Object.values(lissajousPoint(i*.17,1.5,.3,waveform)))assert.ok(Number.isFinite(value)&&Math.abs(value)<=1.001);
});
test('retained Phase Volume uses the FM carrier, modulator and normalized analytic derivative',()=>{
 for(const ratio of [.25,1,1.5,3,8])for(const index of [0,.75,5,10])for(let i=0;i<51;i++){const theta=i/50*TAU,p=phasePoint(theta,ratio,index),h=.000001,numerical=(phasePoint(theta+h,ratio,index).carrier-phasePoint(theta-h,ratio,index).carrier)/(2*h)/(1+index);assert.ok(Math.abs(p.derivative-numerical)<1e-6);assert.ok(Math.abs(p.carrier)<=1&&Math.abs(p.mod)<=1&&Math.abs(p.derivative)<=1+1e-12);}
});
test('retained Phase Volume oscillator samples remain bounded at discontinuities',()=>{
 const squares=[],saws=[];for(const waveform of['sine','triangle','sawtooth','square'])for(const ratio of[.25,1.5,8])for(let i=0;i<200;i++){const p=phasePoint(i/199*TAU,ratio,3,waveform);for(const value of Object.values(p))assert.ok(Number.isFinite(value)&&Math.abs(value)<=1.001);if(ratio===1.5&&waveform==='square')squares.push(p.carrier);if(ratio===1.5&&waveform==='sawtooth')saws.push(p.carrier);}assert.ok(squares.filter(x=>Math.abs(x)>.8).length>saws.filter(x=>Math.abs(x)>.8).length*2);
});
test('gesture instruments and retained Phase Volume declare valid controls and defaults',()=>{
 for(const d of[carrier,cellular,graticule,phaseVolume])for(const[controls,defaults]of[[d.appearanceControls,d.defaultAppearance],[d.soundControls,d.defaultSound]]){const keys=new Set();for(const c of controls){assert.ok(!keys.has(c.key),`${d.id} duplicate ${c.key}`);keys.add(c.key);assert.ok(c.section&&c.description.length>15);assert.ok(Object.hasOwn(defaults,c.key),`${d.id} missing ${c.key}`);if(!c.kind||c.kind==='range'){assert.ok(Number.isFinite(defaults[c.key]));assert.ok(defaults[c.key]>=c.min&&defaults[c.key]<=c.max,`${d.id} invalid default ${c.key}`);}}}
});
