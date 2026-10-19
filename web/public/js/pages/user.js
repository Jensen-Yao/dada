/* ================= 用户主页 ================= */
App.register('user', async (el, seg) => {
  const uid = parseInt(seg[0]);
  const myId = window.__me?.id || API.savedUser()?.id;

  async function load() {
    const u = await API.get(`/users/${uid}`);
    renderUser(u);
  }

  function renderUser(u) {
    const c = UI.creditLabel(u.credit);
    // H5-09 拉黑口径：blocked_by_me 为 true 时头部挂灰 pill、底部按钮组切"取消拉黑"
    //（undefined 按 false 处理，兼容旧后端）
    const blocked = u.blocked_by_me === true;

    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
        <div class="navbar-title">TA 的主页</div>
        <button class="navbar-btn" id="btn-more" aria-label="更多">···</button>
      </div>
    </div>

    <div class="card" style="margin:14px; display:flex; gap:14px;">
      ${UI.avatarHTML(u, 'lg')}
      <div style="flex:1; min-width:0;">
        <div style="font-size:18px; font-weight:800; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${UI.esc(u.nickname)} ${UI.genderBadge(u.gender)}
          ${u.verify_real ? '<span class="vbadge real">真人认证</span>' : ''}
          ${u.verify_student ? '<span class="vbadge real">学生</span>' : ''}
          ${blocked ? '<span class="pill gray">已拉黑</span>' : ''}
        </div>
        <div style="font-size:13px; color:var(--text-3); margin-top:3px;">
          ${[u.age ? u.age + '岁' : '', u.school || u.occupation || '', u.city].filter(Boolean).join(' · ')}
          ${u.mbti ? ' · ' + UI.esc(u.mbti) : ''}
        </div>
        <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
          <span class="pill ${c.cls}">${c.text}</span>
          ${u.rating_avg ? `<span class="pill gray">${UI.icon('star', 11)} ${u.rating_avg}（${u.rating_count}条）</span>` : ''}
          ${(u.tags || []).map((t) => `<span class="pill gray">${UI.esc(t)}</span>`).join('')}
        </div>
      </div>
    </div>

    ${u.bio ? `<div class="card" style="margin:0 14px 12px; font-size:14px; color:var(--text-2); line-height:1.65;">${UI.esc(u.bio)}</div>` : ''}

    <div class="me-stats" style="margin:0 14px 14px;">
      <div class="me-stat"><b>${u.post_count}</b><span>发布的局</span></div>
      <div class="me-stat"><b>${u.rating_count || 0}</b><span>收到的评价</span></div>
      <div class="me-stat"><b>${u.recent_done?.length || 0}</b><span>完成的局</span></div>
    </div>

    ${u.rating_tags?.length ? `
    <div class="section-title">大家这样评价 TA</div>
    <div class="card" style="margin:0 14px 12px;">
      ${tallyTags(u.rating_tags).map(([t, n]) => `<span class="pill" style="margin:2px 4px 2px 0;">${UI.esc(t)} ×${n}</span>`).join('')}
    </div>` : ''}

    ${u.recent_done?.length ? `
    <div class="section-title">搭子履历</div>
    <div class="wf" style="padding-top:0;">
      ${u.recent_done.map((p) => UI.pinCard(p, { history: true })).join('')}
    </div>` : ''}

    ${myId !== u.id ? `
    <div style="padding:6px 14px 20px; display:flex; gap:10px;">
      ${blocked
        ? `<button class="btn plain sm" id="btn-unblock" style="flex:1;">${UI.icon('slash', 13)} 取消拉黑</button>`
        : `<button class="btn danger sm" id="btn-block" style="flex:1;">${UI.icon('slash', 13)} 拉黑</button>`}
      <button class="btn plain sm" id="btn-report" style="flex:1;">${UI.icon('flag', 13)} 举报</button>
    </div>` : ''}`;

    el.querySelectorAll('.pin-card[data-id]').forEach((card) => {
      card.onclick = () => App.navigate('#/post/' + card.dataset.id);
    });

    el.querySelector('#btn-more').onclick = () => {};
    el.querySelector('#btn-block')?.addEventListener('click', async () => {
      const yes = await UI.confirm(`确定拉黑 <b>${UI.esc(u.nickname)}</b> 吗？`, { okText: '拉黑', danger: true });
      if (!yes) return;
      try {
        await API.post(`/users/${uid}/block`);
        UI.toast('已拉黑');
        history.back();
      } catch (err) { UI.toast(err.message); }
    });
    // H5-09：已拉黑态的解除入口（DELETE /users/:id/block），成功后原地重渲染回普通态
    el.querySelector('#btn-unblock')?.addEventListener('click', async () => {
      try {
        await API.del(`/users/${uid}/block`);
        UI.toast('已取消拉黑');
        await load();
      } catch (err) { UI.toast(err.message); }
    });
    el.querySelector('#btn-report')?.addEventListener('click', () => {
      const reasons = ['骚扰', '欺诈', '虚假信息', '言语辱骂', '人身安全', '其他'];
      const s = UI.sheet('举报 ' + UI.esc(u.nickname), `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${reasons.map((r) => `<button class="btn plain" data-r="${r}">${r}</button>`).join('')}
      </div>`, { cancel: true });
      s.el.querySelectorAll('[data-r]').forEach((b) => {
        b.onclick = async () => {
          try {
            await API.post(`/users/${uid}/report`, { reason: b.dataset.r });
            s.close();
            UI.toast('已收到举报，我们会尽快核实');
          } catch (err) { UI.toast(err.message); }
        };
      });
    });
  }

  function tallyTags(tags) {
    const m = new Map();
    for (const t of tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }

  await load();
});
