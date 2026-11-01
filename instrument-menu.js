import {INSTRUMENTS} from './instruments/catalog.js';

const footer=document.querySelector('.footer-tools');
if(footer){
  const button=document.createElement('button');button.id='collection-toggle';button.className='footer-tool';button.type='button';button.setAttribute('aria-label','Choose instrument');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','instrument-menu');button.title='Instruments';button.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z"/></svg>';footer.prepend(button);
  const panel=document.createElement('section');panel.id='instrument-menu';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Instrument collection');
  let batch=-1;panel.innerHTML='<div class="im-heading"><span>Instruments</span><button class="im-close" aria-label="Close instrument collection">×</button></div><div class="im-list">'+INSTRUMENTS.map((item,i)=>{let heading='';if(item.batch!==batch){batch=item.batch;heading=`<div class="im-group">${batch===0?'SIGNAL':`BATCH ${String(batch).padStart(2,'0')}`}</div>`;}return heading+`<a href="${item.href||`./collection.html#${item.id}`}" class="im-entry" ${item.id==='signal'?'aria-current="page"':''} style="--a:${item.colors[0]};--b:${item.colors[1]}"><i aria-hidden="true"></i><span><b>${item.name}</b><small>${item.description}</small></span><em>${String(i+1).padStart(2,'0')}</em></a>`;}).join('')+'</div>';document.body.append(panel);
  function close(focus=false){panel.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});}
  button.addEventListener('click',()=>{if(!panel.hidden){close(true);return;}panel.hidden=false;button.setAttribute('aria-expanded','true');panel.querySelector('a')?.focus({preventScroll:true});});
  panel.querySelector('.im-close').addEventListener('click',()=>close(true));
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#instrument-menu,#collection-toggle'))close();});
  document.addEventListener('keydown',e=>{if(panel.hidden)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);return;}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&panel.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();const links=[...panel.querySelectorAll('a')],i=links.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?links.length-1:(i+(e.key==='ArrowDown'?1:-1)+links.length)%links.length;links[next].focus();}},{capture:true});
}
