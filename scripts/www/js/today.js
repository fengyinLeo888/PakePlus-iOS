/* ============================================================
 * today.js —— 今日页（v4：报训练主页）
 * 定位：成员自己安排训练，练完在这里（或顾问页对话中）报给应用
 * 流程：输入 → 本地解析（免费）→ 确认卡 → 入库 → 自动生成建议（AI / 本地兜底）
 * 另保留：健康打卡快捷卡（FR-05）、备份提醒横幅
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  // 建议生成中的日志 id 集合（入库 → 建议返回之间，页面显示「建议生成中」）
  var pendingAdvice = {};

  // 首页隐私提示条（APK 分发版要求：告知数据仅存本机 + AI 消耗本人额度）
  function privacyTipHtml() {
    return '<div class="log-card">'
      + '<p class="muted small">本APP所有身体数据仅保存在本机，不会上传云端；AI 咨询请在「我的 → 模型配置」填写你自己的 API 密钥与接口地址，消耗你本人的模型额度。</p>'
      + '</div>';
  }

  function render(container) {
    FIT.store.getActiveMember().then(function (member) {
      // ---- 未建档：引导问卷 ----
      if (!member) {
        container.innerHTML = privacyTipHtml()
          + '<div class="hero-card">'
          +   '<div class="hero-emoji">👋</div>'
          +   '<h3>先完成 1 分钟问卷</h3>'
          +   '<p>让顾问了解你<br>目标 · 经验 · 伤病史 · 器械</p>'
          +   '<button type="button" class="btn primary block" id="goSurvey">开始问卷建档</button>'
          + '</div>';
        container.querySelector('#goSurvey').addEventListener('click', function () {
          FIT.app.goSurvey();
        });
        return;
      }

      FIT.store.allLogs(member.id).then(function (logs) {
        drawMain(container, member, logs);
        showBackupHint(container);
      });
    });
  }

  /* ============================================================
   * 主视图：报训练卡 + 今日记录 + 健康打卡槽
   * ============================================================ */
  function drawMain(container, member, logs) {
    var todayKey = FIT.date.todayKey();
    var todayLogs = logs.filter(function (l) { return l.date === todayKey; });
    todayLogs.sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });

    container.innerHTML = privacyTipHtml()
      + '<div class="log-card">'
      +   '<h4>今天练了什么？</h4>'
      +   '<div class="report-bar">'
      +     '<input type="text" id="rpInput" placeholder="如：深蹲 80kg 5×5，卧推 60kg 4×8" enterkeyhint="send">'
      +     '<button type="button" class="btn primary" id="rpSend">记录</button>'
      +   '</div>'
      +   '<p class="muted small">练完直接说，本地免费解析，确认后入库并自动生成建议；自重动作如「引体向上 3×10」。也可以在「顾问」页边聊边报。</p>'
      + '</div>'
      + '<div id="todayLogs"></div>'
      + '<div id="todayCheckinSlot"></div>';

    drawTodayLogs(container.querySelector('#todayLogs'), todayLogs);
    drawCheckinSlot(container.querySelector('#todayCheckinSlot'), member);

    var input = container.querySelector('#rpInput');
    function send() {
      var text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      handleReport(container, member, text);
    }
    container.querySelector('#rpSend').addEventListener('click', send);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  }

  /* ---- 今日已记录列表（含建议展示） ---- */
  function drawTodayLogs(box, todayLogs) {
    if (!todayLogs.length) { box.innerHTML = ''; return; }
    var html = '<div class="log-card"><h4>今日已记录 ' + todayLogs.length + ' 次</h4>';
    todayLogs.forEach(function (log) {
      var hm = (log.time || '').slice(11, 16);
      html += '<div class="today-log">'
        + '<div class="log-head"><span class="small"><b>' + hm + '</b> · 容量约 ' + Math.round(log.volume || 0) + 'kg</span>'
        + '<button type="button" class="btn sm danger" data-log-del="' + log.id + '">删</button></div>'
        + '<div class="small">' + escapeHtml(itemsText(log)) + '</div>'
        + adviceHtml(log)
        + '</div>';
    });
    box.innerHTML = html + '</div>';

    Array.prototype.forEach.call(box.querySelectorAll('[data-log-del]'), function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('删除这条训练记录（连同它的建议）？')) return;
        FIT.db.del('logs', btn.dataset.logDel).then(function () {
          render(document.getElementById('page-today'));
        });
      });
    });
  }

  // 动作条目转文字
  function itemsText(log) {
    return (log.exercises || []).map(function (e) {
      return e.name + (e.weight > 0 ? ' ' + e.weight + 'kg' : '（自重）')
        + (e.sets && e.reps ? ' ' + e.sets + '×' + e.reps : '');
    }).join('、');
  }

  // 建议区：AI 建议（标注模型/token/费用）/ 本地建议（免费）/ 生成中
  function adviceHtml(log) {
    if (log.advice && log.advice.text) {
      var fee = log.advice.local
        ? '<div class="fee small">本地建议 · 免费（未调用 AI）</div>'
        : '<div class="fee small">' + escapeHtml(log.advice.model || '') + ' · '
          + (log.advice.tokens || 0) + ' token · ' + FIT.ai.costText(log.advice.cost) + '</div>';
      return '<div class="ai-summary"><b>' + (log.advice.local ? '本地建议' : '顾问建议') + '</b>：'
        + escapeHtml(log.advice.text) + fee + '</div>';
    }
    if (pendingAdvice[log.id]) {
      return '<div class="muted small">建议生成中（约 5~20 秒）…</div>';
    }
    return '';
  }

  /* ---- 报训练入口：解析 → 确认卡 → 入库 → 建议 ---- */
  function handleReport(container, member, text) {
    FIT.store.allExercises().then(function (all) {
      var parsed = FIT.parser.parse(text, all);
      if (parsed) { openCard(parsed); return; }
      // 一个库内动作都没识别到：允许全手动填写（动作库外的动作可手动输入名字）
      if (confirm('没识别到动作库里的动作。点「确定」手动填写，或点「取消」换个说法。')) {
        openCard({ items: [], note: text });
      }
    });

    function openCard(draft) {
      FIT.report.openConfirm(member, draft, {
        onSaved: function (log) {
          pendingAdvice[log.id] = true;
          render(container);
        },
        onAdvice: function (log) {
          delete pendingAdvice[log.id];
          render(container);
        }
      });
    }
  }

  /* ============================================================
   * 备份提醒：从未备份或超过 14 天未备份时，在页面顶部插一条温和横幅
   * 在 drawMain 之后调用：drawMain 为同步渲染，本函数异步插入不受影响
   * ============================================================ */
  function showBackupHint(container) {
    FIT.store.getSetting('lastBackupAt').then(function (ts) {
      var days = ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null;
      if (days !== null && days <= 14) return; // 两周内备份过，不打扰
      var bar = document.createElement('div');
      bar.className = 'budget-warn';
      bar.textContent = (days === null ? '还从未备份过数据。' : '距上次备份已 ' + days + ' 天。')
        + '数据只存在本机，丢手机或清缓存就没了 —— ';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn sm ghost';
      btn.textContent = '去备份';
      btn.addEventListener('click', function () { FIT.app.switchTab('me'); });
      bar.appendChild(btn);
      container.insertBefore(bar, container.firstChild);
    });
  }

  /* ============================================================
   * 今日健康打卡（FR-05，保留原有实现）
   * ============================================================ */
  function drawCheckinSlot(slot, member) {
    var todayKey = FIT.date.todayKey();
    FIT.store.getCheckin(member.id, todayKey).then(function (c) {
      var done = !!c;
      var html = '<div class="checkin-card">'
        + '<h4>今日健康打卡</h4>';
      if (done) {
        html += '<p class="checkin-done">✓ 睡眠 ' + c.sleep + 'h · 精力 ' + c.energy
          + ' · 压力 ' + c.stress + ' · 酸痛 ' + soreName(c.soreness) + '</p>';
      } else {
        html += '<p class="muted">一分钟，让顾问知道你的状态</p>'
          + '<button type="button" class="btn ghost block" id="tCheckin">去打卡</button>';
      }
      html += '</div>';
      slot.innerHTML = html;
      var btn = slot.querySelector('#tCheckin');
      if (btn) {
        btn.addEventListener('click', function () {
          openCheckinDialog(member, function () { render(document.getElementById('page-today')); });
        });
      }
    });
  }

  // 酸痛三档显示名
  function soreName(v) { return { none: '无', light: '轻', heavy: '重' }[v] || v; }

  /* ---- 打卡弹窗（四项，必填） ---- */
  function openCheckinDialog(member, onSaved) {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = ''
      + '<div class="dialog">'
      +   '<h3>今日健康打卡</h3>'
      +   '<label class="form-row">睡眠时长（小时）<input type="number" id="ckSleep" min="0" max="24" step="0.5" placeholder="如 7.5"></label>'
      +   '<label class="form-row">精力（1 疲惫 ~ 5 神清气爽）<input type="number" id="ckEnergy" min="1" max="5" step="1" placeholder="1~5"></label>'
      +   '<label class="form-row">心情压力（1 爆表 ~ 5 轻松）<input type="number" id="ckStress" min="1" max="5" step="1" placeholder="1~5"></label>'
      +   '<label class="form-row">肌肉酸痛'
      +     '<select id="ckSore"><option value="none">无</option><option value="light">轻</option><option value="heavy">重</option></select>'
      +   '</label>'
      +   '<div class="dialog-actions">'
      +     '<button type="button" class="btn ghost" id="ckCancel">取消</button>'
      +     '<button type="button" class="btn primary" id="ckSave">保存</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#ckCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#ckSave').addEventListener('click', function () {
      var sleep = parseFloat(overlay.querySelector('#ckSleep').value);
      var energy = parseInt(overlay.querySelector('#ckEnergy').value, 10);
      var stress = parseInt(overlay.querySelector('#ckStress').value, 10);
      var sore = overlay.querySelector('#ckSore').value;
      // 四项必填校验
      if (!(sleep >= 0 && sleep <= 24) || !(energy >= 1 && energy <= 5) || !(stress >= 1 && stress <= 5)) {
        alert('请完整填写四项（睡眠 0~24 小时，精力与压力 1~5 分）');
        return;
      }
      var todayKey = FIT.date.todayKey();
      FIT.store.getCheckin(member.id, todayKey).then(function (old) {
        var c = old || { id: FIT.db.uid(), memberId: member.id, date: todayKey };
        c.sleep = sleep; c.energy = energy; c.stress = stress; c.soreness = sore;
        return FIT.store.saveCheckin(c);
      }).then(function () {
        overlay.remove();
        if (onSaved) onSaved();
      });
    });
  }

  // 防 XSS 的简易转义（AI 生成的文本需转义后再回显）
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 打卡弹窗也供记录页使用
  FIT.today = { render: render, openCheckinDialog: openCheckinDialog };
})();
