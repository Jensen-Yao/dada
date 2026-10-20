/* ================= 搭局详情页（H5-10 大图轮播 + H5-11 底部操作栏） ================= */
App.register('post', async (el, seg) => {
  const pid = parseInt(seg[0]);
  let post = null;
  let me = API.isLogin() ? await API.get('/auth/me').catch(() => null) : null;

  function metaRow(iconSvg, text) {
    return `<div style="display:flex; gap:8px; margin-bottom:9px; font-size:var(--fs-md); color:var(--text-2); align-items:center;">
      <span style="flex-shrink:0; display:flex; color:var(--text-3);">${iconSvg}</span><span>${UI.esc(text)}</span></div>`;
  }

  function statusPill(p) {
    const map = {
      open: ['招募中', 'green'], full: ['已满员', 'gray'], closed: ['已关闭', 'gray'],
      done: ['已完成', 'blue'], expired: ['已过期', 'gray'],
    };
    const [text, cls] = map[p.status] || ['未知', 'gray'];
    return `<span class="pill ${cls}">${text}</span>`;
  }

  /* ---------- R5 时间语义（review-time-r5 TS-5）：meet_at 倒计时 ----------
   * meet_at 存在且未来 → "还有X天X小时开始"（纯文本，R4 已去 emoji）；
   * 已过 24h → "该搭局时间已过"；过去 24h 内（进行中/刚散场缓冲期）→ 不附加倒计时。
   * meet_at 为空（老帖/BE 未返回）→ 恒回退 meet_time 原文，零影响。 */
  function meetLine(p) {
    const base = UI.meetText(p) || UI.esc(p.meet_time || '');
    if (!base) return '';
    if (!p.meet_at) return base;
    const diff = p.meet_at - Date.now();
    if (diff > 0) {
      const h = Math.floor(diff / 3600000);
      const d = Math.floor(h / 24);
      const cd = d >= 1 ? `还有${d}天${h % 24}小时开始` : (h >= 1 ? `还有${h}小时开始` : '即将开始');
      return `${base} · ${cd}`;
    }
    if (-diff > 24 * 3600000) return `${base} · 该搭局时间已过`;
    return base;
  }

  async function load() {
    post = await API.get(`/posts/${pid}`);
    me = API.isLogin() ? await API.get('/auth/me').catch(() => null) : null;
    render();
  }

  function render() {
    const p = post;
    const c = UI.creditLabel(p.author.credit);
    // H5-09 拉黑口径：blocked_by_me 为 true 时作者区挂灰 pill、操作栏禁用（undefined 按 false 兼容旧后端）
    const blocked = p.blocked_by_me === true;
    el.classList.add('post-page');
    const imgs = p.images || [];
    const ar = (UI.aspectOf(p) || '3:4').replace(':', ' / ');

    // H5-10：大图轮播（scroll-snap + n/m 页码指示）；无图降级为分类线性图标头图块（EM-02）
    // H6：图片 404 走统一兜底链（分类封面 svg → 渐变占位块）
    const mediaHTML = imgs.length ? `
    <div style="position:relative;">
      <div class="carousel" id="carousel" style="--ar:${ar}">
        ${imgs.map((src, i) => `<img src="${UI.esc(src)}" ${i ? 'loading="lazy"' : ''} alt="" onerror="${UI.imgFallback(p.category)}">`).join('')}
      </div>
      <span class="carousel-ind" id="car-ind">1/${imgs.length}</span>
    </div>` : `
    <div class="detail-hero" style="--ar:${ar}">${UI.catIcon(p.category, 64)}</div>`;

    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" onclick="history.back()" aria-label="返回">${UI.icon('chevron-left', 22)}</button>
        <div class="navbar-title">${UI.esc(p.category_name)}搭局</div>
        <div style="display:flex; align-items:center; gap:2px;">
          ${p.is_author && ['open', 'full'].includes(p.status) ? '<button class="navbar-btn nav-txt-btn" id="btn-edit" aria-label="编辑搭局">编辑</button>' : ''}
          <button class="navbar-btn" id="btn-share" aria-label="分享">${UI.icon('share', 19)}</button>
        </div>
      </div>
    </div>

    ${mediaHTML}

    <!-- 内容卡：标题 + pill 标签 + 正文 + 信息行（标题下移至轮播下方，XHS 式） -->
    <div class="card" style="margin:12px 14px;">
      <div style="font-size:var(--fs-title); font-weight:800; line-height:1.45;">${UI.esc(p.title)}</div>
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${statusPill(p)}<span class="pill">${UI.esc(p.fee_mode_name)}</span>${p.gender_req !== 'any' ? `<span class="pill blue">${p.gender_req === 'female' ? '仅限女生' : '仅限男生'}</span>` : ''}</div>
      ${p.content ? `<div style="margin-top:12px; font-size:var(--fs-md); line-height:1.7; color:var(--text); white-space:pre-wrap;">${UI.esc(p.content)}</div>` : ''}
      <div style="margin-top:14px; padding-top:12px; border-top:0.5px solid var(--line);">
        ${metaRow(UI.icon('location', 15), `${UI.esc(p.city)}${p.location_name ? ' · ' + UI.esc(p.location_name) : ''}`)}
        ${p.meet_time || p.meet_at ? metaRow(UI.icon('clock', 15), meetLine(p)) : ''}
        ${metaRow(UI.icon('people', 15), `已通过 ${p.approved_count} / ${p.need_count} 人${p.status === 'open' ? `，还缺 ${Math.max(0, p.need_count - p.approved_count)} 人` : ''}`)}
        ${p.requirements ? metaRow(UI.icon('edit', 15), UI.esc(p.requirements)) : ''}
        ${metaRow(UI.icon('eye', 15), `${p.views_count} 次浏览 · ${UI.timeAgo(p.created_at)}发布`)}
      </div>
    </div>

    <!-- 组局者：申请管理 / 完成搭局 -->
    ${p.is_author && ['open', 'full'].includes(p.status) ? `
    <div class="section-title">申请管理</div>
    <div id="join-list">${UI.loading()}</div>
    <div style="padding:0 14px 12px;">
      <button class="btn ghost block" id="btn-done">${UI.icon('check', 14)} 搭局已完成（开启互评）</button>
    </div>` : ''}

    ${p.is_author && p.status === 'done' ? `
    <div class="section-title">搭后互评</div>
    <div class="card" style="margin:0 14px 12px;" id="rate-panel">${UI.loading()}</div>` : ''}

    <!-- 评论区 -->
    <div class="section-title" id="comments-anchor">评论区（${p.comments_count}）</div>
    <div id="comments">${UI.loading()}</div>
    ${API.isLogin() ? `
    <div style="padding:0 14px 20px;">
      <div style="display:flex; gap:8px;">
        <input id="f-comment" class="input" aria-label="写评论" placeholder="友善发言，共同维护搭子氛围…" style="flex:1;">
        <button class="btn primary sm" id="btn-comment">发送</button>
      </div>
    </div>` : ''}

    <!-- H5-11：底部固定操作栏（作者｜点赞｜评论｜主按钮） -->
    <div class="detail-actionbar detail-bar">
      <div class="da-author" id="author-card" role="link" tabindex="0" aria-label="${UI.esc(p.author.nickname)}的主页" onkeydown="if(event.key==='Enter')App.navigate('#/user/${p.author.id})">
        ${UI.avatarHTML(p.author)}
        <div class="da-author-info">
          <span class="da-name">${UI.esc(p.author.nickname)} ${UI.genderBadge(p.author.gender)}${p.author.verify_real ? '<span class="vbadge real">真人</span>' : ''}${blocked ? '<span class="pill gray">已拉黑</span>' : ''}</span>
          <span class="pill ${c.cls} da-credit" style="align-self:flex-start;">${c.text}</span>
        </div>
      </div>
      <button class="da-act ${p.liked ? 'liked' : ''}" id="btn-like" ${blocked ? 'disabled' : ''}>
        ${UI.icon(p.liked ? 'heartFill' : 'heart', 22)}<span>${p.likes_count}</span>
      </button>
      <button class="da-act" id="btn-comment-jump" ${blocked ? 'disabled' : ''}>
        ${UI.icon('comment', 22)}<span>${p.comments_count}</span>
      </button>
      <button class="btn ${joinBtnClass()} sm da-cta" id="btn-join" ${joinDisabled() ? 'disabled' : ''}>${joinBtnText()}</button>
    </div>
    `;

    bind(p);
    bindCarousel(imgs);
    if (p.is_author && ['open', 'full'].includes(p.status)) loadJoins(p);
    if (p.is_author && p.status === 'done') loadRatePanel(p);
    loadComments(p);
  }

  // 轮播页码指示：scroll + rAF 节流（H5-10）
  function bindCarousel(imgs) {
    const car = el.querySelector('#carousel');
    const ind = el.querySelector('#car-ind');
    if (!car || !ind || !imgs.length) return;
    let raf = 0;
    car.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const idx = Math.round(car.scrollLeft / car.clientWidth) + 1;
        ind.textContent = `${Math.min(imgs.length, Math.max(1, idx))}/${imgs.length}`;
      });
    }, { passive: true });
  }

  function joinBtnText() {
    const p = post;
    if (!API.isLogin()) return '登录后申请加入';
    if (p.is_author) return '这是我发布的搭局';
    // H7：满员与关闭文案区分；满员给出口（点击跳广场）
    if (p.status === 'full') return '已满员，看看其他搭局';
    if (p.status !== 'open') return '该搭局已停止招募';
    // R4关联[申请人退出]：申请中主按钮改"撤回申请"，点击走 confirm + POST /posts/:id/quit
    if (p.my_join === 'pending') return '撤回申请';
    if (p.my_join === 'approved') return `${UI.icon('check-circle', 14)} 已通过，去聊天`;
    if (p.my_join === 'rejected') return '重新申请';
    return '申请加入';
  }

  // H7：满员态主按钮用灰底去饱和样式（.btn.muted），不再是亮橙误导
  function joinBtnClass() {
    const p = post;
    if (API.isLogin() && !p.is_author && p.status === 'full') return 'muted';
    return 'primary';
  }

  // 主按钮不可操作态（组局者视角/非招募中/已拉黑作者）时置灰；
  // 申请中（pending）可点击 → 撤回申请
  function joinDisabled() {
    const p = post;
    if (!API.isLogin()) return false;
    if (p.is_author) return true;
    if (p.blocked_by_me === true) return true; // H5-09：已拉黑作者，不可申请
    if (p.status === 'full') return false; // H7：满员可点击 → 跳广场
    if (p.status !== 'open') return true;  // closed/done/expired：灰置不可点
    return false;
  }

  function bind(p) {
    el.querySelector('#btn-share').onclick = async () => {
      const url = location.href;
      try {
        if (navigator.share) await navigator.share({ title: p.title, url });
        else { await navigator.clipboard.writeText(url); UI.toast('链接已复制'); }
      } catch { /* 用户取消 */ }
    };
    el.querySelector('#author-card').onclick = () => App.navigate('#/user/' + p.author.id);
    // H4：点赞只做局部更新（心形图标 + 计数），不再整页 render——
    // 原先整页重建会把轮播复位到第 1 张、清空未发送的评论文本
    let lastLikeAt = 0; // P2：300ms 内重复点击忽略（节流）
    el.querySelector('#btn-like').onclick = async () => {
      if (!API.isLogin()) return UI.requireLogin();
      const now = Date.now();
      if (now - lastLikeAt < 300) return;
      lastLikeAt = now;
      try {
        const r = await API.post(`/posts/${pid}/like`);
        post.liked = r.liked;
        post.likes_count += r.liked ? 1 : -1;
        const btn = el.querySelector('#btn-like');
        if (btn) {
          btn.classList.toggle('liked', post.liked);
          btn.innerHTML = `${UI.icon(post.liked ? 'heartFill' : 'heart', 22)}<span>${post.likes_count}</span>`;
        }
      } catch (err) { UI.toast(err.message); }
    };
    // 评论按钮：滚动到评论区并聚焦输入框
    el.querySelector('#btn-comment-jump').onclick = () => {
      el.querySelector('#comments-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => el.querySelector('#f-comment')?.focus(), 380);
    };
    el.querySelector('#btn-join').onclick = onJoin;
    // C1：作者编辑入口（open/full 态，导航栏"编辑"）
    el.querySelector('#btn-edit')?.addEventListener('click', () => openEditSheet(p));
    el.querySelector('#btn-comment')?.addEventListener('click', onComment);
    // R4-K4：输入法组合期 Enter 确认候选词不发送（isComposing / 旧内核 keyCode 229）
    el.querySelector('#f-comment')?.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') onComment();
    });
    el.querySelector('#btn-done')?.addEventListener('click', async () => {
      const yes = await UI.confirm('确认这场搭局已经顺利完成了？<br><span style="font-size:12.5px;color:var(--text-3)">完成后将开启搭后互评，双方互评可获得搭力值</span>', { okText: '完成了' });
      if (!yes) return;
      try {
        await API.put(`/posts/${pid}`, { status: 'done' });
        UI.toast('互评已开启');
        load();
      } catch (err) { UI.toast(err.message); }
    });
  }

  /* ---------- C1 编辑搭局（最小集：标题/时间/地点/人数） ----------
   * 仅作者可见（open/full 态）；成功后整页 load() 刷新。
   * 注意：调大人数时后端会把满员搭局自动重开为招募中，load() 后状态 pill 随之更新。 */
  function openEditSheet(p) {
    const s = UI.sheet('编辑搭局', `
      <div class="form-item"><label for="ep-title">标题</label><input id="ep-title" class="input" maxlength="40" value="${UI.esc(p.title)}"></div>
      <div class="form-item"><label for="ep-time">时间</label><input id="ep-time" class="input" maxlength="30" value="${UI.esc(p.meet_time || '')}" placeholder="如 本周六 18:30"></div>
      <div class="form-item"><label for="ep-loc">地点</label><input id="ep-loc" class="input" maxlength="50" value="${UI.esc(p.location_name || '')}" placeholder="如 五道口 xx 火锅店"></div>
      <div class="form-item"><label for="ep-need">成团人数</label><input id="ep-need" class="input" type="number" min="1" max="20" inputmode="numeric" value="${p.need_count}"><div class="ep-hint">已通过 ${p.approved_count} 人；调大人数后满员的搭局会自动重新开放招募</div></div>
      <button class="btn primary block" id="ep-go" style="margin-top:6px;">保存修改</button>`, { cancel: true });
    const go = s.el.querySelector('#ep-go');
    go.onclick = async () => {
      if (go.disabled) return;
      const title = s.el.querySelector('#ep-title').value.trim();
      const need = parseInt(s.el.querySelector('#ep-need').value, 10);
      if (!title) return UI.toast('标题不能为空');
      if (!need || need < 1) return UI.toast('人数至少 1 人');
      go.disabled = true;
      try {
        await API.put(`/posts/${pid}`, {
          title,
          meet_time: s.el.querySelector('#ep-time').value.trim(),
          location_name: s.el.querySelector('#ep-loc').value.trim(),
          need_count: need,
        });
        s.close();
        UI.toast('已更新');
        load();
      } catch (err) {
        UI.toast(err.message);
        go.disabled = false;
      }
    };
  }

  async function onJoin() {
    if (!API.isLogin()) return UI.requireLogin();
    const p = post;
    if (p.is_author) return;
    // [申请人退出]：申请中 → confirm 后调 POST /posts/:id/quit，成功刷新回"可申请"态
    // （BE 并行开发中，接口未上线时 toast 报错原文，申请状态不变）
    if (p.my_join === 'pending') {
      const yes = await UI.confirm('确定撤回这条申请吗？<br><span style="font-size:12px;color:var(--text-3)">撤回后如想加入需重新申请</span>', { okText: '撤回申请' });
      if (!yes) return;
      try {
        await API.post(`/posts/${pid}/quit`, {});
        UI.toast('已撤回申请');
        load();
      } catch (err) { UI.toast(err.message); }
      return;
    }
    // H7：满员帖给出口——跳回广场看其他搭局（按钮文案"已满员，看看其他搭局"）
    if (p.status === 'full') { App.navigate('#/square'); return; }
    if (p.status !== 'open') return;
    if (p.my_join === 'approved') {
      // 服务端在审批通过时已建会话，这里直达
      try {
        const conv = await API.post('/chat/conv', { user_id: p.author.id, post_id: pid });
        App.navigate('#/conv/' + conv.id);
      } catch { App.navigate('#/chat'); }
      return;
    }
    const s = UI.sheet('申请加入「' + UI.esc(p.title.slice(0, 20)) + '」', `
      <textarea id="f-msg" class="textarea" aria-label="申请留言（选填）" placeholder="和组局者打个招呼吧：为什么想加入、你能满足什么要求…（选填）"></textarea>
      <div class="tpl-chips">
        <span class="tpl-chip" data-tpl="我时间地点都OK，可以先聊聊">我时间地点都OK，可以先聊聊</span>
        <span class="tpl-chip" data-tpl="同好！我常玩这个，期待组局">同好！我常玩这个，期待组局</span>
      </div>
      <button class="btn primary block" id="btn-go" style="margin-top:12px;">提交申请</button>`, { cancel: true });
    // VD-05 FE-2：申请留言模板 chip，点击填入 textarea（不直接提交）
    s.el.querySelectorAll('[data-tpl]').forEach((chip) => {
      chip.onclick = () => { s.el.querySelector('#f-msg').value = chip.dataset.tpl; };
    });
    // P2（H14）：提交期间禁用按钮，连点不再弹出多余的错误提示
    const go = s.el.querySelector('#btn-go');
    go.onclick = async () => {
      if (go.disabled) return;
      go.disabled = true;
      try {
        await API.post(`/posts/${pid}/join`, { message: s.el.querySelector('#f-msg').value });
        s.close();
        UI.toast('已提交申请，等待组局者通过');
        load();
      } catch (err) {
        UI.toast(err.message);
        go.disabled = false;
      }
    };
  }

  async function onComment() {
    const input = el.querySelector('#f-comment');
    const text = input.value.trim();
    if (!text) return;
    try {
      await API.post(`/posts/${pid}/comments`, { content: text });
      input.value = '';
      loadComments(post);
      // H15：同步刷新"评论区（N）"标题与底栏评论计数
      post.comments_count++;
      const anchor = el.querySelector('#comments-anchor');
      if (anchor) anchor.textContent = `评论区（${post.comments_count}）`;
      const jumpN = el.querySelector('#btn-comment-jump span');
      if (jumpN) jumpN.textContent = post.comments_count;
    } catch (err) { UI.toast(err.message); }
  }

  async function loadComments(p) {
    const box = el.querySelector('#comments');
    try {
      const list = await API.get(`/posts/${pid}/comments`);
      if (!list.length) {
        box.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-3); font-size:13px;">还没有评论，来抢沙发</div>`;
        return;
      }
      box.innerHTML = list.map((c) => `
        <div style="display:flex; gap:10px; padding:11px 14px; background:var(--card); border-bottom:0.5px solid var(--line);">
          ${UI.avatarHTML(c.user)}
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:600;">${UI.esc(c.user.nickname)} ${UI.genderBadge(c.user.gender)} <span style="color:var(--text-3); font-weight:400; font-size:11.5px; margin-left:4px;">${UI.timeAgo(c.created_at)}</span></div>
            <div style="font-size:14px; margin-top:2px; white-space:pre-wrap;">${UI.esc(c.content)}</div>
          </div>
        </div>`).join('');
      box.querySelectorAll('.avatar').forEach((a, i) => {
        a.style.cursor = 'pointer';
        a.onclick = () => App.navigate('#/user/' + list[i].user.id);
      });
    } catch (err) {
      box.innerHTML = UI.empty('alert-circle', '评论加载失败', err.message);
    }
  }

  async function loadJoins(p) {
    const box = el.querySelector('#join-list');
    try {
      const list = await API.get(`/posts/${pid}/joins`);
      if (!list.length) {
        box.innerHTML = `<div class="card" style="margin:0 14px 12px; text-align:center; color:var(--text-3); font-size:13px; padding:22px;">还没有人申请，分享搭局让更多人看到吧</div>`;
        return;
      }
      box.innerHTML = list.map((j) => `
        <div class="card" style="margin:0 14px 10px; display:flex; gap:11px; align-items:center;">
          ${UI.avatarHTML(j.user)}
          <div style="flex:1; min-width:0;">
            <div style="font-size:14px; font-weight:650; display:flex; align-items:center; gap:5px;">
              ${UI.esc(j.user.nickname)} ${UI.genderBadge(j.user.gender)}
              ${j.user.verify_real ? '<span class="vbadge real">真人</span>' : ''}
              ${j.user.verify_student ? '<span class="vbadge real">学生</span>' : ''}
              <span class="pill gray" style="font-size:10px;">搭力 ${j.user.credit}</span>
            </div>
            ${j.message ? `<div style="font-size:13px; color:var(--text-2); margin-top:2px; white-space:pre-wrap;">${UI.esc(j.message)}</div>` : ''}
            <div style="font-size:11px; color:var(--text-3); margin-top:2px;">${UI.timeAgo(j.created_at)}申请 · ${j.status === 'pending' ? '待处理' : j.status === 'approved' ? '已通过' : j.status === 'rejected' ? '已婉拒' : '已退出'}</div>
          </div>
          ${j.status === 'pending' ? `
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button class="btn plain sm" data-reject="${j.id}">婉拒</button>
            <button class="btn primary sm" data-approve="${j.id}">通过</button>
          </div>` : ''}
        </div>`).join('');
      box.querySelectorAll('[data-approve]').forEach((b) => {
        b.onclick = async () => {
          try {
            await API.post(`/posts/${pid}/joins/${b.dataset.approve}/approve`, { approve: true });
            UI.toast('已通过，对方会收到通知');
            load();
          } catch (err) { UI.toast(err.message); }
        };
      });
      box.querySelectorAll('[data-reject]').forEach((b) => {
        b.onclick = async () => {
          try {
            await API.post(`/posts/${pid}/joins/${b.dataset.reject}/approve`, { approve: false });
            UI.toast('已婉拒');
            load();
          } catch (err) { UI.toast(err.message); }
        };
      });
    } catch (err) {
      box.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
    }
  }

  /* ---------- VD-03 FE-3：搭后关系走向三选一 ----------
   * 互评完成（自己评完即记录；"双方都评过"待 BE 在 post 详情补 my_rated 字段后自动生效）
   * 后在互评面板底部出现「你们的搭局结束了」区块：
   * 再约一场 → #/publish?category=原分类 预填；存为搭友 → 已自动（文案说明）；到此为止 → 收起为"已归档"（localStorage 记 post_id）。 */
  const ratedKey = () => `dada_rated_${pid}`;
  const relEndKey = () => `dada_rel_end_${pid}`;

  function relBlockHTML(ended) {
    if (ended) return `<div class="rel-archived" id="rel-archived">已归档 · 这场搭局就到这里</div>`;
    return `
    <div class="rel-block" id="rel-block">
      <div class="rel-title">你们的搭局结束了</div>
      <div class="rel-sub">接下来怎么走？</div>
      <div class="rel-btns">
        <button class="rel-btn primary" id="rel-again">再约一场</button>
        <button class="rel-btn" id="rel-save">存为搭友</button>
        <button class="rel-btn" id="rel-end">到此为止</button>
      </div>
      <div class="rel-note">双方完成互评后自动成为搭友，可在「我的 - 搭友列表」找到</div>
    </div>`;
  }

  function bindRelBlock(p) {
    const box = el.querySelector('#rate-panel');
    if (!box?.querySelector('#rel-block')) return;
    box.querySelector('#rel-again').onclick = () => {
      API.post(`/posts/${pid}/relationship`, { choice: 'again' }).catch(() => {}); // BE 未合入时静默降级
      App.navigate(`#/publish?category=${encodeURIComponent(p.category)}`);
    };
    box.querySelector('#rel-save').onclick = () => {
      API.post(`/posts/${pid}/relationship`, { choice: 'save' }).catch(() => {});
      UI.toast('双方完成互评后自动成为搭友，可在「我的 - 搭友列表」找到');
      App.navigate('#/partners');
    };
    box.querySelector('#rel-end').onclick = () => {
      safeStore.set(relEndKey(), '1');
      API.post(`/posts/${pid}/relationship`, { choice: 'end' }).catch(() => {});
      const blk = box.querySelector('#rel-block');
      if (blk) blk.outerHTML = relBlockHTML(true);
      UI.toast('已归档');
    };
  }

  async function loadRatePanel(p) {
    const box = el.querySelector('#rate-panel');
    try {
      const joins = await API.get(`/posts/${pid}/joins`);
      const approved = joins.filter((j) => j.status === 'approved');
      if (!approved.length) {
        box.innerHTML = `<div style="text-align:center; color:var(--text-3); font-size:13px; padding:10px;">本场没有通过任何成员，无需互评</div>`;
        return;
      }
      box.innerHTML = approved.map((j) => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:0.5px solid var(--line);">
          ${UI.avatarHTML(j.user)}
          <div style="flex:1;">
            <div style="font-size:14.5px; font-weight:650;">${UI.esc(j.user.nickname)}</div>
            <div class="stars" id="stars-${j.user.id}">${UI.starRow(5, 15)}</div>
          </div>
          <button class="btn ghost sm" data-rate="${j.user.id}">评价 TA</button>
        </div>`).join('') + `<div style="font-size:12px; color:var(--text-3); margin-top:8px;">互评完成双方各得搭力值，差评会扣分，请如实评价</div>`;
      box.querySelectorAll('[data-rate]').forEach((b) => {
        b.onclick = () => openRateSheet(parseInt(b.dataset.rate));
      });
      // VD-03 FE-3：互评完成（自己评过 / BE 契约字段 my_rated）且未归档 → 面板底部三选一区块；
      // 已选"到此为止"（localStorage 记 post_id）→ 收起为"已归档"
      const iRated = safeStore.get(ratedKey()) === '1' || p.my_rated === true;
      const ended = safeStore.get(relEndKey()) === '1';
      if (iRated || ended) {
        box.insertAdjacentHTML('beforeend', relBlockHTML(ended));
        bindRelBlock(p);
      }
    } catch (err) {
      box.innerHTML = `<div style="color:var(--danger); font-size:13px;">${UI.esc(err.message)}</div>`;
    }
  }

  function openRateSheet(rateeId) {
    let stars = 5;
    const meta = { rate_tags: ['守时', '靠谱', '友善', '有趣', '聊得来', '再次约'] };
    const s = UI.sheet('给搭子打分', `
      <div style="display:flex; justify-content:center; gap:8px; padding:8px 0; color:var(--warning);" id="star-pick"></div>
      <div style="text-align:center; font-size:13px; color:var(--text-3); margin-bottom:12px;" id="star-text">非常满意，还想再约！</div>
      <div id="tag-pick">${meta.rate_tags.map((t) => `<span class="tag" data-tag="${t}">${t}</span>`).join('')}</div>
      <textarea id="f-rc" class="textarea" aria-label="评价内容（选填）" placeholder="写点什么（选填）" style="margin-top:10px;"></textarea>
      <button class="btn primary block" id="btn-go" style="margin-top:12px;">提交评价</button>`, { cancel: true });

    const starTexts = ['', '很糟糕', '不太好', '一般般', '满意', '非常满意，还想再约！'];
    const starPick = s.el.querySelector('#star-pick');
    // EM-12：SVG 星评控件（5 星整，无半星；选中实心 fill=currentColor）
    const paintStars = (n) => {
      starPick.innerHTML = Array.from({ length: 5 }, (_, i) => UI.icon('star', 22, '', i < n)).join('');
    };
    paintStars(stars);
    [...starPick.children].forEach((svg, i) => {
      svg.style.cursor = 'pointer';
      svg.addEventListener('click', () => {
        stars = i + 1;
        paintStars(stars);
        s.el.querySelector('#star-text').textContent = starTexts[stars];
      });
    });
    const picked = new Set();
    s.el.querySelectorAll('[data-tag]').forEach((t) => {
      t.onclick = () => {
        const tag = t.dataset.tag;
        if (picked.has(tag)) { picked.delete(tag); t.classList.remove('on'); }
        else { picked.add(tag); t.classList.add('on'); }
      };
    });
    // P2：提交期间禁用，防连点重复评价
    const go = s.el.querySelector('#btn-go');
    go.onclick = async () => {
      if (go.disabled) return;
      go.disabled = true;
      try {
        await API.post(`/posts/${pid}/rate`, {
          ratee_id: rateeId, stars,
          tags: [...picked], comment: s.el.querySelector('#f-rc').value,
        });
        safeStore.set(ratedKey(), '1'); // VD-03：自己评完 → 互评面板底部出三选一
        s.close();
        UI.toast('评价成功，感谢反馈');
        load();
      } catch (err) {
        UI.toast(err.message);
        go.disabled = false;
      }
    };
  }

  await load();
});
