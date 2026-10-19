/* ================= 发布搭局页 ================= */
App.register('publish', async (el, _seg, query) => {
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
      <button class="navbar-btn" onclick="history.back()" aria-label="返回">‹</button>
      <div class="navbar-title">发布搭局</div>
      <div style="width:34px;"></div>
    </div>
  </div>

  <div style="padding:14px 14px 6px;">
    <div class="card pub-tip">
      <span class="pub-tip-ico">${UI.icon('info', 16)}</span>
      <div class="pub-tip-text">
        写清楚<b>时间、地点、人数和要求</b>，能大幅提高成搭率。禁止引流站外与任何违规内容。
      </div>
    </div>
  </div>

  <div class="form">
    <div class="form-item">
      <label id="l-cat">搭什么 <span class="req">*</span></label>
      <div class="cat-grid" id="cat-grid" role="group" aria-labelledby="l-cat">
        ${meta.categories.map((c) => `
          <button class="cat-item" data-cat="${c.key}">
            <span class="cat-thumb"><img src="/img/photos/${c.key}-1.jpg" alt="" loading="lazy"></span>${c.name}
          </button>`).join('')}
      </div>
    </div>

    <div class="form-item">
      <label for="f-title">标题 <span class="req">*</span></label>
      <input id="f-title" class="input" maxlength="40" placeholder="一句话说明，如：周六五道口找饭搭子">
    </div>

    <div class="form-item">
      <label for="f-content">详细说说</label>
      <textarea id="f-content" class="textarea" maxlength="1000" placeholder="安排、路线、口味偏好、想要什么样的搭子…"></textarea>
    </div>

    <div class="form-item">
      <label for="f-city">城市 <span class="req">*</span></label>
      <input id="f-city" class="input" placeholder="如：北京" value="${UI.esc(me?.city || '')}">
    </div>

    <div class="form-item">
      <label for="f-loc">地点（选填）</label>
      <input id="f-loc" class="input" maxlength="50" placeholder="如：五道口 / 奥森南园">
    </div>

    <div class="form-item">
      <label for="f-time">时间</label>
      <input id="f-time" class="input" maxlength="30" placeholder="如：本周六 11:30">
    </div>

    <div class="form-item">
      <label id="l-count">还找几个人</label>
      <div class="pub-counter" id="pub-counter" role="group" aria-labelledby="l-count">
        <button class="btn plain sm" id="cnt-minus" aria-label="减少人数" style="width:40px;">−</button>
        <b id="cnt-val" class="pub-cnt-val">1</b>
        <button class="btn plain sm" id="cnt-plus" aria-label="增加人数" style="width:40px;">＋</button>
      </div>
    </div>

    <div class="form-item">
      <label id="l-fee">费用方式</label>
      <div class="seg" id="fee-seg" role="group" aria-labelledby="l-fee">
        ${meta.fee_modes.map((f) => `<button data-fee="${f.key}">${f.name}</button>`).join('')}
      </div>
    </div>

    <div class="form-item">
      <label id="l-gender">搭子性别要求</label>
      <div class="seg" id="gender-seg" role="group" aria-labelledby="l-gender">
        ${meta.gender_reqs.map((g) => `<button data-g="${g.key}">${g.name}</button>`).join('')}
      </div>
      <div id="female-tip" class="pub-female-tip hidden">
        女生专属局已开启：仅女生可以申请，聊天与见面更安心
      </div>
    </div>

    <div class="form-item">
      <label for="f-images">配图（最多3张，让搭子更想加入）</label>
      <div class="img-pick-row" id="img-picks">
        <div class="img-pick-add" id="img-add">${UI.icon('camera', 20)}<span>添加图片</span></div>
      </div>
      <input type="file" id="f-images" accept="image/*" multiple class="hidden">
    </div>

    <div class="form-item">
      <label for="f-req">其他要求（选填）</label>
      <input id="f-req" class="input" maxlength="100" placeholder="如：能吃辣、不迟到、有基础">
    </div>

    <button class="btn primary block pub-cta" id="btn-publish">发布搭局</button>
    <div class="pub-foot-note">
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

  // VD-03 FE-3：三选一「再约一场」跳转 #/publish?category=原分类 预填
  const preCat = (query.get('category') || '').trim();
  if (preCat) {
    const btn = el.querySelector(`[data-cat="${preCat}"]`);
    if (btn) {
      state.category = preCat;
      el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('selected', x === btn));
    }
  }

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
        <img class="img-pick" src="${URL.createObjectURL(f)}" alt="配图预览">
        <button class="img-pick-del" data-del="${i}" aria-label="删除图片">${UI.icon('x', 12)}</button>
      </div>`).join('') +
      (pickedFiles.length < 3 ? `<div class="img-pick-add" id="img-add">${UI.icon('camera', 20)}<span>添加图片</span></div>` : '');
    row.querySelector('#img-add')?.addEventListener('click', () => imgInput.click());
    row.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => { pickedFiles.splice(parseInt(b.dataset.del), 1); renderPicks(); };
    });
  }
  // EM-02：分类图钉 onerror 降级（实拍图 404 时换 --primary-soft 圆底线性图标）
  el.querySelectorAll('.cat-thumb img').forEach((img) => {
    img.onerror = () => {
      const key = img.closest('.cat-item')?.dataset.cat;
      const sp = document.createElement('span');
      sp.className = 'cat-thumb fb';
      sp.innerHTML = UI.catIcon(key, 20);
      img.replaceWith(sp);
    };
  });
  // 上传前 canvas 压缩（H5-09）：>500KB 的图缩到长边≤1200 的 JPEG(q=0.75)再上传；
  // 解码/编码失败或压完反而更大时回退原图，不阻塞发布流程
  async function compressImage(file) {
    const LIMIT = 500 * 1024;
    if (file.size <= LIMIT) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.75));
      if (!blob || blob.size >= file.size) {
        console.debug(`[publish] 配图压缩未减小体积（${(file.size / 1024).toFixed(0)}KB），使用原图`);
        return file;
      }
      console.debug(`[publish] 配图压缩：${(file.size / 1024).toFixed(0)}KB → ${(blob.size / 1024).toFixed(0)}KB`);
      return new File([blob], `${file.name || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (err) {
      console.debug('[publish] 配图压缩失败，使用原图', err);
      return file;
    }
  }

  async function uploadImages(pid) {
    if (!pickedFiles.length) return;
    for (let i = 0; i < pickedFiles.length; i++) {
      pickedFiles[i] = await compressImage(pickedFiles[i]);
    }
    const fd = new FormData();
    for (const f of pickedFiles) fd.append('images', f);
    await fetch(`/api/posts/${pid}/images`, {
      method: 'POST',
      headers: API.token() ? { Authorization: `Bearer ${API.token()}` } : {},
      body: fd,
    });
  }

  // H19 防御性加固：进入 handler 即置 disabled（含校验阶段），任何失败路径都恢复可点，
  // 不依赖"校验通过后才置位"的时序——未来校验变异步也不会打开双击窗口
  $('btn-publish').onclick = async () => {
    const btn = $('btn-publish');
    if (btn.disabled) return;
    btn.disabled = true;
    if (!state.category) { btn.disabled = false; return UI.toast('先选一个搭子类型吧'); }
    const title = $('f-title').value.trim();
    if (!title) { btn.disabled = false; return UI.toast('标题不能为空'); }
    const city = $('f-city').value.trim();
    if (!city) { btn.disabled = false; return UI.toast('请填写城市'); }
    try {
      const p = await API.post('/posts', {
        category: state.category, title,
        content: $('f-content').value.trim(),
        city, location_name: $('f-loc').value.trim(),
        meet_time: $('f-time').value.trim(),
        need_count: state.need_count, fee_mode: state.fee_mode,
        gender_req: state.gender_req, requirements: $('f-req').value.trim(),
      });
      UI.toast('发布成功，等搭子来找你');
      try { await uploadImages(p.id); } catch { /* 配图上传失败不阻塞 */ }
      App.navigate('#/post/' + p.id);
    } catch (err) {
      UI.toast(err.message);
      btn.disabled = false;
    }
  };
});
