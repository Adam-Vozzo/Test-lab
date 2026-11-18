import {bindPointers,clamp,createSurface,seeded} from './kit.js';

export const definition={
  id:'undercrypt',name:'Undercrypt',layoutMode:'single',keyboardNotes:true,
  theme:{bg:'#080b15',fg:'#d2d1cb',accent:'#60d3d1',muted:'#8a8ba2'},
  defaultSound:{waveform:'triangle',attack:.008,decay:.15,sustain:.38,release:.42,gain:.42,echo:.17,delayTime:.26,feedback:.2},
  defaultAppearance:{torch:1},
  appearanceControls:[{key:'torch',label:'Torch radius',section:'Dungeon',description:'Distance around the player lit by the torch.',min:.5,max:2,step:.05}]
};
const cols=39,rows=21;
// Five ink columns in a seven-row character cell. The atlas keeps the same
// hard edges on Retina displays and does not depend on installed symbol fonts.
const bitmap={
  A:'0e11111f111111',B:'1e11111e11111e',C:'0f10101010100f',D:'1e11111111111e',
  E:'1f10101e10101f',F:'1f10101e101010',G:'0f10101311110f',H:'1111111f111111',
  I:'1f04040404041f',J:'0702020212120c',K:'11121418141211',L:'1010101010101f',
  M:'111b1515111111',N:'11191915131311',O:'0e11111111110e',P:'1e11111e101010',
  Q:'0e11111115120d',R:'1e11111e141211',S:'0f10100e01011e',T:'1f040404040404',
  U:'1111111111110e',V:'11111111110a04',W:'11111115151b11',X:'11110a040a1111',
  Y:'11110a04040404',Z:'1f01020408101f',
  0:'0e11131519110e',1:'040c040404040e',2:'0e11010204081f',3:'1e01010e01011e',
  4:'02060a121f0202',5:'1f10101e01011e',6:'0e10101e11110e',7:'1f010204080808',
  8:'0e11110e11110e',9:'0e11110f01010e',
  '@':'0e11171517100f','!':'04040404040004','♦':'040e1f1f1f0e04',
  'b':'1010161911111e','w':'0000001111150a','>':'10080402040810','.':'00000000000004',
  '♥':'000a1f1f0e0400','#':'0a0a1f0a1f0a0a','/':'01010204081010',
  '-':'0000001f000000','+':'0004041f040400',':':'00040000040000'
};
const palette={'@':'#ffff63','!':'#55ffff','♦':'#ffba55','w':'#ff55aa','>':'#ffffff','#':'#4aa8a8','.':'#80948f'};

function makeFont(){
  const letters=Object.keys(bitmap),positions=new Map(letters.map((ch,i)=>[ch,i*6])),atlases=new Map();
  return function print(c,word,x,y,scale,ink){
    if(!atlases.has(ink)){
      const atlas=document.createElement('canvas');atlas.width=letters.length*6;atlas.height=7;
      const ctx=atlas.getContext('2d');ctx.fillStyle=ink;
      for(const ch of letters)for(let row=0;row<7;row++){
        const bits=parseInt(bitmap[ch].slice(row*2,row*2+2),16);
        for(let col=0;col<5;col++)if(bits&(16>>col))ctx.fillRect(positions.get(ch)+col,row,1,1);
      }
      atlases.set(ink,atlas);
    }
    const atlas=atlases.get(ink);
    for(const [i,ch] of [...String(word)].entries())if(positions.has(ch)){
      c.drawImage(atlas,positions.get(ch),0,5,7,Math.round(x+i*6*scale),Math.round(y),5*scale,7*scale);
    }
  };
}
const instruments={
  '.':{name:'FOOTFALL',steps:[0],octave:0},
  '!':{name:'POTION',steps:[0,4,7],octave:0},
  '♦':{name:'CRYSTAL',steps:[4,7,11],octave:1},
  'w':{name:'WRAITH',steps:[0,1,-3],octave:-1},
  '>':{name:'DESCENT',steps:[7,4,2,0],octave:0}
};
// Larger inventory portraits share the tile palette and square pixel pitch.
const portraits={
  '.':['      xx  ','     x++x ','     ++++ ','    x++x  ','    +++x  ','     xx   ','  xx      ',' x++x     ',' ++++     ','x++x      ','xxx       '],
  '!':['   ++++   ','    xx    ','    xx    ','   x  x   ','  x    x  ',' x++++++x ',' x xxxxx x',' xxxxxxx x','  xxxxxx  ','   xxxx   '],
  '♦':['    ++    ','   +xx+   ','  +x++x+  ',' +x+xx+x+ ','+xx+xx+xx+',' +x+xx+x+ ','  +x++x+  ','   +xx+   ','    ++    '],
  'w':['  x    x  ',' x+x  x+x ',' xxxxxxxx ','xx++xx++xx',' xx xx xx ',' xxxxxxxx ','  x xx x  ',' x  xx  x ','    x     '],
  '>':['++        ','xx++      ',' xxx++    ','  xxxx++  ','   xxxxx++','    xxxxxx','     xxxxx','      xxxx','       xxx']
};
// Paint the inventory portrait into a low-resolution barrel vault. Courses,
// ribs and paving share a perspective space and a fixed sixteen-colour ramp.
function vaultBackdrop(depth){
  const canvas=document.createElement('canvas');
  canvas.width=128;canvas.height=58;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(128,58);
  const ramp=[0x080b18,0x111325,0x191c35,0x252744,0x303453,0x414761,0x535b73,0x72798b];
  const copper=[0x100e1b,0x281a29,0x432735,0x633845,0x8f4d44,0xb86e4d,0xdc9a65,0xffce80];
  const noise=seeded(97+depth);
  for(let y=0;y<58;y++)for(let x=0;x<128;x++){
    const dx=(x-63.5)/60,dy=(28-y)/60;
    const wall=1/Math.max(.001,Math.abs(dx));
    const floor=dy<0?-.48/dy:Infinity;
    const roof=dy>0?1/Math.hypot(dx,dy*1.45):Infinity;
    const z=Math.min(wall,floor,roof,8),u=dx*z,v=dy*z;
    const paving=z===floor,cap=z===8;
    const row=paving?Math.floor(z*2):Math.floor((v+.48)*8);
    const along=paving?(u+1)*3:z*2;
    const seam=(along+(row%2)*.5)%1<.07;
    const bed=paving?(z*2)%1<.08:((v+.48)*8)%1<.09;
    const rib=z%1.8<.19&&!paving;
    const lamp=Math.max(0,1-Math.abs(z-2.7)*1.3)*Math.max(0,1-Math.abs(v-.06)*1.5);
    let value=(paving?2.05:3.1)-.27*z+(rib?1.8:0)-(seam||bed?1.55:0)+lamp*3;
    if(cap)value=1.7-Math.abs(u)*.8;
    const index=Math.max(0,Math.min(7,Math.floor(value+noise()*.65+((x+y)%2)*.38)));
    const rgb=(lamp>.17?copper:ramp)[index],i=(y*128+x)*4;
    pixels.data.set([rgb>>16,(rgb>>8)&255,rgb&255,255],i);
  }
  ctx.putImageData(pixels,0,0);
  for(const x of [42,85]){
    ctx.fillStyle='#583640';ctx.fillRect(x-1,24,3,7);
    ctx.fillStyle='#c56c51';ctx.fillRect(x-2,23,5,2);
    ctx.fillStyle='#ffbd72';ctx.fillRect(x,19,2,4);
    ctx.fillStyle='#ffeab1';ctx.fillRect(x,21,1,2);
  }
  return canvas;
}

const runeTones={
  '.':{waveform:'triangle',attack:.6,decay:.76,sustain:.74,release:.33,cutoff:.25},
  '!':{waveform:'square',attack:1,decay:.6,sustain:.68,release:.48,cutoff:.36},
  '♦':{waveform:'sine',ratio:3,index:.86,attack:.4,decay:.8,sustain:.98,release:.86,cutoff:1},
  'w':{waveform:'sawtooth',ratio:.5,index:1.12,attack:4.75,decay:.87,sustain:1.08,release:.5,cutoff:.18},
  '>':{waveform:'square',attack:1.1,decay:.74,sustain:.77,release:.57,cutoff:.29}
};
function generate(floor){
  const random=seeded(floor*947+33),map=Array(cols*rows).fill(' '),rooms=[];
  const carve=(x,y)=>{map[y*cols+x]='.';};
  for(let i=0;i<6;i++){
    const x=2+i%3*12+Math.floor(random()*2), y=2+Math.floor(i/3)*10+Math.floor(random()*2);
    const w=7+Math.floor(random()*3),h=4+Math.floor(random()*2);
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)carve(xx,yy);
    rooms.push({x:x+(w>>1),y:y+(h>>1)});
  }
  const routes=[[0,1,2,5,4,3],[0,3,4,1,2,5],[0,3,4,5,2,1]];
  const order=routes[(floor-1)%routes.length];
  for(let i=1;i<order.length;i++){
    const a=rooms[order[i-1]],b=rooms[order[i]];
    for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)carve(x,a.y);
    for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)carve(b.x,y);
  }
  const earth=[...map];
  for(let i=cols;i<map.length-cols;i++)if(map[i]===' '&&[-1,0,1].some(y=>[-1,0,1].some(x=>earth[i+y*cols+x]==='.')))map[i]='#';
  for(let i=1;i<order.length;i++){const r=rooms[order[i]];map[r.y*cols+r.x]=['','♦','w','!','♦','>'][i];}
  return {map,start:rooms[0].y*cols+rooms[0].x};
}

const walkable=tile=>Boolean(tile)&&tile!=='#'&&tile!==' ';
function pathTo(map,start,target){
  const queue=[start],parent=new Map([[start,-1]]);
  for(let i=0;i<queue.length;i++){
    const cell=queue[i];if(cell===target)break;
    for(const n of [cell+1,cell-1,cell+cols,cell-cols])if(walkable(map[n])&&!parent.has(n)){parent.set(n,cell);queue.push(n);}
  }
  if(!parent.has(target))return [];
  const path=[];for(let n=target;n!==start;n=parent.get(n))path.push(n);
  return path.reverse();
}
export function mount(host,api){
  const surface=createSurface(host,{label:'Undercrypt. Tap a floor tile to walk a musical route. Arrow keys move one tile. Play explores automatically. The rune glyphs audition encounter phrases.'});
  const c=surface.ctx,held=new Map(),log=[],trail=[];
  let floor=1,world=generate(floor),player=world.start,route=[],cleared=new Set(),crystals=0,vitality=3,selected='.',nextMove=0,clock=0,lastMidi=api.quantize(0);
  const print=makeFont(),visited=new Set();
  let vault=vaultBackdrop(floor),portrait='.',portraitUntil=0,encounterAt=-10,footsteps=0;
  function rememberRoom(){
    const px=player%cols,py=Math.floor(player/cols);
    for(let y=Math.max(0,py-4);y<=Math.min(rows-1,py+4);y++)
      for(let x=Math.max(0,px-4);x<=Math.min(cols-1,px+4);x++)
        if((x-px)**2+(y-py)**2<=16&&world.map[y*cols+x]!==' ')visited.add(y*cols+x);
  }
  rememberRoom();
  function geometry(){
    const w=surface.width,h=surface.height,wide=w>=h*.94;
    const mapWidth=wide?w*.71:w,mapHeight=wide?h*.81:h*.58;
    const cell=Math.min((mapWidth-12)/cols,mapHeight/rows);
    const rowHeight=wide?cell:Math.min(cell*1.54,mapHeight/rows);
    const y=wide?32+(mapHeight-cell*rows)/2:36;
    const panelY=wide?20:y+rowHeight*rows+24;
    return {cell,rowHeight,x:(mapWidth-cell*cols)/2,y,
      panel:{x:wide?mapWidth+5:10,y:panelY,w:wide?w-mapWidth-13:w-20,h:h-panelY-(wide?18:12)}};
  }
  function runePosition(index,p){
    return {x:p.x+(index+.5)*p.w/5,y:p.y+p.h*.49};
  }
  function enterFloor(n){
    floor=n;world=generate(n);player=world.start;route=[];trail.length=0;cleared=new Set();visited.clear();rememberRoom();vault=vaultBackdrop(floor);footsteps=0;
  }
  function phrase(glyph,when,id=null){
    const patch=instruments[glyph]||instruments['.'],walking=glyph==='.';
    const room=Math.floor(player%cols/12)+3*Math.floor(Math.floor(player/cols)/10);
    const tonic=[0,3,1,4,2,5][room%6]+(floor-1)%3;
    const duration=60/api.state.bpm/(glyph==='w'?4:6);
    const voice=api.state.sound,{cutoff}=voice,tone=runeTones[glyph];
    const tread=[0,0,4,2][footsteps%4];
    patch.steps.forEach((interval,i)=>{
      const midi=api.quantize(tonic+interval+(walking?tread:0),walking?-1:patch.octave);
      const opts={...tone,cutoff:cutoff*tone.cutoff,attack:voice.attack*tone.attack,decay:voice.decay*tone.decay,
        sustain:voice.sustain*tone.sustain,release:voice.release*tone.release,velocity:walking?.94:.86-i*.10};
      if(i===0){lastMidi=midi;if(id){api.noteOn(id,midi,opts);return;}}
      api.audio.pulse('crypt-'+glyph+'-'+i,midi,opts,when+i*duration,duration*(walking?1.15:.85));
    });
    if(walking){
      // The quiet upper reply marks alternate treads against the room bass.
      if(footsteps++%2===0)api.audio.pulse('crypt-echo',api.quantize(tonic+4),{waveform:'square',velocity:.37,cutoff:cutoff*.33,attack:.02,decay:.10,sustain:.25,release:.19},when+duration,.11);
    }else{
      api.audio.pulse('crypt-pedal',api.quantize(tonic,-1),{waveform:'triangle',velocity:.63,attack:.023,decay:.18,sustain:.41,release:.29},when,duration*2.7);
      portraitUntil=clock+2.2;encounterAt=clock;
    }
    if(!walking||clock>=portraitUntil)portrait=glyph;
    selected=glyph;
    if(walking&&log[0]?.glyph==='.'){log[0].count++;log[0].note=api.noteName(lastMidi);}
    else{log.unshift({glyph,note:api.noteName(lastMidi),name:patch.name,count:1});if(log.length>4)log.pop();}
  }
  function move(cell,when,id){
    trail.unshift(player);if(trail.length>9)trail.pop();player=cell;rememberRoom();
    const tile=world.map[cell],glyph=cleared.has(cell)?'.':tile;
    phrase(glyph,when,id);
    if(glyph==='♦')crystals++;
    if(glyph==='!')vitality=Math.min(3,vitality+1);
    if(glyph==='w'){
      vitality--;
      if(vitality===0){vitality=3;crystals=0;enterFloor(1);api.save();return;}
    }
    if(glyph==='>')enterFloor(floor%999+1);
    else if(glyph!=='.')cleared.add(cell);
    api.save();
  }
  function planWalk(target){
    route=pathTo(world.map,player,target);return route.length>0;
  }
  function explore(when){
    if(!route.length){
      const target=world.map.findIndex((tile,i)=>tile!== '>'&&instruments[tile]&&tile!=='.'&&!cleared.has(i));
      planWalk(target>=0?target:world.map.indexOf('>'));
    }
    if(route.length)move(route.shift(),when,null);
  }
  const unbind=bindPointers(surface.canvas,{down(p){
    const g=geometry(),id='crypt-touch-'+p.id;held.set(p.id,id);
    const {panel}=g;
    if(p.x>=panel.x&&p.y>=panel.y&&p.x<panel.x+panel.w&&p.y<panel.y+panel.h){
      const index=Math.floor(clamp((p.x-panel.x)/panel.w,0,.999)*5);
      const rune=runePosition(index,panel);
      if(Math.abs(p.y-rune.y)>Math.min(24,panel.h*.13)){held.delete(p.id);return false;}
      phrase(Object.keys(instruments)[index],api.audio.now,id);return;
    }
    const x=Math.floor((p.x-g.x)/g.cell),y=Math.floor((p.y-g.y)/g.rowHeight);
    let target=y*cols+x;
    if(x<0||x>=cols||y<0||y>=rows||!walkable(world.map[target])){
      // Snap wall touches to the nearest reachable tile.
      let distance=Infinity;world.map.forEach((tile,i)=>{const d=Math.hypot(i%cols-x,Math.floor(i/cols)-y);if(walkable(tile)&&d<distance){target=i;distance=d;}});
    }
    if(planWalk(target))move(route.shift(),api.audio.now,id);else phrase('.',api.audio.now,id);
    nextMove=clock+.17;
  },up(p){api.noteOff(held.get(p.id));held.delete(p.id);},cancel(p){api.noteCancel(held.get(p.id));held.delete(p.id);}});
  function keyboard(e){
    const offset={ArrowUp:-cols,ArrowDown:cols,ArrowLeft:-1,ArrowRight:1}[e.key];
    if(!offset)return;e.preventDefault();api.audio.start();route=[];
    if(walkable(world.map[player+offset]))move(player+offset,api.audio.now,null);
  }
  surface.canvas.addEventListener('keydown',keyboard);
  function draw(t){
    surface.resize();const {width:w,height:h}=surface,g=geometry(),{panel:p,cell,rowHeight}=g;
    c.imageSmoothingEnabled=false;
    c.fillStyle='#080b15';c.fillRect(0,0,w,h);
    const titleScale=w>980?2:1;
    c.fillStyle='#183c78';c.fillRect(0,0,w,22);
    print(c,'UNDERCRYPT',8,Math.floor((22-7*titleScale)/2),titleScale,'#ffffff');
    const level='DEPTH '+String(floor).padStart(2,'0');
    print(c,level,w-level.length*6-8,8,1,'#99ffff');
    const tileScale=Math.max(1,Math.floor(cell/7)),px=player%cols,py=Math.floor(player/cols);
    const motion=api.reducedMotion?0:t;
    const flame=1+.045*Math.sin(motion*4.2)+.025*Math.sin(motion*7.1);
    for(let i=0;i<world.map.length;i++){
      const tile=world.map[i];if(tile===' ')continue;
      const x=i%cols,y=Math.floor(i/cols),left=g.x+x*cell,top=g.y+y*rowHeight;
      const glyph=i===player?'@':cleared.has(i)?'.':tile;
      const near=Math.max(0,1-Math.hypot(x-px,y-py)/(8*api.state.appearance.torch*flame));
      const remembered=visited.has(i),wall=tile==='#';
      c.globalAlpha=1;
      c.fillStyle=wall?'#192c3b':remembered?'#15252e':'#111828';
      c.fillRect(Math.round(left),Math.round(top),Math.round(left+cell)-Math.round(left),Math.round(top+rowHeight)-Math.round(top));
      if(near>0){
        c.globalAlpha=near*.75;c.fillStyle='#805638';
        c.fillRect(Math.round(left),Math.round(top),Math.ceil(cell),Math.ceil(rowHeight));
      }
      c.globalAlpha=(glyph==='.'||wall)?(remembered?.62:.34)+near*.33:1;
      if(tile==='#'){
        // Joined double rules imitate the line-drawing characters in a DOS ROM.
        c.fillStyle=palette['#'];const mx=Math.round(left+cell/2),my=Math.round(top+rowHeight/2),endX=Math.round(left+cell),endY=Math.round(top+rowHeight);
        for(const offset of [-tileScale,tileScale]){
          if(world.map[i-1]==='#')c.fillRect(Math.round(left),my+offset,mx-Math.round(left)+1,tileScale);
          if(world.map[i+1]==='#')c.fillRect(mx,my+offset,endX-mx,tileScale);
          if(world.map[i-cols]==='#')c.fillRect(mx+offset,Math.round(top),tileScale,my-Math.round(top)+1);
          if(world.map[i+cols]==='#')c.fillRect(mx+offset,my,tileScale,endY-my);
        }
      }else{
        const onRoute=route.includes(i),onTrail=trail.includes(i);
        let ink=glyph==='.'&&onRoute?'#70dfdd':glyph==='.'&&onTrail?'#d6ab62':palette[glyph];
        const landmark=glyph!=='@'&&glyph!=='.';
        if(landmark){
          const midX=Math.round(left+cell/2),midY=Math.round(top+rowHeight/2);
          c.fillStyle=ink;c.globalAlpha=.12+.04*Math.sin(motion*2+i);
          c.fillRect(midX-cell*.44,midY-cell*.32,cell*.88,cell*.64);c.globalAlpha=1;
        }
        if(onRoute||onTrail)c.globalAlpha=.9;
        if(glyph==='@'){
          c.fillStyle='#302616';c.fillRect(Math.round(left),Math.round(top),Math.floor(cell),Math.floor(rowHeight));
          ink='#ffef8c';
        }
        const glyphScale=landmark||glyph==='@'?Math.max(tileScale,Math.floor(Math.min(rowHeight/7,cell/5)*2)/2):tileScale;
        print(c,glyph,left+(cell-5*glyphScale)/2,top+(rowHeight-7*glyphScale)/2,glyphScale,ink);
      }
    }
    c.globalAlpha=1;
    print(c,'TAP TO WALK / ARROW KEYS',g.x+2,g.y+rows*rowHeight+5,1,'#aaaaaa');
    const left=p.x+4,sw=p.w-8,top=Math.max(25,p.y);
    const stat='♦ '+String(crystals).padStart(2,'0')+'  '+'♥'.repeat(vitality);
    print(c,stat,left,top+2,1,'#ffff63');
    const note=api.noteName(lastMidi).replace('♯','#').replace('♭','b');
    print(c,note,left+sw-note.length*6,top+2,1,'#55ffff');
    const cx=p.x+p.w*.5,cy=p.y+p.h*.255;
    const iconScale=Math.max(1,Math.floor(Math.min(sw/22,p.h*.023)));
    const viewH=Math.max(1,p.y+p.h*.43-top-16);
    c.drawImage(vault,left,top+16,sw,viewH);
    const sprite=portraits[portrait],age=clock-encounterAt;
    const lift=api.reducedMotion?0:Math.round(Math.sin(motion*2)*iconScale*.32);
    if(age>=0&&age<.65&&!api.reducedMotion){
      c.globalAlpha=(1-age/.65)*.18;c.fillStyle=palette[portrait];
      c.fillRect(left,top+16,sw,viewH);c.globalAlpha=1;
    }
    sprite.forEach((row,y)=>[...row].forEach((pixel,x)=>{
      if(pixel===' ')return;
      c.fillStyle=pixel==='+'?'#fff3c1':palette[portrait];
      c.fillRect(Math.round(cx+(x-5)*iconScale),Math.round(cy+lift+(y-sprite.length/2)*iconScale),iconScale,iconScale);
    }));
    const name=instruments[portrait].name;
    print(c,name,cx-name.length*3,p.y+p.h*.40-4,1,'#aaaacc');
    Object.keys(instruments).forEach((key,i)=>{
      const pos=runePosition(i,p),scale=Math.max(1,Math.min(3,Math.floor(p.h*.075/7)));
      if(key===selected){c.fillStyle=palette[key];c.fillRect(pos.x-scale*4,pos.y-scale*4.5,scale*8,scale*9);}
      print(c,key,pos.x-scale*2.5,pos.y-scale*3.5,scale,key===selected?'#101324':palette[key]);
    });
    const divider=p.y+p.h*.58;c.fillStyle='#183c78';c.fillRect(left,divider,sw,12);
    print(c,'MESSAGE LOG',left+4,divider+2,1,'#ffffff');
    log.slice(0,p.h<140?2:4).forEach((e,i)=>print(c,e.glyph+' '+e.name+(e.count>1?' X'+e.count:'')+' '+e.note.replace('♯','#').replace('♭','b'),left+2,divider+21+i*12,1,palette[e.glyph]));
    if(!log.length)print(c,api.reducedMotion||Math.floor(t*1.5)%2?'> -':'>',left+2,divider+21,1,'#aaaaaa');
  }
  return {
    frame(t){clock=t;if(route.length&&!api.state.playing&&t>=nextMove){nextMove=t+.17;move(route.shift(),api.audio.now,null);}draw(t);},
    onStep(n,when){if(n%2===0)explore(when);},
    setPlaying(on){if(!on)route=[];},
    cancel(){route=[];for(const id of held.values())api.noteCancel(id);held.clear();},
    getData:()=>({floor,player,crystals,vitality,cleared:[...cleared],visited:[...visited]}),
    setData(data){if(!data)return;enterFloor(Math.round(clamp(data.floor??1,1,999)));if(Number.isInteger(data.player)&&walkable(world.map[data.player]))player=data.player;
      visited.clear();if(Array.isArray(data.visited))for(const cell of data.visited)if(Number.isInteger(cell)&&world.map[cell]&&world.map[cell]!==' ')visited.add(cell);
      rememberRoom();
      crystals=Math.round(clamp(data.crystals,0,999999));vitality=Math.round(clamp(data.vitality??3,1,3));if(Array.isArray(data.cleared))cleared=new Set(data.cleared.filter(i=>Number.isInteger(i)&&['w','♦','!'].includes(world.map[i])));},
    destroy(){unbind();surface.canvas.removeEventListener('keydown',keyboard);surface.destroy();}
  };
}
