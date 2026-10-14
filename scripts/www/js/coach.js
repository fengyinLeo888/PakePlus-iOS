/* ============================================================
 * coach.js —— 顾问页（v4：AI 顾问对话 + 报训练入口 + 本地分流）
 * 定位：成员自己安排训练，顾问只分析建议、不制定计划
 * 结构：
 *   顶部：模型切换器（本地规则引擎 · 各厂商模型，标注免费/便宜/旗舰）
 *   黄条：月度预算触顶 → 自动降级纯本地模式（AI-03）
 *   中部：对话流（历史持久化到 chats 表，按成员隔离）
 *   底部：输入框
 * 分流（AI-04）：报训练走本地解析 + 确认卡（免费）；本地规则能答的免费答；
 *   开放性问题调所选模型
 * AI 回复约定标记（一次调用同时完成回复 + 三件事，不重复花钱）：
 *   [[结论]]一句话结论     → 结论沉淀（AI-03），后续对话直接引用
 *   [[画像]]事实1；事实2   → 写入个人画像卡（AI-02 第③卡）
 *   [[打卡]]sleep=5.5&energy=4&stress=3&soreness=light → 写入当日打卡（FR-05 对话式补录）
 * 每条 AI 回复标注：实际模型名 · token · 费用（AI-06）
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  var HISTORY_LIMIT = 100;  // 进入页面最多加载的历史条数
  var CONTEXT_ROUNDS = 10;  // 送入 AI 的最近对话轮数（控制上下文成本）
  var FACT_LIMIT = 50;      // 画像条目上限（与 state-cards 一致）

  var state = {
    member: null,           // 当前成员
    cfg: null,              // AI 配置
    budget: null,           // 预算状态
    selection: 'local',     // 'local' 或 { providerId, name }
    history: [],            // 内存态对话（与 chats 表同步）
    busy: false             // 发送中锁
  };

  /* ============ 页面渲染 ============ */
  function render(container) {
    Promise.all([
      FIT.store.getActiveMember(),
      FIT.ai.getConfig(),
      FIT.ai.budgetInfo(),
      FIT.store.getSetting('coachModel')
    ]).then(function (rs) {
      state.member = rs[0];
      state.cfg = rs[1];
      state.budget = rs[2];
      state.selection = normalizeSelection(rs[1], rs[3]);
      // 加载该成员的对话历史
      if (!state.member) { state.history = []; draw(container); return; }
      FIT.store.allChats(state.member.id).then(function (rows) {
        rows.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
        state.history = rows.slice(-HISTORY_LIMIT);
        draw(container);
      });
    });
  }

  // 校正持久化的选择（配置删除后回退本地）
  function normalizeSelection(cfg, saved) {
    if (!saved || saved === 'local') return 'local';
    if (FIT.ai.findModel(cfg, saved.providerId, saved.name)) return saved;
    return 'local';
  }

  function draw(container) {
    var hasAI = state.cfg.providers.length > 0;
    var overBudget = state.budget.over;

    // ---- 顶部：模型切换器 ----
    var modelBar = '<div class="coach-model-bar">当前模型：<select id="coachModelSel" class="model-select">'
      + '<option value="local">本地规则引擎（免费）</option>';
    state.cfg.providers.forEach(function (p) {
      (p.models || []).forEach(function (m) {
        var val = p.id + '||' + m.name;
        var sel = state.selection !== 'local' && state.selection.providerId === p.id && state.selection.name === m.name;
        modelBar += '<option value="' + val + '"' + (sel ? ' selected' : '') + '>'
          + p.label + ' · ' + m.name + '（' + FIT.ai.tierName(m.tier) + '）</option>';
      });
    });
    modelBar += '</select>'
      + (hasAI ? '' : '<button type="button" class="btn sm primary" id="goConfig">去配置 AI</button>')
      + '</div>';

    // ---- 黄条：预算触顶降级（PRD FR-02 例外） ----
    var warnBar = overBudget
      ? '<div class="budget-warn">本月 AI 额度已用完（' + state.budget.used.toFixed(2) + ' / ' + state.budget.limit.toFixed(2)
        + ' 元），当前为本地模式，下月自动恢复。可到「我的」页调整预算。</div>'
      : '';

    // ---- 未建档提示 ----
    var noMember = state.member ? '' : '<div class="budget-warn">还没有成员档案，先到「我的」页新建成员。</div>';

    container.innerHTML = modelBar + warnBar + noMember
      + '<div class="chat-flow" id="chatFlow"></div>'
      + '<div class="chat-input-bar">'
      +   '<input type="text" id="chatInput" placeholder="问点什么，如：今天练什么？/ 最近膝盖不舒服怎么调整？" enterkeyhint="send">'
      +   '<button type="button" class="btn primary" id="chatSend">发送</button>'
      + '</div>';

    var flow = container.querySelector('#chatFlow');
    var input = container.querySelector('#chatInput');

    // ---- 渲染历史 ----
    if (state.history.length === 0) {
      pushBot(flow, '我是你的训练顾问：训练你自己安排，练了什么直接告诉我（本地免费解析入库，并自动生成建议）。'
        + '查今日记录、组间休息、动作要点、训练统计也由本地免费回答；'
        + '开放性问题' + (hasAI ? '由你选择的 AI 模型回答（每条回复标注实际模型与费用）' : '需要先在「我的」页配置 AI 模型') + '。', 'welcome');
    } else {
      state.history.forEach(function (m) { appendBubble(flow, m); });
    }

    // ---- 模型切换 ----
    container.querySelector('#coachModelSel').addEventListener('change', function (e) {
      if (e.target.value === 'local') {
        state.selection = 'local';
        FIT.store.setSetting('coachModel', 'local');
      } else {
        var parts = e.target.value.split('||');
        state.selection = { providerId: parts[0], name: parts[1] };
        FIT.store.setSetting('coachModel', state.selection);
      }
    });

    var goCfg = container.querySelector('#goConfig');
    if (goCfg) goCfg.addEventListener('click', function () { FIT.app.switchTab('me'); });

    // ---- 发送 ----
    function send() {
      var text = (input.value || '').trim();
      if (!text || state.busy) return;
      input.value = '';
      handleSend(flow, text);
    }
    container.querySelector('#chatSend').addEventListener('click', send);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  }

  /* ============ 发送主流程：分流 → 本地答 或 AI 答 ============ */
  function handleSend(flow, text) {
    // ① 用户气泡 + 持久化
    var userMsg = { who: 'user', text: text };
    appendBubble(flow, userMsg);
    state.history.push(userMsg);
    if (state.member) {
      FIT.store.saveChat({ id: FIT.db.uid(), memberId: state.member.id, who: 'user', text: text, time: new Date().toISOString() });
    }

    // ② 问题分流（AI-04）：先试本地（报训练 / 睡眠补录 / 规则问答）
    localAnswer(text).then(function (local) {
      // 报训练：开确认卡，入库与建议由 report.js 完成，建议会自动出现在对话流
      if (local && local.report) {
        FIT.report.openConfirm(state.member, local.report, {
          onSaved: function (log) {
            var exTxt = log.exercises.map(function (e) {
              return e.name + (e.weight > 0 ? ' ' + e.weight + 'kg' : '（自重）')
                + (e.sets && e.reps ? ' ' + e.sets + '×' + e.reps : '');
            }).join('、');
            deliverBot(flow, { who: 'bot', text: '已入库：' + exTxt + '，容量约 ' + Math.round(log.volume || 0) + 'kg。建议生成中…', local: true });
          },
          onAdvice: function (log) {
            // 建议已由 report.js 持久化到 chats，这里只同步界面与内存（不重复入库）
            var m = { who: 'bot', text: log.advice.text, model: log.advice.model, tokens: log.advice.tokens, cost: log.advice.cost, local: !!log.advice.local };
            appendBubble(flow, m);
            state.history.push(m);
          }
        });
        return;
      }
      if (local && local.text) {
        deliverBot(flow, { who: 'bot', text: local.text, local: true });
        return;
      }
      // ③ 本地答不了 → 需要 AI
      var noAI = state.selection === 'local';
      if (noAI) {
        deliverBot(flow, { who: 'bot', text: '这个问题需要 AI 的开放性判断。请先在顶部切换到 AI 模型（或到「我的」页配置模型）。本地可免费：报训练入库、查今日记录、组间休息、动作要点、训练统计。', local: true });
        return;
      }
      if (state.budget.over) {
        deliverBot(flow, { who: 'bot', text: '本月 AI 额度已用完（' + state.budget.used.toFixed(2) + ' / ' + state.budget.limit.toFixed(2) + ' 元），已自动降级本地模式，下月恢复。可到「我的」页调整预算。', local: true });
        return;
      }
      if (!state.member) {
        deliverBot(flow, { who: 'bot', text: '还没有成员档案，先到「我的」页新建成员。', local: true });
        return;
      }
      callAI(flow, text);
    });
  }

  /* ============ AI 调用 ============ */
  function callAI(flow, text) {
    state.busy = true;
    var typing = document.createElement('div');
    typing.className = 'bubble bot typing';
    typing.textContent = '思考中…';
    flow.appendChild(typing);
    flow.scrollTop = flow.scrollHeight;

    // 组装上下文：系统提示词 + 最近对话
    Promise.all([
      FIT.cards.build(state.member),
      FIT.store.allExercises()
    ]).then(function (rs) {
      var cards = rs[0], exercises = rs[1];
      var system = buildSystemPrompt(state.member, cards, exercises);
      var msgs = [{ role: 'system', content: system }];
      // 最近 N 轮对话（不含刚发的这条，避免重复）
      state.history.slice(-CONTEXT_ROUNDS * 2 - 1, -1).forEach(function (m) {
        if (m.text) msgs.push({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text });
      });
      msgs.push({ role: 'user', content: text });

      var found = FIT.ai.findModel(state.cfg, state.selection.providerId, state.selection.name);
      return FIT.ai.chat(found.provider, state.selection.name, msgs).then(function (r) {
        return { r: r, modelCfg: found.model };
      });
    }).then(function (res) {
      typing.remove();
      // 解析标记：正文 / 结论 / 画像 / 打卡
      var parsed = parseMarks(res.r.text);
      var cost = FIT.ai.estimateCost(res.modelCfg, res.r.usage);
      var botMsg = {
        who: 'bot', text: parsed.body,
        model: res.r.model, tokens: res.r.usage.total, cost: cost,
        conclusion: parsed.conclusion || null
      };
      deliverBot(flow, botMsg);
      // 流水与持久化
      FIT.ai.recordUsage(res.r.model, res.r.usage, cost, 'chat');
      if (state.member) {
        FIT.store.saveChat({
          id: FIT.db.uid(), memberId: state.member.id, who: 'bot',
          text: parsed.body, model: res.r.model, tokens: res.r.usage.total,
          cost: cost, conclusion: parsed.conclusion || null, time: new Date().toISOString()
        });
      }
      // 画像沉淀（去重：与既有条目完全相同则跳过）
      if (parsed.facts.length && state.member) {
        parsed.facts.forEach(function (t) {
          FIT.store.allFacts(state.member.id).then(function (existing) {
            if (existing.length >= FACT_LIMIT) return;               // 存满不再写（提示词已约束合并）
            var dup = existing.some(function (f) { return f.text === t; });
            if (dup) return;
            return FIT.store.saveFact({ id: FIT.db.uid(), memberId: state.member.id, text: t, source: 'AI 对话提取', time: new Date().toISOString() });
          });
        });
      }
      // 对话式打卡补录（FR-02 规则 4：轻确认在正文里由 AI 完成，此处落库）
      if (parsed.checkin && state.member) applyCheckin(state.member, parsed.checkin);
      state.busy = false;
      // 更新预算状态（连续追问时触顶判断准确）
      FIT.ai.budgetInfo().then(function (b) { state.budget = b; });
    }).catch(function (err) {
      typing.remove();
      state.busy = false;
      // 失败：错误气泡 + 重试按钮（PRD：输入内容不丢失）
      var d = document.createElement('div');
      d.className = 'bubble bot error';
      d.textContent = err.message || 'AI 调用失败';
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn sm ghost';
      retry.textContent = '重试';
      retry.addEventListener('click', function () {
        d.remove();
        // 闭包捕获本条消息原文：即使用户之后又发了新消息，重试的仍是本条
        callAI(flow, text);
      });
      d.appendChild(retry);
      flow.appendChild(d);
      flow.scrollTop = flow.scrollHeight;
    });
  }

  /* ============ 系统提示词（顾问角色 + 三铁律 + AI-08 医疗边界 + 输出格式） ============ */
  function buildSystemPrompt(member, cards, exercises) {
    // 近期对话结论（AI-03 结论沉淀：后续直接引用，不重复讨论）
    var conclusions = [];
    state.history.forEach(function (m) {
      if (m.who === 'bot' && m.conclusion) conclusions.push(m.conclusion);
    });
    var recentConclusions = conclusions.slice(-5);

    return '你是「' + member.name + '」的训练顾问 + 健康顾问 + 全能生活助手，以健康为主线，训练、饮食、作息、减压、生活问题都可以聊。'
      + 'TA 自己安排训练，练完会报给你；你只负责分析、建议和答疑，不替 TA 制定训练计划、不主动教 TA 怎么练（除非 TA 主动问动作做法）。'
      + '你始终了解 TA 的最新状态（见下方状态卡），不需要 TA 反复自我介绍。\n\n'
      + '【三条铁律】\n'
      + '1. 不编造动作：动作建议只能引用下方动作库名单中的动作；库内没有合适的就如实说明。\n'
      + '2. 不做医疗诊断：' + FIT.ai.medicalGuard() + '\n'
      + '3. 不虚构数据：引用任何数字必须来自下方状态卡，状态卡没有的就说「暂无记录」。\n\n'
      + '【输出格式】先写正文回复；随后按需附加标记行（没有对应内容就省略该行）:\n'
      + '[[结论]]用一句话总结本次对话可沉淀的结论（如「建议本周深蹲保持重量，因左膝酸痛」；闲聊无结论可省略）\n'
      + '[[画像]]从对话中提取的长期有效关键事实，多条用分号分隔（如「不吃香菜；周末通常加班睡得晚」；一次性信息不要提取）\n'
      + '[[打卡]]当用户提到自己的睡眠时长/精力/压力/肌肉酸痛时填写，字段按需：sleep=小时数&energy=1到5&stress=1到5&soreness=none或light或heavy，并在正文里轻确认（如「已记下：昨晚睡眠 5.5 小时」）\n\n'
      + '【动作库名单（只能引用这些动作）】\n' + exercises.map(function (e) { return e.name; }).join('、') + '\n\n'
      + '【训练状态卡】\n' + cards.training + '\n\n'
      + '【健康摘要卡】\n' + cards.health + '\n\n'
      + '【个人画像卡】\n' + cards.profile + '\n\n'
      + (recentConclusions.length ? '【近期对话结论（已沉淀，不必重复讨论）】\n' + recentConclusions.map(function (c) { return '· ' + c; }).join('\n') + '\n\n' : '')
      + '回复用中文，简洁口语化，优先给可执行的建议。';
  }

  /* ============ 解析 AI 回复中的标记行 ============ */
  function parseMarks(text) {
    var out = { body: text, conclusion: '', facts: [], checkin: null };
    // [[结论]]
    var m = text.match(/\[\[结论\]\]([^\n]*)/);
    if (m) { out.conclusion = m[1].trim(); out.body = out.body.replace(m[0], ''); }
    // [[画像]]
    m = text.match(/\[\[画像\]\]([^\n]*)/);
    if (m) {
      out.body = out.body.replace(m[0], '');
      m[1].split(/[;；]/).forEach(function (s) {
        var t = s.trim();
        if (t.length >= 2 && t.length <= 60) out.facts.push(t);   // 单条限长，防滥用
      });
    }
    // [[打卡]]
    m = text.match(/\[\[打卡\]\]([^\n]*)/);
    if (m) {
      out.body = out.body.replace(m[0], '');
      var c = {};
      m[1].split('&').forEach(function (kv) {
        var pair = kv.split('=');
        if (pair.length === 2) c[pair[0].trim()] = pair[1].trim();
      });
      if (Object.keys(c).length) out.checkin = c;
    }
    out.body = out.body.replace(/\n{3,}/g, '\n\n').trim();
    return out;
  }

  // 打卡字段合并写入当日记录（只更新 AI 识别到的字段，其余保留）
  function applyCheckin(member, c) {
    var todayKey = FIT.date.todayKey();
    FIT.store.getCheckin(member.id, todayKey).then(function (old) {
      var rec = old || { id: FIT.db.uid(), memberId: member.id, date: todayKey };
      var n;
      if (c.sleep !== undefined && (n = parseFloat(c.sleep)) >= 0 && n <= 24) rec.sleep = n;
      if (c.energy !== undefined && (n = parseInt(c.energy, 10)) >= 1 && n <= 5) rec.energy = n;
      if (c.stress !== undefined && (n = parseInt(c.stress, 10)) >= 1 && n <= 5) rec.stress = n;
      if (c.soreness !== undefined && ['none', 'light', 'heavy'].indexOf(c.soreness) >= 0) rec.soreness = c.soreness;
      return FIT.store.saveCheckin(rec);
    });
  }

  /* ============ 本地规则问答（AI-04：常见问题免费答） ============
   * 返回 Promise<{text}|{report}|null>：
   *   {text}   本地文字答复；{report} 报训练草稿（开确认卡）；null = 本地答不了，需要 AI */
  function localAnswer(text) {
    return FIT.store.getActiveMember().then(function (member) {
      if (!member) return { text: '还没有成员档案。去「我的」页新建成员，完成 1 分钟问卷后我就能服务你了。' };
      var todayKey = FIT.date.todayKey();

      // ⓪ 对话式睡眠补录（FR-05：漏打卡自然补录，本地免费版）
      var sleep = parseSleep(text);
      if (sleep !== null) {
        return applyCheckin(member, { sleep: sleep }).then(function () {
          return { text: '已记下：睡眠 ' + sleep + ' 小时（写入今日健康打卡，可在今日页查看或修改）。' };
        });
      }

      return FIT.store.allExercises().then(function (all) {
        // ⓪+ 报训练：解出库内动作 + 重量/组次 → 确认卡入库
        // 疑问句式（怎么/如何/可以吗…）不当报训练，走问答或 AI
        if (!/怎么|如何|对吗|可以吗|好不好|行不行|合适吗|怎么样|呢|[？?]/.test(text)) {
          var parsed = FIT.parser.parse(text, all);
          if (parsed) return { report: parsed };
        }
        return textAnswer(member, text, todayKey, all);
      });
    });
  }

  /* ---- 文本类本地问答 ---- */
  function textAnswer(member, text, todayKey, allExercises) {
    // ① 今天记了什么 / 今天练啥（定位：不安排计划，只答已记录内容）
    if (/今天.*(练|训练|记)|练什么|今日|记了什么/.test(text)) {
      return FIT.store.allLogs(member.id).then(function (logs) {
        var todayLogs = logs.filter(function (l) { return l.date === todayKey; });
        var head = '训练你自己安排，我不做计划。';
        if (!todayLogs.length) return { text: head + '今天还没有记录，练完了在这里或「今日」页告诉我。' };
        var lines = todayLogs.map(function (log) {
          var hm = (log.time || '').slice(11, 16);
          return hm + '：' + (log.exercises || []).map(function (e) {
            return e.name + (e.weight > 0 ? ' ' + e.weight + 'kg' : '（自重）')
              + (e.sets && e.reps ? ' ' + e.sets + '×' + e.reps : '');
          }).join('、') + '（容量约 ' + Math.round(log.volume || 0) + 'kg）';
        });
        return { text: head + '今天已记录 ' + todayLogs.length + ' 次：\n' + lines.join('\n') };
      });
    }

    // ② 组间休息（通用建议，不依赖计划）
    if (/组间|休息多久|休息多长/.test(text)) {
      return { text: '通用建议：复合动作（深蹲、卧推、硬拉等）组间 120 秒，孤立动作 60~90 秒，自重动作按体感约 60 秒。' };
    }

    // ③ 动作要点（只引用库内动作，不编造）
    if (/要点|怎么做|怎么练|动作/.test(text)) {
      var hit = FIT.parser.matchExercise(text, allExercises);
      if (!hit) return null;   // 库里没有 → 交给 AI 处理（可能问的是库外动作）
      var msg = '【' + hit.name + '】\n要点：\n' + hit.cues.map(function (c) { return '· ' + c; }).join('\n')
        + '\n常见错误：\n' + hit.errors.map(function (c) { return '· ' + c; }).join('\n');
      if (hit.video) msg += '\n示范视频：' + hit.video;
      return { text: msg };
    }

    // ④ 训练统计（近 4 周频次与容量，v4 起不再有「计划完成率」）
    if (/统计|练得怎么样|频次|几次|完成率/.test(text)) {
      return FIT.store.allLogs(member.id).then(function (logs) {
        var fourWeeksAgo = FIT.date.toKey(FIT.date.addDays(new Date(), -28));
        var recent = logs.filter(function (l) { return l.date >= fourWeeksAgo; });
        var vol = 0;
        recent.forEach(function (l) { vol += l.volume || 0; });
        if (!recent.length) return { text: '近 4 周还没有训练记录，练完一次再来问我。' };
        return { text: '近 4 周：训练 ' + recent.length + ' 次，总容量约 ' + Math.round(vol) + 'kg。继续保持，规律就是进步。' };
      });
    }

    // ⑤ 其余交给分流上层（AI 或提示配置）
    return null;
  }

  /* ---- 睡眠语句本地解析：「睡了五个半小时」「睡眠7小时」「昨晚只睡了6.5h」 ---- */
  function parseSleep(text) {
    if (!/睡/.test(text)) return null;
    var m = text.match(/睡(?:着|了|眠|觉)?[^0-9一二两三四五六七八九十半.]*([0-9.]+|半个|[一二两三四五六七八九十]+(?:个?半)?)\s*(?:个?小时|h|H)/);
    if (!m) return null;
    var raw = m[1];
    var n = null;
    if (/^[0-9.]+$/.test(raw)) {
      n = parseFloat(raw);
    } else if (raw === '半个') {
      n = 0.5;
    } else {
      n = FIT.parser.cnNumber(raw); // 中文数字解析共用 report-parser 实现
    }
    if (n === null || !(n > 0 && n <= 24)) return null;
    // 「没睡好」等否定语不误录
    if (/没睡|没怎么睡|几乎没/.test(text)) return null;
    return Math.round(n * 2) / 2;
  }

  /* ============ 气泡渲染 ============ */
  function appendBubble(flow, m) {
    if (m.who === 'user') {
      var u = document.createElement('div');
      u.className = 'bubble user';
      u.textContent = m.text;
      flow.appendChild(u);
    } else {
      var b = document.createElement('div');
      b.className = 'bubble bot';
      b.textContent = m.text;
      if (m.local) {
        var f1 = document.createElement('span');
        f1.className = 'fee local';
        f1.textContent = '本地回答 · 免费（未调用 AI）';
        b.appendChild(f1);
      } else if (m.model) {
        // 模型可见性（AI-06）：实际模型名 · token · 费用
        var f2 = document.createElement('span');
        f2.className = 'fee';
        f2.textContent = '本次：' + m.model + ' · ' + (m.tokens || 0) + ' token · ' + FIT.ai.costText(m.cost);
        b.appendChild(f2);
      }
      if (m.conclusion) {
        var c = document.createElement('span');
        c.className = 'fee concl';
        c.textContent = '已沉淀结论：' + m.conclusion;
        b.appendChild(c);
      }
      flow.appendChild(b);
    }
    flow.scrollTop = flow.scrollHeight;
  }

  // 本地回复（不入库太啰嗦的欢迎语用 localTag 区分；正式本地答复也持久化）
  function deliverBot(flow, msg) {
    appendBubble(flow, msg);
    state.history.push(msg);
    if (state.member) {
      FIT.store.saveChat({
        id: FIT.db.uid(), memberId: state.member.id, who: 'bot',
        text: msg.text, local: !!msg.local, time: new Date().toISOString()
      });
    }
  }

  // 仅展示不入库（欢迎语）
  function pushBot(flow, text) {
    var b = document.createElement('div');
    b.className = 'bubble bot welcome';
    b.textContent = text;
    flow.appendChild(b);
    flow.scrollTop = flow.scrollHeight;
  }

  FIT.coach = { render: render };
})();
