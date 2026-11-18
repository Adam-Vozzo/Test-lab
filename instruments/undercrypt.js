import {bindPointers,clamp,createSurface,label,line,seeded,TAU} from './kit.js';

export const definition={
  id:'undercrypt',name:'Undercrypt',layoutMode:'single',keyboardNotes:true,
  theme:{bg:'#171422',fg:'#f1dcc1',accent:'#edac67',muted:'#aaa1ad'},
  defaultSound:{waveform:'triangle',attack:.008,decay:.15,sustain:.38,release:.42,gain:.42,echo:.17,delayTime:.26,feedback:.2},
  defaultAppearance:{torch:1},
  appearanceControls:[{key:'torch',label:'Torch radius',section:'Dungeon',description:'Distance around the player lit by the torch.',min:.5,max:2,step:.05}]
};
const cols=39,rows=21;
const palette={'@':'#ffe3a0','!':'#84e2d2','♦':'#f8c46d','w':'#f5889c','>':'#bdb1ff','#':'#8a799d','.':'#796a79'};
const instruments={
  '.':{name:'FOOTFALL',steps:[0],waveform:'triangle',octave:0},
  '!':{name:'POTION',steps:[0,4,7],waveform:'sine',octave:0},
  '♦':{name:'CRYSTAL',steps:[4,7,11],waveform:'sine',octave:1},
  'w':{name:'WRAITH',steps:[0,1,-3],waveform:'sawtooth',octave:-1},
  '>':{name:'DESCENT',steps:[7,4,2,0],waveform:'triangle',octave:0}
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
const wornFloor=['.','.', '·', '·', '˙', '.', '∴'];
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
  function geometry(){
    const w=surface.width,h=surface.height,wide=w>=h*.94;
    const mapWidth=wide?w*.71:w,mapHeight=wide?h*.81:h*.58;
    const cell=Math.min((mapWidth-12)/cols,mapHeight/rows);
    return {cell,x:(mapWidth-cell*cols)/2,y:32+(mapHeight-cell*rows)/2,
      panel:{x:wide?mapWidth+5:10,y:wide?20:mapHeight+40,w:wide?w-mapWidth-13:w-20,h:wide?h-38:h-mapHeight-52}};
  }
  function runePosition(index,p){
    return {x:p.x+(index+.5)*p.w/5,y:p.y+p.h*.49};
  }
  function enterFloor(n){
    floor=n;world=generate(n);player=world.start;route=[];trail.length=0;cleared=new Set();
  }
  function phrase(glyph,when,id=null){
    const patch=instruments[glyph]||instruments['.'],base=(player%cols+Math.floor(player/cols)*2+floor)%7;
    const duration=60/api.state.bpm/5;
    patch.steps.forEach((interval,i)=>{
      const midi=api.quantize(base+interval,patch.octave),opts={...api.state.sound,waveform:patch.waveform,velocity:.73-i*.09,cutoff:glyph==='w'?950+vitality*160:2600+vitality*300};
      if(i===0){lastMidi=midi;if(id){api.noteOn(id,midi,opts);return;}}
      api.audio.pulse('crypt-'+glyph+'-'+i,midi,opts,when+i*duration,duration*.75);
    });
    selected=glyph;log.unshift({glyph,note:api.noteName(lastMidi),name:patch.name});if(log.length>4)log.pop();
  }
  function move(cell,when,id){
    trail.unshift(player);if(trail.length>9)trail.pop();player=cell;
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
    const x=Math.floor((p.x-g.x)/g.cell),y=Math.floor((p.y-g.y)/g.cell);
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
    surface.resize();const {width:w,height:h}=surface,g=geometry(),{panel:p,cell}=g;
    c.clearRect(0,0,w,h);
    label(c,'UNDERCRYPT',g.x+2,14,'#edc594',13);
    label(c,'DEPTH '+String(floor).padStart(2,'0'),g.x+cell*cols,14,'#af9ab4',10,'right');
    const px=player%cols,py=Math.floor(player/cols);
    const halo=c.createRadialGradient(g.x+(px+.5)*cell,g.y+(py+.5)*cell,0,g.x+(px+.5)*cell,g.y+(py+.5)*cell,cell*6*api.state.appearance.torch);
    halo.addColorStop(0,'#674c385e');halo.addColorStop(1,'transparent');c.fillStyle=halo;c.fillRect(g.x,g.y,cell*cols,cell*rows);
    c.font='bold '+Math.floor(cell*.98)+'px monospace';c.textAlign='center';c.textBaseline='middle';
    for(let i=0;i<world.map.length;i++){
      const tile=world.map[i];if(tile===' ')continue;
      const glyph=i===player?'@':cleared.has(i)?'.':tile,x=i%cols,y=Math.floor(i/cols);
      const near=Math.max(0,1-Math.hypot(x-px,y-py)/(8*api.state.appearance.torch));
      if(tile==='#'){c.fillStyle=(x+y)%3?'#383044':'#413448';c.fillRect(g.x+x*cell,g.y+y*cell,cell-.7,cell-.7);}
      c.fillStyle=route.includes(i)?'#a9c5ab':trail.includes(i)?'#bc926b':palette[glyph];
      c.globalAlpha=glyph==='#'||glyph==='.'?.43+near*.57:1;
      const mark=glyph==='.'?wornFloor[(x*17+y*31+floor)%wornFloor.length]:glyph;
      c.fillText(mark,g.x+(x+.5)*cell,g.y+(y+.53)*cell);
    }
    c.globalAlpha=1;
    label(c,'TAP DESTINATION  /  ↑ ↓ ← →',g.x+2,g.y+rows*cell+12,'#9f929e',9);
    label(c,'♦ '+String(crystals).padStart(2,'0')+'    '+'♥'.repeat(vitality)+'·'.repeat(3-vitality),p.x,p.y+8,palette['♦'],12);
    label(c,api.noteName(lastMidi),p.x+p.w,p.y+8,'#c6afa3',12,'right');
    const cx=p.x+p.w*.5,cy=p.y+p.h*.25,r=Math.min(p.w*.15,p.h*.13);
    const icons={'.':['   .','  /|',' /_|','/___'], '!':[' ╷╷ ',' ├┤ ','╱≈≈╲','╰━━╯'],'♦':['  /\\  ',' /┼┼\\ ',' \\┼┼/ ','  \\/  '],w:[' /\\ /\\','( ◇ ◇ )',' ╲╱╲╱ ','  ░░  '],'>':['╲    ',' ╲━━ ','   ╲━','    ╲']};
    icons[selected].forEach((row,i)=>label(c,row,cx,cy+(i-1.5)*r*.45,palette[selected],Math.max(10,r*.5),'center'));
    label(c,instruments[selected].name,cx,p.y+p.h*.40,'#cbb7b5',10,'center');
    Object.keys(instruments).forEach((key,i)=>{const pos=runePosition(i,p);label(c,key,pos.x,pos.y,palette[key],Math.min(24,p.w*.09),'center');if(key===selected)line(c,[[pos.x-6,pos.y+15],[pos.x+6,pos.y+15]],palette[key]);});
    line(c,[[p.x,p.y+p.h*.58],[p.x+p.w,p.y+p.h*.58]],'#52434f');
    label(c,'TURN LOG',p.x,p.y+p.h*.64,'#9f929e',9);
    log.slice(0,p.h<140?2:4).forEach((e,i)=>label(c,e.glyph+'   '+e.name+'   '+e.note,p.x+4,p.y+p.h*.73+i*Math.min(16,p.h*.07),palette[e.glyph],10));
  }
  return {
    frame(t){clock=t;if(route.length&&!api.state.playing&&t>=nextMove){nextMove=t+.17;move(route.shift(),api.audio.now,null);}draw(t);},
    onStep(n,when){if(n%2===0)explore(when);},
    setPlaying(on){if(!on)route=[];},
    cancel(){route=[];for(const id of held.values())api.noteCancel(id);held.clear();},
    getData:()=>({floor,player,crystals,vitality,cleared:[...cleared]}),
    setData(data){if(!data)return;enterFloor(Math.round(clamp(data.floor??1,1,999)));if(Number.isInteger(data.player)&&walkable(world.map[data.player]))player=data.player;
      crystals=Math.round(clamp(data.crystals,0,999999));vitality=Math.round(clamp(data.vitality??3,1,3));if(Array.isArray(data.cleared))cleared=new Set(data.cleared.filter(i=>Number.isInteger(i)&&['w','♦','!'].includes(world.map[i])));},
    destroy(){unbind();surface.canvas.removeEventListener('keydown',keyboard);surface.destroy();}
  };
}
