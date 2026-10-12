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

  // ---------- 头像（PC-04）：<img> 带 onerror 三级降级，防死循环 ----------
  // 降级链：photo-{n}.jpg（真人照）→ u{n}.svg（C5 旧资产，按序号推导）→ 字母头像 div
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
  };
  // 别名：TabBar 语义名 ↔ 规格书图标名
  const ICON_ALIASES = {
    home: 'compass', discover: 'star', plus: 'plus-square', chat: 'message-circle',
    me: 'user', back: 'chevron-left', more: 'more-horizontal', heartFill: 'heart',
  };
  // 品牌logo：橙色填充握手/搭手抽象形（与 img/logo.svg 同稿）
  const LOGO_SVG = '<rect width="240" height="240" rx="56" fill="url(#dada-lg)"/>'
    + '<circle cx="38" cy="44" r="52" fill="#fff" opacity=".14"/><circle cx="206" cy="200" r="64" fill="#fff" opacity=".10"/><circle cx="198" cy="36" r="18" fill="#fff" opacity=".18"/>'
    + '<g fill="#fff"><rect x="20" y="102" width="88" height="50" rx="25" transform="rotate(-14 64 127)"/><rect x="132" y="102" width="88" height="50" rx="25" transform="rotate(14 176 127)"/></g>'
    + '<g stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"><path d="M120 84V64"/><path d="M92 76 82 60"/><path d="M148 76l10-16"/></g>';

  function icon(name, size = 24, cls = '') {
    if (name === 'logo') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 240 240" class="${cls}" aria-hidden="true"><defs><linearGradient id="dada-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A5C"/><stop offset=".55" stop-color="#FF7A45"/><stop offset="1" stop-color="#F05A24"/></linearGradient></defs>${LOGO_SVG}</svg>`;
    }
    const key = ICON_ALIASES[name] || name;
    const body = ICON_PATHS[key];
    if (!body) return '';
    const isFill = name === 'heartFill';
    const common = `xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" class="${cls}" aria-hidden="true"`;
    return isFill
      ? `<svg ${common} fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
      : `<svg ${common} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  // ---------- 封面/宽高比兜底（BE-05 联调契约 + PC-03 三级兜底：与后端 coverFields 同公式） ----------
  // cover 兜底链：p.cover → images[0] → 分类实拍照 /img/photos/{category}-{id%N+1}.jpg → 旧 SVG（C5 终兜底）
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
      flags.push(`<span class="pin-flag tr">${p.gender_req === 'female' ? '♀ 仅限女生' : '♂ 仅限男生'}</span>`);
    }
    if (opts.reason) flags.push(`<span class="pin-flag bl">${esc(opts.reason)}</span>`);

    const bits = [];
    if (p.city) bits.push(`${icon('location', 11)}<span>${esc(p.city)}</span>`);
    if (p.meet_time) bits.push(`${icon('clock', 11)}<span>${esc(p.meet_time)}</span>`);
    if (typeof p.need_count === 'number') bits.push(`<span>还缺 ${Math.max(0, p.need_count - (p.approved_count || 0))} 人</span>`);
    const meta = bits.length ? `<div class="pin-meta">${bits.join('<span style="opacity:.55">·</span>')}</div>` : '';

    let foot;
    if (opts.history) {
      foot = `<span class="pin-name">${esc(p.meet_time || '')}</span><span class="pin-like">已完成 ✅</span>`;
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
    <div class="wf-item"><div class="pin-card" data-id="${p.id}">
      <div class="pin-cover" style="--ar:${ar}">
        ${hasImg ? `<img src="${esc(coverOf(p))}" loading="lazy" alt="">` : `<div class="pin-emoji">${p.category_emoji || '✨'}</div>`}
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

  return { toast, sheet, confirm, esc, timeAgo, hhmm, avatarImg, avatarHTML, genderBadge, creditLabel, empty, loading, requireLogin, icon, coverOf, aspectOf, pinCard, wfSkeleton };
})();
