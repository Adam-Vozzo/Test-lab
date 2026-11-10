import {TAU,clamp,lerp,rgba} from './kit.js';
import {crawlControlRadius,crawlControlValue,crawlAnatomy,solveCrawlIK} from './crawl-world.js';

const DEFAULTS={panelColour:'#080b0c',traceColour:'#56626b',legendColour:'#bfc7bf',creatureLime:'#d6ef62',creatureViolet:'#7273c8',creatureCoral:'#ef8466',creatureTeal:'#6dd7b4',circuitContrast:.5,panelContrast:.65,controlContrast:.95,legendContrast:.9,legWeight:1,jointSize:1,creatureGlow:.3,limbEnvelope:.2,scopeGain:.8,chroma:.7,colourFlow:.35,anatomyDetail:.75,audioMotion:.65,audioColour:.8,audioGlow:.45};
const NAMES={pitch:'PITCH',range:'RANGE',shape:'SHAPE',tone:'CUTOFF',resonance:'RESO',decay:'DECAY',detune:'DETUNE',gate:'GATE',division:'DIV',accent:'ACCENT'};
const num=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const stroke=(c,points,colour,width=.7)=>{if(!points.length)return;c.beginPath();for(let i=0;i<points.length;i++){const p=points[i];if(i)c.lineTo(p.x??p[0],p.y??p[1]);else c.moveTo(p.x??p[0],p.y??p[1]);}c.strokeStyle=colour;c.lineWidth=width;c.stroke();};
const text=(c,value,x,y,size,colour,align='left')=>{c.font=`${size}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;c.fillStyle=colour;c.textAlign=align;c.textBaseline='middle';c.fillText(String(value),x,y);};
const rect=(c,x,y,w,h,colour,width=.7)=>{c.strokeStyle=colour;c.lineWidth=width;c.strokeRect(x,y,w,h);};
const dot=(c,x,y,r,colour)=>{c.fillStyle=colour;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();};
const point=(x,y,angle,distance)=>({x:x+Math.cos(angle)*distance,y:y+Math.sin(angle)*distance});
const corners=(c,x,y,w,h,size,colour)=>{for(const [xx,yy,sx,sy]of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]])stroke(c,[[xx+size*sx,yy],[xx,yy],[xx,yy+size*sy]],colour,.8);};
const HSL=new Map();
const colourComponents=hex=>{if(!HSL.has(hex)){if(HSL.size>64)HSL.clear();const s=String(hex).replace('#',''),[r,g,b]=[0,2,4].map(i=>(parseInt(s.slice(i,i+2),16)||0)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)*.5,h=d?(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)/6:0;HSL.set(hex,[h,d?d/(1-Math.abs(2*l-1)):0,l]);}return HSL.get(hex);};
const mixComponents=(a,b,t)=>{const x=colourComponents(a),y=colourComponents(b),delta=((y[0]-x[0]+1.5)%1)-.5;return[(x[0]+delta*t+1)%1,lerp(x[1],y[1],t),lerp(x[2],y[2],t)];};
const hexColour=([h,s,l])=>{const chroma=s*Math.min(l,1-l);return '#'+[0,8,4].map(n=>{const k=(n+h*12)%12,v=l-chroma*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(clamp(v)*255).toString(16).padStart(2,'0');}).join('');};
const polygon=(c,points,fill,ink,width=.8)=>{c.beginPath();points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(ink){c.strokeStyle=ink;c.lineWidth=width;c.stroke();}};
const audioWire=(c,points,ink,u,weight)=>{if(ink.glow<=.001)return;stroke(c,points,rgba(ink.highlight,ink.glow*.13),weight+Math.min(2,1.8*u)*ink.glow);stroke(c,points,rgba(ink.highlight,ink.glow*.80),Math.max(.45,weight*.6));};
const controlSize=crawlControlRadius;
const formatValue=(q,patch,note)=>{const v=q.value,o=patch?.options;if(!o)return v.toFixed(2);if(q.key==='pitch')return note||String(patch.midi);if(q.key==='range')return v<.5?'LOW':'HIGH';if(q.key==='tone')return o.cutoff>=1000?(o.cutoff/1000).toFixed(1)+'k':Math.round(o.cutoff)+'Hz';if(q.key==='resonance')return o.resonance.toFixed(1)+' Q';if(q.key==='decay')return o.decay.toFixed(2)+'s';if(q.key==='detune')return Math.round(o.detune)+'ct';if(q.key==='gate')return Math.round(patch.gate*100)+'%';if(q.key==='division')return({1:'1/16',2:'1/8',3:'3/16',4:'1/4',6:'3/8',8:'1/2'})[patch.division]||String(patch.division);if(q.key==='accent')return Math.round(o.velocity*100)+'%';if(q.key==='shape')return q.lane===0?({sine:'SIN',triangle:'TRI',sawtooth:'SAW',square:'PULSE',wavetable:'WT'})[o.waveform]||'OSC':q.lane===1?'FM '+Number(o.ratio).toFixed(1):q.lane===2?'WT '+Math.round(o.tablePosition*100):'SB '+Math.round((o.sideband??v)*100);return v.toFixed(2);};

/** The panel and the creatures are projected from the same CSS-pixel world.
 * Simulation state is never changed by the renderer. Only the static drafting
 * layer is cached; switches, meters, joints and acquisition traces remain live. */
// A visual spine rides above the walking skeleton. Re-solve the legs to the
// same planted feet; the head/operating hand remain in world-space contact.
export function crawlReactivePose(creature,amount,time,reduced=false,bounds=null){
 if(reduced||!amount||!creature.audio?.level)return creature;
 const u=creature.scale||1,source=creature.segments,anatomy=crawlAnatomy(creature.kind),offsets=source.map((s,i)=>{
  if(!i)return{x:0,y:0};
  const energy=Math.sqrt(clamp(creature.audio.segments?.[i]??creature.audio.level));
  const wave=Math.sin(time*2.8+creature.audio.mid*.8+i*.77+creature.index)*energy*amount;
  const excursion={centipede:11,spider:i===2?6:1,beetle:0,mantis:i*2.6,scorpion:2}[creature.kind]||0;
  let distance=wave*excursion*u;
  const legs=creature.legs.filter(l=>l.segment===i),nx=-Math.sin(s.angle),ny=Math.cos(s.angle);
  // Retain two-bone reach, including partially extended legs during a stride.
  for(let n=0;n<12;n++){
   if(legs.every(l=>{const d=Math.hypot(l.foot.x-l.hip.x-nx*distance,l.foot.y-l.hip.y-ny*distance);return d<l.upper+l.lower-.01&&d>Math.abs(l.upper-l.lower)+.01;}))break;
   distance*=.65;
  }
  if(!legs.every(l=>{const d=Math.hypot(l.foot.x-l.hip.x-nx*distance,l.foot.y-l.hip.y-ny*distance);return d<l.upper+l.lower-.0001&&d>Math.abs(l.upper-l.lower)+.0001;}))distance=0;
  if(bounds){
   const points=[s,...(i===source.length-1?creature.tail||[]:[])];
   while(Math.abs(distance)>.001&&points.some(p=>p.x+nx*distance<8*u||p.x+nx*distance>bounds.w-8*u||p.y+ny*distance<8*u||p.y+ny*distance>bounds.h-8*u))distance*=.5;
  }
  return{x:nx*distance,y:ny*distance};
 });
 const shift=(p,d)=>({...p,x:p.x+d.x,y:p.y+d.y});
 const segments=source.map((s,i)=>shift(s,offsets[i]));
 const legs=creature.legs.map(l=>{const hip=shift(l.hip,offsets[l.segment]||offsets[0]);return{...l,hip,knee:solveCrawlIK(hip,l.foot,l.upper,l.lower,l.side*anatomy.bend)};});
 const tail=(creature.tail||[]).map(p=>shift(p,offsets.at(-1)));
 return{...creature,segments,legs,tail};
}

export class CrawlRenderer{
 constructor(){this.background=null;this.key='';this.lastTime=0;}
 palette(a){return{...DEFAULTS,...a};}
 staticLayer(panel,a,dpr){
  const {w,h,unit:u,controls,zones}=panel;
  const key=[w,h,dpr,a.panelColour,a.traceColour,a.legendColour,a.circuitContrast,a.panelContrast,a.legendContrast,controls.length].join('|');if(key===this.key)return;this.key=key;
  this.background??=document.createElement('canvas');this.background.width=Math.max(1,Math.round(w*dpr));this.background.height=Math.max(1,Math.round(h*dpr));const c=this.background.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
  c.fillStyle=a.panelColour;c.fillRect(0,0,w,h);
  const board=c.createLinearGradient(0,0,w,h);board.addColorStop(0,'rgba(17,24,27,.35)');board.addColorStop(.48,'rgba(0,0,0,.05)');board.addColorStop(1,'rgba(18,20,24,.25)');c.fillStyle=board;c.fillRect(0,0,w,h);
  const grid=Math.max(22,29*u),faint=rgba(a.traceColour,a.circuitContrast*.30);c.fillStyle=faint;
  for(let y=55;y<h-8;y+=grid)for(let x=13;x<w-8;x+=grid){c.fillRect(x-.5,y-.5,1,1);if((Math.round(x/grid)+Math.round(y/grid))%4===0){c.fillRect(x-2,y-.4,4,.8);c.fillRect(x-.4,y-2,.8,4);}}
  // Printed traces bridge the instrument modules. They stay thin enough that
  // the inhabitants remain readable while traversing a busy part of the board.
  for(let lane=0;lane<zones.length;lane++){
   const z=zones[lane],items=controls.filter(q=>q.lane===lane),busY=z.y+z.h-8*u;
   const col=rgba(a.traceColour,a.circuitContrast*.70);
   for(let i=0;i<items.length;i++){const q=items[i],x=q.cx,y=q.cy,turnY=busY-(i%3)*3*u;
    stroke(c,[[x,y+controlSize(q,u)+5*u],[x,turnY],[z.x+8*u+i*3*u,turnY],[z.x+8*u+i*3*u,z.y+17*u]],col,.55);
    dot(c,x,turnY,1.25*u,rgba(a.traceColour,a.circuitContrast*.85));
   }
   // Open module rails: no filled cards or containers beneath the creatures.
   stroke(c,[[z.x,z.y+17*u],[z.x+z.w,z.y+17*u]],rgba(a.legendColour,a.panelContrast*.27),.7);
   corners(c,z.x,z.y+17*u,z.w,z.h-17*u,7*u,rgba(a.legendColour,a.panelContrast*.48));
   const title=z.label||['OSCILLATOR / 01','OSCILLATOR / 02','OSCILLATOR / 03','OSCILLATOR / 04'][lane];
   text(c,title,z.x+4*u,z.y+7*u,Math.max(8,9*u),rgba(a.legendColour,a.legendContrast*.86));
   text(c,'V'+String(lane+1).padStart(2,'0'),z.x+z.w-4*u,z.y+7*u,Math.max(7,8*u),rgba(a.legendColour,a.legendContrast*.43),'right');
   for(const q of items){
    const r=controlSize(q,u),captionY=q.cy+r+Math.max(5,7*u);
    text(c,NAMES[q.key]||q.key.toUpperCase(),q.cx,captionY,Math.max(6.8,7.8*u),rgba(a.legendColour,a.legendContrast),'center');
    if(q.type==='dial'){
     for(let k=0;k<=20;k++){const angle=Math.PI*.75+k/20*Math.PI*1.5,p=point(q.cx,q.cy,angle,r+4*u),end=point(q.cx,q.cy,angle,r+(k%5?6:8)*u);stroke(c,[p,end],rgba(a.legendColour,a.panelContrast*(k%5?.34:.72)),k%5?.55:.8);}
     text(c,'−',q.cx-r-8*u,q.cy+r*.64,Math.max(6,6.5*u),rgba(a.legendColour,a.legendContrast*.4),'center');text(c,'+',q.cx+r+8*u,q.cy+r*.64,Math.max(6,6.5*u),rgba(a.legendColour,a.legendContrast*.4),'center');
    }else if(q.type==='fader'){
     const track=r*1.7;for(let k=0;k<7;k++){const y=q.cy-track*.5+k/6*track;stroke(c,[[q.cx-10*u,y],[q.cx-(k%3?6:4)*u,y]],rgba(a.legendColour,a.panelContrast*.66),.6);stroke(c,[[q.cx+6*u,y],[q.cx+10*u,y]],rgba(a.legendColour,a.panelContrast*.48),.6);}
    }else{
     const w=Math.min(q.w*.48,28*u);rect(c,q.cx-w*.5,q.cy-r*.75,w,r*1.5,rgba(a.legendColour,a.panelContrast*.25),.6);
     for(const side of[-1,1])dot(c,q.cx+side*(w*.5+3*u),q.cy,1*u,rgba(a.traceColour,a.panelContrast));
    }
   }
  }
  const seq=panel.sequence;if(seq){stroke(c,[[seq.x,seq.y],[seq.x+seq.w,seq.y]],rgba(a.legendColour,a.panelContrast*.30),.7);text(c,'CLOCK / 16',seq.x+2,seq.y-8*u,Math.max(7,8*u),rgba(a.legendColour,a.legendContrast*.55));}
  // Discrete machining marks and screw heads add physical scale without a
  // bulky frame stealing space at the curved edges of a phone display.
  for(const [x,y]of [[6,58],[w-6,58],[6,h-8],[w-6,h-8]]){dot(c,x,y,2.4*u,'#030506');rect(c,x-1.8*u,y-1.8*u,3.6*u,3.6*u,rgba(a.legendColour,a.panelContrast*.45),.6);stroke(c,[[x-1.5*u,y+.9*u],[x+1.5*u,y-.9*u]],rgba(a.legendColour,a.panelContrast*.65),.6);}
 }
 control(c,q,a,u,time,step,patch,note){
  const since=time-num(q.changedAt,-100),flash=Math.exp(-Math.max(0,since)*3.2),value=crawlControlValue(q,time),r=controlSize(q,u),on=value>.5;
  const accent=q.lane<0?a.creatureLime:[a.creatureLime,a.creatureViolet,a.creatureCoral,a.creatureTeal][q.lane%4],ink=rgba(a.legendColour,a.controlContrast*.95),hot=rgba(accent,a.controlContrast*(.72+flash*.28));
  if(q.key==='step'){
   const size=Math.max(8,Math.min(q.w*.72,q.h*.6,29*u)),x=q.cx-size*.5,y=q.cy-size*.5;
   c.fillStyle=rgba(on?accent:a.traceColour,on?.075:.04);c.fillRect(x,y,size,size);rect(c,x,y,size,size,rgba(on?accent:a.legendColour,on?.58:.20),.7);
   if(on){c.fillStyle=rgba(accent,.52);c.fillRect(x+3*u,y+size-4*u,size-6*u,1.2*u);}
   const active=step===q.index;if(active){corners(c,x-3*u,y-3*u,size+6*u,size+6*u,4*u,rgba(accent,.9));c.fillStyle=rgba(accent,.08);c.fillRect(x,y,size,size);}
   text(c,String(q.index+1).padStart(2,'0'),q.cx,q.cy,Math.max(7,8*u),rgba(a.legendColour,on?.85:.35),'center');return;
  }
  if(q.type==='dial'){
   c.fillStyle='#080b0d';c.beginPath();c.arc(q.cx,q.cy,r,0,TAU);c.fill();c.strokeStyle=rgba(a.legendColour,a.controlContrast*.48);c.lineWidth=.8;c.stroke();
   c.beginPath();c.arc(q.cx,q.cy,r*.79,Math.PI*.75,Math.PI*2.25);c.strokeStyle=rgba(a.legendColour,a.controlContrast*.23);c.lineWidth=1;c.stroke();
   const angle=Math.PI*.75+value*Math.PI*1.5;c.beginPath();c.arc(q.cx,q.cy,r*.79,Math.PI*.75,angle);c.strokeStyle=hot;c.lineWidth=Math.max(.8,1.3*u);c.stroke();
   stroke(c,[point(q.cx,q.cy,angle,r*.18),point(q.cx,q.cy,angle,r*.63)],rgba(a.legendColour,.9*a.controlContrast),1.2*u);dot(c,q.cx,q.cy,1.6*u,rgba(a.legendColour,a.controlContrast*.58));
   // Three narrow cuts on the dial cap, dimmer than the moving index.
   for(let k=0;k<3;k++){const aa=angle+Math.PI+(k-1)*.26;stroke(c,[point(q.cx,q.cy,aa,r*.85),point(q.cx,q.cy,aa,r*.94)],rgba(a.legendColour,a.controlContrast*.27),.7);}
  }else if(q.type==='fader'){
   const track=r*1.7,y=q.cy+track*.5-value*track;c.fillStyle='#020405';c.fillRect(q.cx-3*u,q.cy-track*.5-2*u,6*u,track+4*u);rect(c,q.cx-3*u,q.cy-track*.5-2*u,6*u,track+4*u,rgba(a.legendColour,a.controlContrast*.24),.6);
   stroke(c,[[q.cx,q.cy+track*.5],[q.cx,y]],rgba(accent,a.controlContrast*.48),1.5*u);c.fillStyle='#171d20';c.fillRect(q.cx-7*u,y-3.5*u,14*u,7*u);rect(c,q.cx-7*u,y-3.5*u,14*u,7*u,ink,.75);stroke(c,[[q.cx-5*u,y],[q.cx+5*u,y]],hot,.8);
  }else{
   const width=Math.min(q.w*.42,24*u),travel=r*.68,y=q.cy+lerp(travel,-travel,value);
   c.fillStyle='#020405';c.fillRect(q.cx-3*u,q.cy-travel-3*u,6*u,travel*2+6*u);rect(c,q.cx-3*u,q.cy-travel-3*u,6*u,travel*2+6*u,rgba(a.legendColour,a.controlContrast*.23),.6);
   // A knife lever has an anchored hinge and a visibly travelling contact.
   dot(c,q.cx,q.cy+travel*.85,3*u,'#10181b');rect(c,q.cx-2*u,q.cy+travel*.85-2*u,4*u,4*u,ink,.7);
   stroke(c,[[q.cx,q.cy+travel*.85],[q.cx+width*.18,y]],rgba(a.legendColour,.92*a.controlContrast),2*u);c.fillStyle=on?rgba(accent,.82):'#5b6264';c.fillRect(q.cx+width*.18-4*u,y-2.5*u,8*u,5*u);rect(c,q.cx+width*.18-4*u,y-2.5*u,8*u,5*u,rgba(a.legendColour,.8),.6);
   dot(c,q.cx-width*.65,q.cy-travel,1.4*u,rgba(accent,on?.85:.12));dot(c,q.cx-width*.65,q.cy+travel,1.4*u,rgba(a.legendColour,on?.14:.48));
  }
  // Readouts use the same mapped parameters as the sound engine.
  const valueY=q.cy-r-Math.max(5,7*u);text(c,formatValue(q,patch,note),q.cx,valueY,Math.max(7,8.3*u),rgba(a.legendColour,a.legendContrast*(.92+flash*.08)),'center');
 }
 meter(c,panel,a,snapshot,meta){
  const m=panel.meter;if(!m)return;const u=panel.unit,cy=m.y+m.h*.5,x=m.x+2*u,w=m.w-4*u,colour=rgba(a.legendColour,.45*a.legendContrast),wave=snapshot?.waveform,frequency=snapshot?.frequency;
  const split=w*.52,amplitude=Math.max(5,m.h*.31),base=cy+3*u;
  stroke(c,[[x,base],[x+split-16*u,base]],rgba(a.traceColour,a.circuitContrast*.6),.55);
  for(let i=0;i<=4;i++){const xx=x+(split-16*u)*i/4;stroke(c,[[xx,base-amplitude],[xx,base+amplitude]],rgba(a.traceColour,a.circuitContrast*.28),.55);}
  text(c,'Σ',x,cy-amplitude-3*u,Math.max(8,9*u),colour);
  if(wave?.length){c.beginPath();const count=Math.min(180,wave.length);for(let i=0;i<count;i++){const xx=x+14*u+i/(count-1)*(split-30*u),value=wave[Math.floor(i/(count-1)*(wave.length-1))],yy=base-clamp(value*(a.scopeGain??.8)*4,-1,1)*amplitude;if(i)c.lineTo(xx,yy);else c.moveTo(xx,yy);}c.strokeStyle=rgba(a.creatureLime,.52);c.lineWidth=.8;c.stroke();}
  const fx=x+split+10*u,fw=w-split-48*u,bars=Math.max(12,Math.min(55,Math.floor(fw/(3*u))));
  for(let i=0;i<bars;i++){const value=frequency?.length?frequency[Math.min(frequency.length-1,Math.floor(Math.pow(i/(bars-1),2)*frequency.length))]:0,height=Math.max(.5,Math.min(amplitude*1.8,value*amplitude*1.9));c.fillStyle=rgba(a.legendColour,.16+value*.55);c.fillRect(fx+i/bars*fw,base+amplitude*.65-height,Math.max(.7,fw/bars-2*u),height);}
  const rms=clamp(num(snapshot?.rms)*5),mx=x+w-22*u;text(c,'OUT',mx+8*u,cy-amplitude-3*u,Math.max(6.5,7*u),colour,'right');
  for(let i=0;i<8;i++){c.fillStyle=rgba(i>5?a.creatureCoral:a.creatureLime,rms>i/8?.72:.09);c.fillRect(mx+i*2.5*u,base+amplitude*.65-4*u,1.6*u,4*u);}
 }
 response(c,panel,a,meta){
  const u=panel.unit;
  for(const z of panel.zones){
   const controls=panel.controls.filter(q=>q.lane===z.lane),rows=[...new Set(controls.map(q=>q.cy))].sort((x,y)=>x-y),patch=meta.patches?.[z.lane];if(rows.length!==2||!patch)continue;
   const r=Math.max(...controls.map(q=>controlSize(q,u))),gap=rows[1]-rows[0]-2*(r+8*u),height=Math.min(22*u,gap-12*u);if(height<13)continue;
   const x=z.x+21*u,y=(rows[0]+rows[1])*.5+height*.4,w=z.w-42*u,filterW=w*.56,ink=rgba(a.legendColour,a.legendContrast*.43),accent=[a.creatureLime,a.creatureViolet,a.creatureCoral,a.creatureTeal][z.lane],o=patch.options;
   stroke(c,[[x,y],[x+filterW,y]],rgba(a.traceColour,a.circuitContrast*.64),.6);
   for(let i=0;i<5;i++){const xx=x+i/4*filterW;stroke(c,[[xx,y+2*u],[xx,y-height]],rgba(a.traceColour,a.circuitContrast*.27),.5);}
   c.beginPath();for(let i=0;i<=50;i++){const f=30*Math.pow(16000/30,i/50),roll=1/Math.sqrt(1+Math.pow(f/Math.max(30,o.cutoff),4)),peak=Math.exp(-Math.pow(Math.log(f/Math.max(30,o.cutoff))/.32,2))*clamp(o.resonance/10)*.2,yy=y-Math.min(1,roll+peak)*height,xx=x+i/50*filterW;if(i)c.lineTo(xx,yy);else c.moveTo(xx,yy);}c.strokeStyle=rgba(accent,.50);c.lineWidth=.85;c.stroke();
   text(c,'30',x,y+8*u,Math.max(6,6.5*u),ink);text(c,'16k',x+filterW,y+8*u,Math.max(6,6.5*u),ink,'right');
   const wx=x+w*.68,ww=w*.32,base=y-height*.5;
   stroke(c,[[wx,base],[wx+ww,base]],rgba(a.traceColour,a.circuitContrast*.48),.5);
   c.beginPath();for(let i=0;i<=70;i++){const t=i/70,phase=t*TAU*2;let v=o.waveform==='square'?(Math.sin(phase)>=0?1:-1):o.waveform==='sawtooth'?(t*2%1)*2-1:o.waveform==='triangle'?Math.asin(Math.sin(phase))*2/Math.PI:Math.sin(phase);if(z.lane===1)v=Math.sin(phase+Math.sin(phase*o.ratio)*(o.index||0)*.4);if(z.lane===2)v=lerp(Math.sin(phase),Math.sin(phase)*Math.cos(phase*3),o.tablePosition||0);if(z.lane===3)v=(Math.sin(phase)+Math.sin(phase*1.04)*.3)*.76;const xx=wx+t*ww,yy=base-v*height*.37;if(i)c.lineTo(xx,yy);else c.moveTo(xx,yy);}c.strokeStyle=rgba(a.legendColour,a.controlContrast*.48);c.lineWidth=.7;c.stroke();
  }
 }
 audioAt(creature,a,position){
  const source=creature.audio||{},level=clamp(num(source.level)),reduced=Boolean(a._reduceAudioMotion),segments=source.segments||[],index=Math.min(segments.length-1,Math.max(0,Math.floor(position*segments.length))),local=reduced?level:clamp(num(segments[index],level)),presence=clamp((level+local)*4),attack=reduced?0:clamp(num(source.attack))*presence;
  return{level,local,energy:reduced?level*.48:local*.72+level*.28,bass:clamp(num(source.bass))*presence,mid:clamp(num(source.mid))*presence,treble:clamp(num(source.treble))*presence,attack,reduced};
 }
 inkAt(creature,a,position,side,time){
  const pairs={centipede:[a.creatureLime,a.creatureViolet],spider:[a.creatureCoral,a.creatureViolet],beetle:[a.creatureTeal,a.creatureViolet],mantis:[a.creatureViolet,a.creatureLime],scorpion:[a.creatureCoral,a.creatureTeal]},base=pairs[creature.kind]||pairs.spider,chroma=clamp(a.chroma??.7),flow=clamp(a.colourFlow??.35);
  // Spatial phase remains attached to anatomy. Audio response is a separate
  // measured signal, so holding the ambient colour pattern still cannot mute it.
  const phase=position*5.1+num(creature.index)*.73+side*.42+flow*(num(creature.angle)*.68+num(creature.travel)*.004)+Math.sin(time*.6*flow+num(creature.phase))*.62,wave=.5+.5*Math.sin(phase),opposite=.5+.5*Math.sin(phase+2.2),accents=[a.creatureTeal,a.creatureCoral,a.creatureViolet,a.creatureLime],other=accents[(num(creature.index)+1)%4],first=mixComponents(base[0],other,chroma*(.10+wave*.61)),second=mixComponents(base[1],accents[(num(creature.index)+3)%4],chroma*(.12+opposite*.72)),audio=this.audioAt(creature,a,position),amount=clamp(a.audioColour??.8),direction=[1,-.9,.78,-1.05,1.1][num(creature.index)%5],soft=audio.reduced?.46:1;
  const hue=amount*soft*direction*((audio.bass*.38-audio.treble*.32+audio.mid*.12)+audio.attack*.12),strength=amount*Math.sqrt(clamp(audio.energy+audio.attack*.25));
  for(const [index,components]of[first,second].entries()){
   components[0]=(components[0]+hue*(index?1.15:.82)+1)%1;
   components[1]=lerp(components[1],Math.max(components[1],.93),clamp(strength*.65));
   components[2]+=Math.min(Math.max(0,.79-components[2]),strength*(index?.22:.18));
  }
  const glow=clamp(a.audioGlow??.45)*clamp(audio.energy*.8+audio.attack*.35),highlight=hexColour([first[0],Math.min(.78,first[1]),first[2]+Math.min(.23,Math.max(0,.89-first[2]))]);
  return{primary:hexColour(first),secondary:hexColour(second),highlight,glow,energy:audio.energy,fill:clamp(amount*Math.sqrt(audio.energy)*1.8)*(audio.reduced?.2:1)};
 }
 bodySegment(c,s,index,creature,u,primary,secondary,a,ink){
  const response=this.audioAt(creature,a,index/(creature.segments.length||1)),drive=response.reduced?0:Math.sqrt(response.energy)*clamp(a.audioMotion??.65),kind=creature.kind,anatomy=crawlAnatomy(kind),plate=anatomy.plates[index]||anatomy.plates.at(-1),detail=clamp(a.anatomyDetail??.75),heat=ink.fill;
  // Each anatomy owns its deformation and illuminated surfaces. There is no
  // shared audio scale or rectangular fill layered over the different shells.
  let halfL=plate.length*u*.5,halfW=plate.width*u*.5;
  const ripple=Math.sin(index*.9-response.local*2.2);
  if(kind==='centipede'){halfL*=1-drive*.24;halfW*=1+drive*.08;}
  if(kind==='spider'&&index===2){halfL*=1+drive*.16;halfW*=1+drive*.16;}
  const flex=kind==='mantis'&&index>0?drive*.25*(index%2?1:-1):kind==='scorpion'?drive*ripple*.09:0;
  c.save();c.translate(s.x,s.y);c.rotate(num(s.angle,creature.angle)+flex+num(creature.bodySway)*Math.sin(index*.7+.6)*.3);
  const line=(pts,opacity=.8,width=.8)=>stroke(c,pts,rgba(primary,opacity),width*u);
  if(kind==='beetle'){
   // Rigid carapace, hinged paired elytra. Only the wing covers open.
   const outline=[[halfL,-halfW*.52],[halfL*.55,-halfW],[-halfL*.58,-halfW],[-halfL,-halfW*.47],[-halfL,halfW*.47],[-halfL*.58,halfW],[halfL*.55,halfW],[halfL,halfW*.52]];
   polygon(c,outline,rgba(a.panelColour,.86),rgba(secondary,.86),.85*u);
   for(const side of[-1,1]){
    c.save();c.translate(halfL*.7,0);c.rotate(-side*(index?drive*.65:0));c.translate(-halfL*.7,0);
    const shell=[[halfL*.7,0],[halfL*.42,side*halfW*.86],[-halfL*.48,side*halfW*.86],[-halfL*.88,side*halfW*.36],[-halfL*.88,0]];
    polygon(c,shell,rgba(primary,.05+heat*.24),rgba(primary,.88),.85*u);
    // Colour runs along the wing veins rather than filling the whole thorax.
    for(let k=0;k<4;k++){const xx=lerp(-halfL*.63,halfL*.3,k/3);stroke(c,[[xx,0],[xx+halfL*.23,side*halfW*.46],[xx+halfL*.12,side*halfW*.73]],rgba(k%2?secondary:primary,(.3+heat*.65)*detail),(.6+heat*.5)*u);}
    c.restore();
   }
   line([[-halfL*.88,0],[halfL*.90,0]],.95);
  }else if(kind==='spider'){
   // Faceted abdomen with radial tension lines; a compact cephalothorax.
   const outline=Array.from({length:8},(_,k)=>{const angle=k*TAU/8;return[Math.cos(angle)*halfL,Math.sin(angle)*halfW];});
   polygon(c,outline,rgba(a.panelColour,.85),rgba(secondary,.95),.9*u);
   const core=[halfL*.22,0];
   for(let k=0;k<8;k++){
    const p=outline[k],q=outline[(k+1)%8],tension=index===2?drive:.15*drive;
    const inner=[p[0]*(.55+tension*.13),p[1]*(.55+tension*.13)];
    if(index===2&&k%2===0)polygon(c,[core,inner,[q[0]*.65,q[1]*.65]],rgba(k%4?secondary:primary,heat*.55),null);
    stroke(c,[core,inner,p],rgba(primary,(.3+heat*.5)*detail),.65*u);
   }
   if(index===0)for(const side of[-1,1])dot(c,halfL*.35,side*halfW*.4,1.2*u,rgba(primary,.85+heat*.15));
  }else if(kind==='mantis'){
   if(index===0){
    const head=[[halfL,0],[-halfL,-halfW],[-halfL*.72,0],[-halfL,halfW]];
    polygon(c,head,rgba(a.panelColour,.85),rgba(primary,.95),u);
    for(const side of[-1,1]){dot(c,-halfL*.8,side*halfW*.72,1.5*u,rgba(secondary,.8));line([[-halfL*.5,side*halfW*.5],[halfL*.5,0]],.4+heat*.5);}
   }else{
    const thorax=[[halfL,0],[halfL*.54,-halfW],[-halfL*.70,-halfW*.72],[-halfL,0],[-halfL*.70,halfW*.72],[halfL*.54,halfW]];
    polygon(c,thorax,rgba(a.panelColour,.85),rgba(secondary,.91),.9*u);
    // Longitudinal nerve and alternating serrations preserve the slender form.
    line([[-halfL*.8,0],[halfL*.8,0]],.5+heat*.5,1+heat*.6);
    for(const side of[-1,1])for(let k=0;k<3;k++){
     const x=lerp(-halfL*.5,halfL*.3,k/2);line([[x-halfL*.15,0],[x,side*halfW*.65],[x+halfL*.22,side*halfW*.8]],(.35+heat*.6)*detail,.7);
    }
   }
  }else if(kind==='scorpion'){
   const outline=[[halfL,0],[halfL*.67,-halfW],[-halfL*.66,-halfW*.83],[-halfL,-halfW*.42],[-halfL,halfW*.42],[-halfL*.66,halfW*.83],[halfL*.67,halfW]];
   polygon(c,outline,rgba(a.panelColour,.86),rgba(secondary,.88),.85*u);
   // Overlapping chevrons lift at their trailing edges; colour follows armour seams.
   for(const side of[-1,1]){
    const lift=drive*halfW*.35;
    polygon(c,[[-halfL*.7,side*halfW*.5],[halfL*.5,side*(halfW*.72+lift)],[halfL*.8,0],[halfL*.4,side*halfW*.37]],rgba(primary,heat*.4),rgba(primary,.7+heat*.3),.85*u);
    if(detail>0)line([[-halfL*.6,side*halfW*.25],[halfL*.2,side*halfW*.38],[halfL*.5,0]],detail*.6,.6);
   }
  }else{
   // Centipede: short telescoping vertebrae, with paired chromatic ganglia.
   const outline=[[halfL,-halfW*.75],[halfL*.55,-halfW],[-halfL*.65,-halfW],[-halfL,-halfW*.65],[-halfL,halfW*.65],[-halfL*.65,halfW],[halfL*.55,halfW],[halfL,halfW*.75]];
   polygon(c,outline,rgba(a.panelColour,.8),rgba(secondary,.9),.85*u);
   if(detail>0){const depth=(1.5+drive*3)*u;stroke(c,[[-halfL,-halfW*.65],[-halfL-depth,-halfW-depth],[halfL*.55-depth,-halfW-depth],[halfL*.55,-halfW]],rgba(secondary,detail*.6),.6*u);}
   for(const side of[-1,1]){
    const x=halfL*.12,y=side*halfW*.47,r=Math.min(halfL*.55,halfW*.29);
    polygon(c,[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]],rgba(index%2?secondary:primary,.12+heat*.78),rgba(primary,.8),.6*u);
   }
   line([[-halfL*.85,0],[halfL*.85,0]],.75,.7);
  }
  const pulse=clamp(creature.pulse||0);if(pulse>.1)line([[-halfL*.3,0],[halfL*.3,0]],pulse*.65);
  audioWire(c,[[-halfL*.62,0],[halfL*.63,0]],ink,u,Math.max(.8,u));
  c.restore();
 }
 appendages(c,creature,a,u,time,weight,joint){
  const tail=creature.tail||[];
  if(tail.length>1){
   for(let i=0;i<tail.length-1;i++){
    const p=tail[i],q=tail[i+1],ink=this.inkAt(creature,a,1+i/tail.length*.8,1,time),angle=Math.atan2(q.y-p.y,q.x-p.x),length=Math.hypot(q.x-p.x,q.y-p.y),width=lerp(6.8,2.4,i/(tail.length-1))*u;
    c.save();c.translate((p.x+q.x)*.5,(p.y+q.y)*.5);c.rotate(angle);polygon(c,[[-length*.5,-width*.43],[length*.29,-width*.5],[length*.5,0],[length*.29,width*.5],[-length*.5,width*.43]],rgba(a.panelColour,.86),rgba(ink.secondary,.85),weight);stroke(c,[[-length*.36,0],[length*.23,0]],rgba(ink.primary,.87),Math.max(.8,u));if(a.anatomyDetail>0)stroke(c,[[-length*.20,-width*.33],[-length*.05,0],[-length*.20,width*.33]],rgba(ink.primary,a.anatomyDetail*.6),.6*u);c.restore();dot(c,p.x,p.y,.9*joint,rgba(ink.primary,.82));
   }
   const end=tail.at(-1),before=tail.at(-2),angle=Math.atan2(end.y-before.y,end.x-before.x),ink=this.inkAt(creature,a,1.8,1,time);c.save();c.translate(end.x,end.y);c.rotate(angle);polygon(c,[[-4*u,-3*u],[7*u,0],[-4*u,3*u],[-1*u,0]],rgba(ink.primary,.13),rgba(ink.primary,.91),.85*u);c.restore();
  }
  for(const claw of creature.claws||[]){
   const {base,knee,tip,innerTip,outerTip,side}=claw;if(!base||!knee||!tip)continue;const ink=this.inkAt(creature,a,-.20,side,time);
   stroke(c,[base,knee,tip],'rgba(0,0,0,.75)',weight+1.3*u);stroke(c,[base,knee],rgba(ink.secondary,.88),weight);stroke(c,[knee,tip],rgba(ink.primary,.83),weight);audioWire(c,[base,knee,tip],ink,u,weight);
   dot(c,knee.x,knee.y,1.2*joint,rgba(ink.primary,.93));dot(c,tip.x,tip.y,joint,rgba(ink.secondary,.83));
   if(claw.kind==='pincer'){
    const dx=tip.x-knee.x,dy=tip.y-knee.y,length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length,shoulder={x:tip.x-dx/length*8*u,y:tip.y-dy/length*8*u};
    const inner=innerTip||tip,outer=outerTip||tip;polygon(c,[[shoulder.x+nx*5*u,shoulder.y+ny*5*u],[tip.x+nx*7*u,tip.y+ny*7*u],[outer.x,outer.y],[tip.x+nx*2*u,tip.y+ny*2*u],[inner.x,inner.y],[shoulder.x-nx*4*u,shoulder.y-ny*4*u]],rgba(ink.primary,.065+ink.fill*.25),rgba(ink.primary,.9),weight);
    if(a.anatomyDetail>0)stroke(c,[shoulder,tip],rgba(ink.secondary,a.anatomyDetail*.9),.65*u);
   }else{
    if(innerTip)stroke(c,[tip,innerTip],rgba(ink.primary,.86),weight);
    if(outerTip)stroke(c,[tip,outerTip],rgba(ink.secondary,.75),weight);
    if(a.anatomyDetail>0){const dx=tip.x-knee.x,dy=tip.y-knee.y,length=Math.hypot(dx,dy)||1;for(let k=0;k<4;k++){const t=.25+k*.16,x=lerp(knee.x,tip.x,t),y=lerp(knee.y,tip.y,t);stroke(c,[[x,y],[x-dy/length*side*3.6*u+dx/length*1.5*u,y+dx/length*side*3.6*u+dy/length*1.5*u]],rgba(ink.primary,a.anatomyDetail*.70),.65*u);}}
   }
  }
 }
 creature(c,creature,a,u,time,selected){
  creature=crawlReactivePose(creature,clamp(a.audioMotion??.65),time,a._reduceAudioMotion,this.viewport);
  const legs=creature.legs||[],weight=(a.legWeight??1)*Math.max(.65,u*.86),joint=Math.max(.7,u*(a.jointSize??1));
  c.save();c.lineCap='round';c.lineJoin='round';
  for(const leg of legs){const hip=leg.hip,knee=leg.knee,foot=leg.foot;if(!hip||!knee||!foot)continue;const ink=this.inkAt(creature,a,num(leg.segment)/(creature.segments.length||1),leg.side,time),dx=foot.x-hip.x,dy=foot.y-hip.y,d=Math.hypot(dx,dy)||1,off=5*u,side=leg.side||1,p1={x:knee.x-dy/d*off*side,y:knee.y+dx/d*off*side},p2={x:foot.x-dy/d*off*side,y:foot.y+dx/d*off*side};stroke(c,[hip,p1,p2,foot],rgba(ink.secondary,(a.limbEnvelope??.2)*.6),.55);}
  for(const leg of legs){const hip=leg.hip,knee=leg.knee,foot=leg.foot;if(!hip||!knee||!foot)continue;
   const pos=num(leg.segment)/(creature.segments.length||1),ink=this.inkAt(creature,a,pos,leg.side,time),toe=this.inkAt(creature,a,pos+.28,leg.side,time);
   stroke(c,[hip,knee,foot],'rgba(0,0,0,.82)',weight+1.5*u);
   if(a.creatureGlow>0){c.shadowColor=rgba(ink.secondary,a.creatureGlow*.72);c.shadowBlur=3*u*a.creatureGlow;}
   stroke(c,[hip,knee],rgba(ink.secondary,leg.planted?.87:.60),weight);stroke(c,[knee,foot],rgba(toe.secondary,leg.planted?.87:.60),weight);c.shadowBlur=0;audioWire(c,[hip,knee],ink,u,weight);audioWire(c,[knee,foot],toe,u,weight);
   const ratio=leg.planted?1:.72;dot(c,knee.x,knee.y,1.25*joint,rgba(ink.primary,.98*ratio));dot(c,hip.x,hip.y,.85*joint,rgba(ink.secondary,.8));dot(c,foot.x,foot.y,1.25*joint,rgba(toe.primary,.94*ratio));
   const dx=foot.x-knee.x,dy=foot.y-knee.y,d=Math.hypot(dx,dy)||1,tip={x:foot.x+dx/d*3*u,y:foot.y+dy/d*3*u};stroke(c,[foot,tip],rgba(toe.primary,.61),.65);
   if(leg.planted&&num(leg.index)%3===0)stroke(c,[[foot.x-2*u,foot.y+3*u],[foot.x+2*u,foot.y+3*u]],rgba(toe.primary,.22),.5);
  }
  this.appendages(c,creature,a,u,time,weight,joint);
  const segs=creature.segments||[{x:creature.x,y:creature.y,angle:creature.angle}],headInk=this.inkAt(creature,a,0,0,time);
  stroke(c,segs,rgba(headInk.secondary,.25),2*u);
  for(let i=segs.length-1;i>=0;i--){const ink=this.inkAt(creature,a,i/segs.length,0,time);this.bodySegment(c,segs[i],i,creature,u,ink.primary,ink.secondary,a,ink);}
  const head=segs[0]||creature;
  for(const feeler of creature.feelers||[]){stroke(c,[feeler.base,feeler.knee,feeler.tip],rgba(headInk.secondary,.61),weight*.78);audioWire(c,[feeler.base,feeler.knee,feeler.tip],headInk,u,weight*.78);dot(c,feeler.tip.x,feeler.tip.y,.95*joint,rgba(headInk.primary,.75));}
  const reach=creature.reach;if(reach?.base&&reach?.knee&&reach?.tip){
   // An operating limb is part of the animal: no hand icon or contact overlay.
   const ink=this.inkAt(creature,a,.12,1,time);stroke(c,[reach.base,reach.knee,reach.tip],'rgba(0,0,0,.82)',weight+1.5*u);stroke(c,[reach.base,reach.knee,reach.tip],rgba(ink.secondary,.87),weight);audioWire(c,[reach.base,reach.knee,reach.tip],ink,u,weight);dot(c,reach.knee.x,reach.knee.y,1.25*joint,rgba(ink.primary,.98));dot(c,reach.tip.x,reach.tip.y,1.25*joint,rgba(ink.primary,.94));
  }
  if(selected===creature.id){const size=20*u;corners(c,head.x-size,head.y-size,size*2,size*2,5*u,rgba(headInk.primary,.48));}
  c.restore();
 }
 guides(c,world,a,u,time){
  const guides=world.guides instanceof Map?[...world.guides.values()]:Array.isArray(world.guides)?world.guides:Object.values(world.guides||{});
  for(const guide of guides){if(!Number.isFinite(guide.x)||!Number.isFinite(guide.y))continue;const r=12*u;c.save();c.setLineDash([2*u,4*u]);c.beginPath();c.arc(guide.x,guide.y,r,0,TAU);c.strokeStyle=rgba(a.creatureLime,.48);c.lineWidth=.8;c.stroke();c.setLineDash([]);stroke(c,[[guide.x-r-5*u,guide.y],[guide.x-r+1*u,guide.y]],rgba(a.creatureLime,.68),.8);stroke(c,[[guide.x+r-1*u,guide.y],[guide.x+r+5*u,guide.y]],rgba(a.creatureLime,.68),.8);dot(c,guide.x,guide.y,1.2*u,rgba(a.creatureLime,.7));c.restore();}
 }
 draw(c,world,appearance={},snapshot={},meta={}){
  const panel=world.panel;if(!panel)return;const a=this.palette(appearance),{w,h,unit:u}=panel,time=num(world.time,meta.time),dpr=Math.max(.25,num(c.getTransform?.().a,1));
  this.viewport={w,h};this.staticLayer(panel,a,dpr);c.clearRect(0,0,w,h);c.drawImage(this.background,0,0,w,h);this.lastTime=time;
  for(const control of panel.controls)this.control(c,control,a,u,time,meta.playing?meta.step:-1,meta.patches?.[control.lane],meta.notes?.[control.lane]);
  this.meter(c,panel,a,snapshot,meta);this.response(c,panel,a,meta);this.guides(c,world,a,u,time);
  if(Array.isArray(meta.notes))for(const z of panel.zones)text(c,meta.notes[z.lane]||'',z.x+z.w*.72,z.y+7*u,Math.max(7.2,8*u),rgba(a.legendColour,a.legendContrast*.64),'right');
  const creatures=world.creatures||[];
  for(const creature of creatures)this.creature(c,creature,meta.reducedMotion?{...a,colourFlow:0,_reduceAudioMotion:true}:a,num(creature.scale,u),time,meta.selected);
  text(c,'AGENTS / '+String(creatures.length).padStart(2,'0'),14,24,Math.max(8.5,9*u),rgba(a.legendColour,a.legendContrast*.73));
  const changed=panel.controls.reduce((n,q)=>n+(time-num(q.changedAt,-100)<.7?1:0),0);if(w>620)text(c,'ACT '+String(changed).padStart(2,'0'),14+Math.max(112,124*u),24,Math.max(7.5,8*u),rgba(a.legendColour,a.legendContrast*.55));
 }
 dispose(){if(this.background)this.background.width=this.background.height=0;this.background=null;this.key='';}
}
