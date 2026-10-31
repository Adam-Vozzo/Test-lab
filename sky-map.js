const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const noteName=m=>names[((m%12)+12)%12]+(Math.floor(m/12)-1);
const landmarks=[
 [.12,.29,'Fundamental'],[.37,.15,'Round'],[.55,.10,'Triangle'],[.73,.19,'Overtones'],
 [.10,.48,'Warm'],[.29,.34,'Mellow'],[.62,.27,'Pulse'],[.80,.35,'Glass'],
 [.07,.66,'Low tide'],[.39,.45,'Soft edge'],[.52,.35,'Body'],[.68,.48,'Brass'],[.84,.55,'Bright'],
 [.28,.58,'Sine'],[.43,.68,'Wood'],[.59,.59,'Pluck'],[.76,.69,'Sawtooth'],
 [.14,.83,'Sub'],[.30,.78,'Hollow'],[.52,.81,'Reed'],[.67,.78,'Resonant'],[.87,.85,'Air'],
 [.40,.91,'Low pass'],[.61,.91,'Harmonics'],[.78,.95,'Edge']
];
const rgba=(hex,a)=>{const n=parseInt(hex.replace('#',''),16);return`rgba(${n>>16},${n>>8&255},${n&255},${a})`;};

/** A timbre map: position is filter cutoff/resonance; yellow labels are real voices. */
export function drawSkyMap(c,w,h,{state,palette:p,activity:a,time}){
 c.clearRect(0,0,w,h);
 const v=state.visual,small=w<290,short=h<125,fs=Math.min(short?9:13,clamp(w/44,small?8:10,13))*v.labelScale;
 const x=clamp(Math.log(state.sound.cutoff/20)/Math.log(1000),0,1)*w;
 const y=(1-clamp((state.sound.resonance-.1)/11.9,0,1))*h;
 const ink=p.fg,grid=clamp(v.gridOpacity,0,.8),weight=v.gridWeight;
 c.save();c.beginPath();c.rect(0,0,w,h);c.clip();
 c.strokeStyle=rgba(ink,.75*grid+.15);c.lineWidth=1.1*weight;c.strokeRect(.6,.6,w-1.2,h-1.2);
 // The colored directions make the parameter hub legible even under the shared field.
 const rays=[{tx:0,ty:y,color:'#ff636b'},{tx:w,ty:y,color:'#80df9b'},{tx:x,ty:0,color:'#e6ce72'},{tx:x,ty:h,color:'#718dff'},
 {tx:w*.25,ty:0,color:'#e8d774'},{tx:w*.48,ty:0,color:'#fa8b8b'},{tx:w*.76,ty:0,color:'#9eaded'},{tx:0,ty:h*.32,color:'#7b92ed'},{tx:w,ty:h*.3,color:'#e0ce79'},{tx:w*.35,ty:h,color:'#be93f0'},{tx:w*.77,ty:h,color:'#e9bc89'},{tx:0,ty:0,color:'#98d595'},{tx:w,ty:0,color:'#d8ce75'},{tx:0,ty:h,color:'#d6d385'},{tx:w,ty:h,color:'#cf83cf'}];
 rays.forEach((r,i)=>{c.strokeStyle=rgba(r.color,(i<4?.95:.75)*grid*1.6);c.lineWidth=(i<4?1.5:1)*weight;c.setLineDash(i<4?[]:[1,3]);c.beginPath();c.moveTo(x,y);c.lineTo(r.tx,r.ty);c.stroke();c.setLineDash([]);
  const tx=clamp(r.tx,5,w-5),ty=clamp(r.ty,5,h-5);c.strokeStyle=r.color;c.lineWidth=1.6;c.beginPath();c.moveTo(tx-3,ty-3);c.lineTo(tx,ty+2);c.lineTo(tx+3,ty-3);c.stroke();});
 if(v.gridType==='dots'){c.fillStyle=rgba(ink,grid*.24);const gap=22*v.gridSpacing;for(let px=gap;px<w;px+=gap)for(let py=gap;py<h;py+=gap)c.fillRect(px,py,1,1);}
 else if(v.gridType==='polar'){c.strokeStyle=rgba(ink,grid*.16);c.lineWidth=.5;for(let r=25;r<w;r+=32*v.gridSpacing){c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();}}
 else{c.strokeStyle=rgba(ink,grid*.17);c.lineWidth=.5;for(let i=1;i<6;i++){c.beginPath();c.moveTo(w*i/6,0);c.lineTo(w*i/6,5);c.moveTo(w*i/6,h-5);c.lineTo(w*i/6,h);c.stroke();}}
 c.font=`600 ${fs}px monospace`;c.textBaseline='middle';if('letterSpacing' in c)c.letterSpacing=(fs*(v.textTracking||0))+'px';
 for(let i=0;i<landmarks.length;i++){
  if(v.copyVisibility==='none')continue;
  if((small&&i%3===0)||(short&&i%2===1)||(h<70&&i%3!==0))continue;
  const [lx,ly,label]=landmarks[i];const px=lx*w,py=clamp(ly*h,10,h-10);
  const distance=Math.hypot((px-x)/w,(py-y)/h);const near=distance<.13;
  c.fillStyle=rgba(near?p.accent:ink,near?1:.9);
  c.fillRect(px-6,py-1,3,2);c.fillRect(px-5,py-2,1,4);c.fillText(label,px,py,Math.max(40,w-px-5));
 }
 // Map currently sounding notes into the parameter field; opacity follows their ADSR.
 for(const voice of a.voices||[]){if(voice.envelope<.015)continue;const pitch=((voice.midi-state.sequence.root)%24+24)%24;
  const angle=(voice.index/8)*TAU-1.8,r=.14+pitch/24*.2;
  const px=clamp(x+Math.cos(angle)*w*r,15,w-35),py=clamp(y+Math.sin(angle)*h*r,14,h-14);
  const alpha=clamp(.3+voice.envelope*.7,.3,1);c.strokeStyle=rgba(p.accent,alpha*.5);c.lineWidth=.7;c.setLineDash([2,3]);c.beginPath();c.moveTo(x,y);c.lineTo(px,py);c.stroke();c.setLineDash([]);
  c.shadowColor=p.accent;c.shadowBlur=5*voice.envelope;c.fillStyle=rgba(p.accent,alpha);c.beginPath();c.arc(px,py,2.3+voice.envelope*1.2,0,TAU);c.fill();
  c.font=`bold ${fs+1}px monospace`;c.fillText(noteName(voice.midi),px+5,py-5);c.shadowBlur=0;
 }
 // Bright, concentric crosshair is the single draggable filter control.
 c.fillStyle='#07080d';c.beginPath();c.arc(x,y,8,0,TAU);c.fill();c.strokeStyle=ink;c.lineWidth=2;c.stroke();
 c.strokeStyle='#b2a7f4';c.lineWidth=1.2;c.beginPath();c.arc(x,y,4.5,0,TAU);c.stroke();c.fillStyle=ink;c.beginPath();c.arc(x,y,1.8,0,TAU);c.fill();
 c.restore();
}
