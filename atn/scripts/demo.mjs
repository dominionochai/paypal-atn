#!/usr/bin/env node
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer as netServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MICRO = 1_000_000;
const CEILING = 50_000_000;
const PAYER = 'demo-payer';
const PAYEE = 'demo-payee';
const IDEMPOTENCY = 'atn-demo-settlement-2026-11-02';
const ESCROW_SKIP = 'escrow routes not present on this commit';
const ATN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = Buffer.from('ATN demo escrow artifact: simulated delivery evidence; no real payment or credentials.', 'utf8').toString('base64');
const names = ['Prepare temporary SQLite file and free port','Start server and wait for HTTP readiness','Create $50 channel',...['10','20','30','40','50'].map((x,i)=>`Accept voucher ${i+1}/5 ($${x}.000000 cumulative)`),'Reject over-ceiling voucher','Reject replayed nonce','Reject settlement with wrong authority (403)','Settle exact amount in SIMULATED mode','Replay settlement idempotently without a second charge','Create escrow','Inspect escrow with base64 artifact','Release escrow','Stop server and remove temporary SQLite files'];
const results = new Map(names.map(n=>[n,{status:'SKIP',detail:'not reached'}]));
const children=[];
let tempDir, dbPath, port, channelId, charged=0;
const ansi={PASS:'\u001b[32m',FAIL:'\u001b[31m',SKIP:'\u001b[33m',reset:'\u001b[0m'};
function usd(n){if(!Number.isFinite(Number(n)))return 'unavailable';let v=Math.trunc(Number(n)),s=v<0?'-':'';v=Math.abs(v);return `${s}$${Math.floor(v/MICRO)}.${String(v%MICRO).padStart(6,'0')}`;}
function mark(n,status,detail=''){results.set(n,{status,detail});console.log(`${ansi[status]}${status}${ansi.reset} ${n}${detail?` — ${detail}`:''}`);}
function skipRequest(n,reason){console.log(`\n[${n}]\nREQUEST: not sent (prerequisite unavailable)\nSTATUS: SKIP\nRESPONSE BODY: ${reason}`);mark(n,'SKIP',reason);}
async function http(label,method,pathname,{body,headers={}}={}){
  const url=`http://127.0.0.1:${port}${pathname}`;
  const requestHeaders={...headers}; if(body!==undefined)requestHeaders['content-type']='application/json';
  console.log(`\n[${label}]\nREQUEST: ${method} ${pathname} HTTP/1.1\nHost: 127.0.0.1:${port}`);
  for(const [k,v] of Object.entries(requestHeaders))console.log(`${k}: ${v}`);
  console.log(`REQUEST BODY: ${body===undefined?'<none>':JSON.stringify(body)}`);
  try{
    const response=await fetch(url,{method,headers:requestHeaders,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
    const text=await response.text();
    console.log(`STATUS: ${response.status} ${response.statusText}\nRESPONSE BODY: ${text||'<empty>'}`);
    let data=null;try{data=JSON.parse(text);}catch{}
    return {status:response.status,text,data};
  }catch(e){const message=e instanceof Error?e.message:String(e);console.log(`STATUS: NO_RESPONSE\nRESPONSE BODY: ${message}`);return {status:0,text:message,data:null};}
}
function canonicalize(p){
  const parts=[];
  const str=s=>{const b=Buffer.from(s,'utf8'),l=Buffer.alloc(4);l.writeUInt32BE(b.length,0);parts.push(l,b);};
  const i64=n=>{if(!Number.isSafeInteger(n))throw Error('non-integer value in voucher payload');const b=Buffer.alloc(8);b.writeBigInt64BE(BigInt(n),0);parts.push(b);};
  str(p.channelId);str(p.payeeAgentId);i64(p.cumulativeAmount);i64(p.nonce);i64(p.issuedAt);return Buffer.concat(parts);
}
function signed(payload,privateKey){return {payload,signature:sign(null,canonicalize(payload),privateKey).toString('base64')};}
async function freePort(){const s=netServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const p=s.address().port;await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));return p;}
function start(command,args,label,env){const c=spawn(command,args,{cwd:ATN_DIR,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});c.label=label;c.log='';c.on('error',e=>{c.spawnError=e;});for(const stream of [c.stdout,c.stderr])stream.on('data',b=>{c.log=(c.log+b.toString()).slice(-6000);});children.push(c);console.log(`Started ${label}: ${command} ${args.join(' ')}`);return c;}
async function waitReady(env){
  const deadline=Date.now()+30_000;let child=start('node',['--import','tsx','src/http/server.ts'],'node --import tsx',env);let fallback=false;
  while(Date.now()<deadline){
    if(child.spawnError||child.exitCode!==null||child.signalCode!==null){
      console.log(`${child.label} exited before readiness. Output tail:\n${child.log||child.spawnError?.message||'<none>'}`);
      if(!fallback){fallback=true;child=start('npx',['tsx','src/http/server.ts'],'npx tsx',env);}else break;
    }
    const r=await http('Server readiness probe','GET','/v1/channels/health');
    if(r.status!==0)return true;
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  console.error(`Server did not return HTTP within 30 seconds. Latest child output:\n${children.at(-1)?.log||'<none>'}`);return false;
}
function apiOk(r,status){return r.status===status;}
function asMicro(value){return Number.isSafeInteger(value)?value:NaN;}
async function run(){
  try{
    tempDir=await mkdtemp(path.join(os.tmpdir(),'atn-demo-'));dbPath=path.join(tempDir,'demo.sqlite');port=await freePort();
    mark(names[0],'PASS',`DB_PATH=${dbPath}; PORT=${port}`);
    const env={...process.env,PORT:String(port),DB_PATH:dbPath,SETTLEMENT_MODE:'SIMULATED',NODE_ENV:'test'};
    if(!await waitReady(env)){mark(names[1],'FAIL','HTTP readiness timed out');return;}
    mark(names[1],'PASS','server returned an HTTP response');
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    const publicPem=publicKey.export({type:'spki',format:'pem'}).toString();
    const created=await http(names[2],'POST','/v1/channels',{body:{payerAgentId:PAYER,payeeAgentId:PAYEE,payerPublicKey:publicPem,ceiling:CEILING,ttlSeconds:1800}});
    channelId=created.data?.channelId;
    if(apiOk(created,201)&&typeof channelId==='string'&&channelId.length){mark(names[2],'PASS',`channelId=${channelId}; ceiling=${CEILING}`);}else mark(names[2],'FAIL',`expected HTTP 201 and channelId; received HTTP ${created.status}`);
    const cumulative=[10_000_000,20_000_000,30_000_000,40_000_000,50_000_000];let firstVoucher;
    if(channelId){
      for(let i=0;i<cumulative.length;i++){
        const n=names[3+i],payload={channelId,payeeAgentId:PAYEE,cumulativeAmount:cumulative[i],nonce:i+1,issuedAt:Date.now()};
        const voucher=signed(payload,privateKey);if(i===0)firstVoucher=voucher;
        const r=await http(n,'POST',`/v1/channels/${encodeURIComponent(channelId)}/vouchers`,{body:voucher});
        const spent=asMicro(r.data?.spent);if(r.status===200&&spent===cumulative[i]){mark(n,'PASS',`running spend: ${usd(spent)} (${spent} micro-dollars)`);}else mark(n,'FAIL',`expected HTTP 200 and spent=${cumulative[i]}; received HTTP ${r.status}, spent=${r.data?.spent}`);
      }
      const over=signed({channelId,payeeAgentId:PAYEE,cumulativeAmount:CEILING+1,nonce:6,issuedAt:Date.now()},privateKey);
      const overR=await http(names[8],'POST',`/v1/channels/${encodeURIComponent(channelId)}/vouchers`,{body:over});
      if(overR.status===422&&overR.data?.error==='OVER_BUDGET')mark(names[8],'PASS','HTTP 422 OVER_BUDGET');else mark(names[8],'FAIL',`expected HTTP 422 OVER_BUDGET; received HTTP ${overR.status}`);
      const replay=await http(names[9],'POST',`/v1/channels/${encodeURIComponent(channelId)}/vouchers`,{body:firstVoucher});
      if(replay.status===409&&replay.data?.error==='REPLAYED')mark(names[9],'PASS','HTTP 409 REPLAYED');else mark(names[9],'FAIL',`expected HTTP 409 REPLAYED; received HTTP ${replay.status}`);
      const settlementBody={idempotencyKey:IDEMPOTENCY};
      const badAuth=await http(names[10],'POST',`/v1/channels/${encodeURIComponent(channelId)}/settle`,{body:settlementBody,headers:{'x-atn-authority':'wrong-authority'}});
      if(badAuth.status===403)mark(names[10],'PASS','HTTP 403');else mark(names[10],'FAIL',`expected HTTP 403; received HTTP ${badAuth.status}`);
      const goodHeaders={'x-atn-authority':PAYEE};
      const settled=await http(names[11],'POST',`/v1/channels/${encodeURIComponent(channelId)}/settle`,{body:settlementBody,headers:goodHeaders});
      if(settled.status===200&&settled.data?.mode==='SIMULATED'&&settled.data?.amount===CEILING){charged=asMicro(settled.data.amount);mark(names[11],'PASS',`mode=SIMULATED; exact amount ${usd(settled.data.amount)} (${settled.data.amount} micro-dollars)`);}else mark(names[11],'FAIL',`expected HTTP 200, SIMULATED, amount=${CEILING}; received HTTP ${settled.status}, body=${settled.text}`);
      const repeated=await http(names[12],'POST',`/v1/channels/${encodeURIComponent(channelId)}/settle`,{body:settlementBody,headers:goodHeaders});
      const keys=['channelId','amount','mode','adapterRef','idempotencyKey'];
      const same=settled.status===200&&repeated.status===200&&keys.every(k=>settled.data?.[k]===repeated.data?.[k]);
      if(same)mark(names[12],'PASS','same settlement identity and amount returned; SIMULATED repeat did not charge twice');else mark(names[12],'FAIL',`idempotent replay response differed or failed; repeat HTTP ${repeated.status}`);
    }else{
      for(let i=3;i<=12;i++)mark(names[i],'SKIP','channel creation did not return a channelId');
    }
    const escrow=await http(names[13],'POST','/v1/escrows',{body:{payerAgentId:PAYER,payeeAgentId:PAYEE,amountMicroDollars:1_000_000}});
    let escrowId;
    if(escrow.status===404){mark(names[13],'SKIP',ESCROW_SKIP);skipRequest(names[14],ESCROW_SKIP);skipRequest(names[15],ESCROW_SKIP);}
    else if(escrow.status===200||escrow.status===201){escrowId=escrow.data?.escrowId??escrow.data?.id;if(escrowId){mark(names[13],'PASS',`escrowId=${escrowId}`);const inspected=await http(names[14],'POST',`/v1/escrows/${encodeURIComponent(escrowId)}/inspect`,{body:{artifact}});if(inspected.status===404)mark(names[14],'SKIP',ESCROW_SKIP);else if(inspected.status>=200&&inspected.status<300)mark(names[14],'PASS','base64 artifact submitted');else mark(names[14],'FAIL',`HTTP ${inspected.status}`);const released=await http(names[15],'POST',`/v1/escrows/${encodeURIComponent(escrowId)}/release`,{body:{}});if(released.status===404)mark(names[15],'SKIP',ESCROW_SKIP);else if(released.status>=200&&released.status<300)mark(names[15],'PASS','release request accepted');else mark(names[15],'FAIL',`HTTP ${released.status}`);}else{mark(names[13],'FAIL',`expected escrowId/id in HTTP ${escrow.status} response`);skipRequest(names[14],'escrow creation did not return an id');skipRequest(names[15],'escrow creation did not return an id');}}
    else{mark(names[13],'FAIL',`expected HTTP 200/201 or route 404; received HTTP ${escrow.status}`);skipRequest(names[14],'escrow creation failed or returned no id');skipRequest(names[15],'escrow creation failed or returned no id');}
  }catch(e){const message=e instanceof Error?e.stack||e.message:String(e);console.error(`Demo error: ${message}`);for(const n of names){if(results.get(n).status==='SKIP'&&results.get(n).detail==='not reached')mark(n,'SKIP','not run after demo error');}}
}
async function stopChildren(){
  for(const c of [...children].reverse()){
    if(c.exitCode!==null||c.signalCode!==null)continue;
    try{if(process.platform==='win32')c.kill('SIGTERM');else process.kill(-c.pid,'SIGTERM');}catch{}
    await new Promise(resolve=>{const timer=setTimeout(resolve,1500);c.once('exit',()=>{clearTimeout(timer);resolve();});});
    if(c.exitCode===null&&c.signalCode===null){try{if(process.platform==='win32')c.kill('SIGKILL');else process.kill(-c.pid,'SIGKILL');}catch{}}
  }
}
await run();
try{await stopChildren();if(tempDir)await rm(tempDir,{recursive:true,force:true});mark(names[16],'PASS','server stopped; temporary database, WAL/SHM files, and temp directory removed');}
catch(e){mark(names[16],'FAIL',e instanceof Error?e.message:String(e));}
console.log('\nSummary');console.log('| Step | Result | Detail |');console.log('|---|---|---|');for(const [name,r] of results)console.log(`| ${name} | ${r.status} | ${r.detail.replaceAll('|','\\|')} |`);
console.log(`\nExact total charged (SIMULATED): ${usd(charged)} (${charged} micro-dollars)`);
if([...results.values()].some(r=>r.status==='FAIL'))process.exitCode=1;
