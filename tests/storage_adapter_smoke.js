const fs=require('fs'),vm=require('vm');
function assert(v,m){if(!v)throw new Error(m)}
const data={},native={};
const sandbox={window:null,console,localStorage:{
  getItem:k=>Object.prototype.hasOwnProperty.call(data,k)?data[k]:null,
  setItem:(k,v)=>data[k]=String(v),removeItem:k=>delete data[k]
}};
sandbox.window=sandbox;
sandbox.FINPET_NATIVE_STORAGE={
  async get(k){return Object.prototype.hasOwnProperty.call(native,k)?native[k]:null},
  async set(k,v){native[k]=String(v)},async remove(k){delete native[k]}
};
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(__dirname+'/../storage.js','utf8'),sandbox);
(async()=>{
  const key='finpet_mvp_state_v1';
  data[key]=JSON.stringify({wallet:{balance:100},pet:{type:'cat'},version:6});
  let r=await sandbox.FINPET_STORAGE.ready(key);
  assert(r.source==='local-migrated','localStorage must migrate to native');
  assert(JSON.parse(native[key]).wallet.balance===100,'native migration failed');
  await sandbox.FINPET_STORAGE.saveState(key,{wallet:{balance:250},pet:{type:'cat'},version:6});
  await sandbox.FINPET_STORAGE.flush();
  assert(JSON.parse(native[key]).wallet.balance===250,'native save failed');
  assert(JSON.parse(native[key+'_backup']).wallet.balance===100,'backup was not preserved');
  native[key]='{broken'; data[key]='{broken';
  r=await sandbox.FINPET_STORAGE.ready(key);
  assert(r.source==='native-backup','broken current must restore backup');
  assert(JSON.parse(data[key]).wallet.balance===100,'backup restore failed');
  await sandbox.FINPET_STORAGE.remove(key); await sandbox.FINPET_STORAGE.flush();
  assert(native[key]==null&&native[key+'_backup']==null,'native reset failed');
  assert(data[key]==null&&data[key+'_backup']==null,'local reset failed');
  console.log('storage_adapter_smoke: OK');
})().catch(e=>{console.error(e);process.exit(1)});
