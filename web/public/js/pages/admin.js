/* ================= 运营后台（管理员） ================= */
App.register('admin', async (el) => {
  // H12：非管理员直链访问不再渲染完整后台骨架（避免逐 tab 403 的体验），
  // 直接给"无权访问"提示页 + 返回按钮
  const me = window.__me || await API.get('/auth/me').catch(() => null);
  if (!me?.is_admin) {
    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
        <div class="navbar-title">运营后台</div>
        <div style="width:34px;"></div>
      </div>
    </div>
    <div class="empty" style="padding-top:88px;">
      <div class="e-icon">${UI.icon('slash', 44)}</div>
      <div class="e-title">无权访问</div>
      <div style="font-size:13px">运营后台仅对管理员开放</div>
      <div style="display:flex; gap:10px; justify-content:center; margin-top:18px;">
        <button class="btn primary" id="adm-home" style="min-width:110px;">返回我的</button>
      </div>
    </div>`;
    el.querySelector('#adm-home').onclick = () => App.navigate('#/me');
    return;
  }

  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">运营后台</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div class="seg" style="margin:12px 14px;" id="seg">
    <button data-t="stats" class="selected">看板</button>
    <button data-t="reports">举报队列</button>
    <button data-t="users">用户</button>
  </div>
  <div id="panel">${UI.loading()}</div>`;

  let tab = 'stats';
  el.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.t;
      el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('selected', x === b));
      load();
    };
  });

  async function load() {
    const panel = el.querySelector('#panel');
    try {
      if (tab === 'stats') {
        const s = await API.get('/admin/stats');
        const items = [
          ['总用户', s.users, ''], ['7日新增', s.new_users_7d, 'hl'], ['周活跃', s.active_users, ''],
          ['搭局总数', s.posts, ''], ['招募中', s.open_posts, 'hl'], ['已完成', s.done_posts, ''],
          ['成搭对数', s.joins, ''], ['消息数', s.messages, ''], ['待处理举报', s.pending_reports, s.pending_reports > 0 ? 'hl' : ''],
          ['封禁用户', s.banned_users, ''],
        ];
        panel.innerHTML = `
          <div class="stat-grid">${items.map(([k, v, cls]) => `<div class="stat-card ${cls}"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
          <div style="text-align:center; color:var(--text-3); font-size:12px; padding-bottom:16px;">
            搭搭演示版数据看板 · 正式版可接入趋势图与漏斗
          </div>`;
      } else if (tab === 'reports') {
        const list = await API.get('/admin/reports?status=pending');
        if (!list.length) {
          panel.innerHTML = UI.empty('check-circle', '举报队列已清空', '社区很和谐，继续保持');
          return;
        }
        panel.innerHTML = list.map((r) => `
          <div class="card" style="margin:0 14px 10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="pill ${r.reason === '人身安全' ? 'danger' : 'yellow'}" style="${r.reason === '人身安全' ? 'background:#FEE4E2;color:var(--danger);' : ''}">${UI.esc(r.reason)}</span>
              <span class="pill gray">${{ user: '用户', post: '搭局', comment: '评论', message: '消息' }[r.target_type] || r.target_type} #${r.target_id}</span>
              <span style="flex:1"></span>
              <span style="font-size:11.5px; color:var(--text-3);">${UI.timeAgo(r.created_at)}</span>
            </div>
            <div style="margin-top:8px; font-size:13.5px;">
              <b>举报人：</b>${UI.esc(r.reporter_nickname)} · <b>对象：</b>${UI.esc(r.target_summary || '已删除')}
            </div>
            ${r.detail ? `<div style="font-size:13px; color:var(--text-2); margin-top:4px; background:var(--bg); border-radius:10px; padding:8px 10px;">${UI.esc(r.detail)}</div>` : ''}
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="btn plain sm" data-id="${r.id}" data-act="dismiss" style="flex:1;">驳回</button>
              <button class="btn plain sm" data-id="${r.id}" data-act="warn" style="flex:1;">${UI.icon('alert-triangle', 13)} 警告</button>
              <button class="btn danger sm" data-id="${r.id}" data-act="ban" style="flex:1;">封禁/下架</button>
            </div>
          </div>`).join('');
        panel.querySelectorAll('[data-act]').forEach((b) => {
          b.onclick = async () => {
            const act = b.dataset.act;
            if (act !== 'dismiss') {
              const yes = await UI.confirm(`确认执行「${{ warn: '警告并扣分', ban: '封禁/下架' }[act]}」吗？`, { okText: '执行', danger: act === 'ban' });
              if (!yes) return;
            }
            try {
              await API.post(`/admin/reports/${b.dataset.id}/resolve`, { action: act });
              UI.toast('已处理');
              load();
            } catch (err) { UI.toast(err.message); }
          };
        });
      } else if (tab === 'users') {
        const list = await API.get('/admin/users');
        panel.innerHTML = list.map((u) => `
          <div class="card" style="margin:0 14px 8px; display:flex; align-items:center; gap:10px; padding:11px 14px;">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:650; font-size:14px;">${UI.esc(u.nickname)} <span style="color:var(--text-3); font-weight:400; font-size:12px;">@${UI.esc(u.username)}</span></div>
              <div style="font-size:12px; color:var(--text-3); margin-top:1px;">
                ${UI.esc(u.city || '—')} · 搭力${u.credit} · 违规${u.warnings}次
                ${u.is_admin ? ' · <b style="color:#3B82F6">管理员</b>' : ''}
              </div>
            </div>
            ${u.is_admin ? '' : `<button class="btn ${u.status === 'banned' ? 'ghost' : 'danger'} sm" data-ban="${u.id}" data-st="${u.status}">${u.status === 'banned' ? '解封' : '封禁'}</button>`}
          </div>`).join('');
        panel.querySelectorAll('[data-ban]').forEach((b) => {
          b.onclick = async () => {
            const banning = b.dataset.st !== 'banned';
            if (banning) {
              const yes = await UI.confirm('确认封禁该用户吗？', { okText: '封禁', danger: true });
              if (!yes) return;
            }
            try {
              await API.post(`/admin/users/${b.dataset.ban}/ban`);
              UI.toast(banning ? '已封禁' : '已解封');
              load();
            } catch (err) { UI.toast(err.message); }
          };
        });
      }
    } catch (err) {
      panel.innerHTML = UI.empty('slash', '无权访问', err.message);
    }
  }

  await load();
});
