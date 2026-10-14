/* ============================================================
 * chart.js —— 原生 SVG 折线图（本地计算渲染，0 元）
 * 职责：体重 / 睡眠 / 精力 / 完成率等趋势曲线
 * 用法：FIT.chart.line(container, points, options)
 *   points: [{ label: '10-01', value: 71.2 }, ...]
 *   options: { color, unit, height }
 * ============================================================ */
(function () {
  'use strict';
  window.FIT = window.FIT || {};

  // SVG 命名空间
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  /* 折线图：带数据点圆点、首尾数值标注、空数据占位 */
  function line(container, points, options) {
    options = options || {};
    var W = 300, H = options.height || 120;
    var PAD_L = 8, PAD_R = 40, PAD_T = 14, PAD_B = 18;
    var color = options.color || '#166534';
    var unit = options.unit || '';

    // 清空容器
    container.innerHTML = '';

    // 空数据：占位提示（诚实边界：不编数据）
    if (!points || points.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = '暂无数据，坚持记录后这里会出现曲线';
      container.appendChild(empty);
      return;
    }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', preserveAspectRatio: 'none' });

    // 值域：取数据范围并向两侧留 10% 余量；全部相等时给固定区间
    var values = points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (min === max) { min -= 1; max += 1; }
    var range = max - min;
    min -= range * 0.1; max += range * 0.1;

    // 坐标换算
    var plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    function xAt(i) {
      return points.length === 1 ? PAD_L + plotW / 2 : PAD_L + (plotW * i / (points.length - 1));
    }
    function yAt(v) { return PAD_T + plotH * (1 - (v - min) / (max - min)); }

    // 横向基准线（低/中/高，浅色）
    [0, 0.5, 1].forEach(function (t) {
      svg.appendChild(el('line', {
        x1: PAD_L, x2: W - PAD_R,
        y1: PAD_T + plotH * t, y2: PAD_T + plotH * t,
        stroke: '#e5e7eb', 'stroke-width': 1
      }));
    });

    // 折线路径
    var d = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ',' + yAt(p.value).toFixed(1);
    }).join(' ');
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

    // 数据点 + 首尾数值标注
    points.forEach(function (p, i) {
      svg.appendChild(el('circle', { cx: xAt(i).toFixed(1), cy: yAt(p.value).toFixed(1), r: 3, fill: color }));
      if (i === 0 || i === points.length - 1) {
        var text = el('text', {
          x: Math.min(W - PAD_R + 4, xAt(i) + 4), y: Math.max(10, yAt(p.value) - 6),
          'font-size': 10, fill: '#4b5563'
        });
        text.textContent = p.value + unit;
        svg.appendChild(text);
      }
    });

    // 首尾横轴标签（日期）
    [['', points[0].label], ['end', points[points.length - 1].label]].forEach(function (pair) {
      var t = el('text', {
        x: pair[0] === 'end' ? PAD_L + 4 : W - PAD_R - 4,
        y: H - 4, 'font-size': 9, fill: '#9ca3af',
        'text-anchor': pair[0] === 'end' ? 'start' : 'end'
      });
      t.textContent = pair[1];
      svg.appendChild(t);
    });

    container.appendChild(svg);
  }

  FIT.chart = { line: line };
})();
