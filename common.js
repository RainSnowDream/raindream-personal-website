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

  /* ===== 背景音乐：播放 / 暂停，并在访客第一次交互时自动开始 =====
     浏览器不允许网页自己出声，必须先有一次「用户手势」。所以这里等访客在本页的
     第一次点击 / 触摸 / 按键，立刻开始播放。滚动不算手势（规范与浏览器都不认），
     所以「一进页面就响」做不到 —— 这是浏览器的规定，不是实现偷懒。 */
  var bgmToggle = doc.getElementById('bgmToggle');
  var bgm = doc.getElementById('bgm');
  if (bgmToggle && bgm) {
    var bgmKnown = false;
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

    /* 按钮默认是藏起来的，只有确认音频文件真的存在才显示 ——
       免得线上出现一个点了没反应的按钮。因为 <audio> 是 preload="none"，
       这里只发一个很小的 HEAD 请求，不会下载音乐本身。
       老浏览器没有 fetch：直接显示按钮，靠播放失败时的 error 事件兜底。 */
    if (typeof window.fetch === 'function') {
      fetch(bgm.getAttribute('src'), { method: 'HEAD' })
        .then(function (res) { if (res && res.ok) showBgm(); })
        .catch(function () {});
    } else {
      showBgm();
    }

    /* 访客的选择记在 localStorage 的 bgm 键里：'off' 表示他明确关过音乐，
       之后不再自动播放（这个值会被读取）；'on' 只是记下他主动播放过。 */
    var bgmStopped = false;
    try { bgmStopped = localStorage.getItem('bgm') === 'off'; } catch (e) {}
    var rememberBgm = function (value) {
      try { localStorage.setItem('bgm', value); } catch (e) {}
    };
    var bgmAutoLeft = 3;   /* 自动播放最多尝试几次，失败就不再纠缠 */

    /* 点这个链接会离开当前页吗？会的话就别启动音乐 ——
       否则只响零点几秒就被页面卸载掐断，听起来更像故障。 */
    var leavesPage = function (el) {
      var a = el && el.closest ? el.closest('a[href]') : null;
      if (!a) return false;
      if (a.target && a.target !== '_self') return false;
      return (a.getAttribute('href') || '').charAt(0) !== '#';
    };

    var autoPlay = function (event) {
      if (bgmStopped || bgmAutoLeft <= 0 || !bgm.paused) return;
      if (bgmToggle.contains(event.target)) return;   /* 点的是音乐按钮本身，交给它自己处理 */
      if (leavesPage(event.target)) return;
      bgmAutoLeft--;
      var playing = bgm.play();
      if (playing && playing.catch) playing.catch(function () {});
    };
    /* 只有这几个事件能解锁播放（滚动不在其中） */
    var AUTO_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];
    AUTO_EVENTS.forEach(function (name) {
      window.addEventListener(name, autoPlay, { capture: true, passive: true });
    });
    var stopAutoPlay = function () {
      AUTO_EVENTS.forEach(function (name) {
        window.removeEventListener(name, autoPlay, { capture: true });
      });
    };

    /* 背景音乐不该一上来就最大声，改这个数字即可调整。
       注意：iOS（iPhone / iPad 上的所有浏览器，它们都用 WebKit）会忽略这个设置，
       那边的音量只能由设备音量键控制 —— 这是系统限制，绕不过去，也不该假装能控制。 */
    bgm.volume = 0.4;

    bgmToggle.addEventListener('click', function () {
      if (bgm.paused) {
        bgmStopped = false;
        rememberBgm('on');
        var playing = bgm.play();
        if (playing && playing.catch) playing.catch(function () {});
      } else {
        /* 访客主动暂停：记住这个选择，之后不再自动播放 */
        bgmStopped = true;
        rememberBgm('off');
        bgm.pause();
      }
    });
    /* 一旦成功开始播放，就不再监听自动播放的那些事件 */
    bgm.addEventListener('play', function () { showBgm(); setBgmPlaying(true); stopAutoPlay(); });
    bgm.addEventListener('pause', function () { setBgmPlaying(false); });
    bgm.addEventListener('error', function () {
      /* 文件缺失或浏览器不支持这个格式：把按钮收起来，不留下坏掉的按钮 */
      bgmToggle.hidden = true;
      bgmKnown = false;
      setBgmPlaying(false);
    });
    setBgmPlaying(false);

    /* 进页面就直接试一次播放：浏览器允许的话（回访者，或访客自己把自动播放设成允许），
       这就是真正的「进站即播」；不允许则静默失败，退回「第一次手势就播」。
       ⚠️ 代价：只要调用 play()，浏览器就会开始下载音频 —— 即使最后被拒绝。
       也就是说每个访客都会下载这几 MB，不管他要不要听，这是「尽量自动播放」换来的。 */
    if (!bgmStopped) {
      var firstTry = bgm.play();
      if (firstTry && firstTry.catch) firstTry.catch(function () {});
    }
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
