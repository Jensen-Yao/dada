/* ================= 聊天会话页 ================= */
App.register('conv', async (el, seg) => {
  // 桌面分栏（WEB-03）：≥768px 时左侧会话列表 + 右侧会话，点击切换不跳路由。
  // 移动端结构与改版前完全一致。
  // P1-5 红线：视口判定必须走 matchMedia，禁止直接读 window.innerWidth。
  const desktop = matchMedia('(min-width:768px)').matches;
  // 断点跨越时整页刷新，保证分栏/单栏结构与视口一致（一次性注册守卫）
  // R4-K5：Safari <14 的 MediaQueryList 未继承 EventTarget，无 addEventListener，降级用 addListener
  if (!window.__mqBound) {
    window.__mqBound = true;
    const mq = matchMedia('(min-width:768px)');
    const onMqChange = () => location.reload();
    if (mq.addEventListener) mq.addEventListener('change', onMqChange);
    else if (mq.addListener) mq.addListener(onMqChange);
  }
  let currentConvId = parseInt(seg[0], 10);
  // H9：convId 非法（#/conv/abc → NaN）不再渲染"半残可用"聊天室
  const convIdValid = Number.isInteger(currentConvId) && currentConvId > 0;
  let other = null;
  let myId = window.__me?.id ?? API.savedUser()?.id ?? null;

  // FE-A 契约图标（未落地时静默降级）
  const ic = (name, size = 24) => (typeof UI.icon === 'function' ? UI.icon(name, size) : '');

  // 合规反诈：消息内容命中涉资金敏感词时，气泡下方追加红色警示条（复用 .msg-safety 红色变体）
  const SCAM_RE = /转账|打钱|借钱|保证金|解冻费/;

  /* ---------- VD-05 FE-1：破冰话题卡 ----------
   * 会话消息 ≤1 条（空会话）且 BE 返回 context（关联帖 + 双方标签）时，
   * 消息区顶部渲染 2-3 张话题卡（白卡 + 左侧橙色竖条），点击仅填入输入框不直接发送；
   * 有人开口（消息 >1 条）后话题卡沉底消失；无 context 不渲染（BE 未合入时零影响）。 */
  const TOPIC_FALLBACKS = ['先自我介绍，再问问TA一般什么时候有空', '说说你期待的氛围，让TA更快了解你'];
  const catNames = {};        // 分类 key → 名称（话题卡文案用，meta 有缓存）
  let catNamesReady = false;
  let convContext = null;     // { post_category, post_title, my_tags, other_tags }
  let msgCount = 0;           // 会话消息数（含安全提示），>1 后话题卡不再展示
  const msgStore = new Map(); // message id → 原始消息对象（长按举报/复制的取证数据源）

  async function ensureCatNames() {
    if (catNamesReady) return;
    try {
      const m = await App.meta();
      (m?.categories || []).forEach((c) => { catNames[c.key] = c.name; });
      catNamesReady = true;
    } catch { /* meta 失败用原始 key 兜底，不阻塞 */ }
  }

  function topicCardsHTML() {
    if (!convContext) return '';
    const cards = [];
    const common = (convContext.my_tags || []).filter((t) => (convContext.other_tags || []).includes(t));
    if (common.length) cards.push(`你们都爱「${common[0]}」，问问TA常去哪儿`);
    if (convContext.post_category) {
      const name = catNames[convContext.post_category] || convContext.post_category;
      cards.push(`聊聊这场「${name}」的安排`);
    }
    if (convContext.post_title) cards.push(`确认下「${String(convContext.post_title).slice(0, 16)}」的时间地点？`);
    const list = [...new Set(cards)];
    for (const f of TOPIC_FALLBACKS) { if (list.length >= 2) break; if (!list.includes(f)) list.push(f); }
    if (!list.length) return '';
    return `<div class="topic-cards" id="topic-cards">
      <div class="topic-cards-cap">破冰话题 · 点一下填入输入框</div>
      ${list.slice(0, 3).map((t) => `<div class="topic-card" data-topic="${UI.esc(t)}">${UI.esc(t)}</div>`).join('')}
    </div>`;
  }

  function bindTopics() {
    el.querySelectorAll('.topic-card').forEach((c) => {
      c.onclick = () => { input.value = c.dataset.topic; input.focus(); };
    });
  }

  function dropTopics() { el.querySelector('#topic-cards')?.remove(); }

  /* ---------- VD-07 FE-6：已读回执 ----------
   * 仅"自己发的最后一条"消息在 read_at 非空时于时间旁渲染灰绿色"已读"小字；
   * 收到 WS peer_read 事件原地更新该条 DOM，不重绘列表（断线重连以接口 read_at 为准兜底）。 */
  function paintReadReceipt() {
    el.querySelectorAll('.msg-read').forEach((n) => n.remove());
    const mineRows = el.querySelectorAll('.msg-row.mine');
    const last = mineRows[mineRows.length - 1];
    if (last && last.dataset.read === '1') {
      last.querySelector('.msg-time')?.insertAdjacentHTML('beforeend', '<span class="msg-read">已读</span>');
    }
  }

  /* ---------- VD-06 FE-5：气泡快捷菜单（举报此消息 / 复制文字） ----------
   * 移动端气泡长按 500ms、桌面右键 contextmenu 弹小菜单；阻止浏览器默认菜单。
   * 举报走既有 POST /users/:other_id/report，detail 携带会话/消息 id 与内容快照。 */
  let pressTimer = null;
  let bubbleMenu = null;

  function closeBubbleMenu() { if (bubbleMenu) { bubbleMenu.remove(); bubbleMenu = null; } }

  function showBubbleMenu(m, x, y) {
    closeBubbleMenu();
    const menu = document.createElement('div');
    menu.className = 'bubble-menu';
    const items = [];
    if (m.sender_id !== myId && other) {
      items.push(`<button class="bubble-menu-item danger" data-act="report">${ic('flag', 15)} 举报此消息</button>`);
    }
    items.push(`<button class="bubble-menu-item" data-act="copy">${ic('file-text', 15)} 复制文字</button>`);
    menu.innerHTML = items.join('');
    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 140;
    const mh = menu.offsetHeight || 44;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, x - mw / 2))}px`;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - mh - 8, y - mh - 14))}px`;
    bubbleMenu = menu;
    menu.querySelector('[data-act="report"]')?.addEventListener('click', () => {
      closeBubbleMenu();
      // R2-N2: 举报前先选理由（Amy#3），不再硬编码"骚扰"
      const reasons = ['骚扰', '欺诈', '言语辱骂', '人身安全', '其他'];
      const rs = UI.sheet('举报这条消息', `
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${reasons.map((r) => `<button class="btn plain" data-r="${r}">${r}</button>`).join('')}
        </div>`, { cancel: true });
      rs.el.querySelectorAll('[data-r]').forEach((b) => {
        b.onclick = async () => {
          try {
            await API.post(`/users/${other.id}/report`, {
              reason: b.dataset.r,
              detail: `会话#${currentConvId} 消息#${m.id} 消息内容: ${String(m.content).slice(0, 120)}`,
            });
            rs.close();
            UI.toast('已收到举报，我们会尽快核实');
          } catch (err) { UI.toast(err.message); }
        };
      });
    });
    menu.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      closeBubbleMenu();
      try { await navigator.clipboard.writeText(String(m.content || '')); UI.toast('已复制'); }
      catch { UI.toast('复制失败，请手动选择复制'); }
    });
  }

  const onMenuDismiss = (e) => { if (bubbleMenu && !bubbleMenu.contains(e.target)) closeBubbleMenu(); };

  const chatPaneHTML = `
    <div class="navbar">
      <div class="navbar-inner">
        <button class="navbar-btn" id="btn-back" aria-label="返回">${ic('back', 20) || '‹'}</button>
        <div class="navbar-title" id="title" style="font-size:16px;">...</div>
        <button class="navbar-btn" id="btn-more" aria-label="更多">${ic('more', 20) || '···'}</button>
      </div>
    </div>
    <div class="chat-scroll" id="msgs" role="log" aria-live="polite" aria-label="聊天消息" style="flex:1; overflow-y:auto;"></div>
    <div class="chat-input-bar">
      <input id="f-msg" aria-label="聊天消息" placeholder="友善聊天，禁止导流与违规内容…" maxlength="2000">
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

  // H8/H9：会话不可用（convId 非法 / 不存在 / 无权）时的错误态：
  // 替换右侧聊天区（无输入栏、不可发送），桌面端保留左栏会话列表
  function showConvError(sub) {
    const pane = el.querySelector('.conv-chat-pane') || el.querySelector('.page-inner');
    if (!pane) return;
    pane.innerHTML = `
    <div class="empty" style="padding-top:88px;">
      <div class="e-icon">${UI.icon('message-circle', 44)}</div>
      <div class="e-title">会话不存在</div>
      <div style="font-size:13px">${UI.esc(sub || '该会话可能已结束，或你没有访问权限')}</div>
      <div style="display:flex; gap:10px; justify-content:center; margin-top:18px;">
        <button class="btn primary" id="cverr-chat" style="min-width:132px;">返回消息列表</button>
        <button class="btn plain" id="cverr-square" style="min-width:110px;">返回广场</button>
      </div>
    </div>`;
    pane.querySelector('#cverr-chat').onclick = () => App.navigate('#/chat');
    pane.querySelector('#cverr-square').onclick = () => App.navigate('#/square');
  }

  // H9：convId 非法直接渲染错误页，不注册任何 WS 回调、不渲染输入栏
  if (!convIdValid) {
    showConvError('链接无效：会话不存在');
    if (desktop) loadConvList();
    return;
  }

  el.querySelector('#btn-back').onclick = () => history.back();

  /* ---------- R5 时间语义 TS-4：聊天气泡流日期分隔条 ----------
   * 相邻消息跨天（按设备本地日历日）时插入"今天 / 昨天 / M月D日"分隔，
   * 消除"昨天的 21:00 与 5 分钟前的 21:00 视觉相同"的时间失真。 */
  const dividerHTML = (ts) => `<div class="chat-day-divider" role="separator" aria-label="${UI.esc(UI.dayLabel(ts))}">${UI.esc(UI.dayLabel(ts))}</div>`;
  let lastDayKey = ''; // 消息流中最后一条消息的日历日键（WS 增量插入时判断是否跨天）

  function withDayDivider(m) {
    const k = UI.dayKey(m.created_at);
    if (k === lastDayKey) return msgHTML(m);
    lastDayKey = k;
    return dividerHTML(m.created_at) + msgHTML(m);
  }

  function msgHTML(m) {
    if (m.type === 'safety') {
      return `<div class="msg-safety">${UI.esc(m.content)}</div>`;
    }
    msgStore.set(m.id, m); // 长按举报/复制取证
    const mine = m.sender_id === myId;
    const who = mine ? {} : (other || {});
    return `
    <div class="msg-row ${mine ? 'mine' : ''}" data-mid="${m.id}" data-read="${mine && m.read_at ? 1 : 0}">
      ${mine ? '' : UI.avatarHTML(who)}
      <div style="max-width:74%;">
        <div class="bubble">${UI.esc(m.content)}</div>
        ${typeof m.content === 'string' && SCAM_RE.test(m.content)
          ? '<div class="msg-safety scam">谨防诈骗：平台不收取任何费用，切勿转账</div>'
          : ''}
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
        box.innerHTML = UI.empty('message-circle', '暂无会话', '申请搭局通过后就能聊天');
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
            <div class="conv-last">${cv.last_message ? (cv.last_message.type === 'safety' ? '<span style="color:var(--danger);">安全提示</span>' : UI.esc(cv.last_message.content)) : '打个招呼吧'}</div>
          </div>
          ${cv.unread ? `<span class="dot-unread">${cv.unread}</span>` : ''}
          <span class="conv-time">${cv.last_message ? UI.timeAgo(cv.last_message.created_at) : ''}</span>
        </div>`).join('');
      box.querySelectorAll('.conv-item').forEach((item) => {
        item.onclick = () => loadConv(parseInt(item.dataset.id));
      });
      highlightCurrent();
    } catch (err) {
      box.innerHTML = UI.empty('alert-circle', '加载失败', err.message);
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
    convContext = data.context || null;           // VD-05：BE 契约新增，未合入时为 undefined
    msgCount = (data.messages || []).length;
    msgStore.clear();
    await ensureCatNames();
    el.querySelector('#title').innerHTML = `
      ${UI.esc(other?.nickname || '…')}
      ${other?.verify_real ? '<span class="vbadge real">真人</span>' : ''}
      ${other?.verify_student ? '<span class="vbadge real">学生</span>' : ''}`;
    // 空会话（≤1 条）且有关联上下文 → 消息区顶部渲染破冰话题卡
    const topics = msgCount <= 1 && convContext ? topicCardsHTML() : '';
    // R5[W1]：#msgs 是 aria-live 区，历史消息全量渲染属"批量回放"而非新事件——
    // 渲染前临时静音 live 通道，插完恢复 polite，避免读屏把整段历史复读一遍；
    // 之后经 WS 增量插入的新消息走 live 播报。
    msgsEl.setAttribute('aria-live', 'off');
    lastDayKey = '';
    const bodyHTML = data.messages.map(withDayDivider).join('');
    msgsEl.innerHTML = topics + (bodyHTML || (topics ? '' : UI.empty('message-circle', '打个招呼', '聊聊具体安排，认识一下吧')));
    msgsEl.setAttribute('aria-live', 'polite');
    bindTopics();
    paintReadReceipt(); // VD-07：历史消息 read_at 兜底渲染
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
    // H9：发送前校验 convId 有效性；失败只提示、不清空输入框（原"先清空再等确认"会丢字）
    if (!(Number.isInteger(currentConvId) && currentConvId > 0)) {
      UI.toast('会话不存在，无法发送');
      return;
    }
    if (!WS.sendChat(currentConvId, text)) {
      UI.toast('连接已断开，正在重连…');
      WS.connect();
      return;
    }
    input.value = '';
  }

  el.querySelector('#btn-send').onclick = send;
  // R4-K4：中文输入法组合期按 Enter 确认候选词时 key==='Enter' 且 isComposing===true
  // （旧内核 isComposing 缺失时 keyCode 为 229），此时不发送，避免拼音原样发出
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') send();
  });

  // 接收实时消息
  // H1：改用页级 App.onCleanup 卸载（DOMNodeRemoved 在 Chrome 对 innerHTML 替换不派发，
  // 原方案导致 WS 回调永不卸载、错误 toast 随访问次数叠加、死 handler 重复请求）
  const onMsg = (payload) => {
    if (payload.message?.conv_id !== currentConvId) return;
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
    // TS-4：跨天的新消息先插日期分隔条（#msgs 为 live 区，分隔条随消息一起播报）
    msgsEl.insertAdjacentHTML('beforeend', withDayDivider(payload.message));
    msgCount += 1;
    if (msgCount > 1) dropTopics(); // 有人开口后话题卡沉底（VD-05）
    paintReadReceipt();             // 新消息成为"我的最后一条"，重算已读位（VD-07）
    if (nearBottom) scrollBottom();
    App.refreshBadges();
  };
  const onErr = (payload) => { if (payload.error) UI.toast(payload.error); };

  // VD-07 FE-6：对端打开会话（批量置读）→ WS 推送 peer_read，原地标记我的最后一条为已读
  const onPeerRead = (payload) => {
    if (String(payload.conv_id) !== String(currentConvId)) return;
    const mineRows = el.querySelectorAll('.msg-row.mine');
    const last = mineRows[mineRows.length - 1];
    if (last && last.dataset.read !== '1') {
      last.dataset.read = '1';
      paintReadReceipt();
    }
  };

  // VD-06 FE-5：气泡长按（500ms）/ 桌面右键 → 快捷菜单；阻止默认菜单
  msgsEl.addEventListener('touchstart', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble) return;
    const m = msgStore.get(parseInt(bubble.closest('.msg-row')?.dataset.mid, 10));
    if (!m) return;
    const t = e.touches[0];
    const x = t.clientX;
    const y = t.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* ignore */ }
      showBubbleMenu(m, x, y);
    }, 500);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => {
    msgsEl.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
  });
  msgsEl.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble) return;
    e.preventDefault(); // 阻止浏览器默认右键菜单
    const m = msgStore.get(parseInt(bubble.closest('.msg-row')?.dataset.mid, 10));
    if (m) showBubbleMenu(m, e.clientX, e.clientY);
  });
  document.addEventListener('click', onMenuDismiss);
  document.addEventListener('touchstart', onMenuDismiss, { passive: true });
  App.onCleanup(() => {
    document.removeEventListener('click', onMenuDismiss);
    document.removeEventListener('touchstart', onMenuDismiss);
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    closeBubbleMenu();
  });

  // 举报/拉黑菜单
  el.querySelector('#btn-more').onclick = () => {
    const s = UI.sheet('', `
      <button class="btn plain block" id="m-profile" style="margin-bottom:8px;">${UI.icon('user', 14)} 查看 TA 的主页</button>
      <button class="btn plain block" id="m-report" style="margin-bottom:8px;">${UI.icon('flag', 14)} 举报聊天记录</button>
      <button class="btn danger block" id="m-block">${UI.icon('slash', 14)} 拉黑并退出会话</button>`, { cancel: true });
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
      </div>`, { cancel: true });
    s.el.querySelectorAll('[data-r]').forEach((b) => {
      b.onclick = async () => {
        try {
          await API.post(`/users/${other.id}/report`, { reason: b.dataset.r, detail: '聊天会话内举报' });
          s.close();
          UI.toast('已收到举报，我们会尽快核实');
        } catch (err) { UI.toast(err.message); }
      };
    });
  }

  try {
    await loadConv(currentConvId);
  } catch (err) {
    // H8：会话不存在/无权 → 右侧友好错误页（保留返回按钮），桌面端保留左栏列表
    showConvError(err.message);
    if (desktop) await loadConvList();
    return;
  }
  // 会话加载成功后才挂 WS 回调，并注册页级卸载
  WS.on('chat', onMsg);
  WS.on('chat_error', onErr);
  WS.on('peer_read', onPeerRead); // VD-07：对端已读实时回执
  App.onCleanup(() => { WS.off('chat', onMsg); WS.off('chat_error', onErr); WS.off('peer_read', onPeerRead); });
  if (desktop) loadConvList();
});
