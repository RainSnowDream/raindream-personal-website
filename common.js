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
    var playlist = [];          /* [{src, title, artist}] */
    var current = -1;
    var history = [];           /* 播放历史，用来实现「上一首」 */
    var historyPos = -1;
    var bgmErrors = 0;          /* 连续失败次数，避免死循环 */
    var triggerShown = false;

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
      '<ol class="bgm-list" id="bgmList"></ol>';
    doc.body.appendChild(panel);
    var nowEl = doc.getElementById('bgmNow');
    var listEl = doc.getElementById('bgmList');
    var mainBtn = doc.getElementById('bgmPanelToggle');
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
    var markList = function () {
      var items = listEl.querySelectorAll('.bgm-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('is-current', Number(items[i].getAttribute('data-index')) === current);
      }
    };
    var renderList = function () {
      listEl.innerHTML = playlist.map(function (song, i) {
        return '<li><button class="bgm-item" type="button" data-index="' + i + '">' +
          '<span class="bgm-item-num">' + (i + 1) + '</span>' +
          '<span class="bgm-item-title">' + esc(song.title) + '</span>' +
          (song.artist ? '<span class="bgm-item-artist">' + esc(song.artist) + '</span>' : '') +
          '</button></li>';
      }).join('');
      markList();
    };
    var updateNow = function () {
      var song = playlist[current];
      if (nowEl) {
        nowEl.innerHTML = song
          ? '正在播放 <b>' + esc(song.title) + '</b>' + (song.artist ? ' · ' + esc(song.artist) : '')
          : '还没开始播放';
      }
    };
    var setBgmPlaying = function (playing) {
      bgmStarted = playing;
      bgmToggle.classList.toggle('is-playing', playing);
      bgmToggle.setAttribute('aria-label', playing ? '暂停音乐' : '音乐');
      if (mainBtn) {
        mainBtn.classList.toggle('is-playing', playing);
        mainBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
      }
      markList();
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
      bgm.src = playlist[index].src;
      updateNow();
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    };
    var randomIndex = function () {
      if (playlist.length <= 1) return 0;
      var n = current;
      while (n === current) n = Math.floor(Math.random() * playlist.length);
      return n;
    };
    var playNext = function () { if (playlist.length) playIndex(randomIndex()); };
    var playPrev = function () {
      if (historyPos > 0) {
        historyPos--;
        playIndex(history[historyPos], false);
      } else if (current >= 0) {
        /* 没有上一首了：把头重播一遍（和音乐播放器一致） */
        try { bgm.currentTime = 0; } catch (e) {}
        var p = bgm.play();
        if (p && p.catch) p.catch(function () {});
      }
    };
    var togglePlay = function () {
      if (bgmStarted) { bgm.pause(); return; }
      if (current >= 0) {
        var p = bgm.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        playNext();
      }
    };

    /* ---------- 事件 ---------- */
    panel.addEventListener('click', function (event) {
      var t = event.target;
      if (t.closest && t.closest('.bgm-close')) { closePanel(); return; }
      var actBtn = t.closest ? t.closest('[data-act]') : null;
      if (actBtn) {
        var act = actBtn.getAttribute('data-act');
        if (act === 'toggle') togglePlay();
        else if (act === 'next') playNext();
        else if (act === 'prev') playPrev();
        return;
      }
      var item = t.closest ? t.closest('.bgm-item') : null;
      if (item) playIndex(Number(item.getAttribute('data-index')));
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

    /* 背景音乐不该一上来就最大声，改这个数字即可调整。
       注意：iOS（iPhone / iPad 上的所有浏览器，它们都用 WebKit）会忽略这个设置，
       那边的音量只能由设备音量键控制 —— 这是系统限制，绕不过去，也不该假装能控制。 */
    bgm.volume = 0.4;

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
            artist: item.artist || ''
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

    if (typeof window.fetch === 'function') {
      findPlaylist().then(function (songs) {
        if (!songs || !songs.length) return;   /* 一首都没有：不显示按钮 */
        playlist = songs;
        renderList();
        updateNow();
        showTrigger();
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
