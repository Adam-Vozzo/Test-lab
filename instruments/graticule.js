import * as THREE from '../vendor/three.module.min.js';
import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line} from './kit.js';

export const definition={
  id:'graticule',name:'Graticule / Lissajous',batch:2,
  theme:{bg:'#05070a',fg:'#f2f4ee',accent:'#ffb14b',muted:'#8c949c'},
  defaultSound:{waveform:'sine',attack:.012,decay:.3,sustain:.6,release:1.3,cutoff:10000,resonance:1,gain:.3,ratio:1.5,index:.75,glide:.035,echo:.15},
  defaultAppearance:{guideOpacity:.35,radialDivisions:24,traceWeight:1.2,phosphor:.55,persistence:.55,phaseSamples:750,phaseDotSize:2.3,phaseDepth:.35,phaseAngle:-.22,radialMotion:.5,polarColour:'#ffb14b',phaseColour:'#a8dfff',background:'#05070a'},
  soundControls:[
    {key:'ratio',label:'Frequency ratio',min:.25,max:8,step:.25,unit:'×',section:'Oscillator relationship',description:'Modulator/carrier ratio; also the horizontal axis of the right playing surface.'},
    {key:'index',label:'Modulation index',min:0,max:10,step:.05,section:'Oscillator relationship',description:'FM depth, shown by deformation of the phase-space trace.'},
    {key:'glide',label:'Pitch glide',min:.003,max:.3,step:.005,unit:'s',section:'Polar pitch',description:'Pitch transition time as the contact crosses degree sectors.'}
  ],
  appearanceControls:[
    {key:'guideOpacity',label:'Polar guide opacity',min:.05,max:.8,step:.01,section:'Graticule',description:'Visibility of radial divisions and octave rings.'},
    {key:'radialDivisions',label:'Radial divisions',min:7,max:56,step:1,section:'Graticule',description:'Number of angular guide divisions, independent of musical quantization.'},
    {key:'traceWeight',label:'Orbit stroke',min:.5,max:3,step:.1,unit:'px',section:'Graticule',description:'Stroke width of the sounding orbit traces.'},
    {key:'radialMotion',label:'Orbit phase motion',min:0,max:1.5,step:.05,section:'Graticule',description:'Slow phase advance of each sounding note’s orbit.'},
    {key:'phosphor',label:'Phosphor glow',min:0,max:1.5,step:.05,section:'Phosphor',description:'Local glow of the orange traces and phase dots.'},
    {key:'persistence',label:'Trace persistence',min:0,max:1,step:.05,section:'Phosphor',description:'Visibility of older phase traces behind the current curve.'},
    {key:'phaseSamples',label:'Phase samples',min:200,max:1400,step:50,section:'Phase plot',description:'Number of points used to plot the carrier/modulator relationship.'},
    {key:'phaseDotSize',label:'Phase dot size',min:.6,max:3.5,step:.1,unit:'px',section:'Phase plot',description:'Size of individual points in the blue phase plot.'},
    {key:'phaseDepth',label:'Phase depth',min:0,max:1,step:.05,section:'Phase plot',description:'Depth of the normalized carrier derivative axis.'},
    {key:'phaseAngle',label:'Plot rotation',min:-1.5,max:1.5,step:.05,unit:'rad',section:'Phase plot',description:'Viewing angle of the phase-space figure; does not change pitch.'},
    {key:'polarColour',label:'Polar colour',kind:'color',section:'Palette',description:'Colour of radial guides and sounding orbital traces.'},
    {key:'phaseColour',label:'Phase colour',kind:'color',section:'Palette',description:'Colour of the dotted carrier/modulator plot.'},
    {key:'background',label:'Plot background',kind:'color',section:'Palette',description:'Background colour of the two plotting surfaces.'}
  ]
};

export function polarMapping(nx,ny,aspect=1.5){const radius=Math.min(aspect*.225,.36),x=(nx-.255)*aspect/radius,y=(ny-.48)/radius,r=clamp(Math.hypot(x,y),0,1),angle=((Math.atan2(y,x)+Math.PI*.5)%TAU+TAU)%TAU;return{degree:Math.min(6,Math.floor(angle/TAU*7)),octave:Math.min(2,Math.floor(r*3))-1,r,angle};}
export function phasePoint(theta,ratio,index){const mod=Math.sin(theta*ratio),carrier=Math.sin(theta+index*mod),derivative=Math.cos(theta+index*mod)*(1+index*ratio*Math.cos(theta*ratio))/(1+index*ratio);return{carrier,mod,derivative};}

export function mount(host,api){
  const wrapper=document.createElement('div');wrapper.style.cssText='position:absolute;inset:0;overflow:hidden;';host.append(wrapper);
  const baseCanvas=document.createElement('canvas');baseCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';wrapper.append(baseCanvas);const bg=baseCanvas.getContext('2d');
  const surface=createSurface(wrapper,{label:'Polar pitch and phase-space instrument. Left: angle selects pitch, radius selects octave. Right: horizontal motion changes ratio, vertical motion changes FM index.'});surface.canvas.style.cssText+='position:relative;z-index:2;';const c=surface.ctx,contacts=new Map();
  let renderer=null,scene,camera,points,geometry,material,positions,alpha,pointColor,lastW=0,lastH=0,selected=api.quantize(0),degree=0,octave=0,selectedPos={nx:.255,ny:.3},step=-1;
  const maxSamples=1400,maxPoints=maxSamples*3;
  try{
    renderer=new THREE.WebGLRenderer({alpha:true,premultipliedAlpha:true,antialias:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';wrapper.insertBefore(renderer.domElement,surface.canvas);
    scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,2000);camera.position.z=700;
    geometry=new THREE.BufferGeometry();positions=new Float32Array(maxPoints*3);alpha=new Float32Array(maxPoints);geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));
    material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{colour:{value:new THREE.Color('#a8dfff')},size:{value:2},glow:{value:.5}},vertexShader:'attribute float alpha;uniform float size;varying float a;void main(){a=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}',fragmentShader:'uniform vec3 colour;uniform float glow;varying float a;void main(){float r=length(gl_PointCoord-.5)*2.;float core=1.-smoothstep(.35,.8,r);float halo=(1.-smoothstep(0.,1.,r))*min(glow,1.5)*.35;gl_FragColor=vec4(colour,min(.95,a*(core+halo)));\n#include <colorspace_fragment>\n}' });points=new THREE.Points(geometry,material);points.frustumCulled=false;scene.add(points);
  }catch{renderer?.dispose();renderer=null;}
  function modulate(p){const ratio=Math.round(clamp((p.nx-.535)/.43,0,1)*31+1)/4,index=Math.round(clamp((.86-p.ny)/.72,0,1)*200)/20;api.setSound({ratio,index});}
  const soundOptions=()=>({...api.state.sound});
  const unbind=bindPointers(surface.canvas,{
    down:p=>{const side=p.nx<.5?'polar':'phase',ownsVoice=side==='polar'||(!contacts.size&&!api.audio.snapshot().voices.some(v=>v.level>.001));const q={side,ownsVoice,midi:selected,nx:p.nx,ny:p.ny};contacts.set(p.id,q);
      if(side==='polar'){const hit=polarMapping(p.nx,p.ny,surface.width/surface.height);degree=hit.degree;octave=hit.octave;q.midi=selected=api.quantize(degree,octave);selectedPos={nx:p.nx,ny:p.ny};}else modulate(p);
      if(ownsVoice)api.noteOn('polar-'+p.id,q.midi,soundOptions());api.setStatus(`${api.noteName(selected)} · ${api.state.sound.ratio.toFixed(2)}×`);},
    move:p=>{const q=contacts.get(p.id);if(!q)return;q.nx=p.nx;q.ny=p.ny;if(q.side==='polar'){const hit=polarMapping(p.nx,p.ny,surface.width/surface.height);degree=hit.degree;octave=hit.octave;q.midi=selected=api.quantize(degree,octave);selectedPos={nx:p.nx,ny:p.ny};api.noteUpdate('polar-'+p.id,q.midi,soundOptions());}else modulate(p);api.setStatus(`${api.noteName(selected)} · ${api.state.sound.ratio.toFixed(2)}×`);},
    up:p=>{if(contacts.get(p.id)?.ownsVoice)api.noteOff('polar-'+p.id);contacts.delete(p.id);api.save();},
    cancel:p=>{if(contacts.get(p.id)?.ownsVoice)api.noteOff('polar-'+p.id);contacts.delete(p.id);}
  });
  function plots(w,h,v){
    if(baseCanvas.width!==Math.round(w*surface.dpr)||baseCanvas.height!==Math.round(h*surface.dpr)){baseCanvas.width=Math.round(w*surface.dpr);baseCanvas.height=Math.round(h*surface.dpr);bg.setTransform(surface.dpr,0,0,surface.dpr,0,0);}
    bg.fillStyle=v.background;bg.fillRect(0,0,w,h);const x=w*.255,y=h*.48,r=Math.min(w*.225,h*.36);
    bg.strokeStyle=rgba(v.polarColour,v.guideOpacity);bg.lineWidth=.6;
    for(let n=1;n<=6;n++){bg.beginPath();bg.arc(x,y,r*n/6,0,TAU);bg.stroke();}
    for(let n=0;n<v.radialDivisions;n++){const a=n/v.radialDivisions*TAU;line(bg,[[x,y],[x+Math.cos(a)*r,y+Math.sin(a)*r]],rgba(v.polarColour,v.guideOpacity*.6),.6);}
    for(let i=0;i<7;i++){const a=i/7*TAU-Math.PI/2;label(bg,api.noteName(api.quantize(i)).replace(/\d/g,''),x+Math.cos(a)*(r+15),y+Math.sin(a)*(r+15),rgba(v.polarColour,.7),w<650?8:10,'center');}
    for(let i=0;i<3;i++)label(bg,['−1','0','+1'][i],x+8,y-r*(i+1)/3+8,rgba(v.polarColour,.4),8);
    line(bg,[[w*.5,25],[w*.5,h-25]],rgba(v.phaseColour,.14),.6);
    const px=w*.765,py=h*.47,pw=w*.4,ph=h*.62;
    bg.strokeStyle=rgba(v.phaseColour,.12);bg.lineWidth=.5;
    for(let i=0;i<=8;i++){const xx=px-pw*.5+pw*i/8;line(bg,[[xx,py-ph*.5],[xx,py+ph*.5]],rgba(v.phaseColour,.07),.5);}
    for(let i=0;i<=6;i++){const yy=py-ph*.5+ph*i/6;line(bg,[[px-pw*.5,yy],[px+pw*.5,yy]],rgba(v.phaseColour,.07),.5);}
    line(bg,[[px-pw*.5,py],[px+pw*.5,py]],rgba(v.phaseColour,.25),.7);line(bg,[[px,py-ph*.5],[px,py+ph*.5]],rgba(v.phaseColour,.25),.7);
    label(bg,'−1',px-pw*.5,py+13,rgba(v.phaseColour,.3),8);label(bg,'+1',px+pw*.5,py+13,rgba(v.phaseColour,.3),8,'right');label(bg,'M',px+7,py-ph*.5,rgba(v.phaseColour,.5),8);label(bg,'C',px+pw*.5,py-9,rgba(v.phaseColour,.5),8,'right');
    return{x,y,r};
  }
  function radialTrace(w,h,v,snap,t,plot){
    const{x,y,r}=plot,voices=snap.voices.filter(q=>q.level>.005),notes=voices.length?voices:[{midi:selected,level:.07,id:'idle'}];
    c.save();c.beginPath();c.rect(0,60,w*.5,h-110);c.clip();
    for(let k=0;k<notes.length;k++){
      const n=notes[k],a=((n.midi-api.state.root)%12)/12*TAU-Math.PI*.5,rr=r*(.4+clamp((n.midi-api.state.root+12)/36,0,1)*.53),level=clamp(n.level,0,1),phase=(api.reducedMotion?0:t)*.24*v.radialMotion+k*.7;
      c.strokeStyle=rgba(v.polarColour,.22+level*.65);c.lineWidth=v.traceWeight;c.shadowColor=v.polarColour;c.shadowBlur=v.phosphor*(5+level*10);
      c.beginPath();for(let i=0;i<=120;i++){const theta=i/120*TAU,xx=Math.cos(theta)*rr,yy=Math.sin(theta)*rr*(.12+.2*level),ca=Math.cos(a+phase*.17),sa=Math.sin(a+phase*.17),px=x+xx*ca-yy*sa,py=y+xx*sa+yy*ca;i?c.lineTo(px,py):c.moveTo(px,py);}c.stroke();
      line(c,[[x,y],[x+Math.cos(a)*rr,y+Math.sin(a)*rr]],rgba(v.polarColour,.3+level*.5),v.traceWeight*.8);
      const head=a+Math.sin(phase)*.1,hx=x+Math.cos(head)*rr,hy=y+Math.sin(head)*rr;c.fillStyle=rgba('#fff5cd',.3+level*.65);c.beginPath();c.ellipse(hx,hy,3+level*13,2+level*4,head,0,TAU);c.fill();
    }
    c.shadowBlur=0;c.restore();
    const p=polarMapping(selectedPos.nx,selectedPos.ny,w/h),a=p.angle-Math.PI*.5,rr=p.r*r,px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;
    c.strokeStyle=rgba('#fff3db',.9);c.lineWidth=.8;c.beginPath();c.arc(px,py,7,0,TAU);c.stroke();line(c,[[px-12,py],[px+12,py]],rgba('#fff3db',.6),.7);line(c,[[px,py-12],[px,py+12]],rgba('#fff3db',.6),.7);
    c.fillStyle=v.polarColour;c.beginPath();c.arc(x,y,3,0,TAU);c.fill();
  }
  function phaseTrace(w,h,v,snap,t){
    const count=Math.round(v.phaseSamples),ratio=api.state.sound.ratio,index=api.state.sound.index,cx=w*.765,cy=h*.47,sx=w*.185,sy=h*.255,depth=Math.min(sx,sy)*v.phaseDepth;
    const rms=clamp(snap.rms*5,0,1),phase=(snap.time*TAU*440*Math.pow(2,(selected-69)/12))%TAU,ca=Math.cos(v.phaseAngle),sa=Math.sin(v.phaseAngle);let n=0;
    if(renderer){material.uniforms.colour.value.set(v.phaseColour);material.uniforms.glow.value=v.phosphor;material.uniforms.size.value=v.phaseDotSize*Math.min(devicePixelRatio||1,1.6)*(1+v.phosphor*.35);}
    for(let layer=2;layer>=0;layer--){const strength=layer===0?.75+rms*.2:v.persistence*.22/(layer+.5);if(layer>0&&v.persistence===0)continue;
      for(let i=0;i<count;i++){
        const theta=i/(count-1)*TAU*4+phase-layer*.07,point=phasePoint(theta,ratio,index),xx=point.carrier*sx,zz=point.derivative*depth,yy=point.mod*sy;
        const x=cx+xx*ca+zz*sa,y=cy-yy*.93+zz*.16,z=zz*ca-xx*sa;
        if(renderer){positions[n*3]=x-w/2;positions[n*3+1]=h/2-y;positions[n*3+2]=z;alpha[n]=strength*(.6+.4*i/count);n++;}
        else{c.fillStyle=rgba(v.phaseColour,strength*(.6+.4*i/count));const r=v.phaseDotSize*.5;c.fillRect(x-r,y-r,r*2,r*2);}
      }
    }
    if(renderer){geometry.setDrawRange(0,n);geometry.attributes.position.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;renderer.render(scene,camera);}
  }
  function envelope(w,h,v,snap){
    const sound=api.state.sound,x=22,y=h-64,width=w*.43,height=20,sum=sound.attack+sound.decay+.35+sound.release;
    const ax=x+width*sound.attack/sum,dx=ax+width*sound.decay/sum,sx=dx+width*.35/sum;
    line(c,[[x,y+height],[ax,y],[dx,y+height*(1-sound.sustain)],[sx,y+height*(1-sound.sustain)],[x+width,y+height]],rgba(v.polarColour,.4),.9);
    label(c,`A ${(sound.attack*1000).toFixed(0)} ms`,x,y-8,rgba(v.polarColour,.5),8);label(c,`R ${sound.release.toFixed(2)} s`,x+width,y-8,rgba(v.polarColour,.5),8,'right');
    const waveform=snap.waveform||[];if(waveform.length){const points=[];for(let i=0;i<180;i++){const value=waveform[Math.floor(i/180*waveform.length)]||0;points.push([w*.55+i/180*w*.415,h-53-value*24]);}line(c,points,rgba(v.phaseColour,.55),.8);}
  }
  return{
    frame(t,dt){surface.resize();const w=surface.width,h=surface.height,v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot();c.clearRect(0,0,w,h);
      if(renderer&&(lastW!==w||lastH!==h)){renderer.setSize(w,h,false);camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();lastW=w;lastH=h;}
      if(!contacts.size){const sounding=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started)[0];if(sounding){selected=sounding.midi;octave=Math.floor((selected-api.state.root)/12);for(let i=0;i<7;i++)if(((api.quantize(i)-selected)%12+12)%12===0){degree=i;break;}}}const plot=plots(w,h,v);radialTrace(w,h,v,snap,t,plot);phaseTrace(w,h,v,snap,t);envelope(w,h,v,snap);
      const small=w<650;label(c,'θ PITCH · r OCTAVE',22,23,rgba(v.polarColour,.6),small?8:10);label(c,api.noteName(selected),22,48,v.polarColour,small?21:29);label(c,`${(440*Math.pow(2,(selected-69)/12)).toFixed(2)} Hz`,w*.47,48,rgba(v.polarColour,.65),small?9:12,'right');
      label(c,'X RATIO · Y INDEX',w*.55,23,rgba(v.phaseColour,.6),small?8:10);label(c,`${api.state.sound.ratio.toFixed(2)} : 1`,w*.55,48,v.phaseColour,small?19:27);label(c,`I ${api.state.sound.index.toFixed(2)}`,w-22,48,rgba(v.phaseColour,.65),small?10:13,'right');
      label(c,`DEG ${degree+1}  OCT ${octave>=0?'+':''}${octave}`,22,h-20,rgba(v.polarColour,.5),9);label(c,`RMS ${snap.rms.toFixed(3)}`,w-22,h-20,rgba(v.phaseColour,.5),9,'right');
    },
    onStep(step,when){const melody=[0,4,2,6,3,5,1,4],midi=api.quantize(melody[step%8],step%4===3?1:0);api.audio.pulse('polar-step-'+step,midi,soundOptions(),when,60/api.state.bpm*.43);},
    update(){api.audio.configure(api.state.sound);},
    cancel(){for(const[id,q]of contacts)if(q.ownsVoice)api.noteOff('polar-'+id);contacts.clear();},
    destroy(){unbind();for(const[id,q]of contacts)if(q.ownsVoice)api.noteOff('polar-'+id);contacts.clear();if(renderer){geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();}surface.destroy();wrapper.remove();}
  };
}
