/* ================= 发现页（推荐+为你而设） ================= */
App.register('discover', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner"><div class="navbar-title" style="text-align:left; font-size:20px; font-weight:800;">发现搭子</div></div>
  </div>
  <div id="feed">${UI.loading()}</div>`;

  function card(p) {
    return `
    <div class="card post-card" data-id="${p.id}">
      <div class="post-emoji">${p.category_emoji || '✨'}</div>
      <div class="post-main">
        <div class="post-title">${UI.esc(p.title)}</div>
        <div class="post-meta">
          <span class="pill">📍 ${UI.esc(p.city)}</span>
          ${p.meet_time ? `<span class="pill yellow">🕐 ${UI.esc(p.meet_time)}</span>` : ''}
        </div>
        <div class="post-footer">
          <div class="post-author">
            ${UI.avatarHTML(p.author)}
            <span class="author-name">${UI.esc(p.author.nickname)}</span>
          </div>
          <span class="pill blue" style="flex-shrink:0;">${UI.esc(p.reason || '')}</span>
        </div>
      </div>
    </div>`;
  }

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
            ${fy.list.slice(0, 5).map(card).join('')}`);
        }
      } catch { /* ignore */ }
    }

    // 热门搭局
    const hot = await API.get('/recommend');
    parts.push(`
      <div class="section-title">🔥 本周热门搭局</div>
      ${hot.list.slice(0, 10).map(card).join('') || UI.empty('🌱', '还没有热门搭局', '去广场发布第一个吧')}
      <div style="text-align:center; padding:16px; color:var(--text-3); font-size:12px;">
        搭搭 · 让每一次搭伙都靠谱<br>🤝 轻社交 · 不婚恋 · 有边界
      </div>`);

    feed.innerHTML = parts.join('');
    feed.querySelectorAll('.post-card').forEach((c) => {
      c.onclick = () => App.navigate('#/post/' + c.dataset.id);
    });
  }

  await load();
});
