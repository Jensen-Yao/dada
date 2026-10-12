/* ================= 发布搭局页 ================= */
App.register('publish', async (el) => {
  const meta = await App.meta();
  const state = {
    category: '',
    fee_mode: 'aa',
    gender_req: 'any',
    need_count: 1,
  };
  const me = window.__me || await API.get('/auth/me');

  el.innerHTML = `
  <div class="navbar">
    <div class="navbar-inner">
      <button class="navbar-btn" onclick="history.back()">‹</button>
      <div class="navbar-title">发布搭局</div>
      <div style="width:34px;"></div>
    </div>
  </div>

  <div style="padding:14px 14px 6px;">
    <div class="card" style="display:flex; align-items:center; gap:10px; padding:12px 14px;">
      <span style="font-size:22px;">💡</span>
      <div style="font-size:12.5px; color:var(--text-2); line-height:1.5;">
        写清楚<b>时间、地点、人数和要求</b>，能大幅提高成搭率。禁止引流站外与任何违规内容。
      </div>
    </div>
  </div>

  <div class="form">
    <div class="form-item">
      <label>搭什么 <span class="req">*</span></label>
      <div class="cat-grid" id="cat-grid">
        ${meta.categories.map((c) => `
          <button class="cat-item" data-cat="${c.key}"><span class="ci">${c.emoji}</span>${c.name}</button>`).join('')}
      </div>
    </div>

    <div class="form-item">
      <label>标题 <span class="req">*</span></label>
      <input id="f-title" class="input" maxlength="40" placeholder="一句话说明，如：周六五道口找饭搭子">
    </div>

    <div class="form-item">
      <label>详细说说</label>
      <textarea id="f-content" class="textarea" maxlength="1000" placeholder="安排、路线、口味偏好、想要什么样的搭子…"></textarea>
    </div>

    <div class="form-item">
      <label>城市 <span class="req">*</span></label>
      <input id="f-city" class="input" placeholder="如：北京" value="${UI.esc(me?.city || '')}">
    </div>

    <div class="form-item">
      <label>地点（选填）</label>
      <input id="f-loc" class="input" maxlength="50" placeholder="如：五道口 / 奥森南园">
    </div>

    <div class="form-item">
      <label>时间</label>
      <input id="f-time" class="input" maxlength="30" placeholder="如：本周六 11:30">
    </div>

    <div class="form-item">
      <label>还找几个人</label>
      <div style="display:flex; align-items:center; gap:14px; background:var(--card); border-radius:14px; padding:10px 14px; box-shadow:var(--shadow);">
        <button class="btn plain sm" id="cnt-minus" style="width:40px;">−</button>
        <b id="cnt-val" style="font-size:18px; flex:1; text-align:center;">1</b>
        <button class="btn plain sm" id="cnt-plus" style="width:40px;">＋</button>
      </div>
    </div>

    <div class="form-item">
      <label>费用方式</label>
      <div class="seg" id="fee-seg">
        ${meta.fee_modes.map((f) => `<button data-fee="${f.key}">${f.name}</button>`).join('')}
      </div>
    </div>

    <div class="form-item">
      <label>搭子性别要求</label>
      <div class="seg" id="gender-seg">
        ${meta.gender_reqs.map((g) => `<button data-g="${g.key}">${g.name}</button>`).join('')}
      </div>
      <div id="female-tip" class="hidden" style="margin-top:8px; background:var(--safe); color:var(--success); font-size:12.5px; padding:8px 12px; border-radius:10px;">
        ♀ 女生专属局已开启：仅女生可以申请，聊天与见面更安心
      </div>
    </div>

    <div class="form-item">
      <label>配图（最多3张，让搭子更想加入）</label>
      <div class="img-pick-row" id="img-picks">
        <div class="img-pick-add" id="img-add">📷<span>添加图片</span></div>
      </div>
      <input type="file" id="f-images" accept="image/*" multiple class="hidden">
    </div>

    <div class="form-item">
      <label>其他要求（选填）</label>
      <input id="f-req" class="input" maxlength="100" placeholder="如：能吃辣、不迟到、有基础">
    </div>

    <button class="btn primary block" id="btn-publish" style="margin-top:6px;">🚀 发布搭局</button>
    <div style="text-align:center; font-size:11.5px; color:var(--text-3); padding-bottom:10px;">
      发布需搭力值 ≥ 300 · 你当前 ${me?.credit ?? '—'} 分
    </div>
  </div>`;

  const $ = (id) => el.querySelector('#' + id);

  el.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => {
      state.category = b.dataset.cat;
      el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('selected', x === b));
    };
  });
  el.querySelectorAll('[data-fee]').forEach((b) => {
    b.onclick = () => {
      state.fee_mode = b.dataset.fee;
      el.querySelectorAll('[data-fee]').forEach((x) => x.classList.toggle('selected', x === b));
    };
  });
  el.querySelectorAll('[data-g]').forEach((b) => {
    b.onclick = () => {
      state.gender_req = b.dataset.g;
      el.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('selected', x === b));
      $('female-tip').classList.toggle('hidden', state.gender_req !== 'female');
    };
  });
  // 默认选中
  el.querySelector('[data-fee="aa"]').classList.add('selected');
  el.querySelector('[data-g="any"]').classList.add('selected');

  $('cnt-minus').onclick = () => { state.need_count = Math.max(1, state.need_count - 1); $('cnt-val').textContent = state.need_count; };
  $('cnt-plus').onclick = () => { state.need_count = Math.min(20, state.need_count + 1); $('cnt-val').textContent = state.need_count; };

  // ---------- 配图选择（本地预览，创建后上传） ----------
  const pickedFiles = [];
  const imgAdd = $('img-add');
  const imgInput = $('f-images');
  imgAdd.onclick = () => imgInput.click();
  imgInput.addEventListener('change', () => {
    for (const f of imgInput.files) {
      if (pickedFiles.length >= 3) { UI.toast('最多 3 张配图'); break; }
      if (f.size > 8 * 1024 * 1024) { UI.toast('单张图片不能超过 8MB'); continue; }
      pickedFiles.push(f);
    }
    imgInput.value = '';
    renderPicks();
  });
  function renderPicks() {
    const row = $('img-picks');
    row.innerHTML = pickedFiles.map((f, i) => `
      <div style="position:relative;">
        <img class="img-pick" src="${URL.createObjectURL(f)}" alt="">
        <button class="img-pick-del" data-del="${i}">✕</button>
      </div>`).join('') +
      (pickedFiles.length < 3 ? `<div class="img-pick-add" id="img-add">📷<span>添加图片</span></div>` : '');
    row.querySelector('#img-add')?.addEventListener('click', () => imgInput.click());
    row.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => { pickedFiles.splice(parseInt(b.dataset.del), 1); renderPicks(); };
    });
  }
  async function uploadImages(pid) {
    if (!pickedFiles.length) return;
    const fd = new FormData();
    for (const f of pickedFiles) fd.append('images', f);
    await fetch(`/api/posts/${pid}/images`, {
      method: 'POST',
      headers: API.token() ? { Authorization: `Bearer ${API.token()}` } : {},
      body: fd,
    });
  }

  $('btn-publish').onclick = async () => {
    if (!state.category) return UI.toast('先选一个搭子类型吧');
    const title = $('f-title').value.trim();
    if (!title) return UI.toast('标题不能为空');
    const city = $('f-city').value.trim();
    if (!city) return UI.toast('请填写城市');
    const btn = $('btn-publish');
    btn.disabled = true;
    try {
      const p = await API.post('/posts', {
        category: state.category, title,
        content: $('f-content').value.trim(),
        city, location_name: $('f-loc').value.trim(),
        meet_time: $('f-time').value.trim(),
        need_count: state.need_count, fee_mode: state.fee_mode,
        gender_req: state.gender_req, requirements: $('f-req').value.trim(),
      });
      UI.toast('发布成功，等搭子来找你 🎉');
      try { await uploadImages(p.id); } catch { /* 配图上传失败不阻塞 */ }
      App.navigate('#/post/' + p.id);
    } catch (err) {
      UI.toast(err.message);
      btn.disabled = false;
    }
  };
});
