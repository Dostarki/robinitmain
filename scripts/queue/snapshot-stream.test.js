const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {DurableRuntime} = require('./durable-runtime');
function response() { const r=new EventEmitter();r.chunks=[];r.writeHead=s=>{r.status=s;};r.write=t=>r.chunks.push(t);r.end=()=>{r.ended=true;r.emit('close');};return r; }
test('durable SSE reconnect sends saved terminal snapshot then closes without recursion',async()=>{
  const runtime={streams:new Set(),getJobStatus:async()=>({status:200,body:{status:'completed',report:{score:75}}})};
  for(let i=0;i<2;i++) {
    const r=response();
    assert.equal(await DurableRuntime.prototype.stream.call(runtime,r,'id','owner',()=>true),true);
    assert.match(r.chunks.join(''),/"score":75/);assert.equal(r.ended,true);
  }
  assert.equal(runtime.streams.size,0);
});
test('durable SSE denies other wallets and closes expired sessions without disclosing report',async()=>{
  const runtime={streams:new Set(),getJobStatus:async()=>({status:404,body:{}})};
  const denied=response();assert.equal(await DurableRuntime.prototype.stream.call(runtime,denied,'id','other',()=>true),false);
  assert.equal(denied.chunks.length,0);
  runtime.getJobStatus=async()=>({status:200,body:{status:'running',report:{score:75}}});
  const expired=response();await DurableRuntime.prototype.stream.call(runtime,expired,'id','owner',()=>false);
  assert.equal(expired.ended,true);assert.equal(expired.chunks.length,0);
});
