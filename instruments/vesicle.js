import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line,seeded} from './kit.js';
import {splitLayout} from '../instrument-layout.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
import {VesicleRenderer} from './vesicle-renderer.js';
const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'vesicle',name:'Vesicle',commonSoundControls:false,keyboardNotes:true,
 theme:{bg:'#061825',fg:'#c5e4e9',accent:'#8adce8',muted:'#638fa4'},
 defaultSound:{waveform:'sine',attack:.006,decay:.23,sustain:.06,release:1.1,cutoff:4600,resonance:.7,gain:.55,ratio:2.01,index:.68,echo:.22,delayTime:.31,feedback:.25,glide:.06,detune:2,bubbleSize:1,bubbleRise:.52,bubbleInterval:'2'},
 defaultAppearance:{creatureColour:'#a3dce8',finColour:'#54b5e1',shellColour:'#75cbea',shellOpacity:.8,eggScale:1,floatMotion:1,bubbleOpacity:.8,bubbleGlow:.4,waterColour:'#0a3550',causticLight:.4,guideContrast:.8},
 soundControls:[
  range('bubbleSize','Bubble size',.55,1.5,.05,'Bubbles','Size of newly released bubbles. Larger bubbles sound a lower register.','×'),
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
 const surface=createSurface(host,{label:'Vesicle. Touch the egg to release a pitched bubble. Drag empty space around the egg to orbit. Touch the right water field to play bubbles; horizontal position selects pitch. The lower tracks control bubble size, resonance and decay.'});surface.canvas.style.cssText+='position:absolute;inset:0;z-index:2;';const c=surface.ctx,profile=signalRenderProfile(),gate=createFrameGate(60),contacts=new Map(),bubbles=[],pending=[],random=seeded(903),pose={yaw:-.18,pitch:.06};let time=0,last=0,serial=0,playing=false,currentDegree=7,lastNote=api.quantize(7),lastSize='',destroyed=false,clock=0,ambientClock=0;
 const look=()=>({...definition.defaultAppearance,...api.state.appearance});
 const layout=()=>splitLayout(surface.width,surface.height,api.state.appearance,{pad:8,gap:18,stackPortrait:true});
 const field=r=>({x:r.x+16,y:r.y+35,w:Math.max(1,r.w-32),h:Math.max(35,r.h*.64-35)});
 const tracks=r=>['bubbleSize','index','release'].map((key,i)=>({key,x:r.x+Math.min(80,r.w*.25),y:r.y+r.h*.77+i*r.h*.085,w:r.w-Math.min(80,r.w*.25)-48,h:Math.max(22,r.h*.075),min:[.55,0,.15][i],max:[1.5,3,3][i],name:['SIZE','RESONANCE','DECAY'][i]}));
 function resize(){const rect=surface.canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),d=renderPixelRatio(w,h,devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?850000:1500000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)){surface.canvas.width=Math.round(w*d);surface.canvas.height=Math.round(h*d);c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});const l=layout();renderer.resize({...l.left,y:l.left.y+20,h:Math.max(20,l.left.h-45)});}
 surface.resize=resize;resize();
 function addBubble(side,x,y,degree,size=api.state.sound.bubbleSize){const b={id:serial++,side,x,y,r:(.022+random()*.025)*size,vx:(random()-.5)*(side===0?.12:.018),vy:.06+api.state.sound.bubbleRise*.1,degree,age:0,life:7,pop:0,phase:random()*TAU};bubbles.push(b);if(bubbles.length>56)bubbles.shift();return b;}
 for(let i=0;i<16;i++){const b=addBubble(i<3?0:1,.08+random()*.84,.12+random()*.78,Math.round(random()*14),.65+random()*.45);b.age=random()*3;}
 function play(p,q){const {left,right}=layout(),r=q.side===0?left:field(right),x=clamp((p.x-r.x)/r.w),y=clamp((p.y-r.y)/r.h),degree=vesicleDegree(x,api.state.sound.bubbleSize),midi=api.quantize(degree),id='vesicle-touch-'+p.id;
  q.degree=degree;currentDegree=degree;lastNote=midi;const options={velocity:.55+clamp(p.pressure)*.18,pan:(x-.5)*.8};if(!q.sounding){q.sounding=true;api.noteOn(id,midi,options);}else api.noteUpdate(id,midi,options);
  if(time-(q.lastBubble??-10)>.13){addBubble(q.side,x,y,degree);q.lastBubble=time;}
 }
 function patchTrack(p,track){const value=lerp(track.min,track.max,clamp((p.x-track.x)/track.w));api.setSound({[track.key]:Math.round(value*100)/100});}
 const unbind=bindPointers(surface.canvas,{
  down(p){const {left,right}=layout(),inside=(r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h,track=tracks(right).find(r=>inside({x:r.x-75,y:r.y-r.h*.5,w:r.w+120,h:r.h}));if(track){contacts.set(p.id,{kind:'track',track});patchTrack(p,track);return;}
   const side=inside(left)?0:inside(field(right))?1:-1;if(side<0)return false;
   const r=side?field(right):left,near=Math.hypot((p.x-r.x-r.w/2)/(r.w*.36),(p.y-r.y-r.h/2)/(r.h*.43))<1;
   const q={kind:side===0&&!near?'orbit':'play',side,x:p.x,y:p.y,sounding:false};contacts.set(p.id,q);if(q.kind==='play'){
    const hit=bubbles.find(b=>{const br=b.side?field(right):left;return b.side===side&&!b.pop&&Math.hypot(p.x-br.x-b.x*br.w,p.y-br.y-b.y*br.h)<Math.max(14,b.r*Math.min(br.w,br.h)*1.7);});if(hit){hit.pop=.01;const xx=(hit.degree+Math.round((api.state.sound.bubbleSize-1)*5))/14;play({...p,x:r.x+xx*r.w},q);}else play(p,q);
   }
  },
  move(p){const q=contacts.get(p.id);if(!q)return;if(q.kind==='track')patchTrack(p,q.track);else if(q.kind==='orbit'){pose.yaw+=(p.x-q.x)*.008;pose.pitch+=(p.y-q.y)*.008;}else play(p,q);q.x=p.x;q.y=p.y;},
  up(p){const q=contacts.get(p.id);if(q?.sounding)api.noteOff('vesicle-touch-'+p.id);contacts.delete(p.id);api.save();},
  cancel(p){if(contacts.get(p.id)?.sounding)(api.noteCancel||api.noteOff)('vesicle-touch-'+p.id);contacts.delete(p.id);}
 });
 function drawBackground(v,t){const w=surface.width,h=surface.height,key=[w,h,surface.dpr,v.waterColour].join('|');if(key!==lastSize){lastSize=key;background.width=Math.round(w*surface.dpr);background.height=Math.round(h*surface.dpr);bc.setTransform(surface.dpr,0,0,surface.dpr,0,0);const g=bc.createLinearGradient(0,0,w,h);g.addColorStop(0,v.waterColour);g.addColorStop(.5,'#071c2d');g.addColorStop(1,'#020e1b');bc.fillStyle=g;bc.fillRect(0,0,w,h);const light=bc.createRadialGradient(w*.22,h*.04,0,w*.22,h*.04,h*.85);light.addColorStop(0,'#71c4df25');light.addColorStop(1,'#134a6200');bc.fillStyle=light;bc.fillRect(0,0,w,h);}
  c.save();c.globalCompositeOperation='screen';for(let i=0;i<5;i++){const x=w*(.09+i*.2)+Math.sin(t*.09+i)*w*.08;const g=c.createLinearGradient(x,0,x+w*.12,h);g.addColorStop(0,rgba('#85dfe7',v.causticLight*.04));g.addColorStop(.5,'#ffffff00');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.beginPath();c.moveTo(x,0);c.lineTo(x+w*.06,0);c.lineTo(x+w*.25,h);c.lineTo(x+w*.16,h);c.fill();}c.restore();
 }
 function bubble(b,v){const r=b.side?field(layout().right):layout().left,x=r.x+b.x*r.w,y=r.y+b.y*r.h,rad=b.r*Math.min(r.w,r.h),fade=clamp(1-b.age/b.life)*(b.pop?clamp(1-b.pop):1),pop=b.pop?1+b.pop*1.4:1;
  c.save();c.beginPath();c.rect(r.x,r.y+(b.side?0:25),r.w,r.h-(b.side?0:55));c.clip();c.strokeStyle=rgba(v.shellColour,v.bubbleOpacity*fade*.7);c.lineWidth=.8;if(v.bubbleGlow){c.shadowBlur=rad*.5*v.bubbleGlow;c.shadowColor=rgba(v.shellColour,fade*.35);}c.beginPath();c.arc(x,y,Math.max(2,rad)*pop,0,TAU);c.stroke();c.shadowBlur=0;c.strokeStyle=rgba('#d9fbff',fade*.8);c.lineWidth=Math.max(1,rad*.12);c.beginPath();c.arc(x-rad*.08,y-rad*.08,rad*.76,Math.PI*1.07,Math.PI*1.48);c.stroke();if(b.side&&rad>4){label(c,api.noteName(api.quantize(b.degree)),x+rad+5,y,rgba('#b8e5ee',fade*.54),8);}c.restore();
 }
 function drawControls(v,snap){const {left,right}=layout(),f=field(right),ink=rgba('#b8dae5',v.guideContrast),hot=v.shellColour;
  label(c,'VESICLE / 01',left.x+13,left.y+13,ink,10);label(c,'BUBBLE FIELD',right.x+16,right.y+13,ink,10);label(c,api.noteName(lastNote),left.x+14,left.y+left.h-12,'#c6edf2',12);label(c,renderer.ready?'3D / ORBIT':'2D / WEBGL UNAVAILABLE',left.x+left.w-14,left.y+left.h-12,ink,8,'right');
  c.strokeStyle=rgba(hot,v.guideContrast*.4);c.lineWidth=.7;c.strokeRect(f.x,f.y,f.w,f.h);for(let i=0;i<=7;i++){const x=f.x+i/7*f.w;line(c,[[x,f.y],[x,f.y+f.h]],rgba(hot,v.guideContrast*.14),.6);label(c,api.noteName(api.quantize(i*2)),x,f.y+f.h+13,ink,9,'center');}
  for(let i=1;i<=3;i++)line(c,[[f.x,f.y+f.h*i/4],[f.x+f.w,f.y+f.h*i/4]],rgba(hot,v.guideContrast*.13),.6);
  const bottom=f.y+f.h;for(let i=0;i<8;i++){const x=f.x+(i+.5)/8*f.w,active=playing&&Math.floor(snap.step/2)%8===i;c.fillStyle=rgba(hot,active?.65:.13);c.fillRect(x-3,bottom-4,6,3);}
  for(const q of tracks(right)){const value=api.state.sound[q.key],fraction=(value-q.min)/(q.max-q.min);label(c,q.name,right.x+16,q.y,ink,9);line(c,[[q.x,q.y],[q.x+q.w,q.y]],rgba(hot,.25),1);line(c,[[q.x,q.y],[q.x+fraction*q.w,q.y]],rgba(hot,.75),1.5);c.fillStyle='#b5e9ef';c.fillRect(q.x+fraction*q.w-2,q.y-5,4,10);label(c,value.toFixed(2)+(q.key==='release'?'s':''),right.x+right.w-12,q.y,ink,9,'right');}
  // Measured pressure ring; no autonomous sound is generated by this drawing.
  const level=clamp(snap.rms*8);c.strokeStyle=rgba(hot,.24+level*.45);c.lineWidth=1;c.beginPath();c.arc(left.x+left.w*.5,left.y+left.h*.5,Math.min(left.w,left.h)*(.39+level*.015),Math.PI*.8,Math.PI*1.1);c.stroke();
 }
 function fallback(v,t){const r=layout().left,x=r.x+r.w/2,y=r.y+r.h/2,rad=Math.min(r.w,r.h)*.3;c.strokeStyle=rgba(v.shellColour,.5);c.lineWidth=1;c.beginPath();c.ellipse(x,y,rad*.82,rad*1.14,0,0,TAU);c.stroke();c.fillStyle=v.creatureColour;c.beginPath();c.ellipse(x,y+rad*.1,rad*.23,rad*.36,Math.sin(t*.7)*.06,0,TAU);c.fill();c.beginPath();c.ellipse(x,y-rad*.25,rad*.38,rad*.3,0,0,TAU);c.fill();for(const side of[-1,1]){c.fillStyle='#0b2944';c.beginPath();c.ellipse(x+side*rad*.15,y-rad*.27,rad*.05,rad*.08,0,0,TAU);c.fill();}}
 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;dt=Math.min(.05,last?t-last:dt);last=t;time=t;resize();const v=look(),snap=api.audio.snapshot(),motion=api.reducedMotion?0:t;c.clearRect(0,0,surface.width,surface.height);drawBackground(v,motion);while(pending.length&&pending[0].when<=snap.time){const e=pending.shift();addBubble(0,.5+(random()-.5)*.03,.43,e.degree);addBubble(1,e.x,.94,e.degree);lastNote=api.quantize(e.degree);}
   for(const b of bubbles){b.age+=dt;if(b.pop)b.pop+=dt*2.8;else if(!api.reducedMotion){b.y-=dt*b.vy;b.x=clamp(b.x+b.vx*dt+Math.sin(t*.8+b.phase)*dt*.008,.02,.98);}if(b.y<.04&&!b.pop)b.pop=.01;}
   for(let i=bubbles.length-1;i>=0;i--)if(bubbles[i].age>bubbles[i].life||bubbles[i].pop>=1)bubbles.splice(i,1);
   ambientClock+=dt;if(ambientClock>1.1){ambientClock=0;addBubble(1,.08+random()*.84,.96,Math.round(random()*14),.65+random()*.45);}
   const level=clamp(snap.rms*7);renderer.draw(t,v,pose,level,api.reducedMotion);if(!renderer.ready)fallback(v,motion);for(const b of bubbles)bubble(b,v);drawControls(v,snap);api.setStatus(api.noteName(lastNote)+' · '+bubbles.length+' bubbles');
  },
  onStep(step,when){const interval=Number(api.state.sound.bubbleInterval)||2;if(step%interval)return;const degree=[0,4,7,9,5,2,8,6][clock++%8]+Math.round((1-api.state.sound.bubbleSize)*5),x=clamp(degree/14);api.audio.pulse('vesicle-seq-'+clock,api.quantize(degree),{...api.state.sound,velocity:.6,pan:(x-.5)*.7},when,.1);pending.push({when,degree,x});},
  setPlaying(value){playing=value;if(value)clock=0;else pending.length=0;},
  cancel(){for(const [id,q]of contacts)if(q.sounding)(api.noteCancel||api.noteOff)('vesicle-touch-'+id);contacts.clear();pending.length=0;},
  getData(){return{pose:{...pose},degree:currentDegree};},setData(data){if(data?.pose){pose.yaw=Number.isFinite(data.pose.yaw)?data.pose.yaw:-.18;pose.pitch=Number.isFinite(data.pose.pitch)?data.pose.pitch:.06;}if(Number.isFinite(data?.degree))currentDegree=clamp(Math.round(data.degree),-7,21);},
  destroy(){destroyed=true;unbind();for(const [id,q]of contacts)if(q.sounding)(api.noteCancel||api.noteOff)('vesicle-touch-'+id);contacts.clear();renderer.dispose();surface.destroy();background.remove();}
 };
}
