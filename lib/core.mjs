export const ORIGIN = 'https://www.sports.tsinghua.edu.cn';
export const HOME = `${ORIGIN}/venue/#/home`;
export const VENUES = [
  {id: '68f557c0f3a24f6ebcd181843d090dc7', name: '西体羽毛球(前馆)'},
  {id: '1217221866f548d6b28800c04d51d551', name: '西体羽毛球(后馆)'},
  {id: 'd0c855def3b74cb19eb71b10c4afb50b', name: '综体羽毛球'},
  {id: 'de6ee04a27c940029d13b7d5f1ef8ce4', name: '气膜馆羽毛球'},
];
export const DEFAULT_SETTINGS = {
  enabled: true, intervalMinutes: 30, notifications: true,
  venues: VENUES.map(v => v.id),
  weekdayStart: '16:00', weekdayEnd: '23:59',
  weekendStart: '10:00', weekendEnd: '23:59',
};
export function validateSettings(input) {
  const s = {...DEFAULT_SETTINGS, ...input};
  if (typeof s.enabled !== 'boolean' || typeof s.notifications !== 'boolean') throw Error('开关设置无效');
  if (!Number.isInteger(s.intervalMinutes) || s.intervalMinutes < 5 || s.intervalMinutes > 1440) throw Error('查询间隔须为 5–1440 分钟的整数');
  if (!Array.isArray(s.venues) || !s.venues.length || s.venues.some(id => !VENUES.some(v => v.id === id))) throw Error('请至少选择一个有效球馆');
  for (const day of ['weekday', 'weekend']) {
    for (const edge of ['Start', 'End']) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s[day + edge])) throw Error('请输入有效的开始时间范围');
    }
    if (s[day + 'Start'] > s[day + 'End']) throw Error('时间范围的起点不能晚于终点');
  }
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k => [k, k === 'venues' ? [...new Set(s[k])] : s[k]]));
}
export function beijingDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
export function queryDates(now = new Date()) {
  const start = Date.parse(`${beijingDate(now)}T00:00:00Z`);
  return Array.from({length: 4}, (_, i) => new Date(start + i * 86400_000).toISOString().slice(0, 10));
}
export function dateLabel(iso, today = beijingDate()) {
  const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400_000);
  const label = diff === 0 ? '今天' : diff === 1 ? '明天' : ['周日','周一','周二','周三','周四','周五','周六'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${label} ${iso.slice(5).replace('-', '.')}`;
}
export function slotKey(s) { return [s.date, s.venueId, s.siteName, s.startTime, s.endTime].join('|'); }
export function parseSlots(payload, venue, date) {
  if (!Array.isArray(payload.data)) throw Error('空场接口返回格式异常');
  const found = new Map();
  for (const site of payload.data) {
    if (!Array.isArray(site.sessionVo)) continue;
    for (const session of site.sessionVo) {
      const status = session.reserveStatus || {};
      if (status.reserveStatus !== 'Y') continue;
      const spans = status.availableRange?.length ? status.availableRange : [{startTime: session.beginTime, endTime: session.endTime}];
      for (const span of spans) {
        const s = {date, venueId: venue.id, venueName: venue.name, siteName: String(site.siteName || ''),
          startTime: String(span.startTime || session.beginTime || '').slice(0, 5),
          endTime: String(span.endTime || session.endTime || '').slice(0, 5)};
        if (!s.siteName || !/^\d\d:\d\d$/.test(s.startTime) || !/^\d\d:\d\d$/.test(s.endTime)) continue;
        s.id = slotKey(s); found.set(s.id, s);
      }
    }
  }
  return [...found.values()];
}
export function filterSlots(slots, settings, now = new Date()) {
  return slots.filter(s => {
    const day = new Date(`${s.date}T00:00:00Z`).getUTCDay();
    const prefix = day === 0 || day === 6 ? 'weekend' : 'weekday';
    return settings.venues.includes(s.venueId) && s.startTime >= settings[prefix + 'Start'] && s.startTime <= settings[prefix + 'End']
      && Date.parse(`${s.date}T${s.startTime}:00+08:00`) > now.getTime();
  }).sort((a, b) => `${a.date} ${a.startTime} ${a.venueId} ${a.siteName}`.localeCompare(`${b.date} ${b.startTime} ${b.venueId} ${b.siteName}`, 'zh-CN', {numeric: true}));
}
export function normalizeToken(raw) {
  if (typeof raw !== 'string') return '';
  const token = raw.trim().replace(/^"|"$/g, '');
  return token.length < 16000 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : '';
}
export function tokenExpiry(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(part)).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch { return 0; }
}
export function tokenValid(token, now = Date.now()) { return tokenExpiry(token) > now + 60_000; }
export function officialSlotURL(slot) {
  if (!VENUES.some(v => v.id === slot.venueId)) throw Error('未知球馆');
  const p = new URLSearchParams({uuid: slot.venueId, ab_date: slot.date, ab_site: slot.siteName, ab_start: slot.startTime, ab_end: slot.endTime});
  return `${ORIGIN}/venue/#/reserveList?${p}`;
}
