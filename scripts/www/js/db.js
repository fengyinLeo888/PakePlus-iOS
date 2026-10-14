/* ============================================================
 * db.js —— IndexedDB 封装与数据仓库层
 * 职责：建库建表、提供 Promise 风格的增删改查
 * 所有业务数据只存本地，不上传任何服务器
 * ============================================================ */
(function () {
  'use strict';

  // 全局命名空间：阶段一不用 ES Modules，保证 file:// 双击直开可用
  window.FIT = window.FIT || {};

  var DB_NAME = 'fitness-helper'; // 数据库名
  var DB_VERSION = 4;             // 数据库版本（v2：补 memberId 索引；v3：阶段二新增四表；v4：产品转型为「记录+顾问」，删除 plans 表）

  // ---------- 基础封装 ----------

  var dbPromise = null;

  // 打开数据库（懒加载，只打开一次）
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      // 建库：定义全部对象仓库与索引
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        // 安全建索引：不存在才创建（升级旧库时不报错）
        function safeIndex(store, name, keyPath) {
          if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
        }
        // 成员表：每个成员一份档案
        if (!db.objectStoreNames.contains('members')) {
          db.createObjectStore('members', { keyPath: 'id' });
        }
        // v4：训练计划功能已下线（用户自报训练内容，应用只做记录与建议），删除旧 plans 表
        if (db.objectStoreNames.contains('plans')) {
          db.deleteObjectStore('plans');
        }
        // 训练记录表：索引支持按成员+日期查
        if (!db.objectStoreNames.contains('logs')) {
          var l = db.createObjectStore('logs', { keyPath: 'id' });
          safeIndex(l, 'memberId', 'memberId');
          safeIndex(l, 'memberDate', ['memberId', 'date']);
        }
        // 每日打卡表（v2 补 memberId 索引）
        if (!db.objectStoreNames.contains('checkins')) {
          var c = db.createObjectStore('checkins', { keyPath: 'id' });
          safeIndex(c, 'memberId', 'memberId');
          safeIndex(c, 'memberDate', ['memberId', 'date']);
        } else {
          safeIndex(e.target.transaction.objectStore('checkins'), 'memberId', 'memberId');
        }
        // 体重记录表（v2 补 memberId 索引）
        if (!db.objectStoreNames.contains('weights')) {
          var w = db.createObjectStore('weights', { keyPath: 'id' });
          safeIndex(w, 'memberId', 'memberId');
          safeIndex(w, 'memberDate', ['memberId', 'date']);
        } else {
          safeIndex(e.target.transaction.objectStore('weights'), 'memberId', 'memberId');
        }
        // 动作库（全局共享，预置导入）
        if (!db.objectStoreNames.contains('exercises')) {
          db.createObjectStore('exercises', { keyPath: 'id' });
        }
        // 键值设置表：当前成员、免责声明确认、AI 模型配置等
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // ---- 阶段二新表（v3）----
        // 对话历史表：教练页按成员持久化（PRD FR-02：对话记录本地保存）
        if (!db.objectStoreNames.contains('chats')) {
          var ch = db.createObjectStore('chats', { keyPath: 'id' });
          safeIndex(ch, 'memberId', 'memberId');
        }
        // AI 调用流水表：按月汇总费用（PRD AI-03 预算闸门与 AI-06 月度汇总）
        if (!db.objectStoreNames.contains('usages')) {
          var us = db.createObjectStore('usages', { keyPath: 'id' });
          safeIndex(us, 'month', 'month');
        }
        // 个人画像卡条目表：AI 提取 + 人工可改（PRD AI-02 第③卡）
        if (!db.objectStoreNames.contains('facts')) {
          var fa = db.createObjectStore('facts', { keyPath: 'id' });
          safeIndex(fa, 'memberId', 'memberId');
        }
        // 饮食记录表：拍照识别结构化入库（PRD AI-07）
        if (!db.objectStoreNames.contains('meals')) {
          var me = db.createObjectStore('meals', { keyPath: 'id' });
          safeIndex(me, 'memberId', 'memberId');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  // 通用：在一个事务里执行某个仓库上的请求
  function tx(storeName, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, mode);
        var store = t.objectStore(storeName);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // 生成唯一 id：时间戳 + 随机后缀
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 通用 CRUD ----------

  var api = {
    // 新增（或整体覆盖）一条记录
    put: function (storeName, obj) { return tx(storeName, 'readwrite', function (s) { return s.put(obj); }); },
    // 按 key 取一条
    get: function (storeName, key) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(storeName, 'readonly');
          var r = t.objectStore(storeName).get(key);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error); };
        });
      });
    },
    // 取整表（可选：只取满足条件的）
    all: function (storeName, filter) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(storeName, 'readonly');
          var rows = [];
          var r = t.objectStore(storeName).openCursor();
          r.onsuccess = function (e) {
            var cur = e.target.result;
            if (cur) {
              if (!filter || filter(cur.value)) rows.push(cur.value);
              cur.continue();
            } else { resolve(rows); }
          };
          r.onerror = function () { reject(r.error); };
        });
      });
    },
    // 按 key 删除
    del: function (storeName, key) { return tx(storeName, 'readwrite', function (s) { return s.delete(key); }); },
    // 清空整表（导入覆盖时用）
    clear: function (storeName) { return tx(storeName, 'readwrite', function (s) { return s.clear(); }); },
    // 通过索引查多条
    byIndex: function (storeName, indexName, key) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(storeName, 'readonly');
          var rows = [];
          var r = t.objectStore(storeName).index(indexName).openCursor(IDBKeyRange.only(key));
          r.onsuccess = function (e) {
            var cur = e.target.result;
            if (cur) { rows.push(cur.value); cur.continue(); }
            else { resolve(rows); }
          };
          r.onerror = function () { reject(r.error); };
        });
      });
    },
    uid: uid
  };

  // ---------- 业务仓库（在 CRUD 之上封装语义化方法） ----------

  var store = {

    /* ===== 设置 ===== */
    getSetting: function (key) { return api.get('settings', key).then(function (r) { return r ? r.value : null; }); },
    setSetting: function (key, value) { return api.put('settings', { key: key, value: value }); },

    /* ===== 成员 ===== */
    listMembers: function () { return api.all('members'); },
    getMember: function (id) { return api.get('members', id); },
    saveMember: function (m) { return api.put('members', m); },
    deleteMember: function (id) { return api.del('members', id); },

    // 当前激活成员（无则返回 null）
    getActiveMember: function () {
      return store.getSetting('activeMember').then(function (id) {
        if (!id) return null;
        return api.get('members', id);
      });
    },
    setActiveMember: function (id) { return store.setSetting('activeMember', id); },

    /* ===== 训练记录 ===== */
    getLog: function (memberId, date) {
      return api.byIndex('logs', 'memberDate', [memberId, date]).then(function (rows) { return rows[0] || null; });
    },
    saveLog: function (log) { return api.put('logs', log); },
    allLogs: function (memberId) { return api.byIndex('logs', 'memberId', memberId); },

    /* ===== 打卡 ===== */
    getCheckin: function (memberId, date) {
      return api.byIndex('checkins', 'memberDate', [memberId, date]).then(function (rows) { return rows[0] || null; });
    },
    saveCheckin: function (c) { return api.put('checkins', c); },
    allCheckins: function (memberId) { return api.byIndex('checkins', 'memberId', memberId); },

    /* ===== 体重 ===== */
    getWeight: function (memberId, date) {
      return api.byIndex('weights', 'memberDate', [memberId, date]).then(function (rows) { return rows[0] || null; });
    },
    saveWeight: function (w) { return api.put('weights', w); },
    allWeights: function (memberId) { return api.byIndex('weights', 'memberId', memberId); },

    /* ===== 动作库 ===== */
    allExercises: function () { return api.all('exercises'); },
    getExercise: function (id) { return api.get('exercises', id); },
    saveExercise: function (ex) { return api.put('exercises', ex); },
    // 批量导入预置动作（仅当库为空时）
    seedExercises: function (list) {
      return api.all('exercises').then(function (rows) {
        if (rows.length > 0) return; // 已有数据，跳过
        var chain = Promise.resolve();
        list.forEach(function (ex) {
          chain = chain.then(function () { return api.put('exercises', ex); });
        });
        return chain;
      });
    },

    /* ===== 对话历史（阶段二，PRD FR-02） ===== */
    saveChat: function (msg) { return api.put('chats', msg); },
    // 按成员取全部对话（升序），调用方自行截取最近若干条
    allChats: function (memberId) { return api.byIndex('chats', 'memberId', memberId); },
    clearChats: function (memberId) {
      return api.all('chats', function (c) { return c.memberId === memberId; }).then(function (rows) {
        var chain = Promise.resolve();
        rows.forEach(function (r) { chain = chain.then(function () { return api.del('chats', r.id); }); });
        return chain;
      });
    },

    /* ===== 个人画像卡（阶段二，PRD AI-02 第③卡） ===== */
    allFacts: function (memberId) { return api.byIndex('facts', 'memberId', memberId); },
    saveFact: function (f) { return api.put('facts', f); },
    deleteFact: function (id) { return api.del('facts', id); },

    /* ===== 饮食记录（阶段二，PRD AI-07） ===== */
    saveMeal: function (m) { return api.put('meals', m); },
    allMeals: function (memberId) { return api.byIndex('meals', 'memberId', memberId); },
    deleteMeal: function (id) { return api.del('meals', id); },
    // 清理过期照片（photo 置空保留文字数据），keepDays=0 表示永久保留
    cleanMealPhotos: function (keepDays) {
      if (!keepDays || keepDays <= 0) return Promise.resolve(0);
      var deadline = Date.now() - keepDays * 24 * 3600 * 1000;
      return api.all('meals', function (m) { return m.photo && new Date(m.time).getTime() < deadline; }).then(function (rows) {
        var chain = Promise.resolve();
        rows.forEach(function (m) {
          delete m.photo;
          chain = chain.then(function () { return api.put('meals', m); });
        });
        return rows.length;
      });
    },

    /* ===== 备份与恢复 ===== */
    // 导出全部数据（含阶段二新表；settings 全含方便恢复）
    // 安全约定：导出副本中 API 密钥一律清空（v3 起）——备份可能经网盘/聊天工具传输，明文 Key 有泄露风险
    exportAll: function () {
      // v4 起不再含 plans（表已删）；importAll 兼容旧备份：多余的 plans 数据会被忽略
      var names = ['members', 'logs', 'checkins', 'weights', 'exercises', 'chats', 'usages', 'facts', 'meals', 'settings'];
      var result = { app: 'fitness-helper', version: 3, exportedAt: new Date().toISOString(), data: {} };
      var chain = Promise.resolve();
      names.forEach(function (n) {
        chain = chain.then(function () {
          return api.all(n).then(function (rows) { result.data[n] = rows; });
        });
      });
      return chain.then(function () {
        // 密钥脱敏：深拷贝 aiConfig 后抹掉各厂商 apiKey，并打标记（本机库内数据不受影响）
        (result.data.settings || []).forEach(function (row) {
          if (row.key === 'aiConfig' && row.value && row.value.providers) {
            var copy = JSON.parse(JSON.stringify(row.value));
            copy.providers.forEach(function (p) { p.apiKey = ''; });
            copy.keyStripped = true;
            row.value = copy;
          }
        });
        return result;
      });
    },
    // 覆盖式恢复：清空后写入备份内容（兼容旧备份：缺失的表按空处理，旧备份里的 plans 数据直接忽略）
    importAll: function (backup) {
      var names = ['members', 'logs', 'checkins', 'weights', 'exercises', 'chats', 'usages', 'facts', 'meals', 'settings'];
      var chain = Promise.resolve();
      names.forEach(function (n) {
        chain = chain.then(function () { return api.clear(n); });
        var rows = (backup.data && backup.data[n]) || [];
        rows.forEach(function (row) {
          chain = chain.then(function () { return api.put(n, row); });
        });
      });
      return chain;
    }
  };

  // 挂到全局命名空间
  FIT.db = api;
  FIT.store = store;

  // ---------- 日期工具（全局共用） ----------

  var dateUtil = {
    // 本地时区的 'YYYY-MM-DD'
    toKey: function (d) {
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var day = ('0' + d.getDate()).slice(-2);
      return y + '-' + m + '-' + day;
    },
    // 今天
    todayKey: function () { return dateUtil.toKey(new Date()); },
    // 从 'YYYY-MM-DD' 解析为 Date（本地时区，避免 UTC 偏移）
    fromKey: function (key) {
      var p = key.split('-');
      return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    },
    // 给日期加 n 天
    addDays: function (d, n) {
      var c = new Date(d.getTime());
      c.setDate(c.getDate() + n);
      return c;
    },
    // 本周一的 'YYYY-MM-DD'（周一为一周起始，与 PRD 周期结构一致）
    weekStartKey: function (d) {
      var c = new Date(d.getTime());
      var day = c.getDay(); // 0=周日
      var diff = (day === 0) ? -6 : (1 - day); // 回退到周一
      return dateUtil.toKey(dateUtil.addDays(c, diff));
    },
    // 'MM-DD' 短显示
    shortKey: function (key) { return key.slice(5); },
    // 周几中文
    weekName: function (d) { return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]; }
  };
  FIT.date = dateUtil;

})();
