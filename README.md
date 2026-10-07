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

## 修改代码

- **共享样式** → 打开 `styles.css`（导航、主题、配色变量、页脚等两页共用的部分）
- **共享交互** → 打开 `common.js`（主题切换、移动端导航、回到顶部、滚动高亮等）
- **主页内容** → 打开 `index.html`，搜索对应中文就能定位到要改的位置
- **联系方式** → 打开 `index.html`，搜索 `contact-grid`，改里面几个 `<a href="...">` 的链接和文字
- **关于我** → 打开 `index.html`，搜索 `关于我` 或 `about-text`，直接改段落文字
- **配色** → 打开 `styles.css`，搜索 `:root`，蓝粉颜色在 CSS 变量 `--blue` 和 `--pink` 里
- **头像** → 替换 `avatar.webp`（页面内头像）；`avatar.jpg` 用作社交分享图（og:image），保持同名即可

页面专属的样式仍留在各自的 `<style>` 里，交互逻辑留在各自的 `<script>` 里。

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
> 不想被上传的（`.git`、`work/` 等）必须写进 `.assetsignore`，格式和 `.gitignore` 一样。

### 本地预览 404 页面

`python -m http.server` **不会**自动使用 `404.html`，它返回的是 Python 自带的错误页。
想在本地看 404 页面的样子，直接双击打开 `404.html` 就行。

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

主页完全不依赖外部网络。博客页的 Markdown 渲染依赖 `marked.js` CDN，断网时会降级显示纯文本。

404 页面会向 `loliapi.com` 要一张随机背景图：失败或超时会自动重试两次，仍然不行就静默退回渐变底色，
访客不会察觉出过错，也不影响阅读和按钮点击。

Service Worker 缓存策略（`sw.js`）：

- `index.html`、`blog.html`、`posts.js` 走**网络优先**——发布新文章后，老访客刷新页面即可看到，无需手动清缓存；
- `avatar.webp` 等静态资源走**缓存优先**——若替换了这类文件，把 `sw.js` 顶部的 `CACHE_VERSION` 从 `v2` 改成 `v3`（每次 +1），老访客才会拉到新版本。
