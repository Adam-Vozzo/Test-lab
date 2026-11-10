import {splitLayout} from '../instrument-layout.js';
import {createOvergrowth} from './roses-overgrowth.js';
import {clamp,rgba} from './kit.js';
const TAU=Math.PI*2;

// A single branching instrument: gestures deform the objects carrying the sound.
export function createRoseGarden(host,api,play,regrow){
 const root=document.createElement('div');root.className='rose-garden';
 root.innerHTML=`<style>
 .rose-garden{position:absolute;inset:0;isolation:isolate;color:#c2e2cb;font:10px monospace}
 .rg-flower,.rg-console{position:absolute;min-width:0;min-height:0;overflow:visible}
 .rg-flower{background:radial-gradient(ellipse at 55% 38%,#2c092733,transparent 65%)}
 .rg-growth{position:absolute;inset:0;pointer-events:none;z-index:3}
 .rg-organ{position:absolute;inset:0;pointer-events:none}
 .rg-touch{position:absolute;appearance:none!important;-webkit-appearance:none!important;background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important;outline:none;touch-action:none;border-radius:50%;cursor:crosshair;color:transparent}
 .rg-touch:focus-visible{outline:1px dotted #afffe1;outline-offset:4px}
 </style><div class="rg-flower"></div><section class="rg-console" aria-label="Living rose instrument"><canvas class="rg-organ" aria-hidden="true"></canvas></section><canvas class="rg-growth" aria-hidden="true"></canvas>`;
 host.append(root);
 const flower=root.querySelector('.rg-flower'),panel=root.querySelector('.rg-console'),canvas=root.querySelector('.rg-organ'),c=canvas.getContext('2d'),growth=root.querySelector('.rg-growth'),ecology=createOvergrowth(growth,api),abort=new AbortController(),opts={signal:abort.signal},controls=[],contacts=new Map(),timers=new Set(),events=[];
 let pattern=[0,2,1,4,3,1,0,2,4,3,1,3,4,2,1,0],selected=0,current=-1,layout=null,geom=null,time=0,active='',serial=0,lastSound=0;
 function audition(index,kind='touch'){const id='roses-organ-'+kind+'-'+(++serial);play(index,id,true);const timer=setTimeout(()=>{play(index,id,false);timers.delete(timer);},180);timers.add(timer);}
 function read(key){return api.state.sound[key];}
 function point(e){const b=panel.getBoundingClientRect();return{x:e.clientX-b.x,y:e.clientY-b.y};}
 function change(q,p,first=false){
  const dx=(p.x-q.start.x)/Math.max(80,geom.w*.28),dy=(q.start.y-p.y)/Math.max(70,geom.h*.23),s=q.sound,k=q.control.key;
  if(k==='mix'){const g=geom.mix;api.setSound({roseGlass:clamp((p.x-g.x)/g.r*.5+.5),roseBody:clamp((g.y-p.y)/g.r*.5+.5),roseWidth:clamp(Math.abs(p.x-g.x)/g.r*.7)});}
  else if(k==='rain')api.setSound({rainDensity:clamp(s.rainDensity+dy),rainWind:clamp(s.rainWind+dx*1.6,-.8,.8)});
  else if(k==='echo')api.setSound({echo:clamp(s.echo+dy*.45,0,.45),feedback:clamp(s.feedback+dx*.6,0,.6),delayTime:clamp(.12+(1-clamp(s.feedback+dx*.6,0,.6)/.6)*.6,.08,.8)});
  else if(k==='filter')api.setSound({cutoff:clamp(s.cutoff*Math.pow(15,dy+dx*.5),800,18000),resonance:clamp(s.resonance+dx*5,0,8)});
  else if(k==='decay')api.setSound({roseDecay:clamp(s.roseDecay+dy),release:clamp(s.release+dx*4,.1,5)});
  else if(k.startsWith('step')&&!first){const index=q.control.index,next=Math.round(clamp(q.original+dy*5,-1,4));if(next!==pattern[index]){pattern[index]=next;const now=performance.now();if(next>=0&&now-(q.previewAt??-1000)>85){audition(next,'root-gliss');q.previewAt=now;}}}
  if(k.startsWith('flower')){const index=q.control.index;if(first||time-lastSound>.25){selected=index;lastSound=time;}}
 }
 function add(key,label,{index,role}={}){
  const button=document.createElement('button');button.type='button';button.className='rg-touch';button.dataset.organ=key;button.setAttribute('aria-label',label);if(role)button.setAttribute('role',role);panel.append(button);const control={key,label,index,button};controls.push(control);
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);const p=point(e),q={control,start:p,last:p,sound:{...api.state.sound},original:pattern[index],source:null};contacts.set(e.pointerId,q);active=key;
   if(key==='regrow'){regrow();return;}
   if(key.startsWith('step'))return;
   if(key.startsWith('flower'))selected=index;
   change(q,p,true);q.source='roses-organ-held-'+e.pointerId;play(selected,q.source,true);
  },opts);
  button.addEventListener('pointermove',e=>{const q=contacts.get(e.pointerId);if(!q)return;q.last=point(e);change(q,q.last);},opts);
  const end=e=>{const q=contacts.get(e.pointerId);if(!q)return;if(q.source){if(e.type==='pointerup')api.audio.start({completeGesture:true});play(selected,q.source,false,e.type==='pointercancel');}
   if(key.startsWith('step')&&e.type==='pointerup'){if(Math.hypot(q.last.x-q.start.x,q.last.y-q.start.y)<5)pattern[index]=pattern[index]>=4?-1:pattern[index]+1;if(pattern[index]>=0)audition(pattern[index],'seed');api.save();}
   contacts.delete(e.pointerId);active='';
  };for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,end,opts);
  button.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();if(key==='regrow')regrow();else if(key.startsWith('step')){pattern[index]=pattern[index]>=4?-1:pattern[index]+1;if(pattern[index]>=0)audition(pattern[index],'seed');api.save();}else audition(index??selected,'key');}
   const sign=e.key==='ArrowUp'||e.key==='ArrowRight'?1:e.key==='ArrowDown'||e.key==='ArrowLeft'?-1:0;if(!sign)return;e.preventDefault();const map={rain:['rainDensity',.05,0,1],echo:['echo',.025,0,.45],filter:['cutoff',500,800,18000],decay:['roseDecay',.05,0,1],mix:['roseGlass',.05,0,1]},m=map[key];if(m)api.setSound({[m[0]]:clamp(read(m[0])+sign*m[1],m[2],m[3])});
  },opts);return control;
 }
 add('mix','Harmonic mycelium. Drag horizontally for glass, vertically for body.',{role:'slider'});
 add('rain','Rain reservoir. Pull up for more rain; sideways for wind.',{role:'slider'});
 add('echo','Echo tendril. Stretch up for delay level, sideways for feedback.',{role:'slider'});
 add('filter','Filter leaf. Open upward for cutoff; sideways for resonance.',{role:'slider'});
 add('decay','Decay seed. Pull up for glass decay; sideways for release.',{role:'slider'});
 for(let i=0;i<5;i++)add('flower'+i,'Play flower '+(i+1),{index:i});
 for(let i=0;i<16;i++)add('step'+i,'Memory seed '+(i+1)+'. Tap to change flower; drag up or down to transpose.',{index:i});
 add('regrow','Regrow. Replay the plant growth and its sounds.');
 function resize(v){const r=root.getBoundingClientRect();layout=splitLayout(r.width,r.height,v,{pad:5,gap:18});for(const [el,b]of[[panel,layout.left],[flower,layout.right]])Object.assign(el.style,{left:b.x+'px',top:b.y+'px',width:b.w+'px',height:b.h+'px'});
  const w=layout.left.w,h=layout.left.h,unit=Math.min(w,h);geom={w,h,mix:{x:w*.5,y:h*.43,r:unit*.245},rain:{x:w*.15,y:h*.15,r:unit*.075},echo:{x:w*.84,y:h*.17,r:unit*.08},filter:{x:w*.16,y:h*.68,r:unit*.075},decay:{x:w*.83,y:h*.67,r:unit*.07},regrow:{x:w*.92,y:h*.90,r:Math.max(13,unit*.035)}};
  for(let i=0;i<5;i++){const a=(i/5)*TAU-Math.PI/2;geom['flower'+i]={x:geom.mix.x+Math.cos(a)*geom.mix.r*.86,y:geom.mix.y+Math.sin(a)*geom.mix.r*.72,r:Math.max(15,unit*.04)};}
  for(let i=0;i<16;i++){const f=i/15;geom['step'+i]={x:w*(.08+f*.73),y:h*(.85+Math.sin(f*TAU*1.25)*.035+(i%2? .028:0)),r:Math.max(11,unit*.024)};}
  for(const control of controls){const b=geom[control.key],rr=control.key==='mix'?b.r*.59:Math.max(17,b.r*1.2);Object.assign(control.button.style,{left:b.x-rr+'px',top:b.y-rr+'px',width:rr*2+'px',height:rr*2+'px'});}
  if(canvas.width!==Math.ceil(w)||canvas.height!==Math.ceil(h)){canvas.width=Math.ceil(w);canvas.height=Math.ceil(h);canvas.style.width=w+'px';canvas.style.height=h+'px';}
  if(growth.width!==Math.ceil(r.width)||growth.height!==Math.ceil(r.height)){growth.width=Math.ceil(r.width);growth.height=Math.ceil(r.height);growth.style.width=r.width+'px';growth.style.height=r.height+'px';}
 }
 function label(text,x,y,colour='#95c9b1',align='center',size=9){c.font=`${size}px monospace`;c.textAlign=align;c.fillStyle=colour;c.fillText(text,x,y);}
 function halo(x,y,r,colour,a=.3){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,rgba(colour,a));g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}
 function stroke(colour,width=1){c.strokeStyle=colour;c.lineWidth=width;c.stroke();}
 function organFrame(v,t,snapshot){
  const {w,h,mix,rain,echo,filter,decay,regrow}=geom,mt=api.reducedMotion?0:t,level=clamp(snapshot.rms*9),glass=read('roseGlass'),body=read('roseBody');c.clearRect(0,0,w,h);
  // The root network is the signal path: limbs join each playable organ to the nexus.
  for(const [n,key]of ['rain','echo','filter','decay'].entries()){
   const p=geom[key],end={x:mix.x,y:mix.y};for(let k=0;k<4;k++){c.beginPath();c.moveTo(p.x,p.y);c.bezierCurveTo(p.x+(end.x-p.x)*.1+k*4,p.y+(end.y-p.y)*.7,end.x+(p.x-end.x)*.5,end.y-k*4,end.x,end.y);stroke(rgba(k%2?v.mossColour:'#746791',.25+level*.3),k===0?2:1);}
   for(let k=0;k<5;k++){const f=(mt*.18+k/5)%1,x=p.x+(end.x-p.x)*f,y=p.y+(end.y-p.y)*(f*f*(3-2*f));halo(x,y,5,'#98e5c6',.22+level*.3);c.fillStyle='#96c6a5';c.fillRect(x,y,1,2);}
  }
  // Mycelial filaments fan out from a freely dragged nexus; shape carries brightness/body.
  const nx=mix.x+(glass-.5)*mix.r*.7,ny=mix.y+(.5-body)*mix.r*.6;
  halo(nx,ny,mix.r*.8,'#79d6b6',.08+level*.2);
  for(let j=0;j<52;j++){const angle=j/52*TAU,r=mix.r*(.55+glass*.3+.08*Math.sin(j*4.1)),x=mix.x+Math.cos(angle)*r,y=mix.y+Math.sin(angle)*r*.73;
   c.beginPath();c.moveTo(nx,ny);c.bezierCurveTo(nx+Math.cos(angle+1)*r*.38,ny+Math.sin(angle)*r*.2,x+Math.cos(mt*.5+j)*12,y+Math.sin(mt*.6+j)*8,x,y);stroke(rgba(j%5?v.mossColour:v.petalColour,.22+body*.25+level*.3));
   const tip=2+Math.sin(j*3.1)*1.3;c.fillStyle=rgba(j%5?'#a5e7c0':'#ffd4eb',.5+level*.4);c.fillRect(x,y,tip,tip);
  }
  for(let i=0;i<5;i++){const p=geom['flower'+i],playing=snapshot.voices.some(q=>q.id.includes('organ')&&q.level>.02)&&selected===i;halo(p.x,p.y,p.r*2,v.petalColour,playing?.6:.14);c.save();c.translate(p.x,p.y);c.rotate(i*.8+Math.sin(mt*.4+i)*.1);c.beginPath();c.moveTo(0,-p.r);c.bezierCurveTo(p.r*1.1,-p.r*.2,p.r*.6,p.r*.6,0,p.r*.5);c.bezierCurveTo(-p.r*.6,p.r*.6,-p.r*.8,-p.r*.2,0,-p.r);c.fillStyle=rgba(v.petalColour,selected===i?.55:.2);c.fill();stroke(rgba('#e8b3ce',.6));c.restore();label(String(i+1).padStart(2,'0'),p.x,p.y+3,'#f5d9e8');}
  c.fillStyle='#d7ffe7';c.fillRect(nx-2,ny-2,4,4);label('GLASS '+glass.toFixed(2)+' / BODY '+body.toFixed(2),mix.x,mix.y+mix.r*.99,'#a4d1bb', 'center',h<400?8:9);
  // Rain is a suspended droplet reservoir. Its meniscus is the actual emission amount.
  c.save();c.translate(rain.x,rain.y);const rr=rain.r,fill=read('rainDensity');c.beginPath();c.moveTo(0,-rr*1.5);c.bezierCurveTo(rr*.2,-rr*.5,rr*1.2,0,rr*.7,rr*.7);c.bezierCurveTo(rr*.1,rr*1.4,-rr*.8,rr*.9,-rr*.8,rr*.2);c.bezierCurveTo(-rr*.8,-rr*.3,-rr*.2,-rr*.8,0,-rr*1.5);c.save();c.clip();const liquid=c.createLinearGradient(0,-rr,0,rr);liquid.addColorStop(0,'#8cf2d055');liquid.addColorStop(1,'#3e867c99');c.fillStyle=liquid;c.fillRect(-rr,-rr*1.4+rr*2.5*(1-fill),rr*2,rr*3);c.beginPath();const yy=-rr*1.4+rr*2.5*(1-fill);for(let x=-rr;x<=rr;x+=2){const y=yy+Math.sin(x*.15+mt*2)*2;x===-rr?c.moveTo(x,y):c.lineTo(x,y);}stroke('#b7ffe1');c.restore();c.beginPath();c.moveTo(0,-rr*1.5);c.bezierCurveTo(rr*.2,-rr*.5,rr*1.2,0,rr*.7,rr*.7);c.bezierCurveTo(rr*.1,rr*1.4,-rr*.8,rr*.9,-rr*.8,rr*.2);c.bezierCurveTo(-rr*.8,-rr*.3,-rr*.2,-rr*.8,0,-rr*1.5);stroke('#76c3b5');c.restore();halo(rain.x,rain.y,rr*2.3,'#43d4b1',active==='rain'?.35:.12);
  label('RAIN '+Math.round(fill*100)+'%',rain.x,rain.y+rr*1.6);label('↕ DENSITY · ↔ WIND',rain.x,rain.y+rr*1.6+12,'#709c8d','center',h<400?7:8);
  if(api.state.playing)for(let i=0;i<4;i++){const f=(mt*.6+i/4)%1;c.fillStyle=rgba('#b2fbe4',1-f);c.fillRect(rain.x+Math.sin(i)*rr*.3+f*read('rainWind')*25,rain.y+rr+f*rr,1,3);}
  // Echo is an unfurling spiral, with visible repeat nodes spaced by delay time.
  const amount=read('echo')/.45,feedback=read('feedback');halo(echo.x,echo.y,echo.r*2,'#b672c5',.12+amount*.15);c.beginPath();for(let i=0;i<130;i++){const f=i/129,a=f*TAU*(1.4+feedback*2)+mt*.12,r=echo.r*(.15+f*(.8+amount*.35)),x=echo.x+Math.cos(a)*r,y=echo.y+Math.sin(a)*r*.7;i?c.lineTo(x,y):c.moveTo(x,y);}stroke('#b789bc',1.2);
  for(let i=0;i<5;i++){const f=(mt/(read('delayTime')*6)+i/5)%1,a=f*TAU*(1.4+feedback*2)+mt*.12,r=echo.r*(.15+f*(.8+amount*.35));halo(echo.x+Math.cos(a)*r,echo.y+Math.sin(a)*r*.7,6,'#ed9bdb',amount*(1-f*.8));}
  label('ECHO '+Math.round(amount*100)+'%',echo.x,echo.y+echo.r*1.5);label('↕ LEVEL · ↔ FEEDBACK',echo.x,echo.y+echo.r*1.5+12,'#9c78a0','center',h<400?7:8);
  // Filter leaf physically opens into two curved lobes as cutoff rises.
  const open=clamp(Math.log(read('cutoff')/800)/Math.log(18000/800)),fr=filter.r;
  c.save();c.translate(filter.x,filter.y);c.rotate(-.6);for(const side of[-1,1]){c.beginPath();c.moveTo(0,-fr);c.bezierCurveTo(side*fr*(.2+open),-fr*.5,side*fr*(.3+open),fr*.6,0,fr);c.quadraticCurveTo(side*fr*.1,0,0,-fr);c.fillStyle=rgba('#639a6f',.15+open*.2);c.fill();stroke('#a2c59a');for(let k=0;k<5;k++){const yy=(k/4-.5)*fr*1.6;c.beginPath();c.moveTo(0,yy);c.lineTo(side*fr*(.2+open)*Math.sin(k/4*Math.PI),yy-fr*.25);stroke('#70997670');}}c.restore();halo(filter.x,filter.y,fr*1.6,'#a5ee9e',.1+level*open*.3);label((read('cutoff')/1000).toFixed(1)+' kHz',filter.x,filter.y+fr*1.4);label('↕ OPEN · ↔ Q',filter.x,filter.y+fr*1.4+12,'#7ea276','center',h<400?7:8);
  // Decay is a hanging seed with a luminous tail whose length is the release time.
  const dr=decay.r,dec=read('roseDecay'),release=read('release'),dh=dr*(.5+dec*1.25),dw=dr*(.75-dec*.25);halo(decay.x,decay.y,dh*1.5,'#d583bb',active==='decay'?.26:.1);c.beginPath();c.moveTo(decay.x,decay.y-dh);c.bezierCurveTo(decay.x-dw,decay.y-dh*.3,decay.x-dw,decay.y+dh*.8,decay.x,decay.y+dh);c.bezierCurveTo(decay.x+dw,decay.y+dh*.4,decay.x+dw,decay.y,decay.x,decay.y-dh);c.fillStyle=rgba('#d893af',.15+dec*.2);c.fill();stroke('#c5a0b1');for(let k=0;k<18;k++){const f=k/18,xx=decay.x+Math.sin(mt*.6+f*4)*f*dr*.3,yy=decay.y+dh+f*dr*(.4+release*.42);c.fillStyle=rgba('#f6c5df',(1-f)*(.2+dec*.7));c.fillRect(xx,yy,2,3);}
  label('DECAY '+dec.toFixed(2)+' / '+release.toFixed(1)+'s',decay.x,decay.y-dr*2.05);label('↕ GLASS · ↔ RELEASE',decay.x,decay.y-dr*2.05+12,'#9c7890','center',h<400?7:8);
  // A continuous root with playable seed pods replaces the button matrix.
  c.beginPath();for(let i=0;i<16;i++){const p=geom['step'+i];i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}stroke('#73a58c88',1.5);
  for(let i=0;i<16;i++){const base=geom['step'+i],held=[...contacts.values()].some(q=>q.control.key==='step'+i),p={...base,y:base.y-(held?base.r*.4:0)},n=pattern[i],on=(api.state.playing&&current===i)||held,r=p.r*(n<0?.45:.55+n*.08)*(held?1.5:1);if(on)halo(p.x,p.y,p.r*2.4,'#c4ffae',.65);c.save();c.translate(p.x,p.y);c.rotate((i%2?1:-1)*.4);c.beginPath();c.ellipse(0,0,r*.65,r,0,0,TAU);c.fillStyle=rgba(n<0?'#345847':v.petalColour,on?.7:.22+n*.04);c.fill();stroke(on?'#e4ffbc':'#b68b9b');c.restore();label(n<0?'·':n+1,p.x,p.y+3,on?'#ecffd9':'#d5b9ce','center',h<400?8:9);controls.find(q=>q.key==='step'+i).button.dataset.current=on;controls.find(q=>q.key==='step'+i).button.setAttribute('aria-label','Memory seed '+(i+1)+': '+(n<0?'rest':'flower '+(n+1))+'. Tap to change; drag up or down.');}
  label('MEMORY / 16 · TAP OR DRAG SEEDS',w*.43,h*.965,'#8dab95','center',h<400?7:9);
  // Regrow is a split, germinating seed, distinct from the memory buds.
  halo(regrow.x,regrow.y,regrow.r*2,'#e98ac5',.2);for(const s of[-1,1]){c.beginPath();c.ellipse(regrow.x+s*regrow.r*.3,regrow.y,regrow.r*.4,regrow.r*.85,s*.3,0,TAU);c.fillStyle='#543b57';c.fill();stroke('#daa6c5');}c.beginPath();c.moveTo(regrow.x,regrow.y+3);c.lineTo(regrow.x,regrow.y-regrow.r*1.4);c.lineTo(regrow.x+regrow.r*.4,regrow.y-regrow.r*1.7);stroke('#b7e8bd',1.5);label('REGROW',regrow.x,regrow.y+regrow.r*1.45,'#e5b2cf','center',h<400?7:8);
  for(const key of ['rain','echo','filter','decay','mix']){const control=controls.find(q=>q.key===key),val={rain:read('rainDensity'),echo:read('echo'),filter:read('cutoff'),decay:read('roseDecay'),mix:glass}[key];control.button.setAttribute('aria-valuenow',val);control.button.setAttribute('aria-valuetext',key+' '+val.toFixed(2));}
 }
 return{flower,root,get pattern(){return pattern;},setPattern(p){if(Array.isArray(p)&&p.length===16)pattern=p.map(n=>Math.round(clamp(n,-1,4)));},scheduleStep(index,when){events.push({index,when});},
  frame(v,t,snapshot){time=t;resize(v);while(events.length&&events[0].when<=snapshot.time)current=events.shift().index;organFrame(v,t,snapshot);ecology.draw(v,t,snapshot,layout,null);},
  queueRain(petal,when,velocity){ecology.queue(petal,when,velocity);},drawRain(v,t,snapshot,points,impact){ecology.rain(v,t,snapshot,layout.right,points,impact);},clearRain(){ecology.clear();},
  cancel(){ecology.clear();for(const q of contacts.values())if(q.source)api.noteCancel(q.source);contacts.clear();events.length=0;active='';},
  destroy(){this.cancel();for(const timer of timers)clearTimeout(timer);timers.clear();abort.abort();ecology.destroy();root.remove();}
 };
}
