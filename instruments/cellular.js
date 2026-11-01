import * as THREE from '../vendor/three.module.min.js';
import {TAU,clamp,lerp,rgba,seeded,createSurface,bindPointers,label,line} from './kit.js';

export const definition={
  id:'cellular',name:'Cellular Field',batch:1,
  theme:{bg:'#03090d',fg:'#ddfff7',accent:'#8df5db',muted:'#789993'},
  defaultSound:{waveform:'triangle',attack:.06,decay:.45,sustain:.7,release:2.4,cutoff:4800,resonance:2.1,gain:.34,detune:6,index:.35,ratio:1.5,glide:.09,echo:.19},
  defaultAppearance:{bodyRadius:58,cellCount:52,cellSize:1,spread:1,breathing:.22,breathRate:.7,roughness:.35,glow:.6,glowRadius:1,curtainDensity:1,curtainMotion:.7,curtainOpacity:.58,wakeLength:.65,cellColour:'#9cf9ed',curtainColour:'#87bffa',warmColour:'#e2efa1',background:'#03090d'},
  soundControls:[
    {key:'detune',label:'Cell detune',min:0,max:35,step:.5,unit:'ct',section:'Voices',description:'Pitch spread of each voice; also separates its cellular structure.'},
    {key:'glide',label:'Contact glide',min:.005,max:.4,step:.005,unit:'s',section:'Voices',description:'Pitch transition time as a contact crosses scale degrees.'},
    {key:'index',label:'Harmonic growth',min:0,max:5,step:.05,section:'Voices',description:'FM depth, reflected in the relief of sounding cells.'}
  ],
  appearanceControls:[
    {key:'bodyRadius',label:'Body radius',min:25,max:100,step:1,unit:'px',section:'Cells',description:'Maximum radius of each contact’s cellular body.'},
    {key:'cellCount',label:'Cells per body',min:20,max:88,step:1,section:'Cells',description:'Number of faceted cells making up each body.'},
    {key:'cellSize',label:'Cell size',min:.45,max:1.7,step:.05,section:'Cells',description:'Size of individual facets, independently of the body radius.'},
    {key:'spread',label:'Cell separation',min:.45,max:1.7,step:.05,section:'Cells',description:'Distance between cells within each body.'},
    {key:'breathing',label:'Local breathing',min:0,max:.6,step:.01,section:'Cells',description:'Independent growth variation of neighbouring cells.'},
    {key:'breathRate',label:'Breathing rate',min:.15,max:2,step:.05,section:'Cells',description:'Speed of ambient cellular growth, independent of tempo.'},
    {key:'roughness',label:'Facet roughness',min:.1,max:.95,step:.01,section:'Cells',description:'Softness of the lighting on the faceted cells.'},
    {key:'glow',label:'Body glow',min:0,max:1.5,step:.05,section:'Light',description:'Soft local halos around cellular bodies; leaves labels untouched.'},
    {key:'glowRadius',label:'Glow radius',min:.4,max:2,step:.05,section:'Light',description:'Halo spread around each cellular body.'},
    {key:'curtainDensity',label:'Curtain density',min:.3,max:1.8,step:.05,section:'Spectrum curtain',description:'Number of sampled points in the shared spectral curtain.'},
    {key:'curtainMotion',label:'Curtain drift',min:0,max:1.5,step:.05,section:'Spectrum curtain',description:'Slow wave movement of the spectral curtain.'},
    {key:'curtainOpacity',label:'Curtain opacity',min:.1,max:1,step:.05,section:'Spectrum curtain',description:'Visibility of the aggregate audio spectrum.'},
    {key:'wakeLength',label:'Contact wake',min:0,max:1.5,step:.05,section:'Motion',description:'Persistence of small points left by moving contacts.'},
    {key:'cellColour',label:'Cell colour',kind:'color',section:'Palette',description:'Base colour of the faceted contact bodies.'},
    {key:'curtainColour',label:'Curtain colour',kind:'color',section:'Palette',description:'Cool end of the spectral curtain palette.'},
    {key:'warmColour',label:'High-band colour',kind:'color',section:'Palette',description:'Warm colour of the upper spectral bands.'},
    {key:'background',label:'Field colour',kind:'color',section:'Palette',description:'Background of both playing surfaces.'}
  ]
};

export function mount(host,api){
  const wrapper=document.createElement('div');wrapper.style.cssText='position:absolute;inset:0;overflow:hidden;';host.append(wrapper);
  const backdrop=document.createElement('canvas');backdrop.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';wrapper.append(backdrop);const bg=backdrop.getContext('2d');
  const surface=createSurface(wrapper,{label:'Cellular voices. Touch the left field to play independent voices. Drag the right field to adjust cutoff and detune.'});surface.canvas.style.cssText+='position:relative;z-index:2;';
  const c=surface.ctx,random=seeded(713),dots=Array.from({length:140},()=>({x:random(),y:random(),r:random(),p:random()*TAU}));
  const contacts=new Map(),bodies=[],wakes=[],matrix=new THREE.Object3D(),color=new THREE.Color(),base=new THREE.Color();
  let renderer=null,scene,camera,cells,material,haloTexture,halos=[],lastW=0,lastH=0,selected=api.quantize(2),tune={nx:.82,ny:.42},time=0;
  const maxBodies=16,maxCells=88,phases=Array.from({length:maxCells},(_,i)=>({a:i*2.399963,b:random()*TAU,rate:.7+random()*.6,size:.76+random()*.35}));
  function addBody(id,nx,ny,midi,ambient=false){
    let b=bodies.find(b=>b.id===id);if(b)return b;
    if(bodies.length>=maxBodies){const index=bodies.findIndex(b=>!contacts.has(b.pointer)&&b.level<.06);bodies.splice(index>=0?index:0,1);}
    b={id,nx,ny,x:nx,y:ny,midi,level:0,ambient,born:time,phase:random()*TAU,pointer:null};bodies.push(b);return b;
  }
  addBody('rest-1',.18,.65,api.quantize(0),true);addBody('rest-2',.37,.39,api.quantize(3),true);addBody('rest-3',.55,.62,api.quantize(5),true);
  try{
    renderer=new THREE.WebGLRenderer({alpha:true,premultipliedAlpha:true,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
    renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';wrapper.insertBefore(renderer.domElement,surface.canvas);
    scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,2000);camera.position.set(0,0,700);
    scene.add(new THREE.AmbientLight('#bcdfed',1.2));const light=new THREE.DirectionalLight('#efffff',2.4);light.position.set(-200,300,500);scene.add(light);const rim=new THREE.DirectionalLight('#437eea',1.8);rim.position.set(400,-200,150);scene.add(rim);
    material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.35,metalness:.16,flatShading:true,emissive:'#71d6c5',emissiveIntensity:.13});
    cells=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),material,maxBodies*maxCells);cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);cells.frustumCulled=false;scene.add(cells);
    const tex=document.createElement('canvas');tex.width=tex.height=96;const g=tex.getContext('2d'),grad=g.createRadialGradient(48,48,0,48,48,48);grad.addColorStop(0,'rgba(145,255,227,.45)');grad.addColorStop(.2,'rgba(104,224,221,.25)');grad.addColorStop(1,'rgba(80,190,220,0)');g.fillStyle=grad;g.fillRect(0,0,96,96);haloTexture=new THREE.CanvasTexture(tex);
    for(let i=0;i<maxBodies;i++){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTexture,transparent:true,depthWrite:false,opacity:.5}));sprite.position.z=-50;scene.add(sprite);halos.push(sprite);}
  }catch{renderer?.dispose();renderer=null;}
  function soundPoint(p,b){
    b.nx=clamp(p.nx,.025,.67);b.ny=clamp(p.ny,.1,.9);b.midi=api.quantize(Math.floor(b.nx/.68*14),Math.round((.55-b.ny)*2));selected=b.midi;
    const options={...api.state.sound,pan:clamp(b.nx*2-1,-.75,.75),cutoff:clamp(api.state.sound.cutoff*(1.3-b.ny*.6),100,18000)};
    return options;
  }
  function tunePoint(p){tune.nx=clamp(p.nx,.71,.97);tune.ny=clamp(p.ny,.12,.88);api.setSound({cutoff:Math.round(120*Math.pow(120,(tune.nx-.71)/.26)),detune:Math.round((.88-tune.ny)/.76*35)});for(const q of contacts.values())if(q.body)api.noteUpdate(q.body.id,q.body.midi,{...api.state.sound,pan:q.body.nx*2-1});}
  const unbind=bindPointers(surface.canvas,{
    down:p=>{if(p.nx>.7){contacts.set(p.id,{tune:true});tunePoint(p);return;}
      const id='cell-'+p.id,b=addBody(id,p.nx,p.ny,selected);b.pointer=p.id;b.ambient=false;contacts.set(p.id,{body:b});api.noteOn(id,(soundPoint(p,b),b.midi),soundPoint(p,b));api.setStatus(api.noteName(b.midi));},
    move:p=>{const q=contacts.get(p.id);if(!q)return;if(q.tune){tunePoint(p);return;}const b=q.body,options=soundPoint(p,b);wakes.push({nx:b.nx,ny:b.ny,born:time,phase:random()*TAU});if(wakes.length>180)wakes.shift();api.noteUpdate(b.id,b.midi,options);api.setStatus(api.noteName(b.midi));},
    up:p=>{const q=contacts.get(p.id);if(q?.body){q.body.pointer=null;api.noteOff(q.body.id);}contacts.delete(p.id);api.save();},
    cancel:p=>{const q=contacts.get(p.id);if(q?.body){q.body.pointer=null;api.noteOff(q.body.id);}contacts.delete(p.id);}
  });
  function drawBackground(w,h,v,snap,t){
    if(backdrop.width!==Math.round(w*surface.dpr)||backdrop.height!==Math.round(h*surface.dpr)){backdrop.width=Math.round(w*surface.dpr);backdrop.height=Math.round(h*surface.dpr);bg.setTransform(surface.dpr,0,0,surface.dpr,0,0);}
    bg.fillStyle=v.background;bg.fillRect(0,0,w,h);const energy=1-Math.exp(-Math.max(0,snap.rms)*12),motion=api.reducedMotion?0:t;
    for(const p of dots){const tw=.25+.35*Math.pow(.5+.5*Math.sin(motion*.4+p.p),3);bg.fillStyle=rgba(v.cellColour,tw*.5);bg.fillRect(p.x*w,p.y*h,p.r*1.3+.4,p.r*1.3+.4);}
    const cols=Math.round(76*v.curtainDensity),rows=22;
    for(let x=0;x<cols;x++){
      const f=x/Math.max(1,cols-1),spectrum=snap.frequency?.[Math.min(255,Math.floor(f*150))]||0;
      for(let y=0;y<rows;y++){
        const q=y/(rows-1),xx=w*(.025+f*.61)+Math.sin(f*11+q*2+motion*.19*v.curtainMotion)*w*.019;
        const yy=h*(.075+f*.31+Math.sin(f*7+motion*.22*v.curtainMotion)*.075)+q*(h*.09+spectrum*h*.2)+Math.sin(f*15+q*4-motion*.8)*3;
        const alpha=Math.min(.85,.16+energy*.65+spectrum*.35)*(1-q*.65)*v.curtainOpacity;
        bg.fillStyle=rgba(f>.56?v.warmColour:v.curtainColour,alpha);const size=1.4+energy*2+spectrum*1.2;bg.fillRect(xx,yy,size,size);
      }
    }
    for(let i=wakes.length-1;i>=0;i--){const p=wakes[i],age=t-p.born,life=.2+v.wakeLength*2;if(age>life){wakes.splice(i,1);continue;}const a=(1-age/life)*.5;bg.strokeStyle=rgba(v.cellColour,a);bg.lineWidth=1;bg.beginPath();bg.moveTo(p.nx*w,p.ny*h);bg.lineTo(p.nx*w+Math.cos(p.phase)*age*17,p.ny*h+Math.sin(p.phase)*age*17);bg.stroke();}
    // A sparse harmonic network on the second surface exposes filter/spread.
    const cutoff=clamp(Math.log(Math.max(120,api.state.sound.cutoff)/120)/Math.log(120),0,1),detune=api.state.sound.detune/35;
    const nodes=Array.from({length:11},(_,i)=>{const a=i/11*TAU+motion*.025,r=(.065+(i%3)*.018+detune*.012)*Math.min(w,h);return{x:w*.835+Math.cos(a)*r,y:h*.43+Math.sin(a)*r*1.8,z:Math.sin(a*2)};});
    for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+3)%nodes.length];line(bg,[[a.x,a.y],[b.x,b.y]],rgba(v.curtainColour,.18+energy*.2),.7);bg.fillStyle=rgba(v.cellColour,.5);bg.beginPath();bg.arc(a.x,a.y,2+(i%3===0?energy*3:0),0,TAU);bg.fill();}
    const tx=w*(.74+cutoff*.19),ty=h*(.76-detune*.58);bg.strokeStyle=rgba(v.cellColour,.75);bg.lineWidth=.8;bg.beginPath();bg.arc(tx,ty,8,0,TAU);bg.stroke();line(bg,[[tx-13,ty],[tx+13,ty]],rgba(v.cellColour,.5),.7);line(bg,[[tx,ty-13],[tx,ty+13]],rgba(v.cellColour,.5),.7);
    line(bg,[[w*.7,40],[w*.7,h-42]],rgba(v.cellColour,.1),.7);
  }
  function drawBodies(w,h,v,snap,t,dt){
    base.set(v.cellColour);const cool=new THREE.Color(v.curtainColour);let instance=0;const count=Math.round(v.cellCount),scale=Math.min(1,w/1000,h/540),radius=v.bodyRadius*scale,depth=api.state.sound.detune/35,motion=api.reducedMotion?0:t,annotations=[];
    for(let bi=0;bi<bodies.length;bi++){
      const b=bodies[bi];if(b.startsAt!=null&&snap.time<b.startsAt){if(renderer)halos[bi].visible=false;continue;}const voice=snap.voices.find(q=>q.id===b.id),target=voice?.level||0;b.level=lerp(b.level,target,1-Math.exp(-dt*12));b.x=lerp(b.x,b.nx,1-Math.exp(-dt*18));b.y=lerp(b.y,b.ny,1-Math.exp(-dt*18));
      const alive=b.ambient?.18:Math.max(.05,b.level),bodyScale=.44+.56*Math.sqrt(alive),cx=b.x*w,cy=b.y*h;
      if(renderer){const halo=halos[bi];halo.visible=true;halo.position.set(cx-w/2,h/2-cy,-45);halo.scale.setScalar(radius*5*v.glowRadius*bodyScale);halo.material.opacity=v.glow*(.16+b.level*.45);}
      for(let i=0;i<count;i++){
        const p=phases[i],z=1-2*(i+.5)/count,radial=Math.sqrt(1-z*z),a=p.a+motion*.035+Math.sin(b.phase)*.3;
        const local=(.75+.25*Math.sin(a*3+b.phase))*radius*bodyScale*v.spread;
        const x=Math.cos(a)*radial*local,y=Math.sin(a)*radial*local*.88,zp=z*local*(.6+depth*.8);
        const breath=1+v.breathing*(Math.sin(motion*v.breathRate*p.rate+p.b)*.65+Math.sin(motion*v.breathRate*.63+p.b*2)*.35);
        const size=radius*.19*v.cellSize*p.size*breath*bodyScale*(.85+b.level*.35);
        if(renderer){matrix.position.set(cx-w/2+x,h/2-cy-y,zp);matrix.rotation.set(p.b+motion*.025,p.a*.3,motion*.035+p.b);matrix.scale.setScalar(size);matrix.updateMatrix();cells.setMatrixAt(instance,matrix.matrix);color.copy(base).multiplyScalar(.62+(z+1)*.12+b.level*.18);if(i%7===0)color.lerp(cool,.35);cells.setColorAt(instance,color);instance++;}
        else{c.fillStyle=rgba(v.cellColour,.12+alive*.48);c.strokeStyle=rgba(v.cellColour,.42);c.lineWidth=.6;c.beginPath();for(let k=0;k<6;k++){const a=k/6*TAU+p.b,xx=cx+x+Math.cos(a)*size,yy=cy+y+Math.sin(a)*size;k?c.lineTo(xx,yy):c.moveTo(xx,yy);}c.closePath();c.fill();c.stroke();}
      }
      if(!b.ambient&&b.level>.015)annotations.push({body:b,x:cx,y:cy+radius*bodyScale*v.spread+20,priority:(b.pointer!==null?2:0)+b.level});
    }
    // Release tails keep their geometry, but nearby bodies share the most
    // relevant note annotation instead of stacking unreadable labels.
    const placed=[];
    for(const a of annotations.sort((a,b)=>b.priority-a.priority)){
      if(placed.some(p=>Math.abs(p.x-a.x)<34&&Math.abs(p.y-a.y)<20))continue;
      label(c,api.noteName(a.body.midi),a.x,a.y,rgba(v.cellColour,.55+a.body.level*.35),10,'center');placed.push(a);
    }
    if(renderer){cells.count=instance;cells.instanceMatrix.needsUpdate=true;if(cells.instanceColor)cells.instanceColor.needsUpdate=true;material.roughness=v.roughness;material.emissive.set(v.cellColour);material.emissiveIntensity=.08+clamp(snap.rms*1.5,0,.16);for(let i=bodies.length;i<halos.length;i++)halos[i].visible=false;renderer.render(scene,camera);}
    for(let i=bodies.length-1;i>=0;i--)if(!bodies[i].ambient&&!contacts.has(bodies[i].pointer)&&bodies[i].level<.001&&t-bodies[i].born>3.5&&!snap.voices.some(v=>v.id===bodies[i].id))bodies.splice(i,1);
  }
  return {
    frame(t,dt){time=t;surface.resize();const w=surface.width,h=surface.height,v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot();
      if(renderer&&(w!==lastW||h!==lastH)){renderer.setSize(w,h,false);camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();lastW=w;lastH=h;}
      if(!contacts.size){const sounding=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started)[0];if(sounding)selected=sounding.midi;}c.clearRect(0,0,w,h);drawBackground(w,h,v,snap,t);drawBodies(w,h,v,snap,t,dt);
      label(c,api.noteName(selected),23,29,v.cellColour,23);label(c,`${snap.voices.filter(v=>v.level>.01).length.toString().padStart(2,'0')} VOICES`,23,51,rgba(v.cellColour,.45),9);
      label(c,'CUTOFF / DETUNE',w*.735,26,rgba(v.cellColour,.5),w<700?8:10);label(c,`${(api.state.sound.cutoff/1000).toFixed(2)} kHz`,w*.735,49,v.cellColour,w<700?12:18);label(c,`${Number(api.state.sound.detune).toFixed(1)} ct`,w-23,49,rgba(v.cellColour,.7),10,'right');
      label(c,'CONTACT → PITCH / OCTAVE',23,h-24,rgba(v.cellColour,.38),w<650?8:9);label(c,`RMS ${snap.rms.toFixed(3)}`,w-23,h-24,rgba(v.cellColour,.4),9,'right');
    },
    onStep(step,when){const degree=[0,2,4,6,3,5,2,1][step%8],midi=api.quantize(degree,step%4===3?1:0),id='cell-step-'+step;addBody(id,.14+(step%4)*.14,.36+(Math.floor(step/4)%2)*.24,midi).startsAt=when;api.audio.pulse(id,midi,{...api.state.sound,pan:-.6+(step%4)*.35},when,60/api.state.bpm*.55);},
    update(){api.audio.configure(api.state.sound);},
    cancel(){for(const q of contacts.values())if(q.body)api.noteOff(q.body.id);contacts.clear();},
    destroy(){unbind();for(const q of contacts.values())if(q.body)api.noteOff(q.body.id);contacts.clear();if(renderer){cells.geometry.dispose();material.dispose();haloTexture.dispose();halos.forEach(h=>h.material.dispose());renderer.dispose();renderer.forceContextLoss();}surface.destroy();wrapper.remove();}
  };
}
