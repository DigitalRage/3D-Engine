import { performance } from 'node:perf_hooks';
import { Renderer } from '../engine/render.js';
import { Scene } from '../engine/scene.js';
import { Camera } from '../engine/camera.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';

globalThis.window={innerWidth:1280,innerHeight:720,addEventListener(){}};
globalThis.document={getElementById(){return {width:0,height:0}},createElement(){return {getContext(){return null}}}};
class GL {
 constructor(){Object.assign(this,{VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,COLOR_BUFFER_BIT:8,DEPTH_BUFFER_BIT:16,DEPTH_TEST:1,LESS:2,CCW:3,BLEND:4,CULL_FACE:5,BACK:6,GREATER:18,ARRAY_BUFFER:7,ELEMENT_ARRAY_BUFFER:8,STATIC_DRAW:9,DYNAMIC_DRAW:10,FLOAT:11,TRIANGLES:12,LINES:13,UNSIGNED_SHORT:14,UNSIGNED_INT:15,TEXTURE0:16,TEXTURE_2D:17});}
 getExtension(){return null} createShader(){return{}} shaderSource(){} compileShader(){} getShaderParameter(){return true} getShaderInfoLog(){return''} createProgram(){return{}} attachShader(){} linkProgram(){} getProgramParameter(){return true} getProgramInfoLog(){return''} getUniformLocation(_p,n){return n} getAttribLocation(_p,n){return n.startsWith('aInstance')?-1:0} useProgram(){} clearColor(){} enable(){} disable(){} depthFunc(){} frontFace(){} depthMask(){} clear(){} viewport(){} createBuffer(){return{}} deleteBuffer(){} bindBuffer(){} bufferData(){} bufferSubData(){} createVertexArray(){return{}} deleteVertexArray(){} bindVertexArray(){} enableVertexAttribArray(){} disableVertexAttribArray(){} vertexAttribPointer(){} vertexAttribDivisor(){} drawElements(){} drawElementsInstanced(){} drawArrays(){} activeTexture(){} bindTexture(){} uniformMatrix4fv(){} uniform4f(){} uniform4fv(){} uniform3f(){} uniform3fv(){} uniform2f(){} uniform1f(){} uniform1i(){} blendFunc(){} cullFace(){} clearDepth(){}
}
const scene=new Scene();
const total=2200;
for(let i=0;i<total;i++){
 const x=(i%55)*2-54, z=Math.floor(i/55)*2-39;
 const p=[[x*.015,0,0],[1+x*.015,0,0],[x*.015,1,0]];
 const mesh=new Mesh(new Material({shading:'toon',color:[(i%11)/11,.75,.9,1]}),{lazyTopology:true});
 mesh.positions=p; mesh.faces=[[0,1,2]]; mesh.faceColors=[[1,1,1,1]]; mesh.faceUvs=[[[0,0],[1,0],[0,1]]];
 mesh.rebuildRenderData({buildEditorData:false});
 mesh.position=[x*0.6,0,z*0.6];
 mesh.rotation=[0,(i%17)*0.03,0];
 scene.add(mesh);
}
const canvas={width:960,height:540,style:{},getContext(){return new GL()}};
const renderer=new Renderer(canvas); await renderer.ready; renderer.setAutoQuality(false);
const cam=new Camera(); cam.position=[0,20,55]; cam.target=[0,0,0]; cam.far=250;
for(let i=0;i<3;i++) renderer.render(scene,cam);
const samples=[];
for(let i=0;i<120;i++){
 const a=i*.06; cam.position[0]=Math.sin(a)*55; cam.position[2]=Math.cos(a)*55;
 renderer.render(scene,cam); samples.push(renderer.frameStats.cpuMs);
}
samples.sort((a,b)=>a-b); const pct=p=>samples[Math.floor((samples.length-1)*p)];
console.log(JSON.stringify({p50CpuMs:pct(.5),p95CpuMs:pct(.95),maxCpuMs:samples.at(-1),drawCalls:renderer.frameStats.drawCalls,meshes:scene.meshes.length},null,2));
