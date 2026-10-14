/* ============================================================
 * report.js —— 报训练的确认入库与自动建议（v4 核心模块）
 * 流程：解析草稿 → 确认卡（可改可删可加）→ 入库 logs 表 → 自动建议
 * 建议策略：
 *   有 AI 模型且预算未触顶 → AI 顾问建议（标注模型/token/费用，记流水 kind='advice'）
 *   未配 AI / 预算触顶 / AI 调用失败 → 本地规则兜底建议（免费，如实标注）
 * 建议同时写入该条日志与顾问页对话流，方便回看与追问
 * 被 today.js（今日页）与 coach.js（顾问页对话）共用
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  /* ============ 确认卡（弹层） ============
   * 参数：member 当前成员
   *       draft  { items:[{name,weight,sets,reps,unit}], note:原文 }
   *       cbs    { onSaved(log) 入库后回调；onAdvice(log) 建议生成后回调 }
   * 确认卡全手动填写也可打开（items 传空数组） */
  function openConfirm(member, draft, cbs) {
    cbs = cbs || {};
    var items = (draft.items || []).map(function (it) {
      return { name: it.name || '', weight: it.weight || 0, sets: it.sets || 0, reps: it.reps || 0 };
    });
    var note = draft.note || '';
    var listId = 'exlist-' + FIT.db.uid(); // datalist id（防多弹层冲突）

    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = ''
      + '<div class="dialog dialog-wide">'
      + '<h3>确认这次训练</h3>'
      + '<p class="muted small">本地解析结果（免费），请核对修改后再入库。动作名可输入，会联想动作库。</p>'
      + (note ? '<p class="muted small">原文：' + escapeHtml(note) + '</p>' : '')
      + '<datalist id="' + listId + '"></datalist>'
      + '<div class="meal-edit-head small"><span>动作</span><span>重量kg</span><span>组数</span><span>次数</span><span></span></div>'
      + '<div id="rpItems"></div>'
      + '<button type="button" class="btn ghost sm" id="rpAdd">＋ 手动补一条</button>'
      + '<div class="dialog-actions">'
      +   '<button type="button" class="btn ghost" id="rpCancel">取消</button>'
      +   '<button type="button" class="btn primary" id="rpOk">确认记录</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    var $ = function (sel) { return overlay.querySelector(sel); };
    var itemsBox = $('#rpItems');

    // 动作联想候选（动作库全量）
    FIT.store.allExercises().then(function (all) {
      $('#' + listId).innerHTML = all.map(function (ex) {
        return '<option value="' + escapeAttr(ex.name) + '"></option>';
      }).join('');
    });

    // 画编辑行（增删后重画，输入同步回 items）
    function drawItems() {
      var h = '';
      items.forEach(function (it, i) {
        h += '<div class="meal-edit-row">'
          + '<input type="text" class="rp-name" data-i="' + i + '" list="' + listId + '" placeholder="动作名" value="' + escapeAttr(it.name) + '">'
          + '<input type="number" class="rp-num" data-i="' + i + '" data-f="weight" min="0" step="0.5" value="' + it.weight + '">'
          + '<input type="number" class="rp-num" data-i="' + i + '" data-f="sets" min="0" step="1" value="' + it.sets + '">'
          + '<input type="number" class="rp-num" data-i="' + i + '" data-f="reps" min="0" step="1" value="' + it.reps + '">'
          + '<button type="button" class="btn sm danger" data-rp-del="' + i + '">删</button>'
          + '</div>';
      });
      itemsBox.innerHTML = h;
      Array.prototype.forEach.call(itemsBox.querySelectorAll('input'), function (el) {
        el.addEventListener('input', function () {
          var i = +el.dataset.i;
          if (el.classList.contains('rp-name')) items[i].name = el.value;
          else items[i][el.dataset.f] = Math.max(0, parseFloat(el.value) || 0);
        });
      });
      Array.prototype.forEach.call(itemsBox.querySelectorAll('[data-rp-del]'), function (btn) {
        btn.addEventListener('click', function () {
          items.splice(+btn.dataset.rpDel, 1);
          drawItems();
        });
      });
    }

    $('#rpAdd').addEventListener('click', function () {
      items.push({ name: '', weight: 0, sets: 0, reps: 0 });
      drawItems();
    });
    $('#rpCancel').addEventListener('click', function () { overlay.remove(); });
    $('#rpOk').addEventListener('click', function () {
      // 过滤有效行（有动作名即可），数值取整/规范化
      var valid = items.filter(function (it) { return (it.name || '').trim(); }).map(function (it) {
        return {
          name: it.name.trim(),
          weight: Math.max(0, parseFloat(it.weight) || 0),
          sets: Math.max(0, Math.round(parseFloat(it.sets) || 0)),
          reps: Math.max(0, Math.round(parseFloat(it.reps) || 0))
        };
      });
      if (!valid.length) { alert('至少保留一条有动作名的记录'); return; }
      overlay.remove();
      saveAndAdvice(member, note, valid, cbs);
    });

    drawItems();
  }

  /* ============ 入库 + 自动建议 ============ */
  function saveAndAdvice(member, raw, items, cbs) {
    var log = {
      id: FIT.db.uid(),
      memberId: member.id,
      date: FIT.date.todayKey(),
      time: new Date().toISOString(),
      raw: raw || '',
      exercises: items,
      volume: volumeOf(items),
      advice: null
    };
    FIT.store.saveLog(log).then(function () {
      if (cbs.onSaved) cbs.onSaved(log);   // 上层先刷新展示记录（建议生成中）
      return giveAdvice(member, log);
    }).then(function (advice) {
      log.advice = advice;
      return FIT.store.saveLog(log).then(function () {
        // 建议同步进顾问页对话流（可回看、可追问）
        return FIT.store.saveChat({
          id: FIT.db.uid(), memberId: member.id, who: 'bot',
          text: advice.text, model: advice.model || null, tokens: advice.tokens || 0,
          cost: advice.cost !== undefined ? advice.cost : null, local: !!advice.local,
          time: new Date().toISOString()
        });
      }).then(function () {
        if (cbs.onAdvice) cbs.onAdvice(log); // 上层二次刷新展示建议
      });
    });
  }

  /* ============ 建议生成：AI 优先，本地兜底 ============ */
  function giveAdvice(member, log) {
    return Promise.all([
      FIT.ai.getConfig(),
      FIT.ai.budgetInfo(),
      FIT.store.getSetting('coachModel'),
      FIT.cards.build(member),
      FIT.store.allLogs(member.id),
      FIT.store.allCheckins(member.id)
    ]).then(function (rs) {
      var cfg = rs[0], budget = rs[1], sel = rs[2], cards = rs[3], logs = rs[4], checkins = rs[5];
      var found = pickModel(cfg, sel);
      if (found && !budget.over) {
        return aiAdvice(member, log, cards, found).catch(function (err) {
          // AI 失败回落本地建议，如实标注原因（保证主人总能拿到建议）
          var text = localAdvice(member, log, logs, checkins)
            + '\n（AI 建议不可用：' + err.message + '，已用本地免费建议）';
          return { text: text, local: true, time: new Date().toISOString() };
        });
      }
      // 未配 AI 或预算触顶：本地规则建议
      var text = localAdvice(member, log, logs, checkins);
      if (budget.over) text += '\n（本月 AI 额度已用完，以上为本地免费建议，下月自动恢复 AI 建议）';
      return { text: text, local: true, time: new Date().toISOString() };
    });
  }

  // 选模型：顾问页选择的模型优先，其次第一个可用模型
  function pickModel(cfg, sel) {
    if (sel && sel !== 'local') {
      var hit = FIT.ai.findModel(cfg, sel.providerId, sel.name);
      if (hit) return hit;
    }
    for (var i = 0; i < cfg.providers.length; i++) {
      var p = cfg.providers[i];
      if (p.models && p.models.length) return { provider: p, model: p.models[0] };
    }
    return null;
  }

  // AI 建议：顾问角色 + 医疗边界 + 三张卡 + 本次记录，一次调用
  function aiAdvice(member, log, cards, found) {
    var exTxt = log.exercises.map(function (e) {
      return e.name + (e.weight > 0 ? ' ' + e.weight + 'kg' : '（自重）')
        + (e.sets && e.reps ? ' ' + e.sets + '×' + e.reps : '');
    }).join('、');
    var prompt = '你是「' + member.name + '」的训练顾问。TA 自己安排训练，练完报给你，你只负责分析和建议，'
      + '不替 TA 制定计划、不督促。\n'
      + '【医疗边界——最高优先级】不做医疗诊断、不解读病情；发现异常信号（胸痛、头晕、持续加重疼痛）只建议尽快就医。\n'
      + '【本次训练记录】' + exTxt + '（总容量约 ' + Math.round(log.volume || 0) + ' kg）'
      + (log.raw ? '\nTA 的原话：' + log.raw : '')
      + '\n【训练状态卡】\n' + cards.training
      + '\n【健康摘要卡】\n' + cards.health
      + '\n【个人画像卡】\n' + cards.profile
      + '\n要求：中文，200 字以内，口语化。围绕这次训练给各方面建议：这次安排是否合理、下次重量或组次怎么调、'
      + '恢复睡眠饮食怎么配合。只引用上面给出的数据，没有的数据说「暂无记录」，不编造、不做医疗诊断。';
    return FIT.ai.chat(found.provider, found.model.name,
      [{ role: 'user', content: prompt }], { temperature: 0.5 }).then(function (res) {
        var cost = FIT.ai.estimateCost(found.model, res.usage);
        return FIT.ai.recordUsage(res.model, res.usage, cost, 'advice').then(function () {
          return {
            text: (res.text || '').trim(), model: res.model,
            tokens: res.usage.total, cost: cost, local: false,
            time: new Date().toISOString()
          };
        });
      });
  }

  /* ============ 本地兜底建议（免费规则） ============ */
  function localAdvice(member, log, logs, checkins) {
    var lines = [];
    lines.push('已记录：' + log.exercises.map(function (e) {
      return e.name + (e.weight > 0 ? ' ' + e.weight + 'kg' : '（自重）')
        + (e.sets && e.reps ? ' ' + e.sets + '×' + e.reps : '');
    }).join('、') + '，总容量约 ' + Math.round(log.volume || 0) + ' kg。');

    // 各动作与上次同动作的重量对比（本次之前的最近一次）
    var before = logs.filter(function (l) { return l.id !== log.id; })
      .sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
    log.exercises.forEach(function (e) {
      for (var i = before.length - 1; i >= 0; i--) {
        var hit = (before[i].exercises || []).filter(function (x) { return x.name === e.name; })[0];
        if (hit) {
          if (e.weight > 0 && hit.weight > 0) {
            var d = e.weight - hit.weight;
            lines.push('· ' + e.name + '：较上次（' + before[i].date.slice(5) + '，' + hit.weight + 'kg）'
              + (d > 0 ? ' +' + d + 'kg，稳步上加' : (d < 0 ? ' ' + d + 'kg，有所回落' : ' 持平')));
          }
          break;
        }
      }
    });

    // 本周第几次训练
    var weekStart = FIT.date.weekStartKey(new Date());
    var thisWeek = logs.filter(function (l) { return l.date >= weekStart; }).length;
    lines.push('· 本周第 ' + thisWeek + ' 次训练');

    // 近 7 天睡眠 / 酸痛提示（数据来自健康打卡，缺项自动跳过）
    var sevenAgo = FIT.date.toKey(FIT.date.addDays(new Date(), -7));
    var last7 = checkins.filter(function (c) { return c.date >= sevenAgo; });
    var sleeps = last7.map(function (c) { return c.sleep; }).filter(function (v) { return typeof v === 'number'; });
    if (sleeps.length) {
      var avgS = sleeps.reduce(function (a, b) { return a + b; }, 0) / sleeps.length;
      if (avgS < 6.5) lines.push('· 近 7 天睡眠均值 ' + avgS.toFixed(1) + 'h 偏低，恢复优先，下次别急着加重');
    }
    var heavyN = last7.filter(function (c) { return c.soreness === 'heavy'; }).length;
    if (heavyN >= 2) lines.push('· 近期酸痛「重」' + heavyN + ' 次，注意拉伸与休息');

    lines.push('（本地免费建议；配置 AI 模型后可获得更全面的分析）');
    return lines.join('\n');
  }

  /* ============ 工具 ============ */
  // 训练容量：Σ 重量×组数×次数（自重动作 weight=0 不计容量）
  function volumeOf(items) {
    var v = 0;
    items.forEach(function (it) { v += (it.weight || 0) * (it.sets || 0) * (it.reps || 0); });
    return Math.round(v);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s === undefined || s === null ? '' : s); }

  FIT.report = {
    openConfirm: openConfirm,
    volumeOf: volumeOf
  };
})();
