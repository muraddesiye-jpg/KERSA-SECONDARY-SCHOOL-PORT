const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function observeReveals(){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in-view')}),{threshold:.1});document.querySelectorAll('.reveal').forEach(x=>io.observe(x))}
function addTilt(){document.querySelectorAll('.tilt').forEach(el=>{el.onpointermove=e=>{const r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;el.style.transform=`perspective(900px) rotateX(${(-y*4).toFixed(2)}deg) rotateY(${(x*4).toFixed(2)}deg) translateY(-4px)`};el.onpointerleave=()=>el.style.transform=''})}
function particles(){const box=$('particles');if(!box)return;for(let i=0;i<70;i++){const p=document.createElement('i');p.className='particle';p.style.left=Math.random()*100+'%';p.style.top=(75+Math.random()*35)+'%';p.style.animationDuration=(6+Math.random()*9)+'s';p.style.animationDelay=(-Math.random()*12)+'s';box.append(p)}}
async function home(){try{const r=await fetch('/api/public/home'),d=await r.json();if(d.settings?.logo_url){const img=$('siteLogo');img.onload=()=>img.classList.add('loaded');img.onerror=()=>{img.removeAttribute('src');img.classList.remove('loaded')};img.src=d.settings.logo_url}
$('announcementList').innerHTML=d.announcements?.length?d.announcements.map(x=>`<article class="news-card tilt reveal"><time>${new Date(x.created_at).toLocaleDateString()}</time><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p></article>`).join(''):`<article class="news-card reveal"><h3>Welcome to Kersa</h3><p>School announcements will appear here.</p></article>`;
$('eventList').innerHTML=d.events?.length?d.events.map(x=>`<div class="event tilt reveal"><small>${new Date(x.event_date).toLocaleDateString()}</small><h3>${esc(x.title)}</h3><p>${esc(x.description||'School event')}</p></div>`).join(''):`<div class="event reveal"><h3>Upcoming activities</h3><p>School events will appear here.</p></div>`;
$('galleryList').innerHTML=d.gallery?.length?d.gallery.map(x=>`<figure class="gallery-item tilt reveal"><img src="${esc(x.image_url)}" alt="${esc(x.title)}" loading="lazy"><p>${esc(x.title)}</p></figure>`).join(''):`<div class="gallery-item reveal"><p>Add school moments from the Administration → Gallery panel.</p></div>`;
(d.acknowledgment||[]).forEach(x=>{const img=document.querySelector(`[data-ack-image="${x.slot}"]`),ph=document.querySelector(`[data-ack-placeholder="${x.slot}"]`);if(img)img.src=x.image_url;if(ph)ph.style.display='none';});observeReveals();addTilt();}catch(e){console.error(e)}finally{document.body.classList.add('loaded-page')}}
async function sendContact(e){e.preventDefault();const f=e.target,st=$('contactStatus');st.textContent='Sending…';try{const r=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not send');f.reset();st.textContent='✓ Message delivered to the Kersa Contact Center.'}catch(err){st.textContent='✕ '+err.message}}
$('menuBtn')?.addEventListener('click',()=>$('mobileNav').classList.toggle('open'));document.querySelectorAll('#mobileNav a').forEach(a=>a.addEventListener('click',()=>$('mobileNav').classList.remove('open')));$('contactForm')?.addEventListener('submit',sendContact);document.addEventListener('mousemove',e=>{const g=document.querySelector('.cursor-glow');if(g){g.style.left=e.clientX+'px';g.style.top=e.clientY+'px'}});window.addEventListener('load',()=>{particles();home();observeReveals();addTilt()});


// Premium utility interactions
(function(){
  const progress=document.getElementById('scrollProgress');
  const top=document.getElementById('backTop');
  const update=()=>{const h=document.documentElement.scrollHeight-window.innerHeight; const p=h>0?(window.scrollY/h)*100:0; if(progress) progress.style.width=p+'%'; if(top) top.classList.toggle('show',window.scrollY>600)};
  window.addEventListener('scroll',update,{passive:true}); update();
  if(top) top.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
})();
  
