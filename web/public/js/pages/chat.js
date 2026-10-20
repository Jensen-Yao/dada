/* ================= 消息列表页 ================= */
App.register('chat', async (el) => {
  // 桌面分栏（WEB-03）：≥768px 时列表左栏化 + 右栏空态；移动端结构与改版前一致
  // P1-5 红线：视口判定必须走 matchMedia，禁止直接读 window.innerWidth。
  const desktop = matchMedia('(min-width:768px)').matches;
  // 断点跨越时整页刷新，保证分栏/单栏结构与视口一致（一次性注册守卫）
  // R4-K5：Safari <14 的 MediaQueryList 无 addEventListener，降级用 addListener
  if (!window.__mqBound) {
    window.__mqBound = true;
    const mq = matchMedia('(min-width:768px)');
    const onMqChange = () => location.reload();
    if (mq.addEventListener) mq.addEventListener('change', onMqChange);
    else if (mq.addListener) mq.addListener(onMqChange);
  }

  if (desktop) {
    el.innerHTML = `
    <div class="chat-split" style="display:flex; height:100%;">
      <aside class="conv-list-pane">
        <div class="conv-list-head">消息
          <button class="navbar-btn" id="btn-notif" aria-label="通知" style="margin-left:auto; width:auto;">${UI.icon('bell', 20)}</button>
        </div>
        <div class="conv-list-scroll" id="convs">${UI.loading()}</div>
      </aside>
      <div class="conv-empty-pane" id="chat-empty">
        ${UI.empty('message-circle', '选择一个会话开始聊天', '在左侧列表中点击搭子，即可继续对话')}
      </div>
    </div>`;
  } else {
    el.innerHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <div class="navbar-title" style="text-align:left; font-size:var(--fs-title); font-weight:800;">消息</div>
        <button class="navbar-btn" id="btn-notif" aria-label="通知">${UI.icon('bell', 20)}</button>
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
        box.innerHTML = UI.empty('message-circle', '还没有会话', '申请搭局通过后就能和组局者聊天');
        return;
      }
      box.innerHTML = list.map((c) => `
        <div class="conv-item" data-id="${c.id}" role="link" tabindex="0" aria-label="与${UI.esc(c.other?.nickname || '已注销用户')}的会话${c.unread ? `，${c.unread} 条未读` : ''}" onkeydown="if(event.key==='Enter')App.navigate('#/conv/${c.id}')">
          ${UI.avatarHTML(c.other || {})}
          <div class="conv-main">
            <div class="conv-name">
              ${UI.esc(c.other?.nickname || '已注销用户')}
              ${c.other?.verify_real ? '<span class="vbadge real">真人</span>' : ''}
              ${c.post_id ? '<span class="pill gray" style="font-size:10px;">同局搭子</span>' : ''}
            </div>
            <div class="conv-last">${c.last_message ? (c.last_message.type === 'safety' ? '<span style="color:var(--danger);">安全提示</span>' : UI.esc(c.last_message.content)) : '打个招呼吧'}</div>
          </div>
          ${c.unread ? `<span class="dot-unread">${c.unread}</span>` : ''}
          <span class="conv-time">${c.last_message ? UI.timeAgo(c.last_message.created_at) : ''}</span>
        </div>`).join('');
      box.querySelectorAll('.conv-item').forEach((item) => {
        item.onclick = () => App.navigate('#/conv/' + item.dataset.id);
      });
    } catch (err) {
      box.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
    }
  }

  // 收到新消息自动刷新（本页时）
  // H1：改用页级 App.onCleanup 卸载（DOMNodeRemoved 在 Chrome 对 innerHTML 替换不派发，
  // 原死 handler 会对每条 WS 消息重复拉取会话列表）
  const onMsg = () => { if (App.currentTab === 'chat') load(); };
  WS.on('chat', onMsg);
  App.onCleanup(() => WS.off('chat', onMsg));

  await load();
});
