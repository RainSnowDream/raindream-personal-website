/* RainDream · 雨梦 — 共享交互逻辑（index.html 与 blog.html 共用）
   负责：主题切换、背景音乐播放/暂停、移动端导航、导航滚动、返回顶部、露出动画、
   平滑滚动、页脚年份、Service Worker 注册。页面专属脚本仍留在各自的 <script> 里。 */
(function () {
  'use strict';
  var doc = document;

  /* ===== 主题切换 ===== */
  var themeToggle = doc.getElementById('themeToggle');
  function applyTheme(n) {
    doc.documentElement.setAttribute('data-theme', n);
    if (themeToggle) themeToggle.setAttribute('aria-checked', n === 'dark' ? 'true' : 'false');
    if (window.__setThemeColor) window.__setThemeColor();
  }
  function setTheme(n) {
    applyTheme(n);
    try { localStorage.setItem('theme', n); } catch (e) {}
  }

  if (themeToggle) {
    themeToggle.setAttribute('aria-checked', doc.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
    /* 主题是 350ms 之后才真正生效的，所以连点时要以上一次「待生效」的目标为基准；
       否则第二次点击读到的还是旧主题，会切到同一个值（等于只有一次生效）。 */
    var pendingTheme = null;
    themeToggle.addEventListener('click', function () {
      var current = pendingTheme || doc.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      pendingTheme = next;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTheme(next);
        pendingTheme = null;
        return;
      }
      /* 连点时把上一个还没消失的圆清掉，避免叠在一起 */
      var prevCircle = doc.querySelector('.theme-circle');
      if (prevCircle && prevCircle.parentNode) prevCircle.parentNode.removeChild(prevCircle);
      var rect = themeToggle.getBoundingClientRect();
      var size = Math.hypot(window.innerWidth, window.innerHeight) * 2;
      var circle = doc.createElement('div');
      circle.className = 'theme-circle';
      circle.style.width = size + 'px';
      circle.style.height = size + 'px';
      circle.style.left = (rect.left + rect.width / 2 - size / 2) + 'px';
      circle.style.top = (rect.top + rect.height / 2 - size / 2) + 'px';
      doc.body.appendChild(circle);
      requestAnimationFrame(function () { circle.style.transform = 'scale(1)'; });
      setTimeout(function () { setTheme(next); pendingTheme = null; circle.style.opacity = '0'; }, 350);
      setTimeout(function () { circle.remove(); }, 700);
    });

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
       浏览器开始播一首新歌前必须先把音源加载并校验一遍（即使文件已在缓存里，
       我们的响应头是 must-revalidate，可能还要一次往返），所以切歌会有可见延迟。
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
    var playlist = [];          /* [{src, title, artist, state}] */
    var current = -1;
    var warmStatus = '';        /* 「正在后台准备音乐 2/5」这类提示 */
    var history = [];           /* 播放历史，用来实现「上一首」 */
    var historyPos = -1;
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
    var resumeTime = 0;           /* 要恢复到的位置（秒）；0 = 不用恢复 */
    var resumeWantPlay = false;   /* 上次在别的页面正在播吗 */
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
    var writeState = function () {
      if (current < 0 || !playlist[current]) return;
      var el = active();
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
          src: playlist[current].src,
          title: playlist[current].title,
          time: el && el.currentTime ? el.currentTime : 0,
          playing: !!(el && !el.paused)
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
      '<div class="bgm-vol" id="bgmVol">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12z"/></svg>' +
      '<input class="bgm-vol-range" id="bgmVolume" type="range" min="0" max="100" step="5" value="40" aria-label="音量">' +
      '<span class="bgm-vol-value" id="bgmVolValue">40%</span>' +
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
        ? (bgmStarted ? '正在播放 ' : (pendingPlay === current ? '等待下载 ' : '准备播放 '))
        : '';
      var full = song
        ? label + song.title + (song.artist ? ' · ' + song.artist : '')
        : (warmStatus || '还没开始播放');
      nowEl.title = full;
      if (song) {
        nowEl.innerHTML = esc(label) + '<b class="bgm-now-text">' + esc(song.title) + '</b>' +
          (song.artist ? '<span class="bgm-now-artist"> · ' + esc(song.artist) + '</span>' : '');
      } else {
        nowEl.innerHTML = '<span class="bgm-now-text">' + esc(full) + '</span>';
      }
      markList();      /* 高亮必须跟着 current 走 —— 以前只在播放事件里刷，切歌时高亮会停在旧的那首 */
      syncScroll();
    };
    var setBgmPlaying = function (playing) {
      bgmStarted = playing;
      bgmToggle.classList.toggle('is-playing', playing);
      bgmToggle.setAttribute('aria-label', playing ? '暂停音乐' : '音乐');
      if (mainBtn) {
        mainBtn.classList.toggle('is-playing', playing);
        mainBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
      }
      updateNow();      /* 它里面会重画列表高亮，也会把「准备播放」切成「正在播放」 */
    };
    var showTrigger = function () {
      if (triggerShown) return;
      triggerShown = true;
      bgmToggle.hidden = false;
    };

    /* ---------- 播放控制 ---------- */
    /* startAt > 0 时会先把播放位置设到那里再开始播（跨页面续播用） */
    var playIndex = function (index, record, startAt) {
      if (index < 0 || index >= playlist.length) return;
      pendingPlay = -1;                     /* 已经在放这首了，队列清掉 */
      if (record !== false) {
        history = history.slice(0, historyPos + 1);   /* 丢掉「上一首」之后的分支 */
        history.push(index);
        historyPos = history.length - 1;
      }
      current = index;
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
        el.src = url;
      }
      updateNow();                          /* 高亮跟着 current 走，不再依赖播放事件 */
      writeState();
      var begin = function () {
        applyVolume();                      /* 每次播放前重申音量，避免被别处改掉 */
        var p = el.play();                  /* 先播，绝不等待 —— 等待有可能永远等不到 */
        if (startAt > 0) {
          /* 尽量把位置设回上次那里：元数据还没就绪就等它一下，但**不阻塞播放** */
          var seek = function () { try { el.currentTime = startAt; } catch (e) {} };
          if (el.readyState >= 1) {
            seek();
          } else {
            el.addEventListener('loadedmetadata', function once() {
              el.removeEventListener('loadedmetadata', once);
              seek();
            });
          }
        }
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
      el.src = song.src;                    /* preload="auto"：它会自己在后台缓冲 */
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
    var requestPlay = function (index) {
      if (index < 0 || index >= playlist.length) return;
      resumeWantPlay = false;   /* 访客自己点了：不再自动续播上次那首 */
      resumeTime = 0;
      current = index;
      if (canPlay(index)) {
        playIndex(index);
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
      if (order === 'sequence') {
        requestPlay(((current - 1) % playlist.length + playlist.length) % playlist.length);
        return true;
      }
      if (historyPos > 0) {
        historyPos--;
        requestPlay(history[historyPos]);
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
      requestPlay(current >= 0 ? current : 0);
      return true;
    };
    var togglePlay = function () {
      if (bgmStarted) {                                     /* 暂停：排队的也一起取消 */
        pendingPlay = -1;
        active().pause();                                   /* 注意：真正在播的可能是备用元素 */
        updateNow();
        return;
      }
      if (current < 0) { playNext(); return; }              /* 还没开始过：挑一首 */
      if (!canPlay(current)) {                              /* 还没下载完：排队，下好自动播 */
        pendingPlay = current;
        updateNow();
        toast('这首歌还没下载完，下载好会自动播放');
        return;
      }
      resumeWantPlay = false;                               /* 访客手动点了播放 */
      var at = resumeTime;
      resumeTime = 0;
      var el = active();
      if (elHas(el, playlist[current].src)) {               /* 已经装载好这首：接着放 */
        if (at > 1) { try { el.currentTime = at; } catch (e) {} }
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        var p2 = playIndex(current, false, at);              /* 默认曲还没装载过 */
        if (p2 && p2.catch) p2.catch(function () {});
      }
    };

    /* ---------- 跨页面续播 ---------- */
    /* 浏览器不肯替我们自动出声时：等访客在本页第一次点击 / 按键，就接着播上次那首。
       点的是「会跳走的链接」时不算 —— 那一下马上就要换页了。 */
    var armResumeGesture = function () {
      if (!resumeWantPlay) return;
      var disarm = function () {
        doc.removeEventListener('pointerdown', onGesture, true);
        doc.removeEventListener('click', onGesture, true);
        doc.removeEventListener('keydown', onGesture, true);
      };
      var onGesture = function (event) {
        if (!resumeWantPlay) { disarm(); return; }
        var t = event.target;
        var a = t && t.closest ? t.closest('a[href]') : null;
        if (a) {
          var href = a.getAttribute('href') || '';
          if (href.charAt(0) !== '#' && !(a.target && a.target !== '_self')) return;
        }
        if (!canPlay(current)) return;        /* 还没下载好：这次手势不算，继续等 */
        disarm();
        tryResume();
      };
      doc.addEventListener('pointerdown', onGesture, true);
      doc.addEventListener('click', onGesture, true);
      doc.addEventListener('keydown', onGesture, true);
    };
    /* 接着播上次那首（位置也恢复）；被浏览器拒绝就把状态留着，等下一次手势 */
    var tryResume = function () {
      if (!resumeWantPlay || current < 0) return;
      if (!canPlay(current)) return;          /* 还没下载完：它下好了会自动来续播 */
      resumeWantPlay = false;
      var startAt = resumeTime;
      resumeTime = 0;
      var pr = playIndex(current, false, startAt);
      if (pr && pr.catch) {
        pr.catch(function () {
          resumeWantPlay = true;
          resumeTime = startAt;
          armResumeGesture();
          toast('点一下继续播放上次那首');
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

    var markPlaying = function (event) {
      if (event.target !== active()) return;      /* 备用元素的杂音事件一律忽略 */
      bgmErrors = 0;
      if (!bgmStarted) setBgmPlaying(true);
      showTrigger();
      preloadAhead();                             /* 开播后顺手把下一首预备好 */
      saveThrottled();                            /* 每 2 秒记一次进度，供换页后续播 */
    };
    var onPause = function (event) {
      if (event.target !== active()) return;
      setBgmPlaying(false);
      /* 注意：页面离开时浏览器移除播放器也会触发 pause —— 那不是「访客暂停」，
         不能拿它覆盖掉「正在播」的状态，否则换页后就不会自动续播了。 */
      if (!leaving) writeState();      /* 访客真的按了暂停：记一下位置与「不在播」 */
    };
    var onEnded = function (event) {
      if (event.target !== active()) return;
      playNext();                                 /* 歌单只有一首时，效果就是循环播放 */
    };
    /* 播放失败（文件坏了 / 网络断了）：**
       1) 我们主动清掉 src（还没开始放）时也会触发 error —— 那不是真失败，直接忽略；
       2) 真的播不出来 → 标成失败 + **绕过缓存重新下载一份**，然后试下一首，别让音乐停在那里。 */
    var onError = function (event) {
      if (event.target !== active()) return;                 /* 备用元素的杂音事件忽略 */
      if (!event.target.getAttribute('src')) return;         /* 没装载任何音源时的 error 是假的 */
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
      el.addEventListener('pause', onPause);
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onError);
    });
    /* 离开页面时把状态存下来（pagehide 在手机上比 beforeunload 可靠）。
       先立起 leaving：之后那个「移除播放器引发的 pause」就不会污染状态了。 */
    window.addEventListener('pagehide', function () { leaving = true; writeState(); });
    window.addEventListener('beforeunload', function () { leaving = true; writeState(); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) writeState(); });

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
    /* iOS（iPhone / iPad 上的所有浏览器都用 WebKit）会忽略 volume，那边的音量只能由设备音量键控制。
       这里用「设完读回来」判断：读不回来就说明这个平台不支持，那就把音量条藏起来 ——
       不显示一个划了没反应的控件。 */
    var volumeWorks = Math.abs(bgm.volume - vol / 100) < 0.03;
    var volValueEl = doc.getElementById('bgmVolValue');
    var showVol = function () { if (volValueEl) volValueEl.textContent = vol + '%'; };
    if (volWrap) {
      if (!volumeWorks) {
        volWrap.hidden = true;
      } else if (volRange) {
        volRange.value = String(vol);
        showVol();
        volRange.addEventListener('input', function () {
          var v = parseInt(volRange.value, 10);
          if (!(v >= 0)) v = 0;
          if (v > 100) v = 100;
          vol = v;
          applyVolume();
          showVol();
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
              if (elHas(els[k], song.src)) { try { els[k].load(); } catch (e) {} }
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
            var pr = playIndex(index);     /* 记进播放历史，否则「上一首」会跳错 */
            /* iOS 等平台可能拒绝这种「不是直接点击触发」的播放：给明确提示，别静默失败 */
            if (pr && pr.catch) {
              pr.catch(function () { toast('已经下载好了，点一下播放'); });
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
        /* 上次（同一个标签页）在别的页面播的是哪首？找回来 —— 歌单里还有的话。
           这样首页 ↔ 文章页来回切换时，选中的歌和播放进度都是一致的。 */
        var st = readState();
        if (st) {
          for (var si = 0; si < playlist.length; si++) {
            if (playlist[si].src === st.src) {
              current = si;
              resumeTime = (typeof st.time === 'number' && st.time > 1) ? st.time : 0;
              resumeWantPlay = st.playing === true;
              break;
            }
          }
        }
        warmOn = shouldWarm();     /* 必须在画列表之前定下来：不预热时所有歌都能点 */
        /* 把 HTML 里那个兜底 src 清掉（findPlaylist 已经用它做过判断了）。
           否则「当前元素」名义上已经装载了默认曲，备用元素的预加载会被跳过，
           第一次点播放就得在没缓冲过的元素上现加载 —— 那正是可见延迟的来源。 */
        if (warmOn) {
          try { bgm.removeAttribute('src'); bgm.load(); } catch (e) {}
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
            setTimeout(tryResume, 1200);   /* 试着自动接着播（浏览器可能拒绝） */
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

  /* ===== 平滑滚动（仅站内锚点） ===== */
  hashLinks.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var hash = this.getAttribute('href') || '';
      /* 用 getElementById 而不是 querySelector(hash)：锚点内容怪一点也不会抛异常 */
      var target = hash.length > 1 ? doc.getElementById(hash.slice(1)) : null;
      if (target) {
        var top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
        /* 把 #锚点 写进网址栏：这样「跳到某一段」的链接能直接分享，后退键也能逐个回退 */
        if (window.history && history.pushState) {
          try { history.pushState(null, '', hash); } catch (err) {}
        }
      }
    });
  });

  /* ===== 页脚年份自动更新 ===== */
  var yearEls = [].slice.call(doc.querySelectorAll('.footer-year'));
  var thisYear = String(new Date().getFullYear());
  for (var yi = 0; yi < yearEls.length; yi++) yearEls[yi].textContent = thisYear;

  /* ===== Service Worker 注册 ===== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }
})();
