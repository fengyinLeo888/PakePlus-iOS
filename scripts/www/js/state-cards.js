/* ============================================================
 * state-cards.js —— 三张状态卡（阶段二，对应 PRD AI-02）
 * 目的：让 AI 记住成员但不烧钱——本地数据无限存（免费），
 *       送入 AI 的永远是固定大小的文本摘要（约 500~1000 token）
 * 三张卡：
 *   ① 训练状态卡（自动计算）：近 4 周训练频次、各动作最近重量（从日志提取）
 *   ② 健康摘要卡（自动计算）：近 7 天睡眠/精力/压力/酸痛 + 饮食摘要
 *   ③ 个人画像卡（AI 提取 + 人工可改）：≤50 条关键事实
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  var FACT_LIMIT = 50; // 画像条目上限（拼入提示词时裁剪，不删本地数据）

  /* ---- ① 训练状态卡（v4：成员自报训练，卡片从日志提取频次与最近重量） ---- */
  function trainingCard(member, logs) {
    var lines = [];
    if (!logs.length) {
      return '暂无训练记录（成员自己安排训练，练完后报给应用记录）';
    }
    // 近 4 周频次与容量
    var fourWeeksAgo = FIT.date.toKey(FIT.date.addDays(new Date(), -28));
    var recent = logs.filter(function (l) { return l.date >= fourWeeksAgo; });
    var vol = 0;
    recent.forEach(function (l) { vol += l.volume || 0; });
    lines.push('近 4 周：训练 ' + recent.length + ' 次，总容量约 ' + Math.round(vol) + ' kg');
    // 最近训练时间
    var sorted = logs.slice().sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
    var last = sorted[sorted.length - 1];
    var daysAgo = Math.floor((Date.now() - new Date(last.time || last.date).getTime()) / 86400000);
    lines.push('最近训练：' + last.date + '（' + (daysAgo <= 0 ? '今天' : daysAgo + ' 天前') + '）');
    // 各动作最近一次重量（按出现时间倒序，最多 8 个，供 AI 建议下次重量参考）
    var seen = {};
    var latest = [];
    for (var i = sorted.length - 1; i >= 0 && latest.length < 8; i--) {
      (sorted[i].exercises || []).forEach(function (e) {
        if (seen[e.name]) return;
        seen[e.name] = true;
        latest.push(e.name + (e.weight > 0 ? ' ' + e.weight + 'kg' : '（自重）')
          + (e.sets && e.reps ? ' ' + e.sets + '×' + e.reps : '') + '（' + sorted[i].date.slice(5) + '）');
      });
    }
    if (latest.length) lines.push('各动作最近记录：' + latest.join('、'));
    return lines.join('\n');
  }

  /* ---- ② 健康摘要卡 ---- */
  function healthCard(checkins, meals) {
    var lines = [];
    var sevenDaysAgo = FIT.date.toKey(FIT.date.addDays(new Date(), -7));
    var last7 = checkins.filter(function (c) { return c.date >= sevenDaysAgo; });
    if (last7.length) {
      // 对话式补录允许只写单个字段，缺失字段不能参与求均值（否则得出 NaN 并送进 AI 提示词）
      var sleeps = fieldNums(last7, 'sleep');
      var energies = fieldNums(last7, 'energy');
      var stresses = fieldNums(last7, 'stress');
      var parts = [];
      if (sleeps.length) parts.push('睡眠均值 ' + avg(sleeps).toFixed(1) + 'h');
      if (energies.length) parts.push('精力 ' + avg(energies).toFixed(1) + '/5');
      if (stresses.length) parts.push('压力 ' + avg(stresses).toFixed(1) + '/5');
      parts.push('酸痛「重」' + last7.filter(function (c) { return c.soreness === 'heavy'; }).length + ' 次');
      lines.push('近 7 天打卡（' + last7.length + '/7 天）：' + parts.join('，'));
    } else {
      lines.push('近 7 天无健康打卡记录');
    }
    // 近 7 天饮食摘要（AI-07 第 4 步）
    var recentMeals = meals.filter(function (m) { return m.date >= sevenDaysAgo; });
    if (recentMeals.length) {
      var days = {};
      recentMeals.forEach(function (m) {
        if (!days[m.date]) days[m.date] = { cal: 0, pro: 0 };
        (m.items || []).forEach(function (it) {
          days[m.date].cal += (it.calories || 0);
          days[m.date].pro += (it.protein || 0);
        });
      });
      var dayKeys = Object.keys(days);
      var calAvg = avg(dayKeys.map(function (k) { return days[k].cal; }));
      var proAvg = avg(dayKeys.map(function (k) { return days[k].pro; }));
      lines.push('近 7 天饮食：记录 ' + recentMeals.length + ' 餐，日均热量约 ' + Math.round(calAvg) + ' kcal，日均蛋白质约 ' + Math.round(proAvg) + ' g（AI 视觉估算，误差 ±20%）');
    }
    return lines.join('\n');
  }

  /* ---- ③ 个人画像卡 ---- */
  function profileCard(facts, member) {
    var p = member.profile || {};
    var lines = [];
    // 基础档案（问卷来的固定事实）
    var goalName = { muscle: '增肌', fatloss: '减脂', health: '健康生活习惯' }[p.goal] || p.goal;
    lines.push('目标：' + goalName
      + '；经验：' + (p.experience === 'none' ? '零基础' : (p.experience === 'some' ? '有一定经验' : '老手'))
      + '；器械：' + (p.equipment || []).join('、')
      + (p.injuries && p.injuries.length ? '；伤病史（相关动作已永久过滤）：' + p.injuries.join('、') : '；无伤病史'));
    // AI 提取的关键事实（≤50 条，超出取最近的）
    if (facts.length) {
      var shown = facts.slice(-FACT_LIMIT);
      shown.forEach(function (f) { lines.push('· ' + f.text); });
    }
    return lines.join('\n');
  }

  /* ---- 汇总构建（顾问页 / 我的页共用） ----
   * 返回 { training, health, profile, facts }（三段文本 + 画像原始条目） */
  function build(member) {
    return Promise.all([
      FIT.store.allLogs(member.id),
      FIT.store.allCheckins(member.id),
      FIT.store.allMeals(member.id),
      FIT.store.allFacts(member.id)
    ]).then(function (rs) {
      var logs = rs[0], checkins = rs[1], meals = rs[2], facts = rs[3];
      facts.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      return {
        training: trainingCard(member, logs),
        health: healthCard(checkins, meals),
        profile: profileCard(facts, member),
        facts: facts
      };
    });
  }

  // 求均值（空数组返回 0，仅卡片内部展示用）
  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  // 提取记录列表中某字段的有效数值（跳过 undefined / 非数值，防补录缺字段导致 NaN）
  function fieldNums(list, key) {
    return list.map(function (c) { return c[key]; })
      .filter(function (v) { return typeof v === 'number' && !isNaN(v); });
  }

  FIT.cards = { build: build, FACT_LIMIT: FACT_LIMIT };
})();
