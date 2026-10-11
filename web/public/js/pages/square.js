/* ================= 广场页（搭局列表） ================= */
App.register('square', async (el, _seg, query) => {
  const meta = await App.meta();
  const state = {
    city: query.get('city') || '',
    category: query.get('category') || '',
    keyword: '',
    sort: 'new',
  };

  async function fetchList() {
    const params = new URLSearchParams();
    if (state.city) params.set('city', state.city);
    if (state.category) params.set('category', state.category);
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.sort === 'hot') params.set('sort', 'hot');
    params.set('size', '30');
    return API.get('/posts?' + params.toString());
  }

  function postCard(p) {
    const c = UI.creditLabel(p.author.credit);
    return `
    <div class="card post-card" data-id="${p.id}">
      <div class="post-emoji">${p.category_emoji}</div>
      <div class="post-main">
        <div style="display:flex; align-items:flex-start; gap:6px;">
          <div class="post-title" style="flex:1">${UI.esc(p.title)}</div>
          ${p.status === 'full' ? '<span class="pill gray" style="flex-shrink:0">已满员</span>' : '<span class="pill green" style="flex-shrink:0">招募中</span>'}
        </div>
        <div class="post-meta">
          <span class="pill">📍 ${UI.esc(p.city)}</span>
          ${p.meet_time ? `<span class="pill yellow">🕐 ${UI.esc(p.meet_time)}</span>` : ''}
          ${p.gender_req !== 'any' ? `<span class="pill ${p.gender_req === 'female' ? 'blue' : ''}">${p.gender_req === 'female' ? '♀ 仅限女生' : '♂ 仅限男生'}</span>` : ''}
          <span class="pill gray">${UI.esc(p.fee_mode_name)}</span>
          <span class="pill gray">还缺 ${Math.max(0, p.need_count - p.approved_count)} 人</span>
        </div>
        <div class="post-footer">
          <div class="post-author">
            ${UI.avatarHTML(p.author)}
            <span class="author-name">${UI.esc(p.author.nickname)} ${UI.genderBadge(p.author.gender)}</span>
            ${p.author.verify_real ? '<span class="vbadge real">已真人认证</span>' : ''}
            ${p.author.verify_student ? '<span class="vbadge real">🎓</span>' : ''}
            <span class="pill ${c.cls}" style="margin-left:2px">${c.text}</span>
          </div>
          <div class="post-stats"><span>❤️ ${p.likes_count}</span><span>💬 ${p.comments_count}</span></div>
        </div>
      </div>
    </div>`;
  }

  function renderHeader() {
    const cats = [{ key: '', name: '全部', emoji: '🧭' }, ...meta.categories];
    return `
    <div class="navbar">
      <div class="navbar-inner">
        <div class="navbar-title" style="text-align:left; font-size:20px; font-weight:800;">搭搭</div>
        <button class="navbar-btn" id="btn-city" style="font-size:13px; width:auto; padding:0 10px; background:var(--primary-soft); color:var(--primary-deep); border-radius:10px; font-weight:600;">📍${UI.esc(state.city || '全部城市')}</button>
        <button class="navbar-btn" id="btn-notif" style="position:relative">🔔</button>
      </div>
      <div style="padding: 0 14px 10px;">
        <div class="search-bar">
          <span>🔍</span>
          <input id="f-kw" placeholder="搜索搭局：火锅、自习、livehouse…" value="${UI.esc(state.keyword)}">
        </div>
      </div>
      <div class="navbar-sub" id="cat-bar">
        ${cats.map((c) => `
          <button class="pill ${state.category === c.key ? '' : 'gray'}" data-cat="${c.key}" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">
            ${c.emoji} ${c.name}
          </button>`).join('')}
        <button class="pill ${state.sort === 'hot' ? '' : 'gray'}" id="btn-sort" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">🔥 热门</button>
      </div>
    </div>`;
  }

  async function render() {
    el.innerHTML = renderHeader() + `<div id="list" style="padding-top:12px;">${UI.loading()}</div>`;

    el.querySelector('#btn-notif').onclick = () => API.isLogin() ? App.navigate('#/notifications') : UI.requireLogin();
    el.querySelector('#f-kw').addEventListener('change', (e) => { state.keyword = e.target.value.trim(); refreshList(); });
    el.querySelector('#f-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    el.querySelector('#btn-sort').onclick = () => {
      state.sort = state.sort === 'hot' ? 'new' : 'hot';
      el.querySelector('#cat-bar').innerHTML = catBarHTML();
      bindCatBar();
      refreshList();
    };
    el.querySelector('#btn-city').onclick = cityPicker;

    bindCatBar();
    await refreshList();
  }

  function catBarHTML() {
    const cats = [{ key: '', name: '全部', emoji: '🧭' }, ...meta.categories];
    return cats.map((c) => `
      <button class="pill ${state.category === c.key && !(c.key === '' && state.sort === 'hot') ? '' : 'gray'}" data-cat="${c.key}" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">
        ${c.emoji} ${c.name}
      </button>`).join('') + `<button class="pill ${state.sort === 'hot' ? '' : 'gray'}" id="btn-sort" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">🔥 热门</button>`;
  }

  function bindCatBar() {
    el.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => {
        state.category = b.dataset.cat;
        el.querySelector('#cat-bar').innerHTML = catBarHTML();
        bindCatBar();
        refreshList();
      };
    });
    el.querySelector('#btn-sort')?.addEventListener('click', () => {
      state.sort = state.sort === 'hot' ? 'new' : 'hot';
      el.querySelector('#cat-bar').innerHTML = catBarHTML();
      bindCatBar();
      refreshList();
    });
  }

  async function refreshList() {
    const listEl = el.querySelector('#list');
    try {
      const data = await fetchList();
      if (!data.list.length) {
        listEl.innerHTML = UI.empty('🔍', '这里还没有搭局', '换个城市或分类看看，或者自己发一个！');
        return;
      }
      listEl.innerHTML = data.list.map(postCard).join('');
      listEl.querySelectorAll('.post-card').forEach((c) => {
        c.onclick = () => App.navigate('#/post/' + c.dataset.id);
      });
    } catch (err) {
      listEl.innerHTML = UI.empty('😵', '加载失败', err.message);
    }
  }

  function cityPicker() {
    const s = UI.sheet('选择城市', `<div id="city-list">${UI.loading()}</div>`);
    API.get('/cities').then((cities) => {
      const quick = ['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '西安', '南京', '重庆'];
      const all = [...new Set([...quick, ...cities.map((c) => c.city)])];
      s.el.querySelector('#city-list').innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
          <button class="btn plain sm" data-city="">全部</button>
          ${all.map((c) => `<button class="btn plain sm" data-city="${UI.esc(c)}" ${c === state.city ? 'style="border:1.5px solid var(--primary); color:var(--primary-deep); font-weight:700;"' : ''}>${UI.esc(c)}</button>`).join('')}
        </div>
        <div style="margin-top:12px;">
          <input id="f-city-custom" class="input" placeholder="手动输入其他城市">
          <button class="btn ghost block sm" id="btn-city-custom" style="margin-top:8px;">确定</button>
        </div>`;
      s.el.querySelectorAll('[data-city]').forEach((b) => {
        b.onclick = () => { state.city = b.dataset.city; s.close(); render(); };
      });
      s.el.querySelector('#btn-city-custom').onclick = () => {
        state.city = s.el.querySelector('#f-city-custom').value.trim();
        s.close(); render();
      };
    });
  }

  await render();
});
