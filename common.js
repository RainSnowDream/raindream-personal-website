/* RainDream · 雨梦 — 共享交互逻辑（index.html 与 blog.html 共用）
   负责：主题切换、背景音乐播放/暂停、移动端导航、导航滚动、返回顶部、露出动画、
   平滑滚动、页脚年份、Service Worker 注册。页面专属脚本仍留在各自的 <script> 里。 */
(function () {
  'use strict';
  var doc = document;

  /* ===== 主题切换 ===== */
  var themeToggle = doc.getElementById('themeToggle');
  var themeColorHold = false;   /* 过场进行中：theme-color 交给过场做平滑过渡，applyTheme 先别一步改掉 */
  function applyTheme(n) {
    doc.documentElement.setAttribute('data-theme', n);
    if (themeToggle) themeToggle.setAttribute('aria-checked', n === 'dark' ? 'true' : 'false');
    if (!themeColorHold && window.__setThemeColor) window.__setThemeColor();
  }
  function setTheme(n) {
    applyTheme(n);
    try { localStorage.setItem('theme', n); } catch (e) {}
  }

  if (themeToggle) {
    themeToggle.setAttribute('aria-checked', doc.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
    /* ===== 深浅色切换过场（新版）：柔光扩散 =====
       现代做法里最省性能的一类：**只动 opacity 与 transform**（合成层动画，不重排、不重绘内容），
       从切换按钮的位置向外散开一圈「新主题颜色」的柔光，配合全站元素自身的 .5s 颜色过渡完成换色。
       为什么用 absolute 而不是 fixed：iOS 会把 fixed 层裁在「可视视口」内，
       而网址栏（液态玻璃）背后那一条属于「布局视口」—— 只有属于文档的层才画得到那里。
       降级：开了「减少动态效果」→ 直接切换，不创建任何元素。 */
    var themeGlow = function (next) {
      var rect = themeToggle.getBoundingClientRect();
      var cx = Math.round(rect.left + rect.width / 2);
      var cy = Math.round(rect.top + rect.height / 2);
      var vw = Math.max(window.innerWidth || 0, doc.documentElement.clientWidth || 0);
      var vh = Math.max(window.innerHeight || 0, doc.documentElement.clientHeight || 0);
      var dx = Math.max(cx, vw - cx), dy = Math.max(cy, vh - cy);
      var r = Math.round(Math.sqrt(dx * dx + dy * dy));   /* 半径取到最远的角：整屏（含网址栏那条）都盖住 */

      var old = doc.querySelector('.theme-glow');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var g = doc.createElement('div');
      g.className = 'theme-glow';
      g.setAttribute('aria-hidden', 'true');
      g.style.top = Math.round(window.pageYOffset || 0) + 'px';   /* 属于文档：从当前滚动位置铺起 */

      themeColorHold = true;                 /* 先别让 applyTheme 一步改掉 theme-color */
      var fromC = readMetaColor();
      doc.body.appendChild(g);
      setTheme(next);                        /* 页面颜色开始渐变 */

      /* 目标色：临时放开 hold 让页面算一次、读出来，再立刻退回旧色 —— 中间没有绘制机会，不会闪。 */
      themeColorHold = false;
      if (window.__setThemeColor) window.__setThemeColor();
      var toC = readMetaColor();
      themeColorHold = true;
      if (fromC && window.__setThemeColor) window.__setThemeColor(fromC);
      var glowC = toC || fromC || 'rgba(255,255,255,.6)';
      g.style.backgroundImage = 'radial-gradient(circle ' + r + 'px at ' + cx + 'px ' + cy + 'px,' +
        glowC + ' 0%,' + glowC + ' 20%,transparent 68%)';

      requestAnimationFrame(function () { g.className = 'theme-glow is-on'; });

      var t0 = Date.now(), dur = 900, lastMeta = 0;
      var tick = function () {
        var t = Date.now() - t0;
        var f = Math.min(1, t / dur);
        if (window.__setThemeColor && fromC && toC) {
          if (t - lastMeta >= 70 || f >= 1) {
            lastMeta = t;
            window.__setThemeColor(f >= 1 ? toC : mixColor(fromC, toC, f));
          }
        }
        if (f < 1) { requestAnimationFrame(tick); return; }
        if (window.__setThemeColor) window.__setThemeColor();   /* 精确落到目标色 */
        themeColorHold = false;
        setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 140);
      };
      requestAnimationFrame(tick);
    };

    themeToggle.addEventListener('change', function (e) {
      var next = (e && e.detail === 'dark') ? 'dark' : 'light';
      /* 组件初始化时会为了同步状态发一次 change —— 那不是访客操作，忽略掉。 */
      if (next === doc.documentElement.getAttribute('data-theme')) return;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { setTheme(next); return; }
      themeGlow(next);   /* 深浅色切换过场：柔光扩散（实现在上方 themeGlow） */
    });
    /* 读当前 theme-color 的实际值（可能已经是过场中的中间色） */
    var readMetaColor = function () {
      var m = doc.querySelector('meta[name="theme-color"]');
      return m ? m.getAttribute('content') : '';
    };
    /* #rgb / #rrggbb / rgb() 都能解析；解析不了就返回 null（宁可不插值也不出错） */
    var parseColor = function (c) {
      c = String(c || '').trim();
      var m6 = /^#([0-9a-f]{6})$/i.exec(c);
      if (m6) {
        var v = parseInt(m6[1], 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      }
      var m3 = /^#([0-9a-f]{3})$/i.exec(c);
      if (m3) {
        var s = m3[1];
        return [parseInt(s.charAt(0) + s.charAt(0), 16), parseInt(s.charAt(1) + s.charAt(1), 16), parseInt(s.charAt(2) + s.charAt(2), 16)];
      }
      var mr = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
      if (mr) return [+mr[1], +mr[2], +mr[3]];
      return null;
    };
    var mixColor = function (a, b, f) {
      var ca = parseColor(a), cb = parseColor(b);
      if (!ca || !cb) return b;
      return 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * f) + ',' +
        Math.round(ca[1] + (cb[1] - ca[1]) * f) + ',' +
        Math.round(ca[2] + (cb[2] - ca[2]) * f) + ')';
    };

    // 系统深浅色变化时：仅当用户未手动选择过主题才跟随
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      var onSchemeChange = function (e) {
        try { if (localStorage.getItem('theme')) return; } catch (err) { return; }
        applyTheme(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
      else if (mq.addListener) mq.addListener(onSchemeChange);
    }
  }

  /* ===== 背景音乐：导航栏按钮 + 浮窗播放器（随机歌单）=====
     歌单来自 audio/playlist.json（没有它才退回「按编号探测 / 单曲」）。
     玩法：进站后在后台把整个歌单下载好（慢网与省流量模式跳过），点哪首都尽量立刻播；
     还没下完的歌点了会排队，下好自动播（只认最后一次点击）。
     顺序可切随机 / 顺序；「上一首」按播放历史回退。
     重复进站不会重新下载：已在浏览器缓存里的歌直接算「已下载」，一个字节都不走网络。
     注意：响不响由访客决定（浏览器要求用户手势），但下载是进站就开始的。 */
  var bgmToggle = doc.getElementById('bgmToggle');
  var bgm = doc.getElementById('bgm');
  if (bgmToggle && bgm) {
    /* 第二个 <audio>：专门用来「预先加载下一首」。
       浏览器开始播一首新歌前必须先把音源加载并校验一遍。音频已经设了 immutable 长缓存
       （见 _headers 与 src/worker.js），命中缓存时这一步很快；但第一次听、或换设备、
       或缓存被清掉时仍然要真下载，切歌就会有可见延迟。
       有了这个备用元素，下一首提前加载好，切歌时直接播它 —— 几乎瞬间开始。
       两个元素交替当「正在播的那个」，任何时刻只有一个在响。 */
    var bgmB = doc.createElement('audio');
    bgmB.id = 'bgmNext';
    bgmB.preload = 'auto';
    /* 不用 hidden / display:none，改成「占 1 像素、完全透明」（见 styles.css）——
       有些浏览器对 display:none 的媒体元素不一定会自己去加载，那会拖慢切歌。 */
    doc.body.appendChild(bgmB);
    var els = [bgm, bgmB];
    var activeIdx = 0;
    var active = function () { return els[activeIdx]; };
    var standby = function () { return els[1 - activeIdx]; };
    var elHas = function (el, url) { return !!el && el.getAttribute('src') === url; };
    var bgmStarted = false;     /* 用「真的出声了」判断，不能用 audio.paused */
    var forcePausedUntil = 0;   /* 这个时刻之前，媒体一出声就按回去（状态是「暂停」时用） */
    var resumeHint = false;     /* 是否正在等访客「点一下」才续播（iOS 上必然要这一步） */
    var resumeTries = 0;        /* 自动续播被「打断」后的重试次数，防止无限重试 */
    var resumeFailedTries = 0;  /* 「没有手势的自动续播」被系统拒绝过几次（Safari 会因此弄脏元素，见 tryResume） */
    var playlist = [];          /* [{src, title, artist, state}] */
    var current = -1;
    var warmStatus = '';        /* 「正在后台准备音乐 2/5」这类提示 */
    var played = [];            /* 播放历史，用来实现「上一首」。
                                    ⚠️ 千万别叫 history —— 那会遮蔽 window.history，
                                    以前就因为这个名字，锚点清理那块静默失效过。 */
    var playedPos = -1;
    var bgmErrors = 0;          /* 连续失败次数，避免死循环 */
    var triggerShown = false;
    var order = 'shuffle';      /* shuffle = 随机播放；sequence = 顺序播放 */
    var pendingPlay = -1;       /* 访客点了但还没下载完的那首：下好自动播，只认最后一次点击 */
    var upNext = -1;            /* 提前定好的下一首（随机模式也提前决定，这样才能预备加载） */
    var warmRound = 0;          /* 已经自动重试过几轮 */
    var warmOn = false;         /* 是否真的在做后台预下载（慢网 / 省流量时不预热） */
    var WARM_TIMEOUT = 30000;   /* 单首超过 30 秒没下完算超时 */
    var WARM_TRIES = 3;         /* 失败或超时最多重试到第 3 次 */

    var esc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    /* ---------- 跨页面记住播放状态（同一个标签页）----------
       多页面站点换页会销毁播放器，所以做不到「不断音」；但可以把
       「哪一首 + 播到第几秒 + 是否正在播」记在 sessionStorage 里，
       新页面打开后接着播同一首、同一个位置（首页 ↔ 文章页双向同步）。
       用 sessionStorage 而不是 localStorage：它是每个标签页独立的，
       不会出现「另一个标签页把我这首歌改掉」。 */
    var STATE_KEY = 'bgmState';
    /* 这次进页面是「刷新」还是「跳转/后退前进」？
       刷新的语义是**重新开始** → 回到默认曲；跳转才继续上一首。
       两种 API 都试：新的 PerformanceNavigationTiming，旧浏览器退回 performance.navigation（1 = 刷新）。 */
    var isReloadPage = function () {
      try {
        var list = window.performance && performance.getEntriesByType && performance.getEntriesByType('navigation');
        if (list && list.length && list[0] && list[0].type) return list[0].type === 'reload';
        if (window.performance && performance.navigation) return performance.navigation.type === 1;
      } catch (e) {}
      return false;
    };
    var resumeTime = 0;           /* 要恢复到的位置（秒）；0 = 不用恢复 */
    var resumeWantPlay = false;   /* 上次在别的页面正在播吗 */
    /* 「还没真正播起来的续播意图」：{ src, time }。
       为什么要单独存一份：resumeTime 会在好几条路径上被清零
       （访客点歌、自动恢复、等待期间的各种事件）。真机上出现过的现象是
       「iOS 上等一会儿再点，进度从头开始」—— 就是意图被某条路径清掉了。
       有了这个「除非真的按这个位置播起来了、或者访客明确换了别的歌，
       否则不许丢」的备份，无论哪条路径清掉 resumeTime，点播放时都还能回到正确的秒数。 */
    var pendingResume = null;

    /* ---------- 调试面板（可选，不影响正常访客）----------
       为什么需要它：iOS Safari 的播放/手势策略在这台开发机上无法复现，
       光靠推理修了好几轮都没修准。现在把「播放器内部到底怎么想的」直接显示在手机上：
       在网址后面加 ?bgmdebug=1 就会在屏幕底部出现一个小面板（列表页/文章页都行），
       里面是实时状态 + 最近 40 条事件流水，截图就能一次定位。
       正常访客不带这个参数，什么都不显示、也几乎不产生开销。 */
    var debugOn = false;
    try { debugOn = /[?&]bgmdebug/.test(location.search || '') || location.hash === '#bgmdebug'; } catch (e) {}
    var debugEl = null;
    var bgmLog = [];
    var logEv = function (msg) {
      if (!debugOn) return;
      var d = new Date();
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      bgmLog.push(p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + msg);
      if (bgmLog.length > 40) bgmLog.shift();
      drawDebug();
    };
    var drawDebug = function () {
      if (!debugOn) return;
      if (!debugEl) {
        debugEl = doc.createElement('div');
        debugEl.id = 'bgmDebug';
        debugEl.setAttribute('style',
          'position:fixed;left:6px;right:6px;bottom:6px;z-index:99999;max-height:52vh;overflow:auto;' +
          'padding:9px 10px;border-radius:12px;background:rgba(0,0,0,.87);color:#9f9;' +
          'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all');
        doc.body.appendChild(debugEl);
      }
      var el = elForCurrent();
      var song = playlist[current];
      var head = [
        '【截图发我即可】',
        'started=' + bgmStarted + ' really=' + isReallyPlaying() + ' want=' + resumeWantPlay +
          ' resumeT=' + (Math.round((resumeTime || 0) * 10) / 10) +
          ' pending=' + (pendingResume ? (Math.round(pendingResume.time * 10) / 10 + '@' + String(pendingResume.src).replace(/^.*\//, '')) : 'null'),
        'song=' + (song ? String(song.src).replace(/^.*\//, '') + '[' + (song.state || '?') + ']' : 'none') +
          ' paused=' + (el ? el.paused : '?') + ' t=' + (Math.round(((el && el.currentTime) || 0) * 10) / 10) +
          ' dur=' + (el && isFinite(el.duration) ? Math.round(el.duration) : '?') + ' rs=' + (el ? el.readyState : '?'),
        '------------------------------'
      ];
      debugEl.textContent = head.concat(bgmLog.slice().reverse()).join('\n');
    };
    var leaving = false;          /* 页面正在离开（离开时的 pause 不是访客暂停） */
    var lastSave = 0;
    var readState = function () {
      try {
        var raw = sessionStorage.getItem(STATE_KEY);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        return (obj && typeof obj === 'object' && obj.src) ? obj : null;
      } catch (e) { return null; }
    };
    /* 装「当前这首」的那个元素 —— 可能是 active，也可能是 standby。
       切换过程中真正出声的经常是 standby（见下面 playIndex 的注释）。
       凡是要读/写「这首播到第几秒」的地方，都必须先问这个函数，
       直接用 active() 会读成 0 或者另一首歌的秒数 —— 进度就是这么丢的。 */
    var elForCurrent = function () {
      var song = playlist[current];
      if (!song) return active();
      if (elHas(active(), song.src)) return active();
      if (elHas(standby(), song.src)) return standby();
      return active();
    };
    /* 「现在真的在出声吗」——不能只看 bgmStarted 这个标记：
       历史上有过被杂音事件置真的情况，一旦失真，点播放会走成「暂停」分支，
       访客就卡在「点了没反应」。所以还要问元素本身：装的是这首、而且不在暂停态。 */
    var isReallyPlaying = function () {
      var el = elForCurrent();
      return !!(el && playlist[current] && elHas(el, playlist[current].src) && !el.paused);
    };
    var writeState = function () {
      if (current < 0 || !playlist[current]) return;
      var el = elForCurrent();
      var holdsIt = !!(el && elHas(el, playlist[current].src));
      var live = holdsIt ? (el.currentTime || 0) : 0;
      /* 记着的「续播意图」秒数（备份意图优先，其次是 resumeTime） */
      var remembered = 0;
      if (pendingResume && pendingResume.src === playlist[current].src) remembered = pendingResume.time || 0;
      if (resumeWantPlay || resumeHint) remembered = Math.max(remembered, resumeTime || 0);
      /* ⚠️ 这一段是真机踩出来的：
         iOS 上「没有手势时不加载音源」，所以自动续播那次尝试会把音源装进元素，
         但位置设不上去（没有元数据时设 currentTime 不生效），元素停在 0 秒。
         如果这时候直接信 el.currentTime，离开页面时就会把 **0** 写进状态 ——
         下一个页面读到 0，点一下自然就「从头播」。
         所以：**还没真正出声（bgmStarted 为假）时，绝不写一个比记着的意图更小的位置**。 */
      var time = (!bgmStarted && remembered > live) ? remembered : live;
      logEv('writeState t=' + (Math.round(time * 10) / 10) + ' live=' + (Math.round(live * 10) / 10) + ' want=' + resumeWantPlay);
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
          src: playlist[current].src,
          title: playlist[current].title,
          time: time > 0 ? time : 0,
          /* 「在播」的判断要带上两个意图标记：
             resumeHint = 自动续播被浏览器挡住、正等访客点一下；
             resumeWantPlay = 状态说「离开时在播」，但元素还没装载起来。
             这两种都算「在播」，否则换页后就再也不会尝试续播了。 */
          playing: !!(resumeHint || resumeWantPlay || (holdsIt && !el.paused))
        }));
      } catch (e) {}
    };
    /* 位置还不确定时用它写状态：按「打算播第几秒」写，而不是读 currentTime。
       典型场景：刚给元素设上 src（此时 currentTime 必然是 0），
       直接 writeState() 会把上次记着的位置冲成 0 —— 续播时等于把进度弄丢。 */
    var writeStateFor = function (src, title, time, playing) {
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
          src: src,
          title: title || '',
          time: (typeof time === 'number' && isFinite(time) && time > 0) ? time : 0,
          playing: !!playing
        }));
      } catch (e) {}
    };
    var saveThrottled = function () {       /* 播放中每 2 秒记一次，别太频繁 */
      var now = Date.now();
      if (now - lastSave < 2000) return;
      lastSave = now;
      writeState();
    };
    /* ---------- 本标签页「已经下载过」的歌 ----------
       下载状态只在内存里，换页就丢；以前到了文章页会对每首歌重新校验一遍
       （查缓存、必要时把整首再读出来），看起来就像「又要重新下载」。
       现在把下载过的 src 记在 sessionStorage 里，新页面直接算「已下载」——
       不查缓存、不读文件、不走网络。真被浏览器清掉了也没关系：
       播它时顶多多缓冲一下；万一播不出来，错误处理会强制重新下载。 */
    var DONE_KEY = 'bgmReady';
    var readDone = function () {
      try {
        var raw = sessionStorage.getItem(DONE_KEY);
        var arr = raw ? JSON.parse(raw) : null;
        return (arr && arr.length) ? arr : [];
      } catch (e) { return []; }
    };
    var markDone = function (src) {
      try {
        var arr = readDone();
        if (arr.indexOf(src) < 0) {
          arr.push(src);
          if (arr.length > 60) arr = arr.slice(arr.length - 60);
          sessionStorage.setItem(DONE_KEY, JSON.stringify(arr));
        }
      } catch (e) {}
    };
    /* ---------- 核实名单：真的还在缓存里才算「已下载」----------
       只查缓存（only-if-cached），不读文件、不走网络。
       返回 [{ i, hit }]；返回 null 表示没法核实（浏览器不支持这个选项、或超时）——
       那种情况才退化成「先信名单」，绝不让页面被核实拖住。
       核实不到的会照常当「没下载」，交给预热队列重新下（没有的才下）。 */
    var CACHE_QUERY_OK = (typeof Request === 'function' && 'cache' in Request.prototype);
    var verifyDone = function (indexes) {
      if (!indexes.length || !CACHE_QUERY_OK || typeof Promise !== 'function') {
        return Promise.resolve(null);
      }
      var checks = [];
      for (var k = 0; k < indexes.length; k++) {
        checks.push((function (i) {
          return fetch(playlist[i].src, { cache: 'only-if-cached', mode: 'same-origin' })
            .then(function (res) { return { i: i, hit: !!(res && res.ok) }; })
            .catch(function () { return { i: i, hit: false }; });
        })(indexes[k]));
      }
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 1500); });
      return Promise.race([Promise.all(checks), timeout]);
    };

    /* ---------- 浮窗（用 JS 建，两个页面共用一份结构）---------- */
    var panel = doc.createElement('div');
    panel.className = 'bgm-panel';
    panel.id = 'bgmPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '背景音乐');
    panel.innerHTML = '<div class="bgm-head"><span class="bgm-title">背景音乐</span>' +
      '<button class="bgm-order" type="button" data-act="order" id="bgmOrder" aria-label="播放顺序" title="随机播放（点击改成顺序）">' +
      '<svg class="bgm-i-shuffle" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>' +
      '<svg class="bgm-i-sequence" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>' +
      '<span id="bgmOrderText">随机</span></button>' +
      '<button class="bgm-close" type="button" aria-label="关闭">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button></div>' +
      /* 版面顺序（自上而下）：正在播放 → 播放控件 → 进度条 → 音量 → 歌单 → Spotify。
         进度条放在控件「下面」，是手机播放器更常见的位置。 */
      '<p class="bgm-now" id="bgmNow">还没开始播放</p>' +
      '<div class="bgm-controls">' +
      '<button class="bgm-btn" type="button" data-act="prev" aria-label="上一首" title="上一首">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h2.2v14H7zM19 5.4v13.2L10.2 12z"/></svg></button>' +
      '<button class="bgm-btn bgm-btn-main" type="button" data-act="toggle" id="bgmPanelToggle" aria-label="播放" title="播放 / 暂停">' +
      '<svg class="bgm-i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>' +
      '<svg class="bgm-i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg></button>' +
      '<button class="bgm-btn" type="button" data-act="next" aria-label="下一首" title="下一首">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.8 5h2.2v14h-2.2zM5 5.4v13.2L13.8 12z"/></svg></button>' +
      '</div>' +
      /* 进度条（加粗版）：左=当前时间，右=总时长（还没读到元数据时显示 --:--）。
         真正的「跳转」只在松手时执行一次（change），拖动过程中只更新时间预览 ——
         边拖边 seek 会不停中断缓冲，反而更卡。 */
      '<div class="bgm-seek" id="bgmSeekWrap">' +
      '<span class="bgm-time bgm-time-now" id="bgmTimeNow">0:00</span>' +
      '<input class="bgm-seek-range" id="bgmSeek" type="range" min="0" max="0" step="1" value="0" aria-label="播放进度" disabled>' +
      '<span class="bgm-time bgm-time-all" id="bgmTimeAll">--:--</span>' +
      '</div>' +
      '<div class="bgm-vol" id="bgmVol">' +
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12z"/></svg>' +
      '<input class="bgm-vol-range" id="bgmVolume" type="range" min="0" max="100" step="5" value="40" aria-label="音量">' +
      '<span class="bgm-vol-value" id="bgmVolValue">40%</span>' +
      /* iOS 等平台不允许网页改音量（设了也无效）：那时把滑块换成这句提示，
         而不是摆一个划了没反应的控件 */
      '<span class="bgm-vol-hint" id="bgmVolHint" hidden>音量请用设备按键调节</span>' +
      '</div>' +
      '<ol class="bgm-list" id="bgmList"></ol>' +
      /* 前往 Spotify 歌单：绿色品牌按钮 + 官方图标；新标签页打开，不打断当前页面 */
      '<a class="bgm-spotify" href="https://open.spotify.com/playlist/4N5nl2mOLn3Q44RZg3QGZe" target="_blank" rel="noopener noreferrer" title="在 Spotify 打开雨梦的专属歌单">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>' +
      '<span>雨梦的专属歌单</span></a>' +
      '<p class="bgm-toast" id="bgmToast" role="status" aria-live="polite"></p>';
    doc.body.appendChild(panel);
    var nowEl = doc.getElementById('bgmNow');
    var listEl = doc.getElementById('bgmList');
    var mainBtn = doc.getElementById('bgmPanelToggle');
    var orderBtn = doc.getElementById('bgmOrder');
    var orderTextEl = doc.getElementById('bgmOrderText');
    var volWrap = doc.getElementById('bgmVol');
    var volRange = doc.getElementById('bgmVolume');
    var toastEl = doc.getElementById('bgmToast');
    var seekWrap = doc.getElementById('bgmSeekWrap');
    var seekRange = doc.getElementById('bgmSeek');
    var timeNowEl = doc.getElementById('bgmTimeNow');
    var timeAllEl = doc.getElementById('bgmTimeAll');
    var toastTimer = null;
    var isOpen = false;

    var openPanel = function () {
      isOpen = true;
      panel.classList.add('open');
      bgmToggle.setAttribute('aria-expanded', 'true');
      var closeBtn = panel.querySelector('.bgm-close');
      if (closeBtn && closeBtn.focus) closeBtn.focus();
      retryFailed();      /* 打开浮窗时，顺手把之前下载失败的再自动试一次 */
    };
    var closePanel = function (back) {
      isOpen = false;
      panel.classList.remove('open');
      bgmToggle.setAttribute('aria-expanded', 'false');
      if (back !== false) bgmToggle.focus();
    };

    /* ---------- 渲染 ---------- */
    var toast = function (message) {
      if (!toastEl) return;
      toastEl.textContent = message;
      toastEl.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
    };
    var markList = function () {
      var items = listEl.querySelectorAll('.bgm-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('is-current', Number(items[i].getAttribute('data-index')) === current);
      }
    };
    /* 每首歌后面的小状态图标：✓ 已下载可播放 / 转圈 下载中 / ! 下载失败 */
    var STATE_ICON = {
      ready: '<svg class="bgm-state is-ready" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
      loading: '<svg class="bgm-state is-loading" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
      error: '<svg class="bgm-state is-error" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.6v.01"/></svg>'
    };
    /* 这首歌现在能不能点：不预热时（慢网/省流量）一律可以，边下边播 */
    var canPlay = function (index) {
      var song = playlist[index];
      if (!song) return false;
      return !warmOn || song.state === 'ready';
    };
    var itemHtml = function (song, i) {
      var state = song.state || 'pending';
      var waiting = warmOn && state !== 'ready' && state !== 'error';
      var hint = song.title + (song.artist ? ' · ' + song.artist : '');
      if (state === 'ready') hint += '（已下载，可以播放）';
      else if (state === 'error') hint += '（下载失败，点击重新下载）';
      else if (waiting) hint += '（还在下载，点了会等它下完自动播放）';
      return '<li><button class="bgm-item' + (waiting ? ' is-waiting' : '') + '" type="button" data-index="' + i + '"' +
        ' title="' + esc(hint) + '">' +
        '<span class="bgm-item-num">' + (i + 1) + '</span>' +
        '<span class="bgm-item-title">' + esc(song.title) + '</span>' +
        (song.artist ? '<span class="bgm-item-artist">' + esc(song.artist) + '</span>' : '') +
        '<span class="bgm-item-state">' + (STATE_ICON[state] || '') + '</span>' +
        '</button></li>';
    };
    var renderList = function () {
      listEl.innerHTML = playlist.map(itemHtml).join('');
      markList();
    };
    /* 只重画某一行的状态，不动整张列表（避免滚动位置跳动） */
    var renderItemState = function (index) {
      var song = playlist[index];
      if (!song) return;
      var btns = listEl.querySelectorAll('.bgm-item');
      for (var i = 0; i < btns.length; i++) {
        if (Number(btns[i].getAttribute('data-index')) === index) {
          btns[i].parentNode.outerHTML = itemHtml(song, index);
          markList();
          return;
        }
      }
    };
    /* 长歌名滚动显示：只有真的放不下（宽度不够）才滚动，能放下就静止不动 */
    var syncScroll = function () {
      if (!nowEl) return;
      var text = nowEl.querySelector('.bgm-now-text');
      if (!text) return;
      nowEl.classList.remove('is-scrolling');
      text.style.removeProperty('--bgm-shift');
      text.style.removeProperty('--bgm-dur');
      var over = text.scrollWidth - nowEl.clientWidth;
      if (over > 8) {
        text.style.setProperty('--bgm-shift', (-over) + 'px');
        text.style.setProperty('--bgm-dur', Math.max(7, Math.round(over / 16)) + 's');
        nowEl.classList.add('is-scrolling');
      }
    };
    var updateNow = function () {
      if (!nowEl) return;
      var song = playlist[current];
      var label = song
        ? (bgmStarted ? '正在播放 '
          : (resumeHint ? '点一下继续播放 ' : (pendingPlay === current ? '等待下载 ' : '准备播放 ')))
        : '';
      var full = song
        ? label + song.title + (song.artist ? ' · ' + song.artist : '')
        : (warmStatus || '还没开始播放');
      nowEl.title = full;
      if (song) {
        /* 正在等下载时，标题前加一个和歌单里同款的转圈图标 —— 让访客看到「它在工作」，而不是以为没反应 */
        var waitIcon = (pendingPlay === current && !bgmStarted) ? STATE_ICON.loading : '';
        nowEl.innerHTML = waitIcon + esc(label) + '<b class="bgm-now-text">' + esc(song.title) + '</b>' +
          (song.artist ? '<span class="bgm-now-artist"> · ' + esc(song.artist) + '</span>' : '');
      } else {
        nowEl.innerHTML = '<span class="bgm-now-text">' + esc(full) + '</span>';
      }
      markList();      /* 高亮必须跟着 current 走 —— 以前只在播放事件里刷，切歌时高亮会停在旧的那首 */
      syncScroll();
      updateProgress();   /* 切歌 / 播放状态变了，进度条也要跟着换（总时长未知时自动置灰） */
    };
    var setBgmPlaying = function (playing) {
      bgmStarted = playing;
      if (playing) { clearResumeHint(); resumeTries = 0; }   /* 真的出声了：撤掉提示、重置重试计数 */
      bgmToggle.classList.toggle('is-playing', playing);
      bgmToggle.setAttribute('aria-label', playing ? '暂停音乐' : '音乐');
      if (mainBtn) {
        mainBtn.classList.toggle('is-playing', playing);
        mainBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
      }
      updateNow();      /* 它里面会重画列表高亮，也会把「准备播放」切成「正在播放」 */
    };
    /* 「点一下继续播放」提示的状态。
       为什么要它：iOS（以及部分手机浏览器）从「前进后退缓存」恢复页面后，
       不允许网页自动出声 —— 必须等访客点一下。这是系统策略改不掉，
       但绝不能让人以为播放器坏了：所以把这句话写在界面上，并让主按钮呼吸提示。 */
    var setResumeHint = function (on) {
      on = !!on;
      if (resumeHint === on) return;
      resumeHint = on;
      if (mainBtn) mainBtn.classList.toggle('is-armed', on);
      updateNow();                       /* 直接把「准备播放」换成「点一下继续播放」 */
    };
    var clearResumeHint = function () {
      if (!resumeHint) return;
      resumeHint = false;
      if (mainBtn) mainBtn.classList.remove('is-armed');
    };
    /* 把播放位置设到 target 秒 —— **不只试一次**。
       踩过的坑：页面（尤其 iOS 从前进后退缓存）恢复后，元素可能还没开始加载，
       loadedmetadata 迟迟不来；只挂一个 loadedmetadata 监听就等于「永远不跳」，
       表现出来就是「进度没同步：看着在播，其实从 0 开始」。
       所以这里：立刻试一次，再在 元数据 / 时长 / 可播 / 开始播放 时各补一次。
       窗口给足 2 分钟：真机上「等一会儿再点播放」是常态，
       只在 15 秒内有效的话，等过 15 秒再点就没人纠正了。 */
    var seekTo = function (el, target, src) {
      if (!el || !(target > 0)) return;
      cancelSeekTo(el);                       /* 同一个元素上只保留最后一次续播意图 */
      var deadline = Date.now() + 120000;
      var tries = 0;
      var stopped = false;
      var apply = function () {
        /* 换歌了就放弃：这些回调可能在新歌上触发，
           不校验 src 就会把上一首的秒数写到新歌上（跳到莫名其妙的 42 秒）。 */
        if (src && el.getAttribute('src') !== src) { stop(); return; }
        logEv('seekTo 设位置 -> ' + (Math.round(target * 10) / 10) + 's');
        tries++;
        try {
          var d = el.duration;
          if (typeof d === 'number' && isFinite(d) && d > 0 && target > d - 0.25) {
            el.currentTime = Math.max(0, d - 0.25);      /* 别正好停在结尾，会直接跳下一首 */
          } else {
            el.currentTime = target;
          }
        } catch (e) {}
      };
      var stop = function () {
        if (stopped) return;
        stopped = true;
        if (poll) clearInterval(poll);
        el.removeEventListener('loadedmetadata', onReady);
        el.removeEventListener('durationchange', onReady);
        el.removeEventListener('canplay', onReady);
        el.removeEventListener('playing', onPlaying);
        if (el.__bgmSeekStop === stop) { el.__bgmSeekStop = null; el.__bgmSeekTarget = null; }
      };
      /* ⚠️ 纠正只允许发生在「播放还没真正推进起来」之前（currentTime 还不到 3 秒）。
         一旦已经开始播了，就绝不再改位置 —— 真机上出现过「播着播着突然跳回旧位置」：
         播放中途也会发 playing / canplay（缓冲恢复等），
         那时候把 currentTime 往旧目标上掰，听起来就是「重新放」。 */
      var onReady = function () {
        if (stopped) return;
        if (Date.now() > deadline || tries > 12) { stop(); return; }
        var t = el.currentTime || 0;
        if (t >= 3) { stop(); return; }                  /* 已经在播了：不再插手 */
        if (Math.abs(t - target) > 2) apply();
        else stop();
      };
      var onPlaying = function () {
        if (stopped) return;
        /* 开播这一刻是纠正「iOS 从 0 开始」的最后机会：位置还没推进起来就纠一次。
           纠完立刻收工，绝不留着监听。 */
        var t = el.currentTime || 0;
        if (t < 3 && Math.abs(t - target) > 2) apply();
        stop();
      };
      apply();
      el.__bgmSeekStop = stop;                /* 让 cancelSeekTo / 换歌时能主动撤掉 */
      el.__bgmSeekTarget = target;            /* 供 markPlaying 判断「位置是否已经对了」 */
      el.addEventListener('loadedmetadata', onReady);
      el.addEventListener('durationchange', onReady);
      el.addEventListener('canplay', onReady);
      el.addEventListener('playing', onPlaying);
      /* 定时兜底：iOS 上这些事件可能**一个都不来**（元数据早就有了就不会再发），
         光靠事件监听会「永远不跳」。这里每 400ms 看一眼：
         只在「刚开始播、而且明显落后于目标」时往后拉到目标 ——
         绝不把进度往前拽，所以不会跟访客自己的拖动/前进打架。 */
      var poll = setInterval(function () {
        if (stopped) { clearInterval(poll); return; }
        if (Date.now() > deadline) { stop(); return; }
        var t = el.currentTime || 0;
        if (t >= target - 2 || t >= 10) { clearInterval(poll); return; }
        if (t > 0) apply();
      }, 400);
      setTimeout(stop, 15000);
    };
    /* 撤掉这个元素上还没完成的「续播跳转」：
       访客自己拖动进度条、或明确点了播放之后，迟到的纠正回调不许再改位置。 */
    var cancelSeekTo = function (el) {
      if (el && typeof el.__bgmSeekStop === 'function') {
        var fn = el.__bgmSeekStop;
        el.__bgmSeekStop = null;
        try { fn(); } catch (e) {}
      }
    };

    /* ---------- 进度条 ----------
       「当前播到第几秒」只有交给正在装这首歌的那个元素才知道；
       拖动时先只更新时间预览，松手（change）才真正跳转。 */
    var seeking = false;            /* 正在拖动：这段时间不让 timeupdate 的刷新覆盖滑块 */
    var fmtTime = function (sec) {
      if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '--:--';
      var total = Math.floor(sec);
      var h = Math.floor(total / 3600);
      var m = Math.floor(total / 60) % 60;
      var s = total % 60;
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return (h > 0 ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
    };
    var songDuration = function () {
      var el = elForCurrent();
      var d = el && el.duration;
      /* 有些文件（尤其边下边播）在拿到元数据前 duration 是 NaN 或 Infinity */
      return (typeof d === 'number' && isFinite(d) && d > 0) ? d : 0;
    };
    /* 已播部分用渐变画出来：把百分比写进 CSS 变量，样式那边用它切分颜色 */
    var paintSeek = function () {
      if (!seekRange) return;
      var max = Number(seekRange.max) || 0;
      var val = Number(seekRange.value) || 0;
      var pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
      seekRange.style.setProperty('--bgm-fill', pct.toFixed(2) + '%');
    };
    /* 刷新进度条：没装载/没有总时长时置灰，别让访客拖一个动不了的滑块 */
    var updateProgress = function () {
      if (!seekRange || !timeNowEl || !timeAllEl) return;
      if (seeking) return;                    /* 拖动中：让拖动那一方说了算 */
      var el = elForCurrent();
      var song = playlist[current];
      var loaded = !!(el && song && elHas(el, song.src));
      var d = loaded ? songDuration() : 0;
      var usable = !!(loaded && d > 0);
      var t = (loaded && el && typeof el.currentTime === 'number' && isFinite(el.currentTime)) ? el.currentTime : 0;
      if (!usable) t = 0;
      seekRange.max = usable ? String(Math.max(1, Math.floor(d))) : '0';
      seekRange.value = usable ? String(Math.min(Math.floor(t), Number(seekRange.max))) : '0';
      seekRange.disabled = !usable;
      timeNowEl.textContent = usable ? fmtTime(t) : '0:00';
      timeAllEl.textContent = usable ? fmtTime(d) : '--:--';
      paintSeek();
    };
    var commitSeek = function () {
      if (!seekRange) return;
      seeking = false;
      if (seekWrap) seekWrap.classList.remove('is-seeking');
      var el = elForCurrent();
      var song = playlist[current];
      var d = songDuration();
      if (!el || !song || !elHas(el, song.src) || !(d > 0)) { updateProgress(); return; }
      var target = Number(seekRange.value);
      if (!isFinite(target)) target = 0;
      /* 别正好停在结尾，那会立刻触发 ended 直接跳到下一首 */
      target = Math.max(0, Math.min(target, d - 0.25));
      cancelSeekTo(el);            /* 访客拖到哪就是哪：撤掉迟到的续播纠正，别把它拽回去 */
      try { el.currentTime = target; } catch (e) {}
      /* 访客亲手选了新位置：续播意图作废（否则下次点播放会被拉回旧秒数） */
      pendingResume = null;
      updateProgress();
      /* 暂停状态下拖到某处：立刻把新位置记下来，这样换页后会从那里接着播 */
      if (!bgmStarted) writeState();
    };
    if (seekRange) {
      /* input 在拖动过程中连续触发（只更新时间预览），change 在松手 / 键盘操作后触发（真正跳转） */
      var onSeekDrag = function () {
        seeking = true;
        if (seekWrap) seekWrap.classList.add('is-seeking');
        if (timeNowEl) timeNowEl.textContent = fmtTime(Number(seekRange.value) || 0);
        paintSeek();
      };
      seekRange.addEventListener('input', onSeekDrag);
      seekRange.addEventListener('change', function () { onSeekDrag(); commitSeek(); });
      /* 兜底：拖动被中断（例如指针取消、切走了焦点）时也要提交，别把 seeking 卡住 */
      seekRange.addEventListener('blur', function () { if (seeking) commitSeek(); });
    }
    var showTrigger = function () {
      if (triggerShown) return;
      triggerShown = true;
      bgmToggle.hidden = false;
      /* 和其他导航控件一样淡入上浮。
         为什么用类而不是 CSS 的 @starting-style：这里是靠去掉 hidden 属性
         （display:none → inline-flex）出现的，而 display 是离散属性，
         要让它参与过渡还得加 transition-behavior: allow-discrete（支持面窄），
         所以不少浏览器里音乐按钮是「啪」地出现、没有动画。
         改成：先加 .is-entering 给起始态，下一帧移除 → 会自然过渡回正常态。 */
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        bgmToggle.classList.add('is-entering');
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { bgmToggle.classList.remove('is-entering'); });
        });
      }
    };

    /* 给某个元素换音源：顺便记下时刻。
       这个时刻让 onPause 能区分「访客按了暂停」和「我们换源/重新加载引发的 pause」——
       后者的 currentTime 可能是上一首残留的秒数，只看 currentTime 会误判。 */
    var loadInto = function (el, url) {
      cancelSeekTo(el);
      try {
        el.__bgmLoadedAt = Date.now();
        el.__bgmReloaded = false;      /* 新音源：允许 onError 里再强下一次 */
        el.__bgmPrevTime = 0;          /* 换源后位置从头算，供「是否真的在往前播」判断 */
      } catch (e) {}
      el.src = url;
      /* 显式再 load() 一次：让「重新装载」这件事确定发生（Safari 被失败尝试弄脏后
         需要一次干净的重来），同时也让测试能观测到。对刚设了 src 的元素是无害的。 */
      try { el.load(); } catch (e) {}
    };
    /* ---------- 播放控制 ---------- */
    /* startAt > 0 时会先把播放位置设到那里再开始播（跨页面续播用） */
    var playIndex = function (index, record, startAt) {
      if (index < 0 || index >= playlist.length) return;
      pendingPlay = -1;                     /* 已经在放这首了，队列清掉 */
      if (record !== false) {
        played = played.slice(0, playedPos + 1);   /* 丢掉「上一首」之后的分支 */
        played.push(index);
        playedPos = played.length - 1;
      }
      current = index;
      /* 访客（或代码）明确要播这首歌了：撤销「暂停状态下的按住窗口」。
         少了这一句，从 bfcache 回来后的 3 秒内点歌单会被自己按回去 ——
         表现就是「点了没反应」。 */
      forcePausedUntil = 0;
      var url = playlist[index].src;
      var el;
      if (elHas(active(), url)) {
        el = active();                    /* 已经在这个元素里：直接播最快 */
      } else if (elHas(standby(), url)) {
        active().pause();                 /* 备用元素里正好预备着这首：切过去，几乎瞬间 */
        activeIdx = 1 - activeIdx;
        el = active();
      } else {
        active().pause();                 /* 都没装载过：在当前元素里装载（这一段会有小延迟） */
        el = active();
        loadInto(el, url);                /* 换源 + 记时刻（见 loadInto 注释） */
      }
      updateNow();                          /* 高亮跟着 current 走，不再依赖播放事件 */
      /* 记状态必须用「打算播第几秒」：此刻 src 可能刚设上，读 currentTime 只会得到 0，
         那会把上次记着的位置冲掉（续播时等于弄丢进度），
         并且顺手把「离开时在播」也写成「没在播」。 */
      writeStateFor(url, playlist[index].title, startAt > 0 ? startAt : (el.currentTime || 0), true);
      var begin = function () {
        applyVolume();                      /* 每次播放前重申音量，避免被别处改掉 */
        var p = el.play();                  /* 先播，绝不等待 —— 等待有可能永远等不到 */
        /* 续播：位置交给 seekTo（会立刻试一次，并在元数据到达后补一次）。
           以前是「等 loadedmetadata 再设 currentTime」，iOS 上那个事件可能永远不来，
           结果就是「点了播放，声音从头开始」—— 看起来就是进度没同步。 */
        if (startAt > 0) seekTo(el, startAt, url);
        return p;                           /* 老浏览器可能返回 undefined */
      };
      return begin();
    };
    /* 把某一首放进备用元素预先加载（前提：已经下载好、也确实还没装载在任一元素里） */
    var preloadIndex = function (i) {
      if (!warmOn || i < 0 || i >= playlist.length) return;
      var song = playlist[i];
      if (!song || song.state !== 'ready') return;
      if (elHas(active(), song.src) || elHas(standby(), song.src)) return;
      var el = standby();
      el.pause();
      loadInto(el, song.src);               /* preload="auto"：它会自己在后台缓冲 */
    };
    /* 预备「接下来要播的那首」：还没开播时预备默认曲，开播后预备下一首 */
    var preloadAhead = function () {
      if (!warmOn || !playlist.length) return;
      if (!bgmStarted && current >= 0 && !elHas(active(), playlist[current].src) && !elHas(standby(), playlist[current].src)) {
        preloadIndex(current);              /* 让第一次点播放也几乎立刻出声 */
        return;
      }
      if (upNext < 0 || upNext === current) upNext = nextIndex();
      preloadIndex(upNext);
    };
    /* 访客想做的那件事：能播就播；还没下载完就排队，下好了自动播。
       队列里永远只有一首（最后一次点击覆盖前一次），所以不可能同时播两首，
       也不会跑去播「更早点过的那首」。 */
    var requestPlay = function (index, noRecord) {
      if (index < 0 || index >= playlist.length) return;
      /* 访客点的还是「我们正打算续播的那一首」吗？（恢复后自动播失败、访客又点了一下）
         是的话：保留续播位置，别从头播。 */
      var sameAsPending = !!(pendingResume && playlist[index] && pendingResume.src === playlist[index].src && !bgmStarted);
      resumeWantPlay = false;   /* 访客自己点了：不再自动续播上次那首 */
      resumeTime = 0;
      if (!sameAsPending) pendingResume = null;   /* 换了别的歌：旧意图作废 */
      current = index;
      if (canPlay(index)) {
        playIndex(index, noRecord === true ? false : true, sameAsPending ? pendingResume.time : 0);
      } else {
        pendingPlay = index;
        updateNow();
        markList();
        toast('这首歌还没下载完，下载好会自动播放');
      }
    };
    /* 下一首：优先挑已经下载好的；都没下好就挑一首，下好会自动播 */
    var nextIndex = function () {
      if (!playlist.length) return -1;
      var readyList = [];
      var allList = [];
      for (var i = 0; i < playlist.length; i++) {
        allList.push(i);
        if (canPlay(i)) readyList.push(i);
      }
      var pool = readyList.length ? readyList : allList;
      if (order === 'sequence') {
        for (var k = 1; k <= playlist.length; k++) {
          var idx = (current + k) % playlist.length;
          if (pool.indexOf(idx) >= 0) return idx;
        }
        return pool[0];
      }
      var pick = [];
      for (var j = 0; j < pool.length; j++) if (pool[j] !== current) pick.push(pool[j]);
      if (!pick.length) pick = pool;
      return pick[Math.floor(Math.random() * pick.length)];
    };
    var playNext = function () {
      /* 用「提前定好的下一首」，这样它和预先加载进备用元素的那首是同一个，切歌才快 */
      var i = (upNext >= 0 && upNext !== current) ? upNext : nextIndex();
      upNext = -1;
      if (i < 0) { toast('没有可以播放的歌'); return false; }
      requestPlay(i);
      return true;
    };
    var playPrev = function () {
      if (!playlist.length) return false;
      /* ⚠️ 「上一首」这几条路都要传 noRecord：
         回退本身不是「听了一首新歌」，不该写进播放历史 ——
         否则 requestPlay 会把刚退到的那首又记一遍、指针被推回来，
         连按「上一首」就会在同一首上来回跳（真机 bug）。 */
      if (order === 'sequence') {
        requestPlay(((current - 1) % playlist.length + playlist.length) % playlist.length, true);
        return true;
      }
      if (playedPos > 0) {
        playedPos--;
        requestPlay(played[playedPos], true);
        return true;
      }
      if (current >= 0 && canPlay(current)) {
        /* 没有上一首了：把头重播一遍（和音乐播放器一致） */
        var el = active();
        try { el.currentTime = 0; } catch (e) {}
        applyVolume();
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
        return true;
      }
      requestPlay(current >= 0 ? current : 0, true);
      return true;
    };
    var togglePlay = function () {
      /* 状态失真保护：标记说「在播」但其实没在出声（历史 bug 会留下这种状态）——
         先纠正回来，否则按播放会走成「暂停」分支，访客觉得点了没反应。 */
      if (bgmStarted && !isReallyPlaying()) setBgmPlaying(false);
      if (bgmStarted) {                                     /* 暂停：排队的也一起取消 */
        pendingPlay = -1;
        forcePausedUntil = 0;
        /* 真正在播的可能是备用元素 —— 所以两个都暂停（暂停没在播的那个是无害的），
           并且立刻把图标切回来，不等异步的 pause 事件。 */
        for (var pi = 0; pi < els.length; pi++) { try { els[pi].pause(); } catch (e) {} }
        setBgmPlaying(false);
        return;
      }
      forcePausedUntil = 0;                                 /* 访客明确要播：解除「按住」 */
      if (current < 0) { playNext(); return; }              /* 还没开始过：挑一首 */
      /* ★ 访客明确按了播放：**不要再等下载完**。
         以前这里「排队 + 弹一句『这首歌还没下载完』」就返回了 ——
         结果就是「进播放器直接按播放没反应，要先点歌单里的歌、或者按两次才能播」。
         现在直接边下边播（音频支持 Range，起播很快，没必要让人干等）。 */
      resumeWantPlay = false;                               /* 访客手动点了播放 */
      var at = resumeTime;
      /* 关键兜底：这一页还没真正播起来过，而 resumeTime 被别的路径清掉了 ——
         那就用备份的续播位置。否则「等一会儿再点播放」就会从头开始。 */
      if (!(at > 1) && !bgmStarted && pendingResume && playlist[current] && pendingResume.src === playlist[current].src) {
        at = pendingResume.time;
      }
      resumeTime = 0;
      var el = elForCurrent();
      if (elHas(el, playlist[current].src)) {               /* 已经装载好这首：接着放 */
        cancelSeekTo(el);                                   /* 访客自己点了播放：撤销迟到的续播纠正 */
        if (at > 1) seekTo(el, at, playlist[current].src);
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        var p2 = playIndex(current, false, at);              /* 默认曲还没装载过 */
        if (p2 && p2.catch) p2.catch(function () {});
      }
      /* ★ 这首还没下好：登记 pendingPlay —— 按钮会显示「等待下载」，
         下载完成后若那时还没出声，会自动补播一次（访客点一下即可，不用再点第二下）；
         若那时已经在出声，下载完成的处理器会跳过、不会把进度拽回 0 秒。 */
      if (!canPlay(current)) { pendingPlay = current; updateNow(); }
    };

    /* ---------- 跨页面续播 ---------- */
    /* 浏览器不肯替我们自动出声时：等访客在本页第一次点击 / 按键，就接着播上次那首。
       点的是「会跳走的链接」时不算 —— 那一下马上就要换页了。
       手机上多监听一个 touchend：有些 WebKit 版本只给 touch 事件，
       而这一下是唯一能拿到播放授权的机会，不能漏。 */
    /* 手势监听做成【单例】：以前每次 arm 都新建一组函数并 addEventListener，
       而 disarm 只能删掉自己那一组 —— 反复进出页面会累积十几份监听。
       现在只挂一次，用 resumeArmed 标记防止重复挂。 */
    var resumeArmed = false;
    var onResumeGesture = function (event) {
    if (debugOn) logEv('gesture ' + event.type + ' want=' + resumeWantPlay + ' really=' + isReallyPlaying());
      /* 真的已经在响了 / 已经没有待续播的意图：这一下不算数（并且把监听撤掉）。
         用 isReallyPlaying() 而不是只看 bgmStarted：标记可能失真，
         一旦误判成「已经在响」，访客点一下就会毫无反应（真机上就是这么卡住的）。 */
      if (!resumeWantPlay || isReallyPlaying()) { disarmResumeGesture(); return; }
      var t = event.target;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (a) {
        /* 这一点会跳走（站内链接、或同一标签打开的外链）：不算播放授权，
           否则会先 play() 一下再卸载页面，白白加载一次。 */
        var href = a.getAttribute('href') || '';
        if (href.charAt(0) !== '#' && !(a.target && a.target !== '_self')) return;
      }
      /* 这一下就是访客给的播放授权，直接收下：就算这首还没下载完也边下边播。
         ★★ 这里**绝对不能先摘监听** —— Safari 只认部分手势事件：
         `pointerdown` 那一发 play() 常被拒，而它真正认可的是随后的 `touchend` / `click`。
         以前在这里就 disarm，等于把 Safari 唯一能用的两次机会提前扔掉，
         表现就是「点空白处没声音，但点播放按钮有声音」。
         现在：失败就不摘，同一次点击的后续事件接着试；真的出声了由 markPlaying 摘掉。 */
      tryResume(true);
    };
    var disarmResumeGesture = function () {
      if (!resumeArmed) return;
      resumeArmed = false;
      doc.removeEventListener('pointerdown', onResumeGesture, true);
      doc.removeEventListener('touchend', onResumeGesture, true);
      doc.removeEventListener('click', onResumeGesture, true);
      doc.removeEventListener('keydown', onResumeGesture, true);
    };
    var armResumeGesture = function () {
      if (!resumeWantPlay) return;
      setResumeHint(true);              /* 界面上明确写着「点一下继续播放」 */
      if (resumeArmed) return;          /* 已经挂着了：不要重复挂 */
      resumeArmed = true;
      doc.addEventListener('pointerdown', onResumeGesture, true);
      doc.addEventListener('touchend', onResumeGesture, true);
      doc.addEventListener('click', onResumeGesture, true);
      doc.addEventListener('keydown', onResumeGesture, true);
    };
    /* 自动播放失败的处理：必须区分两种「失败」——
       ① NotAllowedError：系统真的要求先有用户手势（iOS 恢复页面后就是这样），
          只能亮提示等访客点一下；
       ② AbortError：只是这一次被打断了（同一元素上紧接着又 play/pause、
          页面刚恢复时的竞态、换源……）。这种**重试一下就好了**。
       以前不分青红皂白一律弹「点一下继续播放」，
       于是桌面端也会「有概率要再点一次」—— 其实它自己重试就能成功。 */
    var autoplayFailed = function (err) {
      var errName = (err && err.name) || '';            /* 别叫 name：会遮蔽 window.name */
      if (errName === 'AbortError' && resumeTries < 3) {
        resumeTries++;
        setTimeout(function () { tryResume(); }, 400);
        return;
      }
      /* 被系统按「需要用户手势」拒了：记住次数 ——
         Safari 被这样拒过的元素会被弄脏，访客之后再点就得重建它（见 tryResume）。 */
      if (errName !== 'AbortError') resumeFailedTries++;
      armResumeGesture();
      toast('点一下继续播放上次那首');
    };
    /* 接着播上次那首（位置也恢复）。
       force = 访客刚刚亲手点的：即使这首还没下载完也直接边下边播（点了必须有反应）；
       不传 force 的是自动续播：没下好就先等着，等它下好时 download 完成会再调一次。 */
    var tryResume = function (force) {
      if (!resumeWantPlay || current < 0) return;
      if (isReallyPlaying()) { resumeWantPlay = false; resumeTime = 0; disarmResumeGesture(); return; }  /* 真的在响了：不需要续播 */
      if (!force && !canPlay(current)) return;
      var startAt = resumeTime;
      /* resumeTime 可能被别的路径清掉了 —— 用备份的意图兜底，位置不能丢 */
      if (!(startAt > 0) && pendingResume && playlist[current] && pendingResume.src === playlist[current].src) {
        startAt = pendingResume.time;
      }
      /* ★ 注意：这里**不**清 resumeWantPlay / resumeTime。
         同一次点击会依次来 pointerdown → touchend → click 三个事件，
         Safari 常常只有后面那一两发才被接受；如果第一发就把意图消费掉，
         后两发就没事可做（这就是「点一下没声音，要再点一次」的来源）。
         真正的作废交给 markPlaying（真的出声了）或访客明确换歌/拖动。 */
      /* ★★ Safari 的一个坑（真机实测出来的）：
         同一个 <audio> 元素被「没有手势的 play() 尝试」拒绝过之后，会被弄脏 ——
         之后即使访客亲手点了，play() 也可能不出声。真机现象就是
         「在图标亮起来（=自动尝试跑过）之前点，一切正常；之后再点，没声音」。
         所以：访客点的时候，如果之前已经被系统拒过，就把这个元素**重新装载一次** ——
         在手势里重新加载 = Safari 眼里的干净开始。位置随后由 seekTo 设回去。 */
      if (force && resumeFailedTries > 0) {
        var cur = null;
        var song = playlist[current];
        if (song) {
          if (elHas(active(), song.src)) cur = active();
          else if (elHas(standby(), song.src)) cur = standby();
        }
        if (cur) {
          logEv('手势续播：重建被弄脏的元素');
          loadInto(cur, song.src);
        }
      }
      logEv('tryResume force=' + (!!force) + ' startAt=' + (Math.round(startAt * 10) / 10));
      var pr = playIndex(current, false, startAt);
      if (pr && pr.catch) {
        pr.catch(function (err) {
          resumeTime = startAt;             /* 位置留着，下一次事件继续用 */
          logEv('play 被拒: ' + ((err && err.name) || err));
          autoplayFailed(err);
        });
      }
    };

    /* ---------- 播放顺序：随机 / 顺序 ---------- */
    var setOrder = function (value, save) {
      order = value === 'sequence' ? 'sequence' : 'shuffle';
      if (orderBtn) {
        orderBtn.classList.toggle('is-sequence', order === 'sequence');
        orderBtn.setAttribute('aria-pressed', order === 'sequence' ? 'true' : 'false');
        orderBtn.setAttribute('title', order === 'sequence'
          ? '顺序播放（点击改成随机）' : '随机播放（点击改成顺序）');
      }
      if (orderTextEl) orderTextEl.textContent = order === 'sequence' ? '顺序' : '随机';
      if (save) { try { localStorage.setItem('bgmOrder', order); } catch (e) {} }
    };
    var toggleOrder = function () {
      setOrder(order === 'sequence' ? 'shuffle' : 'sequence', true);
      upNext = -1;
      preloadAhead();       /* 顺序变了，「下一首」也要重新预备 */
      toast(order === 'sequence' ? '已切换为顺序播放' : '已切换为随机播放');
    };

    /* ---------- 事件 ---------- */
    panel.addEventListener('click', function (event) {
      var t = event.target;
      if (t.closest && t.closest('.bgm-close')) { closePanel(); return; }
      var actBtn = t.closest ? t.closest('[data-act]') : null;
      if (actBtn) {
        var act = actBtn.getAttribute('data-act');
        if (act === 'order') toggleOrder();
        else if (act === 'toggle') togglePlay();
        else if (act === 'next') playNext();
        else if (act === 'prev') playPrev();
        return;
      }
      var item = t.closest ? t.closest('.bgm-item') : null;
      if (!item) return;
      var idx = Number(item.getAttribute('data-index'));
      var song = playlist[idx];
      if (song && song.state === 'error') { toast('正在重新下载这首歌…'); download(idx, 1); }
      requestPlay(idx);   /* 没下载完也没关系：排队，下好自动播（只认最后一次点击） */
    });
    bgmToggle.addEventListener('click', function () {
      if (isOpen) closePanel(false); else openPanel();
    });
    /* 点浮窗外面关闭。用 pointerdown / touchstart 而不是 click：
       拖音量条时很常在浮窗外松手，用 click 会被当成「点外面」把浮窗关掉。
       （pointerdown 与 touchstart 可能都触发，重复关闭是无害的。） */
    var onOutsideDown = function (event) {
      if (!isOpen) return;
      if (panel.contains(event.target) || bgmToggle.contains(event.target)) return;
      closePanel(false);
    };
    doc.addEventListener('touchstart', onOutsideDown, { passive: true });
    doc.addEventListener(typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown', onOutsideDown);
    doc.addEventListener('keydown', function (event) {
      if (isOpen && (event.key === 'Escape' || event.key === 'Esc')) closePanel();
    });

    /* 这个元素现在装的是「当前这首歌」吗？
       用「装的是哪一首」判断，比「是不是 active()」可靠得多 ——
       切换过程中真正出声的可能是备用元素，只看 active() 会让暂停按钮失灵
       （bgmStarted 永远不变 true，按下去走的是「播放」分支）。 */
    var holdsCurrent = function (el) {
      return !!(el && playlist[current] && elHas(el, playlist[current].src));
    };
    var markPlaying = function (event) {
      var el = event.target;
      if (!holdsCurrent(el)) return;              /* 别的元素的杂音事件忽略 */
      /* ★★ timeupdate **不代表「在播」** —— 这是真机上绕了好几圈才定住的坑：
         拖动进度条、程序设置 currentTime（seekTo 就在干这个）、缓冲都会触发它。
         以前把它直接当成「开始播放了」，于是 seekTo 一设位置就把 bgmStarted 置真，
         iOS 上（play() 已被系统拒绝、其实一点声音都没有）后果是：
           ① 访客点一下续播 → 被判成「已经在响」→ 意图被清、手势被摘 → **点了没声音**；
           ② 反过来，那时候意图还在 → 点一下又跑一次续播 → **重播 / 跳回旧位置**。
         所以这里必须要求两个条件：**没暂停** 且 **位置确实在往前走**。 */
      if (event.type === 'timeupdate') {
        var t = el.currentTime || 0;
        var prevT = el.__bgmPrevTime || 0;
        el.__bgmPrevTime = t;
        if (el.paused || !(t > prevT)) { logEv('markPlaying 忽略 timeupdate paused=' + el.paused + ' t=' + t.toFixed(1)); return; }
      } else if (el.paused) {
        /* playing 事件理论上就是「开始播了」，但个别实现会在被策略拒绝后也发一下。
           元素仍处于暂停态就不算 —— 宁可晚一点认，也不能误清掉续播意图
           （误清的后果就是访客点一下毫无反应）。 */
        logEv('markPlaying 忽略 ' + event.type + '（元素仍是暂停态）');
        return;
      }
      logEv('markPlaying 接受 ' + event.type + ' t=' + ((el.currentTime || 0).toFixed(1)));
      /* 状态是「暂停」时，浏览器从前进/后退缓存恢复页面可能自己把媒体接着播 —— 按住它 */
      if (forcePausedUntil && Date.now() < forcePausedUntil) {
        for (var fp = 0; fp < els.length; fp++) { try { els[fp].pause(); } catch (e) {} }
        setBgmPlaying(false);
        return;
      }
      forcePausedUntil = 0;
      bgmErrors = 0;
      if (!bgmStarted) {
        setBgmPlaying(true);
        /* ★ 音乐真的响起来了 = 续播这件事已经达成，把「等访客点一下」这套彻底作废。
           为什么必须在这里清：从 bfcache 回来时走的是 syncFromState 的播放分支，
           那条路**不会**把 resumeWantPlay 清掉；如果留着，访客之后点一下空白处
           就会再执行一次「续播」—— playIndex + seekTo(旧目标)，
           听起来就是「播着播着又从头放 / 跳回旧位置」。 */
        resumeWantPlay = false;
        resumeTime = 0;
        resumeFailedTries = 0;          /* 已经真的出声了：清掉「元素被弄脏」的记录 */
        disarmResumeGesture();
        /* 播放真的开始了：位置若已经对上了，就不需要任何「迟到的纠正」——
           立刻撤销它，免得播放中途被拽回旧位置。位置明显不对（iOS 从 0 开始）
           的话留给 seekTo 在开播那一刻纠正一次。 */
        if (event.target && event.target.__bgmSeekTarget != null
            && Math.abs((event.target.currentTime || 0) - event.target.__bgmSeekTarget) <= 2) {
          cancelSeekTo(event.target);
        }
        /* 真的播起来了：如果位置就在「要续播的那一秒」附近，说明意图已达成，可以清掉备份。
           要是位置明显不对（iOS 上从头开始了），就**保留**备份 ——
           之后 seekTo 会纠正，万一没纠正上，访客点播放时还能回去。 */
        if (pendingResume && playlist[current] && pendingResume.src === playlist[current].src
            && Math.abs((event.target.currentTime || 0) - pendingResume.time) < 5) {
          pendingResume = null;
        }
        /* 只在「真的开播」这一刻预备下一首。
           以前 timeupdate（每秒约 4 次）也会走到这里，于是每秒都白跑一遍
           preloadAhead → nextIndex（整表两份数组 + 随机挑选）—— 纯浪费。 */
        preloadAhead();
      }
      showTrigger();
      saveThrottled();                            /* 每 2 秒记一次进度，供换页后续播 */
    };
    var onPause = function (event) {
      var el = event.target;
      if (!holdsCurrent(el)) return;
      setBgmPlaying(false);
      /* 注意：页面离开时浏览器移除播放器也会触发 pause —— 那不是「访客暂停」，
         不能拿它覆盖掉「正在播」的状态，否则换页后就不会自动续播了。 */
      if (leaving) return;
      /* 我们刚给这个元素换了音源 / 重新 load() 时，浏览器也会发一个 pause。
         那不是访客暂停：写回去会把「正在播」写成「暂停」，换页后就不续播了。
         用「刚刚装载过」的时间戳判断，比只看 currentTime 可靠
         （元素复用时会残留上一首的秒数，那个判据会漏）。 */
      if (el.__bgmLoadedAt && Date.now() - el.__bgmLoadedAt < 800) return;
      /* 位置小于 1 秒时多半也是重新加载引发的 pause，不是访客暂停 */
      if ((el.currentTime || 0) < 1) return;
      writeState();                   /* 访客真的按了暂停：记一下位置与「不在播」 */
    };
    var onEnded = function (event) {
      if (!holdsCurrent(event.target)) return;
      playNext();                                 /* 歌单只有一首时，效果就是循环播放 */
    };
    /* 播放失败（文件坏了 / 网络断了）：**
       1) 我们主动清掉 src（还没开始放）时也会触发 error —— 那不是真失败，直接忽略；
       2) 真的播不出来 → 标成失败 + **绕过缓存重新下载一份**，然后试下一首，别让音乐停在那里。 */
    var onError = function (event) {
      var el = event.target;
      if (!holdsCurrent(el)) return;                         /* 别的元素的杂音事件忽略 */
      if (!el.getAttribute('src')) return;                   /* 没装载任何音源时的 error 是假的 */
      /* ⚠️ 关键分支：我们正等着「续播这一首」（自动续播被系统挡住、等访客点一下）。
         这时候的 error 多半是「iOS 在没有手势时不肯加载这个音源」，不是文件坏了。
         此时**绝对不能 playNext()** —— 一换歌就等于把续播位置丢掉，
         访客过一会儿再点就只能从头播（这正是「等一会儿再点变成从头开始」的原因）。
         正确做法：保住意图、保住位置，提示继续亮着，并顺手重下一份干净的。 */
      if (resumeWantPlay && !bgmStarted && !el.__bgmReloaded) {
      logEv('error：正等续播 → 保住位置，不换歌');
        setBgmPlaying(false);
        armResumeGesture();
        el.__bgmReloaded = true;                           /* 只强下一次，别死循环 */
        var ri = current;
        if (ri >= 0 && playlist[ri]) download(ri, 1, true);
        return;
      }
      bgmErrors++;
      var idx = current;
      if (idx >= 0 && playlist[idx]) {
        var wasLoading = playlist[idx].state === 'loading';
        playlist[idx].state = 'error';
        renderItemState(idx);
        if (!wasLoading) download(idx, 1, true);     /* 强制重新下载一份干净的 */
      }
      setBgmPlaying(false);
      if (!playlist.length || bgmErrors >= playlist.length) {
        toast('音乐播放失败了，稍后再试试');
        return;
      }
      playNext();
    };
    els.forEach(function (el) {
      el.addEventListener('playing', markPlaying);
      el.addEventListener('timeupdate', markPlaying);
      el.addEventListener('timeupdate', updateProgress);        /* 进度条：播放中约每秒 4 次 */
      el.addEventListener('durationchange', updateProgress);    /* 读到元数据才知道总时长 */
      el.addEventListener('loadedmetadata', updateProgress);
      el.addEventListener('pause', onPause);
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onError);
    });
    /* 离开页面时把状态存下来。**只挂 pagehide，不挂 beforeunload**：
       - pagehide 在手机（iOS）和桌面都可靠，且是 bfcache 流程里最后一个一定会触发的事件；
       - beforeunload 是 bfcache 的历史杀手（web.dev 原话：「以前会让页面失去 bfcache 资格，
         现在虽然不再一定，但仍然不可靠，除非绝对必要否则别用」）。
         少了它，Chrome/Edge 更愿意把页面放进前进后退缓存 ——
         而 bfcache 恢复时**用户的播放授权还在**，回退后就能直接接着播，不用点那一下。
         我们本来也没有「未保存内容要提醒」这种需求，所以它纯属多余。
       先立起 leaving：之后那个「移除播放器引发的 pause」就不会污染状态了。 */
    window.addEventListener('pagehide', function () { leaving = true; writeState(); });
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) { writeState(); return; }
      /* 回到前台再试一次自动续播：手机浏览器经常在这个时刻才允许（或再次拒绝）。
         被拒的话 armResumeGesture 会把「点一下继续播放」的提示重新亮起来。 */
        if (resumeWantPlay && !isIOS) tryResume();
    });

    /* 从浏览器的「前进 / 后退缓存」（bfcache）回来时，页面**不会重新执行** ——
       播放器还停在离开时那一秒，而另一页可能早就播到别处了；
       它接着播还会把旧进度写回状态、把正确进度覆盖掉（这就是「按回退进度就不同步」）。
       所以这里重新对齐一次：同一首歌、同一进度、以及「该不该在播」。 */
    var syncFromState = function () {
      var st = readState();
      if (!st) return;
      forcePausedUntil = 0;                                       /* 重新对齐前先解除旧的「按住」 */
      var idx = -1;
      for (var i = 0; i < playlist.length; i++) {
        if (playlist[i].src === st.src) { idx = i; break; }
      }
      if (idx < 0) return;                                        /* 歌单里已经没有这首了 */
      var want = (typeof st.time === 'number' && st.time > 1) ? st.time : 0;
      var shouldPlay = st.playing === true;
      /* ⚠️ 这里必须用 elForCurrent()：真正装着这首歌的可能是备用元素。
         以前用 active()，一旦两者不一致 loaded 就是 false：
         「位置已经对上」的提前返回永远不成立，还会走错分支把好位置重置掉 ——
         这正是「回退 / 前进后进度对不上」的主要来源之一。 */
      var el = elForCurrent();
      var loaded = !!(el && elHas(el, playlist[idx].src));
      var off = loaded ? Math.abs((el.currentTime || 0) - want) : 999;
      var playingNow = !!(el && !el.paused);
      /* 这三项必须在任何提前返回之前设好：
         否则下次点播放会从 0 秒（或旧的秒数）开始，而不是上次停下那一秒。 */
      var prev = current;
      current = idx;
      resumeTime = want;
      resumeWantPlay = shouldPlay;
      /* 备份续播意图（只有真的按这个位置播起来、或访客明确换歌才清） */
      if (want > 0 || shouldPlay) pendingResume = { src: playlist[idx].src, time: want };
      if (loaded && off < 5 && shouldPlay === playingNow) {
        /* 位置和状态都已经对上，不用动播放；但界面必须跟上 ——
           bfcache 恢复后浏览器常常自己接着播，而 bgmStarted 还是 false，
           那样主按钮显示「播放」，点一下反而变成「再播一次」而不是暂停。 */
        if (playingNow) setBgmPlaying(true);
        else if (prev !== idx) updateNow();
        return;
      }
      if (shouldPlay) {
        /* 按回退 / 前进是访客的主动操作，这里的 play() 一般会被允许；
           万一被拒（自动播放策略），等访客点一下就接着播 */
        var pr = playIndex(idx, false, want);
        if (pr && pr.catch) {
          pr.catch(function (err) { autoplayFailed(err); });
        }
        return;
      }
      /* 状态说「暂停着」：把位置对齐，并且**按住一小段时间** ——
         浏览器从缓存恢复页面时可能自己把媒体接着播，那就立刻再暂停回去。 */
      forcePausedUntil = Date.now() + 3000;
      for (var k = 0; k < els.length; k++) { try { els[k].pause(); } catch (e2) {} }
      setBgmPlaying(false);
      /* 位置对齐也交给 seekTo：它会在元数据到达后补一次。
         如果这首还没装载进任何元素，就先塞进备用元素（下次点播放几乎立刻出声），
         —— 此时「装当前这首的」是 standby，所以 el 要用 elForCurrent() 重新取，
            否则会往已经装着这首歌的元素里重复赋 src，把位置冲成 0。 */
      var target = elForCurrent();
      if (target && elHas(target, playlist[idx].src)) seekTo(target, want, playlist[idx].src);
      else { try { loadInto(standby(), playlist[idx].src); } catch (e4) {} }
      updateNow();
    };
    window.addEventListener('pageshow', function (event) {
      leaving = false;                /* 页面又活了：之后的 pause 要照常记录 */
      if (!event.persisted) return;   /* 正常加载：初始化时已经对齐过了 */
      syncFromState();
    });

    /* ---------- 音量 ---------- */
    var savedVol = null;
    var savedOrder = null;
    try {
      savedVol = parseInt(localStorage.getItem('bgmVol'), 10);
      savedOrder = localStorage.getItem('bgmOrder');
    } catch (e) {}
    var vol = (savedVol >= 0 && savedVol <= 100) ? savedVol : 40;   /* 默认四成，不吓人 */
    /* 每次播放前都会再调一次 applyVolume()，避免音量被别的地方改掉 */
    var applyVolume = function () {
      for (var i = 0; i < els.length; i++) els[i].volume = vol / 100;
    };
    applyVolume();
    /* iOS（iPhone / iPad 上的所有浏览器都是 WebKit）**会忽略 volume**：
       设了不报错、读回来也还是你刚设的值 —— 但声音大小完全由设备音量键决定。
       所以「设完读回来」这一招在 iOS 上会误判成「支持」，必须再加一条 UA 判断
       （这正是之前手机上看得到音量条、划了却毫无反应的原因）。 */
    var isIOS = (function () {
      var ua = navigator.userAgent || '';
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      /* iPadOS 13+ 会把自己伪装成 macOS：靠「是 Mac 且有触摸点」认出来 */
      return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    })();
    var volumeWorks = !isIOS && Math.abs(bgm.volume - vol / 100) < 0.03;
    var volValueEl = doc.getElementById('bgmVolValue');
    var volHintEl = doc.getElementById('bgmVolHint');
    var showVol = function () { if (volValueEl) volValueEl.textContent = vol + '%'; };
    /* 已调部分的颜色：和进度条同一套做法（把百分比写进 CSS 变量，样式那边用它切分颜色） */
    var paintVol = function () { if (volRange) volRange.style.setProperty('--bgm-vol-fill', vol + '%'); };
    if (volWrap) {
      if (!volumeWorks) {
        /* 不支持就让滑块让位给一句提示，而不是摆一个划了没反应的控件 */
        if (volRange) volRange.hidden = true;
        if (volValueEl) volValueEl.hidden = true;
        if (volHintEl) volHintEl.hidden = false;
        volWrap.classList.add('is-fixed');
      } else if (volRange) {
        if (volHintEl) volHintEl.hidden = true;
        volRange.value = String(vol);
        showVol();
        paintVol();
        volRange.addEventListener('input', function () {
          var v = parseInt(volRange.value, 10);
          if (!(v >= 0)) v = 0;
          if (v > 100) v = 100;
          vol = v;
          applyVolume();
          showVol();
          paintVol();
          try { localStorage.setItem('bgmVol', String(v)); } catch (e) {}
        });
      }
    }
    setOrder(savedOrder === 'sequence' ? 'sequence' : 'shuffle', false);

    /* ---------- 找歌单 ---------- */
    var MAX_TRACKS = 30;
    var probeNumbered = function () {
      var found = [];
      var step = function (n) {
        if (n > MAX_TRACKS) return Promise.resolve(found);
        return fetch('audio/bgm-' + n + '.mp3', { method: 'HEAD' }).then(function (res) {
          if (!res || !res.ok) return found;
          found.push('audio/bgm-' + n + '.mp3');
          return step(n + 1);
        });
      };
      return step(1).catch(function () { return found; });
    };
    var toSongs = function (raw) {
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var item = raw[i];
        if (typeof item === 'string') {
          out.push({ src: item, title: item.replace(/^.*\//, '').replace(/\.[^.]+$/, ''), artist: '' });
        } else if (item && item.src) {
          out.push({
            src: item.src,
            title: item.title || item.src.replace(/^.*\//, '').replace(/\.[^.]+$/, ''),
            artist: item.artist || '',
            isDefault: item.default === true   /* 歌单里标 "default": true 的那首是默认曲 */
          });
        }
      }
      return out;
    };
    var findPlaylist = function () {
      return fetch('audio/playlist.json', { cache: 'no-cache' })
        .then(function (res) {
          if (!res || !res.ok) return null;
          return res.json().then(toSongs).catch(function () { return null; });
        })
        .catch(function () { return null; })
        .then(function (fromJson) {
          if (fromJson && fromJson.length) return fromJson;
          return probeNumbered().then(function (urls) {
            if (urls.length) {
              return urls.map(function (u, i) { return { src: u, title: '第 ' + (i + 1) + ' 首', artist: '' }; });
            }
            /* 退回单曲：HTML 里 <audio src="..."> 写的那一首 */
            var single = bgm.getAttribute('src');
            return fetch(single, { method: 'HEAD' })
              .then(function (res) { return (res && res.ok) ? [{ src: single, title: '第 1 首', artist: '' }] : []; })
              .catch(function () { return []; });
          });
        });
    };

    /* ---------- 一进网站就把整个歌单下载好 ----------
       等页面加载完再开始（绝不拖慢页面），逐首依次下载，不和页面资源抢带宽。
       默认曲排在最前面先下，让「点播放」最快可用。
       代价：歌单有 N 首，访客一进站就下载 N × 单曲大小 —— 用流量换「点了立刻响」。
       慢网（2G/3G）与「节省流量」模式不预热；那时所有歌都能点，边下边播。
       想彻底关掉：把下面 startWarm(); 那一行删掉即可。 */
    var shouldWarm = function () {
      if (typeof window.fetch !== 'function' || typeof Promise !== 'function') return false;
      if (navigator.connection) {
        if (navigator.connection.saveData) return false;                     /* 省流量模式 */
        var eff = navigator.connection.effectiveType;
        if (eff === 'slow-2g' || eff === '2g' || eff === '3g') return false;  /* 慢网 */
      }
      return true;
    };
    /* 带超时的 fetch：30 秒还没完就中断，交给重试逻辑。
       noCache = true 时绕过缓存重新拉一份（用于「播不出来的就重新下载」）。 */
    var fetchWithTimeout = function (url, ms, noCache) {
      var opts = { cache: noCache ? 'reload' : 'force-cache' };
      if (typeof AbortController !== 'function') return fetch(url, opts);
      var ctrl = new AbortController();
      opts.signal = ctrl.signal;
      var timer = setTimeout(function () { ctrl.abort(); }, ms);
      return fetch(url, opts)
        .then(function (res) { clearTimeout(timer); return res; })
        .catch(function (err) { clearTimeout(timer); throw err; });
    };
    /* 只问浏览器缓存：已经有这首就直接算「下载好了」—— 不走网络，也不用把整首再读一遍。
       这样老访客第二次进站几乎是瞬间把所有歌标成 ✓，一个字节都不重新下载。 */
    var fromCacheOnly = function (url) {
      try {
        return fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })
          .then(function (res) {
            if (res && res.ok) return true;
            throw new Error('not-cached');
          });
      } catch (e) {
        return Promise.reject(e);
      }
    };
    /* 缓存里没有：真正下载整首（读完整首才算完），下载会写进浏览器缓存供下次使用。
       force = true 时绕过缓存重新拉一份，覆盖掉可能坏掉的旧副本。 */
    var fetchFull = function (url, force) {
      return fetchWithTimeout(url, WARM_TIMEOUT, force).then(function (res) {
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        return res.blob().then(function () { return true; });
      });
    };
    /* 下载一首：先查缓存，再真下；失败或超时都重试，退避 1s → 2s → 4s，用完次数才标记失败 */
    var download = function (index, attempt, force) {
      var song = playlist[index];
      if (!song) return Promise.resolve();
      /* ★ 同一首歌已经在下载了，就别再起一个请求。
         暖场队列与「按播放时插队下载」可能先后点到同一首，
         两个请求会互相抢带宽、反而更慢（而且都没有防重）。
         force 是「强制重下」（下载失败后重试），那种情况要放行。 */
      if (song.state === 'loading' && !force) return Promise.resolve();
      song.state = 'loading';
      renderItemState(index);
      var job = force
        ? fetchFull(song.src, true)                          /* 强制重新下载（绕过缓存） */
        : fromCacheOnly(song.src).catch(function () { return fetchFull(song.src, false); });
      return job
        .then(function () {
          song.state = 'ready';
          renderItemState(index);
          markDone(song.src);        /* 记住：本标签页里这首已经下好了 */
          if (force) {
            /* 重新下好了：让持有这首的元素重新加载这份新的
               （之前播不出来，很可能就是旧数据坏了） */
            for (var k = 0; k < els.length; k++) {
              if (elHas(els[k], song.src)) { try { els[k].__bgmLoadedAt = Date.now(); els[k].load(); } catch (e) {} }
            }
          }
          preloadAhead();     /* 刚下好的如果正好是「下一首」，就顺手预备进备用元素 */
          /* 跨页面续播：上次在别的页面正在播的就是这首 → 下载完接着播（含位置） */
          tryResume();
          /* 访客正在等的就是这首 → 下载完立刻自动播放。
             队列里永远只有一首（最后一次点击覆盖前一次），所以不会同时播两首，
             也不会跑去播更早点过的那首。 */
          if (pendingPlay === index) {
            pendingPlay = -1;
            /* ★ 已经在出声了就别重播 —— 否则会把正在播的这首拽回 0 秒。
               （访客按播放时是边下边播，下载完成刚好赶上时就会撞上这种情况。） */
            if (bgmStarted || isReallyPlaying()) { updateNow(); return; }
            var pr = playIndex(index);     /* 记进播放历史，否则「上一首」会跳错 */
            /* iOS 等平台可能拒绝这种「不是直接点击触发」的播放：
               别只弹一句提示就完事 —— 顺手借「点一下就播」这套机制，
               让访客随便点一下页面（不用特意去点播放按钮）就能播这首。 */
            if (pr && pr.catch) {
              pr.catch(function () {
                if (!resumeWantPlay) {
                  resumeWantPlay = true;
                  resumeTime = 0;          /* 这首是从头播，不是续播位置 */
                }
                armResumeGesture();
                toast('已经下载好了，点一下播放');
              });
            }
          }
        })
        .catch(function () {
          if (attempt < WARM_TRIES) {
            var wait = 1000 * Math.pow(2, attempt - 1);
            return new Promise(function (resolve) { setTimeout(resolve, wait); })
              .then(function () { return download(index, attempt + 1, force); });
          }
          song.state = 'error';
          renderItemState(index);
          if (pendingPlay === index) {
            pendingPlay = -1;
            updateNow();
            toast('这首歌下载失败了，点一下可以重新下载');
          }
        });
    };
    /* 失败的再自动重来（最多 2 轮，每轮隔 15 秒），没人点它也能自己恢复 */
    var failedIndexes = function () {
      var out = [];
      for (var i = 0; i < playlist.length; i++) if (playlist[i].state === 'error') out.push(i);
      return out;
    };
    var runQueue = function (list) {
      var n = 0;
      var step = function () {
        if (n >= list.length) {
          warmStatus = '';
          updateNow();
          preloadAhead();
          var left = failedIndexes();
          if (left.length && warmRound < 2) {
            warmRound++;
            setTimeout(function () { if (warmOn) runQueue(failedIndexes()); }, 15000);
          } else if (left.length) {
            toast('有几首歌没下载好，点一下可以重试');
          }
          return;
        }
        var idx = list[n++];
        /* ready 或正在下载的都跳过，避免同一首被同时下载两次 */
        if (playlist[idx].state === 'ready' || playlist[idx].state === 'loading') { step(); return; }
        warmStatus = '正在后台准备 ' + playlist[idx].title + '（' + n + '/' + list.length + '）';
        updateNow();
        download(idx, 1).then(function () { updateNow(); step(); });
      };
      step();
    };
    var retryFailed = function () {
      if (!warmOn) return;
      var list = failedIndexes();
      if (list.length) runQueue(list);
    };
    var warmQueue = function () {
      if (!playlist.length || !warmOn) return;
      var queue = [];
      if (current >= 0) queue.push(current);     /* 先把「上次在播 / 默认选中」的那首准备好 */
      for (var d = 0; d < playlist.length; d++) {
        if (playlist[d].isDefault && queue.indexOf(d) < 0) { queue.push(d); break; }
      }
      for (var i = 0; i < playlist.length; i++) if (queue.indexOf(i) < 0) queue.push(i);
      runQueue(queue);
    };
    var startWarm = function () {
      if (!warmOn) return;
      /* ★ 当前（或默认选中）那首要**立刻**开始下载。
         以前要等页面 load 事件、再等 600ms 才轮到它 —— 访客点播放时它往往还没下完，
         于是首帧要边下边播、还和下载抢连接，感觉就像「点了没反应，得再点一下」。
         现在只把这一首提前插队立刻下；其余的歌仍然等 load 之后慢慢来。 */
      if (current >= 0 && playlist[current] && playlist[current].state !== 'ready') {
        runQueue([current]);
      }
      var go = function () { setTimeout(warmQueue, 600); };
      if (doc.readyState === 'complete') go();
      else window.addEventListener('load', go, { once: true });
    };

    if (typeof window.fetch === 'function') {
      findPlaylist().then(function (songs) {
        if (!songs || !songs.length) return;   /* 一首都没有：不显示按钮 */
        playlist = songs;
        /* 歌单里标了 "default": true 的那首是默认曲：列表里先高亮，访客点播放就从它开始。
           （浏览器不允许自动出声，"默认播放" 只能是 "默认选中的第一首"。） */
        for (var i = 0; i < playlist.length; i++) {
          if (playlist[i].isDefault) { current = i; break; }
        }
        /* ★ 这次是「刷新页面」进来的吗？刷新的语义是**重新开始**：
           应该回到默认曲（歌单里标 default 的那首），而不是接着上一次那首。
           —— 只有站内跳转 / 后退前进才继续上一首（那才是「跨页续播」要管的事）。
           不这样区分的话，访客每次按 F5 都会停在上一首上，永远回不到默认曲。 */
        if (isReloadPage()) {
          try { sessionStorage.removeItem(STATE_KEY); } catch (e) {}
          logEv('刷新进入：回到默认曲');
        } else {
          /* 上次（同一个标签页）在别的页面播的是哪首？找回来 —— 歌单里还有的话。
             这样首页 ↔ 文章页来回切换时，选中的歌和播放进度都是一致的。 */
          var st = readState();
          if (st) {
            for (var si = 0; si < playlist.length; si++) {
              if (playlist[si].src === st.src) {
                current = si;
                resumeTime = (typeof st.time === 'number' && st.time > 1) ? st.time : 0;
                resumeWantPlay = st.playing === true;
              /* 备份续播意图：之后任何路径把 resumeTime 清了，点播放时还能回到这一秒 */
              if (resumeTime > 0 || resumeWantPlay) pendingResume = { src: st.src, time: resumeTime };
              logEv('初始化读到状态 t=' + (Math.round(resumeTime * 10) / 10) + ' play=' + resumeWantPlay);
              break;
            }
          }
        }
        }
        warmOn = shouldWarm();     /* 必须在画列表之前定下来：不预热时所有歌都能点 */
        /* 把 HTML 里那个兜底 src 清掉（findPlaylist 已经用它做过判断了）。
           否则「当前元素」名义上已经装载了默认曲，备用元素的预加载会被跳过，
           第一次点播放就得在没缓冲过的元素上现加载 —— 那正是可见延迟的来源。 */
        if (warmOn) {
          try { bgm.__bgmLoadedAt = Date.now(); bgm.removeAttribute('src'); bgm.load(); } catch (e) {}
        }
        /* 本标签页下载过的歌：先记下候选，然后**核实**（只查缓存，不读文件不走网络）。
           核实到的标 ✓；核实不到的当「没下载」，交给预热队列补下。
           核实完再画列表，所以图标一出现就是准的。 */
        var hinted = [];
        var doneList = readDone();
        for (var di = 0; di < playlist.length; di++) {
          if (doneList.indexOf(playlist[di].src) >= 0) hinted.push(di);
        }
        verifyDone(hinted).then(function (verified) {
          for (var hi = 0; hi < hinted.length; hi++) {
            var idx = hinted[hi];
            var hit = !verified;                     /* verified === null：没法核实，先信名单 */
            if (verified) {
              for (var vi = 0; vi < verified.length; vi++) {
                if (verified[vi].i === idx && verified[vi].hit) { hit = true; break; }
              }
            }
            if (hit) playlist[idx].state = 'ready';
          }
          renderList();
          updateNow();
          showTrigger();
          startWarm();
          if (resumeWantPlay) {
            /* ★ iOS 上**不要**做「没有手势的自动尝试」：它必然被拒，
               而且会把元素弄脏，导致访客之后亲手点也没声音（真机实测）。
               直接把提示亮起来，等访客点一下 —— 那一下才有效。 */
            if (!isIOS) setTimeout(tryResume, 1200);   /* 桌面 / 安卓：试着自动续播 */
            armResumeGesture();            /* 被拒绝时，等访客第一次点击就接着播 */
          }
        });
      }).catch(function () {});
    } else {
      /* 老浏览器没有 fetch：就用 HTML 里写的那一首，能不能播交给 error 事件判断 */
      playlist = [{ src: bgm.getAttribute('src'), title: '第 1 首', artist: '' }];
      renderList();
      updateNow();
      showTrigger();
    }
    setBgmPlaying(false);
  }

  /* ===== 移动端导航 ===== */
  var navBurger = doc.getElementById('navBurger');
  var navMenu = doc.getElementById('navLinks');
  function closeMobileMenu() {
    if (navMenu) navMenu.classList.remove('open');
    if (navBurger) {
      navBurger.setAttribute('aria-expanded', 'false');
      navBurger.setAttribute('aria-label', '打开菜单');
    }
  }
  if (navBurger && navMenu) {
    navBurger.addEventListener('click', function () {
      var open = navMenu.classList.toggle('open');
      navBurger.setAttribute('aria-expanded', open ? 'true' : 'false');
      navBurger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });
    navMenu.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) closeMobileMenu();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 640) closeMobileMenu();
    });
  }

  /* ===== 导航滚动效果（含锚点高亮） ===== */
  var nav = doc.getElementById('nav');
  var backTop = doc.getElementById('backTop');
  var sections = [].slice.call(doc.querySelectorAll('section[id]'));
  var hashLinks = [].slice.call(doc.querySelectorAll('.nav-links a[href^="#"]'));
  /* 所有「站内锚点」都交给 JS 自己平滑滚动（导航栏、英雄区按钮、页脚等）。
     为什么不靠浏览器原生跳转：原生跳转会把 #contact 写进网址栏，
     于是刷新页面又会跳回联系我那段 —— 访客要的是「滚过去」，不是「换个网址」。
     跳过「跳到主要内容」：那是给键盘 / 读屏用的，需要浏览器原生把焦点移过去。 */
  var scrollLinks = [].slice.call(doc.querySelectorAll('a[href^="#"]')).filter(function (a) {
    var h = a.getAttribute('href') || '';
    return h.length > 1 && !a.classList.contains('skip-link');
  });
  var sectionTops = [];
  function measureSections() {
    sectionTops = sections.map(function (s) { return s.offsetTop; });
  }
  measureSections();
  window.addEventListener('load', measureSections);
  var measureTimer = null;
  window.addEventListener('resize', function () {
    if (measureTimer) clearTimeout(measureTimer);
    measureTimer = setTimeout(measureSections, 150);
  });
  var scrollPending = false;
  function onScroll() {
    scrollPending = false;
    var y = window.scrollY;
    if (nav) nav.classList.toggle('scrolled', y > 50);
    if (backTop) backTop.classList.toggle('visible', y > 600);
    if (!hashLinks.length) return;
    var current = '';
    for (var i = 0; i < sections.length; i++) {
      if (y >= sectionTops[i] - 100) current = sections[i].getAttribute('id');
    }
    if (sections.length && window.innerHeight + y >= doc.body.offsetHeight - 80) {
      current = sections[sections.length - 1].getAttribute('id');
    }
    for (var j = 0; j < hashLinks.length; j++) {
      var on = hashLinks[j].getAttribute('href') === '#' + current;
      hashLinks[j].classList.toggle('active', on);
    }
  }
  window.addEventListener('scroll', function () {
    if (!scrollPending) { scrollPending = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* ===== 返回顶部 ===== */
  if (backTop) {
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ===== 露出动画（IntersectionObserver，老浏览器降级直接显示） ===== */
  var observer = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }) : null;
  window.revealObserve = function (el) {
    if (observer) observer.observe(el);
    else el.classList.add('visible');
  };
  var staticReveals = [].slice.call(doc.querySelectorAll('.reveal'));
  for (var r = 0; r < staticReveals.length; r++) window.revealObserve(staticReveals[r]);

  /* ===== 平滑滚动（所有站内锚点：导航栏 / 英雄区按钮 / 页脚）=====
     只滚动、**不写网址** —— 网址里没有 #contact，刷新就不会又跳回联系我那段。 */
  scrollLinks.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var hash = this.getAttribute('href') || '';
      /* 用 getElementById 而不是 querySelector(hash)：锚点内容怪一点也不会抛异常 */
      var target = hash.length > 1 ? doc.getElementById(hash.slice(1)) : null;
      if (target) {
        var targetTop = target.getBoundingClientRect().top + window.pageYOffset - 80;   /* 别叫 top */
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
      }
    });
  });

  /* 从别处带着 #锚点 进来时（例如文章页那个「联系」链接 index.html#contact）：
     我们照旧滚到那一段，但**把网址里的 #锚点 清掉** ——
     否则访客一刷新又会被弹回联系我，这正是他提的另一个问题。 */
  (function () {
    var incoming = (window.location.hash || '').length > 1 ? window.location.hash.slice(1) : '';
    if (!incoming || !doc.getElementById(incoming)) return;
    var go = function () {
      var t = doc.getElementById(incoming);
      if (t) {
          var targetTop2 = t.getBoundingClientRect().top + window.pageYOffset - 80;
          window.scrollTo({ top: targetTop2, behavior: 'smooth' });
      }
        /* ⚠️ 必须写 window.history：本文件里有一个播放历史数组 played，
           而它以前叫 history —— 那个名字会遮蔽 window.history，
           导致这里的 replaceState 是 undefined、整段静默失效。 */
      if (window.history && window.history.replaceState) {
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
      }
    };
    if (doc.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  })();

  /* ===== 页脚年份自动更新 ===== */
  var yearEls = [].slice.call(doc.querySelectorAll('.footer-year'));
  var thisYear = String(new Date().getFullYear());
  for (var yi = 0; yi < yearEls.length; yi++) yearEls[yi].textContent = thisYear;

  /* ===== 入场动画的看门狗 =====
     导航栏（连首屏文字）的入场由 <html class="app-ready"> 触发，那个类是 index.html
     自己的脚本在最后加的。万一那段脚本没跑到（报错、被拦截、扩展干扰），
     这些东西会**永远停在 opacity:0** —— 导航栏整个看不见。
     这里兜一下：过一会儿还没有这个类，就自己加上。 */
  setTimeout(function () {
    var root = doc.documentElement;
    if (!root.classList.contains('app-ready')) root.classList.add('app-ready');
  }, 1200);

  /* ===== Service Worker 注册 ===== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }
})();
