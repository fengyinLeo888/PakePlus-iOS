/* ============================================================
 * meal.js —— 饮食拍照识别（阶段二，对应 PRD AI-07 / FR-05 关联）
 * 流程：选图/拍照 → 本地压缩 → 多模态模型识别 → 人工修正 → 入库
 * 成本控制：识别一次分析全免（后续周报直接读本地数据）
 * 诚实原则：±20% 误差常驻提示，所有数字可人工修正
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  /* ---------- 图片压缩：长边 1280 / JPEG 0.8（识别够用且省 token） ---------- */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取图片失败，请重试')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片解码失败，请换一张')); };
        img.onload = function () {
          var MAX = 1280;
          var scale = Math.min(1, MAX / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- 识别提示词：要求严格 JSON ---------- */
  function mealPrompt() {
    return '你是饮食识别助手。请仔细看这张照片，识别其中所有可食用的食物和饮品，输出严格的 JSON（不要 markdown 代码块、不要任何解释文字），格式：'
      + '{"items":[{"name":"食物中文名","amount":"估计分量，如 1碗 / 约150g","calories":整数,"protein":整数}]}'
      + '\n要求：'
      + '\n1. calories 为该食物整份的总热量估计（千卡），protein 为整份蛋白质估计（克）；'
      + '\n2. 分辨不清的按常见做法估计，宁可略高也不要漏掉食物；'
      + '\n3. 只输出 JSON 本身。';
  }

  /* ---------- 从 AI 回复中解析 JSON（容错：剥围栏、截取首尾大括号） ---------- */
  function parseItems(text) {
    if (!text) return null;
    var t = String(text).split('```').join('\n');
    var s = t.indexOf('{');
    var e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try {
      var data = JSON.parse(t.slice(s, e + 1));
      if (data && Array.isArray(data.items)) {
        var items = data.items.map(function (it) {
          return {
            name: String(it.name || '食物').slice(0, 30),
            amount: String(it.amount || '').slice(0, 20),
            calories: Math.max(0, Math.round(parseFloat(it.calories) || 0)),
            protein: Math.max(0, Math.round(parseFloat(it.protein) || 0))
          };
        }).filter(function (it) { return it.name; });
        return items.length ? items : null;
      }
    } catch (err) { /* 格式不对返回 null，由上层提示手动录入 */ }
    return null;
  }

  /* ---------- 拍照记录弹层 ---------- */
  function openDialog(member, onSaved) {
    var state = {
      photo: null,   // 压缩后的 dataUrl
      items: [],     // 条目（识别 + 手动）
      busy: false
    };

    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = ''
      + '<div class="dialog dialog-wide">'
      + '<h3>拍照记录饮食</h3>'
      + '<p class="muted small">拍下这一餐的所有食物，AI 识别后你可逐项修正再保存。AI 视觉估算热量/蛋白质存在 ±20% 误差，仅供参考。</p>'
      + '<input type="file" id="mealFile" accept="image/*" capture="environment" style="display:none">'
      + '<div class="btn-row">'
      +   '<button type="button" class="btn primary" id="mealPick">📷 拍照 / 选图</button>'
      +   '<button type="button" class="btn ghost" id="mealScan">开始识别</button>'
      + '</div>'
      + '<div id="mealPreview" class="meal-preview"></div>'
      + '<div id="mealModelRow" class="meal-model-row">模型加载中…</div>'
      + '<div id="mealStatus" class="muted small"></div>'
      + '<div id="mealItems"></div>'
      + '<button type="button" class="btn ghost sm" id="mealAddRow" style="display:none">＋ 手动补一条</button>'
      + '<div class="dialog-actions">'
      +   '<button type="button" class="btn ghost" id="mealCancel">取消</button>'
      +   '<button type="button" class="btn primary" id="mealSave">保存记录</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    var $ = function (sel) { return overlay.querySelector(sel); };
    var preview = $('#mealPreview');
    var status = $('#mealStatus');
    var itemsBox = $('#mealItems');

    // ---- 模型下拉：全部厂商全部模型（默认上次拍照用的，其次第一个） ----
    Promise.all([
      FIT.ai.getConfig(),
      FIT.store.getSetting('mealModel')
    ]).then(function (rs) {
      var cfg = rs[0], last = rs[1];
      var opts = [];
      cfg.providers.forEach(function (p) {
        (p.models || []).forEach(function (m) {
          opts.push({ provider: p, model: m, value: p.id + '|' + m.name,
            label: p.label + ' · ' + m.name + '（' + FIT.ai.tierName(m.tier) + '）' });
        });
      });
      if (!opts.length) {
        $('#mealModelRow').innerHTML = '<span class="over-warn">还没有配置 AI 模型，去「我的」页添加后才能识别（也可以取消后手动记）</span>';
        return;
      }
      var cur = null;
      if (last && typeof last === 'string') {
        cur = opts.filter(function (o) { return o.value === last; })[0];
      }
      if (!cur) cur = opts[0]; // 默认第一个（建议把便宜/免费模型排前面配置）
      var h = '<label class="form-row">识别模型（建议选便宜/免费的多模态模型）<select id="mealModel">'
        + opts.map(function (o) {
            return '<option value="' + o.value + '"' + (o.value === cur.value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
          }).join('')
        + '</select></label>';
      $('#mealModelRow').innerHTML = h;
      // 记住本次选择
      overlay.querySelector('#mealModel').addEventListener('change', function () {
        FIT.store.setSetting('mealModel', this.value);
      });
    });

    // ---- 选图 / 拍照 ----
    $('#mealPick').addEventListener('click', function () { $('#mealFile').click(); });
    $('#mealFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      status.textContent = '图片处理中…';
      compressImage(file).then(function (dataUrl) {
        state.photo = dataUrl;
        preview.innerHTML = '<img src="' + dataUrl + '" alt="餐食预览">';
        status.textContent = '图片已就绪，点「开始识别」（约 1~2 分钱，取决于模型）';
      }).catch(function (err) {
        status.textContent = err.message;
      });
    });

    // ---- 开始识别 ----
    $('#mealScan').addEventListener('click', function () {
      if (state.busy) return;
      if (!state.photo) { status.textContent = '请先拍照或选择图片'; return; }
      var selEl = overlay.querySelector('#mealModel');
      if (!selEl) { status.textContent = '没有可用的识别模型'; return; }
      var parts = selEl.value.split('|');
      // 定位选中的厂商与模型（配置可能在弹层打开后变化，重新取一次）
      FIT.ai.getConfig().then(function (cfg) {
        var found = FIT.ai.findModel(cfg, parts[0], parts[1]);
        if (!found) { status.textContent = '模型配置已变化，请关闭重开'; return null; }
        state.busy = true;
        status.textContent = 'AI 识别中（约 5~20 秒）…';
        return FIT.ai.chat(found.provider, found.model.name,
          [{ role: 'user', content: mealPrompt() }],
          { images: [state.photo], temperature: 0.2 })
          .then(function (res) {
            var items = parseItems(res.text);
            var cost = FIT.ai.estimateCost(found.model, res.usage);
            // 记流水（识别一次分析全免，费用只这一次）
            return FIT.ai.recordUsage(res.model, res.usage, cost, 'meal').then(function () {
              if (!items) {
                status.textContent = '识别 ' + res.usage.total + ' token · ' + FIT.ai.costText(cost)
                  + ' —— 但没解析出有效条目，请手动补录或重拍清晰一点的照片';
                return;
              }
              state.items = items;
              status.textContent = '识别完成（' + res.model + ' · ' + res.usage.total + ' token · '
                + FIT.ai.costText(cost) + '）——请核对修正下面的数字';
              drawItems();
            });
          });
      }).catch(function (err) {
        status.textContent = '识别失败：' + err.message + '（可手动补录）';
      }).then(function () {
        state.busy = false;
      });
    });

    // ---- 条目编辑区（识别结果 / 手动） ----
    function drawItems() {
      if (!state.items.length) {
        itemsBox.innerHTML = '';
        $('#mealAddRow').style.display = '';
        return;
      }
      var h = '<div class="meal-edit-head small">'
        + '<span>食物</span><span>分量</span><span>千卡</span><span>蛋白g</span><span></span></div>';
      state.items.forEach(function (it, i) {
        h += '<div class="meal-edit-row">'
          + '<input type="text" class="mi-name" data-i="' + i + '" value="' + escapeAttr(it.name) + '">'
          + '<input type="text" class="mi-amount" data-i="' + i + '" value="' + escapeAttr(it.amount) + '">'
          + '<input type="number" class="mi-num" data-i="' + i + '" min="0" value="' + it.calories + '">'
          + '<input type="number" class="mi-num" data-i="' + i + '" data-f="protein" min="0" value="' + it.protein + '">'
          + '<button type="button" class="btn sm danger" data-mi-del="' + i + '">删</button>'
          + '</div>';
      });
      itemsBox.innerHTML = h;
      $('#mealAddRow').style.display = '';
      // 输入同步回 state
      Array.prototype.forEach.call(itemsBox.querySelectorAll('input'), function (el) {
        el.addEventListener('input', function () {
          var i = +el.dataset.i;
          if (el.classList.contains('mi-num')) {
            if (el.dataset.f === 'protein') state.items[i].protein = Math.max(0, parseFloat(el.value) || 0);
            else state.items[i].calories = Math.max(0, parseFloat(el.value) || 0);
          } else if (el.classList.contains('mi-name')) {
            state.items[i].name = el.value;
          } else {
            state.items[i].amount = el.value;
          }
        });
      });
      // 删行
      Array.prototype.forEach.call(itemsBox.querySelectorAll('[data-mi-del]'), function (btn) {
        btn.addEventListener('click', function () {
          state.items.splice(+btn.dataset.miDel, 1);
          drawItems();
        });
      });
    }

    // 手动补一条
    $('#mealAddRow').addEventListener('click', function () {
      state.items.push({ name: '', amount: '', calories: 0, protein: 0 });
      drawItems();
    });

    // 初始展示：不拍照也应能纯手动记录（空列表时同样显示「手动补一条」按钮）
    drawItems();

    // ---- 取消 / 保存 ----
    $('#mealCancel').addEventListener('click', function () { overlay.remove(); });
    $('#mealSave').addEventListener('click', function () {
      // 过滤有效行（至少有名字）
      var items = state.items.filter(function (it) { return (it.name || '').trim(); })
        .map(function (it) {
          return { name: it.name.trim(), amount: (it.amount || '').trim(),
            calories: Math.max(0, Math.round(parseFloat(it.calories) || 0)),
            protein: Math.max(0, Math.round(parseFloat(it.protein) || 0)) };
        });
      if (!items.length) { alert('请至少识别或手动填写一条食物（有名字即可）'); return; }
      var now = new Date();
      var meal = {
        id: FIT.db.uid(),
        memberId: member.id,
        date: FIT.date.todayKey(),
        time: now.toISOString(),
        photo: state.photo || null,
        items: items,
        source: '拍照识别'
      };
      FIT.store.saveMeal(meal).then(function () {
        overlay.remove();
        if (onSaved) onSaved();
      });
    });
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s === undefined || s === null ? '' : s); }

  FIT.meal = { openDialog: openDialog };
})();
