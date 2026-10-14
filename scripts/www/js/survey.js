/* ============================================================
 * survey.js —— 问卷建档（四步）
 * 流程：目标 → 经验 → 伤病史(必答) → 器械
 * 完成后仅保存成员档案（v4 起不生成训练计划：
 * 成员自己安排训练，档案供 AI 建议时参考器械/经验/伤病边界）
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  // 五步问卷的选项定义（label 为显示文案，value 为存档值）
  var STEPS = [
    {
      key: 'goal', title: '你的训练目标是？', multi: true,
      options: [
        { value: 'muscle', label: '增肌' },
        { value: 'fatloss', label: '减脂' },
        { value: 'strength', label: '力量' },
        { value: 'endurance', label: '体能' },
        { value: 'health', label: '健康维持' }
      ],
      hint: '可多选'
    },
    {
      key: 'experience', title: '你的训练经验？', multi: false,
      options: [
        { value: 'none', label: '零基础' },
        { value: 'half-year', label: '半年内' },
        { value: 'year-plus', label: '一年以上' }
      ],
      hint: '零基础上 AI 建议会更保守（轻重量、先学动作模式）'
    },
    {
      key: 'injuries', title: '有伤病史吗？（必答）', multi: true,
      options: [
        { value: '腰', label: '腰' },
        { value: '膝', label: '膝' },
        { value: '肩', label: '肩' },
        { value: '肘', label: '肘' },
        { value: '腕', label: '腕' },
        { value: '踝', label: '踝' },
        { value: '无', label: '无' }
      ],
      hint: 'AI 给建议时会避开涉及勾选部位的动作（安全硬规则）'
    },
    {
      key: 'equipment', title: '可用器械？', multi: true,
      options: [
        { value: 'gym', label: '商业健身房' },
        { value: 'dumbbell', label: '家庭哑铃' },
        { value: 'barbell', label: '家庭杠铃' },
        { value: 'band', label: '弹力带' },
        { value: 'bar', label: '单杠' },
        { value: 'bodyweight', label: '徒手' }
      ],
      hint: '可多选，按实际有的选'
    }
  ];

  // 渲染整个问卷流程（container 内完成，返回 Promise 在完成时 resolve）
  function render(container, onDone) {
    var answers = {};  // 各步答案
    var stepIdx = 0;   // 当前步

    function draw() {
      var step = STEPS[stepIdx];
      var html = ''
        + '<div class="survey-card">'
        +   '<div class="survey-progress">第 ' + (stepIdx + 1) + ' / ' + STEPS.length + ' 步</div>'
        +   '<h3 class="survey-title">' + step.title + '</h3>'
        +   '<p class="survey-hint">' + step.hint + '</p>'
        +   '<div class="survey-opts">';
      step.options.forEach(function (opt) {
        var sel = isPicked(step, opt.value) ? ' picked' : '';
        html += '<button type="button" class="survey-opt' + sel + '" data-value="' + opt.value + '">' + opt.label + '</button>';
      });
      html +=   '</div>'
        +   '<div class="survey-actions">';
      if (stepIdx > 0) html += '<button type="button" class="btn ghost" id="svPrev">上一步</button>';
      html +=   '<button type="button" class="btn primary" id="svNext" disabled>'
        +     (stepIdx === STEPS.length - 1 ? '完成建档' : '下一步')
        +   '</button>'
        +   '</div>'
        + '</div>';
      container.innerHTML = html;

      // 选项点击：单选直接选中并可下一步；多选切换
      var nextBtn = container.querySelector('#svNext');
      Array.prototype.forEach.call(container.querySelectorAll('.survey-opt'), function (btn) {
        btn.addEventListener('click', function () {
          var v = btn.dataset.value;
          if (step.multi) {
            // 「无」与其余互斥（伤病页：选「无」清空其他，选其他去掉「无」）
            if (step.key === 'injuries') {
              if (v === '无') { answers.injuries = ['无']; }
              else {
                answers.injuries = (answers.injuries || []).filter(function (x) { return x !== '无'; });
                if (answers.injuries.indexOf(v) < 0) answers.injuries.push(v);
              }
            } else {
              answers[step.key] = answers[step.key] || [];
              if (answers[step.key].indexOf(v) < 0) answers[step.key].push(v);
              else answers[step.key] = answers[step.key].filter(function (x) { return x !== v; });
            }
          } else {
            answers[step.key] = v;
            // 单选直接进入下一步（最后一步除外）
            if (stepIdx < STEPS.length - 1) { stepIdx += 1; draw(); return; }
          }
          draw();
        });
      });

      // 校验必填：伤病必答、多选至少一项
      var ok = validate(step);
      nextBtn.disabled = !ok;
      nextBtn.addEventListener('click', function () {
        if (stepIdx < STEPS.length - 1) { stepIdx += 1; draw(); }
        else { finish(); }
      });
      var prevBtn = container.querySelector('#svPrev');
      if (prevBtn) prevBtn.addEventListener('click', function () { stepIdx -= 1; draw(); });
    }

    // 该步是否已满足必填
    function validate(step) {
      var v = answers[step.key];
      if (step.key === 'injuries') return Array.isArray(v) && v.length > 0; // 必答不许跳过
      if (step.multi) return Array.isArray(v) && v.length > 0;
      return !!v;
    }

    // 选项是否被选中（用于重绘时高亮）
    function isPicked(step, value) {
      var v = answers[step.key];
      if (!v) return false;
      return step.multi ? v.indexOf(value) >= 0 : v === value;
    }

    // 完成：仅保存成员档案（v4 起不再生成训练计划——成员自己安排训练）
    function finish() {
      var injuries = (answers.injuries || []).filter(function (x) { return x !== '无'; });
      var member = {
        id: FIT.db.uid(),
        name: '成员' + Math.floor(Math.random() * 90 + 10), // 默认名，可在「我的」改
        profile: {
          goal: answers.goal,
          experience: answers.experience,
          injuries: injuries,
          equipment: answers.equipment
        },
        createdAt: new Date().toISOString()
      };

      FIT.store.saveMember(member)
        .then(function () { return FIT.store.setActiveMember(member.id); })
        .then(function () {
          if (onDone) onDone(member);
        })
        .catch(function (err) {
          container.innerHTML = '<div class="empty-tip">出错了：' + (err && err.message) + '</div>';
        });
    }

    draw();
  }

  FIT.survey = { render: render };
})();
