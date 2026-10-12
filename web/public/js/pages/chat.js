/* ================= 消息列表页 ================= */
App.register('chat', async (el) => {
  // 桌面分栏（WEB-03）：≥768px 时列表左栏化 + 右栏空态；移动端结构与改版前一致
  // P1-5 红线：视口判定必须走 matchMedia，禁止直接读 window.innerWidth。
  const desktop = matchMedia('(min-width:768px)').matches;
  // 断点跨越时整页刷新，保证分栏/单栏结构与视口一致（一次性注册守卫）
  if (!window.__mqBound) {
    window.__mqBound = true;
    matchMedia('(min-width:768px)').addEventListener('change', () => location.reload());
  }

  if (desktop) {
    el.innerHTML = `
    <div class="chat-split" style="display:flex; height:100%;">
      <aside class="conv-list-pane">
        <div class="conv-list-head">消息
          <button class="navbar-btn" id="btn-notif" style="margin-left:auto; width:auto;">🔔</button>
        </div>
        <div class="conv-list-scroll" id="convs">${UI.loading()}</div>
      </aside>
      <div class="conv-empty-pane" id="chat-empty">
        <div class="empty">
          <div class="e-icon">💬</div>
          <div class="e-title">选择一个会话开始聊天</div>
          <div style="font-size:13px;">在左侧列表中点击搭子，即可继续对话</div>
        </div>
      </div>
    </div>`;
  } else {
    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <div class="navbar-title" style="text-align:left; font-size:20px; font-weight:800;">消息</div>
        <button class="navbar-btn" id="btn-notif">🔔</button>
      </div>
    </div>
    <div id="convs">${UI.loading()}</div>`;
  }

  el.querySelector('#btn-notif').onclick = () => App.navigate('#/notifications');

  async function load() {
    const box = el.querySelector('#convs');
    try {
      const list = await API.get('/chat/convs');
      if (!list.length) {
        box.innerHTML = UI.empty('💬', '还没有会话', '申请搭局通过后就能和组局者聊天啦');
        return;
      }
      box.innerHTML = list.map((c) => `
        <div class="conv-item" data-id="${c.id}">
          ${UI.avatarHTML(c.other || {})}
          <div class="conv-main">
            <div class="conv-name">
              ${UI.esc(c.other?.nickname || '已注销用户')}
              ${c.other?.verify_real ? '<span class="vbadge real">真人</span>' : ''}
              ${c.post_id ? '<span class="pill gray" style="font-size:10px;">同局搭子</span>' : ''}
            </div>
            <div class="conv-last">${c.last_message ? (c.last_message.type === 'safety' ? '⚠️ 安全提示' : UI.esc(c.last_message.content)) : '打个招呼吧～'}</div>
          </div>
          ${c.unread ? `<span class="dot-unread">${c.unread}</span>` : ''}
          <span class="conv-time">${c.last_message ? UI.timeAgo(c.last_message.created_at) : ''}</span>
        </div>`).join('');
      box.querySelectorAll('.conv-item').forEach((item) => {
        item.onclick = () => App.navigate('#/conv/' + item.dataset.id);
      });
    } catch (err) {
      box.innerHTML = UI.empty('😵', '加载失败', err.message);
    }
  }

  // 收到新消息自动刷新（本页时）
  const onMsg = () => { if (App.currentTab === 'chat') load(); };
  WS.on('chat', onMsg);
  el.addEventListener('DOMNodeRemoved', () => WS.off('chat', onMsg), { once: true });

  await load();
});
