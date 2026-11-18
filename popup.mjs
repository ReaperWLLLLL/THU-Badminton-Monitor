import {VENUES, dateLabel, queryDates} from './lib/core.mjs';
import {LOGIN_PERMISSIONS} from './lib/auto-login.mjs';
const $ = id => document.getElementById(id);
let state, date = '', busy = false;
async function send(type, payload = {}) {
  const reply = await chrome.runtime.sendMessage({type, ...payload});
  if (!reply?.ok) throw Error(reply?.error || '插件暂时无法响应，请重新打开');
  return reply;
}
function feedback(message) { $('feedback').textContent = message; $('feedback').hidden = !message; }
function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
function clock(time) { return new Date(time).toLocaleTimeString('zh-CN', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'}); }
function fillSettings() {
  const s = state.settings;
  $('venue-options').replaceChildren(...VENUES.map(v => {
    const label = el('label'), box = document.createElement('input'); box.type = 'checkbox'; box.name = 'venues'; box.value = v.id; box.checked = s.venues.includes(v.id); label.append(box, document.createTextNode(v.name)); return label;
  }));
  for (const name of ['weekdayStart','weekdayEnd','weekendStart','weekendEnd','intervalMinutes']) $(name).value = s[name];
  $('notifications').checked = s.notifications;
}
function render() {
  const s = state.settings, run = state.run;
  const auto = state.autoLogin || {};
  $('auto-login-status').textContent = auto.message || '';
  $('auto-login-status').hidden = !auto.message;
  $('auto-login-status').classList.toggle('success', auto.status === 'success');
  $('enabled').checked = s.enabled;
  $('interval-label').textContent = `每 ${s.intervalMinutes} 分钟`;
  $('login-text').textContent = state.loggedIn ? '已登录' : '去登录';
  $('login-dot').classList.toggle('online', state.loggedIn);
  $('updated').textContent = state.updatedAt ? `${new Date(state.updatedAt).toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai', month:'numeric',day:'numeric'})} ${clock(state.updatedAt)} 更新` : '尚未查询';
  $('next-query').textContent = s.enabled && state.nextQuery ? `下次 ${clock(state.nextQuery)} · 北京时间` : '自动查询已暂停';
  $('refresh').disabled = run.status === 'running' || auto.status === 'running' || busy;
  $('refresh').textContent = auto.status === 'running' ? '登录中…' : run.status === 'running' ? '查询中…' : '立即查询';
  const notice = $('run-status'); notice.replaceChildren();
  if (auto.status === 'running' || (auto.status === 'failed' && !state.loggedIn)) {
    notice.append(document.createTextNode(auto.message));
  } else if (run.status === 'running') {
    notice.append(document.createTextNode(`正在查询 ${run.done || 0}/${run.total || 16}，关闭弹窗后仍会继续`));
    const progress = document.createElement('progress'); progress.max = run.total || 16; progress.value = run.done || 0; notice.append(progress);
  } else if (run.message) notice.append(document.createTextNode(run.message));
  if (run.notificationError) notice.append(el('div', run.notificationError));
  if (run.errors?.length) {
    const details = document.createElement('details'); details.append(el('summary', '查看失败详情'));
    const list = document.createElement('ul'); run.errors.forEach(e => list.append(el('li', `${e.date} ${e.venue}：${e.message}`))); details.append(list); notice.append(details);
  }
  if (!state.loggedIn && run.status !== 'login' && auto.status !== 'running') notice.append(el('div', auto.enabled ? '已启用自动登录，可点击立即查询；失败后请到自动登录页重试。' : '请打开官网登录；登录态过期时需要重新登录。'));
  notice.hidden = !notice.childNodes.length;
  const dates = queryDates();
  if (!dates.includes(date)) date = dates[0];
  $('date-tabs').replaceChildren(...dates.map(d => {
    const b = el('button', dateLabel(d), d === date ? 'selected' : ''); b.type = 'button'; b.setAttribute('aria-pressed', String(d === date)); b.onclick = () => {date = d; render();}; return b;
  }));
  const slots = state.slots.filter(s => s.date === date);
  $('summary').textContent = state.updatedAt ? `找到 ${slots.length} 个空场${['partial','error','login','interrupted'].includes(run.status) ? ' · 请留意查询状态' : ''}` : '查询今天起四天内的空场';
  const container = $('slots'); container.replaceChildren();
  if (!slots.length) {
    const empty = el('div', '', 'empty');
    empty.append(el('strong', !state.loggedIn ? '先连接官方账号' : run.status === 'running' ? '正在获取空场' : !state.updatedAt ? '准备好就开始查询' : ['error','login','interrupted'].includes(run.status) ? '当前结果尚未确认' : '这一天暂无符合条件的空场'));
    empty.append(document.createTextNode(!state.loggedIn ? '在官网完成登录，插件会保留可用的登录态。' : '可以切换日期，或调整球馆和时间筛选。'));
    if (!state.loggedIn) { const b = el('button','打开官方登录','outline'); b.onclick = login; empty.append(el('br'), b); }
    container.append(empty);
  } else {
    for (const venue of VENUES) {
      const groupSlots = slots.filter(s => s.venueId === venue.id); if (!groupSlots.length) continue;
      const group = el('section', '', 'venue-group'); group.append(el('h2', venue.name));
      for (const slot of groupSlots) {
        const row = el('div', '', 'slot'), button = el('button','去预约 ↗');
        button.setAttribute('aria-label', `去预约 ${slot.date} ${slot.venueName} ${slot.siteName} ${slot.startTime}至${slot.endTime}`);
        button.onclick = async () => { try { await send('OPEN_SLOT', {id: slot.id}); } catch(e) {feedback(e.message);} };
        row.append(el('span',`${slot.startTime}–${slot.endTime}`,'slot-time'), el('span',slot.siteName,'slot-site'), button); group.append(row);
      }
      container.append(group);
    }
  }
}
async function refreshState() { state = (await send('GET_STATE')).state; render(); }
async function login() { try {await send('LOGIN');} catch(e) {feedback(e.message);} }
$('login').onclick = login;
$('results-tab').onclick = () => tab('results');
$('settings-tab').onclick = () => tab('settings');
$('login-tab').onclick = () => tab('login');
function tab(name) {
  if (!state) return;
  feedback('');
  for (const panel of ['results','settings','login']) {
    const selected = panel === name;
    $(panel + '-panel').hidden = !selected;
    $(panel + '-tab').classList.toggle('selected', selected); $(panel + '-tab').setAttribute('aria-selected', String(selected));
  }
  if (name === 'settings') fillSettings();
  if (name === 'login') fillLogin();
  else { $('login-password').value = ''; $('login-totp').value = ''; }
}
function fillLogin() {
  const a = state.autoLogin || {};
  $('auto-login-enabled').checked = !!a.enabled;
  $('login-username').value = a.username || '';
  $('login-password').value = ''; $('login-totp').value = '';
  $('login-password').placeholder = a.hasPassword ? '已保存；留空保留原密码' : '请输入密码';
  $('login-totp').placeholder = a.hasTotp ? '已保存；留空保留原密钥' : 'Base32 密钥，不是六位动态码';
  loginFields();
}
function loginFields() {
  const enabled = $('auto-login-enabled').checked;
  for (const id of ['login-username','login-password','login-totp']) $(id).disabled = !enabled;
  $('save-and-login').disabled = !enabled;
}
$('auto-login-enabled').onchange = loginFields;
$('login-form').onsubmit = async event => {
  event.preventDefault();
  const enabled = $('auto-login-enabled').checked;
  const config = {enabled, username: $('login-username').value, password: $('login-password').value, totpSecret: $('login-totp').value};
  const loginNow = event.submitter?.value === 'login';
  $('save-login').disabled = true; $('save-and-login').disabled = true;
  try {
    // Chrome requires this permission request to originate in the user's click.
    if (enabled && !await chrome.permissions.request(LOGIN_PERMISSIONS)) throw Error('未授权统一身份认证网站访问，自动登录未开启');
    state = (await send('SAVE_AUTO_LOGIN', {config, loginNow})).state;
    fillLogin(); render(); feedback('');
  } catch(e) { feedback(e.message); }
  finally { $('save-login').disabled = false; loginFields(); }
};
$('clear-login').onclick = async () => {
  try { state = (await send('CLEAR_AUTO_LOGIN')).state; fillLogin(); render(); feedback(''); }
  catch(e) { feedback(e.message); }
};
$('refresh').onclick = async () => { try {busy = true; feedback(''); render(); await send('REFRESH'); await refreshState();} catch(e) {feedback(e.message);} finally {busy = false; if(state) render();} };
$('enabled').onchange = async () => {
  try { state = (await send('SAVE_SETTINGS', {settings: {...state.settings, enabled: $('enabled').checked}})).state; render(); }
  catch(e) {feedback(e.message); render();}
};
$('settings-form').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const form = new FormData(event.currentTarget);
    const settings = {...state.settings, venues: form.getAll('venues'), intervalMinutes: Number(form.get('intervalMinutes')), notifications: $('notifications').checked};
    for (const key of ['weekdayStart','weekdayEnd','weekendStart','weekendEnd']) settings[key] = form.get(key);
    state = (await send('SAVE_SETTINGS', {settings})).state; render(); feedback('设置已保存，可返回空场页立即查询。');
  } catch(e) {feedback(e.message);} finally {$('save').disabled = false;}
};
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') void refreshState().catch(e => feedback(e.message)); });
void refreshState().then(fillSettings).catch(e => feedback(e.message));
