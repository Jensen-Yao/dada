/* ================= 我的页面 ================= */
App.register('me', async (el) => {
  const me = await API.get('/auth/me');
  window.__me = me;
  const c = UI.creditLabel(me.credit);
  const pct = Math.min(100, Math.round(((me.credit - 300) / 500) * 100));

  el.innerHTML = `
  <div class="me-header">
    <div class="me-row">
      ${UI.avatarHTML(me, 'xl')}
      <div style="flex:1; min-width:0;">
        <div class="me-name">
          ${UI.esc(me.nickname)} ${UI.genderBadge(me.gender)}
          ${me.verify_real ? '<span class="vbadge solid">已真人认证</span>' : ''}
          ${me.verify_student ? '<span class="vbadge stu">🎓 学生认证</span>' : ''}
        </div>
        <div class="me-bio">${UI.esc(me.bio || (me.city ? '📍 ' + me.city : '还没写简介，点下方编辑资料'))}</div>
        <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap;">
          ${me.mbti ? `<span class="vbadge stu">${UI.esc(me.mbti)}</span>` : ''}
          ${(me.tags || []).slice(0, 4).map((t) => `<span class="vbadge stu">${UI.esc(t)}</span>`).join('')}
        </div>
      </div>
      <button class="navbar-btn" id="btn-edit" style="color:#fff; font-size:13px; background:rgba(255,255,255,0.2); border-radius:10px; width:auto; padding:0 10px; height:30px;">编辑</button>
    </div>
  </div>

  <div class="me-credit">
    <div class="credit-ring" style="--p:${pct}; position:relative;"><span>${me.credit}</span></div>
    <div style="flex:1;">
      <div style="font-weight:800; font-size:15px;">搭力值 <span class="pill ${c.cls}">${c.text}</span></div>
      <div style="font-size:12px; color:var(--text-3); margin-top:2px; line-height:1.5;">
        ${me.credit < 300 ? '⚠️ 搭力值不足300，暂不能发布新搭局' : '认证、完成搭局、获得好评都能涨分'}
      </div>
    </div>
    <button class="btn ghost sm" id="btn-verify">去认证</button>
  </div>

  <div class="me-stats">
    <div class="me-stat"><b>${me.post_count}</b><span>发布的局</span></div>
    <div class="me-stat"><b>${me.joined_count || 0}</b><span>参加的局</span></div>
    <div class="me-stat"><b>${me.rating_avg ?? '—'}</b><span>搭后评分</span></div>
  </div>

  <div style="margin:0 14px 14px; border-radius:16px; overflow:hidden; box-shadow:var(--shadow);">
    <div class="cell" id="c-myposts"><span class="cell-icon">🗂️</span><span class="cell-main">我的搭局</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-ratings"><span class="cell-icon">⭐</span><span class="cell-main">收到的评价</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-safety"><span class="cell-icon">🛡️</span><span class="cell-main">安全中心</span><span class="cell-arrow">›</span></div>
    ${me.is_admin ? '<div class="cell" id="c-admin"><span class="cell-icon">📊</span><span class="cell-main">运营后台</span><span class="pill blue">管理员</span><span class="cell-arrow">›</span></div>' : ''}
    <div class="cell" id="c-settings"><span class="cell-icon">⚙️</span><span class="cell-main">设置</span><span class="cell-arrow">›</span></div>
  </div>

  <div style="text-align:center; color:var(--text-3); font-size:11.5px; padding-bottom:8px;">搭搭 v1.0 · 轻社交 · 不婚恋 · 有边界</div>`;

  el.querySelector('#btn-edit').onclick = () => App.navigate('#/edit-profile');
  el.querySelector('#btn-verify').onclick = openVerify;
  el.querySelector('#c-myposts').onclick = () => App.navigate('#/myposts');
  el.querySelector('#c-ratings').onclick = () => App.navigate('#/ratings');
  el.querySelector('#c-safety').onclick = () => App.navigate('#/safety');
  el.querySelector('#c-admin')?.addEventListener('click', () => App.navigate('#/admin'));
  el.querySelector('#c-settings').onclick = () => App.navigate('#/settings');

  function openVerify() {
    const s = UI.sheet('提升信任度', `
      <div style="font-size:13px; color:var(--text-2); line-height:1.6; margin-bottom:14px;">
        认证能大幅提高成搭率：搭友更敢报名你的局，你也更容易通过别人的申请。
      </div>
      <button class="btn plain block" id="v-real" style="margin-bottom:10px; justify-content:flex-start; gap:10px;">
        <span style="font-size:22px;">🪪</span>
        <span style="text-align:left;"><b>真人认证</b> <span class="pill green">+50 搭力值</span><br><span style="font-size:12px;color:var(--text-3)">演示环境一键通过（正式版走人脸核验）</span></span>
        ${me.verify_real ? '<span class="pill green">已通过</span>' : ''}
      </button>
      <button class="btn plain block" id="v-stu" style="justify-content:flex-start; gap:10px;">
        <span style="font-size:22px;">🎓</span>
        <span style="text-align:left;"><b>学生认证</b> <span class="pill green">+30 搭力值</span><br><span style="font-size:12px;color:var(--text-3)">填写学校名称（正式版验证学籍）</span></span>
        ${me.verify_student ? '<span class="pill green">已通过</span>' : ''}
      </button>`);
    s.el.querySelector('#v-real').onclick = async () => {
      if (me.verify_real) return UI.toast('已通过真人认证');
      try {
        await API.post('/users/me/verify', { type: 'real' });
        s.close(); UI.toast('真人认证通过，+50 搭力值 🎉');
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
          UI.toast('学生认证通过，+30 搭力值 🎓');
          setTimeout(() => { location.hash = '#/square'; setTimeout(() => { location.hash = '#/me'; }, 60); }, 60);
        } catch (err) { UI.toast(err.message); }
      };
    };
  }
});
