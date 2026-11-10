/* Borne Le Dernier Pshit en 3D (three.js r128).
   Design du pack « rendu visé » : colonne noire 0,80 × 1,90 × 0,50 m, capot en surplomb avec logo flacon doré,
   profil de flanc en S (creux au niveau de l'écran), rubans LED dorés + violets le long du flanc,
   diffuseur sous le capot, écran tactile incliné, lecteur sans contact, fente carte, niche de récupération.
   Unités de scène = mètres × S. */
(function(){
"use strict";
var S=2.105,W=.8*S,H=1.9*S,D=.5*S,PX=420;
var GOLD="#E2B64A",GOLDP="#F3D98B";
function V(z,y){return new THREE.Vector2(z*S,y*S)}
/* profil de flanc relevé sur le rendu de référence (z = profondeur, y = hauteur, en mètres) :
   bas vertical à 0,385 m, grand creux concave (écran) puis cove qui revient sous le capot à 0,50 m */
var CHAIN=[[.385,.62],[.372,.76],[.338,.86],[.30,.98],[.266,1.11],[.25,1.24],[.252,1.33],[.285,1.40],[.35,1.46],[.43,1.50],[.5,1.52]];
var CURVE=new THREE.SplineCurve(CHAIN.map(function(p){return new THREE.Vector2(p[0],p[1])}));
var SAMPLES=CURVE.getPoints(300);
function surfAt(ym){var best=SAMPLES[0],i,k=0;for(i=0;i<SAMPLES.length;i++)if(Math.abs(SAMPLES[i].y-ym)<Math.abs(best.y-ym)){best=SAMPLES[i];k=i}
  var a=SAMPLES[Math.max(0,k-3)],b=SAMPLES[Math.min(SAMPLES.length-1,k+3)];return{z:best.x,ang:Math.atan2(a.x-b.x,b.y-a.y)}}
function profile(){
  var s=new THREE.Shape();
  s.moveTo(0,.08*S);s.lineTo(.385*S,.08*S);s.lineTo(.385*S,.62*S);
  s.splineThru(CHAIN.slice(1).map(function(p){return V(p[0],p[1])}));
  s.lineTo(.5*S,1.83*S);s.quadraticCurveTo(.5*S,1.9*S,.43*S,1.9*S);
  s.lineTo(.08*S,1.9*S);s.quadraticCurveTo(0,1.9*S,0,1.82*S);s.lineTo(0,.08*S);
  return s;
}
/* normales lissées (angle < ~35°) pour éviter les facettes sur les courbes */
function smooth(g){
  g.computeVertexNormals();var p=g.attributes.position,n=g.attributes.normal,map={},i,key;
  function k(i){return Math.round(p.getX(i)*500)+","+Math.round(p.getY(i)*500)+","+Math.round(p.getZ(i)*500)}
  for(i=0;i<p.count;i++){key=k(i);(map[key]||(map[key]=[])).push(i)}
  var out=new Float32Array(n.count*3);
  for(i=0;i<p.count;i++){var grp=map[k(i)],sx=0,sy=0,sz=0,nx=n.getX(i),ny=n.getY(i),nz=n.getZ(i);
    for(var j=0;j<grp.length;j++){var q=grp[j];if(nx*n.getX(q)+ny*n.getY(q)+nz*n.getZ(q)>.82){sx+=n.getX(q);sy+=n.getY(q);sz+=n.getZ(q)}}
    var l=Math.sqrt(sx*sx+sy*sy+sz*sz)||1;out[i*3]=sx/l;out[i*3+1]=sy/l;out[i*3+2]=sz/l}
  g.setAttribute("normal",new THREE.BufferAttribute(out,3));
}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function bottle(c,cx,cy,s,col,cap){
  c.save();c.translate(cx,cy);c.scale(s,s);
  c.fillStyle=col;rr(c,-9,-4,18,19,4);c.fill();
  c.fillStyle="rgba(255,255,255,.28)";c.fillRect(-6,1,3,11);
  c.fillStyle=col;c.fillRect(-3.5,-8,7,5);
  c.fillStyle=cap||"#d9b45a";rr(c,-5,-13,10,6,1.5);c.fill();c.restore();
}
/* ---- écran tactile (680 × 370) ---- */
var SCW=680,SCH=470;
function drawScreen(c,st,P){
  var w=SCW,h=370,i,cx=w/2,sc=P.scents[st.scent];
  var g=c.createLinearGradient(0,0,w,SCH);g.addColorStop(0,"#1a1430");g.addColorStop(1,"#07050d");c.fillStyle=g;c.fillRect(0,0,w,SCH);c.save();c.translate(0,50);
  c.textAlign="center";c.fillStyle="#fff";
  if(st.step===0){
    c.font="700 27px Manrope,'Segoe UI',sans-serif";c.fillText("Choisissez votre parfum",cx,46);
    var pg=Math.floor(st.scent/3),area=w-100,bw=area/3-10;
    for(i=0;i<3;i++){
      var k=pg*3+i,s=P.scents[k],bx=50+i*(area/3)+5,on=k===st.scent;
      c.fillStyle=on?"rgba(255,255,255,.12)":"rgba(255,255,255,.04)";rr(c,bx,66,bw,222,14);c.fill();
      c.strokeStyle=on?GOLD:"rgba(255,255,255,.14)";c.lineWidth=on?4:2;c.stroke();
      bottle(c,bx+bw/2,138,4.4,s.c,"#E2B64A");
      c.fillStyle="#fff";c.font="800 17px Manrope,sans-serif";c.fillText(s.marque.split(" ")[0],bx+bw/2,222);
      c.fillStyle="#d8d1ee";c.font="700 15px Manrope,sans-serif";c.fillText(s.nom.length>13?s.nom.slice(0,12)+"…":s.nom,bx+bw/2,250);
    }
    c.fillStyle="#fff";c.font="700 40px Manrope,sans-serif";c.fillText("‹",26,196);c.fillText("›",w-26,196);
    for(i=0;i<4;i++){c.fillStyle=i===pg?"#fff":"rgba(255,255,255,.3)";c.beginPath();c.arc(cx-30+i*20,312,5.5,0,7);c.fill()}
    c.fillStyle=GOLD;rr(c,cx-110,h-50,220,36,18);c.fill();c.fillStyle="#1b1534";c.font="800 20px Manrope,sans-serif";c.fillText("1 PSHIT · 2 €",cx,h-24);
  }else if(st.step===1){
    c.fillStyle=GOLD;c.font="800 24px Manrope,sans-serif";c.fillText("Paiement sans contact",cx,46);
    bottle(c,cx,118,3.6,sc.c,"#E2B64A");
    c.fillStyle="#fff";c.font="600 34px 'Playfair Display',Georgia,serif";c.fillText(sc.nom.length>16?sc.nom.slice(0,15)+"…":sc.nom,cx,214);
    c.fillStyle=GOLD;c.font="800 54px Manrope,sans-serif";c.fillText("2 €",cx,270);
    c.fillStyle="#d8d1ee";c.font="700 18px Manrope,sans-serif";c.fillText("Approchez votre carte ou votre téléphone",cx,318);
    c.fillStyle="#a89fc4";c.font="600 16px Manrope,sans-serif";c.fillText("À emporter : 3 ml 6 € · 5 ml 9,99 €",cx,346);
  }else if(st.step===2){
    c.fillStyle=GOLD;c.font="800 24px Manrope,sans-serif";c.fillText("Paiement accepté",cx,48);
    c.strokeStyle="#7dffa6";c.lineWidth=10;c.lineCap="round";c.beginPath();c.moveTo(cx-48,150);c.lineTo(cx-12,188);c.lineTo(cx+54,108);c.stroke();
    c.fillStyle="#fff";c.font="600 40px 'Playfair Display',Georgia,serif";c.fillText("Face au diffuseur",cx,270);
    c.fillStyle="#d8d1ee";c.font="700 18px Manrope,sans-serif";c.fillText("Fermez les yeux, un pshit",cx,314);
  }else{
    c.fillStyle=GOLD;c.font="800 24px Manrope,sans-serif";c.fillText("Merci",cx,48);
    bottle(c,cx,118,3.8,sc.c,"#E2B64A");
    c.fillStyle="#fff";c.font="600 40px 'Playfair Display',Georgia,serif";c.fillText("Bonne journée",cx,246);
    c.fillStyle="#d8d1ee";c.font="700 18px Manrope,sans-serif";c.fillText("+1 pshit sur votre carte Pshit Club",cx,306);
  }
  c.restore();
}
/* ---- bas de façade : lecteur sans contact, fente carte, niche (672 × 571) ---- */
var LW=672,LH=571;
function drawLower(c,st,P){
  var w=LW,h=LH,i,cx=w/2,sc=P.scents[st.scent];
  var g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#17141f");g.addColorStop(.5,"#0d0b14");g.addColorStop(1,"#08070c");c.fillStyle=g;c.fillRect(0,0,w,h);
  var ny=62,nx=235,nfc=st.step===1;
  c.fillStyle="#0a0712";c.beginPath();c.ellipse(nx,ny,56,44,0,0,7);c.fill();c.strokeStyle="rgba(255,255,255,.18)";c.lineWidth=2;c.stroke();
  if(nfc){var rg=c.createRadialGradient(nx,ny,4,nx,ny,130);rg.addColorStop(0,"rgba(255,226,160,.7)");rg.addColorStop(1,"rgba(255,226,160,0)");c.fillStyle=rg;c.fillRect(nx-140,ny-140,280,280)}
  c.strokeStyle=nfc?"#ffe6a8":"#f1ecfa";c.lineWidth=nfc?6:4.5;c.lineCap="round";
  for(i=0;i<3;i++){c.beginPath();c.arc(nx-14,ny,12+i*11,-.9,.9);c.stroke()}
  c.fillStyle="#05040a";rr(c,483-40,ny-27,80,54,8);c.fill();c.strokeStyle="rgba(255,255,255,.25)";c.lineWidth=2;c.stroke();
  c.fillStyle="#d9d4e8";rr(c,483-26,ny-5,52,9,3);c.fill();
  /* niche de récupération */
  var ax=143,ay=176,aw=386,ah=202,glow=st.step===2?1:(st.step===1?.5:.8);
  c.fillStyle="#07050d";rr(c,ax,ay,aw,ah,24);c.fill();c.strokeStyle="#C99A2E";c.lineWidth=7;c.stroke();
  var ig=c.createLinearGradient(0,ay,0,ay+ah);ig.addColorStop(0,"rgba(255,214,150,"+(.5*glow)+")");ig.addColorStop(1,"rgba(110,64,180,"+(.14*glow)+")");
  c.fillStyle=ig;rr(c,ax+8,ay+8,aw-16,ah-16,18);c.fill();
  var sg=c.createRadialGradient(cx,ay+10,2,cx,ay+10,120);sg.addColorStop(0,"rgba(255,240,200,.95)");sg.addColorStop(1,"rgba(255,240,200,0)");c.fillStyle=sg;c.fillRect(ax,ay,aw,ah*.75);
  bottle(c,cx,ay+112,4.2,st.step===3?sc.c:"#e8d6a0","#E2B64A");
  c.textAlign="center";c.fillStyle="rgba(255,255,255,.75)";c.font="800 13px Manrope,sans-serif";c.fillText("Retirez votre échantillon",cx,ay+ah-14);
  /* grand ruban doré qui balaie le bas de la façade */
  c.save();c.lineCap="round";
  function L(){c.beginPath();c.moveTo(w+20,300);c.bezierCurveTo(w-10,420,w*.62,h-40,w*.3,h+8)}
  c.shadowColor="rgba(226,182,74,.9)";c.shadowBlur=20;c.strokeStyle="#D9A431";c.lineWidth=11;L();c.stroke();c.restore();
}
function drawBack(c,w,h){
  var g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#15121f");g.addColorStop(1,"#08070d");c.fillStyle=g;c.fillRect(0,0,w,h);
  c.strokeStyle="rgba(255,255,255,.07)";c.lineWidth=3;rr(c,w*.1,h*.12,w*.8,h*.76,16);c.stroke();
  bottle(c,w/2,h*.2,3.2,"rgba(0,0,0,0)","#E2B64A");c.strokeStyle=GOLD;c.lineWidth=3;c.strokeRect(w/2-17,h*.2-24,34,40);
  c.fillStyle="#030208";for(var i=0;i<7;i++)rr(c,w*.56,h*.66+i*18,w*.3,8,4),c.fill();
}
function makeEnv(r){
  var s=new THREE.Scene(),m;
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20,24,16),new THREE.MeshBasicMaterial({color:0x0d0a1a,side:THREE.BackSide})));
  function panel(w,h,x,y,z,ry,c){m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));m.position.set(x,y,z);m.rotation.y=ry;s.add(m)}
  panel(9,5,-8,3,6,1.0,0xe9dcff);panel(6,10,9,2,3,-1.2,0x8d82b8);panel(14,3,0,9,2,0,0xffffff);panel(6,4,0,-2,-10,0,0xE2B64A);
  var p=new THREE.PMREMGenerator(r);var t=p.fromScene(s,.03).texture;p.dispose();return t;
}
function spriteTex(){
  var c=document.createElement("canvas");c.width=c.height=64;var x=c.getContext("2d"),g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.4,"rgba(255,255,255,.45)");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}

function fail(box,e){try{console.error("[Pshit 3D]",e)}catch(_){}box.classList.add("no-webgl");var p=box.querySelector(".fallback3d p");if(p)p.textContent="Aperçu 3D indisponible sur ce navigateur ("+String(e&&e.message||e).slice(0,120)+")."}
function create(canvas,box,opts,P){try{return createInner(canvas,box,opts,P)}catch(e){fail(box,e);return null}}
function createInner(canvas,box,opts,P){
  var renderer;
  try{renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true,powerPreference:"high-performance"})}catch(e){box.classList.add("no-webgl");return null}
  if(!renderer||!renderer.getContext()){box.classList.add("no-webgl");return null}
  renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  var scene=new THREE.Scene();scene.environment=makeEnv(renderer);
  var camera=new THREE.PerspectiveCamera(30,1,.1,60);
  var pivot=new THREE.Group();scene.add(pivot);
  var body=new THREE.Group();body.position.set(-W/2,-H/2,-D/2);pivot.add(body);
  var i;
  var model=new THREE.Group();model.scale.set(S*.80,S*1.08,S*.88);model.position.y=-H*1.08/2;pivot.add(model);
  var SY=1.445*S*1.08-H*1.08/2,SZ=.40*S*.88;
  /* écran tactile : texture dessinée en direct (4 gestes) */
  var pc=document.createElement("canvas");pc.width=SCW;pc.height=SCH;var pctx=pc.getContext("2d");
  var ptex=new THREE.CanvasTexture(pc);ptex.flipY=false;ptex.encoding=THREE.sRGBEncoding;ptex.anisotropy=8;
  var M={},cones=[];
  var loader=new THREE.GLTFLoader();
  loader.load("assets/borne.glb?v=8",function(g){
    try{
    model.add(g.scene);
    g.scene.traverse(function(o){
      if(!o.isMesh)return;var mt=o.material,n=(mt.name||"");
      if(o.name.indexOf("Faisceau")===0){mt.color=new THREE.Color(0x8e62ff);mt.emissive=new THREE.Color(0);mt.transparent=true;mt.opacity=.07;mt.depthWrite=false;mt.blending=THREE.AdditiveBlending;mt.side=THREE.DoubleSide;cones.push(mt);return}
      if(n.indexOf("Noir satiné")===0){mt.color=new THREE.Color(0x0a0716);mt.emissive=new THREE.Color(0x24135a);mt.emissiveIntensity=.07;mt.envMapIntensity=.5;mt.roughness=.34;mt.metalness=Math.min(.7,mt.metalness)}
      else if(n.indexOf("Noir mat")===0){mt.color=new THREE.Color(0x090612);mt.emissive=new THREE.Color(0x1a0e44);mt.emissiveIntensity=.06}
      else if(n.indexOf("Or brossé")===0){mt.envMapIntensity=1.3}
      else if(n.indexOf("LED violette")===0){mt.emissiveIntensity=3.4;M.vio=mt}
      else if(n.indexOf("LED dorée")===0){mt.emissiveIntensity=2.8;M.or=mt}
      else if(n.indexOf("LED blanc")===0){mt.emissiveIntensity=3.2}
      else if(n.indexOf("Fond de niche")===0){mt.emissiveIntensity=1.3;M.niche=mt}
      else if(n.indexOf("Flacon")===0){M.fl=mt}
      else if(n.indexOf("Lecteur")===0){M.nfc=mt}
      else if(n.indexOf("Écran")===0||n.indexOf("Ecran")===0||n.indexOf("cran tactile")>=0){mt.map=null;mt.emissiveMap=ptex;mt.emissive=new THREE.Color(0xffffff);mt.emissiveIntensity=1.25;mt.color=new THREE.Color(0x000000);M.scr=mt}
      o.frustumCulled=false;
    });
    api.ready=true;api.redraw();
    }catch(e){api.dead=true;fail(box,e)}
  },undefined,function(e){api.dead=true;fail(box,e)});
  /* halo au sol */
  var fc=document.createElement("canvas");fc.width=fc.height=256;var fx=fc.getContext("2d"),fg=fx.createRadialGradient(128,128,0,128,128,128);
  fg.addColorStop(0,"rgba(255,255,255,.9)");fg.addColorStop(.45,"rgba(255,255,255,.28)");fg.addColorStop(1,"rgba(255,255,255,0)");fx.fillStyle=fg;fx.fillRect(0,0,256,256);
  var floorMat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(fc),transparent:true,depthWrite:false,color:0x8b5cf6,blending:THREE.AdditiveBlending});
  var floor=new THREE.Mesh(new THREE.PlaneGeometry(4.6,4.6),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-H/2-.02;scene.add(floor);
  /* éclairage de studio */
  scene.add(new THREE.AmbientLight(0xffffff,.3));
  var key=new THREE.DirectionalLight(0xfff1e0,.55);key.position.set(-4,5,7);scene.add(key);
  var rim=new THREE.DirectionalLight(0x9d7bff,.8);rim.position.set(6,3,-5);scene.add(rim);
  var fill=new THREE.DirectionalLight(0xffd9a0,.4);fill.position.set(5,1,6);scene.add(fill);
  var hemi=new THREE.HemisphereLight(0x9a80ff,0x1a0f40,.05);scene.add(hemi);
  var vA=new THREE.PointLight(0x9a6bff,.55,4);vA.position.set(-1.3,.2,1.6);pivot.add(vA);
  var vB=new THREE.PointLight(0x6f8bff,.4,4);vB.position.set(1.2,1.0,1.5);pivot.add(vB);
  var gB=new THREE.PointLight(0xffc15a,.4,3.5);gB.position.set(.4,-1.2,1.5);pivot.add(gB);
  var warm=new THREE.PointLight(0xffd699,.7,4);warm.position.set(0,.5,2.4);pivot.add(warm);
  /* brume du pshit */
  var N=190,pp=new Float32Array(N*3),pcol=new Float32Array(N*3),vel=new Float32Array(N*3),age=new Float32Array(N).fill(9),life=new Float32Array(N);
  var pgeo=new THREE.BufferGeometry();pgeo.setAttribute("position",new THREE.BufferAttribute(pp,3));pgeo.setAttribute("color",new THREE.BufferAttribute(pcol,3));
  var mist=new THREE.Points(pgeo,new THREE.PointsMaterial({size:.08,map:spriteTex(),vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true}));
  mist.frustumCulled=false;pivot.add(mist);
  var api={renderer:renderer,pivot:pivot,camera:camera,visible:true,rot:opts.rot||0,vel:0,drag:false,
    cam:{x:0,y:.2,z:9.4,lx:0,ly:0},step:0,spray:false,sprayT:0,zoom:1,off:0,spin:0,idle:false,mobile:false,t:0};
  P.state.cone=1;
  function redraw(){
    var st={step:api.step,scent:P.state.scent},sc=P.scents[st.scent];
    pctx.clearRect(0,0,pc.width,pc.height);drawScreen(pctx,st,{scents:P.scents});ptex.needsUpdate=true;
    if(M.nfc){M.nfc.emissive=new THREE.Color(0xffffff);M.nfc.emissiveMap=M.nfc.map;M.nfc.emissiveIntensity=st.step===1?.9:0}
    if(M.niche)M.niche.emissiveIntensity=st.step===2?2.2:(st.step===3?1.6:1.2);
    if(M.fl){var c=new THREE.Color(st.step===3?sc.c:"#e8b24a");M.fl.color.copy(c);M.fl.emissive=c.clone();M.fl.emissiveIntensity=.5}
  }
  api.redraw=redraw;redraw();
  api.setAccent=function(r,g,b){floorMat.color.setRGB(r/255*.9,g/255*.9,b/255*.9)};
  api.setStep=function(s){if(s!==api.step){api.step=s;redraw()}};
  api.resize=function(){var cvs=renderer.domElement,w=cvs.clientWidth||box.clientWidth,h=cvs.clientHeight||box.clientHeight;if(!w||!h)return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(w,h,false);
    camera.aspect=w/h;api.zoom=(camera.aspect<.9?1+(.9-camera.aspect)*1.25:1)*(api.wide?1.14+Math.max(0,Math.min(.3,(camera.aspect-1.7)*.3)):1);camera.updateProjectionMatrix()};
  api.tick=function(dt){
    if(!api.visible||api.dead)return;
    try{api.tickInner(dt)}catch(e){api.dead=true;fail(box,e)}
  };
  api.tickInner=function(dt){
    api.t+=dt;
    if(api.idle&&!api.drag)api.spin+=(Math.sin(api.t*.7)*.3-api.spin)*Math.min(1,dt*2.5);else api.spin+=(0-api.spin)*Math.min(1,dt*3);
    if(Math.abs(api.vel)>1e-4&&!api.drag){api.rot+=api.vel;api.vel*=.94}
    pivot.rotation.y=api.rot+api.spin;pivot.position.x=api.off;
    cones.forEach(function(m){m.opacity=.07+.02*Math.sin(api.t*2.2)+(api.spray?.06:0)});
    var c=api.cam;camera.position.set(c.x,c.y,c.z*api.zoom);camera.lookAt(c.lx,c.ly,0);
    if(api.spray)api.sprayT+=dt;
    var emit=api.spray&&((api.sprayT%1.7)<.75);
    for(var i=0;i<N;i++){
      if(age[i]>=life[i]){
        if(emit&&Math.random()<dt*80){
          pp[i*3]=(Math.random()-.5)*.05;pp[i*3+1]=SY-.06;pp[i*3+2]=SZ+.02;
          vel[i*3]=(Math.random()-.5)*.5;vel[i*3+1]=-(.5+Math.random()*.7);vel[i*3+2]=.1+Math.random()*.35;
          age[i]=0;life[i]=.6+Math.random()*.55;
        }else{pcol[i*3]=pcol[i*3+1]=pcol[i*3+2]=0;continue}
      }
      age[i]+=dt;var f=1-age[i]/life[i];
      pp[i*3]+=vel[i*3]*dt;pp[i*3+1]+=vel[i*3+1]*dt;pp[i*3+2]+=vel[i*3+2]*dt;vel[i*3+1]-=.9*dt;
      pcol[i*3]=f*.85;pcol[i*3+1]=f*.72;pcol[i*3+2]=f;
    }
    pgeo.attributes.position.needsUpdate=true;pgeo.attributes.color.needsUpdate=true;
    renderer.render(scene,camera);
  };
  if(window.ResizeObserver){var ro=new ResizeObserver(api.resize);ro.observe(box);ro.observe(renderer.domElement)}window.addEventListener("resize",api.resize);api.resize();
  if("IntersectionObserver" in window)new IntersectionObserver(function(e){api.visible=e[0].isIntersecting},{rootMargin:"120px"}).observe(box);
  var idleAt=0;
  if(opts.drag){
    var lx=0;canvas.addEventListener("pointerdown",function(e){api.drag=true;lx=e.clientX;api.vel=0;try{canvas.setPointerCapture(e.pointerId)}catch(_){}});
    canvas.addEventListener("pointermove",function(e){if(!api.drag)return;var dx=e.clientX-lx;lx=e.clientX;api.rot+=dx*.011;api.vel=dx*.011});
    var up=function(){api.drag=false;idleAt=performance.now()};
    canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",up);
  }
  api.autoCheck=function(now){if(opts.home!==undefined&&!api.drag&&now-idleAt>1500){var d=opts.home-api.rot;d-=Math.round(d/6.28319)*6.28319;api.rot+=d*.04}};
  canvas.addEventListener("webglcontextlost",function(e){e.preventDefault()});
  canvas.addEventListener("webglcontextrestored",function(){ptex.needsUpdate=true;api.redraw()});
  return api;
}
window.PshitBorne={create:create};
})();
