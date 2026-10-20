/* ================= 搭搭 API 客户端 ================= */
const API = (() => {
  const TOKEN_KEY = 'dada_token';
  const USER_KEY = 'dada_user';

  // R4-K3：存储一律走 safeStore（storage.js），localStorage 被禁时不再抛 SecurityError
  function token() { return safeStore.get(TOKEN_KEY) || ''; }
  function savedUser() { try { return JSON.parse(safeStore.get(USER_KEY)); } catch (e) { return null; } }

  async function request(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-json */ }
    if (res.status === 401) {
      // 登录态失效，清除并跳登录（聊天页等场景除外）
      safeStore.del(TOKEN_KEY);
      safeStore.del(USER_KEY);
      if (!location.hash.startsWith('#/login')) location.hash = '#/login';
      throw new Error(json?.error || '请先登录');
    }
    if (!res.ok || !json?.ok) throw new Error(json?.error || `请求失败(${res.status})`);
    return json.data;
  }

  const get = (p) => request('GET', p);
  const post = (p, b) => request('POST', p, b || {});
  const put = (p, b) => request('PUT', p, b || {});
  const del = (p) => request('DELETE', p);

  async function uploadAvatar(file) {
    const fd = new FormData();
    fd.append('avatar', file);
    const res = await fetch('/api/users/me/avatar', {
      method: 'POST',
      headers: token() ? { Authorization: `Bearer ${token()}` } : {},
      body: fd,
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || '上传失败');
    return json.data;
  }

  function setSession(t, u) {
    safeStore.set(TOKEN_KEY, t);
    safeStore.set(USER_KEY, JSON.stringify(u));
  }
  function clearSession() {
    safeStore.del(TOKEN_KEY);
    safeStore.del(USER_KEY);
  }

  return {
    token, savedUser, setSession, clearSession,
    get, post, put, del, uploadAvatar,
    isLogin: () => !!token(),
  };
})();
