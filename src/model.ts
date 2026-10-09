export type Cell = string | number | null;
export type Kind = 'surface' | 'drill' | 'collar';
export interface Ref { kind: Kind; index: number }
export interface Table<G> { headers: string[]; rows: Cell[][]; geometry: G[]; flags: string[][] }
export interface Dataset {
  surface: Table<[number, number, number | null, string]>;
  collar: Table<[number, number, number]>;
  drill: Table<[number, number, number] | null>;
  terrain: { east: number[]; north: number[]; heights: (number | null)[]; spacing: number };
}
export interface Chemical {
  id: string; unit: string;
  columns: Partial<Record<'surface'|'drill', {index: number; unit: string; factor: number}>>;
  range: [number, number]; positiveRange: [number, number] | null;
}
export interface Comparison { epsg: number; group: string; n: number; median: number; mae: number; rmse: number; p90: number; operation: string }
export interface Manifest {
  schemaVersion: number; version: string; generatedAt: string;
  counts: {surface: number; collars: number; intervals: number; originalHeight: number; demHeight: number; unlocated: number; gaps: number; issues: Record<string, number>};
  sources: {file: string; sha256: string}[];
  origin: [number, number, number]; bounds: [number,number,number,number,number,number];
  chemistry: Chemical[]; comparisons: Comparison[];
  dem: {url: string; sha256: string; license: string; resolution: string; verticalCRS: string};
}
export interface State {
  surface: boolean; drill: boolean; collar: boolean; terrain: boolean;
  sampleType: string; hole: string; elevation: string; element: string;
  scale: 'linear'|'log'; domainMin: string; domainMax: string;
  filterMin: string; filterMax: string; pointSize: number; lineWidth: number;
}
export const defaults: State = {surface: true, drill: true, collar: true, terrain: false,
  sampleType:'all',hole:'all',elevation:'all',element:'type',scale:'linear',domainMin:'',domainMax:'',filterMin:'',filterMax:'',pointSize:4,lineWidth:2};
export const COLORS = {surface:'#147e83', drill:'#c17437', collar:'#c17437', missing:'#9da8b0', nonpositive:'#3b4659', selected:'#e74739'};
export const ramp = ['#440154','#3b528b','#21918c','#5ec962','#fde725'];
export const qualityNames: Record<string,string> = {missing_height:'原始高程缺失 · DEM 估算',suspect_height:'原始高程异常 · DEM 估算',interval_length_mismatch:'INT 与 FROM/TO 不一致',overlapping_interval:'分析区间重叠',beyond_total_depth:'超过终孔深度',invalid_interval_or_collar:'区间或孔口无效',no_assay:'无分析区间，仅孔口',duplicate_sample_id:'样本编号重复',aux_coordinate_conflict:'辅助表坐标冲突',unlocated:'无法定位'};
export function valueOf(data: Dataset, ref: Ref, chemical?: Chemical): number | null {
  if (!chemical || ref.kind === 'collar') return null;
  const spec=chemical.columns[ref.kind];
  if (!spec) return null;
  const v=data[ref.kind].rows[ref.index][spec.index];
  return typeof v==='number' && Number.isFinite(v) ? v*spec.factor : null;
}
export function domain(state: State, chemical?: Chemical): [number,number] {
  if (!chemical) return [0,1];
  const fallback=state.scale==='log' ? chemical.positiveRange ?? [1,10] : chemical.range;
  return [state.domainMin===''?fallback[0]:Number(state.domainMin), state.domainMax===''?fallback[1]:Number(state.domainMax)];
}
export function classify(v: number|null, state: State, range: [number,number]): 'missing'|'nonpositive'|number {
  if (v===null) return 'missing';
  if (state.scale==='log' && v<=0) return 'nonpositive';
  const [lo,hi]=range;
  if (lo===hi) return .5;
  return Math.max(0,Math.min(1,state.scale==='log'?(Math.log10(v)-Math.log10(lo))/(Math.log10(hi)-Math.log10(lo)):(v-lo)/(hi-lo)));
}
export function visible(data: Dataset, ref: Ref, state: State, chemical?: Chemical): boolean {
  if (!state[ref.kind]) return false;
  const row=data[ref.kind].rows[ref.index];
  if (ref.kind==='surface') {
    const g=data.surface.geometry[ref.index];
    if (g[2]===null) return false;
    if (state.sampleType!=='all' && row[3]!==state.sampleType) return false;
    if (state.elevation!=='all' && g[3]!==state.elevation) return false;
  } else {
    if (state.hole!=='all' && row[0]!==state.hole) return false;
    if (state.elevation==='dem') return false;
    if (ref.kind==='drill' && !data.drill.geometry[ref.index]) return false;
  }
  // Collars have no assay; range filters apply only to samples/intervals.
  if (chemical && ref.kind!=='collar' && (state.filterMin!=='' || state.filterMax!=='')) {
    const v=valueOf(data,ref,chemical);
    if (v===null || (state.filterMin!=='' && v<Number(state.filterMin)) || (state.filterMax!=='' && v>Number(state.filterMax))) return false;
  }
  return true;
}
export function position(data: Dataset, ref: Ref): [number,number,number] {
  if (ref.kind==='surface') {const p=data.surface.geometry[ref.index];return [p[0],p[1],p[2] ?? 0];}
  if (ref.kind==='collar') return data.collar.geometry[ref.index];
  const g=data.drill.geometry[ref.index]!;const c=data.collar.geometry[g[0]];
  return [c[0],c[1],(g[1]+g[2])/2];
}
export function validateState(input: unknown, manifest: Manifest, data: Dataset): State {
  if (!input || typeof input!=='object') throw Error('配置缺少 controls');
  const s={...defaults,...input} as State;
  for (const key of ['surface','drill','collar','terrain'] as const) if (typeof s[key]!=='boolean') throw Error('图层配置无效');
  if (!['linear','log'].includes(s.scale)) throw Error('颜色变换无效');
  const chem=manifest.chemistry.find(c=>c.id===s.element);
  if (s.element!=='type' && !chem) throw Error('元素字段不存在');
  for (const key of ['domainMin','domainMax','filterMin','filterMax'] as const) {
    if (typeof s[key]!=='string' || (s[key]!=='' && !Number.isFinite(Number(s[key])))) throw Error('数值范围无效');
  }
  const d=domain(s,chem);
  if (d[0]>d[1] || (s.scale==='log' && d[0]<=0)) throw Error('色域范围无效；对数色域必须为正数');
  if (s.filterMin!=='' && s.filterMax!=='' && Number(s.filterMin)>Number(s.filterMax)) throw Error('含量筛选下限大于上限');
  if (!Number.isFinite(s.pointSize) || s.pointSize<1 || s.pointSize>12 || !Number.isFinite(s.lineWidth) || s.lineWidth<1 || s.lineWidth>8) throw Error('点大小或线宽无效');
  if (!['all','original','dem'].includes(s.elevation)) throw Error('高程来源无效');
  if (s.hole!=='all' && !data.collar.rows.some(r=>r[0]===s.hole)) throw Error('钻孔不存在');
  if (s.sampleType!=='all' && !data.surface.rows.some(r=>r[3]===s.sampleType)) throw Error('样本类型不存在');
  return s;
}
export function csvCell(v: unknown): string {
  let s=v==null?'':String(v);
  if (typeof v==='string' && /^[=+\-@\t\r]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function makeCSV(data: Dataset, refs: Ref[], manifest: Manifest): string {
  const rawColumns=Array.from(new Set((['surface','drill','collar'] as const).flatMap(k=>data[k].headers.map((h,i)=>`${k}:${i}:${h}`))));
  const header=['object_id','kind','source_file','source_sheet','source_row','east_m','north_m','height_m','top_height_m','bottom_height_m','height_source','quality_flags',...rawColumns,...manifest.chemistry.map(c=>`${c.id} [${c.unit}]`)];
  const lines=[header.map(csvCell).join(',')];
  for(const ref of refs){
    const [e,n,h]=position(data,ref); const seg=ref.kind==='drill'?data.drill.geometry[ref.index]:null;
    const source=ref.kind==='surface'?data.surface.geometry[ref.index][3]:'original';
    const raw=new Map(data[ref.kind].headers.map((key,i)=>[`${ref.kind}:${i}:${key}`,data[ref.kind].rows[ref.index][i]]));
    const line=[`${ref.kind}:${ref.index+2}`,ref.kind,manifest.sources[ref.kind==='surface'?0:1].file,ref.kind==='surface'?'data':ref.kind==='drill'?'分析数据':'空间位置',ref.index+2,e,n,h,seg?.[1]??h,seg?.[2]??h,source,data[ref.kind].flags[ref.index].join(';'),...rawColumns.map(k=>raw.get(k)),...manifest.chemistry.map(c=>valueOf(data,ref,c))];
    lines.push(line.map(csvCell).join(','));
  }
  return '\ufeff'+lines.join('\r\n');
}
