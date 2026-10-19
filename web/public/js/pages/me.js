/* ================= 我的页面（v2 · 对标小红书个人主页） ================= */
App.register('me', async (el) => {
  const me = await API.get('/auth/me');
  window.__me = me;
  const c = UI.creditLabel(me.credit);
  const pct = Math.min(100, Math.round(((me.credit - 300) / 500) * 100));

  // FE-A 契约图标（未落地时静默降级为空字符串，页面不报错）
  const ic = (name, size = 24) => (typeof UI.icon === 'function' ? UI.icon(name, size) : '');

  // 与 BE-02/BE-05 相同的确定性兜底规则（接口新字段未上线时同样不出错）
  const coverOf = (p) => p.cover || (p.images || [])[0] || `/img/covers/${p.category}${p.id % 2 ? '-2' : ''}.svg`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const statusPill = (p) => {
    if (p.my_join) {
      const map = { pending: ['申请中', 'yellow'], approved: ['已通过', 'green'], rejected: ['未通过', 'gray'] };
      return map[p.my_join] || ['已报名', 'gray'];
    }
    return { open: ['招募中', 'green'], full: ['已满员', 'gray'], done: ['已完成', 'blue'], closed: ['已关闭', 'gray'] }[p.status] || ['未知', 'gray'];
  };

  el.innerHTML = `
  <div class="me2-hero">
    <div class="me2-toprow">
      <button class="me2-edit" id="btn-edit">编辑资料 ${ic('more', 14)}</button>
    </div>
    <div class="me2-user">
      <div class="me2-avatar">${UI.avatarHTML(me)}</div>
      <div class="me2-usermain">
        <div class="me2-nick">
          ${esc(me.nickname)} ${UI.genderBadge(me.gender)}
          ${me.verify_real ? '<span class="me2-chip blue">已真人认证</span>' : ''}
          ${me.verify_student ? '<span class="me2-chip">学生认证</span>' : ''}
        </div>
        <div class="me2-uid">搭搭号：${esc(me.username || '—')} <span class="copy">复制</span></div>
        <div class="me2-bio">${me.bio ? esc(me.bio) : (me.city ? `${ic('location', 12)} ${esc(me.city)}` : '还没写简介，点右上角编辑资料')}</div>
        <div class="me2-chips">
          ${me.mbti ? `<span class="me2-chip">${esc(me.mbti)}</span>` : ''}
          ${(me.tags || []).slice(0, 4).map((t) => `<span class="me2-chip">${esc(t)}</span>`).join('')}
          ${me.rating_avg != null ? `<span class="me2-chip">${ic('star', 11)} 搭后评分 ${me.rating_avg}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="me2-stats">
      <div class="me2-stat"><b id="stat-published">${me.post_count}</b><span>发布</span></div>
      <div class="me2-stat"><b>${me.joined_count || 0}</b><span>参加</span></div>
      <div class="me2-stat"><b id="stat-likes">—</b><span>获赞</span></div>
    </div>
  </div>

  <div class="me2-credit">
    <div class="credit-ring" style="--p:${pct}; position:relative;"><span>${me.credit}</span></div>
    <div style="flex:1;">
      <div style="font-weight:800; font-size:15px;">搭力值 <span class="pill ${c.cls}">${c.text}</span></div>
      <div style="font-size:12px; color:var(--text-3); margin-top:2px; line-height:1.5;">
        ${me.credit < 300 ? '<span style="color:var(--danger);">搭力值不足 300，暂不能发布新搭局</span>' : '认证、完成搭局、获得好评都能涨分'}
      </div>
    </div>
    <button class="btn ghost sm" id="btn-verify">去认证</button>
  </div>

  <div class="me2-tabs">
    <button class="me2-tab active" data-t="published">发布的搭局</button>
    <button class="me2-tab" data-t="joined">参加的</button>
  </div>
  <div class="me2-grid" id="me-grid">${UI.loading()}</div>

  <div class="me2-entries">
    <div class="cell" id="c-myposts"><span class="cell-icon">${ic('folder', 18)}</span><span class="cell-main">我的搭局</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-partners"><span class="cell-icon">${ic('people', 18)}</span><span class="cell-main">我的搭友<span class="cell-sub">互评后自动沉淀的搭子关系</span></span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-ratings"><span class="cell-icon">${ic('star', 18)}</span><span class="cell-main">收到的评价</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-safety"><span class="cell-icon">${ic('shield', 18)}</span><span class="cell-main">安全中心</span><span class="cell-arrow">›</span></div>
    ${me.is_admin ? `<div class="cell" id="c-admin"><span class="cell-icon">${ic('bar-chart-2', 18)}</span><span class="cell-main">运营后台</span><span class="pill blue">管理员</span><span class="cell-arrow">›</span></div>` : ''}
    <div class="cell" id="c-settings"><span class="cell-icon">${ic('settings', 18)}</span><span class="cell-main">设置</span><span class="cell-arrow">›</span></div>
  </div>

  <div style="text-align:center; color:var(--text-3); font-size:11.5px; padding-bottom:8px;">搭搭 v2.0 · 轻社交 · 不婚恋 · 有边界</div>`;

  el.querySelector('#btn-edit').onclick = () => App.navigate('#/edit-profile');
  el.querySelector('#btn-verify').onclick = openVerify;
  el.querySelector('#c-myposts').onclick = () => App.navigate('#/myposts');
  el.querySelector('#c-partners').onclick = () => App.navigate('#/partners');
  el.querySelector('#c-ratings').onclick = () => App.navigate('#/ratings');
  el.querySelector('#c-safety').onclick = () => App.navigate('#/safety');
  el.querySelector('#c-admin')?.addEventListener('click', () => App.navigate('#/admin'));
  el.querySelector('#c-settings').onclick = () => App.navigate('#/settings');

  // ---------- 内容网格：双 Tab + 三列方形网格 ----------
  const listBox = el.querySelector('#me-grid');
  const cache = {};
  let curTab = 'published';

  function cellHTML(p) {
    const [st, cls] = statusPill(p);
    const metaBits = [p.city, p.meet_time].filter(Boolean).map(esc).join(' · ');
    const likes = p.likes_count || 0;
    return `
    <div class="me2-cell" data-id="${p.id}">
      <div class="me2-cover">
        <img loading="lazy" src="${esc(coverOf(p))}" alt="" onerror="${UI.imgFallback(p.category)}">
        <span class="me2-cover-pill ${cls}">${st}</span>
      </div>
      <div class="me2-cell-title">${esc(p.title)}</div>
      ${metaBits ? `<div class="me2-cell-meta">${metaBits}</div>` : ''}
      <div class="me2-cell-foot${p.liked ? ' liked' : ''}">
        <span class="like-ico">${ic('heart', 14)}</span><b>${likes}</b>
        <span style="margin-left:auto;">${esc(p.category_name || '')}</span>
      </div>
    </div>`;
  }

  async function loadTab(tab) {
    curTab = tab;
    el.querySelectorAll('.me2-tab').forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
    if (cache[tab]) return render(tab);
    listBox.innerHTML = UI.loading();
    try {
      cache[tab] = await API.get(`/my/posts/${tab}`);
    } catch (err) {
      listBox.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
      return;
    }
    render(tab);
    // 获赞数 = 发布内容获赞合计（published 拉取后回填一次）
    if (tab === 'published') {
      const total = (cache.published || []).reduce((s, p) => s + (p.likes_count || 0), 0);
      const el2 = el.querySelector('#stat-likes');
      if (el2) el2.textContent = total;
    }
  }

  function render(tab) {
    const list = cache[tab] || [];
    if (!list.length) {
      listBox.innerHTML = UI.empty(
        'folder',
        tab === 'published' ? '还没有发布的搭局' : '还没有参加的搭局',
        tab === 'published' ? '点下方「发布」开一个局，等搭子来找你' : '去广场看看感兴趣的搭局，申请加入吧'
      );
      return;
    }
    listBox.innerHTML = list.map(cellHTML).join('');
    listBox.querySelectorAll('[data-id]').forEach((cell) => {
      cell.onclick = () => App.navigate('#/post/' + cell.dataset.id);
    });
  }

  el.querySelectorAll('.me2-tab').forEach((b) => {
    b.onclick = () => { if (b.dataset.t !== curTab) loadTab(b.dataset.t); };
  });

  loadTab('published');

  function openVerify() {
    const s = UI.sheet('提升信任度', `
      <div style="font-size:13px; color:var(--text-2); line-height:1.6; margin-bottom:14px;">
        认证能大幅提高成搭率：搭友更敢报名你的局，你也更容易通过别人的申请。
      </div>
      <button class="btn plain block" id="v-real" style="margin-bottom:10px; justify-content:flex-start; gap:10px;">
        <span style="display:flex;">${ic('user-check', 22)}</span>
        <span style="text-align:left;"><b>真人认证</b> <span class="pill green">+50 搭力值</span><br><span style="font-size:12px;color:var(--text-3)">演示环境一键通过（正式版走人脸核验）</span></span>
        ${me.verify_real ? '<span class="pill green">已通过</span>' : ''}
      </button>
      <button class="btn plain block" id="v-stu" style="justify-content:flex-start; gap:10px;">
        <span style="display:flex;">${ic('graduation-cap', 22)}</span>
        <span style="text-align:left;"><b>学生认证</b> <span class="pill green">+30 搭力值</span><br><span style="font-size:12px;color:var(--text-3)">填写学校名称（正式版验证学籍）</span></span>
        ${me.verify_student ? '<span class="pill green">已通过</span>' : ''}
      </button>`);
    s.el.querySelector('#v-real').onclick = async () => {
      if (me.verify_real) return UI.toast('已通过真人认证');
      try {
        await API.post('/users/me/verify', { type: 'real' });
        s.close(); UI.toast('真人认证通过，搭力值 +50');
        location.hash = '#/square';
        setTimeout(() => { location.hash = '#/me'; }, 60);
      } catch (err) { UI.toast(err.message); }
    };
    s.el.querySelector('#v-stu').onclick = async () => {
      if (me.verify_student) return UI.toast('已通过学生认证');
      const s2 = UI.sheet('学生认证', `
        <input id="f-school" class="input" placeholder="学校名称，如：北京大学">
        <button class="btn primary block" id="btn-go" style="margin-top:10px;">提交认证</button>`);
      s2.el.querySelector('#btn-go').onclick = async () => {
        const school = s2.el.querySelector('#f-school').value.trim();
        if (!school) return UI.toast('请填写学校名称');
        try {
          await API.post('/users/me/verify', { type: 'student', school });
          s2.close(); s.close();
          UI.toast('学生认证通过，搭力值 +30');
          setTimeout(() => { location.hash = '#/square'; setTimeout(() => { location.hash = '#/me'; }, 60); }, 60);
        } catch (err) { UI.toast(err.message); }
      };
    };
  }
});
