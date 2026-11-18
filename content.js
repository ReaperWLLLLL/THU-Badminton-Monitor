// Runs only on the official venue site. Reads its token; never reads login forms.
(() => {
  let lastToken, target, locating = false, finished = false;
  const send = message => chrome.runtime.sendMessage(message);
  async function syncToken() {
    try {
      const token = localStorage.getItem('token');
      if (token && token !== lastToken) {
        await send({type: 'TOKEN', token});
        lastToken = token;
      }
    } catch { /* A reloaded/disabled extension will reconnect on the next page load. */ }
  }
  const text = node => (node?.textContent || '').replace(/\s+/g, '').trim();
  function showBanner(message) {
    let root = document.getElementById('autobook-extension-hint');
    if (!root) {
      root = document.createElement('div'); root.id = 'autobook-extension-hint';
      const shadow = root.attachShadow({mode: 'open'});
      const style = document.createElement('style');
      style.textContent = ':host{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:90vw}aside{background:#fff;color:#24212c;border:1px solid #d5c4f4;border-left:4px solid #6d3bd1;box-shadow:0 4px 24px #0002;border-radius:8px;padding:14px 16px;display:flex;gap:18px;align-items:center;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}button{border:0;background:none;color:#77727f;font-size:20px;cursor:pointer}';
      const aside = document.createElement('aside'), span = document.createElement('span'), close = document.createElement('button');
      close.textContent = '×'; close.title = '关闭提示'; close.onclick = () => {finished = true; root.remove();};
      aside.append(span, close); shadow.append(style, aside); document.body.append(root);
    }
    root.shadowRoot.querySelector('span').textContent = message;
  }
  function fromURL() {
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    const s = {venueId: p.get('uuid'), date: p.get('ab_date'), siteName: p.get('ab_site'), startTime: p.get('ab_start'), endTime: p.get('ab_end')};
    return /^[a-f0-9]{32}$/.test(s.venueId || '') && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && /^\d{2}:\d{2}$/.test(s.startTime || '') && /^\d{2}:\d{2}$/.test(s.endTime || '') && s.siteName && s.siteName.length < 80 ? s : null;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function locate() {
    if (!target || locating || finished || !localStorage.getItem('token')) return;
    locating = true;
    const expected = `${target.startTime}~${target.endTime}`;
    showBanner(`正在定位 ${target.date} ${target.siteName} ${expected}…`);
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    if (!location.hash.startsWith('#/reserveList') || p.get('uuid') !== target.venueId) {
      location.hash = `/reserveList?${new URLSearchParams({uuid: target.venueId, ab_date: target.date, ab_site: target.siteName, ab_start: target.startTime, ab_end: target.endTime})}`;
    }
    const deadline = Date.now() + 30000;
    let selected = false;
    while (Date.now() < deadline && !finished) {
      await wait(500);
      const dateLabel = target.date.slice(5).replace('-', '.');
      const dates = [...document.querySelectorAll('.date-item')];
      const dateNode = dates.find(n => text(n.querySelector('span')) === dateLabel || text(n).includes(dateLabel));
      if (!dateNode) continue;
      if (!selected) {
        if (dateNode.classList.contains('disabled') || dateNode.getAttribute('aria-disabled') === 'true') continue;
        // Only select the date. Clicking a slot could lock a court, so it is never automated.
        dateNode.click(); selected = true; await wait(1800); continue;
      }
      if (!['date-item-active', 'active', 'is-active'].some(name => dateNode.classList.contains(name))) continue;
      if ([...document.querySelectorAll('.el-loading-mask')].some(n => n.getClientRects().length)) continue;
      const site = [...document.querySelectorAll('.sites-item')].find(n => text(n.querySelector('.el-tooltip')) === target.siteName.replace(/\s+/g, ''));
      if (!site) continue;
      const normalize = s => s.replace(/[～—–-]/g, '~').replace(/\s+/g, '');
      let time = [...site.querySelectorAll('.time')].find(n => normalize(text(n)) === expected);
      // Some sessions expose a smaller availableRange inside a larger official time block.
      if (!time) time = [...site.querySelectorAll('.time')].find(n => {
        const match = normalize(text(n)).match(/(\d\d:\d\d)~(\d\d:\d\d)/);
        return match && match[1] <= target.startTime && match[2] >= target.endTime;
      });
      if (!time) continue;
      time.style.outline = '3px solid #6d3bd1'; time.style.outlineOffset = '3px'; time.style.boxShadow = '0 0 0 6px #ede4fd';
      time.scrollIntoView({block: 'center', behavior: 'smooth'});
      showBanner(`已定位 ${target.date} ${target.siteName} ${expected}。请核对官网可用状态，再自行确认预约。`);
      finished = true;
    }
    if (!finished) {
      showBanner(`目标场次：${target.date} ${target.siteName} ${expected}。页面中暂未找到该场次，可能已被预约或日期未开放，请在官网确认。`);
      finished = true;
    }
    locating = false;
  }
  async function start() {
    target = fromURL();
    try { if (!target) target = (await send({type: 'GET_TARGET'}))?.target; } catch { /* No pending navigation. */ }
    await syncToken(); void locate();
  }
  void start();
  const timer = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(timer); return; }
    void syncToken(); void locate();
  }, 2500);
  window.addEventListener('storage', () => {void syncToken();});
})();
