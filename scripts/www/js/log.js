/* ============================================================
 * log.js —— 记录页（对应 PRD FR-03 / FR-08 / AI-07）
 * 区块：体重 / 健康周报（本地四指标 + 可选 AI 总结）/ 饮食记录
 *       / 打卡历史 / 训练日志
 * 本地统计 0 元；AI 总结按周缓存，一次付费反复看
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  function render(container) {
    FIT.store.getActiveMember().then(function (member) {
      if (!member) {
        container.innerHTML = '<div class="empty-tip">先在「我的」页创建成员，这里会展示 TA 的记录</div>';
        return;
      }
      Promise.all([
        FIT.store.allLogs(member.id),
        FIT.store.allWeights(member.id),
        FIT.store.allCheckins(member.id),
        FIT.store.allMeals(member.id),
        FIT.ai.getConfig()
      ]).then(function (rs) {
        draw(container, member, rs[0], rs[1], rs[2], rs[3], rs[4]);
      });
    });
  }

  function draw(container, member, logs, weights, checkins, meals, cfg) {
    // 数据按日期升序（曲线需要）
    weights.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    checkins.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    // 日志按日期倒序（最新在上）
    logs.sort(function (a, b) { return a.date > b.date ? -1 : 1; });

    var html = '';

    /* ---- 区块一：体重（录入 + 曲线） ---- */
    html += '<div class="log-card">'
      + '<div class="log-head"><h4>体重</h4>'
      +   '<div class="weight-form"><input type="number" id="wInput" step="0.1" min="20" max="300" placeholder="kg">'
      +   '<button type="button" class="btn primary sm" id="wSave">记录</button></div>'
      + '</div>'
      + '<div id="wChart"></div>'
      + '</div>';

    /* ---- 区块二：健康周报（本地四指标 + 可选 AI 总结，PRD FR-08） ---- */
    var last7 = checkins.filter(function (c) {
      return c.date >= FIT.date.toKey(FIT.date.addDays(new Date(), -7));
    });
    // 补录可能缺字段，先过滤非数值再求均值（防 NaN）
    var sleepAvg = avg(nums(last7, 'sleep'));
    var energyAvg = avg(nums(last7, 'energy'));
    var times7 = logs.filter(function (l) { return l.date >= FIT.date.toKey(FIT.date.addDays(new Date(), -7)); }).length;
    var wDelta = weights.length >= 2 ? (weights[weights.length - 1].weight - weights[0].weight) : null;

    html += '<div class="log-card">'
      + '<h4>健康周报（近 7 天）</h4>'
      + '<div class="stat-row">'
      +   '<span class="chip">睡眠 ' + (sleepAvg === null ? '—' : sleepAvg.toFixed(1) + 'h') + '</span>'
      +   '<span class="chip">精力 ' + (energyAvg === null ? '—' : energyAvg.toFixed(1)) + '</span>'
      +   '<span class="chip">训练 ' + times7 + ' 次</span>'
      +   '<span class="chip">体重 ' + (wDelta === null ? '—' : (wDelta > 0 ? '+' : '') + wDelta.toFixed(1) + 'kg') + '</span>'
      + '</div>'
      + '<div class="muted small">打卡 ' + last7.length + '/7 天 · 上面四项本地计算 0 元</div>'
      + '<div id="wkAIBox"></div>'
      + weeklyBtnHtml(cfg)
      + '</div>';

    /* ---- 区块三：饮食记录（阶段二，PRD AI-07） ---- */
    var sevenAgoKey = FIT.date.toKey(FIT.date.addDays(new Date(), -7));
    var recentMeals = meals.filter(function (m) { return m.date >= sevenAgoKey; });
    recentMeals.sort(function (a, b) { return a.time > b.time ? -1 : 1; });

    html += '<div class="log-card">'
      + '<div class="log-head"><h4>饮食记录（近 7 天）</h4>'
      + '<button type="button" class="btn primary sm" id="mealAdd">＋ 拍照记录</button></div>'
      + '<div class="muted small">拍照识别入库，热量/蛋白质为 AI 视觉估算（±20% 误差，可手动修正）；后续分析读本地数据，不重复花钱。</div>';
    if (!recentMeals.length) {
      html += '<div class="muted small">还没有饮食记录，点右上角拍照记录第一餐</div>';
    } else {
      html += '<div class="meal-list">';
      recentMeals.forEach(function (m) {
        var cal = 0, pro = 0;
        (m.items || []).forEach(function (it) { cal += it.calories || 0; pro += it.protein || 0; });
        var hm = (m.time || '').slice(11, 16);
        var itemsTxt = (m.items || []).map(function (it) {
          return it.name + (it.amount ? ' ' + it.amount : '') + '（' + (it.calories || 0) + 'kcal）';
        }).join('、');
        html += '<div class="meal-item">'
          + (m.photo
              ? '<img class="meal-thumb" src="' + m.photo + '" alt="餐食照片（点击放大）">'
              : '<span class="meal-thumb none"></span>')
          + '<div class="meal-info"><div>' + FIT.date.shortKey(m.date) + ' ' + hm
          + ' · 合计 ' + cal + ' kcal · 蛋白 ' + pro + 'g</div>'
          + '<div class="muted small">' + escapeHtml(itemsTxt) + '</div></div>'
          + '<button type="button" class="btn sm danger" data-meal-del="' + m.id + '">删</button>'
          + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    /* ---- 区块四：打卡历史（近 7 条） ---- */
    html += '<div class="log-card"><h4>打卡历史</h4>';
    if (checkins.length === 0) {
      html += '<div class="muted small">还没有打卡记录（今日页有快捷入口）</div>';
    } else {
      html += '<ul class="history-list">';
      checkins.slice(-7).reverse().forEach(function (c) {
        html += '<li><span>' + FIT.date.shortKey(c.date) + '</span>'
          + '<span>睡 ' + c.sleep + 'h · 精力 ' + c.energy + ' · 压力 ' + c.stress
          + ' · 酸痛 ' + ({ none: '无', light: '轻', heavy: '重' }[c.soreness] || c.soreness) + '</span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';

    /* ---- 区块五：训练日志（可展开明细；兼容 v3 旧结构与 v4 新结构） ---- */
    html += '<div class="log-card"><h4>训练日志</h4>';
    if (logs.length === 0) {
      html += '<div class="muted small">还没有训练记录，去「今日」页报第一次训练</div>';
    } else {
      logs.forEach(function (log) {
        var hm = (log.time || '').slice(11, 16);
        html += '<details class="log-item">'
          + '<summary>' + log.date + (hm ? ' ' + hm : '') + ' · ' + (log.dayLabel || '训练')
          + '<span class="log-vol">' + Math.round(log.volume || 0) + 'kg</span></summary>'
          + '<ul class="log-detail">';
        (log.exercises || []).forEach(function (le) {
          // 旧结构 sets 为数组 [{weight,reps}]；新结构为 {weight,sets,reps} 数值
          var txt;
          if (Array.isArray(le.sets)) {
            txt = le.sets.map(function (s) { return s.weight + '×' + s.reps; }).join('、');
          } else {
            txt = (le.weight > 0 ? le.weight + 'kg ' : '自重 ') + (le.sets || 0) + '×' + (le.reps || 0);
          }
          html += '<li><b>' + escapeHtml(le.name) + '</b>：' + txt + '</li>';
        });
        if (log.raw) html += '<li class="muted small">原话：' + escapeHtml(log.raw) + '</li>';
        html += '</ul>';
        // v4：每条记录的建议（AI 标注模型/token/费用；本地标注免费）
        if (log.advice && log.advice.text) {
          html += '<div class="ai-summary"><b>' + (log.advice.local ? '本地建议' : '顾问建议') + '</b>：'
            + escapeHtml(log.advice.text)
            + '<div class="fee small">'
            + (log.advice.local
                ? '本地建议 · 免费（未调用 AI）'
                : escapeHtml(log.advice.model || '') + ' · ' + (log.advice.tokens || 0) + ' token · ' + FIT.ai.costText(log.advice.cost))
            + '</div></div>';
        }
        html += '</details>';
      });
    }
    html += '</div>';

    container.innerHTML = html;

    /* ---- 渲染体重曲线 ---- */
    FIT.chart.line(container.querySelector('#wChart'),
      weights.map(function (w) { return { label: FIT.date.shortKey(w.date), value: w.weight }; }),
      { color: '#166534', unit: 'kg', height: 110 });

    /* ---- 体重录入（每日一次，同日覆盖） ---- */
    container.querySelector('#wSave').addEventListener('click', function () {
      var v = parseFloat(container.querySelector('#wInput').value);
      if (!(v > 20 && v < 300)) { alert('请输入合理体重（20~300kg）'); return; }
      var todayKey = FIT.date.todayKey();
      FIT.store.getWeight(member.id, todayKey).then(function (old) {
        var w = old || { id: FIT.db.uid(), memberId: member.id, date: todayKey };
        w.weight = v;
        return FIT.store.saveWeight(w);
      }).then(function () { render(container); });
    });

    /* ---- 周报 AI 总结（按周缓存，一次付费反复看） ---- */
    bindWeeklyAI(container, member, cfg, {
      sleepAvg: sleepAvg, energyAvg: energyAvg, times7: times7, wDelta: wDelta
    });

    /* ---- 饮食记录事件 ---- */
    container.querySelector('#mealAdd').addEventListener('click', function () {
      FIT.meal.openDialog(member, function () { render(container); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-meal-del]'), function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('删除这条饮食记录？')) return;
        FIT.store.deleteMeal(btn.dataset.mealDel).then(function () { render(container); });
      });
    });
    // 缩略图点击放大/还原
    Array.prototype.forEach.call(container.querySelectorAll('.meal-thumb'), function (img) {
      img.addEventListener('click', function () { img.classList.toggle('zoom'); });
    });
  }

  /* ============================================================
   * 周报 AI 总结（PRD FR-08 阶段二：百字总结）
   * 模型：优先用教练页选择的模型，否则第一个可用模型
   * 缓存：settings key = weekly:成员id:本周起始，一周只付一次钱
   * ============================================================ */

  // AI 总结按钮 / 不可用原因文案
  function weeklyBtnHtml(cfg) {
    if (!cfg.aiWeeklySummary) {
      return '<div class="muted small">AI 总结已在设置中关闭（我的 → 预算与隐私设置）</div>';
    }
    var hasModel = cfg.providers.some(function (p) { return p.models && p.models.length; });
    if (!hasModel) {
      return '<div class="muted small">配置 AI 模型后可生成 AI 总结（我的 → 模型配置中心）</div>';
    }
    return '<button type="button" class="btn ghost sm block" id="wkAI">AI 总结本周（约 1 分钱）</button>';
  }

  function bindWeeklyAI(container, member, cfg, stats) {
    var btn = container.querySelector('#wkAI');
    var box = container.querySelector('#wkAIBox');
    if (!btn || !box) return;

    var weekKey = FIT.date.weekStartKey(new Date());
    var cacheKey = 'weekly:' + member.id + ':' + weekKey;

    // 展示缓存的总结
    function show(cached) {
      box.innerHTML = '<div class="ai-summary"><b>AI 总结</b>：' + escapeHtml(cached.text)
        + '<div class="fee small">' + escapeHtml(cached.model) + ' · ' + FIT.ai.costText(cached.cost)
        + ' · 本周已缓存，反复看不重复付费</div></div>';
    }

    // 已有本周缓存 → 直接展示，按钮变「重新生成」
    FIT.store.getSetting(cacheKey).then(function (cached) {
      if (cached && cached.text) {
        show(cached);
        btn.textContent = '重新生成（再花一次钱）';
      }
    });

    btn.addEventListener('click', function () {
      btn.disabled = true;
      box.innerHTML = '<span class="muted small">生成中（约 10~20 秒）…</span>';
      runWeeklyAI().catch(function (err) {
        box.innerHTML = '<span class="over-warn">生成失败：' + escapeHtml(err.message) + '</span>';
      }).then(function () { btn.disabled = false; });
    });

    function runWeeklyAI() {
      // 预算触顶 → 不调 AI（AI-03 闸门对所有入口生效）
      return FIT.ai.budgetInfo().then(function (b) {
        if (b.over) {
          box.innerHTML = '<span class="over-warn">本月预算已触顶，AI 总结暂停（下月 1 号自动恢复）</span>';
          return null;
        }
        // 定位模型：教练页选择 > 第一个可用
        return FIT.store.getSetting('coachModel').then(function (sel) {
          var found = null;
          if (sel && sel !== 'local') found = FIT.ai.findModel(cfg, sel.providerId, sel.name);
          if (!found) {
            for (var i = 0; i < cfg.providers.length && !found; i++) {
              var p = cfg.providers[i];
              if (p.models && p.models.length) found = { provider: p, model: p.models[0] };
            }
          }
          if (!found) {
            box.innerHTML = '<span class="over-warn">没有可用模型，去「我的」页配置</span>';
            return null;
          }
          // 三张状态卡 + 近 7 天指标 → 百字总结
          return FIT.cards.build(member).then(function (cards) {
            var prompt = '你是私人健身教练。根据下面的成员数据写一份本周健康总结。'
              + '要求：中文 100 字左右，一段话；先肯定做得好的地方，再指出最需要改进的一点并给一条具体可操作的建议；只引用给出的数据、不编造；不做任何医疗诊断。\n'
              + '【训练状态卡】\n' + cards.training + '\n'
              + '【健康摘要卡】\n' + cards.health + '\n'
              + '【近 7 天指标】睡眠均值 ' + (stats.sleepAvg === null ? '无记录' : stats.sleepAvg.toFixed(1) + 'h')
              + '，精力 ' + (stats.energyAvg === null ? '无记录' : stats.energyAvg.toFixed(1) + '/5')
              + '，训练 ' + stats.times7 + ' 次'
              + '，体重变化 ' + (stats.wDelta === null ? '无记录' : (stats.wDelta > 0 ? '+' : '') + stats.wDelta.toFixed(1) + 'kg');
            return FIT.ai.chat(found.provider, found.model.name,
              [{ role: 'user', content: prompt }], { temperature: 0.5 });
          }).then(function (res) {
            var cost = FIT.ai.estimateCost(found.model, res.usage);
            var cached = { text: (res.text || '').trim(), model: res.model, cost: cost, time: new Date().toISOString() };
            return FIT.ai.recordUsage(res.model, res.usage, cost, 'summary').then(function () {
              return FIT.store.setSetting(cacheKey, cached);
            }).then(function () {
              show(cached);
              btn.textContent = '重新生成（再花一次钱）';
            });
          });
        });
      });
    }
  }

  /* ---------- 工具 ---------- */

  // 求均值（空数组返回 null，诚实不编数）
  function avg(arr) {
    if (!arr.length) return null;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  // 提取记录列表中某字段的有效数值（跳过 undefined / 非数值）
  function nums(list, key) {
    return list.map(function (c) { return c[key]; })
      .filter(function (v) { return typeof v === 'number' && !isNaN(v); });
  }

  // 防 XSS 的简易转义（AI 生成的文本需转义后再回显）
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  FIT.log = { render: render };
})();
