import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,csvCell,defaults,domain,makeCSV,position,validateState,valueOf,visible,type Dataset,type Manifest} from '../src/model.ts';

const data:Dataset=JSON.parse(gunzipSync(readFileSync('public/dataset/observations.json.gz')).toString());
const manifest:Manifest=JSON.parse(readFileSync('public/dataset/manifest.json','utf8'));
const cu=manifest.chemistry.find(c=>c.id==='Cu')!;
test('shared copper normalizes percent to ppm, retains source value',()=>{
  assert.equal(data.drill.rows[0][7],.017);
  assert.equal(valueOf(data,{kind:'drill',index:0},cu),170);
  assert.equal(valueOf(data,{kind:'surface',index:0},cu),22.82);
});
test('zero, missing and log nonpositive remain distinct',()=>{
  assert.equal(classify(0,defaults,[0,10]),0);
  assert.equal(classify(null,defaults,[0,10]),'missing');
  assert.equal(classify(0,{...defaults,scale:'log'},[1,10]),'nonpositive');
  assert.equal(classify(10,{...defaults,scale:'log'},[1,100]),.5);
  assert.equal(classify(1000,defaults,[0,10]),1);
});
test('filters do not change global color range',()=>{
  const state={...defaults,element:'Cu',filterMin:'1000'};
  assert.deepEqual(domain(state,cu),cu.range);
  assert.equal(visible(data,{kind:'surface',index:0},state,cu),false);
  assert.equal(visible(data,{kind:'collar',index:0},state,cu),true);
});
test('elevation filter finds exactly 7058 estimated points',()=>{
  const state={...defaults,elevation:'dem'};
  assert.equal(data.surface.rows.filter((_,index)=>visible(data,{kind:'surface',index},state)).length,7058);
  assert.equal(visible(data,{kind:'drill',index:0},state),false);
});
test('drill midpoint and traceable CSV retain both units',()=>{
  assert.equal(position(data,{kind:'drill',index:0})[2],4740.631-(101.42+103.08)/2);
  const csv=makeCSV(data,[{kind:'drill',index:0}],manifest);
  assert.ok(csv.includes('"drill:7:Cu %"'));
  assert.ok(csv.includes('"Cu [ppm]"'));
  assert.ok(csv.includes('"drill:2"'));
  assert.ok(csv.includes('"0.017"'));
  assert.ok(csv.includes('"170"'));
  assert.equal(csvCell('=1+1'),'"\'=1+1"');
});
test('invalid restored controls fail before applying',()=>{
  assert.throws(()=>validateState({...defaults,scale:'log',domainMin:'0',element:'Cu'},manifest,data));
  assert.throws(()=>validateState({...defaults,lineWidth:100},manifest,data));
  assert.throws(()=>validateState({...defaults,hole:'unknown'},manifest,data));
  assert.throws(()=>validateState({...defaults,filterMin:'5',filterMax:'2'},manifest,data));
  assert.deepEqual(validateState(defaults,manifest,data),defaults);
});
