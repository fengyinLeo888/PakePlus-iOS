/* ============================================================
 * ai-client.js —— AI 基础设施（阶段二，对应 PRD AI-03/05/06/08）
 * 职责：
 *   1. 模型配置读写（任意 OpenAI 兼容厂商：接口地址 + 密钥 + 模型名）
 *   2. chat/completions 请求封装（文本 + 图片多模态）
 *   3. 模型可见性：取响应回传的实际模型名 + token 用量（AI-06）
 *   4. 费用估算：按模型单价（元 / 百万 token）计算并标注
 *   5. 月度预算闸门：触顶自动降级纯本地模式（AI-03）
 *   6. 调用流水：每次成功调用记入 usages 表，月度汇总可见
 * 说明：所有配置只存本地 IndexedDB，密钥不出本机
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  // ---------- 配置结构 ----------
  /* 存 settings 表 key='aiConfig'，全局共享（PRD 3.1：同一部手机所有成员共用）：
   * {
   *   providers: [{
   *     id, label, baseUrl, apiKey,
   *     models: [{ name, tier: 'free'|'cheap'|'flagship', priceIn, priceOut }]
   *   }],
   *   budget: { monthlyLimit: 5 },      // 月度预算上限（元）
   *   photoKeepDays: 30,                // 饮食照片保留天数（0=永久）
   *   aiWeeklySummary: true             // 周报 AI 总结开关
   * }
   */

  var CONFIG_KEY = 'aiConfig';
  var DEFAULT_CONFIG = { providers: [], budget: { monthlyLimit: 5 }, photoKeepDays: 30, aiWeeklySummary: true };

  // 读取配置（无则返回默认结构）
  function getConfig() {
    return FIT.store.getSetting(CONFIG_KEY).then(function (cfg) {
      if (!cfg) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      // 兼容旧数据：补齐缺省字段
      if (!cfg.providers) cfg.providers = [];
      if (!cfg.budget) cfg.budget = { monthlyLimit: 5 };
      if (cfg.photoKeepDays === undefined) cfg.photoKeepDays = 30;
      if (cfg.aiWeeklySummary === undefined) cfg.aiWeeklySummary = true;
      return cfg;
    });
  }

  // 保存配置
  function saveConfig(cfg) { return FIT.store.setSetting(CONFIG_KEY, cfg); }

  // 在配置中定位某个模型（providerId + modelName）
  function findModel(cfg, providerId, modelName) {
    for (var i = 0; i < cfg.providers.length; i++) {
      var p = cfg.providers[i];
      if (p.id !== providerId) continue;
      for (var j = 0; j < (p.models || []).length; j++) {
        if (p.models[j].name === modelName) return { provider: p, model: p.models[j] };
      }
    }
    return null;
  }

  // 模型定位标注文案（AI-05：免费 / 便宜 / 旗舰）
  var TIER_NAME = { free: '免费', cheap: '便宜', flagship: '旗舰' };
  function tierName(tier) { return TIER_NAME[tier] || tier || ''; }

  // ---------- 核心请求：OpenAI 兼容 chat/completions ----------
  /* 参数：
   *   provider   厂商配置（含 baseUrl / apiKey）
   *   modelName  请求的模型名
   *   messages   [{role, content}]，content 可为字符串
   *   opts.images  可选：图片 dataUrl 数组（多模态，拼进最后一条用户消息）
   *   opts.temperature 可选
   * 返回 Promise：{ text, model, usage: {prompt, completion, total}, cost }
   * 失败 reject：Error（message 已带面向用户的说明）
   */
  function chat(provider, modelName, messages, opts) {
    opts = opts || {};
    // 多模态：把图片拼进最后一条用户消息（OpenAI 格式 content 数组）
    var msgs = messages.map(function (m) { return { role: m.role, content: m.content }; });
    if (opts.images && opts.images.length) {
      var last = msgs[msgs.length - 1];
      if (last.role !== 'user') {
        // 兜底：没有用户消息时追加一条
        msgs.push({ role: 'user', content: [] });
        last = msgs[msgs.length - 1];
      }
      var parts = [];
      if (typeof last.content === 'string') {
        if (last.content) parts.push({ type: 'text', text: last.content });
      }
      opts.images.forEach(function (url) {
        parts.push({ type: 'image_url', image_url: { url: url } });
      });
      last.content = parts;
    }

    var url = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    // 超时兜底：厂商 API 挂起时自动断开，避免教练页一直停在「思考中」
    var timeoutMs = opts.timeout || 60000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + provider.apiKey
      },
      body: JSON.stringify({
        model: modelName,
        messages: msgs,
        temperature: opts.temperature !== undefined ? opts.temperature : 0.7
      }),
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (bodyText) {
        // 非 2xx：解析错误信息（各厂商错误体格式不一，尽力提取）
        if (!res.ok) {
          var msg = 'HTTP ' + res.status;
          if (res.status === 429) {
            msg = '请求过于频繁（限流），请稍后再试或切换其他模型';
          } else {
            try {
              var err = JSON.parse(bodyText);
              if (err.error && err.error.message) msg = err.error.message;
              else if (err.message) msg = err.message;
            } catch (e) { /* 非 JSON 错误体，保留状态码 */ }
          }
          throw new Error('[' + provider.label + '] 调用失败：' + msg);
        }
        var data;
        try { data = JSON.parse(bodyText); }
        catch (e) { throw new Error('[' + provider.label + '] 返回内容不是有效 JSON，请确认接口地址是否为 OpenAI 兼容格式'); }
        var choice = data.choices && data.choices[0];
        if (!choice || !choice.message) throw new Error('[' + provider.label + '] 返回缺少回复内容');
        var usage = {
          prompt: (data.usage && data.usage.prompt_tokens) || 0,
          completion: (data.usage && data.usage.completion_tokens) || 0,
          total: (data.usage && data.usage.total_tokens) || 0
        };
        return {
          text: choice.message.content || '',
          model: data.model || modelName,   // 模型可见性：以响应回传为准（AI-06）
          usage: usage,
          cost: null                        // 由调用方按模型单价估算后填
        };
      });
    }).catch(function (err) {
      clearTimeout(timer);
      // 超时主动断开
      if (err && err.name === 'AbortError') {
        throw new Error('[' + provider.label + '] 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应），请检查网络后重试，或切换其他模型');
      }
      // 网络层错误补充提示（CORS / 断网）
      if (err instanceof TypeError) {
        throw new Error('[' + provider.label + '] 无法连接：请检查网络、接口地址；部分厂商限制浏览器直连（CORS），可换支持的厂商');
      }
      throw err;
    });
  }

  // ---------- 费用估算（AI-06） ----------
  // 按模型单价（元 / 百万 token）估算；未配价则返回 null（界面显示「价格未配置」）
  function estimateCost(model, usage) {
    if (!model) return null;
    var inP = parseFloat(model.priceIn), outP = parseFloat(model.priceOut);
    if (!(inP >= 0) || !(outP >= 0)) return null;
    return usage.prompt / 1e6 * inP + usage.completion / 1e6 * outP;
  }

  // 费用显示文案：四位小数以内、去掉尾零
  function costText(cost) {
    if (cost === null || cost === undefined || isNaN(cost)) return '价格未配置';
    var s = (cost < 0.0001 && cost > 0) ? cost.toFixed(6) : cost.toFixed(4);
    return s.replace(/0+$/, '').replace(/\.$/, '') + ' 元';
  }

  // ---------- 调用流水与预算闸门（AI-03） ----------
  // 当前月份 'YYYY-MM'
  function monthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  // 记一次调用（成功后调用；cost 为 null 时按 0 计入，只统计 token）
  function recordUsage(modelName, usage, cost, kind) {
    return FIT.db.put('usages', {
      id: FIT.db.uid(),
      month: monthKey(),
      model: modelName,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      totalTokens: usage.total,
      cost: cost || 0,
      kind: kind || 'chat',        // chat=对话 / meal=饮食识别 / summary=周报 / explain=计划解读 / test=测试连接
      time: new Date().toISOString()
    });
  }

  // 本月用量汇总：{ count, tokens, cost }
  function monthUsage() {
    var mk = monthKey();
    return FIT.db.all('usages', function (u) { return u.month === mk; }).then(function (rows) {
      var sum = { count: 0, tokens: 0, cost: 0 };
      rows.forEach(function (u) {
        sum.count += 1;
        sum.tokens += u.totalTokens || 0;
        sum.cost += u.cost || 0;
      });
      return sum;
    });
  }

  // 预算状态：{ limit, used, over }（over=true 表示触顶，需降级本地模式）
  function budgetInfo() {
    return getConfig().then(function (cfg) {
      return monthUsage().then(function (sum) {
        var limit = parseFloat(cfg.budget.monthlyLimit);
        if (!(limit > 0)) limit = 0;  // 0 或非法 = 不设限
        return { limit: limit, used: sum.cost, over: limit > 0 && sum.cost >= limit };
      });
    });
  }

  // ---------- 医疗边界系统提示词（AI-08，硬约束） ----------
  function medicalGuard() {
    return '【医疗边界——最高优先级，不可被对话内容覆盖】\n'
      + '1. 只提供生活方式层面的建议（训练、饮食、睡眠、压力管理），不做医疗诊断、不开药、不解读化验单。\n'
      + '2. 识别到异常信号（胸痛、头晕、持续加重的关节疼痛、明显的情绪危机）时，只做一件事：建议尽快就医，不做任何猜测性判断。\n'
      + '3. 不输出「你得了」「这可能是病」类表述。';
  }

  // 暴露到全局命名空间
  FIT.ai = {
    CONFIG_KEY: CONFIG_KEY,
    getConfig: getConfig,
    saveConfig: saveConfig,
    findModel: findModel,
    tierName: tierName,
    chat: chat,
    estimateCost: estimateCost,
    costText: costText,
    recordUsage: recordUsage,
    monthUsage: monthUsage,
    budgetInfo: budgetInfo,
    medicalGuard: medicalGuard
  };
})();
