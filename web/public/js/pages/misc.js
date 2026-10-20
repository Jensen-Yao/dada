/* ================= 编辑资料 ================= */
App.register('edit-profile', async (el) => {
  const me = await API.get('/auth/me');
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">编辑资料</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div style="display:flex; justify-content:center; padding:20px 0 6px;">
    <div style="position:relative; text-align:center;">
      <div id="avatar-wrap">${UI.avatarHTML(me, 'xl')}</div>
      <button class="btn ghost sm" id="btn-avatar" style="margin-top:8px;">换头像</button>
      <input type="file" id="f-avatar" accept="image/*" class="hidden">
    </div>
  </div>
  <div class="form">
    <div class="form-item"><label for="f-nick">昵称</label><input id="f-nick" class="input" maxlength="20" value="${UI.esc(me.nickname)}"></div>
    <div class="form-item"><label for="f-gender">性别</label>
      <select id="f-gender" class="select">
        <option value="secret" ${me.gender === 'secret' ? 'selected' : ''}>保密</option>
        <option value="female" ${me.gender === 'female' ? 'selected' : ''}>女生</option>
        <option value="male" ${me.gender === 'male' ? 'selected' : ''}>男生</option>
      </select>
    </div>
    <div class="form-item"><label for="f-birth">出生年份</label><input id="f-birth" class="input" type="number" placeholder="如 2000" value="${me.age ? new Date().getFullYear() - me.age : ''}"></div>
    <div class="form-item"><label for="f-city">城市</label><input id="f-city" class="input" value="${UI.esc(me.city || '')}" placeholder="如 北京"></div>
    <div class="form-item"><label for="f-occ">学校 / 职业</label><input id="f-occ" class="input" maxlength="60" value="${UI.esc(me.school || me.occupation || '')}" placeholder="如 北京大学 / 产品经理"></div>
    <div class="form-item"><label for="f-mbti">MBTI</label>
      <select id="f-mbti" class="select">
        <option value="">不填</option>
        ${['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP']
          .map((m) => `<option value="${m}" ${me.mbti === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="form-item"><label for="f-bio">个性签名</label><textarea id="f-bio" class="textarea" maxlength="200" placeholder="一句话介绍自己，让搭子更快了解你">${UI.esc(me.bio || '')}</textarea><div id="bio-count" style="text-align:right; font-size:11px; color:var(--text-3); margin-top:2px;"></div></div>
    <div class="form-item">
      <label id="l-tags">兴趣标签（点击切换）</label>
      <div id="tag-pick" role="group" aria-labelledby="l-tags" style="display:flex; flex-wrap:wrap; gap:0;">
        ${['美食', '运动', '健身', '跑步', '自习', '读书', '旅行', '徒步', '露营', 'livehouse', '摇滚', '游戏', '剧本杀', '桌游', '电影', '摄影', '扫街', '咖啡', '探店', '逛街', '遛狗', '猫奴', '拼车', '飞盘', '爬山', '骑行', '羽毛球', '滑雪']
          .map((t) => `<span class="tag ${(me.tags || []).includes(t) ? 'on' : ''}" data-tag="${t}">${t}</span>`).join('')}
      </div>
    </div>
    <button class="btn primary block" id="btn-save">保存</button>
  </div>`;

  const picked = new Set(me.tags || []);

  // H5：签名与服务端上限（60 字）对齐，maxlength 截断 + 实时字数，不再静默吞字
  const fBio = el.querySelector('#f-bio');
  const bioCount = el.querySelector('#bio-count');
  const paintBioCount = () => { bioCount.textContent = `${fBio.value.length}/200`; };
  fBio.addEventListener('input', paintBioCount);
  paintBioCount();
  el.querySelectorAll('[data-tag]').forEach((t) => {
    t.onclick = () => {
      const tag = t.dataset.tag;
      if (picked.has(tag)) { picked.delete(tag); t.classList.remove('on'); }
      else if (picked.size >= 10) { UI.toast('最多选 10 个标签'); }
      else { picked.add(tag); t.classList.add('on'); }
    };
  });

  el.querySelector('#btn-avatar').onclick = () => el.querySelector('#f-avatar').click();
  el.querySelector('#f-avatar').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return UI.toast('图片不能超过 5MB');
    try {
      const r = await API.uploadAvatar(file);
      el.querySelector('#avatar-wrap').innerHTML = `<div class="avatar xl"><img src="${UI.esc(r.avatar)}"></div>`;
      UI.toast('头像已更新');
    } catch (err) { UI.toast(err.message); }
  });

  el.querySelector('#btn-save').onclick = async () => {
    try {
      await API.put('/users/me', {
        nickname: el.querySelector('#f-nick').value.trim(),
        gender: el.querySelector('#f-gender').value,
        birth_year: parseInt(el.querySelector('#f-birth').value) || undefined,
        city: el.querySelector('#f-city').value.trim(),
        occupation: el.querySelector('#f-occ').value.trim(),
        mbti: el.querySelector('#f-mbti').value,
        bio: el.querySelector('#f-bio').value.trim(),
        tags: [...picked],
      });
      UI.toast('已保存');
      history.back();
    } catch (err) { UI.toast(err.message); }
  };
});

/* ================= 我的搭局 ================= */
App.register('myposts', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">我的搭局</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div class="seg" style="margin:12px 14px;" id="seg">
    <button data-t="published" class="selected">我发布的</button>
    <button data-t="joined">我参加的</button>
  </div>
  <div id="list">${UI.loading()}</div>`;

  let type = 'published';
  // R2-N2: 无发布记录的新用户默认落在"我参加的"，避免首屏空态（小林#3）
  try {
    const published = await API.get('/my/posts/published');
    if (!published.length) {
      type = 'joined';
      el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('selected', x.dataset.t === 'joined'));
    }
  } catch { /* 保持默认 */ }
  el.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = async () => {
      type = b.dataset.t;
      el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('selected', x === b));
      await load();
    };
  });

  async function load() {
    const box = el.querySelector('#list');
    const list = await API.get(`/my/posts/${type}`);
    if (!list.length) {
      box.innerHTML = UI.empty('folder', '还没有内容', type === 'published' ? '去发布你的第一个搭局吧' : '去广场看看感兴趣的搭局');
      return;
    }
    const statusMap = { open: ['招募中', 'green'], full: ['已满员', 'gray'], done: ['已完成', 'blue'], closed: ['已关闭', 'gray'] };
    box.innerHTML = list.map((p) => {
      const [st, cls] = statusMap[p.status] || ['未知', 'gray'];
      const jm = p.my_join === 'pending' ? ['申请中', 'yellow'] : p.my_join === 'approved' ? ['已通过', 'green'] : p.my_join === 'rejected' ? ['未通过', 'gray'] : null;
      return `
      <div class="card post-card" data-id="${p.id}" role="link" tabindex="0" aria-label="${UI.esc(p.title)}" onkeydown="if(event.key==='Enter')App.navigate('#/post/${p.id}')">
        <div class="post-emoji">${UI.catIcon(p.category, 26)}</div>
        <div class="post-main">
          <div style="display:flex; gap:6px; align-items:flex-start;">
            <div class="post-title" style="flex:1">${UI.esc(p.title)}</div>
            <div style="display:flex; gap:4px; flex-shrink:0;">
              ${jm ? `<span class="pill ${jm[1]}">${jm[0]}</span>` : `<span class="pill ${cls}">${st}</span>`}
            </div>
          </div>
          <div class="post-meta">
            <span class="pill gray">${UI.icon('location', 11)} ${UI.esc(p.city)}</span>
            ${p.meet_time ? `<span class="pill gray">${UI.icon('clock', 11)} ${UI.esc(p.meet_time)}</span>` : ''}
            ${type === 'published' ? `<span class="pill gray">已通过 ${p.approved_count}/${p.need_count}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-id]').forEach((c) => {
      c.onclick = () => App.navigate('#/post/' + c.dataset.id);
    });
  }
  await load();
});

/* ================= 收到的评价 ================= */
App.register('ratings', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">收到的评价</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div id="list">${UI.loading()}</div>`;
  const list = await API.get('/users/me/ratings');
  const box = el.querySelector('#list');
    if (!list.length) {
      box.innerHTML = UI.empty('star', '还没有评价', '完成搭局后互相评价，积累你的搭子信用');
      return;
    }
  box.innerHTML = list.map((r) => `
    <div class="card" style="margin:0 14px 10px;">
      <div style="display:flex; align-items:center; gap:10px;">
        ${UI.avatarHTML(r.rater)}
        <div style="flex:1;">
          <div style="font-weight:650; font-size:14px;">${UI.esc(r.rater.nickname)}</div>
          <div style="font-size:12px; color:var(--text-3);">${UI.timeAgo(r.created_at)} · ${UI.esc(r.post_title?.slice(0, 18) || '')}</div>
        </div>
        <div class="stars">${UI.starRow(r.stars, 15)}</div>
      </div>
      ${r.tags?.length ? `<div style="margin-top:8px;">${r.tags.map((t) => `<span class="pill">${UI.esc(t)}</span>`).join(' ')}</div>` : ''}
      ${r.comment ? `<div style="font-size:13.5px; color:var(--text-2); margin-top:6px; white-space:pre-wrap;">${UI.esc(r.comment)}</div>` : ''}
    </div>`).join('');
});

/* ================= 通知中心 ================= */
App.register('notifications', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">通知</div>
      <button class="navbar-btn" id="btn-read-all" style="font-size:12px; width:auto; padding:0 8px;">全部已读</button>
    </div>
  </div>
  <div id="list">${UI.loading()}</div>`;

  // EM-05：10 类通知线性图标映射（G.4 表）
  const icons = { like: 'heart', comment: 'comment', join_request: 'user-plus', join_result: 'check-circle', rating: 'star', credit: 'zap', warning: 'alert-triangle', sos: 'phone-call', report_result: 'shield', post_done: 'check' };

  async function load() {
    const list = await API.get('/notifications');
    const box = el.querySelector('#list');
    if (!list.length) {
      box.innerHTML = UI.empty('bell', '没有通知', '申请、点赞、评价都会出现在这里');
      return;
    }
    box.innerHTML = list.map((n) => `
      <div class="notif-item${n.data?.post_id ? ' notif-link' : ''}" data-nid="${n.id}" data-post="${n.data?.post_id || ''}" style="${n.read ? 'opacity:0.6;' : ''}" ${n.data?.post_id ? 'role="link" tabindex="0" aria-label="' + UI.esc(n.title) + '，查看详情"' : ''}>
        <div class="notif-icon${n.type === 'sos' || n.type === 'warning' ? ' danger' : ''}">${UI.icon(icons[n.type] || 'bell', 16)}</div>
        <div class="notif-body">
          <div class="notif-title">${UI.esc(n.title)} ${n.read ? '' : '<span style="display:inline-block;width:7px;height:7px;background:var(--danger);border-radius:50%;margin-left:4px;"></span>'}</div>
          <div class="notif-text">${UI.esc(n.body)}</div>
          <div style="font-size:11px; color:var(--text-3); margin-top:2px;">${UI.timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('');
    // 用户批评R1[搭子王#2]：带 post_id 的通知深链到帖子详情（申请/点赞/互评等可一步到达现场）；
    // credit/warning 等无 post_id 的通知保持不可点
    box.querySelectorAll('.notif-item').forEach((item) => {
      const pid = parseInt(item.dataset.post, 10);
      if (!pid) return;
      const go = () => App.navigate('#/post/' + pid);
      item.onclick = go;
      item.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
  }

  el.querySelector('#btn-read-all').onclick = async () => {
    await API.post('/notifications/read', {});
    await load();
    App.refreshBadges();
    UI.toast('已全部标记为已读');
  };

  await load();
  // R2-N4: 停留 5 秒后才标全读，避免"进页即清角标"（深链跳转者保留未读态）
  const readTimer = setTimeout(async () => {
    await API.post('/notifications/read', {}).catch(() => {});
    App.refreshBadges();
  }, 5000);
  App.onCleanup(() => clearTimeout(readTimer));
});

/* ================= 我的举报记录（C7：举报进度可回查） ================= */
App.register('my-reports', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">我的举报记录</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div id="list">${UI.loading()}</div>`;

  const box = el.querySelector('#list');
  try {
    const list = await API.get('/reports/mine');
    if (!list.length) {
      box.innerHTML = UI.empty('shield', '暂无举报记录', '提交举报后可在这里查看处理进度');
      return;
    }
    const targetName = { user: '用户', post: '搭局', comment: '评论', message: '消息' };
    box.innerHTML = list.map((r) => {
      const resolved = r.status === 'resolved';
      return `
      <div class="card rp-item">
        <div class="rp-head">
          <span class="rp-reason">${UI.icon('flag', 14)} ${UI.esc(r.reason || '其他')}</span>
          <span class="pill ${resolved ? 'gray' : 'yellow'}">${resolved ? '已处理' : '处理中'}</span>
        </div>
        ${r.detail ? `<div class="rp-detail">${UI.esc(String(r.detail).slice(0, 80))}${String(r.detail).length > 80 ? '…' : ''}</div>` : ''}
        <div class="rp-meta">举报对象：${targetName[r.target_type] || '内容'} #${r.target_id} · ${UI.timeAgo(r.created_at)}</div>
      </div>`;
    }).join('');
  } catch (err) {
    box.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
  }
});

/* ================= 安全中心 ================= */
App.register('safety', async (el) => {
  const tips = await API.get('/safety/tips');
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">安全中心</div>
      <div style="width:34px;"></div>
    </div>
  </div>

  <!-- EM-06：SOS 主按钮，--danger 实底，无装饰 -->
  <div class="card sos-card" style="margin:14px;">
    <span class="sos-ico">${UI.icon('phone-call', 30)}</span>
    <div style="flex:1;">
      <div style="font-weight:800;">紧急求助</div>
      <div style="font-size:12.5px; color:var(--text-2); margin-top:2px;">人身安全受威胁时优先拨打 110</div>
    </div>
    <button class="sos-btn" id="btn-sos">紧急求助</button>
  </div>

  <div class="section-title">安全须知</div>
  ${tips.emergency.map((t) => `
    <div class="tip-card">
      <div class="tip-icon">${UI.icon(t.icon, 18)}</div>
      <div><div class="tip-title">${UI.esc(t.title)}</div><div class="tip-body">${UI.esc(t.body)}</div></div>
    </div>`).join('')}

  <div class="section-title">社区公约</div>
  <div class="card" style="margin:0 14px 20px; font-size:13.5px; color:var(--text-2); line-height:1.9;">
    ${tips.community_rules.map((r, i) => `${i + 1}. ${UI.esc(r)}<br>`).join('')}
  </div>`;

  el.querySelector('#btn-sos').onclick = async () => {
    const yes = await UI.confirm('确认发起<b>紧急求助</b>吗？<br><span style="font-size:12px;color:var(--text-3)">平台风控会立即收到你的求助信息</span>', { okText: '立即求助', danger: true });
    if (!yes) return;
    const s = UI.sheet('紧急求助', `
      <input id="f-loc" class="input" aria-label="当前位置" placeholder="当前位置（如：五道口地铁站）">
      <textarea id="f-note" class="textarea" aria-label="情况描述（选填）" style="margin-top:10px;" placeholder="描述情况（选填）"></textarea>
      <button class="btn danger block" id="btn-go" style="margin-top:12px;">发送求助</button>
      <div style="text-align:center; margin-top:10px; font-size:12.5px; color:var(--danger);">如遇人身危险，请立即拨打 110</div>`, { cancel: true });
    s.el.querySelector('#btn-go').onclick = async () => {
      try {
        const r = await API.post('/safety/sos', {
          location: s.el.querySelector('#f-loc').value.trim(),
          note: s.el.querySelector('#f-note').value.trim(),
        });
        s.close();
        UI.toast(r.message || '求助已发出');
      } catch (err) { UI.toast(err.message); }
    };
  };
});

/* ================= 设置 ================= */
App.register('settings', async (el) => {
  const me = await API.get('/auth/me');
  // 合规：个性化推荐开关状态以 /auth/me 的 rec_off 为准（BE 未返回时默认开启）
  let recOff = me.rec_off === 1 || me.rec_off === true;
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">设置</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div style="margin:14px; border-radius:16px; overflow:hidden; box-shadow:var(--shadow);">
    <div class="cell"><span class="cell-icon">${UI.icon('smartphone', 18)}</span><span class="cell-main">账号</span><span style="color:var(--text-3); font-size:13px;">${UI.esc(me.id ? '用户 #' + me.id : '')}</span></div>
    <div class="cell" id="c-safety2"><span class="cell-icon">${UI.icon('shield', 18)}</span><span class="cell-main">安全中心</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-reports"><span class="cell-icon">${UI.icon('flag', 18)}</span><span class="cell-main">我的举报记录</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-partners"><span class="cell-icon">${UI.icon('people', 18)}</span><span class="cell-main">我的搭友<span class="cell-sub">互评后自动沉淀的搭子关系</span></span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-blocks"><span class="cell-icon">${UI.icon('slash', 18)}</span><span class="cell-main">黑名单</span><span class="cell-arrow">›</span></div>
    <div class="cell" id="c-rec">
      <span class="cell-icon">${UI.icon('star', 18)}</span>
      <span class="cell-main">个性化推荐<span class="cell-sub">根据搭子偏好推荐内容，关闭后按热门展示</span></span>
      <button class="switch${recOff ? '' : ' on'}" id="sw-rec" type="button" role="switch" aria-checked="${String(!recOff)}" aria-label="个性化推荐开关"><span class="knob"></span></button>
    </div>
    <div class="cell" id="c-bigfont">
      <span class="cell-icon">${UI.icon('file-text', 18)}</span>
      <span class="cell-main">大字模式<span class="cell-sub">放大界面文字，适合视力不佳或年长用户</span></span>
      <button class="switch${localStorage.getItem('dada_bigfont') === '1' ? ' on' : ''}" id="sw-bigfont" type="button" role="switch" aria-checked="${String(localStorage.getItem('dada_bigfont') === '1')}" aria-label="大字模式开关"><span class="knob"></span></button>
    </div>
  </div>
  <div style="margin:0 14px 14px; border-radius:16px; overflow:hidden; box-shadow:var(--shadow);">
    <div class="cell" id="c-del"><span class="cell-icon" style="color:var(--danger);">${UI.icon('alert-triangle', 18)}</span><span class="cell-main danger">注销账号</span><span class="cell-arrow">›</span></div>
  </div>
  <div style="padding:0 14px;">
    <button class="btn danger block" id="btn-logout">退出登录</button>
    <div style="text-align:center; color:var(--text-3); font-size:11.5px; margin-top:14px;">搭搭 v1.0 · 找搭子，上搭搭</div>
  </div>`;

  el.querySelector('#c-safety2').onclick = () => App.navigate('#/safety');
  el.querySelector('#c-reports').onclick = () => App.navigate('#/my-reports');
  el.querySelector('#c-partners').onclick = () => App.navigate('#/partners');

  // 合规：个性化推荐开关（PUT /users/me rec_off，0=开启 1=关闭）
  const swRec = el.querySelector('#sw-rec');
  const paintSwitch = () => {
    swRec.classList.toggle('on', !recOff);
    swRec.setAttribute('aria-checked', String(!recOff));
  };
  swRec.onclick = async () => {
    const next = recOff ? 0 : 1;
    try {
      await API.put('/users/me', { rec_off: next });
      recOff = next === 1;
      paintSwitch();
      UI.toast(recOff ? '已关闭个性化推荐，将按热门展示' : '已开启个性化推荐');
    } catch (err) { UI.toast(err.message); }
  };

  // 老王P0：大字模式开关——localStorage dada_bigfont + html[data-bigfont]（app.css 覆盖层），即时生效
  const swBig = el.querySelector('#sw-bigfont');
  const paintBigfont = () => {
    const on = localStorage.getItem('dada_bigfont') === '1';
    swBig.classList.toggle('on', on);
    swBig.setAttribute('aria-checked', String(on));
    if (on) document.documentElement.dataset.bigfont = '1';
    else delete document.documentElement.dataset.bigfont;
  };
  paintBigfont();
  swBig.onclick = () => {
    if (localStorage.getItem('dada_bigfont') === '1') localStorage.removeItem('dada_bigfont');
    else localStorage.setItem('dada_bigfont', '1');
    paintBigfont();
    UI.toast(localStorage.getItem('dada_bigfont') === '1' ? '大字模式已开启' : '大字模式已关闭');
  };

  // 合规：注销账号（红字入口 → 后果说明 + 手动输入 DELETE 确认 → 不可恢复）
  el.querySelector('#c-del').onclick = () => {
    const s = UI.sheet('注销账号', `
      <div class="del-warn">
        <div class="del-warn-title">${UI.icon('alert-triangle', 16)}注销后不可恢复</div>
        <ul class="del-warn-list">
          <li>账号信息将被清空，无法再登录</li>
          <li>搭局记录将保留，但对外展示为匿名</li>
          <li>操作立即生效，不可恢复</li>
        </ul>
      </div>
      <div class="del-confirm-tip">如确认注销，请输入 <b>DELETE</b>：</div>
      <input id="f-del" class="input" aria-label="输入 DELETE 确认注销" placeholder="输入 DELETE 确认" autocomplete="off" spellcheck="false">
      <button class="btn danger solid block" id="btn-del" style="margin-top:12px;" disabled>确认注销</button>`, { cancel: true });
    const input = s.el.querySelector('#f-del');
    const btnDel = s.el.querySelector('#btn-del');
    input.addEventListener('input', () => { btnDel.disabled = input.value.trim() !== 'DELETE'; });
    btnDel.onclick = async () => {
      btnDel.disabled = true;
      btnDel.textContent = '注销中…';
      try {
        await API.post('/users/me/delete', { confirm: input.value.trim() });
        s.close();
        WS.disconnect();
        API.clearSession();
        location.hash = '#/login';
        UI.toast('账号已注销');
      } catch (err) {
        UI.toast(err.message);
        btnDel.disabled = false;
        btnDel.textContent = '确认注销';
      }
    };
  };
  el.querySelector('#c-blocks').onclick = async () => {
    const list = await API.get('/users/me/blocks');
    const s = UI.sheet('黑名单', list.length ? `
      ${list.map((u) => `
        <div style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:0.5px solid var(--line);">
          ${UI.avatarHTML(u)}
          <span style="flex:1; font-weight:600;">${UI.esc(u.nickname)}</span>
          <button class="btn plain sm" data-un="${u.id}">取消拉黑</button>
        </div>`).join('')}` : '<div style="text-align:center; color:var(--text-3); padding:20px;">黑名单为空</div>', { cancel: true });
    s.el.querySelectorAll('[data-un]').forEach((b) => {
      b.onclick = async () => {
        await API.del(`/users/${b.dataset.un}/block`);
        UI.toast('已取消拉黑');
        s.close();
      };
    });
  };
  el.querySelector('#btn-logout').onclick = async () => {
    const yes = await UI.confirm('确定退出登录吗？', { okText: '退出' });
    if (!yes) return;
    WS.disconnect();
    API.clearSession();
    location.hash = '#/login';
    UI.toast('已退出登录');
  };
});

/* ================= 我的搭友（VD-03 FE-3：搭后互评沉淀的搭子关系） ================= */
App.register('partners', async (el) => {
  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">我的搭友</div>
      <div style="width:34px;"></div>
    </div>
  </div>
  <div class="partners-sub">完成搭局互评后自动成为搭友，可直接再约</div>
  <div id="plist">${UI.loading()}</div>`;

  const box = el.querySelector('#plist');
  try {
    const data = await API.get('/users/me/partners');
    // BE 契约兼容：新后端返回 {list:[{partner:{...}, times}]}，旧/平铺形态 [{id, nickname, times}] 均可渲染
    const list = (Array.isArray(data) ? data : data.list || []).map((r) => {
      const u = r.partner || r;
      return { ...u, times: r.times ?? u.times ?? 1 };
    });
    if (!list.length) {
      box.innerHTML = UI.empty('people', '还没有搭友', '一起完成搭局并互评，就会出现在这里');
      return;
    }
    box.innerHTML = list.map((u) => `
      <div class="partner-row" data-id="${u.id}" role="link" tabindex="0" aria-label="${UI.esc(u.nickname)}，搭过 ${u.times || 1} 次" onkeydown="if(event.key==='Enter')App.navigate('#/user/${u.id}')">
        ${UI.avatarHTML(u)}
        <div class="partner-info">
          <div class="partner-name">${UI.esc(u.nickname)} ${UI.genderBadge(u.gender)}</div>
          <div class="partner-meta">
            <span class="pill partner-times">搭过 ${u.times || 1} 次</span>
            ${u.verify_real ? '<span class="vbadge real">真人</span>' : ''}
          </div>
        </div>
        <button class="btn plain sm" data-go="${u.id}">去主页</button>
      </div>`).join('');
    box.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); App.navigate('#/user/' + b.dataset.go); };
    });
    box.querySelectorAll('.partner-row').forEach((r) => {
      r.onclick = () => App.navigate('#/user/' + r.dataset.id);
    });
  } catch (err) {
    box.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
  }
});
