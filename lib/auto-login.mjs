import {HOME, ORIGIN, tokenValid} from './core.mjs';

export const IDENTITY_ORIGIN = 'https://id.tsinghua.edu.cn';
export const LOGIN_PERMISSIONS = {permissions: ['scripting'], origins: [`${IDENTITY_ORIGIN}/*`]};
export const LOGIN_TIMEOUT_ALARM = 'auto-login-timeout';
const ATTEMPT_KEY = 'autoLoginAttempt';
const TIMEOUT = 120000;

export function decodeBase32(value) {
  const text = String(value).replace(/\s/g, '').toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]{16,128}$/.test(text) || [1,3,6].includes(text.length % 8)) throw Error('TOTP 密钥须为有效的 Base32 字符串');
  const bytes = []; let bits = 0, buffer = 0;
  for (const char of text) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); buffer &= (1 << bits) - 1; }
  }
  if (buffer !== 0) throw Error('TOTP 密钥编码不完整');
  return new Uint8Array(bytes);
}
export async function totp(secret, now = Date.now()) {
  const key = await crypto.subtle.importKey('raw', decodeBase32(secret), {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(now / 30000)));
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = digest[digest.length - 1] & 15;
  const number = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return String(number % 1000000).padStart(6, '0');
}
export function safeTotpDelay(now = Date.now()) {
  const remaining = 30000 - now % 30000;
  return remaining < 5000 ? remaining + 250 : 0;
}
export function validateLoginConfig(input, previous = {}) {
  if (typeof input?.enabled !== 'boolean') throw Error('自动登录开关无效');
  if (!input.enabled) return {enabled: false, username: previous.username || '', password: previous.password || '', totpSecret: previous.totpSecret || '', ...(previous.principal ? {principal: previous.principal} : {})};
  for (const key of ['username','password','totpSecret']) if (input[key] !== undefined && typeof input[key] !== 'string') throw Error('账号、密码和密钥必须是文本');
  const username = typeof input.username === 'string' ? input.username.trim() : previous.username || '';
  const changedAccount = username !== (previous.username || '');
  const password = input.password || (!changedAccount && previous.password) || '';
  const totpSecret = (input.totpSecret || (!changedAccount && previous.totpSecret) || '').replace(/\s/g, '').toUpperCase().replace(/=+$/, '');
  if (typeof password !== 'string' || password.length > 1024 || username.length > 128 || /\s/.test(username)) throw Error('账号或密码格式无效');
  if (input.enabled && (!username || !password || !totpSecret)) throw Error('开启自动登录需要账号、密码和 TOTP 密钥；更换账号时请重新填写密码和密钥');
  if (totpSecret) decodeBase32(totpSecret);
  return {enabled: input.enabled, username, password, totpSecret, ...(!changedAccount && previous.principal ? {principal: previous.principal} : {})};
}
export function loginSenderAllowed(sender, attempt, identityOnly = false) {
  if (!attempt || sender.tab?.id !== attempt.tabId || sender.frameId !== 0 || Date.now() - attempt.startedAt >= TIMEOUT) return false;
  try {
    const u = new URL(sender.url);
    return u.origin === IDENTITY_ORIGIN || (!identityOnly && u.origin === ORIGIN && u.pathname.startsWith('/venue/'));
  } catch { return false; }
}
function principal(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).username || ''; } catch { return ''; }
}

// Session state survives worker suspension; secrets stay in trusted local storage.
export class AutoLogin {
  constructor() { this.queue = Promise.resolve(); }
  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {}); return result;
  }
  async attempt() { return (await chrome.storage.session.get(ATTEMPT_KEY))[ATTEMPT_KEY]; }
  async state() {
    const {autoLogin = {}, loginNotice = {}} = await chrome.storage.local.get(['autoLogin','loginNotice']);
    return {enabled: !!autoLogin.enabled, username: autoLogin.username || '', hasPassword: !!autoLogin.password,
      hasTotp: !!autoLogin.totpSecret, ...loginNotice};
  }
  async initialize() {
    const attempt = await this.attempt();
    if (!attempt) {
      const {loginNotice} = await chrome.storage.local.get('loginNotice');
      if (loginNotice?.status === 'running') await this.fail('浏览器重启中断了自动登录，请在设置页重试');
      return;
    }
    try { await chrome.tabs.get(attempt.tabId); } catch { await this.fail('自动登录标签页已关闭，请手动重试'); return; }
    if (Date.now() - attempt.startedAt >= TIMEOUT) await this.fail('自动登录超时，请检查官网页面后重试');
    else await chrome.alarms.create(LOGIN_TIMEOUT_ALARM, {when: attempt.startedAt + TIMEOUT});
  }
  async save(input) {
    const {autoLogin = {}} = await chrome.storage.local.get('autoLogin');
    const config = validateLoginConfig(input, autoLogin);
    if (config.enabled && !await chrome.permissions.contains(LOGIN_PERMISSIONS)) throw Error('请允许插件访问统一身份认证网站，才能启用自动登录');
    await this.cancel();
    const changed = config.username !== autoLogin.username;
    await chrome.storage.local.set({autoLogin: config, loginNotice: {status: 'idle', message: config.enabled ? '自动登录已开启' : '自动登录已关闭'}});
    if (changed) await chrome.storage.local.remove(['auth','cache']);
    return this.state();
  }
  async clear() {
    await this.cancel();
    await chrome.storage.local.remove(['autoLogin','auth','cache']);
    await chrome.storage.local.set({loginNotice: {status: 'idle', message: '已清除插件保存的账号、密码、密钥和登录态'}});
  }
  async cancel() {
    const a = await this.attempt();
    await chrome.storage.session.remove(ATTEMPT_KEY);
    await chrome.alarms.clear(LOGIN_TIMEOUT_ALARM);
    const {loginNotice} = await chrome.storage.local.get('loginNotice');
    if (loginNotice?.status === 'running') await chrome.storage.local.set({loginNotice: {status: 'idle', message: '自动登录已停止'}});
    if (a) { try { await chrome.tabs.remove(a.tabId); } catch { /* Already closed. */ } }
  }
  async fail(message) {
    // Keep the official tab available for manual inspection, but release automation.
    await chrome.storage.session.remove(ATTEMPT_KEY);
    await chrome.alarms.clear(LOGIN_TIMEOUT_ALARM);
    await chrome.storage.local.set({loginNotice: {status: 'failed', blocked: true, message}});
  }
  start({manual = false, resumeQuery = true} = {}) {
    return this.exclusive(async () => {
      const {autoLogin: config, loginNotice = {}} = await chrome.storage.local.get(['autoLogin','loginNotice']);
      if (!config?.enabled || (!manual && loginNotice.blocked)) return false;
      if (await this.attempt()) return true;
      if (!manual && loginNotice.completedAt && Date.now() - loginNotice.completedAt < TIMEOUT) {
        await this.fail('刚更新的登录态仍被官网拒绝，请手动检查后重试'); return false;
      }
      if (!await chrome.permissions.contains(LOGIN_PERMISSIONS)) { await this.fail('自动登录缺少官网访问权限，请在自动登录设置中重新保存'); return false; }
      let tab;
      try {
        tab = await chrome.tabs.create({url: 'about:blank', active: manual});
        await chrome.storage.session.set({[ATTEMPT_KEY]: {tabId: tab.id, startedAt: Date.now(), resumeQuery, used: {}}});
        await chrome.storage.local.set({loginNotice: {status: 'running', message: '正在通过官网自动登录…'}});
        await chrome.alarms.create(LOGIN_TIMEOUT_ALARM, {when: Date.now() + TIMEOUT});
        await chrome.tabs.update(tab.id, {url: HOME});
        return true;
      } catch { await this.fail('无法打开自动登录页面，请手动重试'); return false; }
    });
  }
  async inject(tabId) {
    const a = await this.attempt();
    if (a?.tabId !== tabId) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!loginSenderAllowed({tab, frameId: 0, url: tab.url}, a)) return;
      await chrome.scripting.executeScript({target: {tabId}, files: ['login-content.js']});
    } catch { /* Navigation can replace a document during injection; next load retries. */ }
  }
  step(message, sender) {
    return this.exclusive(async () => {
      const a = await this.attempt();
      const {autoLogin: config} = await chrome.storage.local.get('autoLogin');
      if (!config?.enabled || !loginSenderAllowed(sender, a)) return {ok: false};
      const action = message.action;
      if (action === 'context') return {ok: true, prepared: !!a.used.prepare};
      if (action === 'failure') { await this.fail('官网认证未通过，请检查账号、密码和 TOTP，或手动完成额外验证后重试'); return {ok: false}; }
      if (!['prepare','entry','password','chooseTotp','totp','confirm'].includes(action) || a.used[action]) return {ok: false};
      const isIdentity = loginSenderAllowed(sender, a, true);
      if (['prepare','entry'].includes(action) ? isIdentity : !isIdentity) return {ok: false};
      if (action !== 'prepare' && !a.used.prepare) return {ok: false};
      if (['password','chooseTotp','totp','confirm'].includes(action) && !a.used.entry) return {ok: false};
      if (action === 'confirm' && !a.used.password && !a.used.totp) return {ok: false};
      a.used[action] = true;
      await chrome.storage.session.set({[ATTEMPT_KEY]: a});
      if (action === 'password') return {ok: true, username: config.username, password: config.password};
      if (action === 'totp') {
        const delay = safeTotpDelay();
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if ((await this.attempt())?.startedAt !== a.startedAt) return {ok: false};
        return {ok: true, code: await totp(config.totpSecret)};
      }
      return {ok: true};
    });
  }
  async acceptToken(sender, token) {
    const a = await this.attempt();
    if (!a) return {accepted: true, resumeQuery: false};
    if (!loginSenderAllowed(sender, a) || !a.used.entry || !tokenValid(token)) return {accepted: false};
    const {autoLogin: config} = await chrome.storage.local.get('autoLogin');
    if (!config?.enabled) return {accepted: false};
    const account = principal(token);
    // SSO can reuse a different account. Only trust a previously verified principal,
    // or a login that used the configured password/TOTP in this attempt.
    if ((!a.used.password && !a.used.totp && (!config.principal || config.principal !== account)) || (config.principal && config.principal !== account)) {
      await this.fail('官网沿用了其他或尚未核对的账号，请先退出官网当前账号，再重试自动登录'); return {accepted: false};
    }
    await chrome.storage.local.set({autoLogin: {...config, principal: account}, loginNotice: {status: 'success', completedAt: Date.now(), message: '自动登录成功'}});
    await this.cancel();
    return {accepted: true, resumeQuery: a.resumeQuery};
  }
  async removed(tabId) { if ((await this.attempt())?.tabId === tabId) await this.fail('自动登录标签页已关闭，请手动重试'); }
  async timeout() {
    const a = await this.attempt();
    if (a && Date.now() - a.startedAt >= TIMEOUT) await this.fail('自动登录超时，请检查官网是否需要额外验证，并在设置页手动重试');
  }
}
