const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../serve-app'),'utf8');
const handler = source.slice(source.indexOf('async function api('),source.indexOf('\nhttp.createServer('));
function harness(user, sameOrigin=true) {
  let calls=0;
  const context=vm.createContext({
    sameOrigin:()=>sameOrigin, riskSession:()=>user,
    json:(_res,status,body)=>({status,body}), readBody:async()=>({chain:'ethereum',address:'address'}),
    privacyHash:address=>'hashed-'+address, clientIp:()=> 'ip',
    analysisOrchestrator:{
      submitAnalysis:async()=>{calls++;return {status:202,body:{jobId:'id'}};},
      getJobStatus:async(id,wallet)=>({status:wallet==='hashed-owner'?200:404,body:{}}),
      store:{history:async wallet=>wallet==='hashed-owner'?[{score:75}]:[]},
    },
  });
  vm.runInContext(handler,context);
  return {invoke:(method,path)=>context.api({method,headers:{},socket:{}},{},path), calls:()=>calls};
}
test('queue API rejects anonymous and cross-origin submission before enqueue',async()=>{
  const anonymous=harness(null), foreign=harness({address:'owner'},false);
  assert.equal((await anonymous.invoke('POST','/api/risk/analyses')).status,401);
  assert.equal((await foreign.invoke('POST','/api/risk/analyses')).status,403);
  assert.equal(anonymous.calls()+foreign.calls(),0);
});
test('queue API awaits authorization and history queries; legacy routes cannot bypass admission',async()=>{
  const owner=harness({address:'owner'}), outsider=harness({address:'other'});
  assert.equal((await owner.invoke('GET','/api/risk/analyses/job')).status,200);
  assert.equal((await outsider.invoke('GET','/api/risk/analyses/job')).status,404);
  assert.equal((await outsider.invoke('GET','/api/risk/history')).body.reports.length,0);
  for(const path of ['analyze','creator-analysis','token-icons']) assert.equal((await owner.invoke('POST','/api/risk/'+path)).status,410);
  assert.equal(owner.calls(),0);
});
