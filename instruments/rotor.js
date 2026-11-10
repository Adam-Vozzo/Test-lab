import {splitLayout} from '../instrument-layout.js';
import {TAU,clamp,lerp,rgba,seeded,createSurface,bindPointers,label,line} from './kit.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'rotor',name:'Rotor',commonSoundControls:false,keyboardNotes:true,
 theme:{bg:'#140b09',fg:'#f3e9d4',accent:'#ffc16b',muted:'#9c847b'},
 defaultSound:{waveform:'triangle',attack:.025,decay:.55,sustain:.48,release:1.8,cutoff:5800,resonance:.7,ratio:1.5,index:.45,detune:4,gain:.62,glide:.07,echo:.23,delayTime:.34,feedback:.27,gate:.8,scanRate:'2'},
 defaultAppearance:{amber:'#ffab25',rose:'#ff4eab',cyan:'#4ce9e3',meshFlow:.45,meshSpread:.75,meshBrightness:1,grain:.28,grainSize:1,rotation:.065,ringWidth:.17,ringDetail:.8,guideContrast:1,response:.7,readoutSize:1},
 soundControls:[
  {key:'waveform',label:'Carrier waveform',kind:'select',options:[['sine','Sine'],['triangle','Triangle'],['wavetable','Wavetable']],section:'Voice',description:'Base tone beneath the harmonic modulation.'},
  range('ratio','Harmonic ratio',.5,6,.25,'Voice','Frequency ratio of the sine modulator to the carrier.','×'),
  range('index','Harmonic depth',0,3,.01,'Voice','Amount of frequency modulation; also follows vertical motion on the spectrum disc.'),
  range('cutoff','Low-pass cutoff',180,14000,20,'Voice','Brightness of the output; also follows horizontal motion on the spectrum disc.','Hz'),
  range('resonance','Filter resonance',.1,6,.1,'Voice','Emphasis around the low-pass cutoff.','Q'),
  range('detune','Detune',0,18,.5,'Voice','Small carrier tuning offset.','ct'),
  range('attack','Attack',.005,.7,.005,'Envelope','Time for a touched sector to reach full level.','s'),
  range('release','Release',.1,4,.05,'Envelope','Time for a released note to fade.','s'),
  range('glide','Pitch glide',0,.3,.005,'Envelope','Retuning time while moving between sectors.','s'),
  range('echo','Delay level',0,.4,.01,'Space','Amount of the repeated signal.'),
  range('delayTime','Delay time',.08,.8,.01,'Space','Spacing between echoes.','s'),
  range('feedback','Delay feedback',0,.55,.01,'Space','Amount returned to the delay.'),
  range('gate','Sequence gate',.15,1.8,.05,'Sequence','Note length relative to the interval.','×'),
  {key:'scanRate',label:'Sequence interval',kind:'select',options:[['1','1/16'],['2','1/8'],['4','1/4']],section:'Sequence',description:'Clock interval for the sixteen memory cells.'}
 ],
 appearanceControls:[
  {key:'amber',label:'Amber field',kind:'color',section:'Gradient mesh',description:'Warm colour at the upper side of each disc.'},
  {key:'rose',label:'Rose field',kind:'color',section:'Gradient mesh',description:'Central pink colour of the moving mesh.'},
  {key:'cyan',label:'Cyan field',kind:'color',section:'Gradient mesh',description:'Cool colour at the lower side of each disc.'},
  range('meshFlow','Mesh movement',0,1,.01,'Gradient mesh','Speed of the smooth colour-field movement. Zero freezes the gradient.'),
  range('meshSpread','Colour mixing',.25,1.3,.05,'Gradient mesh','Width and overlap of the moving colour fields.'),
  range('meshBrightness','Mesh exposure',.3,1.2,.05,'Gradient mesh','Brightness of coloured surfaces. Technical outlines remain independent.','×'),
  range('grain','Surface grain',0,.65,.01,'Surface','Fine monochrome grain blended into the coloured discs using soft light.'),
  range('grainSize','Grain size',.5,2,.1,'Surface','Size of grain pixels, without changing the gradient.','×'),
  range('rotation','Sector rotation',0,.25,.005,'Motion','Slow rotation of the pitch sectors and technical guide arcs. Pitch sectors pause during direct contact.','rad/s'),
  range('response','Audio response',0,1,.05,'Motion','Measured output expands the inner spectrum and brightens contact arcs.'),
  range('ringWidth','Pitch ring width',.1,.25,.01,'Drafting','Radial thickness of the twelve coloured pitch sectors. The full pitch disc remains playable.'),
  range('ringDetail','Guide density',.25,1,.05,'Drafting','Number of calibration ticks and concentric guide marks.'),
  range('guideContrast','Guide contrast',.25,1,.05,'Drafting','Brightness of technical outlines and scales.'),
  range('readoutSize','Readout size',.8,1.3,.05,'Drafting','Size of note and parameter readouts.','×')
 ]
};
export function rotorLayout(width,height,appearance={}){
 const layout=splitLayout(width,height,appearance,{pad:8,gap:18,stackPortrait:true,portraitRatio:.9});
 const disc=r=>({x:r.x+r.w*.5,y:r.y+r.h*.48,r:Math.max(24,Math.min(r.w*.385,(r.h-80)*.40)),rect:r});
 return{...layout,pitch:disc(layout.left),spectrum:disc(layout.right)};
}
export function rotorCoordinates(x,y,disc,phase=0){const dx=x-disc.x,dy=y-disc.y,angle=(Math.atan2(dy,dx)+Math.PI/2-phase+TAU*8)%TAU;return{degree:Math.floor(angle/TAU*12),radius:Math.hypot(dx,dy)/disc.r,nx:clamp(dx/(disc.r*1.7)+.5),ny:clamp(dy/(disc.r*1.7)+.5)};}
export function rotorControl(x,y,layout,phase=0){
 const a=rotorCoordinates(x,y,layout.pitch,phase),b=rotorCoordinates(x,y,layout.spectrum);
 if(a.radius<=1){if(a.radius<.5)return{kind:'chord',...a};if(a.radius<.75)return{kind:'gate',...a};return{kind:'pitch',...a};}
 if(a.radius<=1.25)return{kind:'detune',...a};
 if(b.radius<=.62)return{kind:'spectrum',...b};
 if(b.radius<=1.01)return{kind:y<layout.spectrum.y?'ratio':'resonance',...b};
 if(b.radius<=1.25)return{kind:y<layout.spectrum.y?'echo':'release',...b};
 return null;
}
const original=[0,4,7,9,2,7,4,11,0,2,9,7,4,11,7,2];
export function mount(host,api){
 const surface=createSurface(host,{label:'Rotor. Play the outer pitch sectors or inner chord core. Drag the inner left collar for note length and outer collar for detune. The right core controls cutoff and harmonics; its inner collars control ratio and resonance, outer collars control echo and release. Bottom cells edit the sequence and waveform.'}),c=surface.ctx,profile=signalRenderProfile(),gate=createFrameGate(profile.mobile?60:90),mesh=document.createElement('canvas'),noise=document.createElement('canvas');
 mesh.width=mesh.height=320;const mc=mesh.getContext('2d');noise.width=noise.height=192;const nc=noise.getContext('2d'),pixels=nc.createImageData(192,192),random=seeded(7721);for(let i=0;i<pixels.data.length;i+=4){const v=Math.floor(random()*256);pixels.data.set([v,v,v,255],i);}nc.putImageData(pixels,0,0);
 surface.resize=()=>{const r=surface.canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),d=renderPixelRatio(w,h,devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?950000:1700000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)){surface.canvas.width=Math.round(w*d);surface.canvas.height=Math.round(h*d);c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});return surface;};surface.resize();
 const contacts=new Map(),muted=Array(16).fill(false);let phase=0,meshPhase=0,time=0,lastTime=0,lastMesh=-1,meshKey='',destroyed=false,sequenceCursor=0,selected=0,lastNote=api.quantize(0),lastStatus='',playing=false,level=0,layout,lastControl='',lastControlTime=-9;
 const look=()=>({...definition.defaultAppearance,...api.state.appearance});
 const geometry=()=>layout=rotorLayout(surface.width,surface.height,look());
 function memory(){const r=geometry().left;return{x:r.x+8,y:r.y+r.h-31,w:r.w-16,h:27};}
 function play(p,q,first){const l=geometry();let midi=lastNote;
  if(q.kind==='pitch'||q.kind==='chord'){const n=rotorCoordinates(p.x,p.y,l.pitch,phase);if(q.kind==='chord')n.degree=selected;else selected=n.degree;midi=api.quantize(n.degree);q.degree=n.degree;q.radius=n.radius;q.chord=p.y<l.pitch.y-l.pitch.r*.12?[3,4]:p.y>l.pitch.y+l.pitch.r*.12?[2,6]:[2,4];}
  else if(q.kind==='spectrum'){const n=rotorCoordinates(p.x,p.y,l.spectrum);api.setSound({cutoff:180*Math.pow(14000/180,n.nx),index:(1-n.ny)*3});q.nx=n.nx;q.ny=n.ny;}
  else if(q.kind==='feedback'){api.setSound({feedback:clamp(1-p.y/surface.height)*.55});lastControl='FEEDBACK '+api.state.sound.feedback.toFixed(2);lastControlTime=time;}
  else {const d=['gate','detune'].includes(q.kind)?l.pitch:l.spectrum, f=clamp((p.x-d.x)/d.r*.5+.5),values={ratio:Math.round((.5+f*5.5)*4)/4,resonance:.1+f*5.9,echo:f*.4,release:.1+f*3.9,gate:.15+f*1.65,detune:f*18};api.setSound({[q.kind]:values[q.kind]});lastControl=q.kind.toUpperCase()+' '+values[q.kind].toFixed(2);lastControlTime=time;}
  lastNote=midi;q.midi=midi;const fn=first?api.noteOn:api.noteUpdate;
  fn('rotor-'+p.id,midi,{velocity:q.kind==='pitch'?.66+.2*clamp(p.pressure):.48,pan:q.kind==='pitch'?-.2:.2});
  if(q.kind==='chord'){fn('rotor-'+p.id+'-a',api.quantize(q.degree+q.chord[0]),{velocity:.33,pan:-.45});fn('rotor-'+p.id+'-b',api.quantize(q.degree+q.chord[1]),{velocity:.3,pan:.45});}
 }
 function release(id,cancel=false){for(const suffix of['','-a','-b'])(cancel?(api.noteCancel||api.noteOff):api.noteOff)('rotor-'+id+suffix);contacts.delete(id);}
 function commandBox(){const r=geometry().right;return{x:r.x+8,y:r.y+r.h-31,w:r.w-16,h:27};}
 const unbind=bindPointers(surface.canvas,{
  down(p){const l=geometry(),m=memory(),b=commandBox();if(p.x>=m.x&&p.x<=m.x+m.w&&p.y>=m.y-4&&p.y<=m.y+m.h){const step=Math.min(15,Math.floor((p.x-m.x)/m.w*16));muted[step]=!muted[step];api.save();return;}
   if(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y-4&&p.y<=b.y+b.h){const i=Math.min(3,Math.floor((p.x-b.x)/b.w*4));if(i<3)api.setSound({waveform:['sine','triangle','wavetable'][i]});else api.setSound({scanRate:({'1':'2','2':'4','4':'1'})[api.state.sound.scanRate]||'2'});api.audio.pulse('rotor-command',lastNote,{...api.state.sound,velocity:.5},api.audio.snapshot().time,.16);api.save();return;}
   const hit=l.wide&&Math.abs(p.x-surface.width*.5)<17&&p.y>surface.height*.28&&p.y<surface.height*.74?{kind:'feedback'}:rotorControl(p.x,p.y,l,phase);if(!hit)return false;const q={...hit};contacts.set(p.id,q);play(p,q,true);},
  move(p){const q=contacts.get(p.id);if(q)play(p,q,false);},
  up(p){release(p.id);api.save();},cancel(p){release(p.id,true);}
 });
 function gradient(v,t){const key=[v.amber,v.rose,v.cyan,v.meshSpread,v.meshBrightness].join('|');if(key===meshKey&&t-lastMesh<1/30)return;meshKey=key;lastMesh=t;
  const p=meshPhase;mc.globalCompositeOperation='source-over';mc.fillStyle='#231013';mc.fillRect(0,0,320,320);
  const base=mc.createLinearGradient(0,0,210,320);base.addColorStop(0,v.amber);base.addColorStop(.48,v.rose);base.addColorStop(1,v.cyan);mc.globalAlpha=clamp(v.meshBrightness);mc.fillStyle=base;mc.fillRect(0,0,320,320);
  const fields=[[v.amber,90+Math.sin(p)*85,45+Math.cos(p*.8)*42],[v.rose,220+Math.cos(p*.73)*65,150+Math.sin(p*.62)*100],[v.cyan,120+Math.sin(p*.87+2)*95,275+Math.cos(p*.66)*60]];
  for(const [col,x,y]of fields){const g=mc.createRadialGradient(x,y,0,x,y,155*v.meshSpread);g.addColorStop(0,rgba(col,.85));g.addColorStop(1,rgba(col,0));mc.fillStyle=g;mc.fillRect(0,0,320,320);}mc.globalAlpha=1;
 }
 function coloured(d,v,path){c.save();path();c.clip();c.drawImage(mesh,d.x-d.r,d.y-d.r,d.r*2,d.r*2);if(v.grain>0){c.globalCompositeOperation='soft-light';c.globalAlpha=v.grain;c.imageSmoothingEnabled=false;const size=192*v.grainSize;for(let y=d.y-d.r;y<d.y+d.r;y+=size)for(let x=d.x-d.r;x<d.x+d.r;x+=size)c.drawImage(noise,x,y,size,size);c.imageSmoothingEnabled=true;}c.restore();}
 function arc(d,r,start,end,ink,width=1){c.beginPath();c.arc(d.x,d.y,d.r*r,start,end);c.strokeStyle=ink;c.lineWidth=width;c.stroke();}
 function annulus(d,inner,outer,start,end){c.beginPath();c.arc(d.x,d.y,d.r*outer,start,end);c.arc(d.x,d.y,d.r*inner,end,start,true);c.closePath();}
 function drafting(d,v,spin,side){
  const ink=(a)=>rgba('#f1d9c4',Math.min(.95,a*1.35)*v.guideContrast),polar=(r,a)=>[d.x+Math.cos(a)*d.r*r,d.y+Math.sin(a)*d.r*r];
  // Thin concentric calibration tracks, offset breaks and nested circuit routes.
  for(const [r,width,alpha]of[[1.22,.7,.5],[1.19,.6,.3],[1.13,2,.5],[1.07,.6,.5],[1.035,.8,.7],[.73,.5,.55],[.69,.6,.45],[.49,.6,.45]])arc(d,r,0,TAU,ink(alpha),width);
  for(let k=0;k<12;k++){
   const a=k*TAU/12+spin*.16,b=a+TAU/12;
   for(let j=0;j<3;j++){const r=1.105+j*.028;arc(d,r,a+.035+j*.012,b-.055,ink(.28+j*.1),j===1?2:.5);}
   const pts=[polar(.74,a+.03),polar(.78,a+.06),polar(.94,a+.06),polar(.98,a+.10),polar(.98,b-.10),polar(.94,b-.06),polar(.78,b-.06),polar(.74,b-.03)];line(c,pts,ink(.5),.65);
   for(const r of[.78,.94]){const q=polar(r,a+.06);c.fillStyle=ink(.8);c.fillRect(q[0]-1,q[1]-1,2,2);}
   const n=polar(1.155,a+.25);label(c,String(k*30).padStart(3,'0'),n[0],n[1],ink(.7),Math.max(5,d.r*.026),'center');
  }
  const ticks=Math.round(180*v.ringDetail);for(let k=0;k<ticks;k++){const t=k/ticks*TAU,r1=k%5?1.045:1.028,r2=k%5?1.058:1.07;line(c,[polar(r1,t),polar(r2,t)],ink(k%5?.42:.85),.65);}
  for(let k=0;k<6;k++){const a=k*TAU/6+spin*.35;arc(d,.53+k%2*.045,a+.02,a+.45,ink(.65),.6);for(let j=0;j<4;j++){const t=a+.12+j*.035;line(c,[polar(.58,t),polar(.61,t)],ink(.45),.65);}}
  // Offset bypass boards interrupt the perfectly radial casing.
  const a=side==='pitch'?-.74:2.45,p1=polar(.59,a),p2=polar(.76,a),p3=polar(.95,a-.11),p4=polar(1.17,a-.11);
  for(let lane=0;lane<3;lane++){const shift=lane*3;line(c,[p1,[p2[0]+shift,p2[1]],[p3[0]+shift,p3[1]],[p4[0]+shift,p4[1]]],ink(.6-lane*.1),.7);}
  const bx=p4[0]-d.r*.10,by=p4[1]-d.r*.055,bw=d.r*.22,bh=d.r*.11;c.fillStyle='#241713';c.fillRect(bx,by,bw,bh);c.strokeStyle=ink(.75);c.lineWidth=.75;c.strokeRect(bx,by,bw,bh);
  for(let i=0;i<6;i++){c.fillStyle=ink(.3+((i+Math.floor(level*8))%3)*.2);c.fillRect(bx+4+i*(bw-8)/6,by+3,Math.max(1,(bw-12)/9),bh-6);}
  const tx=side==='pitch'?-.55:.57,ty=side==='pitch'?.3:-.29;
  c.strokeStyle=ink(.55);c.strokeRect(d.x+tx*d.r-6,d.y+ty*d.r-9,12,18);line(c,[[d.x+tx*d.r,d.y+ty*d.r-9],[d.x+tx*d.r,d.y+ty*d.r-19],[d.x+(tx+.12)*d.r,d.y+ty*d.r-28]],ink(.55),.65);
  // Four machined cable ports with animated measured-output indication.
  for(let k=0;k<4;k++){const a=k*TAU/4+Math.PI/4,p=polar(1.215,a),q=polar(1.27,a);line(c,[p,q],ink(.6),.7);c.strokeStyle=ink(.65);c.lineWidth=.7;c.strokeRect(q[0]-4,q[1]-4,8,8);c.fillStyle=rgba(k%2?v.cyan:v.rose,.4+level*.6);c.fillRect(q[0]-1,q[1]-1,2,2);}
  // Asymmetric split housings, hatch blocks and bypass loops.
  for(const [a,b,r]of[[.12,.63,1.23],[1.56,2.15,1.23],[3.35,4.1,1.23],[4.76,5.17,1.23]]){arc(d,r,a,b,ink(.8),2.5);arc(d,r+.025,a+.07,b-.04,ink(.55),.6);}
  for(let j=0;j<32;j++){const a=-.6+j*.018;arc(d,1.09,a,a+.009,ink(j%5?.58:.95),j%5?3:6);}
  for(let j=0;j<15;j++){const a=2.1+j*.023;line(c,[polar(.48,a),polar(.5,a+.012)],ink(.72),.75);}
  const offset=side==='pitch'?1:-1;
  for(let j=0;j<3;j++){const xx=d.x+offset*d.r*(.24+j*.025),yy=d.y-d.r*(.66+j*.023);c.beginPath();c.moveTo(xx,yy);c.lineTo(xx+offset*d.r*.16,yy);c.lineTo(xx+offset*d.r*.2,yy+d.r*.07);c.strokeStyle=ink(.65-j*.12);c.lineWidth=.65;c.stroke();}
  const size=Math.max(6,Math.min(8,d.r*.045));
  const labels=side==='pitch'?[[0,-1.30,'DETUNE / DRAG'],[0,.64,'GATE / DRAG']]:[[0,-1.30,'ECHO / DRAG'],[0,-.88,'RATIO'],[0,.88,'RESONANCE'],[0,1.16,'RELEASE']];
  for(const [x,y,text]of labels)label(c,text,d.x+x*d.r,d.y+y*d.r,ink(.9),size,'center');
 }
 function draw(v,snap){const l=geometry(),d=l.pitch,s=l.spectrum,w=surface.width,h=surface.height;c.clearRect(0,0,w,h);c.fillStyle='#140b09';c.fillRect(0,0,w,h);
  const size=Math.max(8,Math.min(11,h*.017))*v.readoutSize;
  // Circuit substrate spans the two mechanisms instead of isolated empty discs.
  c.strokeStyle=rgba('#b79b83',.11);c.lineWidth=.6;for(let j=0;j<7;j++){const yy=h*(.34+j*.046);c.beginPath();c.moveTo(l.left.x+4,yy);c.lineTo(d.x-d.r*1.22,yy);c.moveTo(d.x+d.r*1.22,yy);c.lineTo((d.x+s.x)*.5-12,yy);c.lineTo((d.x+s.x)*.5+12,yy+12);c.lineTo(s.x-s.r*1.22,yy+12);c.moveTo(s.x+s.r*1.22,yy);c.lineTo(w-12,yy);c.stroke();}
  for(let j=0;j<22;j++){const yy=44+j*(h-100)/22;label(c,j%3?'·':'+' ,w*.5,yy,rgba('#d6b09d',.3),7,'center');}

  for(const [r,title,value]of [[l.left,'PITCH / 12',api.noteName(lastNote)],[l.right,'FM / '+api.state.sound.ratio.toFixed(2)+' : 1',Math.round(api.state.sound.cutoff)+' HZ · I '+api.state.sound.index.toFixed(2)]]){label(c,title,r.x+8,r.y+14,'#d4b7a3',size);label(c,value,r.x+r.w-8,r.y+14,'#f3e9d4',size,'right');line(c,[[r.x+8,r.y+27],[r.x+r.w-8,r.y+27]],'#503129',.7);}
  drafting(d,v,phase*.7,'pitch');const voices=snap.voices.filter(q=>q.level>.01);const active=new Set(voices.map(q=>q.midi));
  for(let k=0;k<12;k++){const start=-Math.PI/2+phase+k*TAU/12+.018,end=start+TAU/12-.036,hot=active.has(api.quantize(k));coloured(d,v,()=>annulus(d,1-v.ringWidth,1,start,end));if(hot){annulus(d,1-v.ringWidth,1,start,end);c.fillStyle=rgba('#fff5ce',.18+level*.25);c.fill();arc(d,1.015,start,end,'#fff4dd',2.4);}
   const angle=(start+end)/2,r=d.r*(1-v.ringWidth*.5);label(c,String(k+1).padStart(2,'0'),d.x+Math.cos(angle)*r,d.y+Math.sin(angle)*r,'#29151b',Math.max(7,size*.85),'center');
  }
  for(let k=0;k<3;k++){const start=phase*(k%2?-1:1)+k*2.1;arc(d,.59+k*.035,start,start+1.3,rgba('#e7c4a2',v.guideContrast*.45),.7);}
  // Three linked chord cells: the centre is a playable harmonic stack.
  for(let k=0;k<3;k++){const yy=d.y+(k-1)*Math.max(21,d.r*.16);const ww=Math.max(52,d.r*.38),hh=Math.max(18,d.r*.13);c.strokeStyle=rgba('#f3d6bd',.55);c.lineWidth=.65;c.beginPath();c.roundRect(d.x-ww/2,yy-hh/2,ww,hh,Math.min(6,d.r*.035));c.stroke();for(const side of[-1,1]){c.strokeRect(d.x+side*d.r*.29-2,yy-2,4,4);line(c,[[d.x+side*ww*.55,yy],[d.x+side*d.r*.26,yy]],rgba(v.cyan,.55),.6);}label(c,k===0?'SUS / 145':k===1?'TRI / 135':'7TH / 137',d.x,yy,rgba('#f2d7bc',.8),Math.max(7,d.r*.04),'center');}
  if(d.r>120)label(c,api.noteName(lastNote),d.x,d.y-d.r*.34,'#ffebcd',Math.max(14,d.r*.11)*v.readoutSize,'center');if(d.r>120)label(c,(440*Math.pow(2,(lastNote-69)/12)).toFixed(1)+' HZ',d.x,d.y+d.r*.34,'#c6a893',size*.9,'center');
  // Real waveform occupies the core, while key geometry remains unmodulated.
  const wave=snap.waveform;if(wave?.length){c.beginPath();for(let i=0;i<72;i++){const xx=d.x-d.r*.36+i/71*d.r*.72,yy=d.y+d.r*.43+wave[Math.floor(i/71*(wave.length-1))]*d.r*.2*v.response;if(i)c.lineTo(xx,yy);else c.moveTo(xx,yy);}c.strokeStyle=rgba(v.cyan,.55);c.lineWidth=.8;c.stroke();}
  drafting(s,v,-phase*.8,'spectrum');for(let segment=0;segment<3;segment++){const a=segment*TAU/3-phase*.12;coloured(s,v,()=>annulus(s,.56,.76,a+.06,a+TAU/3-.10));arc(s,.765,a+.06,a+TAU/3-.10,rgba('#ffe3ce',.72),.75);}
  // Translucent colour windows behind the plotted response core.
  c.save();c.globalAlpha=.10;coloured(s,v,()=>{c.beginPath();c.arc(s.x,s.y,s.r*.48,0,TAU);});c.restore();
  // Windowed concentric bands and four chamfered nodes echo the reference HUD.
  c.fillStyle='rgba(20,11,9,.58)';c.beginPath();c.arc(s.x,s.y,s.r*.54,0,TAU);c.fill();
  for(let k=0;k<4;k++){const a=k*TAU/4-phase*.5;arc(s,.61,a+.08,a+1.02,rgba('#fff5de',v.guideContrast*.7),1);const x=s.x+Math.cos(a)*s.r*.88,y=s.y+Math.sin(a)*s.r*.88;c.beginPath();c.arc(x,y,Math.max(3,s.r*.035),0,TAU);c.strokeStyle=rgba('#f3e9d4',v.guideContrast*.6);c.lineWidth=.8;c.stroke();line(c,[[x,y],[s.x+Math.cos(a)*s.r*.78,s.y+Math.sin(a)*s.r*.78]],rgba('#f3e9d4',.35),.6);}
  // Chamfered circuit routes occupy the outer collar. Their gaps and collars
  // remain geometric, rather than a second filled circle competing with colour.
  for(let k=0;k<8;k++){
   const a=k*TAU/8-phase*.22,polar=(r,t)=>[s.x+Math.cos(t)*s.r*r,s.y+Math.sin(t)*s.r*r];
   const points=[polar(.79,a+.09),polar(.82,a+.13),polar(.94,a+.13),polar(.98,a+.17),polar(.98,a+.58),polar(.94,a+.62),polar(.82,a+.62),polar(.79,a+.66)];
   line(c,points,rgba('#e5c4b2',v.guideContrast*.72),.65);
   const tip=polar(.88,a+.375);c.fillStyle=rgba(v.cyan,.45+level*.3);c.fillRect(tip[0]-1.2,tip[1]-1.2,2.4,2.4);
   if(k%2===0){const p=polar(.88,a+.31),q=polar(.88,a+.44);line(c,[p,q],rgba('#e5c4b2',.46),.6);}
  }
  for(let k=0;k<32;k++){const angle=k/32*TAU+phase*.3,power=snap.frequency?.[Math.min(255,k*5)]||0,r1=.78,r2=r1+.035+power*.09*v.response;line(c,[[s.x+Math.cos(angle)*s.r*r1,s.y+Math.sin(angle)*s.r*r1],[s.x+Math.cos(angle)*s.r*r2,s.y+Math.sin(angle)*s.r*r2]],rgba('#f3d4b8',.18+power*.45),.7);}
  const cx=clamp(Math.log(api.state.sound.cutoff/180)/Math.log(14000/180)),cy=1-api.state.sound.index/3,px=s.x+(cx-.5)*s.r*.68,py=s.y+(cy-.5)*s.r*.68;
  line(c,[[s.x-s.r*.42,s.y],[s.x+s.r*.42,s.y]],'#624548',.7);line(c,[[s.x,s.y-s.r*.42],[s.x,s.y+s.r*.42]],'#624548',.7);
  const bloom=1+level*v.response*.12;arc(s,.40*bloom,0,TAU,rgba(v.cyan,.4+level*.5),.8);
  for(let j=-3;j<=3;j++){const xx=s.x+j*s.r*.1;line(c,[[xx,s.y-s.r*.29],[xx,s.y+s.r*.29]],rgba('#d8b9a6',.13),.5);const yy=s.y+j*s.r*.1;line(c,[[s.x-s.r*.29,yy],[s.x+s.r*.29,yy]],rgba('#d8b9a6',.13),.5);}
  c.beginPath();for(let j=0;j<70;j++){const f=j/69,x=s.x-s.r*.36+f*s.r*.72,y=s.y+s.r*.09-Math.sin(f*Math.PI)*s.r*.17*(api.state.sound.index/3)-Math.exp(-Math.pow((f-cx)*9,2))*s.r*.1*api.state.sound.resonance;if(j)c.lineTo(x,y);else c.moveTo(x,y);}c.strokeStyle=rgba(v.cyan,.65);c.lineWidth=.8;c.stroke();
  for(let j=0;j<5;j++){const a=j*TAU/5-phase*.2;arc(s,.46,a,a+.19,rgba('#f1c8ad',.65),1.7);}
  c.strokeStyle='#fff0d9';c.lineWidth=1;c.strokeRect(px-5,py-5,10,10);line(c,[[px-9,py],[px+9,py]],'#fff0d9',.7);line(c,[[px,py-9],[px,py+9]],'#fff0d9',.7);
  const newest=snap.voices.filter(q=>q.id.startsWith('rotor-seq-')&&q.level>.002).sort((a,b)=>b.started-a.started)[0],m=memory(),step=playing&&newest?Number(newest.id.split('-').at(-1)):-1;for(let i=0;i<16;i++){const cell=m.w/16,x=m.x+i*cell;c.fillStyle=rgba(v.rose,muted[i]?.015:step===i?.65:.12);c.fillRect(x+2,m.y+2,cell-4,m.h-4);c.strokeStyle=rgba('#e7c4a2',step===i?.8:.25);c.lineWidth=.65;c.strokeRect(x+2,m.y+2,cell-4,m.h-4);label(c,muted[i]?'·':String(original[i]+1).padStart(2,'0'),x+cell*.5,m.y+m.h*.5,muted[i]?'#725b55':'#d9c3b2',Math.max(6.5,size*.72),'center');}
  const b=commandBox();for(let i=0;i<4;i++){const xx=b.x+i*b.w/4,ww=b.w/4,active=i<3&&api.state.sound.waveform===['sine','triangle','wavetable'][i];c.fillStyle=rgba(i%2?v.cyan:v.rose,active?.22:.04);c.fillRect(xx+3,b.y+2,ww-6,b.h-4);c.strokeStyle=rgba('#edd6c3',active?.8:.32);c.lineWidth=.65;c.strokeRect(xx+3,b.y+2,ww-6,b.h-4);label(c,['∿ SINE','△ TRI','≋ TABLE','CLOCK 1/'+(16/Number(api.state.sound.scanRate))][i],xx+ww*.5,b.y+b.h*.5,'#dcc6b6',Math.max(6.5,size*.75),'center');}
  if(l.wide){const x=w*.5,y=h*.49;for(let j=0;j<3;j++){const yy=y-25+j*8;line(c,[[d.x+d.r*.68,d.y+d.r*.2+j*4],[d.x+d.r*.78,d.y+d.r*.2+j*4],[d.x+d.r*1.12,yy],[x-11,yy]],rgba('#f1d6bc',.3),.7);line(c,[[x+11,yy],[s.x-s.r*1.12,yy],[s.x-s.r*.85,s.y-s.r*.2+j*4],[s.x-s.r*.71,s.y-s.r*.2+j*4]],rgba(v.cyan,.35),.7);} c.fillStyle='#231411';c.fillRect(x-11,y-32,22,64);c.strokeStyle=rgba('#d8c0ac',.65);c.lineWidth=.65;c.strokeRect(x-11,y-32,22,64);for(let j=0;j<9;j++){c.fillStyle=rgba(v.cyan,j/9<api.state.sound.feedback/.55?.8:.16);c.fillRect(x-5,y+23-j*6,10,2);}label(c,'FB',x,y-43,'#d5b39c',6.5,'center');}
  const specs=[['GATE',api.state.sound.gate.toFixed(2)+'×'],['DETUNE',api.state.sound.detune.toFixed(1)+'ct'],['RATIO',api.state.sound.ratio.toFixed(2)],['Q',api.state.sound.resonance.toFixed(1)],['ECHO',Math.round(api.state.sound.echo*100)+'%'],['REL',api.state.sound.release.toFixed(2)+'s']];
  for(let i=0;i<specs.length;i++){const box=i<2?l.left:l.right,n=i<2?2:4,k=i<2?i:i-2,x=box.x+(k+.5)*box.w/n,y=box.y+box.h-48;label(c,specs[i][0]+' '+specs[i][1],x,y,'#d5aa96',Math.max(6.5,size*.75),'center');}
  label(c,time-lastControlTime<2?lastControl:'X CUTOFF · Y FM',s.x,s.y+s.r*.22,rgba('#f0ccbb',.8),Math.max(6,size*.75),'center');
 }
 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;dt=Math.min(.1,lastTime?t-lastTime:dt);time=t;lastTime=t;surface.resize();const v=look(),snap=api.audio.snapshot();if(!api.reducedMotion)meshPhase+=dt*v.meshFlow*.18;if(!api.reducedMotion&&![...contacts.values()].some(q=>['pitch','chord'].includes(q.kind)))phase=(phase+dt*v.rotation)%TAU;const target=clamp(snap.rms*9);level+=(target-level)*(1-Math.exp(-dt*12));const audible=snap.voices.filter(q=>q.level>.005).sort((a,b)=>b.started-a.started)[0];if(audible)lastNote=audible.midi;gradient(v,t);draw(v,snap);const status=api.noteName(lastNote);if(status!==lastStatus){api.setStatus(status);lastStatus=status;}},
  onStep(step,when){const interval=Number(api.state.sound.scanRate)||2;if(step%interval)return;const index=sequenceCursor++%16;if(muted[index])return;const degree=original[index],midi=api.quantize(degree);api.audio.pulse('rotor-seq-'+index,midi,{...api.state.sound,velocity:index%4===0?.78:.6,pan:Math.sin(index*.8)*.35},when,60/api.state.bpm/4*interval*api.state.sound.gate);},
  setPlaying(value){if(value&&!playing)sequenceCursor=0;playing=Boolean(value);},
  getData(){return{phase,meshPhase,muted:[...muted]};},setData(data){if(Number.isFinite(data?.meshPhase))meshPhase=data.meshPhase%TAU;if(Number.isFinite(data?.phase))phase=((data.phase%TAU)+TAU)%TAU;if(Array.isArray(data?.muted))for(let i=0;i<16;i++)muted[i]=Boolean(data.muted[i]);},
  cancel(){for(const id of [...contacts.keys()])release(id,true);},
  destroy(){destroyed=true;unbind();for(const id of [...contacts.keys()])release(id,true);surface.destroy();mesh.width=mesh.height=noise.width=noise.height=0;}
 };
}
