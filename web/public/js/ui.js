/* ================= 搭搭 UI 组件库 ================= */
const UI = (() => {
  // ---------- Toast ----------
  // H1 防叠：同文案在存活期内不重复弹出；同屏最多 3 条，超出立即移除最旧
  const toastAlive = new Map(); // msg -> 过期时间戳
  function toast(msg, ms = 2200) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      // R5[W1]：toast 是全站表单错误/操作结果的唯一出口，容器挂 live 语义后
      // 每条新 toast 都会进入读屏播报队列（polite：不打断当前朗读）
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(wrap);
    }
    const now = Date.now();
    if ((toastAlive.get(msg) || 0) > now) return;
    toastAlive.set(msg, now + ms);
    while (wrap.children.length >= 3) wrap.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, ms);
    setTimeout(() => {
      el.remove();
      const exp = toastAlive.get(msg) || 0;
      if (exp <= Date.now()) toastAlive.delete(msg);
    }, ms + 300);
  }

  // ---------- 底部弹层 ----------
  // U4：① dialog 语义（role/aria-modal/aria-label）；② Esc 关闭（locked 除外，多层叠加只关最顶层）；
  // ③ 打开即聚焦 sheet 内第一个可聚焦元素（没有则聚焦 sheet 本身），关闭时焦点归还触发元素；
  // ④ opts.cancel=true 时底部自动补"取消"plain 按钮（提交型 sheet 的统一取消出口）。
  const sheetStack = [];
  function sheet(title, contentHTML, opts = {}) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    if (title) mask.setAttribute('aria-label', title);
    mask.innerHTML = `
      <div class="modal-sheet" tabindex="-1">
        <div class="sheet-grab"></div>
        ${title ? `<div class="sheet-title">${title}</div>` : ''}
        <div class="sheet-body">${contentHTML}</div>
      </div>`;
    let closed = false;
    const prevFocus = document.activeElement;
    const api = { el: mask, close: null };
    const close = () => {
      if (closed) return;
      closed = true;
      const i = sheetStack.indexOf(api);
      if (i > -1) sheetStack.splice(i, 1);
      if (!opts.locked) document.removeEventListener('keydown', onKey);
      mask.style.opacity = '0'; mask.style.transition = 'opacity .15s';
      setTimeout(() => {
        mask.remove();
        if (prevFocus && prevFocus.isConnected) { try { prevFocus.focus(); } catch { /* ignore */ } }
        if (typeof opts.onClosed === 'function') opts.onClosed();
      }, 160);
    };
    api.close = close;
    function onKey(e) {
      if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === api) close();
      // R5[W3]：Tab 焦点圈闭——aria-modal=true 语义下物理 Tab 仍可走出 dialog
      // 操作被遮罩盖住的背景元素；这里把 Tab 循环限制在 sheet 内可聚焦元素之间
      if (e.key === 'Tab' && sheetStack[sheetStack.length - 1] === api) {
        const focusables = [...mask.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
          .filter((n) => !n.disabled && n.offsetParent !== null);
        if (!focusables.length) return;
        e.preventDefault();
        const i = focusables.indexOf(document.activeElement);
        const next = e.shiftKey
          ? focusables[(i - 1 + focusables.length) % focusables.length]
          : focusables[(i + 1) % focusables.length];
        next.focus();
      }
    }
    if (!opts.locked) {
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      document.addEventListener('keydown', onKey);
    }
    if (opts.cancel) {
      const bar = document.createElement('div');
      bar.className = 'sheet-cancel';
      bar.innerHTML = '<button class="btn plain block" data-sheet-cancel>取消</button>';
      mask.querySelector('.sheet-body').appendChild(bar);
      bar.querySelector('[data-sheet-cancel]').onclick = () => close();
    }
    document.body.appendChild(mask);
    sheetStack.push(api);
    // 打开即移焦：sheet 内第一个可聚焦元素；没有则聚焦 sheet 容器本身（tabindex=-1）
    const first = mask.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first || mask.querySelector('.modal-sheet')).focus();
    return api;
  }

  // ---------- 确认框 ----------
  // U4：Esc / 遮罩点击关闭视为"取消"（onClosed 兜底），Promise 不再悬挂
  function confirm(msg, { okText = '确定', cancelText = '取消', danger = false } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const s = sheet('', `
        <div style="text-align:center; padding: 6px 10px 4px; font-size:15.5px; line-height:1.6;">${msg}</div>
        <div style="display:flex; gap:10px; margin-top:18px;">
          <button class="btn plain block" data-act="no" style="flex:1">${cancelText}</button>
          <button class="btn block ${danger ? 'danger' : 'primary'}" data-act="yes" style="flex:1">${okText}</button>
        </div>`, { onClosed: () => done(false) });
      s.el.addEventListener('click', (e) => {
        const act = e.target?.dataset?.act;
        if (act) { done(act === 'yes'); s.close(); }
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

  /* ---------- R5 时间语义（review-time-r5）：meet_at 结构化展示 ----------
   * meetText(p)：卡片/列表用的时间文案。p.meet_at（epoch ms）存在时输出
   * 结构化日期（"10/28 周六 11:30"，设备本地时区），否则回退 meet_time 原文——
   * 老帖/BE 未返回 meet_at 时零影响。返回已转义的安全文本。 */
  function meetText(p) {
    if (!p?.meet_at) return esc(p?.meet_time || '');
    const d = new Date(p.meet_at);
    const week = '周' + '日一二三四五六'[d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()} ${week} ${hhmm(p.meet_at)}`;
  }

  // dayLabel(ts)：聊天气泡流的日期分隔条文案——今天 / 昨天 / M月D日（按设备本地日历日）
  function dayLabel(ts) {
    const d = new Date(ts);
    const t = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, t)) return '今天';
    if (sameDay(d, new Date(t.getTime() - 86400000))) return '昨天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // dayKey(ts)：日历日稳定键（跨天判断用，避免每次拼接 label 比较）
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  // ---------- 头像（PC-04）：<img> 带 onerror 三级降级，防死循环 ----------
  // 降级链：photo-{n}.jpg（真人照）、u{n}.svg（C5 旧资产，按序号推导）、字母头像 div
  function avatarImg(src, nickname = '?') {
    const m = String(src || '').match(/photo-(\d+)\.jpg$/);
    const ch = esc(String(nickname || '?').trim().charAt(0) || '?');
    const toLetter = `this.onerror=null;var d=document.createElement('div');d.className='avatar';d.textContent='${ch}';this.replaceWith(d);`;
    const js = m
      ? `if(!this.dataset.f){this.dataset.f=1;this.src='/img/avatars/u${m[1]}.svg';}else{${toLetter}}`
      : toLetter;
    return `<img src="${esc(src)}" alt="" onerror="${esc(js)}">`;
  }

  function avatarHTML(user, size = '') {
    if (user?.avatar) return `<div class="avatar ${size}">${avatarImg(user.avatar, user?.nickname)}</div>`;
    const ch = (user?.nickname || '?').trim().charAt(0) || '?';
    return `<div class="avatar ${size}">${esc(ch)}</div>`;
  }

  // ---------- H6 帖子图片兜底：与头像同标准的三级降级 ----------
  // 降级链：原 src（/img/photos/... 或 /uploads/...）404 → 分类封面 /img/covers/{category}.svg →
  // 隐藏 img、插入渐变占位块（.img-ph，含分类线性图标）。
  // 返回可直接内嵌到 onerror="..." 的内联处理器字符串（data.fb 标记阶段，防死循环）。
  function imgFallback(category) {
    const cat = CAT_ICONS[category] ? category : 'other';
    // SVG 属性内的双引号转义为 &quot;：HTML 解码后成为合法 JS 字符串内容
    const iconSvg = catIcon(cat, 30).replace(/"/g, '&quot;');
    return `if(!this.dataset.fb){this.dataset.fb=1;this.src='/img/covers/${cat}.svg';}`
      + `else{this.onerror=null;this.style.display='none';`
      + `this.insertAdjacentHTML('afterend','<div class=&quot;img-ph&quot;>${iconSvg}</div>');}`;
  }

  // EM-10 性别符号文字化：性别符号改为纯文字 tag（女/男）
  function genderBadge(g) {
    if (g === 'female') return '<span class="gbadge">女</span>';
    if (g === 'male') return '<span class="gbadge">男</span>';
    return '';
  }

  function creditLabel(credit) {
    if (credit >= 750) return { text: '搭力·传奇', cls: 'blue' };
    if (credit >= 650) return { text: `搭力 ${credit}`, cls: 'green' };
    if (credit >= 450) return { text: `搭力 ${credit}`, cls: 'yellow' };
    return { text: `搭力 ${credit}`, cls: 'gray' };
  }

  // EM-04 空状态：第一参为图标名（线性 SVG），72px 圆底；alert-circle 为错误态（danger 变体）
  function empty(iconName, title, sub) {
    const danger = iconName === 'alert-circle';
    return `<div class="empty${danger ? ' danger' : ''}"><div class="e-icon">${icon(iconName, 44)}</div><div class="e-title">${esc(title)}</div><div style="font-size:13px">${esc(sub || '')}</div></div>`;
  }

  function loading(text = '加载中...') {
    return `<div class="loading">${esc(text)}</div>`;
  }

  const requireLogin = () => {
    UI.toast('请先登录');
    location.hash = '#/login';
    return false;
  };

  // ---------- 线性 SVG 图标库（H5-04，Feather Icons MIT 风格） ----------
  // 24×24 stroke 图标，颜色随 color 继承；heartFill / logo 为填充型特例。
  const ICON_PATHS = {
    'compass': '<circle cx="12" cy="12" r="10"/><path d="M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z"/>',
    'star': '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01z"/>',
    'plus-square': '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
    'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    'share': '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4M12 2v13"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
    'more-horizontal': '<circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="12" r="1.6"/>',
    'send': '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    'comment': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'location': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'people': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'edit': '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    // ---------- EM-01 新增 20 个通用图标（G.2 表，唯一实现依据） ----------
    'folder': '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'smartphone': '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    'slash': '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
    'flag': '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'check': '<polyline points="20 6 9 17 4 12"/>',
    'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    'info': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    'camera': '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'phone-call': '<path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
    'graduation-cap': '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    'bar-chart-2': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    // ---------- EM-02 分类图标（12 个 + book-open/camera 与通用表共用） ----------
    'utensils': '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    'mountain': '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    'mic': '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    'gamepad': '<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    'film': '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    'paw': '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    'coffee': '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    'shopping-bag': '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    'dice': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="12" cy="12" r="1"/>',
    'car': '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    'tag': '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  };
  // EM-02：分类 key 映射图标名（与 server/src/util.js CATEGORIES.icon 同表；study=book-open、photo=camera 与通用表共用）
  const CAT_ICONS = {
    food: 'utensils', sports: 'activity', study: 'book-open', travel: 'mountain',
    live: 'mic', game: 'gamepad', movie: 'film', photo: 'camera', pet: 'paw',
    coffee: 'coffee', shopping: 'shopping-bag', boardgame: 'dice', commute: 'car', other: 'tag',
  };
  // 别名：TabBar 语义名 与 规格书图标名互映射
  const ICON_ALIASES = {
    home: 'compass', discover: 'star', plus: 'plus-square', chat: 'message-circle',
    me: 'user', back: 'chevron-left', more: 'more-horizontal', heartFill: 'heart',
  };
  // 品牌logo：橙色填充握手/搭手抽象形（与 img/logo.svg 同稿）
  const LOGO_SVG = '<rect width="240" height="240" rx="56" fill="url(#dada-lg)"/>'
    + '<circle cx="38" cy="44" r="52" fill="#fff" opacity=".14"/><circle cx="206" cy="200" r="64" fill="#fff" opacity=".10"/><circle cx="198" cy="36" r="18" fill="#fff" opacity=".18"/>'
    + '<g fill="#fff"><rect x="20" y="102" width="88" height="50" rx="25" transform="rotate(-14 64 127)"/><rect x="132" y="102" width="88" height="50" rx="25" transform="rotate(14 176 127)"/></g>'
    + '<g stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"><path d="M120 84V64"/><path d="M92 76 82 60"/><path d="M148 76l10-16"/></g>';

  // fill：EM-12 星评等实心态（fill="currentColor"）；与 heartFill 别名等价
  function icon(name, size = 24, cls = '', fill = false) {
    if (name === 'logo') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 240 240" class="${cls}" aria-hidden="true"><defs><linearGradient id="dada-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A5C"/><stop offset=".55" stop-color="#FF7A45"/><stop offset="1" stop-color="#F05A24"/></linearGradient></defs>${LOGO_SVG}</svg>`;
    }
    const key = ICON_ALIASES[name] || name;
    const body = ICON_PATHS[key];
    if (!body) return '';
    const isFill = fill || name === 'heartFill';
    const common = `xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" class="${cls}" aria-hidden="true"`;
    return isFill
      ? `<svg ${common} fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
      : `<svg ${common} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  // 分类图标快捷入口（EM-02）：UI.catIcon(categoryKey, size)
  const catIcon = (categoryKey, size = 24, cls = '') => icon(CAT_ICONS[categoryKey] || 'tag', size, cls);

  // EM-12 星评组件：starRow(stars, size) 返回 5 颗 SVG 星（前 stars 颗实心，色彩 --warning）
  function starRow(stars = 5, size = 15) {
    const n = Math.max(0, Math.min(5, Math.round(stars) || 0));
    return `<span class="star-row">${Array.from({ length: 5 }, (_, i) => icon('star', size, '', i < n)).join('')}</span>`;
  }

  // ---------- 封面/宽高比兜底（BE-05 联调契约 + PC-03 三级兜底：与后端 coverFields 同公式） ----------
  // cover 兜底链：p.cover、images[0]、分类实拍照 /img/photos/{category}-{id%N+1}.jpg、旧 SVG（C5 终兜底）
  const ASPECTS = ['3:4', '1:1', '4:3'];
  // 每分类实拍照片数（与 server/src/routes/posts.js PHOTO_N 同步）
  const PHOTO_N = { food: 3, sports: 3, study: 2, travel: 3, live: 3, game: 3, movie: 2,
                    photo: 2, pet: 3, coffee: 3, shopping: 2, boardgame: 3, commute: 3, other: 2 };
  const coverOf = (p) => p.cover || p.images?.[0]
    || (PHOTO_N[p.category] ? `/img/photos/${p.category}-${(p.id % PHOTO_N[p.category]) + 1}.jpg` : null)
    || `/img/covers/${p.category}${p.id % 2 ? '-2' : ''}.svg`;
  const aspectOf = (p) => p.aspect || ASPECTS[p.id % 3];

  // ---------- 瀑布流卡片（H5-07）：大图封面 + 2行标题 + 作者行 ----------
  // opts.reason：推荐理由 pill（发现页，封面左下角）；opts.history：搭子履历态（无作者行，显示完成态）
  function pinCard(p, opts = {}) {
    const ar = (aspectOf(p) || '3:4').replace(':', ' / ');
    const hasImg = !!(p.cover || p.images?.length);
    const flags = [];
    if (!opts.history && p.status) {
      const m = {
        open: ['招募中', 'recruit'], full: ['已满员', 'full'], closed: ['已关闭', 'full'],
        done: ['已完成', 'full'], expired: ['已过期', 'full'],
      }[p.status];
      if (m) flags.push(`<span class="pin-flag tl ${m[1]}">${m[0]}</span>`);
    }
    if (!opts.history && p.gender_req && p.gender_req !== 'any') {
      flags.push(`<span class="pin-flag tr">${p.gender_req === 'female' ? '仅限女生' : '仅限男生'}</span>`);
    }
    if (opts.reason) flags.push(`<span class="pin-flag bl">${esc(opts.reason)}</span>`);

    const bits = [];
    if (p.city) bits.push(`${icon('location', 11)}<span>${esc(p.city)}</span>`);
    // R5 时间语义：meet_at 存在时显示结构化日期（如"10/28 周六 11:30"），否则回退 meet_time 原文
    const meetTxt = meetText(p);
    if (meetTxt) bits.push(`${icon('clock', 11)}<span>${meetTxt}</span>`);
    // H7：满员帖不再显示"还缺 0 人"，改为灰色"已满员"pill
    if (typeof p.need_count === 'number') {
      const lack = Math.max(0, p.need_count - (p.approved_count || 0));
      if (p.status === 'full') bits.push('<span class="pill gray pin-full-pill">已满员</span>');
      else bits.push(`<span>还缺 ${lack} 人</span>`);
    }
    const meta = bits.length ? `<div class="pin-meta">${bits.join('<span style="opacity:.55">·</span>')}</div>` : '';

    let foot;
    if (opts.history) {
      foot = `<span class="pin-name">${esc(p.meet_time || '')}</span><span class="pin-like">${icon('check', 12)}<span>已完成</span></span>`;
    } else {
      const nick = p.author?.nickname || '搭友';
      const avatar = p.author?.avatar
        ? `<span class="pin-avatar">${avatarImg(p.author.avatar, nick)}</span>`
        : `<span class="pin-avatar">${esc(nick.charAt(0))}</span>`;
      const liked = !!p.liked;
      foot = `${avatar}<span class="pin-name">${esc(nick)}</span>`
        + `<span class="pin-like${liked ? ' liked' : ''}">${icon(liked ? 'heartFill' : 'heart', 13)}<span>${p.likes_count || 0}</span></span>`;
    }

    return `
    <div class="wf-item"><div class="pin-card${p.status === 'full' ? ' is-full' : ''}" data-id="${p.id}" role="link" tabindex="0" aria-label="${esc(p.title)}" onkeydown="if(event.key==='Enter')App.navigate('#/post/${p.id}')">
      <div class="pin-cover" style="--ar:${ar}">
        ${hasImg ? `<img src="${esc(coverOf(p))}" loading="lazy" alt="" onerror="${imgFallback(p.category)}">` : `<div class="pin-emoji">${catIcon(p.category, 28)}</div>`}
        ${flags.join('')}
      </div>
      <div class="pin-body">
        <div class="pin-title">${esc(p.title)}</div>
        ${meta}
        <div class="pin-foot">${foot}</div>
      </div>
    </div></div>`;
  }

  // 瀑布流骨架屏（shimmer 占位）
  function wfSkeleton(n = 6) {
    const hs = [300, 236, 268, 210, 288, 246, 320, 224];
    return `<div class="wf">${Array.from({ length: n }, (_, i) => `<div class="wf-item"><div class="skeleton" style="height:${hs[i % hs.length]}px"></div></div>`).join('')}</div>`;
  }

  return { toast, sheet, confirm, esc, timeAgo, hhmm, meetText, dayLabel, dayKey, avatarImg, avatarHTML, imgFallback, genderBadge, creditLabel, empty, loading, requireLogin, icon, catIcon, CAT_ICONS, starRow, coverOf, aspectOf, pinCard, wfSkeleton };
})();
