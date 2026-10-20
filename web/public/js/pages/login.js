/* ================= 登录/注册页 ================= */
App.register('login', async (el) => {
  App.hideTabbar();
  let mode = 'login';
  // 合规：短信验证码 60s 重发倒计时（模式切换 / 页面卸载时清理，防定时器泄漏与跨节点操作）
  let smsTimer = null;
  const stopSmsTimer = () => { if (smsTimer) { clearInterval(smsTimer); smsTimer = null; } };
  App.onCleanup(stopSmsTimer);

  // 合规：11 位大陆手机号（+86 前缀仅作文案展示，提交不带国家码）
  const isPhone = (s) => /^1\d{10}$/.test(String(s));

  function html() {
    return `
    <div class="login-hero2">
      <div class="login-logo2"><img src="/img/logo.svg" alt="搭搭" onerror="this.remove();this.parentNode.textContent='搭搭';"></div>
      <h1 class="login-title2">搭搭</h1>
      <p class="login-slogan2">万物皆可搭，找人别犯难<br>饭搭 · 学习搭 · 运动搭 · 旅行搭…</p>
    </div>
    <div class="login-form2">
      ${mode === 'login' ? `
      <div class="form-item">
        <input id="f-user" aria-label="手机号或用户名" placeholder="手机号 / 用户名" class="input" autocomplete="username">
      </div>` : `
      <div class="form-item">
        <div class="input login-phone">
          <span class="phone-prefix">+86</span>
          <input id="f-phone" type="tel" inputmode="numeric" maxlength="11" aria-label="手机号" placeholder="请输入手机号" autocomplete="tel-national">
        </div>
      </div>
      <div class="form-item">
        <div class="input sms-field">
          <input id="f-code" type="tel" inputmode="numeric" maxlength="6" aria-label="短信验证码" placeholder="短信验证码">
          <button id="btn-sms" class="sms-btn" type="button">获取验证码</button>
        </div>
      </div>`}
      <div class="form-item">
        <input id="f-pass" type="password" aria-label="密码" placeholder="密码（至少6位）" class="input" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
      </div>
      ${mode === 'login' ? `
      <div class="forgot-row"><button id="btn-forgot" type="button">忘记密码？</button></div>` : ''}
      <div class="form-item ${mode === 'login' ? 'hidden' : ''}" id="row-extra">
        <input id="f-nick" aria-label="昵称" placeholder="昵称" class="input">
        <div style="display:flex; gap:10px; margin-top:10px;">
          <select id="f-gender" aria-label="性别" class="select" style="flex:1;">
            <option value="secret">性别：保密</option>
            <option value="female">女生</option>
            <option value="male">男生</option>
          </select>
          <input id="f-city" aria-label="城市" placeholder="城市，如 北京" class="input" style="flex:1;">
        </div>
      </div>
      ${mode === 'register' ? `
      <div class="adult-check">
        <label for="f-adult">
          <input type="checkbox" id="f-adult"><span class="adult-box"></span>
          <span>我确认已满18周岁，并同意</span>
        </label>
        <a href="#/legal/terms" class="adult-link">《用户协议》</a><a href="#/legal/privacy" class="adult-link">《隐私政策》</a>
      </div>` : ''}
      <button class="btn primary block" id="btn-go">${mode === 'login' ? '登录' : '注册并开始找搭子'}</button>
      ${mode === 'login' ? `
      <div style="text-align:center; font-size:11.5px; color:var(--text-3); margin-top:8px;">登录即代表同意<a href="#/legal/terms" style="color:var(--primary-deep); font-weight:600; text-decoration:none;">《用户协议》</a>与<a href="#/legal/privacy" style="color:var(--primary-deep); font-weight:600; text-decoration:none;">《隐私政策》</a></div>` : ''}
      <div style="text-align:center; margin-top:6px;">
        <button id="btn-switch" style="color: var(--primary-deep); font-size: 14px; font-weight:600;">
          ${mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </div>
      <button id="btn-visit" style="text-align:center; color: var(--text-3); font-size: 13px; margin-top:2px;">先随便逛逛</button>
      ${mode === 'login' ? `
      <div class="login-demo2">
        演示账号：xiaoyu / 123456（已认证用户）<br>管理员：admin / 123456（运营后台）
      </div>` : ''}
    </div>`;
  }

  el.innerHTML = html();

  const $ = (id) => el.querySelector('#' + id);

  // R2-N5: 表单草稿——点协议链接跳走后返回时恢复已输入内容（sessionStorage，关标签页即弃）
  const DRAFT_KEY = 'dada_login_draft';
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
    if (draft.mode === mode) {
      for (const id of ['f-user', 'f-pass', 'f-nick', 'f-phone']) {
        if (draft[id]) $(id) && ($(id).value = draft[id]);
      }
    }
  } catch { /* ignore */ }
  const saveDraft = () => {
    const d = { mode };
    for (const id of ['f-user', 'f-pass', 'f-nick', 'f-phone']) {
      const node = $(id);
      if (node && node.value) d[id] = node.value;
    }
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  };
  el.addEventListener('input', saveDraft);
  App.onCleanup(() => { saveDraft(); });

  $('btn-switch').onclick = () => {
    mode = mode === 'login' ? 'register' : 'login';
    stopSmsTimer();
    el.innerHTML = html();
    bind();
  };

  // 合规：短信验证码 60s 倒计时，按钮期间置灰
  function startCountdown(btn) {
    let left = 60;
    btn.disabled = true;
    btn.textContent = `${left}s后重发`;
    stopSmsTimer();
    smsTimer = setInterval(() => {
      left -= 1;
      if (!btn.isConnected) { stopSmsTimer(); return; }
      if (left <= 0) {
        stopSmsTimer();
        btn.disabled = false;
        btn.textContent = '获取验证码';
        return;
      }
      btn.textContent = `${left}s后重发`;
    }, 1000);
  }

  function bind() {
    // C5：忘记密码入口（仅登录模式渲染，bind 会在模式切换后重跑）
    $('btn-forgot') && ($('btn-forgot').onclick = openForgotSheet);

    // 获取验证码：调 sms/send；演示环境响应带 demo_code，直接 toast 呈现
    $('btn-sms') && ($('btn-sms').onclick = async () => {
      const btn = $('btn-sms');
      const phone = $('f-phone').value.trim();
      if (!isPhone(phone)) return UI.toast('请输入正确的 11 位手机号');
      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        const r = await API.post('/auth/sms/send', { phone });
        if (r?.demo_code) UI.toast(`演示验证码: ${r.demo_code}`, 6000);
        else UI.toast('验证码已发送，请注意查收');
        startCountdown(btn);
      } catch (err) {
        UI.toast(err.message);
        btn.disabled = false;
        btn.textContent = '获取验证码';
      }
    });

    $('btn-go').onclick = async () => {
      const btn = $('btn-go');
      btn.disabled = true;
      try {
        let data;
        if (mode === 'login') {
          // 合规：登录支持手机号或用户名（同一输入框），手机号优先走 phone 字段
          const account = $('f-user').value.trim();
          const password = $('f-pass').value;
          if (!account || !password) { UI.toast('请填写账号和密码'); btn.disabled = false; return; }
          data = await API.post('/auth/login', isPhone(account) ? { phone: account, password } : { username: account, password });
        } else {
          const phone = $('f-phone').value.trim();
          const code = $('f-code').value.trim();
          const password = $('f-pass').value;
          const nickname = $('f-nick').value.trim();
          if (!isPhone(phone)) { UI.toast('请输入正确的 11 位手机号'); btn.disabled = false; return; }
          if (!code) { UI.toast('请输入短信验证码'); btn.disabled = false; return; }
          if (!password || password.length < 6) { UI.toast('密码至少 6 位'); btn.disabled = false; return; }
          if (!nickname) { UI.toast('请填写昵称'); btn.disabled = false; return; }
          // 合规：年龄确认未勾选前端拦截（未传 adult_confirmed BE 也会 400）
          if (!$('f-adult').checked) { UI.toast('请先确认已满18周岁并同意《用户协议》《隐私政策》'); btn.disabled = false; return; }
          data = await API.post('/auth/register', {
            phone, code, password, nickname, adult_confirmed: true,
            gender: $('f-gender').value, city: $('f-city').value.trim(),
          });
        }
        // MT-04：注册成功写一次性引导标记（discover.js 进发现页时弹"让搭搭更懂你"引导）
        if (mode === 'register') safeStore.set('dada_need_onboard', '1'); // R4-K3：safeStore 包装
        API.setSession(data.token, data.user);
        WS.connect();
        UI.toast(mode === 'login' ? `欢迎回来，${data.user.nickname}` : `欢迎加入搭搭，${data.user.nickname}！`);
        App.navigate('#/square');
      } catch (err) {
        UI.toast(err.message);
        btn.disabled = false;
      }
    };
    $('f-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-go').click(); });
    $('btn-visit').onclick = () => App.navigate('#/square');
  }
  bind();

  /* ---------- C5 忘记密码：手机号+验证码+新密码 → POST /auth/password/reset ----------
   * 复用 sms/send（演示环境响应带 demo_code）；sheet 自带独立倒计时，
   * 关闭时经 onClosed 清理定时器，不与注册表单的 smsTimer 互相干扰。 */
  function openForgotSheet() {
    let cdTimer = null;
    const s = UI.sheet('找回密码', `
      <div class="fp-tip">验证码将发送到你的注册手机号，重置成功后请用新密码登录</div>
      <div class="input login-phone">
        <span class="phone-prefix">+86</span>
        <input id="fp-phone" type="tel" inputmode="numeric" maxlength="11" aria-label="手机号" placeholder="请输入注册手机号" autocomplete="tel-national">
      </div>
      <div class="input sms-field" style="margin-top:10px;">
        <input id="fp-code" type="tel" inputmode="numeric" maxlength="6" aria-label="短信验证码" placeholder="短信验证码">
        <button id="fp-sms" class="sms-btn" type="button">获取验证码</button>
      </div>
      <input id="fp-pass" type="password" aria-label="新密码" placeholder="新密码（至少6位）" class="input" style="margin-top:10px;" autocomplete="new-password">
      <button class="btn primary block" id="fp-go" style="margin-top:14px;">重置密码</button>`, {
      cancel: true,
      onClosed: () => { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } },
    });
    const $fp = (id) => s.el.querySelector('#' + id);
    // 登录框里已输入手机号时预填，少打一步
    const account = $('f-user')?.value.trim() || '';
    if (isPhone(account)) $fp('fp-phone').value = account;

    $fp('fp-sms').onclick = async () => {
      const btn = $fp('fp-sms');
      const phone = $fp('fp-phone').value.trim();
      if (!isPhone(phone)) return UI.toast('请输入正确的 11 位手机号');
      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        // BE 契约：scene='reset' 走找回密码通道（手机号必须已注册；与注册通道共用一次性验证码存储）
        const r = await API.post('/auth/sms/send', { phone, scene: 'reset' });
        if (r?.demo_code) UI.toast(`演示验证码: ${r.demo_code}`, 6000);
        else UI.toast('验证码已发送，请注意查收');
        let left = 60;
        btn.textContent = `${left}s后重发`;
        cdTimer = setInterval(() => {
          left -= 1;
          if (!btn.isConnected) { clearInterval(cdTimer); cdTimer = null; return; }
          if (left <= 0) {
            clearInterval(cdTimer); cdTimer = null;
            btn.disabled = false;
            btn.textContent = '获取验证码';
            return;
          }
          btn.textContent = `${left}s后重发`;
        }, 1000);
      } catch (err) {
        UI.toast(err.message);
        btn.disabled = false;
        btn.textContent = '获取验证码';
      }
    };

    $fp('fp-go').onclick = async () => {
      const btn = $fp('fp-go');
      const phone = $fp('fp-phone').value.trim();
      const code = $fp('fp-code').value.trim();
      const password = $fp('fp-pass').value;
      if (!isPhone(phone)) return UI.toast('请输入正确的 11 位手机号');
      if (!code) return UI.toast('请输入短信验证码');
      if (!password || password.length < 6) return UI.toast('密码至少 6 位');
      btn.disabled = true;
      try {
        await API.post('/auth/password/reset', { phone, code, password });
        s.close();
        UI.toast('密码已重置，请用新密码登录');
      } catch (err) {
        UI.toast(err.message);
        btn.disabled = false;
      }
    };
  }
});
