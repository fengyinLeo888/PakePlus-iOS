/* ============================================================
 * report-parser.js —— 报训练文本的本地解析器（免费，不调 AI）
 * 职责：把「深蹲 80kg 5×5，卧推 60kg 4×8」这类口语记录
 *       解析成结构化训练条目，供确认卡复核后入库
 * 只识别动作库内的动作；识别不出的片段保留原文进 note，不编造
 * 兼提供公共小工具：动作名匹配、中文数字解析（coach.js 问答复用）
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  /* ---------- 主入口：解析报训练文本 ----------
   * 参数：text 用户原文；exercises 动作库列表
   * 返回：{ items: [{ exerciseId, name, weight, sets, reps, unit }], note: 原文 } 或 null（一个动作都没识别到）
   * 判定严格：必须同时命中「库内动作名」且带重量或组次数字，才算训练条目，
   * 避免「深蹲怎么做」这类提问被误当训练记录 */
  function parse(text, exercises) {
    if (!text) return null;
    // 按常见分隔符切段：顿号、逗号、分号、换行
    var segs = String(text).split(/[、，,；;\n]+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; });
    var items = [];
    segs.forEach(function (seg) {
      var item = parseSegment(seg, exercises);
      if (item) items.push(item);
    });
    if (!items.length) return null;
    // 同名动作合并（如分两段报了「深蹲 80kg 5×5，深蹲 85kg 3×3」：保留重量大的那次，保守不重复计数）
    var merged = [];
    items.forEach(function (it) {
      var same = merged.filter(function (m) { return m.name === it.name; })[0];
      if (!same) { merged.push(it); return; }
      if (it.weight > same.weight) { same.weight = it.weight; same.sets = it.sets; same.reps = it.reps; }
    });
    return { items: merged, note: String(text).trim() };
  }

  /* ---------- 解析单个片段：动作名 + 重量 / 组次 ---------- */
  function parseSegment(seg, exercises) {
    var ex = matchExercise(seg, exercises);
    if (!ex) return null;
    var weight = parseWeight(seg);
    var sr = parseSetsReps(seg);
    // 严格判定：重量或组次至少命中其一，否则视为提问/闲聊
    if (weight === null && !sr) return null;
    return {
      exerciseId: ex.id,
      name: ex.name,
      weight: weight === null ? 0 : weight,
      sets: sr ? sr.sets : 0,
      reps: sr ? sr.reps : 0,
      unit: ex.unit || 'kg'
    };
  }

  /* ---------- 重量：「80kg」「80 公斤」「80千克」 ---------- */
  function parseWeight(seg) {
    var m = seg.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:kg|公斤|千克)/i);
    if (!m) return null;
    var w = parseFloat(m[1]);
    return (w > 0 && w < 500) ? w : null; // 超出常理按未识别处理，确认卡可改
  }

  /* ---------- 组次：「5×5」「5x5」「5组5次」「5 组每组 5 次」「五组五次」 ---------- */
  function parseSetsReps(seg) {
    var m = seg.match(/([0-9]+|[一二两三四五六七八九十]+)\s*(?:组|×|x|X|\*)\s*(?:每组)?\s*([0-9]+|[一二两三四五六七八九十]+)\s*(?:次|个|下|秒)?/);
    if (!m) return null;
    var sets = numOf(m[1]);
    var reps = numOf(m[2]);
    if (sets === null || reps === null) return null;
    if (!(sets > 0 && sets <= 20) || !(reps > 0 && reps <= 300)) return null; // 常理校验
    return { sets: sets, reps: reps };
  }

  // 数字或中文数字 → 数值
  function numOf(s) {
    if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
    return cnNumber(s);
  }

  /* ---------- 中文数字（支持 一~十、两、及「X个半」组合；顾问页睡眠补录也共用） ---------- */
  function cnNumber(s) {
    var m = s.match(/^([一二两三四五六七八九十]+)(?:个?半)?$/);
    if (!m) return null;
    var half = /半$/.test(s) && !/^半$/.test(s);
    var core = s.replace(/个?半$/, '');
    var base = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (core === '十') return half ? 10.5 : 10;
    var mm = core.match(/^十(.+)$/);
    if (mm && base[mm[1]]) return (base[mm[1]] + 10) + (half ? 0.5 : 0);
    if (core.length === 1 && base[core]) return base[core] + (half ? 0.5 : 0);
    return null;
  }

  /* ---------- 动作匹配：完整名 → 别名（去器械/姿势前缀） ----------
   * 从原 coach.js 挪入，供解析器与教练页「动作要点」问答共用 */
  function matchExercise(text, all) {
    var hit = null;
    all.forEach(function (ex) {
      if (text.indexOf(ex.name) >= 0 && (!hit || ex.name.length > hit.name.length)) hit = ex;
    });
    if (!hit) {
      all.forEach(function (ex) {
        getAliases(ex.name).forEach(function (alias) {
          if (alias.length >= 2 && text.indexOf(alias) >= 0 && (!hit || alias.length > (hit._alias || '').length)) {
            hit = ex; hit._alias = alias;
          }
        });
      });
      if (hit) delete hit._alias;
    }
    return hit;
  }

  // 动作别名：去括号备注、逐级去器械/姿势前缀（每一级中间形态都算别名，
  // 如「上斜哑铃卧推」→ 哑铃卧推 → 卧推，避免「哑铃卧推」错配到杠铃卧推）
  function getAliases(name) {
    var base = name.replace(/（.*?）/g, '');           // 去括号
    var aliases = [base];
    var PREFIX = ['杠铃', '哑铃', '坐姿', '绳索', '上斜', '高位', '单臂', '保加利亚'];
    var cur = base;
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < PREFIX.length; i++) {
        if (cur.indexOf(PREFIX[i]) === 0) {
          cur = cur.slice(PREFIX[i].length);
          changed = true;
          if (cur.length >= 2 && aliases.indexOf(cur) < 0) aliases.push(cur);
        }
      }
    }
    if (base.indexOf('罗马尼亚硬拉') >= 0 && aliases.indexOf('硬拉') < 0) aliases.push('硬拉');
    return aliases;
  }

  FIT.parser = {
    parse: parse,
    matchExercise: matchExercise,
    getAliases: getAliases,
    cnNumber: cnNumber
  };
})();
