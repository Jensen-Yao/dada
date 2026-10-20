/* ================= 搭搭 safeStorage（R4-K3） =================
 * localStorage 被禁（严格隐私模式 / 阻止所有 Cookie / 老内核属性级拦截）时，
 * 直接访问 window.localStorage 即抛 SecurityError，boot 白屏。
 * 这里统一包装：任何读写删除都不抛错；读不到返回 null，写不进静默失败。
 * 后果（可接受）：登录态无法持久化，App 以游客态降级可用（登录会 toast 失败，不白屏）。
 * 全局暴露 safeStore，api.js / app.js 及各页面脚本一律经它访问 localStorage。 */
const safeStore = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 存储被禁/已满，静默降级 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
