/* ================= 搭搭 App 主路由 ================= */
/* 原生壳标识：仅在 Capacitor WebView（server.url 加载）内为 true，浏览器恒为 false */
const IS_NATIVE_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

/* ================= 安卓返回键（H5 无感知，仅原生壳内注册） =================
 * 规则：子页面（详情/会话/登录后内页等）按返回 = hash 路由后退 history.back()；
 * 根页面（四个 tab / 登录页）视为栈底：2 秒内连按两次退出（toast 提示，App.exitApp()）。 */
(() => {
  if (!IS_NATIVE_APP) return;
  const NativeApp = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (!NativeApp || typeof NativeApp.addListener !== 'function') return;

  const ROOT_PAGES = ['square', 'discover', 'chat', 'me', 'login'];
  let backDepth = 0;   // 本次会话内可回退的 hash 历史深度
  let suppress = false; // 本次 hashchange 是否由返回键的 history.back() 触发
  let lastBackAt = 0;   // 栈底上次按返回键时间（双击退出计时）

  const currentPage = () => {
    const path = (location.hash.split('#/')[1] || '').split('?')[0];
    return path.split('/').filter(Boolean)[0] || 'square';
  };

  window.addEventListener('hashchange', () => {
    if (suppress) { suppress = false; return; }
    backDepth++;
  });

  NativeApp.addListener('backButton', () => {
    const now = Date.now();
    if (backDepth > 0 && !ROOT_PAGES.includes(currentPage())) {
      suppress = true;          // 不计入前进深度
      backDepth--;
      history.back();
      return;
    }
    // 栈底：双击退出
    if (now - lastBackAt < 2000) NativeApp.exitApp();
    else { lastBackAt = now; UI.toast('再按一次退出'); }
  });
})();

const App = (() => {
  const container = document.getElementById('page-container');
  const tabbar = document.getElementById('tabbar');
  const routes = {};
  let currentTab = '';
  let metaCache = null;

  // ---------- H1 页级清理机制 ----------
  // 页面通过 App.onCleanup(fn) 注册卸载回调（WS.off、定时器、全局监听等），
  // render() 替换 container.innerHTML 之前依次执行并清空。
  // 替代原先依赖 DOMNodeRemoved 的卸载方案（Chrome 对 innerHTML 替换不派发该事件，
  // 导致 WS 回调永不卸载、错误 toast 无限叠加、死 handler 重复请求）。
  const cleanupFns = [];
  function onCleanup(fn) { if (typeof fn === 'function') cleanupFns.push(fn); }
  function runCleanup() {
    while (cleanupFns.length) {
      try { cleanupFns.shift()(); } catch (err) { console.error('[cleanup]', err); }
    }
  }

  function register(name, render) { routes[name] = render; }

  async function meta() {
    if (!metaCache) metaCache = await API.get('/meta');
    return metaCache;
  }

  function navigate(hash) { location.hash = hash; }

  // H13 侧栏选中态：仅更新高亮，不动 tabbar 显隐
  function setActiveTab(tab) {
    currentTab = tab || '';
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', !!tab && el.dataset.tab === tab));
  }

  function showTab(tab) {
    setActiveTab(tab);
    tabbar.classList.remove('hidden');
  }

  // 非 tab 页：清除残留高亮（桌面侧栏常驻，广场高亮不应保留在详情/会话等页）
  function hideTabbar() { tabbar.classList.add('hidden'); }

  function setBadge(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) { el.textContent = n > 99 ? '99+' : n; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }

  async function refreshBadges() {
    if (!API.isLogin()) { setBadge('chat-badge', 0); setBadge('me-badge', 0); return; }
    try {
      const me = await API.get('/auth/me');
      setBadge('me-badge', me.unread_notif);
      setBadge('chat-badge', me.unread_chat);
      window.__me = me;
    } catch { /* 401 已由 api 层处理 */ }
  }

  // H8/H10：404 类业务错误（后端明确"不存在/无权"）渲染友好提示页：
  // 保留顶栏 + 主行动按钮，不使用红色"页面出错了"报错态
  function notFound(el, { sub = '', primary = { text: '返回广场', hash: '#/square' }, secondary = null } = {}) {
    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" onclick="history.back()">‹</button>
        <div class="navbar-title">内容不存在</div>
        <div style="width:34px;"></div>
      </div>
    </div>
    <div class="empty" style="padding-top:88px;">
      <div class="e-icon">${UI.icon('search', 44)}</div>
      <div class="e-title">内容不存在或已结束</div>
      ${sub ? `<div style="font-size:13px">${UI.esc(sub)}</div>` : ''}
      <div style="display:flex; gap:10px; justify-content:center; margin-top:18px;">
        <button class="btn primary" id="nf-go" style="min-width:132px;">${UI.esc(primary.text)}</button>
        ${secondary ? `<button class="btn plain" id="nf-alt" style="min-width:110px;">${UI.esc(secondary.text)}</button>` : ''}
      </div>
    </div>`;
    el.querySelector('#nf-go').onclick = () => navigate(primary.hash);
    el.querySelector('#nf-alt')?.addEventListener('click', () => navigate(secondary.hash));
  }

  const NOT_FOUND_RE = /不存在|无权|已删除|已注销/;

  async function render() {
    const hash = location.hash || '#/';
    const [, path] = hash.split('#/');
    const seg = (path || '').split('?')[0].split('/').filter(Boolean);
    const page = seg[0] || 'square';

    // 权限控制
    const privatePages = ['publish', 'chat', 'me', 'notifications', 'myposts', 'settings', 'partners', 'admin'];
    if (privatePages.includes(page) && !API.isLogin()) {
      UI.toast('请先登录');
      location.hash = '#/login';
      return;
    }

    // 页面标记：桌面端样式（desktop.css）按 body[data-page] 精准生效
    document.body.dataset.page = page;

    // H1：替换容器前先执行上一页注册的卸载回调（WS.off 等）
    runCleanup();
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'page';
    container.appendChild(el);

    // H13：tab 页高亮自己；发布页高亮发布 tab；其余非 tab 页清空高亮（移动端仍隐藏底栏）
    const isTabPage = ['square', 'discover', 'chat', 'me'].includes(page);
    if (isTabPage) showTab(page);
    else {
      setActiveTab(page === 'publish' ? 'publish' : '');
      hideTabbar();
    }

    try {
      await routes[page]?.(el, seg.slice(1), new URLSearchParams((path || '').split('?')[1] || ''));
    } catch (err) {
      console.error(err);
      const msg = err?.message || '';
      if (NOT_FOUND_RE.test(msg)) notFound(el, { sub: msg });
      else el.innerHTML = UI.empty('alert-circle', '页面出错了', msg || '请稍后再试');
    }
    refreshBadges();
  }

  // Tab 切换
  tabbar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (tab.dataset.tab === 'publish') {
      if (!API.isLogin()) return UI.requireLogin();
      navigate('#/publish');
      return;
    }
    navigate(`#/${tab.dataset.tab}`);
  });

  // 实时消息角标
  WS.on('chat', () => {
    if (currentTab !== 'chat') refreshBadges();
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', () => {
    if (API.isLogin()) WS.connect();
    render();
  });

  /* ================= PWA（APP-02 / APP-03） ================= */

  // Service Worker：仅 https 或 localhost 注册，避免 http://局域网IP 下报错；
  // Capacitor 原生壳内无意义（页面来自 server.url，无需离线缓存），同样跳过
  if (!IS_NATIVE_APP
    && 'serviceWorker' in navigator
    && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 注册失败不影响功能 */ });
  }

  // 安装横幅：捕获 beforeinstallprompt，延迟展示；可关闭并记忆（localStorage）
  // 原生壳内不显示（已是安装态）
  const PWA_DISMISS_KEY = 'dada_pwa_dismissed';
  (() => {
    if (IS_NATIVE_APP) return;
    let deferredPrompt = null;
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      // 延迟 2.5s 展示，避免打断首屏
      setTimeout(() => {
        if (!deferredPrompt || standalone()) return;
        if (localStorage.getItem(PWA_DISMISS_KEY) === '1') return;
        showBanner();
      }, 2500);
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      hideBanner();
    });

    function showBanner() {
      if (document.getElementById('pwa-banner')) return;
      const b = document.createElement('div');
      b.id = 'pwa-banner';
      b.innerHTML = `
        <div class="pwa-banner-logo">${UI.icon('logo', 40)}</div>
        <div class="pwa-banner-main">
          <div class="pwa-banner-title">安装搭搭到桌面</div>
          <div class="pwa-banner-sub">下次一键直达，找搭子更快一步</div>
        </div>
        <button class="pwa-banner-btn" id="pwa-install">安装</button>
        <button class="pwa-banner-close" id="pwa-close" aria-label="关闭">${UI.icon('x', 16)}</button>`;
      document.body.appendChild(b);
      requestAnimationFrame(() => b.classList.add('show'));
      // 底栏隐藏的页面（详情/会话等），横幅贴底展示
      const tabbar = document.getElementById('tabbar');
      if (tabbar?.classList.contains('hidden')) b.classList.add('low');
      b.querySelector('#pwa-install').onclick = async () => {
        b.classList.remove('show');
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch { /* 用户关闭 */ }
        deferredPrompt = null;
      };
      b.querySelector('#pwa-close').onclick = () => {
        localStorage.setItem(PWA_DISMISS_KEY, '1');
        hideBanner();
      };
    }

    function hideBanner() {
      const b = document.getElementById('pwa-banner');
      if (!b) return;
      b.classList.remove('show');
      setTimeout(() => b.remove(), 300);
    }
  })();

  return { register, navigate, meta, refreshBadges, showTab, hideTabbar, onCleanup, notFound, get currentTab() { return currentTab; } };
})();
