(function(){
"use strict";
/* ---------- utilitaires ---------- */
function $(s,r){return(r||document).querySelector(s)}
function $$(s,r){return[].slice.call((r||document).querySelectorAll(s))}
function fmt(v,d){return v.toFixed(d).replace(".",",")}
function lerp(a,b,t){return a+(b-a)*t}
function hex(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function mixHex(h,t,to){var c=hex(h),k=to===255?255:0;return"#"+c.map(function(v){return("0"+Math.round(v+(k-v)*t).toString(16)).slice(-2)}).join("")}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
var hasGsap=!!window.gsap;
function toast(m){var t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toast.h);toast.h=setTimeout(function(){t.classList.remove("on")},2200)}
function getJSON(u){return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error(u);return r.json()})}

Promise.all([getJSON("data/parfums.json"),getJSON("data/bornes.json"),getJSON("data/site.json")]).then(function(d){start(d[0],d[1],d[2])}).catch(function(e){
  console.error(e);document.body.insertAdjacentHTML("afterbegin",'<p style="position:relative;z-index:99;padding:14px 20px;background:#ff5d6c;color:#fff;font-family:sans-serif;margin:0">Les fichiers de données n\'ont pas pu être chargés (dossier data). Vérifie qu\'ils sont bien dans le dépôt.</p>');
});

function start(PJ,BJ,SJ){
var P=PJ.parfums;
var SCENTS=P.map(function(p){return{id:p.id,marque:p.marque,nom:p.nom,genre:p.genre,f:p.famille,c:p.couleur,c1:mixHex(p.couleur,.25,255),c2:mixHex(p.couleur,.45,0)}});
var state={scent:0};
var API={scents:SCENTS,state:state};
function scentLabel(s){return s.marque+" · "+s.nom}

/* ---------- vidéo ---------- */
var vid=SJ.videoId;
var viewUrl=vid?"https://drive.google.com/file/d/"+vid+"/view":"#video";
$$(".video-link").forEach(function(a){a.href=viewUrl;if(vid){a.target="_blank";a.rel="noopener"}});

/* ---------- apparitions, nav ---------- */
var rvs=$$(".rv");
if("IntersectionObserver" in window&&!reduce){
  var rio=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");rio.unobserve(e.target)}})},{threshold:.12,rootMargin:"0px 0px -6% 0px"});
  rvs.forEach(function(el){rio.observe(el)});setTimeout(function(){rvs.forEach(function(el){el.classList.add("in")})},6000);
}else rvs.forEach(function(el){el.classList.add("in")});
var navEl=$("#nav"),prog=$("#prog"),links=$$("#navList a"),secs=links.map(function(a){return $(a.getAttribute("href"))});
function onScroll(){
  var y=window.scrollY,max=document.documentElement.scrollHeight-window.innerHeight;
  navEl.classList.toggle("solid",y>40);prog.style.transform="scaleX("+(max>0?Math.min(1,y/max):0)+")";
  var cur=-1;secs.forEach(function(s,i){if(s&&s.getBoundingClientRect().top<window.innerHeight*.4)cur=i});
  links.forEach(function(a,i){a.classList.toggle("on",i===cur)});
}
window.addEventListener("scroll",onScroll,{passive:true});onScroll();
function onView(el,fn,th){if(!("IntersectionObserver" in window)){fn();return}var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){io.disconnect();fn()}})},{threshold:th||.25});io.observe(el)}
function countUp(el){
  var to=parseFloat(el.dataset.count),d=parseInt(el.dataset.dec||"0",10),suf=el.dataset.suffix||"";
  if(reduce||!hasGsap){el.textContent=fmt(to,d)+suf;return}
  var o={v:0};gsap.to(o,{v:to,duration:1.5,ease:"power3.out",onUpdate:function(){el.textContent=fmt(o.v,d)+suf},onComplete:function(){el.textContent=fmt(to,d)+suf}});
}

/* ---------- borne 3D ---------- */
var hero=window.PshitBorne.create($("#c"),$("#stage"),{rot:-.3},API);
var demoOpts={rot:-.45,drag:true,home:-.45};var demo=window.PshitBorne.create($("#demoC"),$("#demoStage"),demoOpts,API);
var list3d=[hero,demo].filter(Boolean);
if(hero){hero.idle=true;hero.wide=true;hero.resize()}var DCAM=[{rot:-.35,x:0,y:.55,z:7.8,lx:0,ly:.3},{rot:.32,x:0,y:-.2,z:7.0,lx:0,ly:-.5},{rot:-.22,x:0,y:.7,z:8.4,lx:0,ly:.5},{rot:.3,x:0,y:-.7,z:7.2,lx:0,ly:-1.0}];
function demoGo(n,fast){if(!demo)return;var d=DCAM[n],t=fast?0:1.4;demo.vel=0;demoOpts.home=d.rot;
  gsap.to(demo.cam,{x:d.x,y:d.y,z:d.z,lx:d.lx,ly:d.ly,duration:t,ease:"power3.inOut",overwrite:true});
  var dr=d.rot-demo.rot;dr-=Math.round(dr/6.28319)*6.28319;gsap.to(demo,{rot:demo.rot+dr,duration:t,ease:"power3.inOut",overwrite:true})}
if(demo){Object.assign(demo.cam,DCAM[0]);demo.rot=DCAM[0].rot;demoOpts.home=DCAM[0].rot}
var last=performance.now();
function loop(now){var dt=Math.min(.05,(now-last)/1000);last=now;showFrame(dt);list3d.forEach(function(b){b.autoCheck(now);b.tick(dt)});requestAnimationFrame(loop)}
if(list3d.length)requestAnimationFrame(loop);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){list3d.forEach(function(b){b.redraw()})});
function redraw3d(){list3d.forEach(function(b){b.redraw()})}

/* ---------- accueil piloté par le défilement ---------- */
var showEl=$("#show"),chEls=$$(".ch"),NCH=chEls.length;
var GOLD=[226,182,74],LIL=[167,139,250];
var KEYS=[
 {rot:-.6,x:0,y:.15,z:10.2,lx:0,ly:0,off:2.5,c:GOLD,w:0},
 {rot:.55,x:0,y:.7,z:9.2,lx:0,ly:.5,off:-2.5,c:LIL,w:1},
 {rot:-.55,x:0,y:.6,z:8.8,lx:0,ly:.4,off:2.4,c:GOLD,w:0},
 {rot:.35,x:.2,y:.55,z:8.8,lx:.1,ly:.35,off:-2.4,c:[201,160,255],w:0},
 {rot:-.45,x:0,y:.2,z:9.6,lx:0,ly:0,off:2.4,c:GOLD,w:0}];
var STEPS=[0,0,1,2,0];
var tp=0,curCh=-1,vh=window.innerHeight,cycTimer=null,cycI=0,showFlat=false;
function setVH(){vh=window.innerHeight;document.documentElement.style.setProperty("--vh",vh+"px");if(!showFlat)showEl.style.height=Math.round(vh*(1+(NCH-1)*.85))+"px"}
var lastW=window.innerWidth,lastH=window.innerHeight;
window.addEventListener("resize",function(){if(window.innerWidth!==lastW||Math.abs(window.innerHeight-lastH)>150){lastW=window.innerWidth;lastH=window.innerHeight;setVH()}});
function cycPaint(){var s=SCENTS[cycI],n=$("#cycName");n.querySelector("b").textContent=s.nom;n.querySelector("span").textContent=s.marque}
cycPaint();
function setChapter(i){
  if(i===curCh)return;curCh=i;
  chEls.forEach(function(el,k){el.classList.toggle("on",k===i)});
  $("#chapNo").innerHTML="<b>0"+(i+1)+"</b> / 0"+NCH;
  if(hero){hero.setStep(STEPS[i]);hero.spray=(i===3);if(i!==3)hero.sprayT=0;hero.idle=(i===0&&window.scrollY<40)}
  $$("[data-to]",chEls[i]).forEach(function(el){
    var to=parseFloat(el.dataset.to),d=parseInt(el.dataset.dec||"0",10);
    if(reduce||!hasGsap){el.textContent=fmt(to,d);return}
    var o={v:0};gsap.to(o,{v:to,duration:1.25,delay:.35,ease:"power3.out",onUpdate:function(){el.textContent=fmt(o.v,d)},onComplete:function(){el.textContent=fmt(to,d)}});
  });
  clearInterval(cycTimer);
  if(i===1&&!reduce){cycTimer=setInterval(function(){cycI=(cycI+1)%SCENTS.length;state.scent=cycI;cycPaint();redraw3d()},1300)}
}
function showFrame(dt){
  if(showFlat||!hero)return;
  var top=showEl.offsetTop,span=showEl.offsetHeight-vh;
  var p=span>0?Math.max(0,Math.min(1,(window.scrollY-top)/span)):0,t=p*(NCH-1);
  tp+=(t-tp)*Math.min(1,dt*5);
  var i0=Math.min(NCH-2,Math.floor(tp)),f=tp-i0,e=f*f*(3-2*f),A=KEYS[i0],B=KEYS[i0+1];
  if(tp>=NCH-1){i0=NCH-2;e=1;A=KEYS[NCH-2];B=KEYS[NCH-1]}
  var m=window.innerWidth<=860;
  hero.rot=lerp(A.rot,B.rot,e);var c=hero.cam;
  c.x=lerp(A.x,B.x,e);c.y=lerp(A.y,B.y,e);c.z=lerp(A.z,B.z,e);c.lx=lerp(A.lx,B.lx,e);c.ly=lerp(A.ly,B.ly,e);
  if(m){c.ly=.15;c.y=Math.min(c.y,.45);c.z=9.8}hero.off=m?0:lerp(A.off,B.off,e)*Math.min(1,(window.innerWidth/window.innerHeight)/1.6);hero.mobile=m;
  var w=lerp(A.w,B.w,e),sc=hex(SCENTS[state.scent].c);
  var r=Math.round(lerp(lerp(A.c[0],B.c[0],e),sc[0],w*.6)),g=Math.round(lerp(lerp(A.c[1],B.c[1],e),sc[1],w*.6)),b=Math.round(lerp(lerp(A.c[2],B.c[2],e),sc[2],w*.6));
  var key=r+","+g+","+b;if(key!==showFrame.k){showFrame.k=key;showEl.style.setProperty("--acc-rgb",key);hero.setAccent(r,g,b)}
  setChapter(Math.max(0,Math.min(NCH-1,Math.round(t))));
  if(hero.idle&&window.scrollY>=40)hero.idle=false;
  if(curCh===0&&window.scrollY<40)hero.idle=true;
}
if(!hero||reduce||!hasGsap){
  showFlat=true;showEl.classList.add("flat");
  $$("[data-to]").forEach(function(el){el.textContent=fmt(parseFloat(el.dataset.to),parseInt(el.dataset.dec||"0",10))});
  if(hero)hero.visible=false;
}else setVH();
if(hasGsap&&!reduce){
  gsap.set("#ghost",{yPercent:-58});
  gsap.from("#ghost span",{yPercent:60,opacity:0,duration:1.3,stagger:.09,ease:"power4.out"});
  gsap.from(".ch.on .in>*",{opacity:0,y:26,duration:.9,stagger:.1,delay:.35,ease:"power2.out"});
  if(hero){var hs={s:-.9};hero.spin=-.9;gsap.to(hs,{s:0,duration:2.2,ease:"power3.out",onUpdate:function(){if(hero.idle)hero.spin=hs.s}})}
}

/* ---------- démo en quatre gestes ---------- */
var step=0,stepBtns=$$("#steps button"),sbs=$$(".sb"),note=$("#demoNote"),sprayTimer=null;
var sw=$("#swatches");
SCENTS.forEach(function(s,i){var b=document.createElement("button");b.type="button";b.style.setProperty("--c1",s.c1);b.style.setProperty("--c2",s.c2);b.title=scentLabel(s);b.setAttribute("aria-label",scentLabel(s));b.setAttribute("aria-pressed",i===state.scent?"true":"false");
  b.addEventListener("click",function(){setScent(i)});sw.appendChild(b)});
function snamePaint(){var s=SCENTS[state.scent],n=$("#sname");n.querySelector("b").textContent=scentLabel(s);n.querySelector("span").textContent=s.f+" · "+s.genre}
function setScent(i){state.scent=i;$$("#swatches button").forEach(function(b,k){b.setAttribute("aria-pressed",k===i?"true":"false")});snamePaint();redraw3d()}
snamePaint();
function setStep(n){
  step=n;stepBtns.forEach(function(b,i){b.classList.toggle("on",i===n)});sbs.forEach(function(s,i){s.classList.toggle("on",i===n)});
  note.textContent="Étape "+(n+1)+" sur 4";
  if(demo){demo.setStep(n);demo.spray=false;demo.sprayT=0;demoGo(n)}
  clearTimeout(sprayTimer);
}
stepBtns.forEach(function(b,i){b.addEventListener("click",function(){setStep(i)})});
$("[data-next]").addEventListener("click",function(){setStep(1)});
$("#payBtn").addEventListener("click",function(){toast("Paiement accepté");setStep(2)});
$("#sprayBtn").addEventListener("click",function(){if(demo){demo.spray=true;demo.sprayT=0}toast("Pshit !");sprayTimer=setTimeout(function(){setStep(3)},1900)});
$("#againBtn").addEventListener("click",function(){setStep(0)});

/* ---------- les 12 parfums ---------- */
var genre="Tous",selPerfume=null;
var nu=$("#nuancier");
function bottleSvg(c){return'<svg viewBox="0 0 24 32" aria-hidden="true"><rect x="3.5" y="12" width="17" height="18" rx="4.5" fill="'+c+'"/><rect x="9" y="7" width="6" height="5" fill="'+c+'"/><rect x="7.5" y="2" width="9" height="5" rx="1.5" fill="#e2b64a"/><rect x="6.5" y="15" width="2.6" height="11" rx="1.3" fill="#fff" opacity=".3"/></svg>'}
function paintNuancier(){
  nu.innerHTML="";
  SCENTS.forEach(function(s,i){
    if(genre!=="Tous"&&s.genre!==genre)return;
    var b=document.createElement("button");b.type="button";b.setAttribute("role","listitem");b.setAttribute("aria-pressed",selPerfume===i?"true":"false");
    b.innerHTML='<span class="fl" style="--c:'+s.c+'">'+bottleSvg(s.c)+'</span><span><small>'+esc(s.marque)+'</small><b>'+esc(s.nom)+'</b><i>'+esc(s.f)+'</i></span>';
    b.addEventListener("click",function(){selectPerfume(i,true)});nu.appendChild(b);
  });
}
$$("#genreBtns button").forEach(function(b){b.addEventListener("click",function(){genre=b.dataset.g;$$("#genreBtns button").forEach(function(x){x.classList.toggle("on",x===b)});paintNuancier()})});
function stockOf(b,id){var v=b.stockLive&&b.stockLive[id];return v==null?0:v}
function lvl(v){return v<=0?"out":(v<=20?"low":"ok")}
function paintResult(){
  var i=selPerfume==null?0:selPerfume,s=SCENTS[i];
  $("#orb").style.setProperty("--c1",s.c1);$("#orb").style.setProperty("--c2",s.c2);
  $("#rName").textContent=scentLabel(s);$("#rWhy").textContent=s.f+" · "+s.genre;
  $("#rAvail").innerHTML=BORNES.map(function(b){var v=stockOf(b,s.id),l=lvl(v);return'<span class="pill '+l+'"><i></i>'+esc(b.nom)+" · "+(l==="out"?"en rupture":(l==="low"?"bientôt vide":"disponible"))+"</span>"}).join("");
}
function selectPerfume(i,fromGrid){
  selPerfume=i;state.scent=i;paintNuancier();paintResult();$$("#swatches button").forEach(function(b,k){b.setAttribute("aria-pressed",k===i?"true":"false")});snamePaint();redraw3d();
  $("#pickSel").value=String(i);paintBornes();
}

/* ---------- carte, disponibilités, temps de trajet ---------- */
var BORNES=BJ.bornes.map(function(b){b.base=JSON.parse(JSON.stringify(b.stock));b.stockLive=JSON.parse(JSON.stringify(b.stock));return b});
var selBorne=null,user=null,userSim=true,routeCache={},map=null,markers={},userMk=null,routeLayer=null,lastRouteKey="";
var DEFAULT_START={lat:47.3217,lng:5.0415,label:"place de la Libération"};
function hav(a,b){var R=6371,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dLa/2)*Math.sin(dLa/2)+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)*Math.sin(dLo/2);return 2*R*Math.asin(Math.sqrt(x))}
function est(b){if(!user)return null;var km=hav(user,b)*1.3;return{km:km,walk:km/4.8*60,bike:km/15*60,car:Math.max(1,km/22*60+1),real:false}}
function eta(b){if(!user)return null;var k=routeKey(b);return routeCache[k]||est(b)}
function routeKey(b){return user.lat.toFixed(4)+","+user.lng.toFixed(4)+">"+b.id}
function mins(x){return x<1?"moins d'1 min":Math.round(x)+" min"}
function fetchRoute(b){
  if(!user)return Promise.resolve();
  var k=routeKey(b);if(routeCache[k]&&routeCache[k].real)return Promise.resolve(routeCache[k]);
  var base=user.lng+","+user.lat+";"+b.lng+","+b.lat;
  function get(u){var ctl=window.AbortController?new AbortController():null,tm=setTimeout(function(){ctl&&ctl.abort()},6000);return fetch(u,ctl?{signal:ctl.signal}:{}).then(function(r){clearTimeout(tm);return r.json()}).catch(function(){clearTimeout(tm);return null})}
  return Promise.all([get("https://routing.openstreetmap.de/routed-foot/route/v1/foot/"+base+"?overview=full&geometries=geojson"),get("https://routing.openstreetmap.de/routed-car/route/v1/driving/"+base+"?overview=false")]).then(function(r){
    var f=r[0]&&r[0].routes&&r[0].routes[0],c=r[1]&&r[1].routes&&r[1].routes[0],e=est(b);
    if(!f&&!c)return;
    var km=f?f.distance/1000:e.km;
    routeCache[k]={km:km,walk:f?f.duration/60:e.walk,bike:km/15*60,car:c?c.duration/60+1:e.car,geo:f?f.geometry:null,real:!!f};return routeCache[k];
  });
}
var ICON_BORNE='<svg viewBox="0 0 44 64"><path d="M8 62V20Q8 4 22 4Q36 4 36 20V62Z" fill="#1b1534" stroke="#e2b64a" stroke-width="2"/><rect x="13" y="22" width="18" height="13" rx="2" fill="#07050f" stroke="#a78bfa" stroke-width="1"/><rect x="15" y="25" width="4" height="7" rx="1" fill="#d0342c"/><rect x="20" y="25" width="4" height="7" rx="1" fill="#e8c33a"/><rect x="25" y="25" width="4" height="7" rx="1" fill="#7a42d6"/><rect x="14" y="44" width="16" height="10" rx="3" fill="#07050f" stroke="#e2b64a" stroke-width="1.5"/><path d="M17 11q5-3 9 0" stroke="#e2b64a" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="19.5" y="8" width="5" height="4" fill="none" stroke="#e2b64a" stroke-width="1.2"/></svg>';
function bornLevel(b){
  if(b.statut!=="en_service")return"off";
  var n=0,low=0;P.forEach(function(p){var l=lvl(stockOf(b,p.id));if(l==="out")n++;else if(l==="low")low++});
  return n>=6?"off":(n+low>=3?"low":"ok")}
function stLabel(b){return b.statut==="en_service"?'<span class="st ok">En service</span>':(b.statut==="bientot"?'<span class="st soon">Ouverture prévue</span>':'<span class="st off">Hors service</span>')}
function hhmmss(d){return d.toLocaleTimeString("fr-FR")}
var lastUpd=new Date(BJ.maj);
function updLabel(){return BJ.demo?"Simulation actualisée à "+hhmmss(lastUpd):"Mis à jour le "+lastUpd.toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"})}
function orderedBornes(){
  var arr=BORNES.slice();
  if(user)arr.sort(function(a,b){
    var wa=selPerfume!=null?(stockOf(a,SCENTS[selPerfume].id)>0&&a.statut==="en_service"?0:1):0,wb=selPerfume!=null?(stockOf(b,SCENTS[selPerfume].id)>0&&b.statut==="en_service"?0:1):0;
    if(wa!==wb)return wa-wb;return hav(user,a)-hav(user,b)});
  return arr}

/* ---------- module : parfums par état ---------- */
var stockModal=null;
function openStock(id,k){
  var b=BORNES.filter(function(x){return x.id===id})[0];if(!b)return;
  if(!stockModal){stockModal=document.createElement("div");stockModal.className="smodal";stockModal.hidden=true;document.body.appendChild(stockModal);
    stockModal.addEventListener("click",function(e){if(e.target===stockModal||e.target.closest(".sm-x"))closeStock()});
    document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!stockModal.hidden)closeStock()})}
  stockModal.dataset.b=id;stockModal.dataset.k=k;paintStock();stockModal.hidden=false;document.body.classList.add("lock");
  var f=stockModal.querySelector(".sm-x");if(f)f.focus();
}
function closeStock(){stockModal.hidden=true;document.body.classList.remove("lock")}
function paintStock(){
  var b=BORNES.filter(function(x){return x.id===stockModal.dataset.b})[0],k=stockModal.dataset.k;
  var g={ok:[],low:[],out:[]};P.forEach(function(p){g[lvl(stockOf(b,p.id))].push(p)});
  var tabs=[["all","Tous",P.length],["ok","Disponibles",g.ok.length],["low","Bientôt vides",g.low.length],["out","En rupture",g.out.length]];
  var rows=[];["out","low","ok"].forEach(function(l){if(k==="all"||k===l)g[l].forEach(function(p){rows.push('<li class="'+l+'"><i></i><span><b>'+esc(p.nom)+'</b><small>'+esc(p.marque)+'</small></span><em>'+(l==="out"?"Rupture":l==="low"?"Bientôt vide":"Disponible")+'</em></li>')})});
  stockModal.innerHTML='<div class="sm-card" role="dialog" aria-modal="true" aria-label="Parfums de '+esc(b.nom)+'"><div class="sm-h"><div><h3>'+esc(b.nom)+'</h3><p>'+esc(b.lieu)+'</p></div><button type="button" class="sm-x" aria-label="Fermer">×</button></div><div class="sm-tabs">'+tabs.map(function(t){return'<button type="button" data-k="'+t[0]+'" class="'+(t[0]===k?"on":"")+' t-'+t[0]+'">'+t[1]+' <b>'+t[2]+'</b></button>'}).join("")+'</div><ul class="sm-list">'+(rows.length?rows.join(""):'<li class="empty">Aucun parfum dans cette catégorie.</li>')+'</ul><p class="sm-note">'+(BJ.demo?"Disponibilités simulées, elles évoluent au fil des ventes et des saisons.":"Mis à jour en continu.")+'</p></div>';
  $$(".sm-tabs button",stockModal).forEach(function(t){t.addEventListener("click",function(){stockModal.dataset.k=t.dataset.k;paintStock()})});
}
function paintBornes(){
  var box=$("#borneList");if(!box)return;
  var arr=orderedBornes(),want=selPerfume!=null?SCENTS[selPerfume]:null;
  box.innerHTML=arr.map(function(b,idx){
    var e=eta(b),inStock=want?stockOf(b,want.id):null;
    var line=want?(inStock>0&&b.statut==="en_service"?'<span class="avail-yes">'+esc(want.nom)+" disponible</span>":'<span class="avail-no">'+esc(want.nom)+" en rupture</span>"):"";
    var etaH=e?'<div class="eta"><div><b>'+mins(e.walk)+'</b><small>à pied</small></div><div><b>'+mins(e.bike)+'</b><small>à vélo</small></div><div><b>'+mins(e.car)+'</b><small>en voiture</small></div><div><b>'+fmt(e.km,1)+' km</b><small>'+(e.real?"distance":"à vol d'oiseau +30 %")+'</small></div></div>':"";
    var nOk=0,nLow=0,nOut=0,outs=[],lows=[];
    var stock=P.map(function(p){var v=stockOf(b,p.id),l=lvl(v);if(l==="ok")nOk++;else if(l==="low"){nLow++;lows.push(p)}else{nOut++;outs.push(p)}return'<li class="chip '+l+(want&&want.id===p.id?" want":"")+'"><i></i><span>'+esc(p.nom)+'</span></li>'}).join("");
    var live=b.statut==="en_service";
    var counts=live?'<div class="cnt" role="group" aria-label="Voir les parfums par état"><button type="button" class="n ok" data-k="ok"><b>'+nOk+'</b>disponibles</button>'+(nLow?'<button type="button" class="n low" data-k="low"><b>'+nLow+'</b>bientôt vide'+(nLow>1?"s":"")+'</button>':"")+(nOut?'<button type="button" class="n out" data-k="out"><b>'+nOut+'</b>en rupture</button>':"")+'</div>':"";
    var alerts=!live?"":((nOut||nLow)?'<ul class="alerts">'+outs.map(function(p){return'<li class="out"><i></i><b>'+esc(p.nom)+'</b><em>Rupture</em></li>'}).join("")+lows.map(function(p){return'<li class="low"><i></i><b>'+esc(p.nom)+'</b><em>Bientôt vide</em></li>'}).join("")+'</ul>':'<p class="allok">Tous les parfums sont disponibles.</p>');
    var all=live?'<button type="button" class="seeall" data-k="all">Voir les '+P.length+' parfums</button>':"";
    return'<article class="bc'+(selBorne===b.id?" sel":"")+'" data-id="'+b.id+'" tabindex="0"><div class="bc-top"><div><h3>'+esc(b.nom)+'</h3><div class="lieu">'+esc(b.lieu)+'</div></div>'+stLabel(b)+'</div>'+line+etaH+counts+alerts+all+'<div class="bc-foot"><span class="upd">'+esc(updLabel())+'</span><a href="https://www.google.com/maps/dir/?api=1&destination='+b.lat+","+b.lng+'&travelmode=walking" target="_blank" rel="noopener">Itinéraire dans Maps</a></div></article>'}).join("");
  $$(".bc [data-k]",box).forEach(function(bt){bt.addEventListener("click",function(ev){ev.stopPropagation();openStock(bt.closest(".bc").dataset.id,bt.dataset.k)})});
  $$(".bc",box).forEach(function(el){el.addEventListener("click",function(ev){if(ev.target.tagName==="A"||ev.target.closest("[data-k]"))return;chooseBorne(el.dataset.id,true)});el.addEventListener("keydown",function(ev){if(ev.key==="Enter")chooseBorne(el.dataset.id,true)})});
  paintPhone();
  Object.keys(markers).forEach(function(id){var b=BORNES.filter(function(x){return x.id===id})[0];var el=markers[id].getElement();if(el){var d=el.querySelector(".mk");d.className="mk "+bornLevel(b)+(selBorne===id?" sel":"")}});
}
function paintPhone(){
  var arr=orderedBornes(),b=arr[0],e=eta(b);
  $("#phName").textContent=b.nom;$("#phSub").textContent=e?mins(e.walk)+" à pied":b.lieu;
  $("#phPins").innerHTML=BORNES.map(function(x,i){var px=40+i*80,py=[80,50,30][i%3];return'<circle cx="'+px+'" cy="'+py+'" r="7" fill="'+(x===b?"#e2b64a":"#a78bfa")+'"/><circle cx="'+px+'" cy="'+py+'" r="14" fill="none" stroke="'+(x===b?"#e2b64a":"#a78bfa")+'" opacity=".4"/>'}).join("")}
function setUser(pos,sim){
  user={lat:pos.lat,lng:pos.lng};userSim=sim;
  if(map){
    if(!userMk){userMk=L.marker([user.lat,user.lng],{icon:L.divIcon({className:"",html:'<div class="me"></div>',iconSize:[20,20],iconAnchor:[10,10]}),zIndexOffset:800,keyboard:false}).addTo(map)}
    else userMk.setLatLng([user.lat,user.lng]);
  }
  $("#locNote").textContent=sim?"Point de départ simulé : "+(pos.label||"point choisi sur la carte")+". Touche la carte pour le déplacer, ou active ta position.":"Position en direct activée. Les temps de trajet se mettent à jour quand tu bouges.";
  paintBornes();
  var go=orderedBornes()[0];if(!selBorne||selBorne===null)selBorne=go.id;
  Promise.all(BORNES.map(fetchRoute)).then(function(){paintBornes();drawRoute()});
  drawRoute();
}
function drawRoute(){
  if(!map||!user||!selBorne)return;
  var b=BORNES.filter(function(x){return x.id===selBorne})[0],e=eta(b),k=routeKey(b);
  if(routeLayer){map.removeLayer(routeLayer);routeLayer=null}
  var pts=e&&e.geo?e.geo.coordinates.map(function(c){return[c[1],c[0]]}):[[user.lat,user.lng],[b.lat,b.lng]];
  routeLayer=L.polyline(pts,{color:"#6b46c1",weight:6,opacity:.95,className:"route",lineCap:"round"}).addTo(map);
  if(k!==lastRouteKey){lastRouteKey=k;map.fitBounds(L.latLngBounds(pts).pad(.35),{animate:!reduce,duration:.9,maxZoom:16})}
}
function chooseBorne(id,pan){
  selBorne=id;paintBornes();
  var b=BORNES.filter(function(x){return x.id===id})[0];
  if(map){if(user)drawRoute();else map.flyTo([b.lat,b.lng],15,{duration:.9});markers[id]&&markers[id].openPopup()}
}
function popupHtml(b){var e=eta(b);return"<b>"+esc(b.nom)+"</b><br>"+esc(b.adresse)+(e?"<br>"+mins(e.walk)+" à pied · "+mins(e.car)+" en voiture":"")+"<br>"+esc(b.horaires)}
function initMap(){
  var el=$("#map");
  if(!window.L){el.innerHTML='<p style="padding:24px;color:#a89fc4;font-family:sans-serif">La carte n\'a pas pu se charger. Les bornes restent listées à côté.</p>';return}
  map=L.map(el,{zoomControl:true,scrollWheelZoom:false,attributionControl:true}).setView([47.3365,5.0415],12);
  var plan=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'});
  var sat=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Imagery © Esri"});
  plan.addTo(map);L.control.layers({"Plan":plan,"Satellite":sat},null,{position:"topright",collapsed:false}).addTo(map);
  BORNES.forEach(function(b){
    var m=L.marker([b.lat,b.lng],{icon:L.divIcon({className:"",html:'<div class="mk '+bornLevel(b)+'">'+ICON_BORNE+'<span class="dot"></span></div>',iconSize:[44,64],iconAnchor:[22,60],popupAnchor:[0,-56]}),title:b.nom,riseOnHover:true}).addTo(map);
    m.bindPopup(function(){return popupHtml(b)});m.on("click",function(){chooseBorne(b.id)});markers[b.id]=m});
  map.fitBounds(L.latLngBounds(BORNES.map(function(b){return[b.lat,b.lng]})).pad(.25));
  map.on("click",function(ev){setUser({lat:ev.latlng.lat,lng:ev.latlng.lng},true)});
  el.addEventListener("pointerdown",function(){map.scrollWheelZoom.enable()},{once:true});
  setTimeout(function(){map.invalidateSize()},400);
}
var watchId=null;
$("#locBtn").addEventListener("click",function(){
  if(!navigator.geolocation){toast("Localisation indisponible sur cet appareil");return}
  $("#locNote").textContent="Recherche de ta position…";
  if(watchId!=null)navigator.geolocation.clearWatch(watchId);
  var first=true,lastP=null;
  watchId=navigator.geolocation.watchPosition(function(p){
    var pos={lat:p.coords.latitude,lng:p.coords.longitude};
    if(lastP&&hav(lastP,pos)<.03)return;lastP=pos;
    if(hav(pos,{lat:47.3365,lng:5.0415})>60){toast("Tu es loin de Dijon : les temps de trajet seront longs");}
    setUser(pos,false);first=false;
  },function(){$("#locNote").textContent="Position refusée ou indisponible. Touche la carte pour simuler un point de départ.";toast("Position non partagée")},{enableHighAccuracy:true,maximumAge:5000,timeout:12000});
});
var pk=$("#pickSel");
pk.innerHTML='<option value="">Peu importe</option>'+SCENTS.map(function(s,i){return'<option value="'+i+'">'+esc(scentLabel(s))+"</option>"}).join("");
pk.addEventListener("change",function(){if(pk.value==="")selPerfume=null;else selPerfume=parseInt(pk.value,10);paintNuancier();paintResult();paintBornes();if(user)drawRoute()});
/* disponibilités : en démo, de légères variations simulées toutes les 20 s */
function tickStock(){
  if(!BJ.demo)return;lastUpd=new Date();
  BORNES.forEach(function(b,bi){P.forEach(function(p,pi){var base=b.base[p.id];if(base<=0){b.stockLive[p.id]=0;return}
    var d=Math.round(5*Math.sin(Date.now()/60000+bi*1.7+pi*.9));b.stockLive[p.id]=Math.max(base>20?21:1,Math.min(100,base+d))})});
  paintBornes();paintResult();
}
$("#demoBanner").hidden=!BJ.demo;
paintNuancier();paintResult();initMap();
setUser(DEFAULT_START,true);
if(BJ.demo)setInterval(tickStock,20000);

/* ---------- calculateur Pshit Club ---------- */
var pw=$("#perWeek");
function calc(){
  var w=parseInt(pw.value,10),m=Math.round(w*4.33),free=Math.floor(m/11),cost=(m-free)*2;
  $("#perWeekOut").textContent=w;$("#cMonth").textContent=m;$("#cFree").textContent=free;$("#cCost").textContent=cost+" €";
  var d=$("#dots");d.innerHTML="";for(var i=1;i<=m;i++){var e=document.createElement("i");if(i%11===0)e.className="free";d.appendChild(e)}
}
pw.addEventListener("input",calc);calc();
var pips=$("#pips"),pipN=4;
for(var i=0;i<11;i++){var p=document.createElement("i");pips.appendChild(p)}
function pipPaint(){$$("#pips i").forEach(function(e,k){e.classList.toggle("on",k<pipN)});$("#pipSub").textContent=pipN>=11?"Ton prochain pshit est offert !":(11-pipN)+" pshits avant le prochain offert"}
pipPaint();
$("#addPshit").addEventListener("click",function(){pipN=pipN>=11?1:pipN+1;pipPaint();toast("+1 pshit sur ta carte")});
$("#copyBtn").addEventListener("click",function(){var t=$("#codeTxt").textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){toast("Code copié")},function(){toast("Code : "+t)})});

/* ---------- chiffres ---------- */
$$("#rings .ring").forEach(function(r){onView(r,function(){var a=$(".arc",r);a.style.strokeDashoffset=String(327*(1-parseFloat(a.dataset.v)/100));countUp($(".val",r))},.4)});
var YI=["Au lancement : 3 bornes à Dijon, place Darcy, place de la République et Toison d'Or. Les disponibilités sont suivies en direct.","Année 1, objectif du dossier : 8 bornes à Dijon, 18 pshits par borne et par jour, point mort vers le 224e jour, résultat net d'environ 17 400 €.","Année 2 : 20 bornes avec Besançon, 22 pshits par borne et par jour, un technicien salarié prend la tournée.","Année 3 : 35 bornes avec Lyon, 25 pshits par borne et par jour, 493 k€ de chiffre d'affaires."];
function yPaint(i){$$("#cols .col").forEach(function(c,k){c.classList.toggle("on",k===i)});$("#yinfo").textContent=YI[i]}
$$("#cols .col").forEach(function(c,i){c.addEventListener("click",function(){yPaint(i)})});yPaint(0);
$$("[data-count]").forEach(function(el){if(!el.closest(".ring"))onView(el,function(){countUp(el)},.6)});
}
})();
