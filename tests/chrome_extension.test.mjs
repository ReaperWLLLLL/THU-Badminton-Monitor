import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {VENUES, DEFAULT_SETTINGS, validateSettings, queryDates, beijingDate, parseSlots, filterSlots, tokenValid, normalizeToken, officialSlotURL} from '../lib/core.mjs';
import {md5, signedParams} from '../lib/signature.mjs';
import {AvailabilityAPI, checkPayload, AuthError} from '../lib/api.mjs';
import {AutoLogin, totp, decodeBase32, safeTotpDelay, validateLoginConfig, loginSenderAllowed, IDENTITY_ORIGIN} from '../lib/auto-login.mjs';

test('MD5 matches independent crypto including multi-block UTF-8', () => {
  for (const input of ['', 'abc', '中文羽毛球', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(64), 'd'.repeat(150)]) {
    assert.equal(md5(input), createHash('md5').update(input).digest('hex'));
  }
  const p = signedParams(1700000000000, 'test-nonce');
  assert.equal(p.sign, createHash('md5').update(`appId=${p.appId}&nonce=test-nonce&timeStamp=1700000000000&key=57325972627c40bd8c77296d39293705`).digest('hex'));
});
test('Beijing dates work at midnight and across year boundary', () => {
  const now = new Date('2026-12-31T16:01:00Z');
  assert.equal(beijingDate(now), '2027-01-01');
  assert.deepEqual(queryDates(now), ['2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
});
test('available ranges, fallbacks, unavailable sessions and duplicates', () => {
  const payload = {data: [{siteName: '羽06', sessionVo: [
    {beginTime:'16:00',endTime:'18:00',reserveStatus:{reserveStatus:'Y',availableRange:[{startTime:'16:30',endTime:'17:30'}]}},
    {beginTime:'20:00',endTime:'22:00',reserveStatus:{reserveStatus:'Y'}},
    {beginTime:'20:00',endTime:'22:00',reserveStatus:{reserveStatus:'Y'}},
    {beginTime:'19:00',endTime:'20:00',reserveStatus:{reserveStatus:'N'}},
  ]}]};
  const slots = parseSlots(payload, VENUES[2], '2026-11-12');
  assert.equal(slots.length, 2); assert.equal(slots[0].startTime,'16:30');
  assert.equal(slots[1].endTime,'22:00');
  assert.throws(() => parseSlots({data:null}, VENUES[0], '2026-11-12'));
});
test('filters use reservation weekday, inclusive bounds and include formerly excluded courts', () => {
  const s = {...DEFAULT_SETTINGS, weekdayEnd:'22:00',weekendEnd:'22:00'};
  const rows = [];
  for (const date of ['2026-11-13','2026-11-14']) for (const siteName of ['羽06','羽07','羽13','羽14']) for (const startTime of ['09:59','10:00','15:59','16:00','22:00','22:01']) {
    rows.push({date,siteName,startTime,endTime:'23:00',venueId:VENUES[2].id});
  }
  const filtered = filterSlots(rows, s, new Date('2026-11-12T00:00:00Z'));
  assert.equal(filtered.filter(x => x.date === '2026-11-13').length, 8);
  assert.equal(filtered.filter(x => x.date === '2026-11-14').length, 16);
  assert.equal(filterSlots(rows, {...s,venues:[VENUES[0].id]}).length,0);
  assert.equal(filterSlots(rows,s,new Date('2026-11-15T00:00:00Z')).length,0);
});
test('reject invalid configuration without losing defaults', () => {
  for (const input of [{venues:[]},{venues:['oops']},{intervalMinutes:1},{intervalMinutes:5.5},{weekdayStart:'25:00'},{weekdayStart:'23:00',weekdayEnd:'16:00'}]) assert.throws(() => validateSettings(input));
  assert.equal(validateSettings({intervalMinutes:5}).weekendStart,'10:00');
});
test('quoted JWT parsing and expiry', () => {
  const token = `e30.${Buffer.from(JSON.stringify({exp:2000000000})).toString('base64url')}.sig`;
  assert.equal(normalizeToken(`"${token}"`),token);
  assert.ok(tokenValid(token,1900000000000));
  assert.equal(tokenValid(token,2000000000000),false);
  assert.equal(tokenValid('bad'),false);
});
test('official deep link carries exact date, venue, court and time safely', () => {
  const url = new URL(officialSlotURL({venueId:VENUES[2].id,date:'2026-11-14',siteName:'羽06 & 测试',startTime:'20:00',endTime:'22:00'}));
  assert.equal(url.origin,'https://www.sports.tsinghua.edu.cn');
  const p = new URLSearchParams(url.hash.split('?')[1]);
  assert.equal(p.get('ab_site'),'羽06 & 测试'); assert.equal(p.get('ab_date'),'2026-11-14');
});
test('HTTP 200 business errors never become empty availability', () => {
  assert.throws(() => checkPayload({success:false,code:500,message:'请求频繁，请稍后再试'}), /请求频繁/);
  assert.throws(() => checkPayload({success:false,code:401,message:'expired'}), AuthError);
  assert.throws(() => checkPayload({success:false,code:500,message:'登录已过期'}), AuthError);
});
test('API sends signed read-only requests and reuses venue metadata across dates', async () => {
  const calls=[];
  const fetcher=async (url, opts) => {
    const u=new URL(url); calls.push({path:u.pathname,opts});
    assert.ok(u.searchParams.get('sign')); assert.equal(opts.credentials,'include');
    assert.equal(opts.headers.token,'fake-token');
    let data=[];
    if (u.pathname.endsWith('chooseByType')) data=[{uuid:'room',classTypeUuid:'building',siteType:'BUILDING'}];
    if (u.pathname.endsWith('devKind/list')) data=[{uuid:'badminton'}];
    if (u.pathname.endsWith('current/page')) { const body=JSON.parse(opts.body); assert.equal(body.sceneUuid,VENUES[0].id); assert.equal(body.resvKind,'CURRENT_RESERVE'); }
    return {ok:true,status:200,url, json:async()=>({success:true,code:200,data})};
  };
  const api=new AvailabilityAPI('fake-token',undefined,fetcher);
  await api.slots(VENUES[0],'2026-11-14'); await api.slots(VENUES[0],'2026-11-15');
  assert.equal(calls.filter(c=>c.path.endsWith('disclaimers')).length,1);
  assert.equal(calls.filter(c=>c.path.endsWith('current/page')).length,2);
  assert.ok(calls.every(c=>!/(lockSite|addReserve|order|payment)/.test(c.path)));
});
test('manifest has narrow host access and no remote executable code', () => {
  const m=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url)));
  assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions,['storage','alarms','notifications']);
  assert.deepEqual(m.host_permissions,['https://www.sports.tsinghua.edu.cn/*']);
  assert.deepEqual(m.optional_permissions, ['scripting']);
  assert.deepEqual(m.optional_host_permissions, ['https://id.tsinghua.edu.cn/*']);
});
const TEST_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 6238 public test vector.
test('six-digit TOTP matches RFC 6238 SHA-1 vectors including year 2603', async () => {
  for (const [seconds, expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']]) {
    assert.equal(await totp(TEST_SECRET, seconds * 1000), expected);
  }
  assert.deepEqual(decodeBase32(TEST_SECRET.toLowerCase()), new TextEncoder().encode('12345678901234567890'));
  assert.equal(safeTotpDelay(29000),1250); assert.equal(safeTotpDelay(30000),0);
});
test('login config preserves masked values, validates secrets and isolates changed accounts', () => {
  const previous = {enabled:true,username:'test-account',password:' not-trimmed ',totpSecret:TEST_SECRET,principal:'fixture-user-id'};
  assert.deepEqual(validateLoginConfig({enabled:true,username:'test-account',password:'',totpSecret:''},previous), previous);
  assert.throws(() => validateLoginConfig({enabled:true,username:'different'},previous), /重新填写/);
  assert.throws(() => validateLoginConfig({enabled:true,username:'test',password:'x',totpSecret:'123456'}));
  assert.throws(() => validateLoginConfig({enabled:true,password:{}}), /文本/);
  assert.equal(validateLoginConfig({enabled:false},previous).enabled,false);
  assert.equal(validateLoginConfig({enabled:false,totpSecret:'invalid'},previous).totpSecret, TEST_SECRET);
});
test('credentials restricted to managed top frame and exact trusted origins', () => {
  const attempt={tabId:3,startedAt:Date.now()};
  const sender={tab:{id:3},frameId:0,url:`${IDENTITY_ORIGIN}/login`};
  assert.ok(loginSenderAllowed(sender,attempt,true));
  assert.equal(loginSenderAllowed({...sender,tab:{id:4}},attempt,true),false);
  assert.equal(loginSenderAllowed({...sender,frameId:1},attempt,true),false);
  assert.equal(loginSenderAllowed({...sender,url:'https://id.tsinghua.edu.cn.evil.test/login'},attempt),false);
  assert.equal(loginSenderAllowed({...sender,url:'http://id.tsinghua.edu.cn/login'},attempt),false);
  assert.equal(loginSenderAllowed(sender,{...attempt,startedAt:Date.now()-121000}),false);
});
test('login coordinator releases password once, computes OTP privately, and fails closed', async () => {
  const oldChrome=globalThis.chrome;
  const local={autoLogin:{enabled:true,username:'test-account',password:'fixture-password',totpSecret:TEST_SECRET}};
  const session={autoLoginAttempt:{tabId:3,startedAt:Date.now(),resumeQuery:true,used:{prepare:true,entry:true}}};
  const area = store => ({
    get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in store).map(k=>[k,structuredClone(store[k])])),
    set:async values=>Object.assign(store,structuredClone(values)),
    remove:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(k=>delete store[k]),
  });
  globalThis.chrome={storage:{local:area(local),session:area(session)},alarms:{clear:async()=>{}},tabs:{remove:async()=>{}},permissions:{contains:async()=>true}};
  try {
    const manager=new AutoLogin(), sender={tab:{id:3},frameId:0,url:IDENTITY_ORIGIN+'/login'};
    const publicState=await manager.state();
    assert.equal(publicState.hasPassword,true); assert.equal(publicState.password,undefined);assert.equal(publicState.totpSecret,undefined);
    const replies=await Promise.all([manager.step({action:'password'},sender),manager.step({action:'password'},sender)]);
    assert.equal(replies.filter(r=>r.ok).length,1);
    assert.equal(replies[0].password,'fixture-password');
    const otp=await manager.step({action:'totp'},sender);
    assert.match(otp.code,/^\d{6}$/);assert.equal(otp.totpSecret,undefined);assert.equal(otp.password,undefined);
    await manager.step({action:'failure'},sender);
    assert.equal(session.autoLoginAttempt,undefined);assert.equal(local.loginNotice.blocked,true);
    assert.equal(await manager.start(),false);
    local.loginNotice={status:'success'};
    await manager.timeout();assert.equal(local.loginNotice.status,'success');
    await manager.clear();assert.equal(local.autoLogin,undefined);
  } finally {globalThis.chrome=oldChrome;}
});
test('default fetch keeps the native browser global receiver', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function(url) {
      assert.equal(this, globalThis);
      return {ok:true,status:200,url,json:async()=>({success:true,data:[]})};
    };
    await new AvailabilityAPI('fake-token').request('api/card/list');
  } finally { globalThis.fetch = original; }
});
