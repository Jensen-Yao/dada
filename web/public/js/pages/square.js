/* ================= 广场页（搭局列表 · 双列瀑布流 H5-06~08） ================= */
App.register('square', async (el, _seg, query) => {
  // U5 骨架前置：先同步渲染头部骨架（分类条占位）+ 瀑布流骨架再 await meta——
  // 弱网首屏不再整页空白约 2s；meta 走 App 级缓存 promise，二次进入零等待
  // H5-09 触底加载：page 当前页码 / hasMore 还有下一页 / loadingMore 触底请求防重入
  const state = {
    city: query.get('city') || '',
    category: query.get('category') || '',
    keyword: '',
    sort: 'new',
    page: 1,
    hasMore: true,
    loadingMore: false,
  };
  const PAGE_SIZE = 10;
  // 请求序号：筛选切换后晚到的旧响应（翻页竞态）直接丢弃
  let fetchSeq = 0;
  let meta = null; // 首帧骨架渲染后填充（catBarHTML 依赖）

  async function fetchList(page) {
    const params = new URLSearchParams();
    if (state.city) params.set('city', state.city);
    if (state.category) params.set('category', state.category);
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.sort === 'hot') params.set('sort', 'hot');
    params.set('page', String(page));
    params.set('size', String(PAGE_SIZE));
    return API.get('/posts?' + params.toString());
  }

  function postCard(p) {
    return UI.pinCard(p);
  }

  // withCats=false：首帧骨架态（分类条留空，meta 到达后补齐）
  function renderHeader(withCats) {
    return `
    <div class="navbar">
      <div class="navbar-inner">
        <div class="navbar-title" style="text-align:left; font-size:var(--fs-title); font-weight:800;">搭搭</div>
        <button class="navbar-btn" id="btn-city" aria-label="选择城市" style="font-size:13px; width:auto; padding:0 10px; background:var(--primary-soft); color:var(--primary-deep); border-radius:10px; font-weight:600; gap:4px;">${UI.icon('location', 13)}${UI.esc(state.city || '全部城市')}</button>
        <button class="navbar-btn" id="btn-notif" aria-label="通知" style="position:relative">${UI.icon('bell', 20)}</button>
      </div>
      <div style="padding: 0 14px 10px;">
        <div class="search-bar">
          ${UI.icon('search', 16)}
          <input id="f-kw" aria-label="搜索搭局" placeholder="搜索搭局：火锅、自习、livehouse…" value="${UI.esc(state.keyword)}">
        </div>
      </div>
      <div class="navbar-sub" id="cat-bar">${withCats && meta ? catBarHTML() : ''}</div>
    </div>`;
  }

  function bindHeader() {
    el.querySelector('#btn-notif').onclick = () => API.isLogin() ? App.navigate('#/notifications') : UI.requireLogin();
    el.querySelector('#f-kw').addEventListener('change', (e) => { state.keyword = e.target.value.trim(); refreshList(); });
    el.querySelector('#f-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    el.querySelector('#btn-city').onclick = cityPicker;
  }

  async function render() {
    el.innerHTML = renderHeader(true) + `<div id="list">${UI.wfSkeleton(6)}</div>`;
    bindHeader();
    bindCatBar();
    await refreshList();
  }

  function catBarHTML() {
    const cats = [{ key: '', name: '全部' }, ...meta.categories];
    return cats.map((c) => `
      <button class="pill ${state.category === c.key && !(c.key === '' && state.sort === 'hot') ? '' : 'gray'}" data-cat="${c.key}" style="white-space:nowrap; padding:5px 13px; font-size:12.5px; flex-shrink:0;">
        ${c.name}
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

  // H5-09 has_more 兼容口径：新后端返回 has_more；旧后端无该字段时按
  // "本页有数据就继续翻"兜底（翻到空页自然停止），公式统一为：
  // has_more !== false && list.length > 0
  function calcHasMore(r) {
    return r.has_more !== false && r.list.length > 0;
  }

  function bindCards(scope) {
    scope.querySelectorAll('.pin-card').forEach((c) => {
      c.onclick = () => App.navigate('#/post/' + c.dataset.id);
    });
  }

  // 底部哨兵：既是 IntersectionObserver 触发点，也是"加载中/没有更多了"小字容器
  function tailHTML() {
    return `<div id="wf-tail" style="text-align:center; color:var(--text-3); font-size:12px; padding:14px 0 calc(18px + var(--safe-bottom));"></div>`;
  }

  function paintTail() {
    const t = el.querySelector('#wf-tail');
    if (!t) return;
    t.innerHTML = state.loadingMore ? UI.loading('加载中...') : (state.hasMore ? '' : '没有更多了');
  }

  // 触底监听：rootMargin 提前 200px 预载；页面卸载时由 App.onCleanup 断开
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '200px 0px' });
  App.onCleanup(() => io.disconnect());

  function watchTail() {
    io.disconnect();
    const t = el.querySelector('#wf-tail');
    if (!t) return;
    t.onclick = () => loadMore(); // 失败态可点击重试（成功态由 guard 拦截）
    io.observe(t);
  }

  async function refreshList() {
    const seq = ++fetchSeq;
    const listEl = el.querySelector('#list');
    // 任何筛选条件变化都重置分页并清空列表（走整容器重绘）
    state.page = 1;
    state.hasMore = true;
    state.loadingMore = false;
    try {
      const data = await fetchList(1);
      if (seq !== fetchSeq) return; // 筛选已变更，丢弃过期响应
      // H5-06：筛选/分页刷新时整容器重绘（columns 下增量插入会重排列序）
      if (!data.list.length) {
        state.hasMore = false;
        listEl.innerHTML = UI.empty('search', '这里还没有搭局', '换个城市或分类看看，或者自己发一个');
        return;
      }
      state.hasMore = calcHasMore(data);
      listEl.innerHTML = `<div class="wf">${data.list.map(postCard).join('')}</div>${tailHTML()}`;
      bindCards(listEl);
      paintTail();
      watchTail();
    } catch (err) {
      state.hasMore = false;
      listEl.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
    }
  }

  // H5-09 触底追加：保持当前筛选条件 page+1 追加请求；
  // CSS columns 瀑布流直接 append 到 .wf 尾部即可自然回流
  async function loadMore() {
    if (state.loadingMore || !state.hasMore) return; // 防重入
    state.loadingMore = true;
    const seq = fetchSeq;
    paintTail();
    let appended = false;
    try {
      const data = await fetchList(state.page + 1);
      if (seq !== fetchSeq) return; // 筛选已变更，丢弃过期响应
      state.page += 1;
      if (data.list.length) {
        const wf = el.querySelector('#list .wf');
        if (wf) {
          wf.insertAdjacentHTML('beforeend', data.list.map(postCard).join(''));
          bindCards(wf);
          appended = true;
        }
      }
      state.hasMore = calcHasMore(data);
    } catch (err) {
      UI.toast(err.message); // 失败不推进页码；滚动离开再触底或点击底部提示重试
    } finally {
      state.loadingMore = false;
      paintTail();
      if (appended) watchTail(); // 追加后哨兵若仍在视口内（大屏），重新 observe 续载
    }
  }

  function cityPicker() {
    // U4：城市选择 sheet 底部补"取消"出口
    const s = UI.sheet('选择城市', `<div id="city-list">${UI.loading()}</div>`, { cancel: true });
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

  // U5：首帧同步渲染骨架（头部 + 瀑布流）→ meta 到达补分类条 → 拉列表
  el.innerHTML = renderHeader(false) + `<div id="list">${UI.wfSkeleton(6)}</div>`;
  bindHeader();
  meta = await App.meta();
  el.querySelector('#cat-bar').innerHTML = catBarHTML();
  bindCatBar();
  await refreshList();
});
