/* RainDream · 雨梦 — 共享交互逻辑（index.html 与 blog.html 共用）
   负责：主题切换、移动端导航、导航滚动、返回顶部、露出动画、
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
      /* ★ 长文章往下读时按钮会滚出视口：把圆心夹回视口内。
         否则柔光的圆心落在屏幕外，整屏只剩一层很淡的洗色，
         看起来就像「这一页没做深浅切换动画」。 */
      cx = Math.min(Math.max(cx, 0), vw);
      cy = Math.min(Math.max(cy, 0), vh);
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

    if (themeToggle) themeToggle.addEventListener('change', function (e) {
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
  var backBottom = doc.getElementById('backBottom');   /* ★ 与「返回顶部」同款的「滑到最下面」 */
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
    /* ★ 「滑到最下面」：离底部还有一段距离（超过一屏多）时才出现，
       否则到底了还显示一个「往下」的按钮，会让人困惑。 */
    if (backBottom) {
      var rest = doc.documentElement.scrollHeight - (y + window.innerHeight);
      backBottom.classList.toggle('visible', rest > 600);
    }
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
    /* ★ 「滑到最下面」：平滑滚到底；开了「减少动态效果」就直接跳。 */
  if (backBottom) backBottom.addEventListener('click', function () {
    var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bottom = doc.documentElement.scrollHeight;
    if (rm) { window.scrollTo(0, bottom); return; }
    if (window.scrollTo) { try { window.scrollTo({ top: bottom, behavior: 'smooth' }); return; } catch (e) {} }
    window.scrollTo(0, bottom);
  });

  if (backTop) backTop.addEventListener('click', function () {
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
        /* 用 window.history 而不是裸 history：避免被同名变量遮蔽，
           否则这里的 replaceState 可能是 undefined、整段静默失效。 */
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
