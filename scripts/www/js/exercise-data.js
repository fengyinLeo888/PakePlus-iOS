/* ============================================================
 * exercise-data.js —— 预置动作库（静态种子数据）
 * 字段说明：
 *   id         唯一标识
 *   name       动作名
 *   group      肌群：push(胸肩三头) / pull(背二头) / legs(腿臀) / core(核心)
 *   equipment  器械类型：machine(固定器械) / dumbbell(哑铃) / barbell(杠铃) / cable(绳索) / bodyweight(徒手)
 *   tags       伤病标签：涉及到的身体部位（腰/膝/肩/肘/腕/踝），用于伤病过滤
 *   cues       技术要点（3~6 条）
 *   errors     常见错误（2~4 条）
 *   compound   是否复合动作（影响组间休息时长与加重幅度）
 *   unit       训练记录单位：kg / 秒（平板支撑等按秒）
 *   video      主人自贴示范视频链接（初始为空，可在动作库中补充）
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  var LIST = [
    /* ===== 推类（胸 / 肩 / 三头） ===== */
    {
      id: 'ex-bench-press', name: '杠铃卧推', group: 'push', equipment: 'barbell',
      tags: ['肩', '肘'], compound: true, unit: 'kg', video: null,
      cues: ['仰卧收紧肩胛，双脚踩实地面', '杠铃落于乳头线附近', '小臂全程垂直地面', '下放控制在 1~2 秒'],
      errors: ['耸肩含胸', '杠铃弹胸借力', '双脚离地晃动']
    },
    {
      id: 'ex-incline-db-press', name: '上斜哑铃卧推', group: 'push', equipment: 'dumbbell',
      tags: ['肩', '肘'], compound: true, unit: 'kg', video: null,
      cues: ['凳面调至 30° 左右', '肩胛后沉贴紧凳面', '哑铃沿胸上沿轨迹推起'],
      errors: ['凳面过陡变成推肩', '耸肩借力', '重量下放过快']
    },
    {
      id: 'ex-chest-press-machine', name: '坐姿推胸（固定器械）', group: 'push', equipment: 'machine',
      tags: [], compound: true, unit: 'kg', video: null,
      cues: ['背贴紧靠垫，握把与乳头线同高', '推起时肘不锁死', '下放至胸口有牵拉感'],
      errors: ['耸肩', '屁股离开坐垫', '速度过快靠惯性']
    },
    {
      id: 'ex-db-shoulder-press', name: '坐姿哑铃推肩', group: 'push', equipment: 'dumbbell',
      tags: ['肩'], compound: true, unit: 'kg', video: null,
      cues: ['背部贴紧靠垫', '哑铃从耳侧推起至头顶', '下放至大臂约与地面平行'],
      errors: ['腰部反弓借力', '半程动作', '哑铃前后晃动']
    },
    {
      id: 'ex-lateral-raise', name: '哑铃侧平举', group: 'push', equipment: 'dumbbell',
      tags: ['肩'], compound: false, unit: 'kg', video: null,
      cues: ['肘部微屈固定角度', '沿体侧抬至大臂接近平行地面', '靠三角肌发力而非甩臂'],
      errors: ['甩动借力', '耸肩变成斜方肌发力', '抬得过高']
    },
    {
      id: 'ex-pushup', name: '俯卧撑', group: 'push', equipment: 'bodyweight',
      tags: ['肩', '腕'], compound: true, unit: 'kg', video: null,
      cues: ['身体成一条直线', '核心收紧不塌腰', '下放至胸口接近地面'],
      errors: ['塌腰或撅臀', '半程幅度', '头部先着地式的探头']
    },
    {
      id: 'ex-cable-pushdown', name: '绳索下压', group: 'push', equipment: 'cable',
      tags: ['肘'], compound: false, unit: 'kg', video: null,
      cues: ['大臂贴紧身体两侧', '下压至小臂充分伸直', '顶峰停顿 1 秒'],
      errors: ['肘部外翻', '身体前倾压重量', '回放太快']
    },
    {
      id: 'ex-dips', name: '双杠臂屈伸', group: 'push', equipment: 'bodyweight',
      tags: ['肩', '肘'], compound: true, unit: 'kg', video: null,
      cues: ['身体略前倾练胸、竖直练三头', '下放至大臂平行地面', '核心收紧控制晃动'],
      errors: ['耸肩', '下放过深肩部压力大', '耸肩探头']
    },

    /* ===== 拉类（背 / 二头） ===== */
    {
      id: 'ex-pullup', name: '引体向上', group: 'pull', equipment: 'bodyweight',
      tags: ['肩', '肘'], compound: true, unit: 'kg', video: null,
      cues: ['肩胛先下沉再拉起身体', '下巴过杠即可', '下放至手臂接近伸直'],
      errors: ['蹬腿借力', '耸肩凑幅度', '半程摆动']
    },
    {
      id: 'ex-lat-pulldown', name: '高位下拉（固定器械）', group: 'pull', equipment: 'machine',
      tags: [], compound: true, unit: 'kg', video: null,
      cues: ['大腿压稳固定垫', '挺胸后仰约 10°', '横杆拉至上胸位置', '想象肘部向下划'],
      errors: ['过度后仰变成划船', '耸肩', '回放时完全放松甩重量']
    },
    {
      id: 'ex-seated-row', name: '坐姿划船（固定器械）', group: 'pull', equipment: 'machine',
      tags: [], compound: true, unit: 'kg', video: null,
      cues: ['膝微屈固定位置', '拉把手至腹部', '肩胛向后夹紧', '躯干基本保持竖直'],
      errors: ['前后大幅摆动借力', '耸肩', '手臂先力竭变弯举']
    },
    {
      id: 'ex-one-arm-db-row', name: '单臂哑铃划船', group: 'pull', equipment: 'dumbbell',
      tags: [], compound: true, unit: 'kg', video: null,
      cues: ['一手撑凳，背放平', '哑铃沿体侧拉至髋部', '肘贴身', '顶端夹紧肩胛'],
      errors: ['转腰借力', '耸肩', '拉向胸口方向错误']
    },
    {
      id: 'ex-face-pull', name: '面拉', group: 'pull', equipment: 'cable',
      tags: [], compound: false, unit: 'kg', video: null,
      cues: ['绳索拉向额头高度', '外旋至手在耳侧', '肩后侧发力'],
      errors: ['重量过大变形', '耸肩', '拉向胸口']
    },
    {
      id: 'ex-barbell-curl', name: '杠铃弯举', group: 'pull', equipment: 'barbell',
      tags: ['肘', '腕'], compound: false, unit: 'kg', video: null,
      cues: ['肘部固定在身体两侧', '杠铃举至肩前', '下放控制 2 秒'],
      errors: ['腰部摆动借力', '肘部前移变推举', '半程放下']
    },

    /* ===== 腿臀类 ===== */
    {
      id: 'ex-squat', name: '杠铃深蹲', group: 'legs', equipment: 'barbell',
      tags: ['腰', '膝'], compound: true, unit: 'kg', video: null,
      cues: ['脚与肩同宽脚尖微外展', '核心收紧背挺直', '下蹲至大腿至少平行地面', '膝盖与脚尖同方向'],
      errors: ['弓腰', '膝盖内扣', '脚跟离地', '蹲得过浅']
    },
    {
      id: 'ex-leg-press', name: '腿举（固定器械）', group: 'legs', equipment: 'machine',
      tags: [], compound: true, unit: 'kg', video: null,
      cues: ['背与臀贴紧靠垫', '下放至膝盖约 90°', '蹬起时膝不锁死', '双脚与肩同宽'],
      errors: ['下放过深腰部离垫', '锁死膝盖', '双手推膝借力']
    },
    {
      id: 'ex-rdl', name: '罗马尼亚硬拉', group: 'legs', equipment: 'barbell',
      tags: ['腰'], compound: true, unit: 'kg', video: null,
      cues: ['膝微屈固定', '髋部向后推，杠铃贴大腿下放', '下放至腘绳肌有强烈牵拉感', '背部全程挺直'],
      errors: ['弓腰捡重量', '变成深蹲', '杠铃离身体太远']
    },
    {
      id: 'ex-bulgarian-split-squat', name: '保加利亚分腿蹲', group: 'legs', equipment: 'dumbbell',
      tags: ['膝'], compound: true, unit: 'kg', video: null,
      cues: ['后脚搭凳，前脚向前一步', '垂直下蹲', '前腿大腿至少平行地面', '重心压在前脚跟'],
      errors: ['前膝过度前顶', '重心倒向后脚', '躯干过度前倾']
    },
    {
      id: 'ex-leg-curl', name: '腿弯举（固定器械）', group: 'legs', equipment: 'machine',
      tags: [], compound: false, unit: 'kg', video: null,
      cues: ['臀与背压紧垫面', '腘绳肌发力弯起', '回放控制 2 秒'],
      errors: ['臀部抬起借力', '幅度过小', '速度过快']
    },
    {
      id: 'ex-glute-bridge', name: '臀桥', group: 'legs', equipment: 'bodyweight',
      tags: [], compound: false, unit: 'kg', video: null,
      cues: ['脚跟踩实发力', '顶起时夹紧臀部', '顶点身体成直线', '肋骨下压避免弓腰'],
      errors: ['腰部代偿弓起', '幅度不足', '用脚尖蹬地']
    },

    /* ===== 核心与综合 ===== */
    {
      id: 'ex-plank', name: '平板支撑', group: 'core', equipment: 'bodyweight',
      tags: ['肩', '腰', '腕'], compound: false, unit: '秒', video: null,
      cues: ['肘在肩正下方', '身体从头到脚一条直线', '核心与臀持续收紧'],
      errors: ['塌腰', '撅臀', '憋气']
    },
    {
      id: 'ex-crunch', name: '卷腹', group: 'core', equipment: 'bodyweight',
      tags: ['颈'], compound: false, unit: 'kg', video: null,
      cues: ['下背贴地', '肋骨向骨盆方向卷起', '颈部放松不代偿'],
      errors: ['拉头借力', '变成仰卧起坐腰部离地', '速度过快']
    }
    /* 说明：颈不在伤病过滤标签集合（腰/膝/肩/肘/腕/踝）内，卷腹本身腰部安全 */
  ];

  // 修正：卷腹 tags 里的「颈」改为空（颈部不属于过滤部位集合）
  LIST.forEach(function (ex) {
    if (ex.id === 'ex-crunch') ex.tags = [];
  });

  FIT.EXERCISE_SEED = LIST;
})();
