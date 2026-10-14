/* ============================================================
 * app.js —— 应用入口：初始化、Tab 路由、免责声明、问卷流程
 * 页面容器在 index.html 中静态存在，内容由各页面模块渲染
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  var pages = {};       // tabName → 容器元素
  var currentTab = 'today';

  // 初始化（DOM 就绪后调用）
  function init() {
    pages.today = document.getElementById('page-today');
    pages.coach = document.getElementById('page-coach');
    pages.log = document.getElementById('page-log');
    pages.me = document.getElementById('page-me');

    // Tab 点击切换
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button'), function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.tab);
      });
    });

    // 首次使用：预置动作库种子数据
    FIT.store.seedExercises(FIT.EXERCISE_SEED).then(function () {
      // 免责声明确认（PRD 2.4：首次使用展示，确认后方可继续）
      return FIT.store.getSetting('disclaimerAccepted');
    }).then(function (accepted) {
      if (!accepted) {
        showDisclaimer(false);
      } else {
        startApp();
      }
    }).catch(function (err) {
      // 本地存储不可用（隐私/无痕模式、浏览器禁用 IndexedDB 等）时给出说明，避免白屏无提示
      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      overlay.innerHTML = '<div class="dialog">'
        + '<h3>无法启动</h3>'
        + '<p>本地存储不可用（' + (err && err.message ? err.message : '未知错误') + '）。</p>'
        + '<p>本应用全部数据保存在本机浏览器中，请关闭隐私/无痕模式、检查浏览器存储权限后刷新重试。</p>'
        + '</div>';
      document.body.appendChild(overlay);
    });
  }

  // 免责声明弹窗（reread=true 时为重看，确认后不重复启动逻辑）
  function showDisclaimer(reread) {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = ''
      + '<div class="dialog disclaimer">'
      +   '<h3>医疗免责声明</h3>'
      +   '<p>本应用提供训练与生活方式层面的参考建议，<b>不构成医疗诊断或治疗</b>。</p>'
      +   '<p>如出现胸痛、头晕、持续加重的关节疼痛等异常信号，请<b>尽快就医</b>，不要依赖本应用判断。</p>'
      +   '<p>有心血管疾病、高血压等基础疾病者，开始训练计划前请先咨询医生。</p>'
      +   '<p>零基础成员建议先上 1~2 节实体私教课学习基础动作。</p>'
      +   '<div class="dialog-actions">'
      +     (reread ? '' : '<button type="button" class="btn ghost" id="dcExit">退出应用</button>')
      +     '<button type="button" class="btn primary" id="dcOk">我已了解并同意</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#dcOk').addEventListener('click', function () {
      overlay.remove();
      if (!reread) {
        FIT.store.setSetting('disclaimerAccepted', true).then(startApp);
      }
    });
    var exitBtn = overlay.querySelector('#dcExit');
    if (exitBtn) {
      exitBtn.addEventListener('click', function () {
        // 未同意则不进入应用（关闭页面）
        window.close();
        overlay.innerHTML = '<div class="dialog"><p>你未同意免责声明，应用未启动。刷新页面可重新查看。</p></div>';
      });
    }
  }

  // 免责确认后启动
  function startApp() {
    // 静默清理过期餐食照片（图片删、文字记录保留，AI-07 隐私约定；失败不影响使用）
    FIT.ai.getConfig().then(function (cfg) {
      return FIT.store.cleanMealPhotos(cfg.photoKeepDays);
    }).catch(function () { /* 忽略清理失败 */ });
    iosEntryHint();
    switchTab('today');
  }

  // iOS 入口提醒（只提示一次）：iPhone/iPad 上 Safari 浏览器内与「添加到主屏幕」的
  // 独立 PWA 是两套 IndexedDB 存储，数据不互通——在浏览器里建档后从主屏图标打开会是空数据
  function iosEntryHint() {
    var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    if (!isIOS || !('standalone' in navigator) || navigator.standalone) return;
    FIT.store.getSetting('entryHintDismissed').then(function (dismissed) {
      if (dismissed) return;
      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      overlay.innerHTML = '<div class="dialog">'
        + '<h3>建议添加到主屏幕使用</h3>'
        + '<p>iPhone / iPad 上，<b>Safari 里直接打开</b>和<b>主屏幕图标打开</b>是两套独立存储，数据不互通。</p>'
        + '<p>建议：点 Safari 底部分享按钮 →「添加到主屏幕」，以后固定从主屏图标进入，别再两边混用。</p>'
        + '<div class="dialog-actions"><button type="button" class="btn primary" id="ehOk">我知道了</button></div>'
        + '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector('#ehOk').addEventListener('click', function () {
        overlay.remove();
        FIT.store.setSetting('entryHintDismissed', true);
      });
    });
  }

  // 切换 Tab：按钮高亮 + 容器显隐 + 渲染对应页
  function switchTab(tab) {
    currentTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === tab);
    });
    Object.keys(pages).forEach(function (k) {
      pages[k].classList.toggle('show', k === tab);
    });
    if (tab === 'today') FIT.today.render(pages.today);
    if (tab === 'coach') FIT.coach.render(pages.coach);
    if (tab === 'log') FIT.log.render(pages.log);
    if (tab === 'me') FIT.me.render(pages.me);
  }

  // 全量刷新（切换成员 / 恢复备份后调用）
  function refreshAll() {
    switchTab(currentTab);
  }

  // 进入问卷流程（今日页引导 / 我的页新建成员共用）
  function goSurvey() {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var box = document.createElement('div');
    box.className = 'dialog survey-dialog';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    // 问卷完成后：关弹窗 + 回今日页开始报训练
    FIT.survey.render(box, function (member) {
      overlay.remove();
      alert('建档完成！' + member.name + '，练了什么随时到「今日」页告诉我。');
      refreshAll();
      switchTab('today');
    });
  }

  // DOM 就绪后启动
  document.addEventListener('DOMContentLoaded', init);

  // 暴露
  FIT.app = {
    switchTab: switchTab,
    refreshAll: refreshAll,
    goSurvey: goSurvey,
    showDisclaimer: showDisclaimer
  };
})();
