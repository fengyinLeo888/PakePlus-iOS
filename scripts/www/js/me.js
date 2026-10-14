/* ============================================================
 * me.js —— 我的页（对应 PRD FR-04）
 * 区块：成员管理 / 模型配置中心 / AI 记忆管理 / 预算与隐私设置
 *       / 动作库视频链接 / 备份与恢复 / 医疗免责
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  // 模块级状态：厂商「测试连接」结果跨 render 回填（render 会重画整页）
  var lastTest = null;

  function render(container) {
    Promise.all([
      FIT.store.listMembers(),
      FIT.store.getActiveMember(),
      FIT.ai.getConfig(),
      FIT.ai.monthUsage(),
      FIT.store.getSetting('lastBackupAt')
    ]).then(function (rs) {
      draw(container, rs[0], rs[1], rs[2], rs[3], rs[4]);
    });
  }

  function draw(container, members, active, cfg, usage, lastBackupAt) {
    var html = '';

    /* ---- 区块一：成员管理（PRD 5.3 多成员隔离） ---- */
    html += '<div class="log-card"><h4>成员（数据完全隔离）</h4><ul class="member-list">';
    members.forEach(function (m) {
      var isCur = active && m.id === active.id;
      html += '<li class="' + (isCur ? 'cur' : '') + '">'
        + '<span class="m-name">' + (isCur ? '👤 ' : '') + escapeHtml(m.name)
        + (m.profile.experience === 'none' ? '<span class="chip warn">新手模式</span>' : '') + '</span>'
        + '<span class="m-acts">'
        + (isCur ? '' : '<button type="button" class="btn sm ghost" data-switch="' + m.id + '">切换</button>')
        + '<button type="button" class="btn sm ghost" data-rename="' + m.id + '">改名</button>'
        + '<button type="button" class="btn sm danger" data-del="' + m.id + '">删除</button>'
        + '</span></li>';
    });
    html += '</ul><button type="button" class="btn primary block" id="mNew">＋ 新建成员（走问卷建档）</button></div>';

    /* ---- 区块二：模型配置中心（阶段二，PRD AI-05） ---- */
    html += '<div class="log-card"><h4>模型配置中心</h4>'
      + '<p class="muted small">添加任意 OpenAI 兼容厂商（智谱 / DeepSeek / OpenRouter 等），配置只存本机，密钥不出设备。教练页顶部可随时切换模型。本地 Ollama 等无密钥服务，密钥栏填任意占位符即可。</p>'
      + '<div id="providerList">' + providersHtml(cfg) + '</div>'
      + '<button type="button" class="btn primary block" id="pAdd">＋ 添加厂商</button></div>';

    /* ---- 区块三：AI 记忆管理（阶段二，PRD AI-02：透明可查可改） ---- */
    html += '<div class="log-card"><h4>AI 记忆管理</h4>'
      + '<p class="muted small">AI 对成员的全部「记忆」就是下面三张状态卡：前两张由本地数据自动计算（免费），第三张画像条目由 AI 对话自动提取、可人工修改删除。教练页每次调用 AI 时自动带上，不随使用年限增加成本。</p>'
      + '<div class="btn-row"><button type="button" class="btn ghost sm" id="cardsRefresh">刷新三张卡</button></div>'
      + '<div id="cardsBox"><p class="muted small">加载中…</p></div></div>';

    /* ---- 区块四：预算与隐私设置（阶段二，PRD AI-03 / AI-07） ---- */
    html += budgetBlockHtml(cfg, usage);

    /* ---- 区块五：动作库视频链接（主人自理示范视频，PRD FR-06） ---- */
    html += '<div class="log-card"><h4>动作库 · 示范视频</h4>'
      + '<p class="muted small">动作视频由你自己找（B 站 / YouTube），贴到对应动作后跟练时可一键跳转。AI 不生成视频。</p>'
      + '<div class="video-list" id="videoList">加载中…</div></div>';

    /* ---- 区块六：备份与恢复（PRD 5.3，数据全本地的保命绳） ---- */
    html += '<div class="log-card"><h4>备份与恢复</h4>'
      + '<p class="muted small">数据全部存在这台设备本地，建议每月导出一次 JSON 转存到网盘或电脑。为安全起见，备份文件中的 API 密钥会自动清空，恢复后需重新填写。</p>'
      + '<p class="small ' + (backupStale(lastBackupAt) ? 'over-warn' : 'muted') + '">' + backupText(lastBackupAt) + '</p>'
      + '<div class="btn-row">'
      +   '<button type="button" class="btn primary" id="mExport">导出备份（JSON）</button>'
      +   '<button type="button" class="btn ghost" id="mImportBtn">从备份恢复</button>'
      + '</div>'
      + '<input type="file" id="mImportFile" accept=".json,application/json" style="display:none">'
      + '</div>';

    /* ---- 区块七：医疗免责声明重看 ---- */
    html += '<div class="log-card"><h4>医疗免责声明</h4>'
      + '<button type="button" class="btn ghost block" id="mDisclaimer">重看声明</button></div>';

    /* ---- 区块八：清空全部数据（危险操作，数据结构升级或重新开始时用） ---- */
    html += '<div class="log-card"><h4>清空全部数据</h4>'
      + '<p class="muted small">删除本机全部数据（成员、训练记录、对话、配置），不可恢复。建议先导出备份。清空后刷新页面重新开始。</p>'
      + '<button type="button" class="btn danger block" id="mWipe">清空全部数据</button></div>';

    container.innerHTML = html;

    /* ================= 事件绑定 ================= */

    // 新建成员 → 问卷
    container.querySelector('#mNew').addEventListener('click', function () {
      FIT.app.goSurvey();
    });

    // 切换成员
    Array.prototype.forEach.call(container.querySelectorAll('[data-switch]'), function (btn) {
      btn.addEventListener('click', function () {
        FIT.store.setActiveMember(btn.dataset.switch).then(function () {
          FIT.app.refreshAll();
        });
      });
    });

    // 改名
    Array.prototype.forEach.call(container.querySelectorAll('[data-rename]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.rename;
        FIT.store.getMember(id).then(function (m) {
          var name = prompt('成员名字：', m.name);
          if (name && name.trim()) {
            m.name = name.trim();
            return FIT.store.saveMember(m).then(function () { render(container); });
          }
        });
      });
    });

    // 删除成员：输入名字二次确认（PRD 5.3，防误删）
    Array.prototype.forEach.call(container.querySelectorAll('[data-del]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.del;
        FIT.store.getMember(id).then(function (m) {
          var input = prompt('删除成员不可恢复（已导出的备份除外）。输入成员名「' + m.name + '」确认：');
          if (input === m.name) {
            return FIT.store.deleteMember(id).then(function () {
              // 删的是当前成员 → 清空激活指针
              if (active && id === active.id) return FIT.store.setSetting('activeMember', null);
            }).then(function () { FIT.app.refreshAll(); });
          } else if (input !== null) {
            alert('名字不一致，未删除');
          }
        });
      });
    });

    // ---- 模型配置中心事件 ----
    container.querySelector('#pAdd').addEventListener('click', function () {
      openProviderDialog(cfg, null, container);
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-p-edit]'), function (btn) {
      btn.addEventListener('click', function () {
        var p = findProvider(cfg, btn.dataset.pEdit);
        if (p) openProviderDialog(cfg, p, container);
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-p-del]'), function (btn) {
      btn.addEventListener('click', function () {
        var p = findProvider(cfg, btn.dataset.pDel);
        if (!p) return;
        if (!confirm('删除厂商「' + p.label + '」？教练页若正使用它的模型，会自动切回本地免费模式。')) return;
        cfg.providers = cfg.providers.filter(function (x) { return x.id !== p.id; });
        lastTest = null;
        FIT.ai.saveConfig(cfg).then(function () { render(container); });
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-p-test]'), function (btn) {
      btn.addEventListener('click', function () {
        testProvider(cfg, findProvider(cfg, btn.dataset.pTest), container);
      });
    });

    // ---- AI 记忆管理事件 ----
    container.querySelector('#cardsRefresh').addEventListener('click', function () {
      drawCards(container, active);
    });
    drawCards(container, active); // 进入页面自动加载一次（纯本地计算，免费）

    // ---- 预算与隐私设置保存 ----
    container.querySelector('#setSave').addEventListener('click', function () {
      var limit = parseFloat(container.querySelector('#setBudget').value);
      var days = parseInt(container.querySelector('#setPhotoDays').value, 10);
      var weekly = container.querySelector('#setWeekly').checked;
      if (!(limit >= 0)) { alert('预算上限需为 0 或正数（0 = 不设限）'); return; }
      if (!(days >= 0)) { alert('照片保留天数需为 0 或正整数（0 = 永久）'); return; }
      cfg.budget.monthlyLimit = limit;
      cfg.photoKeepDays = days;
      cfg.aiWeeklySummary = weekly;
      FIT.ai.saveConfig(cfg).then(function () {
        alert('设置已保存');
        render(container);
      });
    });

    // ---- 动作库视频链接维护 ----
    FIT.store.allExercises().then(function (all) {
      var box = container.querySelector('#videoList');
      if (!box) return;
      var vh = '';
      all.forEach(function (ex) {
        vh += '<div class="video-row">'
          + '<span class="v-name">' + escapeHtml(ex.name) + '</span>'
          + (ex.video
              ? '<a class="v-link" href="' + escapeHtml(ex.video) + '" target="_blank" rel="noopener">已贴 ↗</a>'
              : '<span class="muted small">未贴</span>')
          + '<button type="button" class="btn sm ghost" data-video="' + ex.id + '">贴视频</button>'
          + '</div>';
      });
      box.innerHTML = vh;
      Array.prototype.forEach.call(box.querySelectorAll('[data-video]'), function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.dataset.video;
          FIT.store.getExercise(id).then(function (ex) {
            var url = prompt('贴上「' + ex.name + '」的示范视频链接（B 站 / YouTube 均可）：', ex.video || '');
            if (url !== null) {
              ex.video = url.trim() || null;
              return FIT.store.saveExercise(ex).then(function () { render(container); });
            }
          });
        });
      });
    });

    // 导出备份：全量 JSON 下载（密钥已自动脱敏）；记下备份时间供提醒用
    container.querySelector('#mExport').addEventListener('click', function () {
      FIT.store.exportAll().then(function (backup) {
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fitness-backup-' + FIT.date.todayKey() + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        return FIT.store.setSetting('lastBackupAt', new Date().toISOString());
      }).then(function () {
        alert('备份已导出。说明：备份文件中的 API 密钥已自动清空（防止密钥随文件外传）；日后在本机恢复时密钥会自动保留，换设备恢复需重新填写。');
        render(container);
      });
    });

    // 恢复：选择文件 → 覆盖式导入（二次确认）
    container.querySelector('#mImportBtn').addEventListener('click', function () {
      container.querySelector('#mImportFile').click();
    });
    container.querySelector('#mImportFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var backup;
        try { backup = JSON.parse(reader.result); }
        catch (err) { alert('文件不是有效的 JSON 备份'); return; }
        if (!backup || backup.app !== 'fitness-helper' || !backup.data) {
          alert('这不是本应用的备份文件'); return;
        }
        if (!confirm('恢复将覆盖本机当前全部数据（成员、计划、记录等），确定继续？')) return;
        // 备份中密钥已被脱敏清空：恢复前用本机现有配置里相同厂商（名称+接口地址一致）的密钥回填
        mergeKeys(backup).then(function () {
          return FIT.store.importAll(backup);
        }).then(function () {
          alert('恢复完成。如厂商密钥未能自动回填（如换新设备），请到「模型配置中心」重新填写。');
          FIT.app.refreshAll();
        });
      };
      reader.readAsText(file, 'utf-8');
    });

    // 免责声明重看
    container.querySelector('#mDisclaimer').addEventListener('click', function () {
      FIT.app.showDisclaimer(true);
    });

    // 清空全部数据：输入「清空」二次确认（防误触）
    container.querySelector('#mWipe').addEventListener('click', function () {
      var input = prompt('此操作删除本机全部数据且不可恢复（已导出的备份除外）。输入「清空」确认：');
      if (input !== '清空') {
        if (input !== null) alert('未输入「清空」，操作已取消');
        return;
      }
      var names = ['members', 'logs', 'checkins', 'weights', 'exercises', 'chats', 'usages', 'facts', 'meals', 'settings'];
      var chain = Promise.resolve();
      names.forEach(function (n) {
        chain = chain.then(function () { return FIT.db.clear(n); });
      });
      chain.then(function () {
        alert('已清空全部数据，页面将刷新');
        location.reload();
      });
    });
  }

  /* ============================================================
   * 模型配置中心
   * ============================================================ */

  // 在配置里按 id 找厂商
  function findProvider(cfg, id) {
    for (var i = 0; i < cfg.providers.length; i++) {
      if (cfg.providers[i].id === id) return cfg.providers[i];
    }
    return null;
  }

  // 厂商列表 HTML
  function providersHtml(cfg) {
    if (!cfg.providers.length) {
      return '<p class="muted small">还没有配置厂商，点下方按钮添加第一个（推荐先加有免费额度的模型试水）。</p>';
    }
    var h = '';
    cfg.providers.forEach(function (p) {
      h += '<div class="provider-box">'
        + '<div class="p-head"><strong>' + escapeHtml(p.label) + '</strong>'
        + '<span class="m-acts">'
        + '<button type="button" class="btn sm ghost" data-p-test="' + p.id + '">测试连接</button>'
        + '<button type="button" class="btn sm ghost" data-p-edit="' + p.id + '">编辑</button>'
        + '<button type="button" class="btn sm danger" data-p-del="' + p.id + '">删除</button>'
        + '</span></div>'
        + '<div class="muted small">' + escapeHtml(p.baseUrl) + ' · 密钥 ' + maskKey(p.apiKey) + '</div>'
        + modelsHtml(p)
        + '<div class="muted small p-test-result" id="ptest-' + p.id + '">'
        + (lastTest && lastTest.pid === p.id ? escapeHtml(lastTest.text) : '')
        + '</div>'
        + '</div>';
    });
    return h;
  }

  // 单个厂商的模型列表 HTML
  function modelsHtml(p) {
    var list = p.models || [];
    if (!list.length) return '<div class="muted small">未配置模型，点「编辑」添加</div>';
    var h = '<ul class="model-list">';
    list.forEach(function (m) {
      h += '<li><span class="m-name">' + escapeHtml(m.name) + '</span>'
        + '<span class="chip tier-' + (m.tier || 'cheap') + '">' + FIT.ai.tierName(m.tier) + '</span>'
        + '<span class="muted small">' + priceText(m) + '</span></li>';
    });
    return h + '</ul>';
  }

  // 单价文案：元 / 百万 token；未配价返回「价格未配置」
  function priceText(m) {
    var inP = parseFloat(m.priceIn), outP = parseFloat(m.priceOut);
    if (!(inP >= 0) || !(outP >= 0)) return '价格未配置';
    return '输入 ' + inP + ' / 输出 ' + outP + ' 元/百万token';
  }

  // 密钥打码显示（只露头尾四位）
  function maskKey(key) {
    if (!key) return '未填写';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  }

  // 厂商编辑弹层（provider 为 null 表示新增）
  function openProviderDialog(cfg, provider, container) {
    var isNew = !provider;
    // 弹层内的编辑态（保存前不碰真实配置）
    var editing = {
      label: provider ? provider.label : '',
      baseUrl: provider ? provider.baseUrl : 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: provider ? provider.apiKey : '',
      models: provider && provider.models && provider.models.length
        ? JSON.parse(JSON.stringify(provider.models))
        : [{ name: '', tier: 'cheap', priceIn: '', priceOut: '' }]
    };

    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = ''
      + '<div class="dialog dialog-wide">'
      + '<h3>' + (isNew ? '添加厂商' : '编辑厂商') + '</h3>'
      + '<label class="form-row">厂商名称（自己起好认的）<input type="text" id="pvLabel" placeholder="如 智谱 / DeepSeek / OpenRouter" value="' + escapeAttr(editing.label) + '"></label>'
      + '<label class="form-row">接口地址（OpenAI 兼容 base URL）<input type="text" id="pvUrl" placeholder="https://open.bigmodel.cn/api/paas/v4" value="' + escapeAttr(editing.baseUrl) + '"></label>'
      + '<label class="form-row">API 密钥<input type="text" id="pvKey" placeholder="sk-…" value="' + escapeAttr(editing.apiKey) + '"></label>'
      + '<p class="small">模型列表（tier 用于教练页标注；单价单位：元/百万 token，用于费用估算，可不填）</p>'
      + '<div id="pvModels"></div>'
      + '<button type="button" class="btn ghost sm" id="pvAddModel">＋ 添加一个模型</button>'
      + '<div class="dialog-actions">'
      + '<button type="button" class="btn ghost" id="pvCancel">取消</button>'
      + '<button type="button" class="btn primary" id="pvSave">保存</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    var rowsBox = overlay.querySelector('#pvModels');
    drawModelRows();

    // 画模型编辑行（增删行后重画）
    function drawModelRows() {
      var h = '';
      editing.models.forEach(function (m, i) {
        h += '<div class="model-edit-row">'
          + '<input type="text" class="me-name" data-i="' + i + '" data-f="name" placeholder="模型名，如 glm-4-flash" value="' + escapeAttr(m.name) + '">'
          + '<select class="me-tier" data-i="' + i + '" data-f="tier">'
          + '<option value="free"' + (m.tier === 'free' ? ' selected' : '') + '>免费</option>'
          + '<option value="cheap"' + (m.tier === 'cheap' ? ' selected' : '') + '>便宜</option>'
          + '<option value="flagship"' + (m.tier === 'flagship' ? ' selected' : '') + '>旗舰</option>'
          + '</select>'
          + '<input type="number" class="me-price" data-i="' + i + '" data-f="priceIn" placeholder="输入价" min="0" step="any" value="' + escapeAttr(m.priceIn) + '">'
          + '<input type="number" class="me-price" data-i="' + i + '" data-f="priceOut" placeholder="输出价" min="0" step="any" value="' + escapeAttr(m.priceOut) + '">'
          + '<button type="button" class="btn sm danger" data-rowdel="' + i + '">删</button>'
          + '</div>';
      });
      rowsBox.innerHTML = h;
      // 输入实时同步回编辑态（避免重画丢输入）
      Array.prototype.forEach.call(rowsBox.querySelectorAll('input,select'), function (el) {
        var handler = function () { editing.models[+el.dataset.i][el.dataset.f] = el.value; };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      });
      // 删行
      Array.prototype.forEach.call(rowsBox.querySelectorAll('[data-rowdel]'), function (btn) {
        btn.addEventListener('click', function () {
          editing.models.splice(+btn.dataset.rowdel, 1);
          drawModelRows();
        });
      });
    }

    // 添加一行模型
    overlay.querySelector('#pvAddModel').addEventListener('click', function () {
      editing.models.push({ name: '', tier: 'cheap', priceIn: '', priceOut: '' });
      drawModelRows();
    });

    // 取消
    overlay.querySelector('#pvCancel').addEventListener('click', function () { overlay.remove(); });

    // 保存：校验后写入配置
    overlay.querySelector('#pvSave').addEventListener('click', function () {
      var label = overlay.querySelector('#pvLabel').value.trim();
      var baseUrl = overlay.querySelector('#pvUrl').value.trim();
      var apiKey = overlay.querySelector('#pvKey').value.trim();
      if (!label) { alert('请填写厂商名称'); return; }
      if (!/^https?:\/\//i.test(baseUrl)) { alert('接口地址需以 http:// 或 https:// 开头'); return; }
      if (!apiKey) { alert('请填写 API 密钥（本地无密钥服务可填任意占位符）'); return; }
      // 过滤掉没填模型名的空行
      var models = editing.models.filter(function (m) { return (m.name || '').trim(); })
        .map(function (m) {
          return { name: m.name.trim(), tier: m.tier, priceIn: m.priceIn, priceOut: m.priceOut };
        });
      if (!models.length) { alert('请至少配置一个模型（填写模型名）'); return; }
      // 同名模型去重（后写的覆盖先写的）
      var uniq = {};
      var finalModels = [];
      models.forEach(function (m) {
        if (!uniq[m.name]) { uniq[m.name] = true; finalModels.push(m); }
      });
      if (isNew) {
        cfg.providers.push({ id: FIT.db.uid(), label: label, baseUrl: baseUrl, apiKey: apiKey, models: finalModels });
      } else {
        provider.label = label;
        provider.baseUrl = baseUrl;
        provider.apiKey = apiKey;
        provider.models = finalModels;
      }
      FIT.ai.saveConfig(cfg).then(function () {
        overlay.remove();
        render(container);
      });
    });
  }

  // 测试连接：用厂商第一个模型发一句 ping（AI-06：以响应回传的实际模型名为准）
  function testProvider(cfg, p, container) {
    if (!p) return;
    var result = container.querySelector('#ptest-' + p.id);
    if (!(p.models || []).length) { result.textContent = '该厂商还没有配置模型'; return; }
    if (!p.apiKey) { result.textContent = '未填写 API 密钥'; return; }
    var m = p.models[0];
    result.textContent = '连接中…';
    FIT.ai.chat(p, m.name, [{ role: 'user', content: '请只回复两个字：正常' }], { temperature: 0 })
      .then(function (res) {
        var cost = FIT.ai.estimateCost(m, res.usage);
        var text = '✓ 连接成功：实际模型 ' + res.model + ' · ' + res.usage.total + ' token · ' + FIT.ai.costText(cost)
          + '（测试调用也计入本月用量）';
        // 记流水后整体重画（结果靠 lastTest 跨 render 回填）
        return FIT.ai.recordUsage(res.model, res.usage, cost, 'test').then(function () {
          lastTest = { pid: p.id, text: text };
          render(container);
        });
      })
      .catch(function (err) {
        lastTest = { pid: p.id, text: '✗ ' + err.message };
        render(container);
      });
  }

  /* ============================================================
   * AI 记忆管理
   * ============================================================ */

  // 加载并展示三张状态卡 + 画像条目列表
  function drawCards(container, active) {
    var box = container.querySelector('#cardsBox');
    if (!box) return;
    if (!active) {
      box.innerHTML = '<p class="muted small">还没有成员，先去「今日」页完成问卷建档。</p>';
      return;
    }
    box.innerHTML = '<p class="muted small">本地计算中…</p>';
    FIT.cards.build(active).then(function (cards) {
      box.innerHTML = ''
        + '<details class="card-block" open><summary>① 训练状态卡（自动计算）</summary><pre>' + escapeHtml(cards.training || '（暂无数据）') + '</pre></details>'
        + '<details class="card-block" open><summary>② 健康摘要卡（自动计算）</summary><pre>' + escapeHtml(cards.health || '（暂无数据）') + '</pre></details>'
        + '<details class="card-block" open><summary>③ 个人画像卡（' + cards.facts.length + ' 条，上限 ' + FIT.cards.FACT_LIMIT + ' 条，可人工改删）</summary>'
        + factsListHtml(cards.facts)
        + '</details>';
      bindFactEvents(box, active, container);
    });
  }

  // 画像条目列表（新的排前面）
  function factsListHtml(facts) {
    if (!facts.length) {
      return '<p class="muted small">暂无画像条目——和教练对话后，AI 会自动提取长期有效的事实（如「不吃香菜」「左膝有旧伤」）。</p>';
    }
    var h = '<ul class="fact-list">';
    facts.slice().reverse().forEach(function (f) {
      var day = (f.time || '').slice(0, 10);
      h += '<li><span class="f-text">' + escapeHtml(f.text) + '</span>'
        + '<span class="f-time muted small">' + day + '</span>'
        + '<span class="m-acts">'
        + '<button type="button" class="btn sm ghost" data-fact-edit="' + f.id + '">改</button>'
        + '<button type="button" class="btn sm danger" data-fact-del="' + f.id + '">删</button>'
        + '</span></li>';
    });
    return h + '</ul>';
  }

  // 画像条目的改 / 删事件
  function bindFactEvents(box, active, container) {
    Array.prototype.forEach.call(box.querySelectorAll('[data-fact-edit]'), function (btn) {
      btn.addEventListener('click', function () {
        FIT.db.get('facts', btn.dataset.factEdit).then(function (f) {
          if (!f) return;
          var text = prompt('修改画像条目（2~60 字）：', f.text);
          if (text === null) return;
          text = text.trim();
          if (!text) { alert('内容不能为空，如不要了请点「删」'); return; }
          f.text = text;
          return FIT.store.saveFact(f).then(function () { drawCards(container, active); });
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-fact-del]'), function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('删除这条画像？删除后 AI 将不再记得这件事。')) return;
        FIT.store.deleteFact(btn.dataset.factDel).then(function () { drawCards(container, active); });
      });
    });
  }

  /* ============================================================
   * 预算与隐私设置
   * ============================================================ */

  function budgetBlockHtml(cfg, usage) {
    var limit = parseFloat(cfg.budget.monthlyLimit);
    if (!(limit >= 0)) limit = 0;
    var days = cfg.photoKeepDays !== undefined ? cfg.photoKeepDays : 30;
    return '<div class="log-card"><h4>预算与隐私设置</h4>'
      + '<label class="form-row">月度预算上限（元，0 = 不设限）<input type="number" id="setBudget" min="0" step="0.5" value="' + limit + '"></label>'
      + '<label class="form-row">饮食照片保留天数（0 = 永久，过期自动清理图片、保留文字记录）<input type="number" id="setPhotoDays" min="0" step="1" value="' + days + '"></label>'
      + '<label class="form-row check-row">健康周报页提供 AI 总结（约百字，每次约 1 分钱）<input type="checkbox" id="setWeekly"' + (cfg.aiWeeklySummary ? ' checked' : '') + '></label>'
      + '<button type="button" class="btn primary block" id="setSave">保存设置</button>'
      + usageHtml(usage, limit)
      + '</div>';
  }

  // 本月用量汇总文案
  function usageHtml(usage, limit) {
    var h = '<div class="usage-box small">本月 AI 用量：调用 ' + usage.count + ' 次 · '
      + usage.tokens + ' token · 花费约 ' + FIT.ai.costText(usage.cost) + '</div>';
    if (limit > 0) {
      var over = usage.cost >= limit;
      h += '<div class="small ' + (over ? 'over-warn' : 'muted') + '">'
        + (over
            ? '⚠ 已触顶（上限 ' + limit + ' 元）——教练页已自动降级为纯本地免费模式，下月 1 号自动恢复'
            : '预算上限 ' + limit + ' 元，触顶后自动降级纯本地模式，不会多花一分钱')
        + '</div>';
    } else {
      h += '<div class="muted small">当前未设预算上限，建议设置一个，防止模型抽风时意外花费</div>';
    }
    return h;
  }

  /* ============================================================
   * 工具
   * ============================================================ */

  // 恢复备份前的密钥回填：备份 v3 起 apiKey 被清空，
  // 若本机现有配置里存在相同厂商（名称 + 接口地址一致）且已填密钥，则自动回填，免重填
  function mergeKeys(backup) {
    return FIT.ai.getConfig().then(function (local) {
      var rows = (backup.data && backup.data.settings) || [];
      var row = null;
      rows.forEach(function (r) { if (r.key === 'aiConfig') row = r; });
      if (!row || !row.value || !(row.value.providers || []).length) return;
      row.value.providers.forEach(function (bp) {
        if (bp.apiKey) return; // 备份里本就有（旧版未脱敏备份），不动
        var hit = null;
        (local.providers || []).forEach(function (lp) {
          if (!hit && lp.label === bp.label && lp.baseUrl === bp.baseUrl) hit = lp;
        });
        if (hit && hit.apiKey) bp.apiKey = hit.apiKey;
      });
    });
  }

  // 备份是否超期（从未备份 或 超过 14 天）
  function backupStale(ts) {
    if (!ts) return true;
    var days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    return days > 14;
  }

  // 备份时间展示文案
  function backupText(ts) {
    if (!ts) return '上次备份：从未备份 —— 数据只存在本机，建议立即导出一次';
    var days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    return '上次备份：' + String(ts).slice(0, 10) + '（' + days + ' 天前）'
      + (days > 14 ? '，已超过两周，建议再导出一次' : '');
  }

  // 防 XSS 的简易转义
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 属性值转义（双引号场景，同 escapeHtml）
  function escapeAttr(s) { return escapeHtml(s === undefined || s === null ? '' : s); }

  FIT.me = { render: render, escapeHtml: escapeHtml };
})();
