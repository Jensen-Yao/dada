/* ================= 搭局详情页 ================= */
App.register('post', async (el, seg) => {
  const pid = parseInt(seg[0]);
  let post = null;
  let me = API.isLogin() ? await API.get('/auth/me').catch(() => null) : null;

  function metaRow(icon, text) {
    return `<div style="display:flex; gap:8px; margin-bottom:9px; font-size:14px; color:var(--text-2); align-items:flex-start;">
      <span style="flex-shrink:0">${icon}</span><span>${UI.esc(text)}</span></div>`;
  }

  function statusPill(p) {
    const map = {
      open: ['招募中', 'green'], full: ['已满员', 'gray'], closed: ['已关闭', 'gray'],
      done: ['已完成', 'blue'], expired: ['已过期', 'gray'],
    };
    const [text, cls] = map[p.status] || ['未知', 'gray'];
    return `<span class="pill ${cls}">${text}</span>`;
  }

  async function load() {
    post = await API.get(`/posts/${pid}`);
    me = API.isLogin() ? await API.get('/auth/me').catch(() => null) : null;
    render();
  }

  function render() {
    const p = post;
    const c = UI.creditLabel(p.author.credit);
    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" onclick="history.back()">‹</button>
        <div class="navbar-title">${UI.esc(p.category_name)}搭局</div>
        <button class="navbar-btn" id="btn-share">⤴</button>
      </div>
    </div>

    <div class="card" style="margin:14px;">
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div class="post-emoji" style="width:58px; height:58px; font-size:30px;">${p.category_emoji}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:18px; font-weight:800; line-height:1.4;">${UI.esc(p.title)}</div>
          <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${statusPill(p)}<span class="pill">${UI.esc(p.fee_mode_name)}</span>${p.gender_req !== 'any' ? `<span class="pill blue">${p.gender_req === 'female' ? '♀ 仅限女生' : '♂ 仅限男生'}</span>` : ''}</div>
        </div>
      </div>
      ${p.content ? `<div style="margin-top:12px; font-size:14.5px; line-height:1.7; color:var(--text); white-space:pre-wrap;">${UI.esc(p.content)}</div>` : ''}
      <div style="margin-top:14px; padding-top:12px; border-top:0.5px solid var(--line);">
        ${metaRow('📍', `${UI.esc(p.city)}${p.location_name ? ' · ' + UI.esc(p.location_name) : ''}`)}
        ${p.meet_time ? metaRow('🕐', UI.esc(p.meet_time)) : ''}
        ${metaRow('👥', `已通过 ${p.approved_count} / ${p.need_count} 人${p.status === 'open' ? `，还缺 ${Math.max(0, p.need_count - p.approved_count)} 人` : ''}`)}
        ${p.requirements ? metaRow('📝', UI.esc(p.requirements)) : ''}
        ${metaRow('👀', `${p.views_count} 次浏览 · ${UI.timeAgo(p.created_at)}发布`)}
      </div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="btn plain sm" id="btn-like" style="flex:1;">${p.liked ? '❤️ 已赞' : '🤍 想去'} ${p.likes_count}</button>
        <button class="btn primary sm" id="btn-join" style="flex:2;">${joinBtnText()}</button>
      </div>
    </div>

    <!-- 作者卡片 -->
    <div class="card" style="margin:0 14px 12px; display:flex; align-items:center; gap:12px;" id="author-card">
      ${UI.avatarHTML(p.author, 'lg')}
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:15.5px; display:flex; align-items:center; gap:6px;">
          ${UI.esc(p.author.nickname)} ${UI.genderBadge(p.author.gender)}
          ${p.author.verify_real ? '<span class="vbadge real">已真人认证</span>' : ''}
          ${p.author.verify_student ? '<span class="vbadge real">🎓 学生</span>' : ''}
        </div>
        <div style="font-size:12.5px; color:var(--text-3); margin-top:2px;">
          ${UI.esc(p.author.school || p.author.occupation || '搭友')} · ${p.author.age ? p.author.age + '岁 · ' : ''}${UI.esc(p.author.city)}
        </div>
        <div style="margin-top:4px;"><span class="pill ${c.cls}">${c.text}</span>${p.author.rating_avg ? `<span class="pill gray">⭐ ${p.author.rating_avg}</span>` : ''}</div>
      </div>
      <span class="cell-arrow">›</span>
    </div>

    <!-- 组局者：申请管理 / 完成搭局 -->
    ${p.is_author && ['open', 'full'].includes(p.status) ? `
    <div class="section-title">📋 申请管理</div>
    <div id="join-list">${UI.loading()}</div>
    <div style="padding:0 14px 12px;">
      <button class="btn ghost block" id="btn-done">✅ 搭局已完成（开启互评）</button>
    </div>` : ''}

    ${p.is_author && p.status === 'done' ? `
    <div class="section-title">⭐ 搭后互评</div>
    <div class="card" style="margin:0 14px 12px;" id="rate-panel">${UI.loading()}</div>` : ''}

    <!-- 评论区 -->
    <div class="section-title">💬 评论区（${p.comments_count}）</div>
    <div id="comments">${UI.loading()}</div>
    ${API.isLogin() ? `
    <div style="padding:0 14px 20px;">
      <div style="display:flex; gap:8px;">
        <input id="f-comment" class="input" placeholder="友善发言，共同维护搭子氛围…" style="flex:1;">
        <button class="btn primary sm" id="btn-comment">发送</button>
      </div>
    </div>` : ''}
    `;

    bind(p);
    if (p.is_author && ['open', 'full'].includes(p.status)) loadJoins(p);
    if (p.is_author && p.status === 'done') loadRatePanel(p);
    loadComments(p);
  }

  function joinBtnText() {
    const p = post;
    if (!API.isLogin()) return '登录后申请加入';
    if (p.is_author) return '这是我发布的搭局';
    if (p.status !== 'open') return '该搭局已停止招募';
    if (p.my_join === 'pending') return '⏳ 已申请，等待组局者通过';
    if (p.my_join === 'approved') return '✅ 已通过，去聊天';
    if (p.my_join === 'rejected') return '重新申请';
    return '申请加入';
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
    el.querySelector('#btn-like').onclick = async () => {
      if (!API.isLogin()) return UI.requireLogin();
      try {
        const r = await API.post(`/posts/${pid}/like`);
        post.liked = r.liked;
        post.likes_count += r.liked ? 1 : -1;
        render();
      } catch (err) { UI.toast(err.message); }
    };
    el.querySelector('#btn-join').onclick = onJoin;
    el.querySelector('#btn-comment')?.addEventListener('click', onComment);
    el.querySelector('#f-comment')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') onComment(); });
    el.querySelector('#btn-done')?.addEventListener('click', async () => {
      const yes = await UI.confirm('确认这场搭局已经顺利完成了？<br><span style="font-size:12.5px;color:var(--text-3)">完成后将开启搭后互评，双方互评可获得搭力值</span>', { okText: '完成了' });
      if (!yes) return;
      try {
        await API.put(`/posts/${pid}`, { status: 'done' });
        UI.toast('已开启互评 🎉');
        load();
      } catch (err) { UI.toast(err.message); }
    });
  }

  async function onJoin() {
    if (!API.isLogin()) return UI.requireLogin();
    const p = post;
    if (p.is_author || p.status !== 'open') return;
    if (p.my_join === 'pending') return;
    const s = UI.sheet('申请加入「' + UI.esc(p.title.slice(0, 20)) + '」', `
      <textarea id="f-msg" class="textarea" placeholder="和组局者打个招呼吧：为什么想加入、你能满足什么要求…（选填）"></textarea>
      <button class="btn primary block" id="btn-go" style="margin-top:12px;">提交申请</button>`);
    s.el.querySelector('#btn-go').onclick = async () => {
      try {
        await API.post(`/posts/${pid}/join`, { message: s.el.querySelector('#f-msg').value });
        s.close();
        UI.toast('已提交申请，等待组局者通过 🙌');
        load();
      } catch (err) { UI.toast(err.message); }
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
      post.comments_count++;
    } catch (err) { UI.toast(err.message); }
  }

  async function loadComments(p) {
    const box = el.querySelector('#comments');
    try {
      const list = await API.get(`/posts/${pid}/comments`);
      if (!list.length) {
        box.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-3); font-size:13px;">还没有评论，来抢沙发～</div>`;
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
      box.innerHTML = UI.empty('😵', '评论加载失败', err.message);
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
              ${j.user.verify_student ? '<span class="vbadge real">🎓</span>' : ''}
              <span class="pill gray" style="font-size:10px;">搭力 ${j.user.credit}</span>
            </div>
            ${j.message ? `<div style="font-size:13px; color:var(--text-2); margin-top:2px; white-space:pre-wrap;">${UI.esc(j.message)}</div>` : ''}
            <div style="font-size:11px; color:var(--text-3); margin-top:2px;">${UI.timeAgo(j.created_at)}申请 · ${j.status === 'pending' ? '待处理' : j.status === 'approved' ? '✅ 已通过' : j.status === 'rejected' ? '已婉拒' : '已退出'}</div>
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
            UI.toast('已通过 ✅ 对方会收到通知');
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
      box.innerHTML = UI.empty('😵', '加载失败', err.message);
    }
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
            <div class="stars" id="stars-${j.user.id}">★★★★★</div>
          </div>
          <button class="btn ghost sm" data-rate="${j.user.id}">评价 TA</button>
        </div>`).join('') + `<div style="font-size:12px; color:var(--text-3); margin-top:8px;">互评完成双方各得搭力值，差评会扣分，请如实评价</div>`;
      box.querySelectorAll('[data-rate]').forEach((b) => {
        b.onclick = () => openRateSheet(parseInt(b.dataset.rate));
      });
    } catch (err) {
      box.innerHTML = `<div style="color:var(--danger); font-size:13px;">${UI.esc(err.message)}</div>`;
    }
  }

  function openRateSheet(rateeId) {
    let stars = 5;
    const meta = { rate_tags: ['守时', '靠谱', '友善', '有趣', '聊得来', '再次约'] };
    const s = UI.sheet('给搭子打分', `
      <div style="text-align:center; font-size:34px; letter-spacing:6px; padding:6px 0;" id="star-pick">★★★★★</div>
      <div style="text-align:center; font-size:13px; color:var(--text-3); margin-bottom:12px;" id="star-text">非常满意，还想再约！</div>
      <div id="tag-pick">${meta.rate_tags.map((t) => `<span class="tag" data-tag="${t}">${t}</span>`).join('')}</div>
      <textarea id="f-rc" class="textarea" placeholder="写点什么（选填）" style="margin-top:10px;"></textarea>
      <button class="btn primary block" id="btn-go" style="margin-top:12px;">提交评价</button>`);

    const starTexts = ['', '很糟糕', '不太好', '一般般', '满意', '非常满意，还想再约！'];
    const starPick = s.el.querySelector('#star-pick');
    starPick.onclick = (e) => {
      const rect = starPick.getBoundingClientRect();
      const x = e.clientX - rect.left;
      stars = Math.max(1, Math.min(5, Math.ceil((x / rect.width) * 5)));
      starPick.innerHTML = '★'.repeat(stars) + '☆'.repeat(5 - stars);
      starPick.style.color = 'var(--accent)';
      s.el.querySelector('#star-text').textContent = starTexts[stars];
    };
    const picked = new Set();
    s.el.querySelectorAll('[data-tag]').forEach((t) => {
      t.onclick = () => {
        const tag = t.dataset.tag;
        if (picked.has(tag)) { picked.delete(tag); t.classList.remove('on'); }
        else { picked.add(tag); t.classList.add('on'); }
      };
    });
    s.el.querySelector('#btn-go').onclick = async () => {
      try {
        await API.post(`/posts/${pid}/rate`, {
          ratee_id: rateeId, stars,
          tags: [...picked], comment: s.el.querySelector('#f-rc').value,
        });
        s.close();
        UI.toast('评价成功，感谢反馈 💛');
        load();
      } catch (err) { UI.toast(err.message); }
    };
  }

  await load();
});
