/* ================= 发现页（推荐+为你而设 · 瀑布流 H5-09 · v2.9 匹配可视化 MT-03/04） ================= */

// MT-04 引导标签池（28 个，与 misc.js 编辑资料同池；复制到本文件，避免跨页面耦合）
const ONBOARD_TAGS = ['美食', '运动', '健身', '跑步', '自习', '读书', '旅行', '徒步', '露营', 'livehouse', '摇滚', '游戏', '剧本杀', '桌游', '电影', '摄影', '扫街', '咖啡', '探店', '逛街', '遛狗', '猫奴', '拼车', '飞盘', '爬山', '骑行', '羽毛球', '滑雪'];

// MT-03 匹配度徽章：≥80 橙色实底"高匹配"、60-79 绿色、<60 灰色；null/冷启动不渲染
function matchBadgeHTML(score) {
  if (score === null || score === undefined) return '';
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tier = s >= 80 ? 'hot' : s >= 60 ? 'mid' : 'low';
  const text = s >= 80 ? `${s}% 高匹配` : `${s}%`;
  return `<span class="match-badge ${tier}">${text}</span>`;
}

App.register('discover', async (el) => {
  /* ---------- VD-08 FE-7：附近城市 chip 排 ----------
   * 发现页顶部城市切换（北京/上海/广州/深圳/成都/杭州/全部，当前高亮），
   * 点击切 GET /api/recommend?city=X 热门流并显示该城开放局数；
   * 默认"我的城市"（me.city 命中 chip 则选中，否则全部）。 */
  const CITY_CHIPS = ['北京', '上海', '广州', '深圳', '成都', '杭州'];
  let city = '';
  const cityCounts = {}; // 城市 → 开放局数（/cities 聚合，失败时用 recommend 列表长度兜底）

  // U5 骨架前置：先同步渲染页面骨架（热门区骨架屏），/auth/me 拉取放.paint 之后，弱网首屏不再空白
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner"><div class="navbar-title" style="text-align:left; font-size:var(--fs-title); font-weight:800;">发现搭子</div></div>
  </div>
  <div class="city-chips" id="city-chips"></div>
  <div class="city-count" id="city-count"></div>
  <div id="fy-part"></div>
  <div id="hot-part">${UI.wfSkeleton(6)}</div>`;

  let meCity = window.__me?.city || '';
  if (API.isLogin() && !meCity) {
    try { meCity = (await API.get('/auth/me')).city || ''; } catch { /* ignore */ }
  }
  if (CITY_CHIPS.includes(meCity)) city = meCity;

  function chipsHTML() {
    return [...CITY_CHIPS, '全部'].map((c) => {
      const v = c === '全部' ? '' : c;
      return `<button class="city-chip ${city === v ? 'active' : ''}" data-city="${v}">${c}</button>`;
    }).join('');
  }

  function paintCityCount() {
    const cnt = el.querySelector('#city-count');
    if (!cnt) return;
    cnt.textContent = city ? `${city} · ${cityCounts[city] != null ? cityCounts[city] : '—'} 场搭局开放中` : '';
  }

  function paintChips() {
    el.querySelector('#city-chips').innerHTML = chipsHTML();
    el.querySelectorAll('#city-chips .city-chip').forEach((b) => {
      b.onclick = () => {
        if (city === b.dataset.city) return;
        city = b.dataset.city;
        paintChips();
        loadHot();
      };
    });
    paintCityCount();
  }

  // ---------- 为你推荐（登录用户） ----------
  async function loadFY() {
    const fyEl = el.querySelector('#fy-part');
    fyEl.innerHTML = '';
    if (!API.isLogin()) return;
    let fy;
    try { fy = await API.get('/for-you'); } catch { return; /* ignore */ }
    // 合规：个性化推荐已关闭 → 提示条 + 热门展示（热门区在下方独立渲染）
    if (fy.rec_off) {
      fyEl.innerHTML = `<div class="rec-off-tip">${UI.icon('info', 13)}个性化推荐已关闭，按热门展示</div>`;
      return;
    }
    if (!fy.list.length) return;
    const items = fy.list.slice(0, 5);
    const parts = [];
    // MT-03：冷启动 → 区块顶部提示条（列表照常展示热门、不出徽章）
    if (fy.cold_start) {
      parts.push(`
        <div class="cold-tip" id="cold-tip">${UI.icon('info', 15)}
          <span class="cold-tip-text">选择兴趣标签，解锁精准匹配</span>
          <span class="cold-tip-btn">去设置</span>
        </div>`);
    }
    // 新卡片：match_reasons 已由 chips 行承接，不再重复渲染旧 reason 角标；
    // 未升级 BE（无新字段）时保留旧 reason 角标兼容
    const hasMatch = (p) => p.match_score != null || (p.match_reasons && p.match_reasons.length);
    parts.push(`
      <div class="section-title">为你而设 <span class="pill">${fy.cold_start ? '先看看热门' : '根据你的搭子偏好'}</span></div>
      <div class="wf fy-wf">${items.map((p) => UI.pinCard(p, hasMatch(p) ? {} : { reason: p.reason })).join('')}</div>`);
    fyEl.innerHTML = parts.join('');
    fyEl.querySelectorAll('.pin-card').forEach((c) => {
      c.onclick = () => App.navigate('#/post/' + c.dataset.id);
    });

    // MT-03：为你而设卡片注入匹配徽章（封面右上角）+ 理由 chips（作者行下）
    const fyMatch = {};
    items.forEach((p) => { fyMatch[p.id] = p; });
    fyEl.querySelectorAll('.fy-wf .pin-card').forEach((card) => {
      const p = fyMatch[card.dataset.id];
      if (!p) return;
      const cover = card.querySelector('.pin-cover');
      if (cover && p.match_score != null) {
        cover.insertAdjacentHTML('beforeend', matchBadgeHTML(p.match_score));
        // 封面右上已有"仅限女生/男生"角标时徽章下移避让，不互相遮挡
        const badge = cover.querySelector('.match-badge');
        if (badge && cover.querySelector('.pin-flag.tr')) badge.classList.add('stacked');
      }
      const body = card.querySelector('.pin-body');
      if (body && p.match_reasons && p.match_reasons.length) {
        // VD-04 FE-4：老搭子理由（首位"老搭子·搭过N次"）渲染为橙色高亮 chip，区分普通灰 chip
        body.insertAdjacentHTML('beforeend', `
          <div class="match-chips">${p.match_reasons.slice(0, 3).map((r) => `<span class="match-chip${/^老搭子/.test(r) ? ' buddy' : ''}">${UI.esc(r)}</span>`).join('')}</div>`);
      }
    });

    // MT-03：冷启动提示条 → 去设置兴趣标签
    const coldTip = fyEl.querySelector('#cold-tip');
    if (coldTip) coldTip.onclick = () => App.navigate('#/edit-profile');
  }

  // ---------- 热门搭局（VD-08：城市 chip 切换 /api/recommend?city=X） ----------
  async function loadHot() {
    const hotEl = el.querySelector('#hot-part');
    hotEl.innerHTML = UI.wfSkeleton(6);
    let hot;
    try {
      hot = await API.get('/recommend?city=' + encodeURIComponent(city || ''));
    } catch (err) {
      hotEl.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
      return;
    }
    hotEl.innerHTML = `
      <div class="section-title">${city ? `热门搭局 · ${UI.esc(city)}` : '本周热门搭局'}</div>
      ${hot.list.slice(0, 10).length
        ? `<div class="wf">${hot.list.slice(0, 10).map((p) => UI.pinCard(p, { reason: p.reason })).join('')}</div>`
        : UI.empty('trending-up', '这座城市还没有搭局', '发一个试试，等搭子来找你')}
      <div style="text-align:center; padding:16px; color:var(--text-3); font-size:12px;">
        搭搭 · 让每一次搭伙都靠谱<br>轻社交 · 不婚恋 · 有边界
      </div>`;
    hotEl.querySelectorAll('.pin-card').forEach((c) => {
      c.onclick = () => App.navigate('#/post/' + c.dataset.id);
    });
    // 城市开放局数兜底（/cities 未返回该城时用列表长度）
    if (city && cityCounts[city] == null) { cityCounts[city] = hot.list.length; paintCityCount(); }
  }

  paintChips();
  // 城市开放局数（open+full 聚合，接口失败静默）
  API.get('/cities').then((rows) => {
    rows.forEach((r) => { cityCounts[r.city] = r.c; });
    paintCityCount();
  }).catch(() => {});

  await loadFY();
  await loadHot();

  // ---------- MT-04：注册后一次性引导（冷启动闭环） ----------
  // 触发条件：登录态 + dada_need_onboard==='1'（login.js 注册成功写入）+ 未处理过（dada_onboarded 未设）
  let onboardSheet = null;
  function showOnboard(defaultCity) {
    const s = UI.sheet('让搭搭更懂你', `
      <div class="ob-sub">选择你的兴趣和常驻城市，搭搭会为你精准匹配搭子</div>
      <div class="ob-tags">${ONBOARD_TAGS.map((t) => `<span class="tag" data-t="${t}">${t}</span>`).join('')}</div>
      <div class="form-item" style="margin-top:14px;">
        <label>常驻城市</label>
        <input id="ob-city" class="input" maxlength="12" placeholder="如 北京" value="${UI.esc(defaultCity || '')}">
      </div>
      <button class="btn primary block" id="ob-done">完成</button>
      <div class="ob-skip" id="ob-skip">跳过</div>`);
    s.el.classList.add('ob-sheet');
    onboardSheet = s;

    const picked = new Set();
    const doneBtn = s.el.querySelector('#ob-done');
    const paintDone = () => doneBtn.classList.toggle('dim', picked.size < 3);
    s.el.querySelectorAll('[data-t]').forEach((t) => {
      t.onclick = () => {
        const tag = t.dataset.t;
        if (picked.has(tag)) { picked.delete(tag); t.classList.remove('on'); }
        else if (picked.size >= 10) { UI.toast('最多选 10 个标签'); }
        else { picked.add(tag); t.classList.add('on'); }
        paintDone();
      };
    });
    paintDone();

    doneBtn.onclick = async () => {
      if (picked.size < 3) return UI.toast('至少选3个标签');
      doneBtn.disabled = true;
      try {
        await API.put('/users/me', { tags: [...picked], city: s.el.querySelector('#ob-city').value.trim() });
        localStorage.removeItem('dada_need_onboard');
        localStorage.setItem('dada_onboarded', '1');
        s.close();
        UI.toast('匹配已就绪');
        await Promise.all([loadFY(), loadHot()]); // 重新加载推荐（带新标签评分）
      } catch (err) {
        UI.toast(err.message);
        doneBtn.disabled = false;
      }
    };
    s.el.querySelector('#ob-skip').onclick = () => {
      localStorage.removeItem('dada_need_onboard');
      localStorage.setItem('dada_onboarded', '1');
      s.close();
    };
  }

  // 页面切走时收起引导 sheet（标记未清，下次进发现页仍会引导）
  App.onCleanup(() => { if (onboardSheet) { onboardSheet.close(); onboardSheet = null; } });

  async function maybeOnboard() {
    if (!API.isLogin()) return;
    if (localStorage.getItem('dada_need_onboard') !== '1' || localStorage.getItem('dada_onboarded')) return;
    if (document.querySelector('.ob-sheet')) return; // 已有引导 sheet 在弹，不重复
    let city = '';
    try { city = (await API.get('/auth/me')).city || ''; } catch { /* ignore */ }
    showOnboard(city);
  }

  maybeOnboard();
});
