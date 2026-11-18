// Injected only into the extension-owned login tab, after optional permission approval.
(() => {
  if (globalThis.__autobookLoginActive) return;
  globalThis.__autobookLoginActive = true;
  const ID = 'https://id.tsinghua.edu.cn';
  let busy = false, stopped = false, lastAction = 0;
  const visible = node => node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const find = selector => [...document.querySelectorAll(selector)].find(visible);
  const text = node => node.textContent.trim();
  const buttons = () => [...document.querySelectorAll('button,a,input[type=submit]')].filter(visible);
  const confirm = () => buttons().find(n => text(n) === '确定' || n.value === '确定');
  const send = action => chrome.runtime.sendMessage({type: 'AUTO_LOGIN_STEP', action});
  function fill(node, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', {bubbles: true}));
    node.dispatchEvent(new Event('change', {bubbles: true}));
    node.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
  }
  async function tick() {
    if (busy || stopped || Date.now() - lastAction < 1800) return;
    busy = true;
    try {
      const context = await send('context');
      if (!context?.ok) { stopped = true; return; }
      if (location.origin !== ID) {
        if (!context.prepared) {
          if ((await send('prepare'))?.ok) { localStorage.removeItem('token'); location.reload(); }
          return;
        }
        const button = [...document.querySelectorAll('button,a,span,div')].find(n => visible(n) && text(n) === '统一身份认证登录' && !n.querySelector('button,a'));
        if (button && (await send('entry'))?.ok) { lastAction = Date.now(); button.click(); }
        return;
      }
      const error = find('#errorMsg,#errormsg,.error-msg,.error-info,.alert-danger,.el-message--error,[role=alert]');
      if (error && /错误|失败|不正确|无效|锁定|验证码/.test(text(error))) { await send('failure'); stopped = true; return; }
      const username = find('#i_user'), password = find('#i_pass');
      if (username && password) {
        const button = find('a.btn.btn-primary.btn-block');
        if (!button) return;
        const reply = await send('password');
        if (reply?.ok) { fill(username, reply.username); fill(password, reply.password); lastAction = Date.now(); button.click(); }
        return;
      }
      const otp = find('#vericode');
      if (otp && confirm()) {
        const reply = await send('totp');
        if (reply?.ok && visible(otp)) { fill(otp, reply.code); lastAction = Date.now(); confirm()?.click(); }
        return;
      }
      const radio = find('input[name="type"][type="radio"][value="totp"]');
      if (radio && confirm()) {
        if ((await send('chooseTotp'))?.ok) { radio.click(); lastAction = Date.now(); confirm()?.click(); }
        return;
      }
      if (confirm() && (await send('confirm'))?.ok) { lastAction = Date.now(); confirm()?.click(); }
    } catch { stopped = true; }
    finally { busy = false; }
  }
  // Wait for the official application's handlers before its first login click.
  setTimeout(() => { void tick(); }, 1800);
  const timer = setInterval(() => { if (stopped || !chrome.runtime?.id) clearInterval(timer); else void tick(); }, 2000);
})();
