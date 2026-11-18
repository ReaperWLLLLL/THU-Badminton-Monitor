import {ORIGIN, parseSlots} from './core.mjs';
import {signedParams} from './signature.mjs';
export class AuthError extends Error {}
export function checkPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('接口返回格式异常');
  const message = String(payload.message || payload.msg || '接口请求失败').slice(0, 160);
  if ([401,403,'401','403'].includes(payload.code) || /登录|登陆|token.*(失效|过期|invalid|expire)|未授权/i.test(message)) throw new AuthError('登录已失效，请打开官网重新登录');
  if (payload.success === false || ![undefined,null,0,'0',200,'200'].includes(payload.code)) throw Error(message);
  return payload;
}
export class AvailabilityAPI {
  constructor(token, signal, fetcher = (...args) => globalThis.fetch(...args)) { this.token = token; this.signal = signal; this.fetcher = fetcher; this.metadata = new Map(); }
  async request(path, params = {}, body) {
    const timeout = AbortSignal.timeout(12000);
    const response = await this.fetcher(`${ORIGIN}/venue/site/${path}?${new URLSearchParams({...signedParams(), ...params})}`, {
      method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
      headers: {'Accept': 'application/json, text/plain, */*', 'Language-Set': 'CN', 'token': this.token, 'x-api-version': '2.0.0', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    if ([401,403].includes(response.status) || /login|id\.tsinghua/i.test(response.url)) throw new AuthError('登录已失效，请打开官网重新登录');
    if (!response.ok) throw Error(`查询失败（HTTP ${response.status}）`);
    let payload;
    try { payload = await response.json(); } catch { throw Error('官网返回了非 JSON 内容，请重新登录或稍后重试'); }
    return checkPayload(payload);
  }
  async prepare(sceneUuid) {
    if (this.metadata.has(sceneUuid)) return this.metadata.get(sceneUuid);
    await this.request('resv/instr/disclaimers', {}, {uuid: sceneUuid, relatedType: 5, sceneUuid});
    const buildings = (await this.request('api/site/chooseByType', {sceneUuid, siteType: 'BUILDING'})).data;
    if (!Array.isArray(buildings) || !buildings.length) throw Error('官网未返回球馆信息');
    let roomId;
    for (const b of buildings) {
      const rooms = (await this.request('api/site/chooseByType', {sceneUuid, siteType: 'ROOM', siteUuid: b.classTypeUuid || b.uuid})).data;
      roomId ||= rooms?.find(r => r.uuid)?.uuid;
    }
    const kinds = (await this.request('api/site/devKind/list', {uuid: sceneUuid})).data;
    const devKindUuid = kinds?.find(k => k.uuid)?.uuid;
    const first = buildings[0], classTypeUuid = first.classTypeUuid || first.uuid;
    if (!devKindUuid || !classTypeUuid) throw Error('官网未返回场地类型信息');
    const meta = {sceneUuid, devKindUuid, classTypeUuid, classTypeEnum: first.siteType || first.classTypeEnum || 'BUILDING', roomId};
    this.metadata.set(sceneUuid, meta); return meta;
  }
  async slots(venue, date) {
    const meta = await this.prepare(venue.id);
    const {roomId, ...body} = meta;
    const payload = await this.request('api/reserve/current/page', {}, {...body, resvKind: 'CURRENT_RESERVE', siteType: 'DEV', searchValue: '', siteKindId: '', reserveDate: date, sceneUseType: 'SPORT_GROUP', pageSize: 999, pageNum: 1});
    // Keep the same read-only preparation sequence as the existing Python client.
    if (roomId) await this.request('api/card/support/info', {uuid: roomId, relatedType: 'ROOM'});
    await this.request('api/card/list', {pageSize: 10, pageNum: 1});
    return parseSlots(payload, venue, date);
  }
}
