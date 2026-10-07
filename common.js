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
     歌单来源，按优先级：
     1) audio/playlist.json —— 想显示中文歌名就用它（格式见 README）
     2) 依次探测 audio/bgm-1.mp3、bgm-2.mp3……（编号必须连续，最多 30 首）
     3) 退回单曲 audio/bgm.mp3
     顺序随机；「上一首」按播放历史回退；一首放完自动随机换下一首。
     注意：只有访客点播放才会响（浏览器要求用户手势），不点就不下载任何音频。 */
  var bgmToggle = doc.getElementById('bgmToggle');
  var bgm = doc.getElementById('bgm');
  if (bgmToggle && bgm) {
    var bgmStarted = false;     /* 用「真的出声了」判断，不能用 audio.paused */
    var playlist = [];          /* [{src, title, artist, state}] */
    var current = -1;
    var loadedSrc = '';         /* 当前 <audio> 里装载的是哪一首（默认曲可能还没装载） */
    var warmStatus = '';        /* 「正在后台准备音乐 2/5」这类提示 */
    var history = [];           /* 播放历史，用来实现「上一首」 */
    var historyPos = -1;
    var bgmErrors = 0;          /* 连续失败次数，避免死循环 */
    var triggerShown = false;
    var order = 'shuffle';      /* shuffle = 随机播放；sequence = 顺序播放 */
    var warmOn = false;         /* 是否真的在做后台预下载（慢网 / 省流量时不预热） */
    var WARM_TIMEOUT = 30000;   /* 单首超过 30 秒没下完算超时 */
    var WARM_TRIES = 3;         /* 失败或超时最多重试到第 3 次 */

    var esc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      '</div>' +
      '<ol class="bgm-list" id="bgmList"></ol>' +
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
      var locked = warmOn && state !== 'ready' && state !== 'error';
      var hint = song.title + (song.artist ? ' · ' + song.artist : '');
      if (state === 'ready') hint += '（已下载，可以播放）';
      else if (state === 'error') hint += '（下载失败，点击重新下载）';
      else if (locked) hint += '（还在下载，稍等一下）';
      return '<li><button class="bgm-item' + (locked ? ' is-locked' : '') + '" type="button" data-index="' + i + '"' +
        (locked ? ' aria-disabled="true"' : '') + ' title="' + esc(hint) + '">' +
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
      var label = song ? (bgmStarted ? '正在播放 ' : '准备播放 ') : '';
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
    var playIndex = function (index, record) {
      if (index < 0 || index >= playlist.length) return;
      if (record !== false) {
        history = history.slice(0, historyPos + 1);   /* 丢掉「上一首」之后的分支 */
        history.push(index);
        historyPos = history.length - 1;
      }
      current = index;
      loadedSrc = playlist[index].src;
      bgm.src = loadedSrc;
      updateNow();        /* 高亮跟着 current 走，不再依赖播放事件 */
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    };
    /* 下一首：只挑已经下载好的（顺序模式按列表往下，随机模式随机挑） */
    var nextIndex = function () {
      if (!playlist.length) return -1;
      var cand = [];
      for (var i = 0; i < playlist.length; i++) if (canPlay(i)) cand.push(i);
      if (!cand.length) return -1;
      if (order === 'sequence') {
        for (var k = 1; k <= playlist.length; k++) {
          var idx = (current + k) % playlist.length;
          if (canPlay(idx)) return idx;
        }
        return cand[0];
      }
      var pool = [];
      for (var j = 0; j < cand.length; j++) if (cand[j] !== current) pool.push(cand[j]);
      if (!pool.length) pool = cand;
      return pool[Math.floor(Math.random() * pool.length)];
    };
    var playNext = function () {
      var i = nextIndex();
      if (i < 0) { toast(warmOn ? '歌曲还在下载，稍等一下' : '没有可以播放的歌'); return false; }
      playIndex(i);
      return true;
    };
    var playPrev = function () {
      if (!playlist.length) return false;
      if (order === 'sequence') {
        for (var k = 1; k <= playlist.length; k++) {
          var idx = ((current - k) % playlist.length + playlist.length) % playlist.length;
          if (canPlay(idx)) { playIndex(idx); return true; }
        }
      } else if (historyPos > 0) {
        historyPos--;
        playIndex(history[historyPos], false);
        return true;
      }
      if (current >= 0 && canPlay(current)) {
        /* 没有上一首了：把头重播一遍（和音乐播放器一致） */
        try { bgm.currentTime = 0; } catch (e) {}
        var p = bgm.play();
        if (p && p.catch) p.catch(function () {});
        return true;
      }
      toast(warmOn ? '这首歌还没下载完，稍等一下' : '没有可以播放的歌');
      return false;
    };
    var togglePlay = function () {
      if (bgmStarted) { bgm.pause(); return; }
      if (current < 0) { playNext(); return; }              /* 还没开始过：挑一首 */
      if (!canPlay(current)) {                              /* 还没下载完：不播，给提示 */
        toast('这首歌还没下载完，稍等一下再点播放');
        return;
      }
      if (loadedSrc === playlist[current].src) {            /* 已经装载好这首：接着放 */
        var p = bgm.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        playIndex(current, false);                          /* 默认曲还没装载过 */
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
      /* 还没下载完的不能播：弹个小提示；下载失败的点击 = 重试 */
      if (!canPlay(idx)) {
        if (song && song.state === 'error') { toast('正在重新下载这首歌…'); download(idx, 1); }
        else toast('这首歌还没下载完，稍等一下');
        return;
      }
      playIndex(idx);
    });
    bgmToggle.addEventListener('click', function () {
      if (isOpen) closePanel(false); else openPanel();
    });
    /* 点浮窗外面 / 按 Esc 关闭 */
    doc.addEventListener('click', function (event) {
      if (!isOpen) return;
      if (panel.contains(event.target) || bgmToggle.contains(event.target)) return;
      closePanel(false);
    });
    doc.addEventListener('keydown', function (event) {
      if (isOpen && (event.key === 'Escape' || event.key === 'Esc')) closePanel();
    });

    var markPlaying = function () {
      bgmErrors = 0;
      if (!bgmStarted) setBgmPlaying(true);
      showTrigger();
    };
    bgm.addEventListener('playing', markPlaying);
    bgm.addEventListener('timeupdate', markPlaying);
    bgm.addEventListener('pause', function () { setBgmPlaying(false); });
    /* 一首放完 → 随机换下一首；歌单只有一首时效果就是循环播放 */
    bgm.addEventListener('ended', playNext);
    /* 某首取不到（文件没了或格式不支持）：跳下一首；全都失败才收起按钮 */
    bgm.addEventListener('error', function () {
      bgmErrors++;
      if (!playlist.length || bgmErrors >= playlist.length) {
        bgmToggle.hidden = true;
        triggerShown = false;
        setBgmPlaying(false);
        return;
      }
      playNext();
    });

    /* ---------- 音量 ---------- */
    var savedVol = null;
    var savedOrder = null;
    try {
      savedVol = parseInt(localStorage.getItem('bgmVol'), 10);
      savedOrder = localStorage.getItem('bgmOrder');
    } catch (e) {}
    var vol = (savedVol >= 0 && savedVol <= 100) ? savedVol : 40;   /* 默认四成，不吓人 */
    bgm.volume = vol / 100;
    /* iOS（iPhone / iPad 上的所有浏览器都用 WebKit）会忽略 volume，那边的音量只能由设备音量键控制。
       这里用「设完读回来」判断：读不回来就说明这个平台不支持，那就把音量条藏起来 ——
       不显示一个划了没反应的控件。 */
    var volumeWorks = Math.abs(bgm.volume - vol / 100) < 0.03;
    if (volWrap) {
      if (!volumeWorks) {
        volWrap.hidden = true;
      } else if (volRange) {
        volRange.value = String(vol);
        volRange.addEventListener('input', function () {
          var v = parseInt(volRange.value, 10);
          bgm.volume = v / 100;
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
    /* 带超时的 fetch：30 秒还没完就中断，交给重试逻辑 */
    var fetchWithTimeout = function (url, ms) {
      if (typeof AbortController !== 'function') return fetch(url, { cache: 'force-cache' });
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, ms);
      return fetch(url, { cache: 'force-cache', signal: ctrl.signal })
        .then(function (res) { clearTimeout(timer); return res; })
        .catch(function (err) { clearTimeout(timer); throw err; });
    };
    /* 下载一首：失败或超时都重试，退避 1s → 2s → 4s，用完次数才标记失败 */
    var download = function (index, attempt) {
      var song = playlist[index];
      if (!song) return Promise.resolve();
      song.state = 'loading';
      renderItemState(index);
      return fetchWithTimeout(song.src, WARM_TIMEOUT)
        .then(function (res) {
          if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
          return res.blob();                       /* 读完整首，才算真的下载完 */
        })
        .then(function () {
          song.state = 'ready';
          renderItemState(index);
        })
        .catch(function () {
          if (attempt < WARM_TRIES) {
            var wait = 1000 * Math.pow(2, attempt - 1);
            return new Promise(function (resolve) { setTimeout(resolve, wait); })
              .then(function () { return download(index, attempt + 1); });
          }
          song.state = 'error';
          renderItemState(index);
        });
    };
    var warmQueue = function () {
      if (!playlist.length || !warmOn) return;
      var queue = [];
      for (var d = 0; d < playlist.length; d++) {
        if (playlist[d].isDefault) { queue.push(d); break; }
      }
      for (var i = 0; i < playlist.length; i++) if (queue.indexOf(i) < 0) queue.push(i);
      var n = 0;
      var step = function () {
        if (n >= queue.length) { warmStatus = ''; updateNow(); return; }
        var idx = queue[n++];
        if (playlist[idx].state === 'ready') { step(); return; }
        warmStatus = '正在后台准备 ' + playlist[idx].title + '（' + n + '/' + queue.length + '）';
        updateNow();
        download(idx, 1).then(function () { updateNow(); step(); });
      };
      step();
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
        warmOn = shouldWarm();     /* 必须在画列表之前定下来：不预热时所有歌都能点 */
        renderList();
        updateNow();
        showTrigger();
        startWarm();
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
      var target = doc.querySelector(this.getAttribute('href'));
      if (target) {
        var top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
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
