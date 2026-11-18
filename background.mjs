import {DEFAULT_SETTINGS, VENUES, HOME, ORIGIN, validateSettings, queryDates, filterSlots, normalizeToken, tokenValid, tokenExpiry, officialSlotURL} from './lib/core.mjs';
import {AvailabilityAPI, AuthError} from './lib/api.mjs';
import {AutoLogin, LOGIN_TIMEOUT_ALARM} from './lib/auto-login.mjs';

const ALARM = 'availability-scan';
let active = null, controller = null, revision = 0;
const autoLogin = new AutoLogin();
const ready = initialize();
async function initialize() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const {settings, run} = await chrome.storage.local.get(['settings', 'run']);
  if (!settings) await chrome.storage.local.set({settings: DEFAULT_SETTINGS});
  if (run?.status === 'running') await chrome.storage.local.set({run: {...run, status: 'interrupted', message: '上次查询被浏览器中断，可重新查询'}});
  await ensureAlarm();
  await autoLogin.initialize();
}
async function ensureAlarm(reset = false) {
  const {settings = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
  const existing = await chrome.alarms.get(ALARM);
  if (!settings.enabled) { await chrome.alarms.clear(ALARM); return; }
  if (reset || !existing || existing.periodInMinutes !== settings.intervalMinutes) {
    await chrome.alarms.create(ALARM, {delayInMinutes: settings.intervalMinutes, periodInMinutes: settings.intervalMinutes});
  }
}
async function badge(text, color = '#6d3bd1') {
  await chrome.action.setBadgeBackgroundColor({color});
  await chrome.action.setBadgeText({text});
}
async function publicState() {
  const {settings = DEFAULT_SETTINGS, auth, cache, run} = await chrome.storage.local.get(['settings','auth','cache','run']);
  const alarm = await chrome.alarms.get(ALARM);
  return {settings, autoLogin: await autoLogin.state(), loggedIn: !!(auth && !auth.invalid && tokenValid(auth.token)),
    slots: filterSlots(cache?.slots || [], settings), dates: cache?.dates || queryDates(),
    updatedAt: cache?.updatedAt || null, queriedVenues: cache?.venues || [],
    run: run || {status: 'idle'}, nextQuery: alarm?.scheduledTime || null};
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, {once: true});
  });
}
function startScan() {
  if (active) return active;
  active = scan().catch(async () => {
    // Never log request objects: they contain the session token.
    await chrome.storage.local.set({run: {status: 'error', message: '查询意外中断，请重试'}});
  }).finally(() => { active = null; controller = null; });
  return active;
}
async function scan() {
  await ready;
  const {settings = DEFAULT_SETTINGS, auth} = await chrome.storage.local.get(['settings', 'auth']);
  if (!auth || auth.invalid || !tokenValid(auth.token)) {
    await chrome.storage.local.set({run: {status: 'login', message: '请先在官网登录，登录完成后会自动同步'}});
    await badge('登录', '#a45b14');
    await autoLogin.start({resumeQuery: true}); return;
  }
  controller = new AbortController();
  const signal = controller.signal, currentRevision = revision;
  const timeout = setTimeout(() => controller?.abort(new Error('查询耗时过长，请稍后重试')), 210000);
  const dates = queryDates(), venues = VENUES.filter(v => settings.venues.includes(v.id));
  const total = dates.length * venues.length, startedAt = Date.now();
  let done = 0;
  const slots = [], errors = [];
  const api = new AvailabilityAPI(auth.token, signal);
  await chrome.storage.local.set({run: {status: 'running', startedAt, done, total}});
  await badge('…');
  try {
    for (const date of dates) for (const venue of venues) {
      await sleep(3000, signal);
      try { slots.push(...await api.slots(venue, date)); }
      catch (error) {
        if (signal.aborted || error instanceof AuthError) throw error;
        errors.push({date, venue: venue.name, message: error.name === 'TimeoutError' ? '请求超时' : String(error.message).slice(0, 180)});
      }
      await chrome.storage.local.set({run: {status: 'running', startedAt, done: ++done, total, errors}});
    }
    if (currentRevision !== revision) return;
    const updatedAt = Date.now();
    const status = errors.length === total ? 'error' : errors.length ? 'partial' : 'complete';
    const run = {status, done, total, errors, finishedAt: updatedAt,
      message: errors.length ? `${errors.length}/${total} 组查询失败，失败部分不代表没有空场` : ''};
    // Retain previous results on total failure, showing their original timestamp.
    await chrome.storage.local.set({run, ...(status !== 'error' ? {cache: {slots, dates, venues: settings.venues, updatedAt}} : {})});
    const visible = filterSlots(slots, settings);
    await badge(errors.length ? '!' : visible.length ? String(Math.min(visible.length, 999)) : '');
    if (settings.notifications && visible.length && currentRevision === revision) {
      const first = visible[0];
      try {
        await chrome.notifications.create('available', {type: 'basic', iconUrl: 'icons/128.png',
          title: `发现 ${visible.length} 个羽毛球空场${errors.length ? '（部分结果）' : ''}`,
          message: `${first.date} ${first.startTime}–${first.endTime}\n${first.venueName} · ${first.siteName}\n点击查看全部空场`, priority: 1});
      } catch { await chrome.storage.local.set({run: {...run, notificationError: '通知未能显示，请检查 Chrome 和系统通知权限'}}); }
    }
  } catch (error) {
    if (currentRevision !== revision) return;
    if (error instanceof AuthError) {
      await chrome.storage.local.set({auth: {...auth, invalid: true}, run: {status: 'login', message: error.message}});
      await badge('登录', '#a45b14');
      await autoLogin.start({resumeQuery: true});
    } else {
      await chrome.storage.local.set({run: {status: 'error', message: signal.aborted ? String(signal.reason?.message || '查询已中断') : '网络异常，请稍后重试'}});
      await badge('!');
    }
  } finally { clearTimeout(timeout); }
}
async function cancelScan() {
  revision++;
  controller?.abort();
  if (active) await active;
}
function officialSender(sender) {
  try { const u = new URL(sender.url); return !!sender.tab && u.origin === ORIGIN && u.pathname.startsWith('/venue/'); } catch { return false; }
}
async function handle(message, sender) {
  await ready;
  if (message.type === 'AUTO_LOGIN_STEP') return autoLogin.step(message, sender);
  if (officialSender(sender)) {
    if (message.type === 'TOKEN') {
      const token = normalizeToken(message.token);
      if (!tokenValid(token)) return {ok: false};
      const login = await autoLogin.acceptToken(sender, token);
      if (!login.accepted) return {ok: false};
      const {auth, settings = DEFAULT_SETTINGS} = await chrome.storage.local.get(['auth', 'settings']);
      if (auth?.token === token && !auth.invalid && !login.resumeQuery) return {ok: true};
      if (auth && tokenExpiry(auth.token) > tokenExpiry(token) && !auth.invalid && !login.resumeQuery) return {ok: true};
      await cancelScan();
      await chrome.storage.local.set({auth: {token, capturedAt: Date.now(), invalid: false}, run: {status: 'idle'}});
      await badge('');
      if (settings.enabled || login.resumeQuery) void startScan();
      return {ok: true};
    }
    if (message.type === 'GET_TARGET') {
      const key = `target-${sender.tab.id}`;
      const target = (await chrome.storage.session.get(key))[key];
      return {ok: true, target: target && Date.now() - target.createdAt < 30 * 60000 ? target.slot : null};
    }
    return {ok: false, error: '不支持此操作'};
  }
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return {ok: false, error: '无效来源'};
  if (message.type === 'GET_STATE') return {ok: true, state: await publicState()};
  if (message.type === 'SAVE_AUTO_LOGIN') {
    await cancelScan();
    await autoLogin.save(message.config);
    await chrome.storage.local.set({run: {status: 'idle'}});
    if (message.loginNow) await autoLogin.start({manual: true, resumeQuery: true});
    return {ok: true, state: await publicState()};
  }
  if (message.type === 'CLEAR_AUTO_LOGIN') {
    await cancelScan(); await autoLogin.clear();
    await chrome.storage.local.set({run: {status: 'idle'}}); await badge('');
    return {ok: true, state: await publicState()};
  }
  if (message.type === 'REFRESH') { void startScan(); return {ok: true}; }
  if (message.type === 'SAVE_SETTINGS') {
    const settings = validateSettings(message.settings);
    await cancelScan();
    if (!settings.enabled) await autoLogin.cancel();
    await chrome.storage.local.set({settings, run: {status: 'idle', message: '设置已保存；新的球馆范围将在下次查询生效'}});
    await ensureAlarm(true);
    if (!settings.enabled) await badge('');
    return {ok: true, state: await publicState()};
  }
  if (message.type === 'LOGIN') { await chrome.tabs.create({url: HOME}); return {ok: true}; }
  if (message.type === 'OPEN_SLOT') {
    const {cache, settings = DEFAULT_SETTINGS} = await chrome.storage.local.get(['cache','settings']);
    const slot = filterSlots(cache?.slots || [], settings).find(s => s.id === message.id);
    if (!slot) throw Error('该场次已过时，请重新查询');
    const tab = await chrome.tabs.create({url: officialSlotURL(slot)});
    await chrome.storage.session.set({[`target-${tab.id}`]: {slot, createdAt: Date.now()}});
    return {ok: true};
  }
  throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message || {}, sender).then(respond, error => respond({ok: false, error: String(error.message).slice(0, 200)}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void ready.then(async () => {
  const {settings} = await chrome.storage.local.get('settings');
  if (settings?.enabled) void startScan();
}); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === LOGIN_TIMEOUT_ALARM) void ready.then(() => autoLogin.timeout()); });
chrome.runtime.onInstalled.addListener(() => { void ready.then(() => ensureAlarm()); });
chrome.runtime.onStartup.addListener(() => { void ready.then(() => ensureAlarm()); });
chrome.notifications.onClicked.addListener(id => { if (id === 'available') { void chrome.tabs.create({url: chrome.runtime.getURL('popup.html')}); void chrome.notifications.clear(id); } });
chrome.tabs.onRemoved.addListener(tabId => { void chrome.storage.session.remove(`target-${tabId}`); void ready.then(() => autoLogin.removed(tabId)); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete') void ready.then(() => autoLogin.inject(tabId)); });
