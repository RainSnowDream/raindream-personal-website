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

  /* ===== 背景音乐：手动播放的随机歌单 =====
     歌单靠「文件名编号」这个约定，不需要改代码：
     audio/bgm-1.mp3、audio/bgm-2.mp3……从 1 开始依次探测，遇到不存在的就停（编号必须连续）。
     一首编号的都没有时，退回单曲 audio/bgm.mp3。
     播放顺序随机：一首放完随机换下一首，不会连着放同一首。
     注意：只有点按钮才会播 —— 浏览器要求用户手势，自动播放做不到。 */
  var bgmToggle = doc.getElementById('bgmToggle');
  var bgm = doc.getElementById('bgm');
  if (bgmToggle && bgm) {
    var bgmKnown = false;
    /* 用「真的出声了」判断是否在播放，**不能用 audio.paused**：
       浏览器拒绝一次播放尝试时 paused 可能已经是 false，那会让按钮点了没反应
       （iPhone 上就是这个现象）。 */
    var bgmStarted = false;
    var playlist = [];      /* 歌曲地址列表 */
    var current = -1;       /* 当前放到第几首，-1 = 还没开始 */
    var bgmErrors = 0;      /* 连续失败次数，用来避免死循环 */

    var setBgmPlaying = function (playing) {
      bgmToggle.classList.toggle('is-playing', playing);
      bgmToggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
      bgmToggle.setAttribute('aria-label', playing ? '暂停背景音乐' : '播放背景音乐');
    };
    var showBgm = function () {
      if (bgmKnown) return;
      bgmKnown = true;
      bgmToggle.hidden = false;
    };
    var hideBgm = function () {
      bgmToggle.hidden = true;
      bgmKnown = false;
      setBgmPlaying(false);
    };

    /* 依次探测 audio/bgm-1.mp3、bgm-2.mp3……直到 404 为止 */
    var MAX_TRACKS = 30;
    var probeNumbered = function () {
      var found = [];
      var step = function (n) {
        if (n > MAX_TRACKS) return Promise.resolve(found);
        var url = 'audio/bgm-' + n + '.mp3';
        return fetch(url, { method: 'HEAD' }).then(function (res) {
          if (!res || !res.ok) return found;
          found.push(url);
          return step(n + 1);
        });
      };
      return step(1).catch(function () { return found; });
    };
    /* 退回单曲：HTML 里 <audio src="..."> 写的那一首 */
    var probeSingle = function () {
      var url = bgm.getAttribute('src');
      return fetch(url, { method: 'HEAD' }).then(function (res) {
        return (res && res.ok) ? [url] : [];
      }).catch(function () { return []; });
    };

    if (typeof window.fetch === 'function') {
      probeNumbered()
        .then(function (list) { return list.length ? list : probeSingle(); })
        .then(function (list) {
          if (!list.length) return;      /* 一首都没有：不显示按钮 */
          playlist = list;
          showBgm();
        });
    } else {
      /* 老浏览器没有 fetch：就用 HTML 里写的那一首，能不能播交给 error 事件判断 */
      playlist = [bgm.getAttribute('src')];
      showBgm();
    }

    /* 背景音乐不该一上来就最大声，改这个数字即可调整。
       注意：iOS（iPhone / iPad 上的所有浏览器，它们都用 WebKit）会忽略这个设置，
       那边的音量只能由设备音量键控制 —— 这是系统限制，绕不过去，也不该假装能控制。 */
    bgm.volume = 0.4;

    /* 随机挑一首，尽量不与当前这首重复 */
    var pickRandom = function () {
      if (playlist.length <= 1) return 0;
      var n = current;
      while (n === current) n = Math.floor(Math.random() * playlist.length);
      return n;
    };
    var playIndex = function (index) {
      current = index;
      bgm.src = playlist[index];
      var playing = bgm.play();
      if (playing && playing.catch) playing.catch(function () {});
    };
    var playRandom = function () {
      if (playlist.length) playIndex(pickRandom());
    };

    bgmToggle.addEventListener('click', function () {
      if (bgmStarted) {
        bgm.pause();                        /* 暂停：保留位置，再点继续 */
      } else if (current >= 0) {
        var resuming = bgm.play();
        if (resuming && resuming.catch) resuming.catch(function () {});
      } else {
        playRandom();                       /* 第一次点：随机开一首 */
      }
    });

    /* 「真的出声了」才算在播：用 playing（真正开始播放）而不是 play（只是尝试开始），
       否则被拒绝的那次尝试也会被当成成功。timeupdate 作为兜底。 */
    var markBgmStarted = function () {
      if (bgmStarted) return;
      bgmStarted = true;
      bgmErrors = 0;
      showBgm();
      setBgmPlaying(true);
    };
    bgm.addEventListener('playing', markBgmStarted);
    bgm.addEventListener('timeupdate', markBgmStarted);
    bgm.addEventListener('pause', function () {
      bgmStarted = false;
      setBgmPlaying(false);
    });
    /* 一首放完 → 随机换下一首；歌单只有一首时，效果就是循环播放 */
    bgm.addEventListener('ended', playRandom);
    /* 某首取不到（文件没了或格式不支持）：换一首；全都失败才把按钮收起来 */
    bgm.addEventListener('error', function () {
      bgmErrors++;
      if (!playlist.length || bgmErrors >= playlist.length) {
        hideBgm();
        return;
      }
      bgmStarted = false;
      playRandom();
    });
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
