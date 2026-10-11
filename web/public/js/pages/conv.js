/* ================= 聊天会话页 ================= */
App.register('conv', async (el, seg) => {
  const convId = parseInt(seg[0]);
  let other = null;
  let myId = window.__me?.id ?? API.savedUser()?.id ?? null;

  el.innerHTML = `
  <div class="page-inner" style="display:flex; flex-direction:column; height:100%;">
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" onclick="history.back()">‹</button>
        <div class="navbar-title" id="title" style="font-size:16px;">...</div>
        <button class="navbar-btn" id="btn-more">···</button>
      </div>
    </div>
    <div class="chat-scroll" id="msgs" style="flex:1; overflow-y:auto;"></div>
    <div class="chat-input-bar">
      <input id="f-msg" placeholder="友善聊天，禁止导流与违规内容…" maxlength="2000">
      <button class="btn primary sm" id="btn-send" style="border-radius:20px; padding: 10px 18px;">发送</button>
    </div>
  </div>`;

  const msgsEl = el.querySelector('#msgs');
  const input = el.querySelector('#f-msg');

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

  async function load() {
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
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (!WS.sendChat(convId, text)) {
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
    if (payload.message?.conv_id !== convId) return;
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

  await load();
});
