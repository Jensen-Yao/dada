/* ================= 搭搭 WebSocket 客户端 ================= */
const WS = (() => {
  let sock = null;
  let handlers = new Map();
  let retry = 0;
  let pingTimer = null;
  // 架构F4：重连次数上限——超限停止自动重连并提示用户手动刷新；
  // 99 为"永久停止"哨兵（登出 disconnect / 认证失败复用）
  const MAX_RETRY = 8;

  function connect() {
    if (!API.isLogin()) return;
    if (sock && (sock.readyState === 0 || sock.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    sock = new WebSocket(`${proto}//${location.host}/ws`);

    sock.onopen = () => {
      retry = 0;
      sock.send(JSON.stringify({ type: 'auth', token: API.token() }));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (sock?.readyState === 1) sock.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    sock.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const list = handlers.get(msg.type) || [];
        list.forEach((fn) => fn(msg));
        const any = handlers.get('*') || [];
        any.forEach((fn) => fn(msg));
      } catch { /* ignore */ }
    };

    sock.onclose = (event) => {
      clearInterval(pingTimer);
      sock = null;
      // R2-N6: 服务端 4001=认证失败（token失效），不自动重连避免空转
      if (event && event.code === 4001) {
        retry = 99;
        return;
      }
      if (!API.isLogin()) return;
      // 架构F4：指数退避重连最多 MAX_RETRY 次，超限放弃并给出可执行出口
      if (retry >= MAX_RETRY) {
        UI.toast('网络连接已断开，请刷新页面重试', 4000);
        return;
      }
      retry++;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(retry, 5));
      setTimeout(connect, delay);
    };
    sock.onerror = () => { try { sock.close(); } catch { /* ignore */ } };
  }

  // 架构F4：网络恢复（wifi/流量切换）——在线事件即立即重连并重置计数，
  // 不再等下一轮退避定时器（此前断网超限后永无翻身机会）
  window.addEventListener('online', () => {
    if (!API.isLogin()) return;
    const dead = !sock || sock.readyState > 1; // 0/1=连接中/已连，2/3=关闭中/已关
    if (dead) {
      retry = 0;
      connect();
    }
  });

  function disconnect() {
    handlers.clear();
    retry = 99;
    if (sock) { try { sock.close(); } catch { /* ignore */ } sock = null; }
  }

  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  }

  function off(type, fn) {
    const list = handlers.get(type);
    if (list) handlers.set(type, list.filter((f) => f !== fn));
  }

  function sendChat(convId, content) {
    if (sock?.readyState !== 1) return false;
    sock.send(JSON.stringify({ type: 'chat', conv_id: convId, content }));
    return true;
  }

  return { connect, disconnect, on, off, sendChat };
})();
