import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { COLORS, classify, domain, position, ramp, valueOf, visible, type Dataset, type Manifest, type Ref, type State } from './model';

export class GeoScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.OrthographicCamera(-1,1,1,-1,1,150000);
  readonly controls: OrbitControls;
  refs: Ref[]=[];
  counts={surface:0,drill:0,collar:0,missing:0,nonpositive:0,outside:0};
  selected: Ref|null=null;
  private points: THREE.Points;
  private collarPoints: THREE.Points;
  private lines: LineSegments2;
  private terrain: THREE.Mesh;
  private selectionPoint: THREE.Points;
  private selectionLine: LineSegments2;
  private visiblePoints: Ref[]=[];
  private groups=new Map<number,number[]>();
  private cameraSpan=20000;
  private drawRequested=true;
  private raycaster=new THREE.Raycaster();
  private palette=ramp.map(c=>new THREE.Color(c));
  private width=1;
  private height=1;
  private pointerDown=[0,0];
  private lastPick=0;
  private moving=false;
  frameMs=0;
  colorMs=0;
  pickMs=0;
  onPick: (ref: Ref|null, click:boolean, x:number,y:number)=>void=()=>{};
  onFrame: ()=>void=()=>{};
  constructor(private host: HTMLElement,readonly data: Dataset,readonly manifest: Manifest){
    this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor('#eef1ed');
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.camera.up.set(0,0,1);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=false;
    this.controls.minZoom=.2;this.controls.maxZoom=150;
    this.controls.addEventListener('change',()=>{this.drawRequested=true;});
    this.controls.addEventListener('start',()=>{this.moving=true;});
    this.controls.addEventListener('end',()=>{this.moving=false;});
    this.scene.add(new THREE.AmbientLight(0xffffff,2));
    const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-4000,-7000,16000);this.scene.add(sun);
    const pointMaterial=new THREE.ShaderMaterial({vertexColors:true,uniforms:{size:{value:4},pixelRatio:{value:this.renderer.getPixelRatio()}},
      vertexShader:'varying vec3 vColor; uniform float size; uniform float pixelRatio; void main(){vColor=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=size*pixelRatio;}',
      fragmentShader:'varying vec3 vColor; void main(){if(length(gl_PointCoord-vec2(.5))>.5)discard;gl_FragColor=vec4(vColor,1.0);#include <colorspace_fragment>\n}'});
    // Includes must start on a new line for GLSL preprocessor compatibility.
    pointMaterial.fragmentShader=pointMaterial.fragmentShader.replace(';#include',';\n#include');
    this.points=new THREE.Points(new THREE.BufferGeometry(),pointMaterial);
    this.collarPoints=new THREE.Points(new THREE.BufferGeometry(),pointMaterial.clone());
    this.lines=new LineSegments2(new LineSegmentsGeometry(),new LineMaterial({linewidth:2,vertexColors:true,alphaToCoverage:true}));
    this.scene.add(this.points,this.collarPoints,this.lines);
    this.selectionPoint=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:COLORS.selected,size:11,sizeAttenuation:false,depthTest:false}));
    this.selectionLine=new LineSegments2(new LineSegmentsGeometry(),new LineMaterial({color:COLORS.selected,linewidth:6,depthTest:false}));
    this.selectionPoint.renderOrder=this.selectionLine.renderOrder=10;
    this.selectionPoint.visible=this.selectionLine.visible=false;
    this.scene.add(this.selectionPoint,this.selectionLine);
    this.terrain=this.createTerrain();this.terrain.visible=false;this.scene.add(this.terrain);
    this.createAxes();
    new ResizeObserver(()=>this.resize()).observe(host);
    this.renderer.domElement.addEventListener('pointerdown',e=>{this.pointerDown=[e.clientX,e.clientY];});
    this.renderer.domElement.addEventListener('pointerup',e=>{if(Math.hypot(e.clientX-this.pointerDown[0],e.clientY-this.pointerDown[1])<4)this.pointer(e,true);});
    this.renderer.domElement.addEventListener('pointermove',e=>{if(!this.moving && performance.now()-this.lastPick>75){this.lastPick=performance.now();this.pointer(e,false);}});
    this.renderer.domElement.addEventListener('pointerleave',()=>this.onPick(null,false,0,0));
    this.reset('oblique');this.resize();
    const loop=()=>{requestAnimationFrame(loop);if(this.drawRequested){const start=performance.now();this.renderer.render(this.scene,this.camera);this.frameMs=performance.now()-start;this.drawRequested=false;this.onFrame();}};loop();
  }
  local(e:number,n:number,h:number): THREE.Vector3 {const o=this.manifest.origin;return new THREE.Vector3(e-o[0],n-o[1],h-o[2]);}
  private color(ref:Ref,state:State): THREE.Color {
    if(state.element==='type'||ref.kind==='collar')return new THREE.Color(COLORS[ref.kind]);
    const chem=this.manifest.chemistry.find(c=>c.id===state.element)!;
    const v=valueOf(this.data,ref,chem);const range=domain(state,chem);const t=classify(v,state,range);
    if(t==='missing'){this.counts.missing++;return new THREE.Color(COLORS.missing);}
    if(t==='nonpositive'){this.counts.nonpositive++;return new THREE.Color(COLORS.nonpositive);}
    if(v!<range[0]||v!>range[1])this.counts.outside++;
    const scaled=t*(this.palette.length-1),i=Math.min(Math.floor(scaled),this.palette.length-2);
    return this.palette[i].clone().lerp(this.palette[i+1],scaled-i);
  }
  update(state:State){
    const started=performance.now();
    this.counts={surface:0,drill:0,collar:0,missing:0,nonpositive:0,outside:0};this.refs=[];this.visiblePoints=[];this.groups.clear();
    const pp:number[]=[],pc:number[]=[],cp:number[]=[],cc:number[]=[],lp:number[]=[],lc:number[]=[];
    const chemical=this.manifest.chemistry.find(c=>c.id===state.element);
    for(const kind of ['surface','drill','collar'] as const){
      for(let index=0;index<this.data[kind].rows.length;index++){
        const ref={kind,index};if(!visible(this.data,ref,state,chemical))continue;
        this.refs.push(ref);this.counts[kind]++;
        const c=this.color(ref,state);
        if(kind==='drill'){
          const g=this.data.drill.geometry[index]!;const collar=this.data.collar.geometry[g[0]];
          lp.push(...this.local(collar[0],collar[1],g[1]).toArray(),...this.local(collar[0],collar[1],g[2]).toArray());lc.push(c.r,c.g,c.b,c.r,c.g,c.b);
          const entries=this.groups.get(g[0])??[];entries.push(index);this.groups.set(g[0],entries);
        }else{
          const p=this.local(...position(this.data,ref));(kind==='surface'?pp:cp).push(p.x,p.y,p.z);(kind==='surface'?pc:cc).push(c.r,c.g,c.b);this.visiblePoints.push(ref);
        }
      }
    }
    for(const [obj,pos,col] of [[this.points,pp,pc],[this.collarPoints,cp,cc]] as const){
      obj.geometry.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeBoundingSphere();obj.geometry=g;
      (obj.material as THREE.ShaderMaterial).uniforms.size.value=obj===this.points?state.pointSize:state.pointSize+2;
    }
    this.lines.geometry.dispose();const lg=new LineSegmentsGeometry();if(lp.length){lg.setPositions(lp);lg.setColors(lc);}this.lines.geometry=lg;this.lines.visible=lp.length>0;
    (this.lines.material as LineMaterial).linewidth=state.lineWidth;
    this.terrain.visible=state.terrain;
    this.select(this.selected && visible(this.data,this.selected,state,chemical)?this.selected:null);
    this.drawRequested=true;this.colorMs=performance.now()-started;
  }
  select(ref:Ref|null){
    this.selected=ref;this.selectionLine.visible=this.selectionPoint.visible=false;
    if(ref){
      if(ref.kind==='drill'){
        const g=this.data.drill.geometry[ref.index]!;const p=this.data.collar.geometry[g[0]];
        this.selectionLine.geometry.dispose();this.selectionLine.geometry=new LineSegmentsGeometry().setPositions([...this.local(p[0],p[1],g[1]).toArray(),...this.local(p[0],p[1],g[2]).toArray()]);this.selectionLine.visible=true;
      }else{
        this.selectionPoint.geometry.dispose();this.selectionPoint.geometry=new THREE.BufferGeometry().setFromPoints([this.local(...position(this.data,ref))]);this.selectionPoint.visible=true;
      }
    }
    this.drawRequested=true;
  }
  focus(ref:Ref){
    const p=this.local(...position(this.data,ref));const offset=this.camera.position.clone().sub(this.controls.target);this.controls.target.copy(p);this.camera.position.copy(p).add(offset);this.camera.zoom=ref.kind==='drill'?35:12;this.camera.updateProjectionMatrix();this.controls.update();this.drawRequested=true;
  }
  reset(mode:'oblique'|'top'|'east'|'north'){
    const b=this.manifest.bounds;const center=this.local((b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2);
    this.controls.target.copy(center);const span=Math.max(b[3]-b[0],b[4]-b[1],b[5]-b[2]);
    this.cameraSpan=span*1.32*Math.max(1,this.host.clientHeight/Math.max(this.host.clientWidth,1));this.camera.zoom=1;
    const directions={oblique:[1,-1.35,1.1],top:[0,-.00001,1],east:[1,0,.00001],north:[0,-1,.00001]};
    this.camera.position.copy(center).add(new THREE.Vector3(...directions[mode]).normalize().multiplyScalar(span*2));this.camera.up.set(0,0,1);this.camera.lookAt(center);this.resize();this.controls.update();this.drawRequested=true;
  }
  private resize(){
    this.width=Math.max(this.host.clientWidth,1);this.height=Math.max(this.host.clientHeight,1);const aspect=this.width/this.height;
    this.camera.left=-this.cameraSpan*aspect/2;this.camera.right=this.cameraSpan*aspect/2;this.camera.top=this.cameraSpan/2;this.camera.bottom=-this.cameraSpan/2;this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width,this.height);this.drawRequested=true;
  }
  private pointer(event:PointerEvent,click:boolean){
    const rect=this.renderer.domElement.getBoundingClientRect();const x=event.clientX-rect.left,y=event.clientY-rect.top;
    const ref=this.pick(x,y);this.onPick(ref,click,x,y);
  }
  pick(x:number,y:number):Ref|null {
    const started=performance.now();this.camera.updateMatrixWorld();this.raycaster.setFromCamera(new THREE.Vector2(x/this.width*2-1,-y/this.height*2+1),this.camera);
    const ray=this.raycaster.ray;
    const threshold=this.cameraSpan/this.camera.zoom/this.height*6;
    let best=threshold*threshold,depth=Infinity,result:Ref|null=null;
    const p=new THREE.Vector3(),q=new THREE.Vector3(),hit=new THREE.Vector3();
    const consider=(distance:number,ref:Ref,point:THREE.Vector3)=>{
      const d=point.clone().sub(ray.origin).dot(ray.direction);
      if(d>=0 && (distance<best-1e-6 || Math.abs(distance-best)<1e-6 && d<depth)){best=distance;depth=d;result=ref;}
    };
    for(const ref of this.visiblePoints){p.copy(this.local(...position(this.data,ref)));consider(ray.distanceSqToPoint(p),ref,p);}
    for(const [ci,indices] of this.groups){
      const c=this.data.collar.geometry[ci];let low=Infinity,high=-Infinity;
      for(const index of indices){const g=this.data.drill.geometry[index]!;low=Math.min(low,g[2]);high=Math.max(high,g[1]);}
      p.copy(this.local(c[0],c[1],low));q.copy(this.local(c[0],c[1],high));
      if(ray.distanceSqToSegment(p,q)>threshold*threshold)continue;
      for(const index of indices){const g=this.data.drill.geometry[index]!;p.copy(this.local(c[0],c[1],g[1]));q.copy(this.local(c[0],c[1],g[2]));const distance=ray.distanceSqToSegment(p,q,undefined,hit);consider(distance,{kind:'drill',index},hit);}
    }
    this.pickMs=performance.now()-started;return result;
  }
  projected(ref:Ref):[number,number]{const v=this.local(...position(this.data,ref)).project(this.camera);return [(v.x+1)/2*this.width,(1-v.y)/2*this.height];}
  private createTerrain():THREE.Mesh {
    const t=this.data.terrain,w=t.east.length,h=t.north.length,positions:number[]=[],indices:number[]=[];
    for(let j=0;j<h;j++)for(let i=0;i<w;i++)positions.push(...this.local(t.east[i],t.north[j],t.heights[j*w+i]??0).toArray());
    for(let j=0;j<h-1;j++)for(let i=0;i<w-1;i++){
      const a=j*w+i,b=a+1,c=a+w,d=c+1;if([a,b,c,d].every(k=>t.heights[k]!==null))indices.push(a,b,c,b,d,c);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
    return new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#c6caba',roughness:1,metalness:0,side:THREE.DoubleSide,transparent:true,opacity:.48,depthWrite:false}));
  }
  private label(text:string,at:THREE.Vector3){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const ctx=canvas.getContext('2d')!;ctx.font='48px Segoe UI';ctx.fillStyle='#65786e';ctx.textAlign='center';ctx.fillText(text,256,65);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false}));sprite.position.copy(at);sprite.scale.set(2000,375,1);this.scene.add(sprite);
  }
  private createAxes(){
    const b=this.manifest.bounds,base=Math.floor(b[2]/500)*500, xmin=Math.floor(b[0]/2000)*2000,xmax=Math.ceil(b[3]/2000)*2000,ymin=Math.floor(b[1]/2000)*2000,ymax=Math.ceil(b[4]/2000)*2000;
    const pos:number[]=[];const line=(a:THREE.Vector3,c:THREE.Vector3)=>pos.push(...a.toArray(),...c.toArray());
    for(let x=xmin;x<=xmax;x+=2000){line(this.local(x,ymin,base),this.local(x,ymax,base));this.label(String(x),this.local(x,ymin-450,base));}
    for(let y=ymin;y<=ymax;y+=2000){line(this.local(xmin,y,base),this.local(xmax,y,base));this.label(String(y),this.local(xmin-850,y,base));}
    line(this.local(xmin,ymin,base),this.local(xmin,ymin,Math.ceil(b[5]/1000)*1000));
    for(let z=base;z<=b[5]+500;z+=1000)this.label(String(z),this.local(xmin-700,ymin,z));
    this.label('E / m',this.local(xmax+600,ymin,base));this.label('N / m',this.local(xmin,ymax+450,base));this.label('H / m',this.local(xmin,ymin,b[5]+850));
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));this.scene.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:'#c8d2ca',transparent:true,opacity:.55})));
  }
  view(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),up:this.camera.up.toArray(),zoom:this.camera.zoom,span:this.cameraSpan};}
  restore(view:ReturnType<GeoScene['view']>){
    for(const key of ['position','target','up'] as const)if(!Array.isArray(view[key])||view[key].length!==3||!view[key].every(v=>Number.isFinite(v)&&Math.abs(v)<1e7))throw Error('相机坐标无效');
    if(!Number.isFinite(view.zoom)||view.zoom<.2||view.zoom>150||!Number.isFinite(view.span)||view.span<=0||view.span>1e6)throw Error('相机比例无效');
    if(new THREE.Vector3(...view.up).length()<.01||new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(...view.target))<1)throw Error('相机朝向无效');
    this.camera.position.fromArray(view.position);this.controls.target.fromArray(view.target);this.camera.up.fromArray(view.up);this.camera.zoom=view.zoom;this.cameraSpan=view.span;this.resize();this.controls.update();this.drawRequested=true;
  }
  directionVectors(){
    const q=this.camera.quaternion.clone().invert();return [['E',new THREE.Vector3(1,0,0)],['N',new THREE.Vector3(0,1,0)],['H',new THREE.Vector3(0,0,1)]].map(([label,v])=>({label:label as string,v:(v as THREE.Vector3).applyQuaternion(q)}));
  }
  screenshot(width=3840):HTMLCanvasElement {
    const height=Math.round(width*this.height/this.width),ratio=this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);this.renderer.setSize(width,height,false);
    const pmat=this.points.material as THREE.ShaderMaterial,cmat=this.collarPoints.material as THREE.ShaderMaterial;
    const scale=width/this.width,oldP=pmat.uniforms.pixelRatio.value,oldC=cmat.uniforms.pixelRatio.value,oldWidth=(this.lines.material as LineMaterial).linewidth;
    pmat.uniforms.pixelRatio.value=cmat.uniforms.pixelRatio.value=scale;(this.lines.material as LineMaterial).linewidth=oldWidth*scale;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    try{this.renderer.render(this.scene,this.camera);canvas.getContext('2d')!.drawImage(this.renderer.domElement,0,0);}finally{
      pmat.uniforms.pixelRatio.value=oldP;cmat.uniforms.pixelRatio.value=oldC;(this.lines.material as LineMaterial).linewidth=oldWidth;this.renderer.setPixelRatio(ratio);this.renderer.setSize(this.width,this.height);this.drawRequested=true;
    }
    return canvas;
  }
}
