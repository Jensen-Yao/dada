/* ================= 搭搭 WebSocket 客户端 ================= */
const WS = (() => {
  let sock = null;
  let handlers = new Map();
  let retry = 0;
  let pingTimer = null;

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

    sock.onclose = () => {
      clearInterval(pingTimer);
      sock = null;
      // 断线重连（指数退避，上限30s）
      if (API.isLogin()) {
        retry++;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(retry, 5));
        setTimeout(connect, delay);
      }
    };
    sock.onerror = () => { try { sock.close(); } catch { /* ignore */ } };
  }

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
