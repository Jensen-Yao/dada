/* ================= 登录/注册页 ================= */
App.register('login', async (el) => {
  App.hideTabbar();
  let mode = 'login';

  function html() {
    return `
    <div class="login-hero2">
      <div class="login-logo2"><img src="/img/logo.svg" alt="搭搭" onerror="this.remove();this.parentNode.textContent='搭搭';"></div>
      <h1 class="login-title2">搭搭</h1>
      <p class="login-slogan2">万物皆可搭，找人别犯难<br>饭搭 · 学习搭 · 运动搭 · 旅行搭…</p>
    </div>
    <div class="login-form2">
      <div class="form-item">
        <div class="input" style="display:flex; gap:8px; padding:0;">
          <input id="f-user" placeholder="用户名" style="flex:1; padding:12px 14px; background:none; border-radius:14px;">
        </div>
      </div>
      <div class="form-item">
        <input id="f-pass" type="password" placeholder="密码（至少6位）" class="input">
      </div>
      <div class="form-item ${mode === 'login' ? 'hidden' : ''}" id="row-extra">
        <input id="f-nick" placeholder="昵称" class="input">
        <div style="display:flex; gap:10px; margin-top:10px;">
          <select id="f-gender" class="select" style="flex:1;">
            <option value="secret">性别：保密</option>
            <option value="female">女生</option>
            <option value="male">男生</option>
          </select>
          <input id="f-city" placeholder="城市，如 北京" class="input" style="flex:1;">
        </div>
      </div>
      <button class="btn primary block" id="btn-go">${mode === 'login' ? '登录' : '注册并开始找搭子'}</button>
      <div style="text-align:center; font-size:11.5px; color:var(--text-3); margin-top:8px;">注册即代表同意<a href="#/legal/terms" style="color:var(--primary-deep); font-weight:600; text-decoration:none;">《用户协议》</a>与<a href="#/legal/privacy" style="color:var(--primary-deep); font-weight:600; text-decoration:none;">《隐私政策》</a></div>
      <div style="text-align:center; margin-top:6px;">
        <button id="btn-switch" style="color: var(--primary-deep); font-size: 14px; font-weight:600;">
          ${mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </div>
      <button id="btn-visit" style="text-align:center; color: var(--text-3); font-size: 13px; margin-top:2px;">先随便逛逛</button>
      <div class="login-demo2">
        演示账号：xiaoyu / 123456（已认证用户）<br>管理员：admin / 123456（运营后台）
      </div>
    </div>`;
  }

  el.innerHTML = html();

  const $ = (id) => el.querySelector('#' + id);

  $('btn-switch').onclick = () => {
    mode = mode === 'login' ? 'register' : 'login';
    el.innerHTML = html();
    bind();
  };

  function bind() {
    $('btn-go').onclick = async () => {
      const username = $('f-user').value.trim();
      const password = $('f-pass').value;
      if (!username || !password) return UI.toast('请填写用户名和密码');
      const btn = $('btn-go');
      btn.disabled = true;
      try {
        let data;
        if (mode === 'login') {
          data = await API.post('/auth/login', { username, password });
        } else {
          const nickname = $('f-nick').value.trim();
          if (!nickname) { UI.toast('请填写昵称'); btn.disabled = false; return; }
          data = await API.post('/auth/register', {
            username, password, nickname,
            gender: $('f-gender').value, city: $('f-city').value.trim(),
          });
        }
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
});
