import './style.css';
import { GeoScene } from './scene';
import { COLORS, defaults, domain, makeCSV, position, qualityNames, ramp, validateState, valueOf, type Dataset, type Manifest, type Ref, type State } from './model';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const escape=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fmt=(v:unknown,d=2)=>typeof v==='number'?v.toLocaleString('zh-CN',{maximumFractionDigits:d}):String(v??'—');
const count=(n:number)=>n.toLocaleString('en-US');
const kindName={surface:'地表采样点',drill:'钻孔分析区间',collar:'钻孔孔口'};
const app=$('app');
app.innerHTML=`
<header class="topbar">
  <div class="brand"><span class="brand-mark">◈</span><div><strong>加玛 <span>GeoProspect</span></strong><small>三维地学工作台 / JIAMA OBSERVATORY</small></div></div>
  <div class="project-caption"><span class="live-dot"></span>西藏 · 加玛矿区<span class="divider">/</span>观测数据空间建模</div>
  <div class="header-actions"><button id="quality-button" class="text-button">数据与方法 ↗</button><button id="export-png" class="primary">导出视图 <span>↗</span></button></div>
</header>
<div class="workspace">
<aside class="controls-panel">
  <div class="panel-heading"><span class="eyebrow">EXPLORER</span><h1>空间数据</h1><p>从地表，到深部。</p></div>
  <section><div class="section-title"><h2>01 <span>数据图层</span></h2><span class="mini">可独立显隐</span></div>
    <label class="layer"><input type="checkbox" id="surface" checked><i class="dot teal"></i><span>地表采样点<small>岩石 / 土壤地球化学</small></span><b id="surface-total">—</b></label>
    <label class="layer"><input type="checkbox" id="drill" checked><i class="line copper"></i><span>钻孔分析区间<small>垂直孔 · FROM → TO</small></span><b id="drill-total">—</b></label>
    <label class="layer compact"><input type="checkbox" id="collar" checked><i class="ring"></i><span>钻孔孔口</span><b id="collar-total">—</b></label>
    <label class="layer compact"><input type="checkbox" id="terrain"><i class="terrain-icon">▱</i><span>DEM 地形参考</span><span class="mini">30 m</span></label>
  </section>
  <section><div class="section-title"><h2>02 <span>颜色映射</span></h2><button id="reset-color" class="text-button small">重置</button></div>
    <label class="field">映射字段<select id="element"><option value="type">数据类型 · 默认</option></select></label>
    <div id="chem-controls" hidden>
      <div class="segmented" role="group" aria-label="颜色变换"><button id="linear" class="active">线性</button><button id="log">log₁₀</button></div>
      <div class="field-label">色域 <span id="domain-unit"></span><span class="mini">空白 = 全体数据范围</span></div>
      <div class="range-pair"><input id="domainMin" type="number" step="any" aria-label="色域下限" placeholder="自动下限"><span>—</span><input id="domainMax" type="number" step="any" aria-label="色域上限" placeholder="自动上限"></div>
      <p class="hint">筛选不改变色域；跨来源含量按统一单位比较。</p>
    </div>
  </section>
  <section><div class="section-title"><h2>03 <span>筛选与显示</span></h2><button id="reset-filter" class="text-button small">重置</button></div>
    <label class="field">地表样本类型<select id="sampleType"><option value="all">全部类型</option></select></label>
    <label class="field">钻孔编号<select id="hole"><option value="all">全部钻孔</option></select></label>
    <label class="field">高程来源<select id="elevation"><option value="all">原始高程 + DEM 估算</option><option value="original">仅原始高程</option><option value="dem">仅 DEM 估算点</option></select></label>
    <div id="concentration-filter" hidden><div class="field-label">含量筛选 <span id="filter-unit"></span></div><div class="range-pair"><input id="filterMin" type="number" step="any" aria-label="含量下限" placeholder="不限下限"><span>—</span><input id="filterMax" type="number" step="any" aria-label="含量上限" placeholder="不限上限"></div><p class="hint">仅筛选采样对象，孔口不参与含量筛选。</p></div>
    <label class="slider-label">点大小 <output id="point-size-label">4 px</output><input id="pointSize" type="range" min="1" max="12" value="4"></label>
    <label class="slider-label">线宽 <output id="line-width-label">2 px</output><input id="lineWidth" type="range" min="1" max="8" value="2"></label>
  </section>
  <div class="export-section"><button id="export-csv">↓ 筛选数据 CSV</button><div><button id="save-view">保存配置</button><button id="load-view">恢复配置</button></div><input id="view-file" type="file" accept=".json" hidden></div>
</aside>
<main class="viewer-panel">
  <div class="view-heading"><div><span class="eyebrow">SPATIAL VIEW / 01</span><h2>地表与钻孔 · 三维总览</h2></div><div class="view-presets"><button id="oblique" class="active" title="恢复全区斜视">全区</button><button id="top">俯视</button><button id="east">东侧</button><button id="north">南侧</button></div></div>
  <div id="viewport" aria-label="三维矿区视图"><div class="loading" id="loading"><div class="spinner"></div><h2>正在构建矿区视图</h2><p id="loading-status">读取全量观测数据…</p></div><div class="tooltip" id="tooltip" hidden></div></div>
  <div class="view-overlay"><span>正交投影</span><span>XYZ 等比例 · 单位 m</span><span id="terrain-note" hidden>地形：DEM / 60 m 显示网格</span></div>
  <div id="legend" class="legend"></div>
  <div class="orientation"><svg id="compass" viewBox="0 0 100 100" aria-label="空间方向"></svg><small>空间方向</small></div>
  <div class="view-footer"><span><i class="live-dot"></i><b id="visible-count">—</b> 个可见对象</span><span>拖动旋转 · 滚轮缩放 · 右键平移 · 点击查看</span></div>
</main>
<aside class="details-panel">
  <div class="detail-top"><span class="eyebrow">INSPECTOR</span><h2>对象信息</h2><button id="clear-selection" class="text-button small">清除</button></div>
  <div id="details"><div class="empty-state"><div class="crosshair">⌖</div><h3>探索一个样本</h3><p>悬停查看摘要，点击点或线段<br>查看位置、含量与原始记录。</p></div></div>
  <div class="reference-card"><span class="eyebrow">SPATIAL REFERENCE</span><h3>项目局部坐标</h3><dl><dt>投影假设</dt><dd>高斯–克吕格 / 93°E</dd><dt>DEM 配准</dt><dd>暂按 CGCS2000</dd><dt>原始大地基准</dt><dd class="amber">尚未确认</dd></dl><p>保留原始高程。DEM 补值为估算；原始高程与 EGM2008 的基准差异尚未确认。</p><button id="method-link" class="text-button">查看比对与处理依据 →</button></div>
</aside>
</div>
<footer class="statusbar"><span id="dataset-status">加载中</span><span id="performance">本地处理 · 原始文件保持不变</span></footer>
<div id="toast" role="status" hidden></div>
<div id="export-result" hidden><a id="export-link">下载文件</a><button id="preview-export" hidden>查看图片</button><button id="dismiss-export" aria-label="关闭导出提示">✕</button></div>
<dialog id="image-dialog"><div class="dialog-header"><h2>导出图片预览</h2><button id="close-image" aria-label="关闭图片">✕</button></div><img id="export-image" alt="加玛矿区导出的论文图片"></dialog>
<dialog id="quality-dialog"><div class="dialog-header"><div><span class="eyebrow">DATA & METHODOLOGY</span><h2>数据质量与空间依据</h2></div><button id="close-dialog" aria-label="关闭">✕</button></div><div id="quality-content"></div></dialog>`;

let data:Dataset,manifest:Manifest,scene:GeoScene,state:State={...defaults},selected:Ref|null=null;
let toastTimer:ReturnType<typeof setTimeout>;
function toast(message:string){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
let lastExportURL:string|null=null;
function download(blob:Blob,name:string){
  if(lastExportURL)URL.revokeObjectURL(lastExportURL);
  lastExportURL=URL.createObjectURL(blob);const a=$<HTMLAnchorElement>('export-link');a.href=lastExportURL;a.download=name;a.textContent=`↓ ${name}`;
  $('export-result').hidden=false;$('preview-export').hidden=blob.type!=='image/png';
  if(blob.type==='image/png'){
    const reader=new FileReader();reader.onload=()=>$<HTMLImageElement>('export-image').src=String(reader.result);reader.readAsDataURL(blob);
  }
  a.click();
}
function sync(){
  for(const [key,value] of Object.entries(state)){
    const input=$(key) as HTMLInputElement|HTMLSelectElement|null;
    if(input){if(typeof value==='boolean')(input as HTMLInputElement).checked=value;else input.value=String(value);}
  }
  $('linear').classList.toggle('active',state.scale==='linear');$('log').classList.toggle('active',state.scale==='log');
  $('point-size-label').textContent=`${state.pointSize} px`;$('line-width-label').textContent=`${state.lineWidth} px`;
  $('chem-controls').hidden=$('concentration-filter').hidden=state.element==='type';
  const chemical=manifest.chemistry.find(c=>c.id===state.element);
  $('domain-unit').textContent=$('filter-unit').textContent=chemical?.unit??'';
  $('terrain-note').hidden=!state.terrain;
}
function apply(next:State){
  try{state=validateState(next,manifest,data);sync();scene.update(state);if(selected&&!scene.selected)selected=null;showDetails(selected);updateLegend();$('visible-count').textContent=count(scene.refs.length);updatePerformance();}
  catch(error){toast((error as Error).message);sync();}
}
function updatePerformance(){ $('performance').textContent=`着色更新 ${scene.colorMs.toFixed(0)} ms · 最近渲染 ${scene.frameMs.toFixed(1)} ms · 拾取 ${scene.pickMs.toFixed(1)} ms`; }
function updateLegend(){
  const c=manifest.chemistry.find(c=>c.id===state.element);
  if(!c){$('legend').innerHTML=`<span class="eyebrow">DATA TYPE</span><div class="legend-row"><i class="dot teal"></i>地表采样点 <b>${count(scene.counts.surface)}</b></div><div class="legend-row"><i class="line copper"></i>钻孔分析区间 <b>${count(scene.counts.drill)}</b></div><div class="legend-note">孔口 ${count(scene.counts.collar)} · 实测与估算高程见详情</div>`;return;}
  const d=domain(state,c);$('legend').innerHTML=`<span class="eyebrow">CONCENTRATION / ${state.scale==='log'?'LOG₁₀':'LINEAR'}</span><h3>${escape(c.id)} <small>${escape(c.unit)}</small></h3><div class="colorbar"></div><div class="legend-range"><span>${fmt(d[0],5)}</span><span>${fmt(d[1],5)}</span></div><div class="legend-note">缺失 ${count(scene.counts.missing)} <i style="background:${COLORS.missing}" class="swatch"></i>　非正值 ${count(scene.counts.nonpositive)} <i style="background:${COLORS.nonpositive}" class="swatch"></i><br>色域外 ${count(scene.counts.outside)} · 端点颜色表示<br>孔口保持类型色，不代表元素含量</div>`;
}
function showDetails(ref:Ref|null){
  if(!ref){$('details').innerHTML='<div class="empty-state"><div class="crosshair">⌖</div><h3>探索一个样本</h3><p>悬停查看摘要，点击点或线段<br>查看位置、含量与原始记录。</p></div></div>';return;}
  const row=data[ref.kind].rows[ref.index],xyz=position(data,ref),chem=manifest.chemistry.find(c=>c.id===state.element);
  const source=ref.kind==='surface'?data.surface.geometry[ref.index][3]:'original';
  const identifier=ref.kind==='drill'?row[4]:row[0];
  const flags=data[ref.kind].flags[ref.index];
  $('details').innerHTML=`<div class="selected-summary"><span class="selected-kind">${kindName[ref.kind]}</span><h3>${escape(identifier)}</h3>${ref.kind==='drill'?`<p>${escape(row[0])} · ${fmt(row[1])}–${fmt(row[2])} m</p>`:''}<button id="focus-object" class="focus-button">⌖ 定位此对象</button></div>
  <div class="detail-section"><h4>空间位置 <span>m</span></h4><dl class="coords"><dt>East</dt><dd>${fmt(xyz[0],3)}</dd><dt>North</dt><dd>${fmt(xyz[1],3)}</dd><dt>${ref.kind==='drill'?'区间中点 H':'Height'}</dt><dd>${fmt(xyz[2],3)}</dd></dl><p class="source-tag ${source==='dem'?'estimated':''}">${source==='dem'?'DEM 估算高程 / EGM2008':'原始高程 / 基准未确认'}</p>${ref.kind==='surface'?`<p class="hint">原始 H：${fmt(row[53],4)}</p>`:''}</div>
  ${chem?`<div class="detail-section"><h4>当前元素 · ${escape(chem.id)}</h4><div class="assay-value">${fmt(valueOf(data,ref,chem),5)} <small>${escape(chem.unit)}</small></div></div>`:''}
  <div class="detail-section"><h4>质量记录</h4>${flags.length?flags.map(f=>`<p class="flag">${escape(qualityNames[f]??f)}</p>`).join(''):'<p class="hint">未触发已实施的记录级检查。</p>'}</div>
  <details class="raw-record" open><summary>原始字段</summary><dl>${data[ref.kind].headers.map((h,i)=>`<dt>${escape(h)}</dt><dd>${escape(fmt(row[i],6))}</dd>`).join('')}</dl></details>
  <div class="provenance"><b>${ref.kind}:${ref.index+2}</b><p>${escape(manifest.sources[ref.kind==='surface'?0:1].file)}</p><p>${ref.kind==='surface'?'data':ref.kind==='drill'?'分析数据':'空间位置'} · 第 ${ref.index+2} 行</p></div>`;
  $('focus-object').onclick=()=>scene.focus(ref);
}
function compass(){
  const colors=['#a16b39','#227e79','#6c7899'];
  $('compass').innerHTML=scene.directionVectors().map(({label,v},i)=>`<line x1="50" y1="52" x2="${50+v.x*30}" y2="${52-v.y*30}" stroke="${colors[i]}" stroke-width="2"/><text x="${50+v.x*40}" y="${56-v.y*40}" fill="${colors[i]}" text-anchor="middle" font-size="12">${label}</text>`).join('')+'<circle cx="50" cy="52" r="3" fill="#809087"/>';
}
async function quality(){
  const dialog=$<HTMLDialogElement>('quality-dialog');dialog.showModal();
  $('quality-content').innerHTML='<p>读取质量记录…</p>';
  try{
    const response=await fetch(`${import.meta.env.BASE_URL}dataset/quality.json`);if(!response.ok)throw Error('质量报告读取失败');
    const q=await response.json();
    $('quality-content').innerHTML=`<div class="method-notice">原始大地基准尚未确定。CGCS2000 是 DEM 配准的工作假设；地表和孔口均保留有效原始高程，不实施整体高程平移。</div>
    <div class="quality-stats"><div><b>${count(manifest.counts.originalHeight)}</b><span>地表原始高程</span></div><div><b>${count(manifest.counts.demHeight)}</b><span>DEM 估算高程</span></div><div><b>${count(manifest.counts.gaps)}</b><span>保留分析间隙</span></div><div><b>${count(manifest.counts.unlocated)}</b><span>未定位地表点</span></div></div>
    <h3>坐标与几何处理</h3><p>地表主表直接使用 East/North；Sheet3 的 X 减去 16,000,000 仅用于核对。钻孔 EAST 减去 31,000,000。用户确认全部为垂直孔，区间端点采用 H − FROM 和 H − TO；INT 不参与定位。</p><p>原始 H 在 3,500–6,500 m 之外列为待核查值。当前 10 条异常 H 与 7,048 条空值由 DEM 估算；该阈值是本项目筛查规则。辅助表 1,963 个样本不重复导入。</p>
    <h3>DEM 候选配准比对</h3><p>残差 = 原始高程 − DEM；单位 m。转换库对中国基准到 WGS84 使用近似转换，不能据此确定原始坐标系。西安 1980 与 CGCS2000 的微小残差差异不构成识别依据。</p>
    <table><thead><tr><th>候选 / EPSG</th><th>数据</th><th>N</th><th>中位差</th><th>MAE</th><th>RMSE</th></tr></thead><tbody>${manifest.comparisons.map(r=>`<tr><td>${({4540:'CGCS2000',2376:'西安 1980',2428:'北京 1954',32646:'UTM 46N'} as Record<number,string>)[r.epsg]} / ${r.epsg}</td><td>${r.group==='surface'?'地表':'孔口'}</td><td>${r.n}</td><td>${fmt(r.median)}</td><td>${fmt(r.mae)}</td><td>${fmt(r.rmse)}</td></tr>`).join('')}</tbody></table>
    <p>孔口残差较大，可能涉及开采地形变化、测量年代、坐标与高程基准差异；这些原因尚未验证。Copernicus 是地表模型，不能视为矿区实测精细地形。</p>
    <h3>质量记录</h3><table><thead><tr><th>类型</th><th>数量</th></tr></thead><tbody>${Object.entries(manifest.counts.issues).map(([k,v])=>`<tr><td>${escape(qualityNames[k]??k)}</td><td>${v}</td></tr>`).join('')}</tbody></table>
    <details><summary>展开全部 ${q.issues.length} 条记录</summary><table><thead><tr><th>对象 / 行</th><th>问题</th><th>处理信息</th></tr></thead><tbody>${q.issues.map((r:{id:string;row:number;kind:string;detail:string})=>`<tr><td>${escape(r.id)} / ${r.row}</td><td>${escape(qualityNames[r.kind]??r.kind)}</td><td>${escape(r.detail)}</td></tr>`).join('')}</tbody></table></details>
    <h3>DEM 来源与复现</h3><p>Copernicus GLO-30 Public / N29 E091；1 arc second（约 30 m），EGM2008。补值采用原始像元的双线性插值；显示网格为 60 m。镜像未声明发行版本，以文件校验值和 ETag 标识实际使用的数据。</p><p><a href="https://doi.org/10.5270/ESA-c5d3d65" target="_blank" rel="noreferrer">官方数据 DOI ↗</a> · <a href="${escape(manifest.dem.url)}" target="_blank" rel="noreferrer">原始 DEM 瓦片 ↗</a></p><p class="hash">SHA256 ${escape(manifest.dem.sha256)}</p><p class="hint">${escape(manifest.dem.license)}</p><p>数据版本 ${manifest.version} · 生成于 ${escape(manifest.generatedAt)}</p><button id="download-quality">下载完整质量记录 JSON</button>`;
    $('download-quality').onclick=()=>download(new Blob([JSON.stringify(q,null,2)],{type:'application/json'}),'jiama-quality.json');
  }catch(e){$('quality-content').textContent=(e as Error).message;}
}
function exportPNG(){
  toast('正在生成 3840 像素论文视图…');
  requestAnimationFrame(()=>{
    try{
      const image=scene.screenshot(3840),canvas=document.createElement('canvas');canvas.width=3840;canvas.height=image.height+240;
      const ctx=canvas.getContext('2d')!;ctx.fillStyle='#eef1ed';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
      ctx.fillStyle='#f8f9f6';ctx.fillRect(0,0,3840,125);ctx.fillRect(0,image.height,3840,240);
      ctx.fillStyle='#203d39';ctx.font='bold 43px Microsoft YaHei';ctx.fillText('加玛矿区 · 地表采样与垂直钻孔',65,72);
      ctx.font='24px Microsoft YaHei';ctx.fillStyle='#566a65';ctx.fillText(`局部 E / N / H (m) · 正交投影 · XYZ 等比例 · ${count(scene.refs.length)} 个可见对象`,65,110);
      const chem=manifest.chemistry.find(c=>c.id===state.element);const x=2780,y=image.height-200;
      ctx.fillStyle='rgba(248,249,246,.95)';ctx.fillRect(x-30,y-55,1040,225);ctx.fillStyle='#203d39';ctx.font='28px Microsoft YaHei';
      if(chem){
        const d=domain(state,chem);ctx.fillText(`${chem.id} (${chem.unit}) · ${state.scale==='log'?'log10':'线性'}`,x,y);
        const grad=ctx.createLinearGradient(x,0,x+930,0);ramp.forEach((c,i)=>grad.addColorStop(i/(ramp.length-1),c));ctx.fillStyle=grad;ctx.fillRect(x,y+25,930,26);
        ctx.fillStyle='#203d39';ctx.font='24px Microsoft YaHei';ctx.fillText(fmt(d[0],5),x,y+85);ctx.textAlign='right';ctx.fillText(fmt(d[1],5),x+930,y+85);ctx.textAlign='left';
        ctx.fillStyle=COLORS.missing;ctx.fillRect(x,y+111,18,18);ctx.fillStyle='#203d39';ctx.fillText(`缺失 ${scene.counts.missing}`,x+28,y+128);ctx.fillStyle=COLORS.nonpositive;ctx.fillRect(x+255,y+111,18,18);ctx.fillStyle='#203d39';ctx.fillText(`非正值 ${scene.counts.nonpositive} · 色域外 ${scene.counts.outside}`,x+283,y+128);
      }else{ctx.fillStyle=COLORS.surface;ctx.fillRect(x,y-20,24,24);ctx.fillStyle='#203d39';ctx.fillText(`地表点 ${count(scene.counts.surface)}`,x+40,y);ctx.fillStyle=COLORS.drill;ctx.fillRect(x,y+36,60,6);ctx.fillStyle='#203d39';ctx.fillText(`钻孔区间 ${count(scene.counts.drill)} · 孔口 ${count(scene.counts.collar)}`,x+80,y+50);}
      for(const {label,v} of scene.directionVectors()){ctx.strokeStyle='#58736d';ctx.beginPath();ctx.moveTo(145,200);ctx.lineTo(145+v.x*65,200-v.y*65);ctx.stroke();ctx.fillStyle='#203d39';ctx.font='25px Segoe UI';ctx.fillText(label,138+v.x*85,208-v.y*85);}
      ctx.font='25px Microsoft YaHei';ctx.fillStyle='#485c56';
      ctx.fillText('坐标：局部坐标；DEM 暂按 CGCS2000 / 93°E 配准，原始大地基准尚未确定。',65,image.height+50);
      ctx.fillText('高程：保留有效原值；缺失 / 异常地表 H 采用 Copernicus GLO-30（EGM2008）估算，原始高程基准差异未确认。',65,image.height+95);
      ctx.fillText(`数据版本 ${manifest.version} · ${new Date().toISOString()} · 地表类型 ${state.sampleType} · 钻孔 ${state.hole} · 高程 ${state.elevation} · 含量 ${state.filterMin||'不限'}–${state.filterMax||'不限'}`,65,image.height+140);
      ctx.font='20px Segoe UI';ctx.fillText(`DEM: doi:10.5270/ESA-c5d3d65 | ${manifest.dem.license}`,65,image.height+190);
      canvas.toBlob(blob=>{if(blob){download(blob,`jiama-${state.element}-${Date.now()}.png`);toast(`已导出 ${canvas.width} × ${canvas.height} PNG；建议同时保存视图配置。`);}else toast('图片生成失败');},'image/png');
    }catch(e){toast(`导出失败：${(e as Error).message}`);}
  });
}
function bind(){
  $('dismiss-export').onclick=()=>$('export-result').hidden=true;
  $('preview-export').onclick=()=>$<HTMLDialogElement>('image-dialog').showModal();
  $('close-image').onclick=()=>$<HTMLDialogElement>('image-dialog').close();
  for(const key of Object.keys(defaults) as (keyof State)[]){
    const input=$(key) as HTMLInputElement|HTMLSelectElement|null;if(!input)continue;
    input.addEventListener('change',()=>{
      const value=typeof defaults[key]==='boolean'?(input as HTMLInputElement).checked:typeof defaults[key]==='number'?Number(input.value):input.value;
      const next={...state,[key]:value};if(key==='element'){next.domainMin=next.domainMax=next.filterMin=next.filterMax='';next.scale='linear';}apply(next);
    });
  }
  $('linear').onclick=()=>apply({...state,scale:'linear',domainMin:'',domainMax:''});$('log').onclick=()=>apply({...state,scale:'log',domainMin:'',domainMax:''});
  $('reset-color').onclick=()=>apply({...state,element:'type',scale:'linear',domainMin:'',domainMax:'',filterMin:'',filterMax:''});
  $('reset-filter').onclick=()=>apply({...state,sampleType:'all',hole:'all',elevation:'all',filterMin:'',filterMax:''});
  for(const mode of ['oblique','top','east','north'] as const)$(mode).onclick=()=>{scene.reset(mode);document.querySelectorAll('.view-presets button').forEach(el=>el.classList.toggle('active',el.id===mode));};
  $('clear-selection').onclick=()=>{selected=null;scene.select(null);showDetails(null);};
  $('quality-button').onclick=$('method-link').onclick=quality;$('close-dialog').onclick=()=>$<HTMLDialogElement>('quality-dialog').close();
  $('export-png').onclick=exportPNG;
  $('export-csv').onclick=()=>{toast('正在导出当前可见对象…');setTimeout(()=>{download(new Blob([makeCSV(data,scene.refs,manifest)],{type:'text/csv;charset=utf-8'}),'jiama-filtered-observations.csv');toast(`已导出 ${count(scene.refs.length)} 个对象，包含原值和统一单位含量。`);},30);};
  $('save-view').onclick=()=>download(new Blob([JSON.stringify({schemaVersion:1,datasetVersion:manifest.version,controls:state,camera:scene.view(),selected},null,2)],{type:'application/json'}),'jiama-view.json');
  $('load-view').onclick=()=>$<HTMLInputElement>('view-file').click();
  $('view-file').onchange=async()=>{
    const input=$<HTMLInputElement>('view-file');const file=input.files?.[0];if(!file)return;
    try{
      if(file.size>1024*1024)throw Error('配置文件过大');const config=JSON.parse(await file.text());
      if(config.schemaVersion!==1)throw Error('不支持的配置版本');
      if(config.datasetVersion!==manifest.version)throw Error('数据版本不一致，未恢复配置；请使用当前数据版本保存的配置。');
      const next=validateState(config.controls,manifest,data);
      // Validate camera by restoring before changing controls; restore() validates before mutation.
      scene.restore(config.camera);apply(next);selected=null;
      const ref=config.selected as Ref|null;
      if(ref && ['surface','drill','collar'].includes(ref.kind) && Number.isInteger(ref.index) && ref.index>=0 && ref.index<data[ref.kind].rows.length && scene.refs.some(r=>r.kind===ref.kind&&r.index===ref.index)){selected=ref;}
      scene.select(selected);showDetails(selected);toast('已恢复相机、图层、筛选和颜色映射。');
    }catch(e){toast(`配置未恢复：${(e as Error).message}`);}finally{input.value='';}
  };
  scene.onPick=(ref,click,x,y)=>{
    if(click){selected=ref;scene.select(ref);showDetails(ref);$('tooltip').hidden=true;return;}
    const tip=$('tooltip');tip.hidden=!ref;if(ref){const row=data[ref.kind].rows[ref.index],chem=manifest.chemistry.find(c=>c.id===state.element);tip.innerHTML=`<b>${escape(ref.kind==='drill'?row[4]:row[0])}</b><span>${kindName[ref.kind]}${ref.kind==='drill'?` · ${fmt(row[1])}–${fmt(row[2])} m`:''}</span>${chem?`<span>${escape(chem.id)} ${fmt(valueOf(data,ref,chem),5)} ${escape(chem.unit)}</span>`:''}`;tip.style.left=`${Math.max(8,Math.min(x+18,$('viewport').clientWidth-245))}px`;tip.style.top=`${Math.max(8,Math.min(y+18,$('viewport').clientHeight-95))}px`;}
  };
  scene.onFrame=()=>{compass();updatePerformance();
    if(import.meta.env.DEV){$('viewport').dataset.probes=JSON.stringify({surface:scene.projected({kind:'surface',index:0}),drill:scene.projected({kind:'drill',index:0}),collar:scene.projected({kind:'collar',index:0})});}
  };
}
async function start(){
  const began=performance.now();
  try{
    const base=`${import.meta.env.BASE_URL}dataset/`;
    const [mr,dr]=await Promise.all([fetch(base+'manifest.json'),fetch(base+'observations.json.gz')]);
    if(!mr.ok||!dr.ok)throw Error('数据包缺失。请运行 prepare.ps1 生成数据。');
    manifest=await mr.json();if(manifest.schemaVersion!==1)throw Error('不支持的数据版本');
    const bytes=await dr.arrayBuffer();
    // Static servers may send .gz raw or transparently decompress it.
    const signature=new Uint8Array(bytes,0,2);const raw=signature[0]===31&&signature[1]===139;
    const stream=new Blob([bytes]).stream();data=await new Response(raw?stream.pipeThrough(new DecompressionStream('gzip')):stream).json();
    $('loading-status').textContent='创建批量点和钻孔线段…';await new Promise(resolve=>setTimeout(resolve,30));
    scene=new GeoScene($('viewport'),data,manifest);
    $('surface-total').textContent=count(manifest.counts.surface);$('drill-total').textContent=count(manifest.counts.intervals);$('collar-total').textContent=count(manifest.counts.collars);
    const common=manifest.chemistry.filter(c=>c.columns.surface&&c.columns.drill),other=manifest.chemistry.filter(c=>!(c.columns.surface&&c.columns.drill));
    $<HTMLSelectElement>('element').innerHTML='<option value="type">数据类型 · 默认</option>'+[ ['两类数据共有',common],['其他元素与氧化物',other] ].map(([label,list])=>`<optgroup label="${label}">${(list as Manifest['chemistry']).map(c=>`<option value="${escape(c.id)}">${escape(c.id)} · ${escape(c.unit)}</option>`).join('')}</optgroup>`).join('');
    $<HTMLSelectElement>('sampleType').innerHTML+=[...new Set(data.surface.rows.map(r=>r[3]))].sort().map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('');
    $<HTMLSelectElement>('hole').innerHTML+=data.collar.rows.map(r=>r[0]).sort().map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('');
    bind();apply(state);$('loading').remove();$('dataset-status').textContent=`JIAMA / ${manifest.version.slice(0,8)} · ${count(manifest.counts.surface)} 地表点 / ${count(manifest.counts.intervals)} 分析区间`;
    const loadMs=performance.now()-began;$('dataset-status').dataset.loadMs=loadMs.toFixed(1);
    // Read-only diagnostics for reproducible acceptance checks; no raw records exposed globally.
    Object.defineProperty(window,'geoDiagnostics',{value:{get stats(){return {loadMs,colorMs:scene.colorMs,pickMs:scene.pickMs,frameMs:scene.frameMs,visible:scene.counts,version:manifest.version,selected:scene.selected,camera:scene.view(),renderer:scene.renderer.info.render};},project:(ref:Ref)=>scene.projected(ref),pick:(x:number,y:number)=>scene.pick(x,y)}});
  }catch(e){$('loading').innerHTML=`<h2>视图未能加载</h2><p>${escape((e as Error).message)}</p><button onclick="location.reload()">重新加载</button>`;console.error(e);}
}
start();
