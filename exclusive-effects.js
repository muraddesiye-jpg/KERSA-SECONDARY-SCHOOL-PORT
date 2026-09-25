(function(){
  'use strict';
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

  function ripple(el,e){
    if(reduce)return;
    const r=el.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    const s=document.createElement('span'); s.className='fx-ripple';
    s.style.left=x+'px'; s.style.top=y+'px'; el.appendChild(s); setTimeout(()=>s.remove(),650);
  }
  function magnetic(){
    if(reduce)return;
    qa('.magnetic,.btn').forEach(el=>{
      if(el.dataset.fxMagnetic)return; el.dataset.fxMagnetic='1';
      el.addEventListener('pointermove',e=>{
        const r=el.getBoundingClientRect(), x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
        el.style.setProperty('--mx',(x*8).toFixed(2)+'px'); el.style.setProperty('--my',(y*6).toFixed(2)+'px');
      });
      el.addEventListener('pointerleave',()=>{el.style.setProperty('--mx','0px');el.style.setProperty('--my','0px')});
      el.addEventListener('pointerdown',e=>ripple(el,e));
    });
  }
  function spotlight(){
    qa('.feature-card,.news-card,.event,.gallery-item,.widget,.panel,.resource-card,.student-record').forEach(el=>{
      if(el.dataset.fxSpot)return;el.dataset.fxSpot='1';el.classList.add('fx-spotlight');
      el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--spot-x',(e.clientX-r.left)+'px');el.style.setProperty('--spot-y',(e.clientY-r.top)+'px')});
    });
  }
  function parallax(){
    if(reduce)return;
    const hero=q('.hero'); if(!hero)return;
    const layers=qa('.aurora,.grid-glow,.particles',hero);
    let ticking=false;
    const run=()=>{ticking=false;const y=window.scrollY;layers.forEach((el,i)=>el.style.transform=`translate3d(0,${y*(i+1)*.045}px,0)`);const inner=q('.hero-inner',hero);if(inner)inner.style.transform=`translate3d(0,${y*.035}px,0)`};
    window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(run)}},{passive:true});run();
  }
  function enhancedReveal(){
    if(!('IntersectionObserver' in window))return;
    const items=qa('.reveal:not(.fx-observed)'); const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view','fx-revealed');io.unobserve(e.target)}}),{threshold:.08,rootMargin:'0px 0px -40px'});
    items.forEach((el,i)=>{el.style.setProperty('--reveal-delay',Math.min(i%6,5)*70+'ms');el.classList.add('fx-observed');io.observe(el)});
  }
  function notificationFX(){
    const toast=q('#toast'); if(toast && !toast.dataset.fx){toast.dataset.fx='1'; const observer=new MutationObserver(()=>{if(toast.textContent.trim())toast.classList.add('fx-notification-pop')});observer.observe(toast,{childList:true,subtree:true,characterData:true});}
    const status=q('#contactStatus'); if(status) status.addEventListener('DOMSubtreeModified',()=>status.classList.add('fx-status-pop'));
  }
  function dashboardGlass(){
    if(!q('.dashboard-body'))return;
    qa('.widget').forEach((el,i)=>{el.style.setProperty('--glass-delay',(i%8)*45+'ms');el.classList.add('glass-card')});
    qa('.panel').forEach(el=>el.classList.add('glass-panel'));
    const header=q('.dash-header');
    if(header && !q('#notificationBell',header)){
      const wrap=document.createElement('span');wrap.className='notification-wrap';
      wrap.innerHTML='<button id="notificationBell" class="notification-bell" aria-label="Show portal notifications" title="Notifications">⌁<i></i></button>';
      const target=header.lastElementChild; if(target)target.prepend(wrap); else header.append(wrap);
      const bell=q('#notificationBell'); bell.addEventListener('click',()=>{const toast=q('#toast');if(toast){toast.textContent='Kersa Portal notifications are active.';toast.classList.add('toast-show','fx-notification-pop');setTimeout(()=>toast.classList.remove('toast-show'),2600)}});
    }
  }
  function cinematicChrome(){
    if(reduce)return;
    if(!q('.fx-progress')){const p=document.createElement('div');p.className='fx-progress';document.body.appendChild(p);window.addEventListener('scroll',()=>{const h=document.documentElement.scrollHeight-innerHeight; p.style.width=(h>0?(scrollY/h)*100:0)+'%'},{passive:true});}
    if(!q('.fx-cursor') && matchMedia('(pointer:fine)').matches){const c=document.createElement('div');c.className='fx-cursor';const d=document.createElement('div');d.className='fx-cursor-dot';document.body.append(c,d);let x=-50,y=-50,tx=-50,ty=-50;addEventListener('pointermove',e=>{tx=e.clientX;ty=e.clientY;d.style.left=tx+'px';d.style.top=ty+'px'});const loop=()=>{x+=(tx-x)*.18;y+=(ty-y)*.18;c.style.left=x+'px';c.style.top=y+'px';requestAnimationFrame(loop)};loop();qa('a,button,.btn,input,select,textarea').forEach(el=>{el.addEventListener('mouseenter',()=>{c.style.width='34px';c.style.height='34px';c.style.borderColor='rgba(255,79,163,.9)'});el.addEventListener('mouseleave',()=>{c.style.width='22px';c.style.height='22px';c.style.borderColor='rgba(157,246,255,.75)'})});}
    qa('.section,.panel,.feature-card,.news-card,.event,.resource-showcase,.contact-wrap').forEach(el=>{if(!el.classList.contains('reveal'))el.classList.add('reveal')});
    enhancedReveal();
  }
  function keyboardMicro(){
    document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.activeElement?.matches('.btn'))document.activeElement.classList.add('fx-keypress')});
    document.addEventListener('keyup',e=>{if(e.key==='Enter')qa('.fx-keypress').forEach(x=>x.classList.remove('fx-keypress'))});
  }
  function init(){document.body.classList.add('fx-ready');magnetic();spotlight();parallax();enhancedReveal();notificationFX();dashboardGlass();keyboardMicro();cinematicChrome();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
