import {TAU,clamp,lerp,rgba} from './kit.js';
import {crawlControlRadius,crawlControlValue,crawlActuatorPoint} from './crawl-world.js';

const DEFAULTS={panelColour:'#080b0c',traceColour:'#56626b',legendColour:'#bfc7bf',creatureLime:'#d6ef62',creatureViolet:'#7273c8',creatureCoral:'#ef8466',creatureTeal:'#6dd7b4',circuitContrast:.5,panelContrast:.65,controlContrast:.95,legendContrast:.9,legWeight:1,jointSize:1,creatureGlow:.3,limbEnvelope:.2,scopeGain:.8};
const NAMES={pitch:'PITCH',range:'RANGE',shape:'SHAPE',tone:'CUTOFF',resonance:'RESO',decay:'DECAY',detune:'DETUNE',gate:'GATE',division:'DIV',accent:'ACCENT'};
const num=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const stroke=(c,points,colour,width=.7)=>{if(!points.length)return;c.beginPath();for(let i=0;i<points.length;i++){const p=points[i];if(i)c.lineTo(p.x??p[0],p.y??p[1]);else c.moveTo(p.x??p[0],p.y??p[1]);}c.strokeStyle=colour;c.lineWidth=width;c.stroke();};
const text=(c,value,x,y,size,colour,align='left')=>{c.font=`${size}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;c.fillStyle=colour;c.textAlign=align;c.textBaseline='middle';c.fillText(String(value),x,y);};
const rect=(c,x,y,w,h,colour,width=.7)=>{c.strokeStyle=colour;c.lineWidth=width;c.strokeRect(x,y,w,h);};
const dot=(c,x,y,r,colour)=>{c.fillStyle=colour;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();};
const point=(x,y,angle,distance)=>({x:x+Math.cos(angle)*distance,y:y+Math.sin(angle)*distance});
const corners=(c,x,y,w,h,size,colour)=>{for(const [xx,yy,sx,sy]of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]])stroke(c,[[xx+size*sx,yy],[xx,yy],[xx,yy+size*sy]],colour,.8);};
const controlSize=crawlControlRadius;
const formatValue=(q,patch,note)=>{const v=q.value,o=patch?.options;if(!o)return v.toFixed(2);if(q.key==='pitch')return note||String(patch.midi);if(q.key==='range')return v<.5?'LOW':'HIGH';if(q.key==='tone')return o.cutoff>=1000?(o.cutoff/1000).toFixed(1)+'k':Math.round(o.cutoff)+'Hz';if(q.key==='resonance')return o.resonance.toFixed(1)+' Q';if(q.key==='decay')return o.decay.toFixed(2)+'s';if(q.key==='detune')return Math.round(o.detune)+'ct';if(q.key==='gate')return Math.round(patch.gate*100)+'%';if(q.key==='division')return({1:'1/16',2:'1/8',3:'3/16',4:'1/4',6:'3/8',8:'1/2'})[patch.division]||String(patch.division);if(q.key==='accent')return Math.round(o.velocity*100)+'%';if(q.key==='shape')return q.lane===0?({sine:'SIN',triangle:'TRI',sawtooth:'SAW',square:'PULSE',wavetable:'WT'})[o.waveform]||'OSC':q.lane===1?'FM '+Number(o.ratio).toFixed(1):q.lane===2?'WT '+Math.round(o.tablePosition*100):'SB '+Math.round((o.sideband??v)*100);return v.toFixed(2);};

/** The panel and the creatures are projected from the same CSS-pixel world.
 * No values or movement are changed by the renderer. Only the static drafting
 * layer is cached; switches, meters, joints and acquisition traces remain live. */
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
  if(flash>.015){c.save();c.strokeStyle=rgba(accent,flash*.7);c.lineWidth=.9;const radius=r+11*u;c.beginPath();c.arc(q.cx,q.cy,radius,-Math.PI*.85,-Math.PI*.85+TAU*clamp(1-since*.7));c.stroke();c.restore();}
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
 bodySegment(c,s,index,creature,u,primary,secondary,a){
  const segments=creature.segments||[],next=segments[Math.min(index+1,segments.length-1)],prev=segments[Math.max(0,index-1)],spacing=segments.length>2?Math.max(5*u,Math.hypot(next.x-prev.x,next.y-prev.y)/(index===0||index===segments.length-1?1:2)):11*u;
  const spider=creature.kind==='spider',length=spider?(index?17:12)*u:Math.min(16*u,spacing*.91),width=spider?(index?16:11)*u:Math.min(15*u,spacing*1.05),angle=num(s.angle,creature.angle);
  c.save();c.translate(s.x,s.y);c.rotate(angle);const halfL=length*.5,halfW=width*.5;
  c.fillStyle=rgba(a.panelColour,.74);c.fillRect(-halfL,-halfW,length,width);
  rect(c,-halfL-2*u,-halfW-2*u,length+4*u,width+4*u,rgba(secondary,.46),.65);
  rect(c,-halfL,-halfW,length,width,rgba(secondary,.82),.85);
  const offset=2.8*u;stroke(c,[[-halfL,-halfW],[-halfL+offset,-halfW-offset],[halfL+offset,-halfW-offset],[halfL,-halfW]],rgba(secondary,.25),.55);stroke(c,[[halfL,-halfW],[halfL+offset,-halfW-offset],[halfL+offset,halfW-offset],[halfL,halfW]],rgba(secondary,.32),.55);
  const inset=Math.max(1.9*u,Math.min(width*.23,3.2*u));
  if(index%4===1||spider){c.fillStyle=rgba(primary,index%3===0?.66:.20);c.fillRect(-halfL+inset,-halfW+inset,length-inset*2,width-inset*2);}
  // Open C-shaped rungs keep the segmented exoskeleton transparent.
  stroke(c,[[halfL-inset,-halfW+inset],[-halfL+inset,-halfW+inset],[-halfL+inset,halfW-inset],[halfL-inset,halfW-inset]],rgba(primary,.98),Math.max(.8,1.25*u));
  if(index%2===0)stroke(c,[[halfL-inset,halfW-inset],[halfL-inset,halfW-inset*2.1]],rgba(primary,.68),.8*u);
  const pulse=clamp(creature.pulse||0);if(pulse>.1){c.fillStyle=rgba(primary,pulse*.15);c.fillRect(-halfL,-halfW,length,width);}
  c.restore();
 }
 creature(c,creature,a,u,time,selected){
  const palette=[[a.creatureLime,a.creatureViolet],[a.creatureCoral,'#b26881'],[a.creatureTeal,'#548ca8'],[a.creatureViolet,a.creatureLime],[a.creatureLime,'#537ea6']],colour=palette[Math.abs(creature.colourIndex??creature.id??0)%palette.length],primary=colour[0],secondary=colour[1],legs=creature.legs||[],weight=(a.legWeight??1)*Math.max(.65,u*.86),joint=Math.max(.7,u*(a.jointSize??1));
  c.save();c.lineCap='round';c.lineJoin='round';
  // Fine outer quadrilaterals echo the reference's articulated wire cages.
  for(const leg of legs){const hip=leg.hip,knee=leg.knee,foot=leg.foot;if(!hip||!knee||!foot)continue;const dx=foot.x-hip.x,dy=foot.y-hip.y,d=Math.hypot(dx,dy)||1,off=5*u,side=leg.side||1,p1={x:knee.x-dy/d*off*side,y:knee.y+dx/d*off*side},p2={x:foot.x-dy/d*off*side,y:foot.y+dx/d*off*side};stroke(c,[hip,p1,p2,foot],rgba(secondary,.12+(a.limbEnvelope??.2)*.12),.55);}
  for(const leg of legs){const hip=leg.hip,knee=leg.knee,foot=leg.foot;if(!hip||!knee||!foot)continue;
   stroke(c,[hip,knee,foot],'rgba(0,0,0,.82)',weight+1.5*u);
   if(a.creatureGlow>0){c.shadowColor=rgba(secondary,a.creatureGlow*.72);c.shadowBlur=3*u*a.creatureGlow;}
   stroke(c,[hip,knee,foot],rgba(secondary,leg.planted?.83:.52),weight);c.shadowBlur=0;
   const ratio=leg.planted?1:.65;dot(c,knee.x,knee.y,1.25*joint,rgba(primary,.98*ratio));dot(c,hip.x,hip.y,.85*joint,rgba(secondary,.8));dot(c,foot.x,foot.y,1.25*joint,rgba(primary,.92*ratio));
   const dx=foot.x-knee.x,dy=foot.y-knee.y,d=Math.hypot(dx,dy)||1,tip={x:foot.x+dx/d*3*u,y:foot.y+dy/d*3*u};stroke(c,[foot,tip],rgba(primary,.56),.65);
   if(leg.planted&&num(leg.index)%3===0)stroke(c,[[foot.x-2*u,foot.y+3*u],[foot.x+2*u,foot.y+3*u]],rgba(primary,.22),.5);
  }
  const segs=creature.segments||[{x:creature.x,y:creature.y,angle:creature.angle}];
  stroke(c,segs,rgba(secondary,.25),3*u);for(let i=segs.length-1;i>=0;i--)this.bodySegment(c,segs[i],i,creature,u,primary,secondary,a);
  const head=segs[0]||creature;
  for(const feeler of creature.feelers||[]){stroke(c,[feeler.base,feeler.knee,feeler.tip],rgba(secondary,.52),weight*.78);dot(c,feeler.tip.x,feeler.tip.y,.95*joint,rgba(primary,.7));}
  const reach=creature.reach;if(reach?.base&&reach?.knee&&reach?.tip){
   stroke(c,[reach.base,reach.knee,reach.tip],'rgba(0,0,0,.7)',3.2*u);stroke(c,[reach.base,reach.knee,reach.tip],rgba(primary,.88),1.2*u);dot(c,reach.knee.x,reach.knee.y,1.7*joint,rgba(primary,.9));
   const r=2.3*u;rect(c,reach.tip.x-r,reach.tip.y-r,r*2,r*2,rgba('#e5f0be',.95),.8);
   if(reach.contact){c.strokeStyle=rgba(primary,.8);c.lineWidth=.8;c.beginPath();c.arc(reach.tip.x,reach.tip.y,7*u,0,TAU);c.stroke();for(let i=0;i<4;i++){const aa=i/4*TAU+time*.4;stroke(c,[point(reach.tip.x,reach.tip.y,aa,10*u),point(reach.tip.x,reach.tip.y,aa,13*u)],rgba(primary,.38),.7);}}
  }
  if(selected===creature.id){const s=20*u;corners(c,head.x-s,head.y-s,s*2,s*2,5*u,rgba(primary,.48));}
  c.restore();
 }
 guides(c,world,a,u,time){
  const guides=world.guides instanceof Map?[...world.guides.values()]:Array.isArray(world.guides)?world.guides:Object.values(world.guides||{});
  for(const guide of guides){if(!Number.isFinite(guide.x)||!Number.isFinite(guide.y))continue;const r=12*u;c.save();c.setLineDash([2*u,4*u]);c.beginPath();c.arc(guide.x,guide.y,r,0,TAU);c.strokeStyle=rgba(a.creatureLime,.48);c.lineWidth=.8;c.stroke();c.setLineDash([]);stroke(c,[[guide.x-r-5*u,guide.y],[guide.x-r+1*u,guide.y]],rgba(a.creatureLime,.68),.8);stroke(c,[[guide.x+r-1*u,guide.y],[guide.x+r+5*u,guide.y]],rgba(a.creatureLime,.68),.8);dot(c,guide.x,guide.y,1.2*u,rgba(a.creatureLime,.7));c.restore();}
 }
 draw(c,world,appearance={},snapshot={},meta={}){
  const panel=world.panel;if(!panel)return;const a=this.palette(appearance),{w,h,unit:u}=panel,time=num(world.time,meta.time),dpr=Math.max(.25,num(c.getTransform?.().a,1));
  this.staticLayer(panel,a,dpr);c.clearRect(0,0,w,h);c.drawImage(this.background,0,0,w,h);this.lastTime=time;
  for(const control of panel.controls)this.control(c,control,a,u,time,meta.playing?meta.step:-1,meta.patches?.[control.lane],meta.notes?.[control.lane]);
  this.meter(c,panel,a,snapshot,meta);this.response(c,panel,a,meta);this.guides(c,world,a,u,time);
  if(Array.isArray(meta.notes))for(const z of panel.zones)text(c,meta.notes[z.lane]||'',z.x+z.w*.72,z.y+7*u,Math.max(7.2,8*u),rgba(a.legendColour,a.legendContrast*.64),'right');
  const creatures=world.creatures||[];
  for(const creature of creatures)this.creature(c,creature,a,num(creature.scale,u),time,meta.selected);
  // The visible action readout belongs to the actuator, not a detached HUD.
  for(const creature of creatures){if(creature.state!=='operate'&&creature.state!=='recover')continue;const q=panel.controls.find(v=>v.id===creature.targetId);if(!q||time-num(q.changedAt,-100)>1.25)continue;const opacity=clamp(1-(time-q.changedAt)/1.25),x=clamp(q.cx+16*u,12,w-110*u),y=clamp(q.cy-20*u,66,h-28*u),actuator=crawlActuatorPoint(q,u,time);stroke(c,[[actuator.x+3*u,actuator.y-3*u],[x-3*u,y]],rgba(a.creatureLime,opacity*.4),.55);text(c,(NAMES[q.key]||'STEP')+' '+formatValue(q,meta.patches?.[q.lane],meta.notes?.[q.lane]),x,y,Math.max(7,8*u),rgba(a.creatureLime,opacity*.9));}
  text(c,'AGENTS / '+String(creatures.length).padStart(2,'0'),14,24,Math.max(8.5,9*u),rgba(a.legendColour,a.legendContrast*.73));
  const changed=panel.controls.reduce((n,q)=>n+(time-num(q.changedAt,-100)<.7?1:0),0);if(w>620)text(c,'ACT '+String(changed).padStart(2,'0'),14+Math.max(112,124*u),24,Math.max(7.5,8*u),rgba(a.legendColour,a.legendContrast*.55));
 }
 dispose(){if(this.background)this.background.width=this.background.height=0;this.background=null;this.key='';}
}
