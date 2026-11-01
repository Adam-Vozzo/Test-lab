import * as THREE from '../vendor/three.module.min.js';
import {createSurface,bindPointers,clamp,lerp,TAU} from './kit.js';
import {splitLayout} from '../instrument-layout.js';

const range=(key,label,min,max,step,unit,section,description)=>({key,label,min,max,step,unit,section,description});
export const definition={
  id:'swarm',name:'Machine / Swarm',batch:2,
  theme:{bg:'#08090d',fg:'#f0efe9',accent:'#e2c866',muted:'#a6a2b8'},
  defaultSound:{waveform:'sawtooth',attack:.018,decay:.22,sustain:.42,release:.9,cutoff:2400,resonance:2.8,detune:6,ratio:2,index:0,translate:0,spread:7},
  defaultAppearance:{streakCount:5400,streakLength:1.8,curl:.85,inertia:.68,disturbance:.8,recovery:.5,emission:.72,wireOpacity:.82,fieldScale:.98,seed:19,bridgeScale:1.4,bridgeMotion:.7,windCoupling:.85},
  soundControls:[
    {key:'waveform',label:'Oscillator',kind:'select',options:[['sawtooth','Saw'],['square','Pulse'],['triangle','Triangle'],['sine','Sine']],section:'Source',description:'Waveform voiced by pitch lanes and swarm contacts.'},
    range('cutoff','Filter cutoff',80,12000,10,'Hz','Source','Brightness of every sounding lane and contact.'),
    range('resonance','Filter resonance',.2,9,.1,'Q','Source','Emphasis at the cutoff frequency.'),
    range('translate','Pitch translation',-12,12,1,'st','Transform','Transposes the pitch lanes and swarm notes.'),
    range('spread','Pitch spread',0,19,1,'st','Transform','Pitch interval added as a contact moves outward.'),
    range('ratio','FM ratio',.25,8,.25,'×','Modulation','Modulator frequency relative to the oscillator.'),
    range('index','FM index',0,8,.1,'','Modulation','Frequency-modulation depth; zero leaves the source unmodulated.'),
    range('attack','Attack',.005,1,.005,'s','Envelope','Time for a voice and its visible pulse to rise.'),
    range('release','Release',.05,4,.05,'s','Envelope','Voice and contact trail release duration.')
  ],
  appearanceControls:[
    range('streakCount','Streak count',600,7200,100,'','Swarm','Number of independently moving white traces.'),
    range('streakLength','Streak length',.35,3.5,.05,'×','Swarm','Distance each moving particle leaves behind.'),
    range('curl','Ambient curl',.05,1.4,.05,'','Swarm','Slow circulation of the untouched field.'),
    range('inertia','Motion inertia',.05,.95,.01,'','Swarm','How long traces retain their current velocity.'),
    range('disturbance','Touch influence',0,1.6,.05,'','Gesture','Strength of the local disturbance around each finger.'),
    range('recovery','Field recovery',.1,1,.05,'','Gesture','Speed at which displaced traces return to the flow.'),
    range('fieldScale','Field extent',.55,1,.01,'','Swarm','Width and height occupied by traces within their playing area.'),
    range('emission','Violet glow',0,1,.05,'','Connections','Emission on voice nodes and the two transformation loops.'),
    range('wireOpacity','Circuit weight',.15,1,.05,'','Connections','Opacity of pitch lanes and connecting gold wires.'),
    range('bridgeScale','Sculpture scale',.8,1.8,.05,'×','Connections','Size of the two translucent circuit sculptures.'),
    range('bridgeMotion','Sculpture motion',0,1,.05,'','Connections','Ambient rotation of the translucent sculptures.'),
    range('windCoupling','Audio wind strength',0,1.5,.05,'','Swarm','Force injected by sequencer packets arriving at the sculptures.')
  ]
};

const original=[2,4,6,4,1,3,5,7,4,2,5,3,6,4,1,3];
const number=(v,d=0)=>Number.isFinite(v)?v:d;
const css=(c,a)=>{const h=c.replace('#','');const n=parseInt(h,16);return `rgba(${n>>16},${n>>8&255},${n&255},${a})`;};
function text(c,s,x,y,color='#bcb9b0',size=10,align='left'){c.fillStyle=color;c.font=`${size}px "SFMono-Regular",Consolas,monospace`;c.textAlign=align;c.fillText(s,x,y);}
function stroke(c,pts,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function rectangle(c,x,y,w,h,color){c.strokeStyle=color;c.lineWidth=.7;c.strokeRect(x,y,w,h);}
function hash(n){let x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
const channels=[['CUTOFF','cutoff',80,12000,'Hz'],['RESO','resonance',.2,9,'Q'],['ATTACK','attack',.005,1,'s'],['DECAY','decay',.02,2,'s'],['FM RATIO','ratio',.25,8,'×'],['FM INDEX','index',0,8,''],['TRANSLATE','translate',-12,12,'st'],['SPREAD','spread',0,19,'st']];

export function circuitPacketPhase(event,now){return now<event.when?null:clamp((now-event.when)/Math.max(.001,event.travel),0,1);}
export function circuitWind(event,now,coupling=1,overlap=1){const age=now-event.when-event.travel;if(age<0||age>=2.7)return null;return{...event,age,front:age*(.45+event.cutoff/24000),force:Math.exp(-age*1.15)*coupling*(.65+event.resonance/9)/Math.max(1,Math.sqrt(overlap)*1.8)};}
export function touchWindGain(level,midi){return(.35+Math.sqrt(clamp(level*8,0,1)))*clamp(2**((midi-60)/48),.5,1.8);}
export function pathPoint(points,phase){const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1])),total=lengths.reduce((a,b)=>a+b,0);let distance=clamp(phase,0,1)*total;for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]||i===lengths.length-1){const q=lengths[i]?distance/lengths[i]:0;return[lerp(points[i][0],points[i+1][0],q),lerp(points[i][1],points[i+1][1],q)];}distance-=lengths[i];}return points[0];}
function bezierPoint(a,b,c,d,t){const q=1-t;return[q*q*q*a[0]+3*q*q*t*b[0]+3*q*t*t*c[0]+t*t*t*d[0],q*q*q*a[1]+3*q*q*t*b[1]+3*q*t*t*c[1]+t*t*t*d[1]];}

export function mount(host,api){
  const surface=createSurface(host,{label:'Pitch lanes and swarm. Drag a lane to edit its pitch. Drag the swarm to play and disturb the flow.',bg:'#08090d'});
  const {canvas,ctx:c}=surface;let steps=[...original],enabled=Array(16).fill(true),layout=null,particles=[],serial=0,lastT=0;
  const contacts=new Map(),roles=new Map(),releases=[],buckets=Array.from({length:7},()=>[]);
  const packets=[];
  let bridgeRenderer=null,bridgeScene=null,bridgeCamera=null,bridges=[],bridgeBox=null;
  const actions=document.createElement('div');actions.style.cssText='position:absolute;display:flex;gap:7px;z-index:2;';
  const seedButton=document.createElement('button'),clearButton=document.createElement('button');
  for(const [button,name]of [[seedButton,'SEED'],[clearButton,'CLEAR']]){button.type='button';button.textContent=name;button.style.cssText='border:1px solid #726433;color:#d6c170;background:#0b0c10;padding:5px 9px;font:9px monospace;min-height:30px;';actions.append(button);}seedButton.setAttribute('aria-label','Generate a new pitch-lane sequence');clearButton.setAttribute('aria-label','Mute all pitch-lane steps');host.append(actions);
  let sequenceSeed=19;
  const regenerate=()=>{sequenceSeed++;steps=steps.map((_,i)=>Math.floor(hash(i+sequenceSeed*31)*8));enabled.fill(true);api.save();};
  const clear=()=>{enabled.fill(false);api.save();};seedButton.addEventListener('click',regenerate);clearButton.addEventListener('click',clear);
  const waveActions=document.createElement('div');waveActions.style.cssText='position:absolute;display:flex;gap:8px;z-index:2;';
  const waveButtons=[];for(const [name,wave]of [['SAW','sawtooth'],['PULSE','square'],['TRI','triangle'],['FM','fm']]){const button=document.createElement('button');button.type='button';button.textContent=name;button.setAttribute('aria-label',`Select ${name} source`);button.style.cssText='border:1px solid #c4a94c;box-shadow:inset 0 0 0 2px #11100b;color:#e2c767;background:#10100a;font:bold 9px monospace;letter-spacing:.04em;min-height:31px;padding:6px 11px;';const click=()=>api.setSound?.(wave==='fm'?{waveform:'sine',ratio:2,index:3}:{waveform:wave,index:0});button.addEventListener('click',click);waveButtons.push({button,wave,click});button.style.position='relative';button.style.background='#121014';button.style.margin='6px 0';waveActions.append(button);}host.append(waveActions);
  const dispose=bindPointers(canvas,{down,move,up,cancel:cancelTouch});
  canvas.style.cursor='crosshair';
  const a=()=>({...definition.defaultAppearance,...api.state.appearance});
  const s=()=>({...definition.defaultSound,...api.state.sound});
  function bounds(){
    const w=surface.width,h=surface.height,margin=Math.max(16,w*.022),panels=splitLayout(w,h,api.state.appearance,{pad:margin,gap:24,stackPortrait:true}),small=!panels.wide,L=panels.left,R=panels.right;
    if(small)return{w,h,margin,small,left:L,right:R,machine:{x:L.x,y:L.y+17,w:L.w,h:L.h-34},field:{x:R.x,y:R.y+16,w:R.w,h:Math.max(90,R.h-99)},bridgeY:h-54,bridgeX:w*.48};
    return{w,h,margin,small,left:L,right:R,machine:{x:L.x,y:L.y+14,w:L.w-12,h:L.h*(h<480?.58:.65)},field:{x:R.x,y:R.y+14,w:R.w,h:R.h*.73},bridgeY:h*.84,bridgeX:(L.x+L.w+R.x)*.5};
  }
  function areas(){
    const b=layout||bounds(),m=b.machine;
    const gh=Math.max(64,m.h*(b.small?.38:.30));
    return{grid:{x:m.x+28,y:m.y+12,w:m.w-42,h:gh},sliders:{x:m.x+12,y:m.y+gh+35,w:m.w-26,h:Math.max(72,m.h-gh-40)}};
  }
  function inBox(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
  function soundFor(p){
    const f=layout.field,x=clamp((p.x-f.x)/f.w,0,1),y=clamp((p.y-f.y)/f.h,0,1),radius=Math.hypot(x-.5,(y-.5)*.85)*1.7;
    const z=s(),midi=api.quantize(Math.round(x*13),0)+z.translate+Math.round(clamp(radius,0,1)*z.spread);
    return{midi,options:{...z,cutoff:clamp(z.cutoff*Math.pow(2,(.5-y)*2),60,14000),pan:clamp((x-.5)*1.3,-.8,.8),gain:.11}};
  }
  function down(p){
    surface.resize();layout=bounds();const b=areas();
    if(inBox(p,b.grid)){roles.set(p.id,{kind:'grid'});editGrid(p);return;}
    if(inBox(p,b.sliders)){const row=clamp(Math.floor((p.y-b.sliders.y)/Math.max(1,b.sliders.h/channels.length)),0,channels.length-1);roles.set(p.id,{kind:'slider',row});editSlider(p,row);return;}
    if(inBox(p,layout.field)){roles.set(p.id,{kind:'voice'});const n=soundFor(p);contacts.set(p.id,{id:p.id,x:p.x,y:p.y,px:p.x,py:p.y,dx:0,dy:0,midi:n.midi,started:lastT});api.noteOn(`swarm-${p.id}`,n.midi,n.options);api.setStatus(`${api.noteName(n.midi)} · ${Math.round(n.options.cutoff)} Hz`);return;}
    return false;
  }
  function move(p){const role=roles.get(p.id);if(!role)return;if(role.kind==='grid')editGrid(p);else if(role.kind==='slider')editSlider(p,role.row);else{
    const q=contacts.get(p.id);if(!q)return;q.dx=clamp((p.x-q.x)/Math.max(layout.field.w,1),-.08,.08);q.dy=clamp((p.y-q.y)/Math.max(layout.field.h,1),-.08,.08);q.px=q.x;q.py=q.y;q.x=p.x;q.y=p.y;
    const n=soundFor(p);q.midi=n.midi;api.noteUpdate(`swarm-${p.id}`,n.midi,n.options);api.setStatus(`${api.noteName(n.midi)} · ${Math.round(n.options.cutoff)} Hz`);
  }}
  function up(p){const q=contacts.get(p.id);if(q){releases.push({...q,released:lastT});if(releases.length>16)releases.shift();api.noteOff(`swarm-${p.id}`);}contacts.delete(p.id);roles.delete(p.id);api.save();}
  function cancelTouch(p){(api.noteCancel||api.noteOff)(`swarm-${p.id}`);contacts.delete(p.id);roles.delete(p.id);for(let i=releases.length-1;i>=0;i--)if(releases[i].id===p.id)releases.splice(i,1);api.save();}
  function editGrid(p){const g=areas().grid,col=clamp(Math.floor((p.x-g.x)/g.w*16),0,15);steps[col]=clamp(7-Math.floor((p.y-g.y)/g.h*8),0,7);enabled[col]=true;api.save();}
  function editSlider(p,row){const box=areas().sliders,[,key,lo,hi]=channels[row],v=clamp((p.x-box.x-box.w*.28)/(box.w*.55),0,1);let value=row===0?Math.round(lo*Math.pow(hi/lo,v)):lerp(lo,hi,v);if(['translate','spread'].includes(key))value=Math.round(value);if(api.setSound)api.setSound({[key]:value});else{api.state.sound[key]=value;api.audio.configure(api.state.sound);api.save();}}
  function resetParticles(count){particles=Array.from({length:count},(_,i)=>{const x=hash(i+4),y=hash(i+219),angle=Math.atan2(y-.5,x-.5);return{x,y,vx:-Math.sin(angle)*.12,vy:Math.cos(angle)*.12,seed:hash(i+188),life:hash(i+5)};});}
  function drawMachine(t,snap,v){
    const b=layout,m=b.machine,{grid:g,sliders:box}=areas(),gold=css('#e4c45e',v.wireOpacity),step=clamp(snap.step||0,0,15),z=s();
    text(c,b.small?`SEQ ${String(step+1).padStart(2,'0')} / 16`:'PITCH / 16',m.x,m.y-12,'#f0d572',9);if(!b.small)text(c,`${String(step+1).padStart(2,'0')}   ${api.state.bpm} BPM`,m.x+m.w,m.y-12,'#bbb0f7',9,'right');
    c.save();
    const routeX=b.small?m.x+m.w-3:m.x+m.w+7;
    for(let row=0;row<8;row++){
      const y=g.y+g.h*(row+.5)/8,rx=routeX+row*2.5,by=b.bridgeY-18+row*3;
      c.strokeStyle=gold;c.lineWidth=.85;c.beginPath();c.moveTo(g.x-3,y);c.lineTo(rx-12,y);c.quadraticCurveTo(rx,y,rx,y+12);c.lineTo(rx,by-12);c.quadraticCurveTo(rx,by,rx+12,by);c.lineTo(b.bridgeX+b.right.w*.19,by);c.stroke();
      text(c,api.noteName(api.quantize(7-row)),g.x-10,y+3,'#c4b36b',8,'right');
      for(let i=0;i<8;i++){const x=g.x+(i+.5)*g.w/8;c.fillStyle=css('#e8cc77',.25);c.fillRect(x,y-1,1.4,2);}
    }
    for(let i=0;i<16;i++){
      const x=g.x+g.w*(i+.5)/16,y=g.y+g.h*(7-steps[i]+.5)/8,active=i===step&&api.state.playing;
      if(active){c.fillStyle=css('#aa94ff',.09);c.fillRect(g.x+g.w*i/16,g.y,g.w/16,g.h);}
      const glow=active?1:.48,length=active?18:7+hash(i*7)*11;
      c.shadowBlur=(active?22:11)*v.emission;c.shadowColor='#8b6eff';c.strokeStyle=enabled[i]?css('#baaaff',.7+glow*.3):'#3c3453';c.lineWidth=active?2.8:1.6;c.beginPath();c.moveTo(x-length,y);c.lineTo(x+3,y);c.stroke();c.fillStyle=enabled[i]?'#f5f0ff':'#50476d';c.beginPath();c.arc(x,y,active?3:2.1,0,TAU);c.fill();c.shadowBlur=0;
      if(i%4===0)text(c,String(i+1).padStart(2,'0'),x,g.y+g.h+16,'#a392ee',8,'center');
    }
    for(let i=0;i<channels.length;i++){
      const [name,key,lo,hi,unit]=channels[i],y=box.y+(i+.5)*box.h/channels.length,value=z[key],f=i===0?Math.log(value/lo)/Math.log(hi/lo):(value-lo)/(hi-lo),x=box.x+box.w*.28,end=box.x+box.w*.83,tip=lerp(x,end,clamp(f,0,1));
      text(c,m.w<260?name.replace('TRANSLATE','TRANS'):name,box.x,y+3,'#e9ce6f',b.small||m.w<300?7.4:9);
      c.strokeStyle=css('#d2b959',v.wireOpacity*.75);c.lineWidth=.65;c.beginPath();c.moveTo(x,y);c.lineTo(end+4,y);c.lineTo(end+12,y+8);c.lineTo(routeX-16+i*2,y+8);c.stroke();
      for(let j=0;j<14;j++){const tx=lerp(x,end,j/13);stroke(c,[[tx,y-3],[tx,y-1]],css('#d2b959',.28),.65);}
      c.shadowBlur=14*v.emission;c.shadowColor='#9275ff';stroke(c,[[x,y],[tip,y]],'#8975f4',4);stroke(c,[[x,y],[tip,y]],'#d9d0ff',1.3);c.shadowBlur=0;c.fillStyle='#eeebff';c.beginPath();c.arc(tip,y,2.5,0,TAU);c.fill();
      const valueText=key==='cutoff'?`${(value/1000).toFixed(1)}k`:unit==='s'?`${Math.round(value*1000)}ms`:['translate','spread'].includes(key)?`${value>0?'+':''}${value}`:value.toFixed(1);text(c,valueText,box.x+box.w,y+3,'#c8baf6',8.5,'right');
    }
    c.restore();
  }
  function drawFlow(t,dt,snap,v){
    const f=layout.field,z=s(),scale=v.fieldScale,count=Math.round(clamp(v.streakCount,600,7200));if(particles.length!==count)resetParticles(count);
    if(!layout.small){text(c,'X PITCH  ·  Y FILTER',f.x,f.y-12,'#e7e5ed',9);text(c,`${contacts.size} CONTACTS`,f.x+f.w,f.y-12,'#a79eb8',9,'right');}
    c.save();c.beginPath();c.rect(f.x,f.y,f.w,f.h);c.clip();
    for(const bucket of buckets)bucket.length=0;
    const sounding=new Map(snap.voices.map(voice=>[voice.id,voice])),held=api.state.hold?releases.filter(q=>!contacts.has(q.id)&&sounding.has(`swarm-${q.id}`)):[],screenScale=clamp(Math.sqrt(f.w*f.h/(550*520)),.43,1.12),active=[...contacts.values(),...held],energy=clamp(Math.sqrt(snap.rms||0)*2.6,0,1),timeStep=api.reducedMotion&&!active.length?0:Math.min(dt,.04),ambient=api.reducedMotion?0:t;
    const occupancy=new Uint16Array(64);for(const p of particles){const cell=clamp(Math.floor(p.x*8),0,7)+clamp(Math.floor(p.y*8),0,7)*8;occupancy[cell]++;}const average=count/64;
    const arrived=packets.filter(e=>snap.time>=e.when+e.travel&&snap.time<e.when+e.travel+2.7),impulses=arrived.map(e=>circuitWind(e,snap.time,v.windCoupling,arrived.length));for(const touch of active){const voice=sounding.get(`swarm-${touch.id}`);touch.flowForce=touchWindGain(voice?.level||0,touch.midi);}
    const centers=[[.46+Math.sin(ambient*.13)*.06,.48+Math.cos(ambient*.11)*.05,.14+energy*.04],[.72+Math.cos(ambient*.1)*.04,.26,-.044],[.26,.73+Math.sin(ambient*.09)*.05,-.035]];
    for(let i=0;i<particles.length;i++){
      const p=particles[i],dx=p.x-.5,dy=p.y-.5;let tx=0,ty=0;
      for(const [cx,cy,strength]of centers){const xx=p.x-cx,yy=p.y-cy,r2=xx*xx+yy*yy+.025;tx-=yy/r2*strength*v.curl;ty+=xx/r2*strength*v.curl;}
      tx+=Math.sin(p.y*19+ambient*.27)*.046+Math.sin((p.x+p.y)*31-ambient*.17)*.028-dx*.025*v.recovery;
      ty+=Math.cos(p.x*17-ambient*.23)*.046+Math.cos((p.y-p.x)*29+ambient*.19)*.028-dy*.025*v.recovery;
      for(const touch of active){const qx=(touch.x-f.x)/f.w,qy=(touch.y-f.y)/f.h,px=p.x-qx,py=p.y-qy,d=px*px+py*py+.01,k=v.disturbance*Math.exp(-d*10)*touch.flowForce;tx+=(-py*.15/d+touch.dx*14)*k;ty+=(px*.15/d+touch.dy*14)*k;}
      for(const impulse of impulses){const ex=(layout.bridgeX-f.x)/f.w+.08,ey=1.05,rx=p.x-ex,ry=p.y-ey,d=Math.hypot(rx,ry),strength=Math.exp(-(((d-impulse.front)/.22)**2))*impulse.force;tx+=(rx*.22-ry*.32)*(1+impulse.spread/24)*strength;ty+=(-.43+rx*.26)*strength;}
      const speed=Math.hypot(tx,ty),maxSpeed=.58+energy*.28;if(speed>maxSpeed){tx*=maxSpeed/speed;ty*=maxSpeed/speed;}
      const response=1-Math.exp(-timeStep*(3+(1-v.inertia)*30));p.vx=lerp(p.vx,tx,response);p.vy=lerp(p.vy,ty,response);p.x+=p.vx*timeStep;p.y+=p.vy*timeStep;
      p.life+=timeStep*(.14+energy*.12);const cell=clamp(Math.floor(p.x*8),0,7)+clamp(Math.floor(p.y*8),0,7)*8;if(p.x<-.025||p.x>1.025||p.y<-.025||p.y>1.025||p.life>1||(p.life>.55&&occupancy[cell]>average*2.1)){const seed=serial++*7+i;let destination=Math.floor(hash(seed+81)*64);for(let choice=1;choice<5;choice++){const candidate=Math.floor(hash(seed+choice*913)*64);if(occupancy[candidate]<occupancy[destination])destination=candidate;}p.x=((destination%8)+hash(seed+73))/8;p.y=(Math.floor(destination/8)+hash(seed+291))/8;occupancy[destination]++;p.life=0;p.vx*=.4;p.vy*=.4;}
      const x=f.x+f.w*(.5+(p.x-.5)*scale),y=f.y+f.h*(.5+(p.y-.5)*scale),vx=p.vx*f.w,vy=p.vy*f.h,magnitude=Math.max(1,Math.hypot(vx,vy)),ux=vx/magnitude,uy=vy/magnitude;
      const local=.55+.45*Math.sin(p.x*12+p.y*8+ambient*.16)*Math.cos(p.y*11-p.x*5),length=(2.5+p.seed**1.3*13)*v.streakLength*screenScale*(.75+energy*.35+local*.3),bend=Math.sin(p.seed*23+ambient*.2)*length*.24,fade=clamp(Math.min(p.x,1-p.x,p.y,1-p.y)*80,0,1),bucket=fade<.2||p.life<.025?0:i%37===0?6:1+Math.min(4,Math.floor((p.seed*.65+local*.35)*5));
      buckets[bucket].push(x-ux*length,y-uy*length,x-ux*length*.45-uy*bend,y-uy*length*.45+ux*bend,x,y);
    }
    const tones=['rgba(210,210,224,.22)','rgba(224,222,231,.43)','rgba(238,236,232,.66)','rgba(246,244,235,.81)','rgba(255,252,243,.93)','rgba(255,255,248,.99)','rgba(188,170,255,.86)'],weights=[.7,.75,1.05,1.4,1.75,2.1,1.1];
    for(let i=0;i<buckets.length;i++){const bucket=buckets[i];c.strokeStyle=tones[i];c.lineWidth=weights[i]*Math.max(.66,screenScale);c.lineCap='round';c.beginPath();for(let j=0;j<bucket.length;j+=6){c.moveTo(bucket[j],bucket[j+1]);c.quadraticCurveTo(bucket[j+2],bucket[j+3],bucket[j+4],bucket[j+5]);}c.stroke();}
    for(const touch of active){touch.dx*=Math.exp(-dt*9);touch.dy*=Math.exp(-dt*9);const voice=snap.voices.find(q=>q.id===`swarm-${touch.id}`),level=voice?.level||.45;drawContact(touch.x,touch.y,level,t-touch.started);text(c,api.noteName(touch.midi),touch.x+18,touch.y-16,'#eee9ff',10);}
    for(let i=releases.length-1;i>=0;i--){const q=releases[i],age=t-q.released,voice=snap.voices.find(x=>x.id===`swarm-${q.id}`),level=voice?.level||Math.max(0,1-age/s().release)*.3;if(age>5&&!voice){releases.splice(i,1);continue;}if(level>0)drawContact(q.x,q.y,level,age);}
    c.restore();
    const lowest=active.at(-1);if(layout.h>=480||layout.small)text(c,`${lowest?api.noteName(lowest.midi):'—'}  ·  ${Math.round(s().cutoff)} Hz  ·  ${api.state.hold?'HELD':'DIRECT'}`,f.x,f.y+f.h+16,'#c4bfcc',8.5);
    function drawContact(x,y,level,age){c.strokeStyle=css('#c1b1ff',.5+level*.5);c.lineWidth=1;c.beginPath();c.arc(x,y,9+level*12+Math.sin(age*4)*1.5,0,TAU);c.stroke();c.beginPath();c.moveTo(x-6,y);c.lineTo(x+6,y);c.moveTo(x,y-6);c.lineTo(x,y+6);c.stroke();}
  }
  function initBridge(){
    try{
      bridgeRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:true,powerPreference:'low-power'});bridgeRenderer.setClearColor(0,0);bridgeRenderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));bridgeRenderer.domElement.style.cssText='position:absolute;z-index:1;pointer-events:none;';host.append(bridgeRenderer.domElement);
      bridgeScene=new THREE.Scene();bridgeCamera=new THREE.PerspectiveCamera(35,1,.1,30);bridgeCamera.position.set(0,0,5.4);bridgeScene.add(new THREE.AmbientLight('#9c88ff',2.3));const light=new THREE.DirectionalLight('#f0ecff',4);light.position.set(-2,3,4);bridgeScene.add(light);const rim=new THREE.PointLight('#7264ff',8);rim.position.set(2,-1,2);bridgeScene.add(rim);
      const round=(shape,x,y,w,h,r)=>{shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);};
      const shape=new THREE.Shape();round(shape,-.64,-.64,1.28,1.28,.28);const hole=new THREE.Path();round(hole,-.32,-.32,.64,.64,.12);shape.holes.push(hole);
      const geometry=new THREE.ExtrudeGeometry(shape,{depth:.23,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.085,bevelThickness:.085,curveSegments:16});geometry.center();
      for(let i=0;i<2;i++){const group=new THREE.Group(),material=new THREE.MeshPhysicalMaterial({color:i?'#8773ce':'#ad9ae8',metalness:.05,roughness:.08,clearcoat:1,clearcoatRoughness:.03,transparent:true,opacity:.21,depthWrite:false,emissive:'#211343',emissiveIntensity:.16,side:THREE.DoubleSide});group.add(new THREE.Mesh(geometry,material));const fresnel=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{glow:{value:.72}},vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'uniform float glow;varying vec3 n;varying vec3 v;void main(){vec3 normal=normalize(n);float edge=pow(1.-abs(dot(normal,normalize(v))),1.6);float reflection=pow(abs(dot(normal,normalize(vec3(-.38,.68,.64)))),22.)*.85+pow(abs(dot(normal,normalize(vec3(.8,-.25,.54)))),32.)*.4;vec3 colour=mix(vec3(.43,.31,.84),vec3(.91,.96,1.),min(1.,edge*.75+reflection));gl_FragColor=vec4(colour,min(.88,edge*(.33+glow*.35)+reflection*.75));}'});group.add(new THREE.Mesh(geometry,fresnel));const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,24),new THREE.LineBasicMaterial({color:'#e1e3ff',transparent:true,opacity:.38,depthWrite:false}));group.add(edges);bridgeScene.add(group);bridges.push(group);}
    }catch{bridgeRenderer?.dispose();bridgeRenderer?.domElement.remove();bridgeRenderer=null;}
  }
  initBridge();
  function drawBridge(t,snap,v){
    const b=layout,y=b.bridgeY,m=b.machine,fx=b.field.x+b.field.w*.83,cx=b.bridgeX,z=s(),r=Math.max(13,Math.min(b.small?25:58,b.w*.044,b.h*.067))*v.bridgeScale,energyPackets=packets.filter(e=>snap.time>=e.when+e.travel&&snap.time<e.when+e.travel+2.7),pulse=energyPackets.reduce((sum,e)=>sum+Math.exp(-(snap.time-e.when-e.travel)*4),0);
    for(let j=0;j<4;j++){
      const yy=y-8+j*5,c1=css('#d4b85c',v.wireOpacity*(.5-j*.08));c.strokeStyle=c1;c.lineWidth=.8;c.beginPath();c.moveTo(m.x+12,b.small?m.y+m.h:y-60-j*8);c.lineTo(m.x+12,yy);c.bezierCurveTo(cx-r*2,yy,cx-r*2,yy+8,cx,yy+8);c.bezierCurveTo(cx+r*3,yy+8,fx-r,yy,fx,yy);c.stroke();
    }
    if(!bridgeRenderer)for(let j=0;j<2;j++){
      const x=cx+(j-.4)*r*1.7,yy=y+(j===0?-r*.2:r*.4),turn=(api.reducedMotion?0:t*.1*v.bridgeMotion)+j*.65+z.translate*.012,extent=j===1?.7+z.spread/24:1;
      c.save();c.translate(x,yy);c.rotate(turn);c.shadowBlur=18*v.emission;c.shadowColor='#9380ff';
      for(let layer=4;layer>=0;layer--){const rr=(r-layer*.9)*extent;c.strokeStyle=css('#a796ff',.16+layer*.09);c.lineWidth=1.3;c.beginPath();for(let i=0;i<=80;i++){const th=i/80*TAU,xx=Math.sign(Math.cos(th))*Math.pow(Math.abs(Math.cos(th)),.5)*rr,yyy=Math.sign(Math.sin(th))*Math.pow(Math.abs(Math.sin(th)),.5)*rr*.73;c[i?'lineTo':'moveTo'](xx+layer*1.2,yyy-layer*1.1);}c.stroke();}c.restore();
    }
    if(bridgeRenderer){
      const box={x:cx-r*2.8,y:y-r*1.8,w:r*5.8,h:r*3.6},el=bridgeRenderer.domElement;el.style.left=`${box.x}px`;el.style.top=`${box.y}px`;el.style.width=`${box.w}px`;el.style.height=`${box.h}px`;
      if(!bridgeBox||bridgeBox.w!==box.w||bridgeBox.h!==box.h){bridgeRenderer.setSize(box.w,box.h,false);bridgeCamera.aspect=box.w/box.h;bridgeCamera.updateProjectionMatrix();bridgeBox=box;}
      for(let j=0;j<2;j++){const group=bridges[j],motion=api.reducedMotion?0:Math.sin(t*.41+j)*.32*v.bridgeMotion;group.position.set(j?.66:-.55,j?-.23:.23,j?-.2:.15);group.rotation.set(.35+motion,(j?-.35:.35)+(api.reducedMotion?0:Math.sin(t*.28+j)*.45*v.bridgeMotion),(j?-.3:.35)+motion*.65+z.translate*.012);group.scale.setScalar((j?.78+z.spread/80:1)*(1+Math.min(.09,pulse*.045)));group.children[0].material.emissiveIntensity=.08+v.emission*.18;group.children[1].material.uniforms.glow.value=v.emission;}
      bridgeRenderer.render(bridgeScene,bridgeCamera);
    }
    text(c,b.small?`TR ${z.translate} st`:`TRANSLATE ${z.translate>0?'+':''}${z.translate} st`,cx-r*1.2,Math.min(b.h-8,y+r*1.58),'#b6a6ff',8,'center');text(c,b.small?`SP ${z.spread} st`:`SPREAD ${z.spread} st`,cx+r*1.3,Math.min(b.h-8,y+r*1.58),'#c5bed7',8,'center');
    const energy=clamp(snap.rms*8,0,1);c.save();c.shadowBlur=(12+energy*18)*v.emission;c.shadowColor='#d3d3ff';c.strokeStyle='#e1dfff';c.lineWidth=2;c.beginPath();c.ellipse(fx,y,Math.max(25,r*1.25),8+energy*3,-.16,0,TAU);c.stroke();c.restore();text(c,`${(snap.rms||0).toFixed(3)} RMS`,fx,Math.min(b.h-8,y+34),'#a6a1b4',9,'center');
    const wave=snap.waveform||[];if(wave.length){const start=cx+r*2.5,end=fx-r*1.4,points=[];for(let i=0;i<80;i++){const sample=wave[Math.floor(i/80*wave.length)]||0;points.push([lerp(start,end,i/79),y-3+sample*28]);}stroke(c,points,'#c0b5a4',.8);}
  }
  function packetRoute(e){const b=layout,m=b.machine,g=areas().grid,row=7-e.pitch,rx=m.x+m.w+7+row*2.5,by=b.bridgeY-18+row*3;return[[g.x+g.w*(e.step+.5)/16,g.y+g.h*(row+.5)/8],[rx,g.y+g.h*(row+.5)/8],[rx,by],[b.bridgeX,by],[b.bridgeX+b.right.w*.08,b.bridgeY]];}
  function drawPackets(snap,v){
    const now=snap.time;for(let i=packets.length-1;i>=0;i--){const e=packets[i],phase=circuitPacketPhase(e,now);if(now>e.when+e.travel+3){packets.splice(i,1);continue;}if(phase===null||phase>=1)continue;const path=packetRoute(e),head=pathPoint(path,phase),tail=pathPoint(path,Math.max(0,phase-.055));c.save();c.shadowBlur=18*v.emission;c.shadowColor='#9174ff';stroke(c,[tail,head],'#b5a5ff',3.4);c.fillStyle='#f6f5ff';c.beginPath();c.arc(head[0],head[1],2.6,0,TAU);c.fill();c.restore();}
    const z=s(),active=packets.filter(e=>now>=e.when+e.travel&&now<e.when+e.travel+1.6),origin=[layout.bridgeX+layout.right.w*.07,layout.bridgeY-8],f=layout.field;
    for(const e of active){const age=now-e.when-e.travel,fade=Math.exp(-age*2.1)*v.windCoupling;for(let lane=0;lane<5;lane++){const u=(age*.65+lane*.11)%1,spread=(lane-2)*(.07+e.spread*.003),p0=origin,p1=[f.x+f.w*.18,f.y+f.h*.8],p2=[f.x+f.w*(.42+spread),f.y+f.h*.35],p3=[f.x+f.w*(.6+spread),f.y+f.h*.12],p=bezierPoint(p0,p1,p2,p3,u),q=bezierPoint(p0,p1,p2,p3,Math.max(0,u-.035));stroke(c,[q,p],css('#c9bcff',fade*.6),1.5);}}
  }
  function drawPackages(v){if(layout.small)return;const m=layout.machine,y=m.y+m.h+49,x=m.x+12;for(let k=0;k<4;k++){const button=waveButtons[k].button,r=button.getBoundingClientRect(),base=host.getBoundingClientRect(),xx=r.x-base.x,yy=r.y-base.y;for(let pin=0;pin<8;pin++){const px=xx+5+pin*(r.width-10)/7;stroke(c,[[px,yy-4],[px,yy+1]],'#b9a251',1.2);stroke(c,[[px,yy+r.height-1],[px,yy+r.height+5]],'#b9a251',1.2);}c.fillStyle='#d8bc63';c.beginPath();c.arc(xx+5,yy+5,1.2,0,TAU);c.fill();stroke(c,[[xx+r.width*.5,yy+r.height+5],[xx+r.width*.5,layout.bridgeY-11+k*5],[layout.bridgeX,layout.bridgeY-11+k*5]],css('#cfb559',v.wireOpacity),.9);}text(c,'OSC → VCF → VCA',x,Math.min(layout.h-8,layout.bridgeY+42),'#9c8b55',8);}
  function cancel(){packets.length=0;for(const id of new Set([...contacts.keys(),...releases.map(q=>q.id)]))(api.noteCancel||api.noteOff)(`swarm-${id}`);contacts.clear();roles.clear();releases.length=0;}
  return{
    frame(t,dt){lastT=t;surface.resize();layout=bounds();const v=a(),snap=api.audio.snapshot();c.clearRect(0,0,layout.w,layout.h);c.fillStyle='#08090d';c.fillRect(0,0,layout.w,layout.h);drawMachine(t,snap,v);drawFlow(t,dt,snap,v);drawBridge(t,snap,v);drawPackets(snap,v);drawPackages(v);actions.style.left=`${layout.small?layout.w-142:layout.machine.x+12}px`;actions.style.top=`${layout.small?0:layout.machine.y+layout.machine.h+9}px`;waveActions.style.left=`${layout.machine.x+12}px`;waveActions.style.top=`${layout.small?layout.machine.y+layout.machine.h-5:layout.machine.y+layout.machine.h+49}px`;waveActions.style.display=layout.small?'none':'flex';waveActions.style.gap=layout.machine.w<260?'4px':'8px';for(const {button,wave}of waveButtons){button.style.padding=layout.machine.w<260?'6px 6px':'6px 11px';button.style.fontSize=layout.machine.w<260?'8px':'9px';const selected=wave==='fm'?s().index>0:s().waveform===wave&&s().index===0;button.style.borderColor=selected?'#c4b2ff':'#bfa64d';button.style.boxShadow=selected?'0 0 10px #8d69ff, inset 0 0 0 2px #241b49':'inset 0 0 0 2px #11100b';button.style.color=selected?'#eee8ff':'#e2c767';button.setAttribute('aria-pressed',String(selected));}},
    onStep(step,when){if(!enabled[step%16])return;const z=s(),note=api.quantize(steps[step%16])+z.translate;api.audio.pulse(`swarm-seq-${step}`,note,{...z,gain:.095,pan:Math.sin(step*.7)*.35},when,60/api.state.bpm*.35);packets.push({step:step%16,pitch:steps[step%16],note,when,travel:60/api.state.bpm*.85,cutoff:z.cutoff,resonance:z.resonance,spread:z.spread});if(packets.length>48)packets.shift();},
    setPlaying(playing){if(!playing){const now=api.audio.snapshot().time;for(let i=packets.length-1;i>=0;i--)if(packets[i].when>now)packets.splice(i,1);}},
    getData(){return{steps:[...steps],enabled:[...enabled]};},
    setData(data){if(Array.isArray(data?.steps)&&data.steps.length===16)steps=data.steps.map(v=>Math.round(clamp(number(v,2),0,7)));if(Array.isArray(data?.enabled)&&data.enabled.length===16)enabled=data.enabled.map(v=>v!==false);},
    cancel,
    destroy(){cancel();dispose?.();seedButton.removeEventListener('click',regenerate);clearButton.removeEventListener('click',clear);actions.remove();for(const {button,click}of waveButtons)button.removeEventListener('click',click);waveActions.remove();bridgeScene?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});bridgeRenderer?.dispose();bridgeRenderer?.forceContextLoss();bridgeRenderer?.domElement.remove();surface.destroy();}
  };
}
