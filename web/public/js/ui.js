/* ================= 搭搭 UI 组件库 ================= */
const UI = (() => {
  // ---------- Toast ----------
  function toast(msg, ms = 2200) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, ms);
    setTimeout(() => el.remove(), ms + 300);
  }

  // ---------- 底部弹层 ----------
  function sheet(title, contentHTML, opts = {}) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal-sheet">
        <div class="sheet-grab"></div>
        ${title ? `<div class="sheet-title">${title}</div>` : ''}
        <div class="sheet-body">${contentHTML}</div>
      </div>`;
    const close = () => { mask.style.opacity = '0'; mask.style.transition = 'opacity .15s'; setTimeout(() => mask.remove(), 160); };
    if (!opts.locked) {
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    }
    document.body.appendChild(mask);
    return { el: mask, close };
  }

  // ---------- 确认框 ----------
  function confirm(msg, { okText = '确定', cancelText = '取消', danger = false } = {}) {
    return new Promise((resolve) => {
      const s = sheet('', `
        <div style="text-align:center; padding: 6px 10px 4px; font-size:15.5px; line-height:1.6;">${msg}</div>
        <div style="display:flex; gap:10px; margin-top:18px;">
          <button class="btn plain block" data-act="no" style="flex:1">${cancelText}</button>
          <button class="btn block ${danger ? 'danger' : 'primary'}" data-act="yes" style="flex:1">${okText}</button>
        </div>`);
      s.el.addEventListener('click', (e) => {
        const act = e.target?.dataset?.act;
        if (act) { s.close(); resolve(act === 'yes'); }
      });
    });
  }

  // ---------- 工具 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m}分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}天前`;
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  function hhmm(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function avatarHTML(user, size = '') {
    if (user?.avatar) return `<div class="avatar ${size}"><img src="${esc(user.avatar)}" alt=""></div>`;
    const ch = (user?.nickname || '?').trim().charAt(0) || '?';
    return `<div class="avatar ${size}">${esc(ch)}</div>`;
  }

  function genderBadge(g) {
    if (g === 'female') return '<span style="font-size:12px">♀</span>';
    if (g === 'male') return '<span style="font-size:12px">♂</span>';
    return '';
  }

  function creditLabel(credit) {
    if (credit >= 750) return { text: '搭力·传奇', cls: 'blue' };
    if (credit >= 650) return { text: `搭力 ${credit}`, cls: 'green' };
    if (credit >= 450) return { text: `搭力 ${credit}`, cls: 'yellow' };
    return { text: `搭力 ${credit}`, cls: 'gray' };
  }

  function empty(icon, title, sub) {
    return `<div class="empty"><div class="e-icon">${icon}</div><div class="e-title">${esc(title)}</div><div style="font-size:13px">${esc(sub || '')}</div></div>`;
  }

  function loading(text = '加载中...') {
    return `<div class="loading">${esc(text)}</div>`;
  }

  const requireLogin = () => {
    UI.toast('请先登录');
    location.hash = '#/login';
    return false;
  };

  return { toast, sheet, confirm, esc, timeAgo, hhmm, avatarHTML, genderBadge, creditLabel, empty, loading, requireLogin };
})();
