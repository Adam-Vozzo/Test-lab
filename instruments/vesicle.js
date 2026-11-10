import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line,seeded} from './kit.js';
import {splitLayout} from '../instrument-layout.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
import {VesicleRenderer} from './vesicle-renderer.js';
const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'vesicle',name:'Vesicle',commonSoundControls:false,keyboardNotes:true,
 theme:{bg:'#061825',fg:'#c5e4e9',accent:'#8adce8',muted:'#638fa4'},
 defaultSound:{waveform:'sine',attack:.006,decay:.23,sustain:.06,release:1.1,cutoff:4600,resonance:.7,gain:.55,ratio:2.01,index:.68,echo:.22,delayTime:.31,feedback:.25,glide:.06,detune:2,bubbleSize:1,bubbleRise:.52,bubbleInterval:'2',currentStrength:.45},
 defaultAppearance:{creatureColour:'#80bdc9',finColour:'#75a0cf',shellColour:'#75cbea',shellOpacity:.8,eggScale:1,floatMotion:1,bubbleOpacity:.8,bubbleGlow:.4,waterColour:'#0a3550',causticLight:.4,guideContrast:.8},
 soundControls:[
  range('bubbleSize','Bubble size',.55,1.5,.05,'Bubbles','Size of newly released bubbles. Larger bubbles sound a lower register.','×'),
  range('currentStrength','Current strength',0,1,.01,'Bubbles','Strength of the rotating current; changes bubble drift and stereo spread.'),
  range('bubbleRise','Bubble rise',.15,1,.05,'Bubbles','Rise speed of new bubbles; the sequencer stays locked to tempo.'),
  {key:'bubbleInterval',label:'Release interval',kind:'select',options:[['1','1/16'],['2','1/8'],['4','1/4'],['8','1/2']],section:'Bubbles',description:'Spacing of the bubbles released by Play.'},
  range('index','Water resonance',0,3,.05,'Voice','FM sidebands: from a rounded drop to a hollow liquid chirp.'),
  range('ratio','Partial ratio',.5,4,.01,'Voice','Frequency relationship of the liquid partials.','×'),
  range('cutoff','Low-pass cutoff',500,14000,50,'Voice','Brightness of bubble strikes.','Hz'),
  range('release','Bubble tail',.15,3,.05,'Voice','Time for each released bubble tone to fade.','s'),
  range('echo','Delay level',0,.45,.01,'Space','Level of the repeated underwater tones.'),
  range('delayTime','Delay time',.1,.7,.01,'Space','Time between repeated bubble tones.','s'),
  range('feedback','Delay feedback',0,.55,.01,'Space','Duration of the delay tail.')
 ],
 appearanceControls:[
  {key:'creatureColour',label:'Creature skin',kind:'color',section:'Creature',description:'Colour of the embryo body, head and tail.'},
  {key:'finColour',label:'Gill membranes',kind:'color',section:'Creature',description:'Colour of the translucent gill fans.'},
  range('floatMotion','Suspended movement',0,1.6,.05,'Creature','Amount of body drift, breathing, gill flutter and tail movement.'),
  {key:'shellColour',label:'Egg rim colour',kind:'color',section:'Egg',description:'Tint of the transparent egg and its reflected light.'},
  range('shellOpacity','Egg reflections',0,1,.05,'Egg','Strength of the Fresnel rim and reflections. Zero hides the membrane.'),
  range('eggScale','Egg scale',.65,1.15,.05,'Egg','Size of the egg and creature inside the left surface.','×'),
  range('bubbleOpacity','Bubble rim opacity',.2,1,.05,'Bubbles','Visibility of the drifting bubble rims and specular marks.'),
  range('bubbleGlow','Bubble light',0,1,.05,'Bubbles','Local light around each bubble, independent of audio level.'),
  {key:'waterColour',label:'Water colour',kind:'color',section:'Water',description:'Base colour of the water behind both playing surfaces.'},
  range('causticLight','Water reflections',0,1,.05,'Water','Strength of the slow caustic light crossing the background.'),
  range('guideContrast','Notation contrast',.1,1,.05,'Readouts','Opacity of the pitch guides, divisions and labels.')
 ]
};
export function vesicleDegree(x,size=1){return Math.round(clamp(x)*14)+Math.round((1-size)*5);}
export function mount(host,api){
 const background=document.createElement('canvas');background.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';host.append(background);const bc=background.getContext('2d');
 const renderer=new VesicleRenderer(host,{mobile:signalRenderProfile().mobile});
 const surface=createSurface(host,{label:'Vesicle. Touch the egg to release a pitched bubble. Drag empty space around the egg to orbit. Touch the right water field to play bubbles; horizontal position selects pitch and vertical position changes brightness. Swirl the current vortex, stretch the harmonic sac, or pull the echo bubbles outward to audition their sounds. Upper divisions change bubble release rate; lower bubble supports inflate/pinch gestures, the membrane stretches resonance, and dragging the wake changes decay.'});surface.canvas.style.cssText+='position:absolute;inset:0;z-index:2;';const c=surface.ctx,profile=signalRenderProfile(),gate=createFrameGate(60),contacts=new Map(),bubbles=[],pending=[],random=seeded(903),pose={yaw:-.18,pitch:.06};let time=0,last=0,serial=0,playing=false,currentDegree=7,lastNote=api.quantize(7),lastSize='',destroyed=false,clock=0,ambientClock=0,current={x:.5,y:.5},dragLight=0;
 const look=()=>({...definition.defaultAppearance,...api.state.appearance});
 const layout=()=>splitLayout(surface.width,surface.height,api.state.appearance,{pad:8,gap:18,stackPortrait:true});
 const field=r=>({x:r.x+16,y:r.y+57,w:Math.max(1,r.w-32),h:Math.max(35,r.h*.88-57)});
 const nodes=r=>['currentStrength','ratio','echo'].map((key,i)=>({key,x:r.x+r.w*[.20,.77,.84][i],y:r.y+r.h*[.35,.27,.60][i],r:Math.max(20,Math.min(r.w*.1,r.h*.085)),min:[0,.5,0][i],max:[1,4,.45][i],name:['CURRENT','HARMONICS','ECHO'][i]}));
 const modeButtons=r=>['1','2','4','8'].map((value,i)=>({value,x:r.x+20+i*(r.w-40)/4,y:r.y+26,w:(r.w-48)/4,h:24}));
 const specimens=r=>['bubbleSize','index','release'].map((key,i)=>({key,x:r.x+r.w*[.19,.52,.64][i],y:r.y+r.h*[.80,.60,.90][i],r:Math.min(r.w*[.12,.18,.12][i],r.h*[.08,.12,.065][i]),w:r.w*[.30,.39,.60][i],h:r.h*[.20,.27,.17][i],min:[.55,0,.15][i],max:[1.5,3,3][i],name:['INFLATE','STRETCH','DISSIPATE'][i]}));
 function resize(){const rect=surface.canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),d=renderPixelRatio(w,h,devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?850000:1500000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)){surface.canvas.width=Math.round(w*d);surface.canvas.height=Math.round(h*d);c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});const l=layout();renderer.resize({...l.left,y:l.left.y+20,h:Math.max(20,l.left.h-45)});}
 surface.resize=resize;resize();
 function addBubble(side,x,y,degree,size=api.state.sound.bubbleSize){const b={id:serial++,side,x,y,r:(.022+random()*.025)*size,vx:(random()-.5)*(side===0?.12:.018),vy:.06+api.state.sound.bubbleRise*.1,degree,age:0,life:7,pop:0,phase:random()*TAU};bubbles.push(b);if(bubbles.length>56)bubbles.shift();return b;}
 for(let i=0;i<16;i++){const b=addBubble(i<3?0:1,.08+random()*.84,.12+random()*.78,Math.round(random()*14),.65+random()*.45);b.age=random()*3;}
 function play(p,q){const {left,right}=layout(),r=q.side===0?left:field(right),x=clamp((p.x-r.x)/r.w),y=clamp((p.y-r.y)/r.h),degree=vesicleDegree(x,api.state.sound.bubbleSize),midi=api.quantize(degree),id='vesicle-touch-'+p.id;
  q.degree=degree;currentDegree=degree;lastNote=midi;dragLight=1;if(q.side===1){current={x,y};api.setSound({cutoff:Math.round(900+Math.pow(1-y,1.5)*11000)});}const options={velocity:.42+clamp(p.pressure)*.2,pan:(x-.5)*(.3+api.state.sound.currentStrength*.7),index:api.state.sound.index*(.6+y*.8)};if(!q.sounding){q.sounding=true;api.noteOn(id,midi,options);}else api.noteUpdate(id,midi,options);
  if(time-(q.lastBubble??-10)>.13){addBubble(q.side,x,y,degree);q.lastBubble=time;}
 }
 function shapeGesture(p,q){const o=q.organ,dx=p.x-q.startX,dy=p.y-q.startY;let fraction=(q.startValue-o.min)/(o.max-o.min);
  if(o.key==='bubbleSize'){const pair=[...contacts.values()].find(v=>v!==q&&v.kind==='specimen'&&v.organ.key===o.key);if(pair){const distance=Math.hypot(p.x-pair.x,p.y-pair.y);q.pinchStart??=distance;q.pinchValue??=fraction;fraction=q.pinchValue+(distance-q.pinchStart)/(o.r*3);}else fraction+=(dx-dy)/(o.r*3);}
  else if(o.key==='index')fraction+=(Math.abs(p.x-o.x)-Math.abs(q.startX-o.x)-dy*.5)/(o.r*2);
  else fraction+=dx/(o.w*.8);
  api.setSound({[o.key]:lerp(o.min,o.max,clamp(fraction))});api.noteUpdate('vesicle-touch-'+p.id,api.quantize(currentDegree),{velocity:.5});dragLight=1;q.x=p.x;q.y=p.y;
 }
 const unbind=bindPointers(surface.canvas,{
  down(p){const {left,right}=layout(),node=nodes(right).find(n=>Math.hypot(p.x-n.x,p.y-n.y)<n.r+8);if(node){contacts.set(p.id,{kind:'node',node,startY:p.y,startX:p.x,startAngle:Math.atan2(p.y-node.y,p.x-node.x),startRadius:Math.hypot(p.x-node.x,p.y-node.y),startValue:api.state.sound[node.key],sounding:true});api.noteOn('vesicle-touch-'+p.id,api.quantize(currentDegree),{velocity:.5});dragLight=1;return;}const mode=modeButtons(right).find(b=>p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h);if(mode){api.setSound({bubbleInterval:mode.value});return;}const inside=(r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h,organ=specimens(right).find(o=>inside({x:o.x-o.w/2,y:o.y-o.h/2,w:o.w,h:o.h}));if(organ){contacts.set(p.id,{kind:'specimen',organ,startX:p.x,startY:p.y,x:p.x,y:p.y,startValue:api.state.sound[organ.key],sounding:true});api.noteOn('vesicle-touch-'+p.id,api.quantize(currentDegree),{velocity:.55});dragLight=1;return;}
   const side=inside(left)?0:inside(field(right))?1:-1;if(side<0)return false;
   const r=side?field(right):left,near=Math.hypot((p.x-r.x-r.w/2)/(r.w*.36),(p.y-r.y-r.h/2)/(r.h*.43))<1;
   const q={kind:side===0&&!near?'orbit':'play',side,x:p.x,y:p.y,sounding:false};contacts.set(p.id,q);if(q.kind==='play'){
    const hit=bubbles.find(b=>{const br=b.side?field(right):left;return b.side===side&&!b.pop&&Math.hypot(p.x-br.x-b.x*br.w,p.y-br.y-b.y*br.h)<Math.max(14,b.r*Math.min(br.w,br.h)*1.7);});if(hit){hit.pop=.01;const xx=(hit.degree+Math.round((api.state.sound.bubbleSize-1)*5))/14;play({...p,x:r.x+xx*r.w},q);}else play(p,q);
   }
  },
  move(p){const q=contacts.get(p.id);if(!q)return;if(q.kind==='node'){let delta=(q.startY-p.y)/100;if(q.node.key==='currentStrength'){const a=Math.atan2(p.y-q.node.y,p.x-q.node.x)-q.startAngle;delta=Math.atan2(Math.sin(a),Math.cos(a))/Math.PI;}else if(q.node.key==='echo')delta=(Math.hypot(p.x-q.node.x,p.y-q.node.y)-q.startRadius)/(q.node.r*2);else delta=(p.x-q.startX+q.startY-p.y)/(q.node.r*4);api.setSound({[q.node.key]:lerp(q.node.min,q.node.max,clamp((q.startValue-q.node.min)/(q.node.max-q.node.min)+delta))});api.noteUpdate('vesicle-touch-'+p.id,api.quantize(currentDegree),{velocity:.5});dragLight=1;}else if(q.kind==='specimen')shapeGesture(p,q);else if(q.kind==='orbit'){pose.yaw+=(p.x-q.x)*.008;pose.pitch+=(p.y-q.y)*.008;}else play(p,q);q.x=p.x;q.y=p.y;},
  up(p){const q=contacts.get(p.id);if(q?.sounding)api.noteOff('vesicle-touch-'+p.id);contacts.delete(p.id);for(const other of contacts.values())if(other.kind==='specimen'){other.startValue=api.state.sound[other.organ.key];other.startX=other.x;other.startY=other.y;delete other.pinchStart;delete other.pinchValue;}api.save();},
  cancel(p){if(contacts.get(p.id)?.sounding)(api.noteCancel||api.noteOff)('vesicle-touch-'+p.id);contacts.delete(p.id);}
 });
 function drawBackground(v,t){const w=surface.width,h=surface.height,key=[w,h,surface.dpr,v.waterColour].join('|');if(key!==lastSize){lastSize=key;background.width=Math.round(w*surface.dpr);background.height=Math.round(h*surface.dpr);bc.setTransform(surface.dpr,0,0,surface.dpr,0,0);const g=bc.createLinearGradient(0,0,w,h);g.addColorStop(0,v.waterColour);g.addColorStop(.5,'#071c2d');g.addColorStop(1,'#020e1b');bc.fillStyle=g;bc.fillRect(0,0,w,h);const light=bc.createRadialGradient(w*.22,h*.04,0,w*.22,h*.04,h*.85);light.addColorStop(0,'#71c4df25');light.addColorStop(1,'#134a6200');bc.fillStyle=light;bc.fillRect(0,0,w,h);}
  c.save();c.globalCompositeOperation='screen';for(let i=0;i<5;i++){const x=w*(.09+i*.2)+Math.sin(t*.09+i)*w*.08;const g=c.createLinearGradient(x,0,x+w*.12,h);g.addColorStop(0,rgba('#85dfe7',v.causticLight*.04));g.addColorStop(.5,'#ffffff00');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.beginPath();c.moveTo(x,0);c.lineTo(x+w*.06,0);c.lineTo(x+w*.25,h);c.lineTo(x+w*.16,h);c.fill();}c.restore();
 }
 function bubble(b,v){const r=b.side?field(layout().right):layout().left,x=r.x+b.x*r.w,y=r.y+b.y*r.h,rad=b.r*Math.min(r.w,r.h),fade=clamp(1-b.age/b.life)*(b.pop?clamp(1-b.pop):1),pop=b.pop?1+b.pop*1.4:1;
  c.save();c.beginPath();c.rect(r.x,r.y+(b.side?0:25),r.w,r.h-(b.side?0:55));c.clip();c.strokeStyle=rgba(v.shellColour,v.bubbleOpacity*fade*.7);c.lineWidth=.8;if(v.bubbleGlow){c.shadowBlur=rad*.5*v.bubbleGlow;c.shadowColor=rgba(v.shellColour,fade*.35);}c.beginPath();c.arc(x,y,Math.max(2,rad)*pop,0,TAU);c.stroke();c.shadowBlur=0;c.strokeStyle=rgba('#d9fbff',fade*.8);c.lineWidth=Math.max(1,rad*.12);c.beginPath();c.arc(x-rad*.08,y-rad*.08,rad*.76,Math.PI*1.07,Math.PI*1.48);c.stroke();if(b.side&&rad>4){label(c,api.noteName(api.quantize(b.degree)),x+rad+5,y,rgba('#b8e5ee',fade*.54),8);}c.restore();
 }
 function drawControls(v,snap){
  const {left,right}=layout(),f=field(right),ink=rgba('#c7e9e8',v.guideContrast),hot=v.shellColour,level=clamp(snap.rms*8),clock=api.reducedMotion?0:time,cx=f.x+current.x*f.w,cy=f.y+current.y*f.h;
  label(c,'VESICLE / CULTURE 01',left.x+13,left.y+13,ink,9);label(c,'CURRENT / RESONANCE',right.x+16,right.y+13,ink,9);label(c,api.noteName(lastNote),left.x+14,left.y+left.h-12,'#c6edf2',12);label(c,renderer.ready?'MEMBRANE · TOUCH / ORBIT':'2D / WEBGL UNAVAILABLE',left.x+left.w-14,left.y+left.h-12,ink,8,'right');
  for(const b of modeButtons(right)){const active=api.state.sound.bubbleInterval===b.value;c.strokeStyle=rgba(hot,active?.65:.18);c.fillStyle=rgba(hot,active?.12:.025);c.beginPath();c.roundRect(b.x,b.y,b.w,b.h,12);c.fill();c.stroke();label(c,'1/'+(16/Number(b.value)),b.x+b.w/2,b.y+12,ink,9,'center');}
  // Curved laminar filaments connect the playable water column to three resonant organs.
  c.save();c.beginPath();c.rect(f.x,f.y,f.w,f.h+12);c.clip();
  for(let i=0;i<27;i++){const phase=i*.29,base=f.x+(i+.5)/27*f.w;c.beginPath();for(let k=0;k<=45;k++){const u=k/45,yy=f.y+f.h*u,force=Math.exp(-Math.pow((yy-cy)/Math.max(25,f.h*.4),2)),xx=base+Math.sin(u*6+phase+clock*.3)*(8+api.state.sound.currentStrength*18)+(cx-(f.x+f.w*.5))*force*.15;if(k)c.lineTo(xx,yy);else c.moveTo(xx,yy);}c.strokeStyle=rgba(i%5?'#598ca1':'#a5f3cf',.07+(i%5===0?.12:0)+level*.15);c.lineWidth=i%5?.6:1;c.stroke();}
  for(let i=0;i<5;i++){c.strokeStyle=rgba(hot,.055+level*.04);c.beginPath();c.ellipse(f.x+f.w/2,f.y+f.h*.5,f.w*(.48-i*.035),f.h*(.46-i*.025),Math.sin(clock*.12)*.05,0,TAU);c.stroke();}
  c.restore();
  c.save();c.translate(cx,cy);c.rotate(clock*.18*(api.reducedMotion?0:1));for(let i=0;i<3;i++){c.strokeStyle=rgba('#b7ffe0',.25+dragLight*.5);c.lineWidth=1;c.beginPath();c.arc(0,0,10+i*5,i*2.1,i*2.1+1.3);c.stroke();}c.restore();
  label(c,'PITCH →',f.x+3,f.y+f.h+7,ink,8);label(c,Math.round(api.state.sound.cutoff)+' Hz',f.x+f.w-3,f.y+f.h+7,ink,8,'right');
  for(const n of nodes(right)){
   const value=api.state.sound[n.key],fraction=clamp((value-n.min)/(n.max-n.min)),held=[...contacts.values()].some(q=>q.kind==='node'&&q.node.key===n.key),shine=held?.8:level*.5;
   c.save();c.translate(n.x,n.y);
   if(n.key==='currentStrength'){
    for(let k=0;k<7;k++){c.beginPath();for(let j=0;j<=80;j++){const u=j/80,a=u*TAU*(1.2+fraction)+k/7*TAU-clock*(.3+fraction),r=n.r*u*(.6+fraction*.5),x=Math.cos(a)*r,y=Math.sin(a)*r*.75;if(j)c.lineTo(x,y);else c.moveTo(x,y);}c.strokeStyle=rgba(k%2?'#8ac9d8':'#d0ffe3',.18+shine*.3);c.lineWidth=k%2?.7:1;c.stroke();}
   }else if(n.key==='ratio'){
    for(let k=0;k<11;k++){c.beginPath();for(let j=0;j<=64;j++){const a=j/64*TAU,r=n.r*(.6+.14*Math.sin(a*value+k*.55+clock*.3));const x=Math.cos(a)*r,y=Math.sin(a)*r*(.45+fraction*.4);if(j)c.lineTo(x,y);else c.moveTo(x,y);}c.strokeStyle=rgba(k%3?'#8abfcf':'#d3bbed',.13+shine*.3);c.stroke();}for(let k=0;k<4;k++){const a=clock*.35+k*1.57;c.fillStyle=rgba('#cfffe4',.55);c.beginPath();c.arc(Math.cos(a)*n.r*.57,Math.sin(a)*n.r*.35,2,0,TAU);c.fill();}
   }else{
    for(let k=7;k>=0;k--){const f=k/7,x=Math.sin(f*2.3)*n.r*(.3+fraction*1.5),y=-f*n.r*(.5+fraction),r=n.r*(.36-f*.21);c.strokeStyle=rgba('#b1e2d9',(1-f)*(.42+shine*.3));c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();c.beginPath();c.arc(x-r*.07,y-r*.08,r*.72,3.6,4.5);c.stroke();}
   }
   label(c,n.name,0,n.r+11,rgba('#b8ddde',.7),8,'center');label(c,value.toFixed(2),0,n.r+22,rgba(hot,.55),8,'center');c.restore();
  }
  // Directly manipulated biological resonators replace conventional slider tracks.
  for(const o of specimens(right)){
   const value=api.state.sound[o.key],fraction=clamp((value-o.min)/(o.max-o.min)),held=[...contacts.values()].find(q=>q.kind==='specimen'&&q.organ.key===o.key),pulse=held?.65:level*.4;
   label(c,o.name,o.x,o.y-o.r-10,rgba('#bdeae2',.7),8,'center');c.save();c.translate(o.x,o.y);
   if(o.key==='bubbleSize'){
    const radius=o.r*(.48+fraction*.55),g=c.createRadialGradient(-radius*.3,-radius*.4,0,0,0,radius);g.addColorStop(0,rgba('#9cf7dc',.06+pulse*.12));g.addColorStop(.77,'#12364a08');g.addColorStop(.94,rgba('#6cbbdd',.24+pulse*.15));g.addColorStop(1,'#b7ffe668');c.fillStyle=g;c.beginPath();c.arc(0,0,radius,0,TAU);c.fill();c.strokeStyle=rgba('#b3fff1',.5);c.lineWidth=1;c.stroke();c.strokeStyle='#d0fff0';c.lineWidth=1.5;c.beginPath();c.arc(-radius*.08,-radius*.08,radius*.76,3.45,4.5);c.stroke();for(let k=0;k<3;k++){c.strokeStyle=rgba(hot,.1+fraction*.1);c.beginPath();c.arc(0,0,radius+4+k*3,clock*.3+k,clock*.3+k+1.8);c.stroke();}
    label(c,value.toFixed(2)+'×',0,radius*.2,ink,8,'center');
   }else if(o.key==='index'){
    const stretch=held?(held.x-o.x)/o.r:0,wide=o.r*(.66+fraction*.48),g=c.createLinearGradient(0,-o.r,0,o.r);g.addColorStop(0,rgba('#c6dfff',.4+pulse*.2));g.addColorStop(.6,rgba('#4aa7a8',.1));g.addColorStop(1,'#67bfa000');c.fillStyle=g;c.strokeStyle=rgba('#a9dbf5',.65);c.beginPath();for(let k=0;k<=36;k++){const a=k/36*Math.PI,xx=Math.cos(a)*wide,yy=-Math.sin(a)*o.r*.65+Math.sin(a*5+clock*1.2)*fraction*o.r*.06;if(k)c.lineTo(xx,yy);else c.moveTo(xx,yy);}for(let k=0;k<=24;k++){const x=-wide+k/24*wide*2;c.lineTo(x,Math.sin(k/24*Math.PI*4+clock)*o.r*.08);}c.closePath();c.fill();c.stroke();for(let k=0;k<9;k++){const x=(k/8-.5)*wide*1.65;c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x+Math.sin(clock*1.5+k)*o.r*.13,o.r*.3,x+stretch*o.r*.12,o.r*.5,x+Math.sin(time+k)*o.r*.11,o.r*(.35+.25*Math.sin(k*1.7)**2));c.strokeStyle=rgba(k%2?hot:'#e0e5ff',.35+fraction*.25);c.stroke();}
    label(c,value.toFixed(2),0,o.r*.9,ink,8,'center');
   }else{
    const length=o.w*(.18+fraction*.6),start=-o.w*.33;for(let k=30;k>=0;k--){const f=k/30,x=start+f*length,y=Math.sin(f*8-clock*2)*Math.sin(f*Math.PI)*o.r*.24;const a=(1-f)*(.5+pulse*.4);c.fillStyle=rgba(k%4?'#76d6d8':'#e6fae0',a);c.beginPath();c.arc(x,y,Math.max(.6,(1-f)*o.r*.18),0,TAU);c.fill();if(k%7===0){c.strokeStyle=rgba(hot,a*.3);c.beginPath();c.ellipse(x,y,o.r*(.15+f*.7),o.r*(.35+f*.4),0,-1.3,1.3);c.stroke();}}
    c.strokeStyle=rgba('#d3fff1',.8);c.beginPath();c.arc(start,0,o.r*.28,0,TAU);c.stroke();label(c,value.toFixed(2)+'s',0,o.r*.9,ink,8,'center');
   }c.restore();
  }
  // Contour fragments measure the living membrane, without boxing in the animal.
  const ex=left.x+left.w*.5,ey=left.y+left.h*.5,rx=Math.min(left.w,left.h)*.42;
  c.strokeStyle=rgba(hot,.18);for(let i=0;i<3;i++){c.beginPath();c.ellipse(ex,ey,rx+i*4,rx*1.25+i*4,0,-.3+i*2.1,.1+i*2.1);c.stroke();}
 }
 function fallback(v,t){const r=layout().left,x=r.x+r.w/2,y=r.y+r.h/2,rad=Math.min(r.w,r.h)*.3;c.strokeStyle=rgba(v.shellColour,.5);c.lineWidth=1;c.beginPath();c.ellipse(x,y,rad*.82,rad*1.14,0,0,TAU);c.stroke();c.fillStyle=v.creatureColour;c.beginPath();c.ellipse(x,y+rad*.1,rad*.23,rad*.36,Math.sin(t*.7)*.06,0,TAU);c.fill();c.beginPath();c.ellipse(x,y-rad*.25,rad*.38,rad*.3,0,0,TAU);c.fill();for(const side of[-1,1]){c.fillStyle='#0b2944';c.beginPath();c.ellipse(x+side*rad*.15,y-rad*.27,rad*.05,rad*.08,0,0,TAU);c.fill();}}
 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;dt=Math.min(.05,last?t-last:dt);last=t;time=t;resize();const v=look(),snap=api.audio.snapshot(),motion=api.reducedMotion?0:t;c.clearRect(0,0,surface.width,surface.height);drawBackground(v,motion);while(pending.length&&pending[0].when<=snap.time){const e=pending.shift();dragLight=.65;addBubble(0,.5+(random()-.5)*.03,.43,e.degree);addBubble(1,e.x,.94,e.degree);lastNote=api.quantize(e.degree);}
   for(const b of bubbles){b.age+=dt;if(b.pop)b.pop+=dt*2.8;else if(!api.reducedMotion){b.y-=dt*b.vy;b.x=clamp(b.x+b.vx*dt+Math.sin(t*.8+b.phase)*dt*(.008+api.state.sound.currentStrength*.03)+(b.side?(current.x-b.x)*dt*api.state.sound.currentStrength*.2:0),.02,.98);}if(b.y<.04&&!b.pop)b.pop=.01;}
   for(let i=bubbles.length-1;i>=0;i--)if(bubbles[i].age>bubbles[i].life||bubbles[i].pop>=1)bubbles.splice(i,1);
   ambientClock+=dt;if(ambientClock>1.1){ambientClock=0;addBubble(1,.08+random()*.84,.96,Math.round(random()*14),.65+random()*.45);}
   dragLight*=Math.exp(-dt*2);const level=clamp(snap.rms*7);renderer.draw(t,v,pose,Math.max(level,dragLight*.35),api.reducedMotion);if(!renderer.ready)fallback(v,motion);for(const b of bubbles)bubble(b,v);drawControls(v,snap);api.setStatus(api.noteName(lastNote)+' · '+bubbles.length+' bubbles');
  },
  onStep(step,when){const interval=Number(api.state.sound.bubbleInterval)||2;if(step%interval)return;const degree=[0,4,7,9,5,2,8,6][clock++%8]+Math.round((1-api.state.sound.bubbleSize)*5),x=clamp(degree/14);api.audio.pulse('vesicle-seq-'+clock,api.quantize(degree),{...api.state.sound,velocity:.6,pan:(x-.5)*(.3+api.state.sound.currentStrength*.7)},when,.1);pending.push({when,degree,x});},
  setPlaying(value){playing=value;if(value)clock=0;else pending.length=0;},
  cancel(){for(const [id,q]of contacts)if(q.sounding)(api.noteCancel||api.noteOff)('vesicle-touch-'+id);contacts.clear();pending.length=0;},
  getData(){return{pose:{...pose},degree:currentDegree,current:{...current}};},setData(data){if(data?.current)current={x:clamp(data.current.x),y:clamp(data.current.y)};if(data?.pose){pose.yaw=Number.isFinite(data.pose.yaw)?data.pose.yaw:-.18;pose.pitch=Number.isFinite(data.pose.pitch)?data.pose.pitch:.06;}if(Number.isFinite(data?.degree))currentDegree=clamp(Math.round(data.degree),-7,21);},
  destroy(){destroyed=true;unbind();for(const [id,q]of contacts)if(q.sounding)(api.noteCancel||api.noteOff)('vesicle-touch-'+id);contacts.clear();renderer.dispose();surface.destroy();background.remove();}
 };
}
