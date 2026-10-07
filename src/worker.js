/**
 * raindream.top —— 一个极小的 Worker：只给 /audio/* 补上「分段下载」（Range）能力
 *
 * 【为什么要它】
 * Cloudflare Workers 的静态资源服务不实现 Range。实测（缓存命中状态下也一样）：
 *   请求头带 Range: bytes=0-1023   ->   HTTP 200 + 整个 10,083,480 字节，没有 Content-Range
 * 后果：浏览器没法「只要需要的那一段」，拖进度条得等整个文件下载到那个位置；
 *      部分浏览器（尤其 Safari）对媒体分段要求更严格，表现会更差。
 *
 * 【它怎么工作】
 * wrangler.jsonc 里用 assets.run_worker_first = ["/audio/*"]，
 * 意思是「只有 /audio/ 下面的请求先交给这个 Worker」，
 * 其它路径（html / css / js / 图片）完全不受影响，仍由静态资源直接服务，
 * 那些请求也不算进 Worker 的每日请求配额。
 *
 * 【线上实测出来的 4 个平台事实】（都是踩过坑才知道的，别再改回去）
 * 1. 资源库（env.ASSETS）**完全无视 Range**：给它发 Range，它照样回 200 + 整个文件。
 *    所以「把请求原样转给资源库来要一段」这条路是走不通的，只能自己切。
 * 2. 资源库的响应**没有 Content-Length**（GET 和 HEAD 都没有）。
 *    而 206 响应必须带「总长度」（Content-Range: bytes a-b/总长），
 *    所以有 Range 请求时只能把整个文件读回来数一下长度（见下面 fetchWhole）。
 * 3. `_headers` 里配的头**不会应用到 Worker 生成的响应上**（官方文档也写了），
 *    所以这里必须自己设置 Cache-Control。
 * 4. env.ASSETS.fetch() 传「纯路径字符串」会报 Invalid URL；
 *    必须传完整 URL 或 Request 对象。
 *
 * 【它做什么】
 *   没有 Range            -> 200，整个文件（流式，不占内存）+ Accept-Ranges: bytes
 *   Range: bytes=a-b      -> 206，只回这一段 + Content-Range
 *   Range: bytes=-N       -> 206，最后 N 个字节
 *   Range 起点越界        -> 416 + Content-Range: bytes * /总长度
 *   多段 Range（a-b,c-d） -> 按 HTTP 规范允许的做法忽略它，回整个文件（200）
 *   HEAD                  -> 只回响应头
 */

const AUDIO_PREFIX = '/audio/';

/* 只有这些扩展名才按「内容永久不变的音频」处理并长缓存。
   ⚠️ 绝不能把 /audio/ 下所有文件都当成音频：playlist.json 也在那个目录里，
      给它套上 immutable 会让歌单被缓存一年（这个坑在 _headers 上已经踩过一次）。
   wrangler.jsonc 里的 run_worker_first 也只匹配这几种扩展名，这里是第二道保险。 */
const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac)$/i;

/* 与 _headers 里 /audio/*.mp3 保持一致的策略：内容永久不变，长缓存 */
const IMMUTABLE = 'public, max-age=31556952, immutable';

/* 资源库的假域名：文档说这个主机名没有实际意义，只看路径 */
const ASSET_ORIGIN = 'https://assets.local';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* 只认音频文件；其它（列表、说明文件等）原样交回静态资源，保持它们原本的缓存策略 */
    if (!url.pathname.startsWith(AUDIO_PREFIX) || !AUDIO_EXT.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const rangeHeader = request.headers.get('range');
    const assetUrl = ASSET_ORIGIN + url.pathname;

    /* ---------- 情况一：没有 Range ----------
       直接流式转发，不把文件读进内存（播放器的「整首预下载」走的就是这条路） */
    if (!rangeHeader) {
      let asset;
      try {
        asset = await env.ASSETS.fetch(assetUrl);
      } catch (err) {
        return env.ASSETS.fetch(request);       /* 兜底：绝不把音频彻底弄挂 */
      }
      if (!asset.ok) return asset;              /* 文件不存在：保持原来的 404 行为 */

      const headers = baseHeaders(asset);
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: headers });
      }
      return new Response(asset.body, { status: 200, headers: headers });
    }

    /* ---------- 情况二：带 Range ----------
       资源库不支持分段、也不给长度，所以只能整份取回来，再自己切 */
    let whole;
    try {
      whole = await fetchWhole(env, assetUrl);
    } catch (err) {
      return env.ASSETS.fetch(request);         /* 兜底 */
    }
    if (!whole.ok) return whole.response;       /* 文件不存在 */

    const buf = whole.bytes;
    const total = buf.byteLength;
    const headers = baseHeaders(whole.response);
    const range = parseRange(rangeHeader, total);

    if (range === 'unsatisfiable') {
      headers.set('content-range', 'bytes */' + total);
      return new Response(null, { status: 416, headers: headers });
    }

    if (!range) {
      /* 多段或语法不认识：按规范允许的做法忽略 Range，回整个文件 */
      headers.set('content-length', String(total));
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: headers });
      return new Response(buf, { status: 200, headers: headers });
    }

    const length = range.end - range.start + 1;
    headers.set('content-range', 'bytes ' + range.start + '-' + range.end + '/' + total);
    headers.set('content-length', String(length));

    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers: headers });
    }
    return new Response(buf.subarray(range.start, range.end + 1), { status: 206, headers: headers });
  }
};

/**
 * 把资源取回来并读成字节数组
 * 必须这样做的原因见文件顶部「平台事实 2」：资源库不给 Content-Length，而 206 需要总长度
 */
async function fetchWhole(env, assetUrl) {
  const response = await env.ASSETS.fetch(assetUrl);
  if (!response.ok) return { ok: false, response: response };
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { ok: true, response: response, bytes: bytes };
}

/** 统一设置响应头：类型和 ETag 沿用资源库的，缓存与分段能力由我们声明 */
function baseHeaders(asset) {
  const headers = new Headers();
  const type = asset.headers.get('content-type');
  if (type) headers.set('content-type', type);
  const etag = asset.headers.get('etag');
  if (etag) headers.set('etag', etag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', IMMUTABLE);
  return headers;
}

/**
 * 解析 Range 请求头
 * 返回 {start, end}、'unsatisfiable'（越界，要回 416）或 null（不处理，回整个文件）
 */
function parseRange(header, total) {
  if (!header || !(total > 0)) return null;

  /* 只处理单段 bytes=a-b / bytes=a- / bytes=-N；多段或语法不认识就忽略（规范允许） */
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null;

  const from = m[1];
  const to = m[2];
  if (from === '' && to === '') return null;

  if (from === '') {
    /* bytes=-N：最后 N 个字节 */
    const n = Number(to);
    if (!isFinite(n) || n <= 0) return 'unsatisfiable';
    return { start: Math.max(0, total - n), end: total - 1 };
  }

  const start = Number(from);
  const end = to === '' ? total - 1 : Math.min(Number(to), total - 1);
  if (!isFinite(start) || !isFinite(end) || start >= total || start > end) return 'unsatisfiable';
  return { start: start, end: end };
}
