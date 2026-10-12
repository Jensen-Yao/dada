/* ================= 广场页（搭局列表 · 双列瀑布流 H5-06~08） ================= */
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
    return UI.pinCard(p);
  }

  function renderHeader() {
    const cats = [{ key: '', name: '全部', emoji: '🧭' }, ...meta.categories];
    return `
    <div class="navbar">
      <div class="navbar-inner">
        <div class="navbar-title" style="text-align:left; font-size:20px; font-weight:800;">搭搭</div>
        <button class="navbar-btn" id="btn-city" style="font-size:13px; width:auto; padding:0 10px; background:var(--primary-soft); color:var(--primary-deep); border-radius:10px; font-weight:600; gap:4px;">${UI.icon('location', 13)}${UI.esc(state.city || '全部城市')}</button>
        <button class="navbar-btn" id="btn-notif" style="position:relative">${UI.icon('bell', 20)}</button>
      </div>
      <div style="padding: 0 14px 10px;">
        <div class="search-bar">
          ${UI.icon('search', 16)}
          <input id="f-kw" placeholder="搜索搭局：火锅、自习、livehouse…" value="${UI.esc(state.keyword)}">
        </div>
      </div>
      <div class="navbar-sub" id="cat-bar">
        ${cats.map((c) => `
          <button class="pill ${state.category === c.key ? '' : 'gray'}" data-cat="${c.key}" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">
            ${c.emoji} ${c.name}
          </button>`).join('')}
        <button class="pill ${state.sort === 'hot' ? '' : 'gray'}" id="btn-sort" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">热门</button>
      </div>
    </div>`;
  }

  async function render() {
    el.innerHTML = renderHeader() + `<div id="list">${UI.wfSkeleton(6)}</div>`;

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
      </button>`).join('') + `<button class="pill ${state.sort === 'hot' ? '' : 'gray'}" id="btn-sort" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">热门</button>`;
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
      // H5-06：筛选/分页刷新时整容器重绘（columns 下增量插入会重排列序）
      if (!data.list.length) {
        listEl.innerHTML = UI.empty('🔍', '这里还没有搭局', '换个城市或分类看看，或者自己发一个！');
        return;
      }
      listEl.innerHTML = `<div class="wf">${data.list.map(postCard).join('')}</div>`;
      listEl.querySelectorAll('.pin-card').forEach((c) => {
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
