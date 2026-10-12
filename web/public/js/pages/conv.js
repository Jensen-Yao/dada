/* ================= 聊天会话页 ================= */
App.register('conv', async (el, seg) => {
  // 桌面分栏（WEB-03）：≥768px 时左侧会话列表 + 右侧会话，点击切换不跳路由。
  // 移动端结构与改版前完全一致。
  // P1-5 红线：视口判定必须走 matchMedia，禁止直接读 window.innerWidth。
  const desktop = matchMedia('(min-width:768px)').matches;
  // 断点跨越时整页刷新，保证分栏/单栏结构与视口一致（一次性注册守卫）
  if (!window.__mqBound) {
    window.__mqBound = true;
    matchMedia('(min-width:768px)').addEventListener('change', () => location.reload());
  }
  let currentConvId = parseInt(seg[0]);
  let other = null;
  let myId = window.__me?.id ?? API.savedUser()?.id ?? null;

  // FE-A 契约图标（未落地时静默降级）
  const ic = (name, size = 24) => (typeof UI.icon === 'function' ? UI.icon(name, size) : '');

  const chatPaneHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" id="btn-back">${ic('back', 20) || '‹'}</button>
        <div class="navbar-title" id="title" style="font-size:16px;">...</div>
        <button class="navbar-btn" id="btn-more">${ic('more', 20) || '···'}</button>
      </div>
    </div>
    <div class="chat-scroll" id="msgs" style="flex:1; overflow-y:auto;"></div>
    <div class="chat-input-bar">
      <input id="f-msg" placeholder="友善聊天，禁止导流与违规内容…" maxlength="2000">
      <button class="btn primary sm chat-send-btn" id="btn-send" aria-label="发送">${ic('send', 17) || '发送'}</button>
    </div>`;

  if (desktop) {
    el.classList.add('conv-split');
    el.innerHTML = `
    <aside class="conv-list-pane">
      <div class="conv-list-head">消息</div>
      <div class="conv-list-scroll" id="conv-list">${UI.loading()}</div>
    </aside>
    <div class="conv-chat-pane page-inner" style="display:flex; flex-direction:column; height:100%;">${chatPaneHTML}</div>`;
  } else {
    el.innerHTML = `
    <div class="page-inner" style="display:flex; flex-direction:column; height:100%;">${chatPaneHTML}</div>`;
  }

  const msgsEl = el.querySelector('#msgs');
  const input = el.querySelector('#f-msg');

  el.querySelector('#btn-back').onclick = () => history.back();

  function msgHTML(m) {
    if (m.type === 'safety') {
      return `<div class="msg-safety">${UI.esc(m.content)}</div>`;
    }
    const mine = m.sender_id === myId;
    const who = mine ? {} : (other || {});
    return `
    <div class="msg-row ${mine ? 'mine' : ''}">
      ${mine ? '' : UI.avatarHTML(who)}
      <div style="max-width:74%;">
        <div class="bubble">${UI.esc(m.content)}</div>
        <div class="msg-time">${UI.hhmm(m.created_at)}</div>
      </div>
    </div>`;
  }

  function scrollBottom() {
    requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });
  }

  // ---------- 桌面左栏：会话列表 ----------
  async function loadConvList() {
    const box = el.querySelector('#conv-list');
    if (!box) return;
    try {
      const list = await API.get('/chat/convs');
      if (!list.length) {
        box.innerHTML = UI.empty('💬', '暂无会话', '申请搭局通过后就能聊天啦');
        return;
      }
      box.innerHTML = list.map((cv) => `
        <div class="conv-item" data-id="${cv.id}">
          ${UI.avatarHTML(cv.other || {})}
          <div class="conv-main">
            <div class="conv-name">
              ${UI.esc(cv.other?.nickname || '已注销用户')}
              ${cv.other?.verify_real ? '<span class="vbadge real">真人</span>' : ''}
            </div>
            <div class="conv-last">${cv.last_message ? (cv.last_message.type === 'safety' ? '⚠️ 安全提示' : UI.esc(cv.last_message.content)) : '打个招呼吧～'}</div>
          </div>
          ${cv.unread ? `<span class="dot-unread">${cv.unread}</span>` : ''}
          <span class="conv-time">${cv.last_message ? UI.timeAgo(cv.last_message.created_at) : ''}</span>
        </div>`).join('');
      box.querySelectorAll('.conv-item').forEach((item) => {
        item.onclick = () => loadConv(parseInt(item.dataset.id));
      });
      highlightCurrent();
    } catch (err) {
      box.innerHTML = UI.empty('😵', '加载失败', err.message);
    }
  }

  function highlightCurrent() {
    el.querySelectorAll('#conv-list .conv-item').forEach((item) => {
      item.classList.toggle('active', parseInt(item.dataset.id) === currentConvId);
    });
  }

  // ---------- 加载某个会话到右侧 ----------
  async function loadConv(convId) {
    if (!convId) return;
    currentConvId = convId;
    highlightCurrent();
    const data = await API.get(`/chat/conv/${convId}/messages`);
    other = data.other;
    myId = window.__me?.id ?? API.savedUser()?.id ?? myId;
    el.querySelector('#title').innerHTML = `
      ${UI.esc(other?.nickname || '…')}
      ${other?.verify_real ? '<span class="vbadge real">真人</span>' : ''}
      ${other?.verify_student ? '<span class="vbadge real">🎓</span>' : ''}`;
    msgsEl.innerHTML = data.messages.map(msgHTML).join('') || UI.empty('👋', '打个招呼', '聊聊具体安排，认识一下吧');
    scrollBottom();
    App.refreshBadges();
    // 桌面端切换不跳路由：仅同步地址栏，便于刷新后回到当前会话
    if (desktop) {
      history.replaceState(null, '', `#/conv/${convId}`);
      const item = el.querySelector(`#conv-list .conv-item[data-id="${convId}"] .dot-unread`);
      if (item) item.remove();
    }
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (!WS.sendChat(currentConvId, text)) {
      UI.toast('连接已断开，正在重连…');
      WS.connect();
      return;
    }
    input.value = '';
  }

  el.querySelector('#btn-send').onclick = send;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  // 接收实时消息
  const onMsg = (payload) => {
    if (payload.message?.conv_id !== currentConvId) return;
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
    msgsEl.insertAdjacentHTML('beforeend', msgHTML(payload.message));
    if (nearBottom) scrollBottom();
    App.refreshBadges();
  };
  WS.on('chat', onMsg);
  const onErr = (payload) => { if (payload.error) UI.toast(payload.error); };
  WS.on('chat_error', onErr);
  el.addEventListener('DOMNodeRemoved', () => { WS.off('chat', onMsg); WS.off('chat_error', onErr); }, { once: true });

  // 举报/拉黑菜单
  el.querySelector('#btn-more').onclick = () => {
    const s = UI.sheet('', `
      <button class="btn plain block" id="m-profile" style="margin-bottom:8px;">👤 查看 TA 的主页</button>
      <button class="btn plain block" id="m-report" style="margin-bottom:8px;">🚩 举报聊天记录</button>
      <button class="btn danger block" id="m-block">⛔ 拉黑并退出会话</button>`);
    s.el.querySelector('#m-profile').onclick = () => { s.close(); if (other) App.navigate('#/user/' + other.id); };
    s.el.querySelector('#m-report').onclick = () => { s.close(); openReport(); };
    s.el.querySelector('#m-block').onclick = async () => {
      s.close();
      const yes = await UI.confirm(`确定拉黑 <b>${UI.esc(other?.nickname || '对方')}</b> 吗？<br><span style="font-size:12px;color:var(--text-3)">拉黑后双方无法互发消息</span>`, { okText: '拉黑', danger: true });
      if (!yes) return;
      try {
        await API.post(`/users/${other.id}/block`);
        UI.toast('已拉黑');
        history.back();
      } catch (err) { UI.toast(err.message); }
    };
  };

  function openReport() {
    const reasons = ['骚扰', '欺诈', '言语辱骂', '人身安全', '其他'];
    const s = UI.sheet('举报', `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${reasons.map((r) => `<button class="btn plain" data-r="${r}">${r}</button>`).join('')}
      </div>`);
    s.el.querySelectorAll('[data-r]').forEach((b) => {
      b.onclick = async () => {
        try {
          await API.post(`/users/${other.id}/report`, { reason: b.dataset.r, detail: '聊天会话内举报' });
          s.close();
          UI.toast('已收到举报，我们会尽快核实 🛡️');
        } catch (err) { UI.toast(err.message); }
      };
    });
  }

  await loadConv(currentConvId);
  if (desktop) loadConvList();
});
