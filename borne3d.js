/* Borne Le Dernier Pshit en 3D (three.js r128).
   Design : borne bleu nuit à reflets violets, filets dorés, logo flacon doré sur le capot,
   écran tactile, lecteur sans contact, fente carte et niche de distribution (cf. maquette). */
(function(){
"use strict";
var W=1.68,H=4.0,D=1.05,K=0.2,HOOD=0.9,PX=500;
var GOLD="#E2B64A",GOLDP="#F3D98B",CREAM="#F5EFE6";

function archShape(inset,asPath){
  var s=asPath?new THREE.Path():new THREE.Shape(),r=Math.max(.02,K-inset);
  s.moveTo(inset,inset);s.lineTo(W-inset,inset);s.lineTo(W-inset,H-K);
  s.absarc(W-K,H-K,r,0,Math.PI/2,false);s.lineTo(K,H-inset);s.absarc(K,H-K,r,Math.PI/2,Math.PI,false);s.lineTo(inset,inset);return s;
}
function hoodShape(){var s=new THREE.Shape(),x0=-.05,x1=W+.05,y0=H-HOOD,y1=H+.02,r=.22;
  s.moveTo(x0,y0+.02);s.lineTo(x1,y0+.02);s.lineTo(x1,y1-r);s.absarc(x1-r,y1-r,r,0,Math.PI/2,false);s.lineTo(x0+r,y1);s.absarc(x0+r,y1-r,r,Math.PI/2,Math.PI,false);s.lineTo(x0,y0+.02);return s}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function bottle(c,cx,cy,s,col,cap){
  c.save();c.translate(cx,cy);c.scale(s,s);
  c.fillStyle=col;rr(c,-9,-4,18,19,4);c.fill();
  c.fillStyle="rgba(255,255,255,.28)";c.fillRect(-6,1,3,11);
  c.fillStyle=col;c.fillRect(-3.5,-8,7,5);
  c.fillStyle=cap||"#d9b45a";rr(c,-5,-13,10,6,1.5);c.fill();c.restore();
}
function swoosh(c,w,h,alpha){
  c.save();c.lineCap="round";
  function L(){c.beginPath();c.moveTo(34,480);c.bezierCurveTo(-40,820,0,1180,70,1340);c.bezierCurveTo(150,1560,360,1700,w*.62,1900)}
  c.strokeStyle="rgba(139,92,246,"+(.30*alpha)+")";c.lineWidth=80;c.shadowColor="rgba(139,92,246,.8)";c.shadowBlur=50;L();c.stroke();
  c.shadowColor="rgba(226,182,74,.9)";c.shadowBlur=22;c.strokeStyle="rgba(226,182,74,"+alpha+")";c.lineWidth=13;L();c.stroke();
  c.shadowBlur=0;c.strokeStyle="rgba(255,236,170,"+(.9*alpha)+")";c.lineWidth=4;L();c.stroke();
  c.shadowColor="rgba(226,182,74,.9)";c.shadowBlur=18;c.strokeStyle="rgba(226,182,74,"+alpha+")";c.lineWidth=10;
  c.beginPath();c.moveTo(w-8,1480);c.bezierCurveTo(w-60,1660,w-260,1780,w-430,1900);c.stroke();
  c.restore();
}
function drawPanel(c,st,P){
  var w=W*PX,h=H*PX,i,cx=w/2;
  /* fond graphite, reflet violet sur le flanc gauche */
  var g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#1d1a2a");g.addColorStop(.4,"#12101b");g.addColorStop(1,"#09080e");
  c.fillStyle=g;c.fillRect(0,0,w,h);
  var vg=c.createLinearGradient(0,0,w,0);vg.addColorStop(0,"rgba(139,92,246,.12)");vg.addColorStop(.3,"rgba(139,92,246,0)");vg.addColorStop(1,"rgba(0,0,0,.35)");
  c.fillStyle=vg;c.fillRect(0,0,w,h);
  /* écran tactile */
  var sx=84,sy=570,sw=w-168,sh=370,sc=P.scents[st.scent];
  c.fillStyle="#05040a";rr(c,sx,sy,sw,sh,18);c.fill();c.strokeStyle="rgba(226,182,74,.7)";c.lineWidth=3;c.stroke();
  c.textAlign="center";c.fillStyle="#fff";
  if(st.step===0){
    c.font="700 27px Manrope,'Segoe UI',sans-serif";c.fillText("Choisissez votre parfum",cx,sy+46);
    var pg=Math.floor(st.scent/3),area=sw-100,bw=area/3-10;
    for(i=0;i<3;i++){
      var k=pg*3+i,s=P.scents[k],bx=sx+50+i*(area/3)+5,on=k===st.scent;
      c.fillStyle=on?"rgba(255,255,255,.12)":"rgba(255,255,255,.04)";rr(c,bx,sy+66,bw,222,14);c.fill();
      c.strokeStyle=on?GOLD:"rgba(255,255,255,.14)";c.lineWidth=on?4:2;c.stroke();
      bottle(c,bx+bw/2,sy+138,4.4,s.c,"#E2B64A");
      c.fillStyle="#fff";c.font="800 17px Manrope,sans-serif";c.fillText(s.marque.split(" ")[0],bx+bw/2,sy+222);
      c.fillStyle="#d8d1ee";c.font="700 15px Manrope,sans-serif";c.fillText(s.nom.length>13?s.nom.slice(0,12)+"…":s.nom,bx+bw/2,sy+250);
    }
    c.fillStyle="#fff";c.font="700 40px Manrope,sans-serif";c.fillText("‹",sx+26,sy+196);c.fillText("›",sx+sw-26,sy+196);
    for(i=0;i<4;i++){c.fillStyle=i===pg?"#fff":"rgba(255,255,255,.3)";c.beginPath();c.arc(cx-30+i*20,sy+312,5.5,0,7);c.fill()}
    c.fillStyle=GOLD;rr(c,cx-110,sy+sh-50,220,36,18);c.fill();c.fillStyle="#1b1534";c.font="800 20px Manrope,sans-serif";c.fillText("1 PSHIT · 2 €",cx,sy+sh-24);
  }else if(st.step===1){
    c.fillStyle=GOLD;c.font="800 24px Manrope,sans-serif";c.fillText("Paiement sans contact",cx,sy+46);
    bottle(c,cx,sy+118,3.6,sc.c,"#E2B64A");
    c.fillStyle="#fff";c.font="600 34px 'Playfair Display',Georgia,serif";c.fillText(sc.nom.length>16?sc.nom.slice(0,15)+"…":sc.nom,cx,sy+214);
    c.fillStyle=GOLD;c.font="800 54px Manrope,sans-serif";c.fillText("2 €",cx,sy+270);
    c.fillStyle="#d8d1ee";c.font="700 18px Manrope,sans-serif";c.fillText("Approchez votre carte ou votre téléphone",cx,sy+318);
    c.fillStyle="#a89fc4";c.font="600 16px Manrope,sans-serif";c.fillText("À emporter : 3 ml 6 € · 5 ml 9,99 €",cx,sy+346);
  }else if(st.step===2){
    c.fillStyle=GOLD;c.font="800 24px Manrope,sans-serif";c.fillText("Paiement accepté",cx,sy+48);
    c.strokeStyle="#7dffa6";c.lineWidth=10;c.lineCap="round";c.beginPath();c.moveTo(cx-48,sy+150);c.lineTo(cx-12,sy+188);c.lineTo(cx+54,sy+108);c.stroke();
    c.fillStyle="#fff";c.font="600 40px 'Playfair Display',Georgia,serif";c.fillText("Face à la borne",cx,sy+270);
    c.fillStyle="#d8d1ee";c.font="700 18px Manrope,sans-serif";c.fillText("La buse se règle sur votre taille",cx,sy+314);
  }else{
    c.fillStyle=GOLD;c.font="800 24px Manrope,sans-serif";c.fillText("Merci",cx,sy+48);
    bottle(c,cx,sy+118,3.8,sc.c,"#E2B64A");
    c.fillStyle="#fff";c.font="600 40px 'Playfair Display',Georgia,serif";c.fillText("Bonne journée",cx,sy+246);
    c.fillStyle="#d8d1ee";c.font="700 18px Manrope,sans-serif";c.fillText("+1 pshit sur votre carte Pshit Club",cx,sy+306);
  }
  /* lecteur sans contact + fente carte */
  var ny=1000,nfc=st.step===1;
  c.fillStyle="#120e22";c.beginPath();c.arc(210,ny,46,0,7);c.fill();c.strokeStyle="rgba(255,255,255,.14)";c.lineWidth=2;c.stroke();
  if(nfc){var rg=c.createRadialGradient(210,ny,4,210,ny,120);rg.addColorStop(0,"rgba(255,226,160,.6)");rg.addColorStop(1,"rgba(255,226,160,0)");c.fillStyle=rg;c.fillRect(80,ny-130,260,260)}
  c.strokeStyle=nfc?"#ffe6a8":"#e9e4f5";c.lineWidth=nfc?6:4;c.lineCap="round";
  for(i=0;i<3;i++){c.beginPath();c.arc(196,ny,13+i*13,-.85,.85);c.stroke()}
  c.fillStyle="#07050d";rr(c,w-310,ny-30,150,60,10);c.fill();c.strokeStyle="rgba(255,255,255,.2)";c.lineWidth=2;c.stroke();
  c.fillStyle="#d9d4e8";rr(c,w-290,ny-6,110,12,4);c.fill();
  /* niche de distribution */
  var ax=96,ay=1074,aw=w-192,ah=270,glow=st.step===2?1:(st.step===1?.5:.75);
  c.fillStyle="#08050f";rr(c,ax,ay,aw,ah,34);c.fill();c.strokeStyle=GOLD;c.lineWidth=6;c.stroke();
  var ig=c.createLinearGradient(0,ay,0,ay+ah);ig.addColorStop(0,"rgba(255,226,170,"+(.5*glow)+")");ig.addColorStop(1,"rgba(120,70,200,"+(.18*glow)+")");
  c.fillStyle=ig;rr(c,ax+8,ay+8,aw-16,ah-16,28);c.fill();
  bottle(c,cx,ay+128,5,st.step===3?sc.c:"#e8d6a0","#E2B64A");
  c.fillStyle="rgba(255,255,255,.75)";c.font="800 15px Manrope,sans-serif";c.fillText("Retirez votre échantillon",cx,ay+ah-20);
  /* filets dorés sur les flancs */
  swoosh(c,w,h,.95);
  c.fillStyle="#07050c";c.fillRect(0,h-92,w,92);
}
function drawBack(c){
  var w=W*PX,h=H*PX;
  var g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#241c4d");g.addColorStop(1,"#120d2a");c.fillStyle=g;c.fillRect(0,0,w,h);
  c.textAlign="center";c.fillStyle=GOLDP;c.font="600 34px 'Playfair Display',Georgia,serif";c.fillText("Le Dernier Pshit",w/2,300);
  c.fillStyle="#a89fc4";c.font="700 18px Manrope,sans-serif";c.fillText("12 parfums de marque",w/2,342);
  c.strokeStyle="rgba(226,182,74,.5)";c.lineWidth=2;rr(c,90,1500,w-180,380,8);c.stroke();
  c.fillStyle="#08050f";c.fillRect(0,h-92,w,92);
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
  var bev=.03;
  var bodyGeo=new THREE.ExtrudeGeometry(archShape(0,false),{depth:D,bevelEnabled:true,bevelThickness:bev,bevelSize:bev,bevelSegments:3,curveSegments:48});
  body.add(new THREE.Mesh(bodyGeo,new THREE.MeshStandardMaterial({color:0x040307,metalness:.5,roughness:.45,envMapIntensity:.25})));
  var goldMat=new THREE.MeshStandardMaterial({color:0xE2B64A,metalness:1,roughness:.24,envMapIntensity:1.5});
  /* capot en surplomb, comme sur la planche technique */
  var hoodMat=new THREE.MeshStandardMaterial({color:0x040307,metalness:.5,roughness:.45,envMapIntensity:.25});
  var hood=new THREE.Mesh(new THREE.ExtrudeGeometry(hoodShape(),{depth:.16,bevelEnabled:true,bevelThickness:.03,bevelSize:.03,bevelSegments:3,curveSegments:32}),hoodMat);
  hood.position.z=D+bev-.02;body.add(hood);
  var lc2=document.createElement("canvas");lc2.width=W*PX;lc2.height=HOOD*PX;var lx2=lc2.getContext("2d");
  (function(c,w,cx){bottle(c,cx,170,4.8,"rgba(0,0,0,0)","#E2B64A");c.strokeStyle=GOLD;c.lineWidth=7;c.lineCap="round";c.strokeRect(cx-31,146,62,64);
    c.beginPath();c.moveTo(cx-130,242);c.quadraticCurveTo(cx-55,198,cx+4,246);c.quadraticCurveTo(cx+64,294,cx+134,220);c.stroke()})(lx2,W*PX,W*PX/2);
  var ltex=new THREE.CanvasTexture(lc2);ltex.encoding=THREE.sRGBEncoding;
  var logo=new THREE.Mesh(new THREE.PlaneGeometry(W,HOOD),new THREE.MeshBasicMaterial({map:ltex,transparent:true}));
  logo.position.set(W/2,H-HOOD/2,D+bev+.16+.012);body.add(logo);
  var strip=new THREE.Mesh(new THREE.BoxGeometry(W+.07,.05,.04),new THREE.MeshBasicMaterial({color:0xF3D98B}));strip.position.set(W/2,H-HOOD+.02,D+bev+.15);body.add(strip);
  /* dessous du capot : vasque, anneau LED doré, spot */
  var dish=new THREE.Mesh(new THREE.CircleGeometry(.36,48),new THREE.MeshStandardMaterial({color:0x07060b,metalness:.8,roughness:.3}));dish.rotation.x=Math.PI/2;dish.position.set(W/2,H-HOOD-.004,D+.12);body.add(dish);
  var ring=new THREE.Mesh(new THREE.RingGeometry(.33,.37,48),new THREE.MeshBasicMaterial({color:0xF3D98B,side:THREE.DoubleSide}));ring.rotation.x=Math.PI/2;ring.position.set(W/2,H-HOOD-.006,D+.12);body.add(ring);
  var spot=new THREE.Mesh(new THREE.CircleGeometry(.09,32),new THREE.MeshBasicMaterial({color:0xfff2d0}));spot.rotation.x=Math.PI/2;spot.position.set(W/2,H-HOOD-.008,D+.12);body.add(spot);
  var base=new THREE.Mesh(new THREE.BoxGeometry(W+.06,.2,D+.06),new THREE.MeshStandardMaterial({color:0x050408,metalness:.6,roughness:.5}));base.position.set(W/2,.1,D/2);body.add(base);
  var pc=document.createElement("canvas");pc.width=W*PX;pc.height=H*PX;var pctx=pc.getContext("2d");
  var ptex=new THREE.CanvasTexture(pc);ptex.encoding=THREE.sRGBEncoding;ptex.anisotropy=8;
  var pg=new THREE.ShapeGeometry(archShape(.052,false),48),pos=pg.attributes.position,uv=pg.attributes.uv;
  for(var i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/W,pos.getY(i)/H);
  var face=new THREE.Mesh(pg,new THREE.MeshStandardMaterial({map:ptex,emissiveMap:ptex,emissive:0xffffff,emissiveIntensity:.4,metalness:.3,roughness:.5}));
  face.position.z=D+bev+.001;body.add(face);
  var bc=document.createElement("canvas");bc.width=W*PX;bc.height=H*PX;drawBack(bc.getContext("2d"));
  var btex=new THREE.CanvasTexture(bc);btex.encoding=THREE.sRGBEncoding;btex.anisotropy=8;
  var bg=new THREE.ShapeGeometry(archShape(.052,false),48),bp=bg.attributes.position,bu=bg.attributes.uv;
  for(i=0;i<bp.count;i++)bu.setXY(i,1-bp.getX(i)/W,bp.getY(i)/H);
  var back=new THREE.Mesh(bg,new THREE.MeshStandardMaterial({map:btex,metalness:.4,roughness:.5}));back.rotation.y=Math.PI;back.position.set(W,0,-bev-.001);body.add(back);
  /* halo au sol */
  var fc=document.createElement("canvas");fc.width=fc.height=256;var fx=fc.getContext("2d"),fg=fx.createRadialGradient(128,128,0,128,128,128);
  fg.addColorStop(0,"rgba(255,255,255,.9)");fg.addColorStop(.45,"rgba(255,255,255,.28)");fg.addColorStop(1,"rgba(255,255,255,0)");fx.fillStyle=fg;fx.fillRect(0,0,256,256);
  var floorMat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(fc),transparent:true,depthWrite:false,color:0x8b5cf6,blending:THREE.AdditiveBlending});
  var floor=new THREE.Mesh(new THREE.PlaneGeometry(4.6,4.6),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-H/2-.02;scene.add(floor);
  /* petit faisceau sous le spot du capot, évasé vers le bas */
  var cone=new THREE.Mesh(new THREE.CylinderGeometry(.09,.3,.34,40,1,true),new THREE.MeshBasicMaterial({color:0xc9a0ff,transparent:true,opacity:.0,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
  cone.position.set(W/2,H-HOOD-.18,D+.12);body.add(cone);
  scene.add(new THREE.AmbientLight(0xffffff,.22));
  var key=new THREE.DirectionalLight(0xefe6ff,.8);key.position.set(-4,5,7);scene.add(key);
  var rim=new THREE.DirectionalLight(0xb79cff,.45);rim.position.set(6,3,-5);scene.add(rim);
  var warm=new THREE.PointLight(0xc9a0ff,.3,5);warm.position.set(0,.2,2.4);scene.add(warm);
  /* brume du pshit */
  var N=190,pp=new Float32Array(N*3),pcol=new Float32Array(N*3),vel=new Float32Array(N*3),age=new Float32Array(N).fill(9),life=new Float32Array(N);
  var pgeo=new THREE.BufferGeometry();pgeo.setAttribute("position",new THREE.BufferAttribute(pp,3));pgeo.setAttribute("color",new THREE.BufferAttribute(pcol,3));
  var mist=new THREE.Points(pgeo,new THREE.PointsMaterial({size:.07,map:spriteTex(),vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true}));
  mist.frustumCulled=false;body.add(mist);
  var api={renderer:renderer,pivot:pivot,camera:camera,visible:true,rot:opts.rot||0,vel:0,drag:false,
    cam:{x:0,y:.2,z:9.4,lx:0,ly:0},step:0,spray:false,sprayT:0,zoom:1,off:0,spin:0,idle:false,mobile:false,t:0};
  P.state.cone=1;
  function redraw(){pctx.clearRect(0,0,pc.width,pc.height);drawPanel(pctx,{step:api.step,scent:P.state.scent},{scents:P.scents,cone:1});ptex.needsUpdate=true}
  api.redraw=redraw;redraw();
  api.setAccent=function(r,g,b){floorMat.color.setRGB(r/255*.9,g/255*.9,b/255*.9)};
  api.setStep=function(s){if(s!==api.step){api.step=s;redraw()}};
  api.resize=function(){var w=box.clientWidth,h=box.clientHeight;if(!w||!h)return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(w,h,false);
    camera.aspect=w/h;api.zoom=camera.aspect<.9?1+(.9-camera.aspect)*1.25:1;camera.updateProjectionMatrix()};
  api.tick=function(dt){
    if(!api.visible||api.dead)return;
    try{api.tickInner(dt)}catch(e){api.dead=true;fail(box,e)}
  };
  api.tickInner=function(dt){
    api.t+=dt;
    if(api.idle&&!api.drag)api.spin+=(Math.sin(api.t*.7)*.3-api.spin)*Math.min(1,dt*2.5);else api.spin+=(0-api.spin)*Math.min(1,dt*3);
    if(Math.abs(api.vel)>1e-4&&!api.drag){api.rot+=api.vel;api.vel*=.94}
    pivot.rotation.y=api.rot+api.spin;pivot.position.x=api.off;
    cone.material.opacity=.13+.04*Math.sin(api.t*2.2)+(api.spray?.12:0);
    var c=api.cam;camera.position.set(c.x,c.y,c.z*api.zoom);camera.lookAt(c.lx,c.ly,0);
    if(api.spray)api.sprayT+=dt;
    var emit=api.spray&&((api.sprayT%1.7)<.75);
    for(var i=0;i<N;i++){
      if(age[i]>=life[i]){
        if(emit&&Math.random()<dt*80){
          pp[i*3]=W/2+(Math.random()-.5)*.06;pp[i*3+1]=H-.95;pp[i*3+2]=D+.2;
          vel[i*3]=(Math.random()-.5)*.55;vel[i*3+1]=-(.25+Math.random()*.55);vel[i*3+2]=.7+Math.random()*.6;
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
  if(window.ResizeObserver)new ResizeObserver(api.resize).observe(box);window.addEventListener("resize",api.resize);api.resize();
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
  canvas.addEventListener("webglcontextrestored",function(){ptex.needsUpdate=true;btex.needsUpdate=true;api.redraw()});
  return api;
}
window.PshitBorne={create:create};
})();
