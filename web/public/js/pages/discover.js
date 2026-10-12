/* ================= 发现页（推荐+为你而设 · 瀑布流 H5-09） ================= */
App.register('discover', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner"><div class="navbar-title" style="text-align:left; font-size:20px; font-weight:800;">发现搭子</div></div>
  </div>
  <div id="feed">${UI.wfSkeleton(6)}</div>`;

  async function load() {
    const feed = el.querySelector('#feed');
    const parts = [];

    // 为你推荐（登录用户）
    if (API.isLogin()) {
      try {
        const fy = await API.get('/for-you');
        if (fy.list.length) {
          parts.push(`
            <div class="section-title">🎯 为你而设 <span class="pill">根据你的搭子偏好</span></div>
            <div class="wf">${fy.list.slice(0, 5).map((p) => UI.pinCard(p, { reason: p.reason })).join('')}</div>`);
        }
      } catch { /* ignore */ }
    }

    // 热门搭局
    const hot = await API.get('/recommend');
    parts.push(`
      <div class="section-title">🔥 本周热门搭局</div>
      ${hot.list.slice(0, 10).length
        ? `<div class="wf">${hot.list.slice(0, 10).map((p) => UI.pinCard(p, { reason: p.reason })).join('')}</div>`
        : UI.empty('🌱', '还没有热门搭局', '去广场发布第一个吧')}
      <div style="text-align:center; padding:16px; color:var(--text-3); font-size:12px;">
        搭搭 · 让每一次搭伙都靠谱<br>🤝 轻社交 · 不婚恋 · 有边界
      </div>`);

    feed.innerHTML = parts.join('');
    feed.querySelectorAll('.pin-card').forEach((c) => {
      c.onclick = () => App.navigate('#/post/' + c.dataset.id);
    });
  }

  await load();
});
