/* ================= 搭搭 App 主路由 ================= */
const App = (() => {
  const container = document.getElementById('page-container');
  const tabbar = document.getElementById('tabbar');
  const routes = {};
  let currentTab = '';
  let metaCache = null;

  function register(name, render) { routes[name] = render; }

  async function meta() {
    if (!metaCache) metaCache = await API.get('/meta');
    return metaCache;
  }

  function navigate(hash) { location.hash = hash; }

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    tabbar.classList.remove('hidden');
  }

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

  async function render() {
    const hash = location.hash || '#/';
    const [, path] = hash.split('#/');
    const seg = (path || '').split('?')[0].split('/').filter(Boolean);
    const page = seg[0] || 'square';

    // 权限控制
    const privatePages = ['publish', 'chat', 'me', 'notifications', 'myposts', 'settings', 'admin'];
    if (privatePages.includes(page) && !API.isLogin()) {
      UI.toast('请先登录');
      location.hash = '#/login';
      return;
    }

    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'page';
    container.appendChild(el);

    const isTabPage = ['square', 'discover', 'chat', 'me'].includes(page);
    if (isTabPage) showTab(page); else hideTabbar();

    try {
      await routes[page]?.(el, seg.slice(1), new URLSearchParams((path || '').split('?')[1] || ''));
    } catch (err) {
      console.error(err);
      el.innerHTML = UI.empty('😵', '页面出错了', err.message || '请稍后再试');
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

  return { register, navigate, meta, refreshBadges, showTab, hideTabbar, get currentTab() { return currentTab; } };
})();
