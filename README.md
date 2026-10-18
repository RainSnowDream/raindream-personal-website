# RainDream · 雨梦 🌸

> 在代码与文字之间寻找真实的自己。

🔗 [raindream.top](https://raindream.top)

## 项目结构

```
├── index.html      # 主页
├── blog.html       # 博客页
├── 404.html        # 404 页面（走错网址时显示的那张）
├── styles.css      # 共享样式（两页共用）
├── common.js       # 共享交互逻辑（两页共用）
├── posts.js        # 文章数据
├── marked.umd.js   # Markdown 渲染库（本地文件，锁定 marked 18.1.0，不用 CDN）
├── sw.js           # 离线缓存 Service Worker
├── avatar.webp     # 页面内头像
├── avatar.jpg      # 社交分享图（og:image）
├── wrangler.jsonc  # Cloudflare 部署配置（含「走错网址用 404.html」这个开关）
└── .assetsignore   # 不上传为网站内容的文件清单
```

## 写博客

打开 `posts.js`，在数组末尾加一篇（`id` 必须唯一，不能和已有文章重复）：

```js
{
  id: 6,
  date: '2026-08-06',
  tags: ['生活'],
  title: '标题',
  excerpt: '摘要',
  body: `正文，Markdown 格式，支持 [链接](url)`
}
```

### ⚠️ 正文里的反引号必须转义（最容易踩的坑）

`body` 是**模板字符串**（整段被一对反引号包着），所以正文里：

| 你想写 | 必须写成 |
|---|---|
| 反引号 `` ` ``（比如 Markdown 的行内代码） | `` \` `` |
| `${` | `\${` |

**漏了转义 → 整个 `posts.js` 语法出错 → 博客页一篇文章都显示不出来**（会显示「文章数据没能加载」而不是白屏）。

所以每次改完 `posts.js`，**刷新一下博客页确认文章还在**，再推送。

> 字段也可以少写：`date` / `tags` / `title` / `excerpt` / `body` 缺哪个都会用默认值兜底，
> 不会让整页崩掉；但 `id` 必须写且唯一。

## 修改代码

- **共享样式** → 打开 `styles.css`（导航、主题、配色变量、页脚等两页共用的部分）
- **共享交互** → 打开 `common.js`（主题切换、移动端导航、回到顶部、滚动高亮等）
- **主页内容** → 打开 `index.html`，搜索对应中文就能定位到要改的位置
- **联系方式** → 打开 `index.html`，搜索 `contact-grid`，改里面几个 `<a href="...">` 的链接和文字
- **关于我** → 打开 `index.html`，搜索 `关于我` 或 `about-text`，直接改段落文字
- **配色** → 打开 `styles.css`，搜索 `:root`，蓝粉颜色在 CSS 变量 `--blue` 和 `--pink` 里
- **头像** → 替换 `avatar.webp`（页面内头像）；`avatar.jpg` 用作社交分享图（og:image），保持同名即可

- **Markdown 渲染库** → `marked.umd.js` 是直接下载的 `marked@18.1.0` 里的 `lib/marked.umd.js`；
  要升级就下载新版覆盖它即可（脚本走网络优先，老访客刷新就是新版，不用动 `CACHE_VERSION`）

页面专属的样式仍留在各自的 `<style>` 里，交互逻辑留在各自的 `<script>` 里。

### 深浅色切换按钮（第三方组件，已就地收养）

导航栏右边那个白/夜切换按钮不是自己写的，来自
[Day-night-toggle-button](https://github.com/Xiumuzaidiao/Day-night-toggle-button) 的
**「白天黑夜切换按钮 4.0」**（作者 Xiumuzaidiao，**ISC 许可证**，可自由使用/修改/分发，
保留 `theme-button.js` 开头那段声明即可）。

它是个 **Web Component**（自定义元素 `<theme-button>`），内部用 **Shadow DOM 封闭**——
所以它自带的 `* { margin:0; transition:.7s }` 这类演示页样式**不会污染整站**，
`styles.css` 里只需要给它一个尺寸盒子。

**想改大小**：只改 HTML 里那个标签的 `size` 属性（`index.html` / `blog.html` 各一处）：

```html
<theme-button class="theme-toggle" id="themeToggle" size="1.3" ...></theme-button>
```

内部固定 180em × 70em，字号 = `size ÷ 3` px，所以：

| size | 换算 | 实际尺寸 |
|---|---|---|
| `3` | 1px 字号 | 180 × 70（原版演示大小） |
| `1.3` | 0.43px 字号 | **约 78 × 30（当前使用）** |
| `1` | 0.33px 字号 | 约 60 × 23 |

> 改小了云朵和星星的细节也会一起变小（它们都是按 em 算的），别再往小了调。

**接进本站时改了 7 处**（都在 `theme-button.js` 里，代码里带「本站改动」注释）：

1. `.components` 的 `position:fixed` → `absolute`：原版固定在视口上，放进导航栏会随页面滚动飘走；
2. 删掉「跟随系统主题自动切换」：本站规则是首次跟系统、之后以访客自己的选择为准
   （跟随会覆盖访客的手动选择）；
3. **键盘无障碍**：宿主元素 `role="switch"` + `tabindex="0"`，Enter / 空格可切换
   （原版内部是 `div` + `onclick`，键盘和读屏都用不了）；
4. 初始主题改读本站的 `<html data-theme>`（配合页头那段防闪白的内联脚本，避免先画成白天再跳一下）；
5. 切换时同步 `aria-checked`；宿主被重复挂载时不再重建 Shadow DOM；
6. 尊重系统的「减少动态效果」（`prefers-reduced-motion`）；
7. 对外只抛一个 `change` 事件（`e.detail` = `'light'` / `'dark'`），过场动画在 `common.js` 里单独做
   （见下一节）。

### 导航栏的入场动画（想调节奏就改三个变量）

进页面时导航栏会**整体落下**，里面的 logo / 菜单 / 主题按钮依次**淡入上浮**。
节奏统一在 `styles.css` 顶部这三个变量里，**改它们就行，不用碰动画代码**：

```css
--nav-in-dur:.45s;                          /* 每一项淡入用多久 */
--nav-in-step:.05s;                         /* 相邻两项之间错开多久（越大会越「一个个来」） */
--nav-in-ease:cubic-bezier(.22,1,.36,1);    /* 缓动：现代 UI 常用的「快出缓停」 */
```

顺序由 `animation-delay:calc(var(--nav-in-step) * N)` 决定：logo = 1、菜单 1~4 = 2~5、主题按钮 = 6。

几个已经处理掉的坑：

- **只用 `opacity` + `transform`** 做动画（走合成层、不触发布局），不会掉帧；
- **不带 `transition:all`**：导航栏收缩那条过渡只写 `height / background-color / box-shadow / border-color`，
  免得滚动时连 `backdrop-filter`（毛玻璃）都跟着重算；
- **不透明度提前到位**（关键帧 55% 就到 1）：整条滑下来时不会「半透明糊着走」；

- **`app-ready` 看门狗**：入场由 `<html class="app-ready">` 触发，那个类是 `index.html` 自己的脚本加的；
  `common.js` 里兜了一个定时器，万一那段脚本没跑到（报错 / 被扩展干扰），
  1.2 秒后会自己补上 —— 否则导航栏会永远停在 `opacity:0`、整个看不见；
- 开了「减少动态效果」时：导航栏相关元素**直接显示、不做动画**。

### 关于「加载页」（已取消）

网站早期有一个带进度条的**加载页**（遮罩 + 光斑 + logo + 百分比），现在**已彻底删除**：

- **删掉的**：加载页 DOM、它的 CSS 与 6 个关键帧、整段进度模拟脚本（资源里程碑 + 2.2 秒兜底），
  以及 `--preloader-*` 那组变量 —— `index.html` 因此从 652 行降到 500 多行；
- **保留的只有「宣布就绪」**：`html.app-ready` 是导航栏与首屏入场动画的触发条件，
  现在由一个十几行的小脚本负责（等两帧再宣布，先让「未就绪」的初始状态画一次，入场动画才会真的跑起来）；
- **雨滴 / 视差不受影响**：它们本来就是「听 `app:ready` 事件」而不是「查类」；
- **还有一层保险**：`common.js` 里有看门狗 —— 1.2 秒后若还没有 `app-ready` 就自己补上，
  万一页面脚本没跑到（报错、被扩展干扰），导航栏也不会永远停在透明状态。
### 深浅色切换过场：柔光扩散

点按钮切换深浅色时，**从切换按钮的位置向外散开一圈「新主题颜色」的柔光**，
配合全站元素自身的 0.5s 颜色过渡完成换色。

- **实现**：`common.js` 里的 `themeGlow()` 动态创建一层柔光（`.theme-glow`），
  用 `radial-gradient` 以按钮中心为圆心、半径取到屏幕最远的角；`styles.css` 里用关键帧
  `@keyframes themeGlow` 让它淡入再淡出（0 → .95 → 0，约 0.95s）。
- **为什么省性能**：**只动 `opacity` 与 `transform`** —— 合成层动画，不重排、不重绘内容；
  相比之下早期那版 canvas「粒子飞散」每帧要重画 700 多个方块，开销大一个数量级，观感也更乱。
- **为什么用 `absolute` 而不是 `fixed`**：iOS 会把 `fixed` 层裁在「可视视口」内，
  而网址栏（液态玻璃）背后那一条属于「布局视口」—— 只有属于文档的层才画得到那里。
  所以柔光层用 `position:absolute` + `height:calc(100vh + 220px)` + `top` 设为当前滚动位置
  （多给的 220px 是故意的"溢出兜底"，避免不同状态下露出纯色）。
- **`theme-color` 同步**：过场期间在旧色与新色之间分步插值（约每 70ms 一步，结束精确落到目标色），
  并同时同步 `html` 的 `color-scheme` —— iOS 网址栏那一小块靠这两样跟主题。
- **降级**：开了「减少动态效果」→ 直接切换，不创建任何元素。
- **想调手感**：`styles.css` 里 `.theme-glow.is-on{animation:themeGlow .95s ...}`（时长）、
  `common.js` 里 `var dur = 900`（theme-color 插值窗口，与动画保持一致）。

## 部署

### Cloudflare Workers（当前实际使用的方式）

站点跑在 **Cloudflare Workers + 静态资源** 上，不是 Pages。仓库已经和 GitHub 连好，
**只要把改动推到 `main` 分支就会自动重新部署**，不需要做别的：

```
推送到 main  →  Cloudflare 自动执行 npx wrangler deploy  →  约 1 分钟生效
```

`wrangler.jsonc` 就是这份部署配置，每一项都别随手改：

| 字段 | 当前值 | 说明 |
|---|---|---|
| `name` | `raindream-personal-website` | Worker 的名字。**写错会变成新建一个项目，而不是更新现有的** |
| `compatibility_date` | `2026-10-06` | 运行时兼容日期，改了可能影响行为 |
| `assets.directory` | `./` | 整个仓库目录都会作为网站内容 |
| `assets.not_found_handling` | `404-page` | 找不到文件时返回最近的 `404.html`，状态码 404 |

> ⚠️ **踩过的坑一：404 页面不生效。** `not_found_handling` 的默认值是 `none`，
> 也就是「什么都不返回」——访客看到的是一片空白。它既不在 HTML 里、也不在 JS 里，
> 只在 `wrangler.jsonc` 里。少了这一项，根目录的 `404.html` 根本不会被使用。

> ⚠️ **踩过的坑二：仓库里的东西会被整个发布。** 因为 `assets.directory` 是 `./`，
> 仓库里的每个文件都会变成网站内容（实测 `.git/config` 曾经可以被公开访问）。
> 不想被上传的（`.git`、`work/`、`outputs/` 等）必须写进 `.assetsignore`，格式和 `.gitignore` 一样。

> ⚠️ **踩过的坑三：本地 `wrangler dev` 会无限重载。** 因为 `assets.directory` 是 `./`，
> wrangler 自己的 `.wrangler/` 状态目录也在里面，它写一次状态就触发一次重载，
> 日志会不停刷 `Local server updated and ready`。
> **想在真实平台上验证又不想碰线上，推荐用：**
> `npx wrangler versions upload`（上传一个预览版本，会给你一个 `*.workers.dev` 预览地址，
> 线上一根汗毛都不会动）。验证满意了再推 `main` 让它正式部署。

### 本地预览 404 页面

`python -m http.server` **不会**自动使用 `404.html`，它返回的是 Python 自带的错误页。
想在本地看 404 页面的样子，直接双击打开 `404.html` 就行。

> **关于站内链接为什么是相对的**（`blog.html` / `index.html`）：
> 线上 `/blog.html` 和 `/index.html` 会各自 **307 跳转**到 `/blog` 和 `/`，所以点一次链接
> 会多一次同源跳转（同一个连接、几十毫秒，几乎感觉不到）。
> 保留相对路径是为了**双击 HTML 文件就能在本地点着看**。
> 哪天想省掉这一跳，把它们改成 `/` 和 `/blog` 就行 —— 代价是本地双击预览时链接会失效。
> （`404.html` 是个例外：它会在任意路径下被返回，所以里面的链接**必须**用根绝对路径。）

### 其它平台（备选，当前未使用）

**Vercel**

1. 打开 [vercel.com](https://vercel.com) → **New Project**
2. 导入 GitHub 仓库
3. Framework 选 **Other**，Build 和 Output 留空
4. 点 Deploy

**GitHub Pages**

1. 仓库 Settings → Pages
2. Source 选 **Deploy from a branch**，分支选 `main`
3. 文件夹选 `/ (root)`
4. Save，等几分钟即可（`404.html` 在根目录，GitHub Pages 会自动拿它当 404 页面）

## 本地运行

直接双击 `index.html` 在浏览器打开，或：

```bash
python -m http.server 8080
```

## 离线说明

主页完全不依赖外部网络。博客页用的 Markdown 渲染库 `marked.umd.js` 现在也是仓库内的本地文件
（锁定版本 18.1.0），所以断网时博客页也能正常渲染，不再依赖 cdn.jsdelivr.net。

404 页面会向 `loliapi.com` 要一张随机背景图：失败或超时会自动重试两次，仍然不行就静默退回渐变底色，
访客不会察觉出过错，也不影响阅读和按钮点击。开启了「节省流量」模式的访客不会请求这张图。

Service Worker 缓存策略（`sw.js`）：

- **页面、样式、脚本**（`index.html`、`blog.html`、`styles.css`、`common.js`、`marked.umd.js`、
  `posts.js`）全部走**网络优先** —— 刷新就是最新版，不需要手动清缓存；
- **为什么这些必须一致**：它们曾经走缓存优先，出过真实的坑 ——「新 HTML + 旧 CSS」
  让导航栏按钮文字被挤成一列。所以现在只有图片和字体走缓存优先；
- **图片 / 字体**（`avatar.webp` 等）走**缓存优先** —— 速度快、省流量；若替换了这类文件，
  必须把 `sw.js` 顶部的 `CACHE_VERSION` 加 1（当前是 `v18`），老访客才会拉到新版本；
- 预缓存是**逐个文件**进行的：某一个文件取不到，不会连累其它文件，也不会让整次安装失败；
- 离线访问一个从没访问过的地址时，返回的是 404 页面（状态码也是 404），而不是把首页当成「成功」返回。
