/* Borne Le Dernier Pshit en 3D (three.js r128).
   Design : borne bleu nuit à reflets violets, filets dorés, logo flacon doré sur le capot,
   écran tactile, lecteur sans contact, fente carte et niche de distribution (cf. maquette). */
(function(){
"use strict";
var W=1.4,H=4.0,D=0.9,R=0.7,PX=500;
var GOLD="#E2B64A",GOLDP="#F3D98B",CREAM="#F5EFE6";

function archShape(inset,asPath){
  var s=asPath?new THREE.Path():new THREE.Shape(),r=R-inset;
  s.moveTo(inset,inset);s.lineTo(W-inset,inset);s.lineTo(W-inset,H-R);
  s.absarc(W/2,H-R,r,0,Math.PI,false);s.lineTo(inset,inset);return s;
}
function ringGeo(o,i,depth){var s=archShape(o,false);s.holes.push(archShape(i,true));
  return new THREE.ExtrudeGeometry(s,{depth:depth,bevelEnabled:false,curveSegments:40})}
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
  c.strokeStyle="rgba(139,92,246,"+(.35*alpha)+")";c.lineWidth=26;
  c.beginPath();c.moveTo(-20,1080);c.bezierCurveTo(120,1280,360,1420,250,1700);c.bezierCurveTo(200,1830,330,1900,470,1990);c.stroke();
  c.strokeStyle="rgba(226,182,74,"+alpha+")";c.lineWidth=5;
  c.beginPath();c.moveTo(-20,1080);c.bezierCurveTo(120,1280,360,1420,250,1700);c.bezierCurveTo(200,1830,330,1900,470,1990);c.stroke();
  c.lineWidth=3;c.strokeStyle="rgba(226,182,74,"+(.7*alpha)+")";
  c.beginPath();c.moveTo(w+20,1350);c.bezierCurveTo(w-80,1480,w-180,1560,w-120,1760);c.stroke();
  c.restore();
}
function drawPanel(c,st,P){
  var w=W*PX,h=H*PX,i,cx=w/2;
  var g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#2b2358");g.addColorStop(.45,"#1c1640");g.addColorStop(1,"#120d2a");
  c.fillStyle=g;c.fillRect(0,0,w,h);
  var vg=c.createLinearGradient(0,0,w,0);vg.addColorStop(0,"rgba(139,92,246,.28)");vg.addColorStop(.35,"rgba(139,92,246,0)");vg.addColorStop(1,"rgba(0,0,0,.35)");
  c.fillStyle=vg;c.fillRect(0,0,w,h);
  /* capot */
  c.fillStyle="#241b48";rr(c,40,110,w-80,330,60);c.fill();
  c.strokeStyle=GOLD;c.lineWidth=5;c.beginPath();c.moveTo(48,430);c.quadraticCurveTo(cx,470,w-48,420);c.stroke();
  var halo=c.createRadialGradient(cx,215,0,cx,215,130);halo.addColorStop(0,"rgba(226,182,74,.5)");halo.addColorStop(1,"rgba(226,182,74,0)");
  c.fillStyle=halo;c.fillRect(cx-140,90,280,260);
  bottle(c,cx,205,3.6,"none","#E2B64A");
  c.strokeStyle=GOLD;c.lineWidth=5;c.lineCap="round";
  c.beginPath();c.moveTo(cx-86,258);c.quadraticCurveTo(cx-40,226,cx,262);c.quadraticCurveTo(cx+48,296,cx+90,244);c.stroke();
  c.strokeRect(cx-26,196,52,52);
  c.textAlign="center";c.fillStyle=CREAM;c.font="600 36px 'Playfair Display',Georgia,serif";c.fillText("Le Dernier",cx-48,342);
  c.fillStyle=GOLD;c.font="italic 600 36px 'Playfair Display',Georgia,serif";c.fillText("Pshit",cx+96,342);
  /* lumière du capot */
  var lc=c.createLinearGradient(0,432,0,505);lc.addColorStop(0,"rgba(201,160,255,"+(.85*P.cone)+")");lc.addColorStop(1,"rgba(201,160,255,0)");
  c.fillStyle=lc;c.beginPath();c.moveTo(cx-22,432);c.lineTo(cx+22,432);c.lineTo(cx+120,505);c.lineTo(cx-120,505);c.closePath();c.fill();
  c.fillStyle="#0c0818";c.beginPath();c.ellipse(cx,434,22,8,0,0,7);c.fill();
  c.fillStyle=st.step===2?"#fff":"#d9b3ff";c.beginPath();c.ellipse(cx,434,11,4,0,0,7);c.fill();
  /* écran */
  var sx=100,sy=510,sw=w-200,sh=340,sc=P.scents[st.scent];
  c.fillStyle="#07050f";rr(c,sx,sy,sw,sh,16);c.fill();c.strokeStyle="rgba(226,182,74,.6)";c.lineWidth=2;c.stroke();
  c.fillStyle="#fff";c.font="700 15px Manrope,'Segoe UI',sans-serif";
  if(st.step===0){
    c.fillText("Choisissez votre parfum",cx,sy+36);
    var pg=Math.floor(st.scent/3);
    for(i=0;i<3;i++){
      var k=pg*3+i,s=P.scents[k],bx=sx+22+i*((sw-44)/3),bw=(sw-44)/3-10,on=k===st.scent;
      c.fillStyle=on?"rgba(255,255,255,.1)":"rgba(255,255,255,.03)";rr(c,bx,sy+54,bw,214,12);c.fill();
      c.strokeStyle=on?GOLD:"rgba(255,255,255,.12)";c.lineWidth=on?3:1.5;c.stroke();
      bottle(c,bx+bw/2,sy+128,3.6,s.c,"#E2B64A");
      c.fillStyle="#fff";c.font="700 12px Manrope,sans-serif";c.fillText(s.marque.split(" ")[0],bx+bw/2,sy+196);
      c.fillStyle="#cfc7e6";c.font="600 11px Manrope,sans-serif";c.fillText(s.nom.length>16?s.nom.slice(0,15)+"…":s.nom,bx+bw/2,sy+216);
    }
    c.fillStyle="#cfc7e6";c.font="700 22px Manrope,sans-serif";c.fillText("‹",sx+12,sy+168);c.fillText("›",sx+sw-12,sy+168);
    for(i=0;i<4;i++){c.fillStyle=i===pg?"#fff":"rgba(255,255,255,.3)";c.beginPath();c.arc(cx-27+i*18,sy+sh-50,4,0,7);c.fill()}
    c.fillStyle=GOLD;rr(c,cx-88,sy+sh-36,176,26,13);c.fill();c.fillStyle="#1b1534";c.font="800 12px Manrope,sans-serif";c.fillText("1 PSHIT · 2 €",cx,sy+sh-18);
  }else if(st.step===1){
    c.fillStyle=GOLD;c.font="700 13px Manrope,sans-serif";c.fillText("PAIEMENT SANS CONTACT",cx,sy+38);
    bottle(c,cx,sy+118,3.6,sc.c,"#E2B64A");
    c.fillStyle="#fff";c.font="600 26px 'Playfair Display',Georgia,serif";c.fillText(sc.nom,cx,sy+184);
    c.fillStyle=GOLD;c.font="800 34px Manrope,sans-serif";c.fillText("2 €",cx,sy+232);
    c.fillStyle="#a89fc4";c.font="600 12px Manrope,sans-serif";c.fillText("Approchez votre carte ou votre téléphone",cx,sy+280);
    c.fillText("3 ml 6 € · 5 ml 9,99 € à emporter",cx,sy+304);
  }else if(st.step===2){
    c.fillStyle=GOLD;c.font="700 13px Manrope,sans-serif";c.fillText("PAIEMENT ACCEPTÉ",cx,sy+40);
    c.strokeStyle="#7dffa6";c.lineWidth=7;c.lineCap="round";c.beginPath();c.moveTo(cx-34,sy+130);c.lineTo(cx-8,sy+158);c.lineTo(cx+38,sy+100);c.stroke();
    c.fillStyle="#fff";c.font="600 28px 'Playfair Display',Georgia,serif";c.fillText("Face à la borne",cx,sy+226);
    c.fillStyle="#a89fc4";c.font="600 12px Manrope,sans-serif";c.fillText("La buse se règle sur votre taille puis pulvérise",cx,sy+272);
  }else{
    c.fillStyle=GOLD;c.font="700 13px Manrope,sans-serif";c.fillText("MERCI",cx,sy+40);
    bottle(c,cx,sy+118,3.6,sc.c,"#E2B64A");
    c.fillStyle="#fff";c.font="600 30px 'Playfair Display',Georgia,serif";c.fillText("Bonne journée",cx,sy+210);
    c.fillStyle="#a89fc4";c.font="600 12px Manrope,sans-serif";c.fillText("+1 pshit sur votre carte Pshit Club",cx,sy+258);
  }
  /* sans contact + fente carte */
  var ny=930,nfc=st.step===1;
  c.fillStyle="#1a1338";c.beginPath();c.arc(190,ny,38,0,7);c.fill();
  if(nfc){var rg=c.createRadialGradient(190,ny,4,190,ny,110);rg.addColorStop(0,"rgba(255,226,160,.6)");rg.addColorStop(1,"rgba(255,226,160,0)");c.fillStyle=rg;c.fillRect(70,ny-120,240,240)}
  c.strokeStyle=nfc?"#ffe6a8":GOLD;c.lineWidth=nfc?5:3;c.lineCap="round";
  for(i=0;i<3;i++){c.beginPath();c.arc(178,ny,12+i*11,-.85,.85);c.stroke()}
  c.fillStyle="#0c0818";rr(c,w-300,ny-26,150,52,10);c.fill();c.strokeStyle="rgba(226,182,74,.5)";c.lineWidth=2;c.stroke();
  c.fillStyle=GOLD;rr(c,w-282,ny-4,114,8,4);c.fill();
  /* niche de distribution */
  var ax=100,ay=1010,aw=w-200,ah=270,glow=st.step===2?1:(st.step===1?.5:.75);
  c.fillStyle="#0a0614";rr(c,ax,ay,aw,ah,34);c.fill();c.strokeStyle=GOLD;c.lineWidth=5;c.stroke();
  var ig=c.createLinearGradient(0,ay,0,ay+ah);ig.addColorStop(0,"rgba(255,226,170,"+(.5*glow)+")");ig.addColorStop(1,"rgba(120,70,200,"+(.18*glow)+")");
  c.fillStyle=ig;rr(c,ax+8,ay+8,aw-16,ah-16,28);c.fill();
  bottle(c,cx,ay+158,6.2,st.step===3?sc.c:"#e8d6a0","#E2B64A");
  c.fillStyle="rgba(255,255,255,.6)";c.font="700 11px Manrope,sans-serif";c.fillText("RETIREZ VOTRE ÉCHANTILLON",cx,ay+ah-16);
  /* flancs */
  swoosh(c,w,h,.92);
  c.fillStyle="#08050f";c.fillRect(0,h-92,w,92);
  c.fillStyle="rgba(255,255,255,.07)";c.font="700 12px Manrope,sans-serif";c.fillText("Parfums de marque · spray dosé 0,1 ml",cx,1560);
}
function drawBack(c){
  var w=W*PX,h=H*PX;
  var g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#241c4d");g.addColorStop(1,"#120d2a");c.fillStyle=g;c.fillRect(0,0,w,h);
  c.textAlign="center";c.fillStyle=GOLDP;c.font="600 34px 'Playfair Display',Georgia,serif";c.fillText("Le Dernier Pshit",w/2,300);
  c.fillStyle="#a89fc4";c.font="700 12px Manrope,sans-serif";c.fillText("12 PARFUMS DE MARQUE · SPRAY DOSÉ",w/2,338);
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

function create(canvas,box,opts,P){
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
  body.add(new THREE.Mesh(bodyGeo,new THREE.MeshStandardMaterial({color:0x1d1640,metalness:.7,roughness:.38,envMapIntensity:.9})));
  var goldMat=new THREE.MeshStandardMaterial({color:0xE2B64A,metalness:1,roughness:.24,envMapIntensity:1.5});
  var outer=new THREE.Mesh(ringGeo(-bev*.2,.032,.012),goldMat);outer.position.z=D+bev-.004;body.add(outer);
  var outerBack=outer.clone();outerBack.position.z=-bev-.008;body.add(outerBack);
  var pc=document.createElement("canvas");pc.width=W*PX;pc.height=H*PX;var pctx=pc.getContext("2d");
  var ptex=new THREE.CanvasTexture(pc);ptex.encoding=THREE.sRGBEncoding;ptex.anisotropy=8;
  var pg=new THREE.ShapeGeometry(archShape(.052,false),48),pos=pg.attributes.position,uv=pg.attributes.uv;
  for(var i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/W,pos.getY(i)/H);
  var face=new THREE.Mesh(pg,new THREE.MeshStandardMaterial({map:ptex,emissiveMap:ptex,emissive:0xffffff,emissiveIntensity:.55,metalness:.3,roughness:.5}));
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
  /* cône de lumière violet au-dessus de l'écran */
  var cone=new THREE.Mesh(new THREE.ConeGeometry(.42,.5,32,1,true),new THREE.MeshBasicMaterial({color:0xc9a0ff,transparent:true,opacity:.0,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
  cone.position.set(W/2,H-1.05,D+.25);cone.rotation.x=Math.PI;body.add(cone);
  scene.add(new THREE.AmbientLight(0xffffff,.3));
  var key=new THREE.DirectionalLight(0xefe6ff,1.5);key.position.set(-4,5,7);scene.add(key);
  var rim=new THREE.DirectionalLight(0xb79cff,.9);rim.position.set(6,3,-5);scene.add(rim);
  var warm=new THREE.PointLight(0xc9a0ff,1.0,6);warm.position.set(0,-.1,1.6);scene.add(warm);
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
    if(!api.visible)return;
    api.t+=dt;
    if(api.idle&&!api.drag)api.spin+=(Math.sin(api.t*.7)*.3-api.spin)*Math.min(1,dt*2.5);else api.spin+=(0-api.spin)*Math.min(1,dt*3);
    if(Math.abs(api.vel)>1e-4&&!api.drag){api.rot+=api.vel;api.vel*=.94}
    pivot.rotation.y=api.rot+api.spin;pivot.position.x=api.off;
    cone.material.opacity=.16+.07*Math.sin(api.t*2.2)+(api.spray?.2:0);
    var c=api.cam;camera.position.set(c.x,c.y,c.z*api.zoom);camera.lookAt(c.lx,c.ly,0);
    if(api.spray)api.sprayT+=dt;
    var emit=api.spray&&((api.sprayT%1.7)<.75);
    for(var i=0;i<N;i++){
      if(age[i]>=life[i]){
        if(emit&&Math.random()<dt*80){
          pp[i*3]=W/2+(Math.random()-.5)*.06;pp[i*3+1]=H-.9;pp[i*3+2]=D+.2;
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
