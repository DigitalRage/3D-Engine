// Salvage Studio - standalone WebGL2 editor/runtime.
// No external runtime dependencies. The editor boots synchronously and never
// traps the user in a CDN retry loop.

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const now = () => performance.now();

const state = {
  engine: null,
  playMode: false,
  player: null,
  selection: null,
  activeTool: 'select',
  entities: new Map(),
  history: [],
  historyIndex: -1,
  historyLock: false,
  nextId: 1,
  camera: null,
  fps: 0,
  frameSamples: [],
  lastFrame: now(),
  mapOpen: false,
  pointer: { down:false, button:0, lastX:0, lastY:0, pan:false },
  keys: Object.create(null),
  mouseWorld: { x:0, y:0, z:0 }
};

const palette = {
  grass:[0.18,0.36,0.19], grass2:[0.25,0.46,0.23], stone:[0.44,0.48,0.55],
  wood:[0.39,0.23,0.12], roof:[0.40,0.14,0.12], water:[0.05,0.30,0.48],
  sand:[0.68,0.52,0.29], gold:[0.92,0.68,0.19], leaf:[0.14,0.40,0.17],
  leaf2:[0.22,0.52,0.23], snow:[0.80,0.84,0.88], dark:[0.08,0.10,0.14],
  skin:[0.79,0.54,0.40], shirt:[0.16,0.39,0.68], pants:[0.10,0.14,0.23],
  road:[0.11,0.13,0.16], curb:[0.38,0.40,0.43], white:[0.88,0.90,0.95]
};

const materialNames = Object.keys(palette);

class V3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  scale(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  clone(){return new V3(this.x,this.y,this.z);}
  length(){return Math.hypot(this.x,this.y,this.z);}
  normalize(){const l=this.length()||1;return this.scale(1/l);}
  static cross(a,b){return new V3(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
  static dot(a,b){return a.x*b.x+a.y*b.y+a.z*b.z;}
}

function mat4Identity(){const m=new Float32Array(16);m[0]=m[5]=m[10]=m[15]=1;return m;}
function mat4Multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function perspective(fov,aspect,near,far){const f=1/Math.tan(fov*0.5),nf=1/(near-far),m=new Float32Array(16);m[0]=f/aspect;m[5]=f;m[10]=(far+near)*nf;m[11]=-1;m[14]=2*far*near*nf;return m;}
function lookAt(eye,target,up){const z=new V3(eye.x-target.x,eye.y-target.y,eye.z-target.z).normalize();const x=V3.cross(up,z).normalize();const y=V3.cross(z,x);const m=mat4Identity();m[0]=x.x;m[1]=x.y;m[2]=x.z;m[4]=y.x;m[5]=y.y;m[6]=y.z;m[8]=z.x;m[9]=z.y;m[10]=z.z;m[12]=-V3.dot(x,eye);m[13]=-V3.dot(y,eye);m[14]=-V3.dot(z,eye);return m;}
function transformMatrix(p,r,s){const sx=Math.sin(r.x),cx=Math.cos(r.x),sy=Math.sin(r.y),cy=Math.cos(r.y),sz=Math.sin(r.z),cz=Math.cos(r.z);const m=new Float32Array(16);m[0]=(cy*cz+sy*sx*sz)*s.x;m[1]=(cx*sz)*s.x;m[2]=(-sy*cz+cy*sx*sz)*s.x;m[4]=(-cy*sz+sy*sx*cz)*s.y;m[5]=(cx*cz)*s.y;m[6]=(sy*sz+cy*sx*cz)*s.y;m[8]=(sy*cx)*s.z;m[9]=(-sx)*s.z;m[10]=(cy*cx)*s.z;m[12]=p.x;m[13]=p.y;m[14]=p.z;m[15]=1;return m;}
function rayPlane(rayOrigin,rayDir,y=0){const t=(y-rayOrigin.y)/(rayDir.y||1e-6);return t>0?new V3(rayOrigin.x+rayDir.x*t,y,rayOrigin.z+rayDir.z*t):null;}

function makeMesh(type){
  const pos=[], norm=[], idx=[];
  const addTri=(a,b,c,na,nb,nc)=>{const o=pos.length/3;pos.push(...a,...b,...c);norm.push(...na,...nb,...nc);idx.push(o,o+1,o+2);};
  const addQuad=(a,b,c,d,n)=>{addTri(a,b,c,n,n,n);addTri(a,c,d,n,n,n);};
  if(type==='plane'){
    addQuad([-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],[0,1,0]);
  } else if(type==='box'){
    const f=[
      [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[0,0,1]],[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1],[0,0,-1]],
      [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1],[0,1,0]], [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[0,-1,0]],
      [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1],[1,0,0]], [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,0,0]]
    ]; for(const q of f)addQuad(q[0],q[1],q[2],q[3],q[4]);
  } else if(type==='sphere' || type==='capsule'){
    const rings=type==='capsule'?14:18, seg=type==='capsule'?20:24;
    const verticalScale=type==='capsule'?1.5:1;
    for(let y=0;y<rings;y++){const v=y/rings;const phi=Math.PI*v;for(let x=0;x<seg;x++){const u=x/seg,a=u*TAU;const px=Math.sin(phi)*Math.cos(a),py=Math.cos(phi),pz=Math.sin(phi)*Math.sin(a);pos.push(px,py*verticalScale,pz);norm.push(px,py,pz);}}
    for(let y=0;y<rings-1;y++)for(let x=0;x<seg;x++){const a=y*seg+x,b=y*seg+(x+1)%seg,c=(y+1)*seg+(x+1)%seg,d=(y+1)*seg+x;idx.push(a,b,c,a,c,d);}
  } else if(type==='cylinder' || type==='cone'){
    const seg=24, top=type==='cone'?0.08:1;
    for(let y=0;y<=1;y++){const rad=1+(top-1)*y;for(let i=0;i<seg;i++){const a=i/seg*TAU;pos.push(Math.cos(a)*rad,(y*2-1),Math.sin(a)*rad);norm.push(Math.cos(a),0,Math.sin(a));}}
    for(let y=0;y<1;y++)for(let i=0;i<seg;i++){const a=y*seg+i,b=y*seg+(i+1)%seg,c=(y+1)*seg+(i+1)%seg,d=(y+1)*seg+i;idx.push(a,b,c,a,c,d);}
    for(let i=0;i<seg;i++){const a= i,b=(i+1)%seg;const n=pos.length/3;pos.push(0,-1,0,...[pos[a*3],-1,pos[a*3+2],pos[b*3],-1,pos[b*3+2]]);norm.push(0,-1,0,0,-1,0,0,-1,0);idx.push(n,n+1,n+2);}
  } else if(type==='torus'){
    const rings=20, seg=28, R=1.6,r=.42;for(let i=0;i<rings;i++){const u=i/rings*TAU;for(let j=0;j<seg;j++){const v=j/seg*TAU;const rr=R+r*Math.cos(v);const x=rr*Math.cos(u),y=r*Math.sin(v),z=rr*Math.sin(u);pos.push(x,y,z);norm.push(Math.cos(v)*Math.cos(u),Math.sin(v),Math.cos(v)*Math.sin(u));}}for(let i=0;i<rings;i++)for(let j=0;j<seg;j++){const a=i*seg+j,b=i*seg+(j+1)%seg,c=((i+1)%rings)*seg+(j+1)%seg,d=((i+1)%rings)*seg+j;idx.push(a,b,c,a,c,d);}
  } else { return makeMesh('box'); }
  return {positions:new Float32Array(pos),normals:new Float32Array(norm),indices:new Uint16Array(idx)};
}

class GLRenderer {
  constructor(canvas){
    this.canvas=canvas;this.gl=canvas.getContext('webgl2',{antialias:false,alpha:false,depth:true,powerPreference:'high-performance'});
    if(!this.gl) throw new Error('WebGL2 is unavailable in this browser.');
    const gl=this.gl;
    const vs=`#version 300 es\nprecision highp float;\nlayout(location=0)in vec3 aPos;layout(location=1)in vec3 aNormal;layout(location=2)in mat4 aModel;uniform mat4 uVP;uniform vec3 uColor;uniform vec3 uLight;out vec3 vColor;void main(){vec3 n=normalize(mat3(aModel)*aNormal);float d=max(dot(n,normalize(uLight)),0.0);float b=0.22+d*0.78;vColor=uColor*b;gl_Position=uVP*aModel*vec4(aPos,1.0);}`;
    const fs=`#version 300 es\nprecision mediump float;in vec3 vColor;out vec4 outColor;void main(){vec3 c=vColor;float l=dot(c,vec3(.299,.587,.114));float band= l<.28?.72:l<.55?1.0:1.08;outColor=vec4(clamp(c*band,0.0,1.0),1.0);}`;
    this.program=this.link(vs,fs);
    this.uVP=gl.getUniformLocation(this.program,'uVP');this.uColor=gl.getUniformLocation(this.program,'uColor');this.uLight=gl.getUniformLocation(this.program,'uLight');
    this.meshes=new Map();this.instanceBuffer=gl.createBuffer();this.enabled=true;
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.clearColor(.055,.08,.12,1);
    this.resize();window.addEventListener('resize',()=>this.resize());
  }
  compile(type,src){const s=this.gl.createShader(type);this.gl.shaderSource(s,src);this.gl.compileShader(s);if(!this.gl.getShaderParameter(s,this.gl.COMPILE_STATUS))throw new Error(this.gl.getShaderInfoLog(s)||'Shader error');return s;}
  link(v,f){const gl=this.gl,p=gl.createProgram();gl.attachShader(p,this.compile(gl.VERTEX_SHADER,v));gl.attachShader(p,this.compile(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Program error');return p;}
  resize(){const d=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,Math.floor(this.canvas.clientWidth*d)),h=Math.max(1,Math.floor(this.canvas.clientHeight*d));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.gl.viewport(0,0,w,h);}}
  mesh(type){let m=this.meshes.get(type);if(m)return m;const gl=this.gl,g=makeMesh(type);m={vao:gl.createVertexArray(),vbo:gl.createBuffer(),ibo:gl.createBuffer(),count:g.indices.length};gl.bindVertexArray(m.vao);gl.bindBuffer(gl.ARRAY_BUFFER,m.vbo);const data=new Float32Array(g.positions.length+g.normals.length);for(let i=0;i<g.positions.length/3;i++){data[i*6]=g.positions[i*3];data[i*6+1]=g.positions[i*3+1];data[i*6+2]=g.positions[i*3+2];data[i*6+3]=g.normals[i*3];data[i*6+4]=g.normals[i*3+1];data[i*6+5]=g.normals[i*3+2];}gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,g.indices,gl.STATIC_DRAW);gl.bindVertexArray(null);this.meshes.set(type,m);return m;}
  ensureInstanceLayout(vao){const gl=this.gl;gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.instanceBuffer);const stride=64;for(let i=0;i<4;i++){const loc=2+i;gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,4,gl.FLOAT,false,stride,i*16);gl.vertexAttribDivisor(loc,1);}gl.bindVertexArray(null);}
  render(instances,camera){
    this.resize();const gl=this.gl;gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);gl.uniformMatrix4fv(this.uVP,false,camera.vp);gl.uniform3f(this.uLight,-.45,.85,.35);
    const groups=new Map();
    for(const e of instances){if(!e.visible||e.type==='empty'||e.type==='light')continue;const k=e.type+'|'+e.material;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
    let draws=0;
    for(const [key,list] of groups){const mesh=this.mesh(list[0].type);if(!mesh.instancedReady){this.ensureInstanceLayout(mesh.vao);mesh.instancedReady=true;}const visible=[];for(const e of list){const dx=e.position.x-camera.position.x,dy=e.position.y-camera.position.y,dz=e.position.z-camera.position.z;const r=Math.max(e.scale.x,e.scale.y,e.scale.z)*1.9;if(dx*dx+dy*dy+dz*dz<camera.far*camera.far && frustumSphere(camera,dx,dy,dz,r))visible.push(e);}if(!visible.length)continue;const matrices=new Float32Array(visible.length*16);for(let i=0;i<visible.length;i++)matrices.set(transformMatrix(visible[i].position,visible[i].rotation,visible[i].scale),i*16);gl.bindBuffer(gl.ARRAY_BUFFER,this.instanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,matrices,gl.DYNAMIC_DRAW);gl.bindVertexArray(mesh.vao);gl.uniform3fv(this.uColor,new Float32Array(palette[list[0].material]||palette.stone));gl.drawElementsInstanced(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0,visible.length);gl.bindVertexArray(null);draws++;}
    return draws;
  }
}
function frustumSphere(c,dx,dy,dz,r){const z=dx*c.forward.x+dy*c.forward.y+dz*c.forward.z;return z>-r&&z<c.far+r;}

class CameraController {
  constructor(canvas){this.canvas=canvas;this.target=new V3(0,2,0);this.yaw=35;this.pitch=30;this.distance=48;this.position=new V3();this.forward=new V3();this.vp=mat4Identity();this.drag=false;this.pan=false;this.lastX=0;this.lastY=0;this.bind();this.update();}
  bind(){const c=this.canvas;c.addEventListener('pointerdown',e=>{if(state.playMode&&e.button===0){this.drag=true;this.pan=false;}else{this.drag=true;this.pan=e.shiftKey||e.button===1;}this.lastX=e.clientX;this.lastY=e.clientY;c.setPointerCapture?.(e.pointerId);});c.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.lastX,dy=e.clientY-this.lastY;this.lastX=e.clientX;this.lastY=e.clientY;if(this.pan){const y=this.yaw*Math.PI/180;this.target.x-=Math.cos(y)*dx*.08;this.target.z+=Math.sin(y)*dx*.08;this.target.y+=dy*.08;}else{this.yaw-=dx*.35;this.pitch=clamp(this.pitch-dy*.28,-80,84);}this.update();});c.addEventListener('pointerup',e=>{this.drag=false;c.releasePointerCapture?.(e.pointerId);});c.addEventListener('wheel',e=>{this.distance=clamp(this.distance*(1+e.deltaY*.001),3.5,600);this.update();e.preventDefault();},{passive:false});}
  update(){const yr=this.yaw*Math.PI/180,pr=this.pitch*Math.PI/180,cp=Math.cos(pr);this.position.set(this.target.x+Math.sin(yr)*cp*this.distance,this.target.y+Math.sin(pr)*this.distance,this.target.z+Math.cos(yr)*cp*this.distance);const dir=new V3(this.target.x-this.position.x,this.target.y-this.position.y,this.target.z-this.position.z).normalize();this.forward.copy(dir);const view=lookAt(this.position,this.target,new V3(0,1,0));const proj=perspective(60*Math.PI/180,Math.max(.1,this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight)),.08,1500);this.vp=mat4Multiply(proj,view);}
  snap(position,target){this.target.copy(target);this.position.copy(position);const d=new V3(position.x-target.x,position.y-target.y,position.z-target.z);this.distance=Math.max(3.5,d.length());this.yaw=Math.atan2(-d.x,-d.z)*180/Math.PI;this.pitch=Math.asin(d.y/d.length())*180/Math.PI;this.update();}
}

function makeEntity(name,type,position=[0,0,0],scale=[1,1,1],material='stone',opts={}){
  const e={id:state.nextId++,name,type,position:new V3(...position),rotation:new V3(...(opts.rotation||[0,0,0])),scale:new V3(...scale),material,static:opts.static!==false,visible:true,editable:!!opts.editable,selected:false,parent:null,bounds:Math.max(...scale)};state.entities.set(e.id,e);return e;
}
function addWorldBox(name,p,s,m,opts={}){return makeEntity(name,'box',p,s,m,{...opts,editable:false,static:true});}
function addWorldShape(type,name,p,s,m,opts={}){return makeEntity(name,type,p,s,m,{...opts,editable:false,static:true});}
function clearWorld(){for(const e of [...state.entities.values()])if(!e.editable)state.entities.delete(e.id);}

function buildWorld(){
  clearWorld();
  addWorldBox('World Ground',[0,-1,0],[180,1,165],'grass');
  addWorldBox('River',[18,-.05,0],[5,.14,220],'water',{static:true});
  const road='road';for(const [name,p,s] of [['North Road',[0,.04,-34],[190,.05,4]],['South Road',[0,.04,34],[190,.05,4]],['West Road',[-72,.04,0],[4,.05,150]],['East Road',[72,.04,0],[4,.05,150]]])addWorldBox(name,p,s,road);
  for(let i=0;i<5;i++)addWorldBox('Bridge '+i,[18,.22,-116+i*58],[8,.22,2.7],'wood');
  addWorldBox('Central Plaza',[0,.2,0],[24,.2,24],'stone');
  addWorldShape('cylinder','Fountain',[0,.7,0],[5,.7,5],'stone');addWorldShape('cylinder','Fountain Water',[0,1.42,0],[4,.06,4],'water');
  for(let i=0;i<12;i++){const a=i*Math.PI/6;addWorldShape('cylinder','Plaza Pillar',[Math.cos(a)*18,1.6,Math.sin(a)*18],[.75,1.6,.75],'stone');}
  addWorldShape('cylinder','Beacon',[0,5,0],[.8,4,.8],'gold');addWorldShape('sphere','Beacon Glow',[0,10,0],[1.25,1.25,1.25],'gold');
  const building=(name,x,z,w,d,h,roof='roof')=>{addWorldBox(name,[x,h*.5,z],[w,h*.5,d],'wood');addWorldBox(name+' Base',[x,.32,z],[w*1.05,.32,d*1.05],'stone');addWorldShape('cone',name+' Roof',[x,h+1.1,z],[Math.max(w,d),1.1,Math.max(w,d)],roof);};
  for(let x=-110;x<=-45;x+=22)for(let z=-22;z<=22;z+=22)building(`Old Town ${x}:${z}`,x,z,7,6,6+(Math.abs(x+z)%4));
  for(let i=0;i<24;i++){const x=-20+((i*19)%100),z=56+((i*37)%82),h=5+(i%5);addWorldShape('cylinder','Pine Trunk',[x,h*.35,z],[.45,h*.35,.45],'wood',{static:true});addWorldShape('cone','Pine Crown',[x,h*.95,z],[2.5,3.2,2.5],i%2?'leaf':'leaf2');}
  for(let i=0;i<18;i++){const x=62+((i*31)%92),z=-110+((i*17)%70),h=3+(i%4)*1.8;addWorldShape('sphere','Red Mesa Rock',[x,h*.45,z],[3.2,h,3.2],'sand');}
  for(let i=0;i<12;i++){const x=-110+(i%4)*18,z=76+Math.floor(i/4)*18;addWorldBox('Ruin Wall',[x,2.2,z],[5,2.2,.6],'stone');if(i%3===0)addWorldShape('cylinder','Ruin Column',[x+4,4,z],[.75,4,.75],'stone');}
  for(let i=0;i<10;i++){const x=84+(i%5)*16,z=72+Math.floor(i/5)*22;building('Outpost '+i,x,z,6,5,5+(i%2));}
  for(let i=0;i<180;i++){const x=((i*73)%360)-180,z=((i*127)%330)-165;if(Math.abs(x)<30&&Math.abs(z)<30)continue;if(Math.abs(x-18)<9)continue;if(i%4===0){const s=.75+(i%7)*.09;addWorldShape('cylinder','Tree Trunk',[x,1.5*s,z],[.35*s,1.5*s,.35*s],'wood');addWorldShape('sphere','Tree Canopy',[x,4.0*s,z],[1.7*s,1.8*s,1.7*s],i%8?'leaf':'leaf2');}else if(i%4===1)addWorldShape('sphere','Rock',[x,.65,z],[1.2+(i%3)*.4,.7,1.1],'stone');}
  $('world-status').textContent=`World 7 × 7 sectors · ${[...state.entities.values()].length} objects`;
}

class Player {
  constructor(){this.root=makeEntity('Player','empty',[0,0,12],[1,1,1],'stone',{editable:false,static:false});this.parts=[];this.speed=6;this.sprint=1.65;this.yaw=180;this.walk=0;this.build();}
  part(name,type,p,s,m){const e=makeEntity(name,type,p,s,m,{editable:false,static:false});e.parent=this.root.id;this.parts.push(e);return e;}
  build(){this.part('Body','capsule',[0,1.35,0],[.58,1,.44],'shirt');this.hips=this.part('Hips','box',[0,.75,0],[.55,.25,.4],'pants');this.part('Head','sphere',[0,2.55,0],[.46,.52,.46],'skin');this.part('Hair','sphere',[0,2.82,0],[.51,.23,.5],'dark');this.part('Scarf','box',[0,1.95,-.48],[.44,.12,.08],'gold');this.leftArm=this.part('Arm.L','capsule',[-.7,1.4,0],[.18,.7,.18],'shirt');this.rightArm=this.part('Arm.R','capsule',[.7,1.4,0],[.18,.7,.18],'shirt');this.leftLeg=this.part('Leg.L','capsule',[-.3,.25,0],[.21,.72,.22],'pants');this.rightLeg=this.part('Leg.R','capsule',[.3,.25,0],[.21,.72,.22],'pants');}
  update(dt){let x=(state.keys.KeyD?1:0)-(state.keys.KeyA?1:0),z=(state.keys.KeyS?1:0)-(state.keys.KeyW?1:0),len=Math.hypot(x,z);if(!len){this.animate(0,1);return 0;}x/=len;z/=len;const y=state.camera.yaw*Math.PI/180;const dx=x*Math.cos(y)-z*Math.sin(y),dz=x*Math.sin(y)+z*Math.cos(y);const sp=this.speed*((state.keys.ShiftLeft||state.keys.ShiftRight)?this.sprint:1);this.root.position.x+=dx*sp*dt;this.root.position.z+=dz*sp*dt;this.yaw=smoothAngle(this.yaw,Math.atan2(dx,dz)*180/Math.PI,1-Math.pow(.001,dt));this.root.rotation.y=this.yaw*Math.PI/180;this.walk+=dt*sp*1.15;this.animate(Math.sin(this.walk),sp>7);return sp;}
  animate(step,fast){const m=fast?1.3:1;this.leftLeg.rotation.x=step*.48*m;this.rightLeg.rotation.x=-step*.48*m;this.leftArm.rotation.x=-step*.35*m;this.rightArm.rotation.x=step*.35*m;this.hips.position.y=.75+Math.abs(step)*.06;}
}
function smoothAngle(a,b,t){let d=((b-a+540)%360)-180;return a+d*t;}

function syncChildren(){if(!state.player)return;const root=state.player.root;for(const p of state.player.parts){const parent=state.entities.get(p.parent);if(parent){p.position.x=parent.position.x+rotateY(parent.position,p=root?root:parent,root.rotation.y).x;}}
  // parts are stored as world-space offsets from the player; apply parent transform cheaply
  for(const p of state.player.parts){const q=localOffsetFor(p.name);const r=rotateOffset(q,root.rotation.y);p.position.set(root.position.x+r.x,root.position.y+r.y,root.position.z+r.z);p.rotation.y=root.rotation.y+(p.name.startsWith('Leg')||p.name.startsWith('Arm')?0:0);}
}
function rotateOffset(v,a){const c=Math.cos(a),s=Math.sin(a);return new V3(v.x*c-v.z*s,v.y,v.x*s+v.z*c);}
function rotateY(v,_p,a){return rotateOffset(new V3(v.x,v.y,v.z),a);}
function localOffsetFor(name){const map={Body:[0,1.35,0],Hips:[0,.75,0],Head:[0,2.55,0],Hair:[0,2.82,0],Scarf:[0,1.95,-.48],'Arm.L':[-.7,1.4,0],'Arm.R':[.7,1.4,0],'Leg.L':[-.3,.25,0],'Leg.R':[.3,.25,0]};return new V3(...(map[name]||[0,0,0]));}

function setupEditor(){
  $('new-scene').addEventListener('click',resetEditorScene);$('add-object').addEventListener('click',()=>toggleCreateMenu());$('focus-selection').addEventListener('click',focusSelection);$('delete-object')?.addEventListener('click',()=>{});
  $('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);$('save-scene').addEventListener('click',downloadScene);$('import-scene').addEventListener('click',()=>$('scene-file').click());$('scene-file').addEventListener('change',importScene);$('map-toggle').addEventListener('click',()=>toggleMap(true));$('map-close').addEventListener('click',()=>toggleMap(false));$('play').addEventListener('click',togglePlayMode);
  document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));document.querySelectorAll('[data-create]').forEach(b=>b.addEventListener('click',()=>{createEditable(b.dataset.create);toggleCreateMenu(false);}));
  $('viewport').addEventListener('dblclick',pickEntity);document.addEventListener('keydown',onKeyDown);document.addEventListener('keyup',e=>state.keys[e.code]=false);
}
function onKeyDown(e){if(isTyping())return;state.keys[e.code]=true;if(e.code==='Delete'&&!state.playMode)deleteSelection();if(e.code==='KeyM'&&!state.playMode)toggleMap(!state.mapOpen);if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();e.shiftKey?redo():undo();}if((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();downloadScene();}if(e.code==='Escape'&&state.playMode)togglePlayMode();}
function isTyping(){const a=document.activeElement;return a?.tagName==='INPUT'||a?.tagName==='TEXTAREA'||a?.tagName==='SELECT';}
function toggleCreateMenu(force){const m=$('create-menu');m.classList.toggle('hidden',force===undefined?!m.classList.contains('hidden'):!force);}
function createEditable(type){const p=getCursorGround();const map={box:['box',[1,1,1],'stone'],sphere:['sphere',[1,1,1],'gold'],capsule:['capsule',[1,1,1],'shirt'],cylinder:['cylinder',[1,1,1],'wood'],cone:['cone',[1,1,1],'roof'],torus:['torus',[1,1,1],'gold'],plane:['plane',[5,1,5],'grass'],empty:['empty',[1,1,1],'stone']};const d=map[type]||map.box;const e=makeEntity(nextName(type),d[0],[p.x,p.y+1,p.z],d[1],d[2],{editable:true,static:false});selectEntity(e);recordHistory();toast('Created '+e.name);}
function nextName(base){return cap(base)+' '+state.nextId;}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function getCursorGround(){return new V3(state.mouseWorld.x,0,state.mouseWorld.z);}
function pickEntity(){const world=getCursorGround(),candidates=[...state.entities.values()].filter(e=>e.editable&&e.visible);let best=null,bd=Infinity;for(const e of candidates){const d=Math.hypot(e.position.x-world.x,e.position.z-world.z);const r=Math.max(...[e.scale.x,e.scale.y,e.scale.z])*1.8;if(d<r&&d<bd){best=e;bd=d;}}if(best)selectEntity(best);}
function selectEntity(e){for(const x of state.entities.values())x.selected=false;state.selection=e||null;if(e)e.selected=true;refreshInspector();refreshHierarchy();}
function deleteSelection(){if(!state.selection)return;state.entities.delete(state.selection.id);state.selection=null;refreshInspector();refreshHierarchy();recordHistory();toast('Deleted object');}
function focusSelection(){const e=state.selection;if(!e)return;state.camera.snap(new V3(e.position.x+8,e.position.y+6,e.position.z+8),e.position);}
function setTool(t){state.activeTool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));toast(cap(t)+' tool');}
function refreshHierarchy(){const h=$('hierarchy');if(!h)return;const edit=[...state.entities.values()].filter(e=>e.editable);$('scene-count').textContent=`${edit.length} objects`;h.innerHTML=edit.map(e=>`<button class="tree-row ${e.selected?'selected':''}" data-id="${e.id}"><span>◇</span>${escapeHtml(e.name)}<small>${e.type}</small></button>`).join('');h.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>selectEntity(state.entities.get(Number(b.dataset.id)))));}
function refreshInspector(){const p=$('inspector'),e=state.selection;if(!p)return;if(!e){p.innerHTML='<div class="empty-state">Select an object to edit its transform and rendering properties.</div>';return;}p.innerHTML=`<div class="inspector-card"><label>Name<input id="i-name" value="${escapeHtml(e.name)}"></label><label>Position<div class="triple">${inp('px',e.position.x)}${inp('py',e.position.y)}${inp('pz',e.position.z)}</div></label><label>Rotation<div class="triple">${inp('rx',e.rotation.x*180/Math.PI)}${inp('ry',e.rotation.y*180/Math.PI)}${inp('rz',e.rotation.z*180/Math.PI)}</div></label><label>Scale<div class="triple">${inp('sx',e.scale.x)}${inp('sy',e.scale.y)}${inp('sz',e.scale.z)}</div></label><button id="inspector-delete" class="danger">Delete Object</button></div>`;
  for(const id of ['px','py','pz','rx','ry','rz','sx','sy','sz'])$(id).addEventListener('input',ev=>{const v=Number(ev.target.value)||0; if(id[0]==='p')e.position[id[1]==='x'?'x':id[1]==='y'?'y':'z']=v; else if(id[0]==='r')e.rotation[id[1]==='x'?'x':id[1]==='y'?'y':'z']=v*Math.PI/180; else e.scale[id[1]==='x'?'x':id[1]==='y'?'y':'z']=Math.max(.01,v);});$('i-name').addEventListener('change',ev=>{e.name=ev.target.value.trim()||e.name;refreshHierarchy();});$('inspector-delete').addEventListener('click',deleteSelection);
}
function inp(id,v){return `<input id="${id}" type="number" step="0.1" value="${Number(v).toFixed(2)}">`;}
function recordHistory(){if(state.historyLock)return;const s=serializeScene();const j=JSON.stringify(s);const cur=state.history[state.historyIndex];if(cur&&JSON.stringify(cur)===j)return;state.history=state.history.slice(0,state.historyIndex+1);state.history.push(s);state.historyIndex=state.history.length-1;updateHistoryButtons();}
function serializeScene(){return{version:2,engine:'Salvage Standalone WebGL2',objects:[...state.entities.values()].filter(e=>e.editable).map(e=>({name:e.name,type:e.type,position:[e.position.x,e.position.y,e.position.z],rotation:[e.rotation.x,e.rotation.y,e.rotation.z],scale:[e.scale.x,e.scale.y,e.scale.z],material:e.material,static:e.static}))};}
function restoreSnapshot(s){state.historyLock=true;for(const e of [...state.entities.values()])if(e.editable)state.entities.delete(e.id);for(const o of s.objects||[]){const e=makeEntity(o.name,o.type,o.position,o.scale,o.material||'stone',{editable:true,static:!!o.static,rotation:o.rotation});state.entities.set(e.id,e);}state.historyLock=false;selectEntity(null);refreshHierarchy();refreshInspector();}
function undo(){if(state.historyIndex<=0)return;state.historyIndex--;restoreSnapshot(state.history[state.historyIndex]);updateHistoryButtons();toast('Undo');}
function redo(){if(state.historyIndex>=state.history.length-1)return;state.historyIndex++;restoreSnapshot(state.history[state.historyIndex]);updateHistoryButtons();toast('Redo');}
function updateHistoryButtons(){$('undo').disabled=state.historyIndex<=0;$('redo').disabled=state.historyIndex>=state.history.length-1;}
function resetEditorScene(){for(const e of [...state.entities.values()])if(e.editable)state.entities.delete(e.id);selectEntity(null);recordHistory();toast('New scene');}
function downloadScene(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(serializeScene(),null,2)],{type:'application/json'}));a.download='salvage-scene.json';a.click();URL.revokeObjectURL(a.href);toast('Scene exported');}
function importScene(ev){const f=ev.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{restoreSnapshot(JSON.parse(r.result));state.history=[serializeScene()];state.historyIndex=0;updateHistoryButtons();toast('Scene imported');}catch(err){console.error(err);toast('Import failed');}ev.target.value='';};r.readAsText(f);}
function togglePlayMode(){state.playMode=!state.playMode;if(state.playMode){state.player=new Player();state.camera.snap(new V3(8,5,20),new V3(0,1.8,12));$('play').textContent='■ Stop';$('play').classList.add('active');$('play-hud').classList.remove('hidden');$('viewport-help').textContent='WASD move · Shift sprint · drag orbit · M map';$('editor-status').textContent='Play mode';}else{$('play').textContent='▶ Play';$('play').classList.remove('active');$('play-hud').classList.add('hidden');$('viewport-help').textContent='Drag orbit · Shift+drag pan · Wheel zoom · Double-click select';if(state.player){for(const e of [state.player.root,...state.player.parts])state.entities.delete(e.id);state.player=null;}state.camera.snap(new V3(28,28,32),new V3(0,2,0));$('editor-status').textContent='Editor ready';refreshHierarchy();}}
function update(dt){if(state.playMode&&state.player){const speed=state.player.update(Math.min(dt,.033));syncChildren();const p=state.player.root.position;const target=new V3(p.x,p.y+1.8,p.z);state.camera.target.x+=(target.x-state.camera.target.x)*Math.min(1,dt*8);state.camera.target.y+=(target.y-state.camera.target.y)*Math.min(1,dt*8);state.camera.target.z+=(target.z-state.camera.target.z)*Math.min(1,dt*8);state.camera.update();$('hud-speed').textContent=speed.toFixed(1)+' m/s';$('hud-fps').textContent=Math.round(state.fps)+' FPS';$('hud-zone').textContent=zoneFor(p.x,p.z);if(state.mapOpen)drawWorldMap();}else{$('performance-status').textContent=`CPU ${Math.round(1000/Math.max(dt,.001))} FPS · Draws ${state.engine?.draws||0}`;}}
function zoneFor(x,z){if(Math.abs(x)<30&&Math.abs(z)<30)return'Central Plaza';if(x<-42&&Math.abs(z)<30)return'Old Town';if(z>42&&x<30)return'Pine Valley';if(x>45&&z<-42)return'Red Mesa';if(x<-42&&z>48)return'Ancient Ruins';if(x>55&&z>45)return'North Outpost';return'Frontier';}
function drawWorldMap(){const c=$('world-map'),ctx=c?.getContext('2d');if(!ctx)return;const w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0a121a';ctx.fillRect(0,0,w,h);ctx.strokeStyle='rgba(255,255,255,.06)';for(let x=0;x<w;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}const mx=x=>(x+180)/360*w,my=z=>(165-z)/330*h;ctx.fillStyle='rgba(35,116,151,.35)';ctx.fillRect(mx(12),0,20,h);ctx.fillStyle='#8b94a2';for(const [x,z,ww,hh] of [[-180,-34,360,7],[-180,34,360,7],[-72,-150,7,300],[72,-150,7,300]])ctx.fillRect(mx(x),my(z),ww/1,hh);const zones=[['Central Plaza',0,0],['Old Town',-82,0],['Pine Valley',-10,90],['Red Mesa',110,-78],['Ancient Ruins',-86,110],['North Outpost',118,84]];for(const [name,x,z] of zones){const px=mx(x),py=my(z);ctx.fillStyle='rgba(184,139,255,.2)';ctx.beginPath();ctx.arc(px,py,38,0,TAU);ctx.fill();ctx.fillStyle='#d1b1ff';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText(name,px,py-45);}if(state.player){const p=state.player.root.position;ctx.fillStyle='#70a9ff';ctx.beginPath();ctx.arc(mx(p.x),my(p.z),7,0,TAU);ctx.fill();}}
function toggleMap(open){state.mapOpen=open;$('map-modal')?.classList.toggle('hidden',!open);if(open)drawWorldMap();}
function getRayFromMouse(){const rect=$('viewport').getBoundingClientRect();const x=(state.mouseWorld.sx=((state.mouseWorld.clientX-rect.left)/rect.width)*2-1);const y=(state.mouseWorld.sy=1-((state.mouseWorld.clientY-rect.top)/rect.height)*2);const inv=inverseMat4(state.camera.vp);const near=unproject(x,y,-1,inv),far=unproject(x,y,1,inv);return {o:near,d:new V3(far.x-near.x,far.y-near.y,far.z-near.z).normalize()};}
function unproject(x,y,z,m){const q=[x,y,z,1],o=[0,0,0,0];for(let r=0;r<4;r++)o[r]=m[r]*q[0]+m[4+r]*q[1]+m[8+r]*q[2]+m[12+r]*q[3];return new V3(o[0]/o[3],o[1]/o[3],o[2]/o[3]);}
function inverseMat4(a){const m=a,b=new Float32Array(16),a00=m[0],a01=m[1],a02=m[2],a03=m[3],a10=m[4],a11=m[5],a12=m[6],a13=m[7],a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15],b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32,det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;if(!det)return mat4Identity();const inv=1/det;b[0]=(a11*b11-a12*b10+a13*b09)*inv;b[1]=(-a01*b11+a02*b10-a03*b09)*inv;b[2]=(a31*b05-a32*b04+a33*b03)*inv;b[3]=(-a21*b05+a22*b04-a23*b03)*inv;b[4]=(-a10*b11+a12*b08-a13*b07)*inv;b[5]=(a00*b11-a02*b08+a03*b07)*inv;b[6]=(-a30*b05+a32*b02-a33*b01)*inv;b[7]=(a20*b05-a22*b02+a23*b01)*inv;b[8]=(a10*b10-a11*b08+a13*b06)*inv;b[9]=(-a00*b10+a01*b08-a03*b06)*inv;b[10]=(a30*b04-a31*b02+a33*b00)*inv;b[11]=(-a20*b04+a21*b02-a23*b00)*inv;b[12]=(-a10*b09+a11*b07-a12*b06)*inv;b[13]=(a00*b09-a01*b07+a02*b06)*inv;b[14]=(-a30*b03+a31*b01-a32*b00)*inv;b[15]=(a20*b03-a21*b01+a22*b00)*inv;return b;}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),1100);}
function selectMouseWorld(e){const r=$('viewport').getBoundingClientRect();state.mouseWorld.clientX=e.clientX;state.mouseWorld.clientY=e.clientY;const ray=getRayFromMouse();const hit=rayPlane(ray.o,ray.d,0);if(hit){state.mouseWorld.x=hit.x;state.mouseWorld.y=hit.y;state.mouseWorld.z=hit.z;}}

function frame(t){const dt=Math.min(.033,(t-state.lastFrame)/1000||.016);state.lastFrame=t;const fps=1/Math.max(dt,.0005);state.frameSamples.push(fps);if(state.frameSamples.length>30)state.frameSamples.shift();state.fps=state.frameSamples.reduce((a,b)=>a+b,0)/state.frameSamples.length;update(dt);state.engine.draws=state.engine.renderer.render([...state.entities.values()],state.camera);$('performance-status').textContent=`${Math.round(state.fps)} FPS · ${state.engine.draws} GPU draw calls · ${[...state.entities.values()].length} objects`;requestAnimationFrame(frame);}

function boot(){
  try{
    $('welcome')?.classList.add('hidden');$('renderer-status').textContent='Starting standalone WebGL2 renderer…';
    state.engine={renderer:new GLRenderer($('viewport')),draws:0};state.camera=new CameraController($('viewport'));setupEditor();buildWorld();refreshHierarchy();refreshInspector();recordHistory();state.camera.snap(new V3(28,28,32),new V3(0,2,0));$('renderer-status').textContent='Standalone WebGL2 · instanced renderer';$('editor-status').textContent='Editor ready';requestAnimationFrame(frame);
  } catch(err){console.error(err);$('welcome')?.classList.remove('hidden');$('renderer-status').textContent=`Graphics error: ${err.message}`;$('editor-status').textContent='Editor could not start';const b=$('enter-editor');if(b){b.textContent='Open Safe Editor';b.disabled=false;}}
}

$('enter-editor')?.addEventListener('click',boot);
window.addEventListener('keydown',e=>{if(e.code==='Enter'&&!$('welcome')?.classList.contains('hidden')&&!isTyping()){e.preventDefault();boot();}});
$('viewport')?.addEventListener('mousemove',selectMouseWorld);
$('viewport')?.addEventListener('contextmenu',e=>e.preventDefault());
if(new URLSearchParams(location.search).has('autoboot')) queueMicrotask(boot);
