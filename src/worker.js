/**
 * raindream.top —— 一个极小的 Worker：只给 /audio/* 补上「分段下载」（Range）能力
 *
 * 【为什么要它】
 * Cloudflare Workers 的静态资源服务不实现 Range。实测（缓存命中状态下也一样）：
 *   请求头带 Range: bytes=0-1023   ->   HTTP 200 + 整个 10,083,480 字节，没有 Content-Range
 *   响应里也没有 Accept-Ranges
 * 后果：浏览器没法「只要需要的那一段」，拖进度条得等整个文件下载到那个位置；
 *      部分浏览器（尤其 Safari）对媒体分段要求更严格，表现会更差。
 *
 * 【它怎么工作】
 * wrangler.jsonc 里用 assets.run_worker_first = ["/audio/*"]，
 * 意思是「只有 /audio/ 下面的请求先交给这个 Worker」，
 * 其它路径（html / css / js / 图片）完全不受影响，仍由静态资源直接服务，
 * 那些请求也不算进 Worker 的每日请求配额。
 *
 * 【它做什么】
 *   没有 Range            -> 200，整个文件 + Accept-Ranges: bytes
 *   Range: bytes=a-b      -> 206，只回这一段 + Content-Range
 *   Range: bytes=-N       -> 206，最后 N 个字节
 *   Range 起点越界        -> 416 + Content-Range: bytes * /总长度
 *   多段 Range（a-b,c-d） -> 按 HTTP 规范允许的做法忽略它，回整个文件（200）
 *   HEAD                  -> 200，只回响应头
 *
 * 【两个必须知道的坑】
 * 1) _headers 文件里给 /audio/*.mp3 设的缓存头，对「Worker 生成的响应」不生效
 *    （官方文档明确写了这一点），所以下面自己设置同样的 Cache-Control。
 * 2) 资源库（env.ASSETS）自己不做分段，所以这里永远先取完整文件，再自己切；
 *    切的时候是流式的（边收边吐），不会把整个 10 MB 读进内存。
 */

const AUDIO_PREFIX = '/audio/';

/* 与 _headers 里 /audio/*.mp3 保持一致的策略：内容永久不变，长缓存 */
const IMMUTABLE = 'public, max-age=31556952, immutable';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* 理论上只会收到 /audio/*（run_worker_first 限定），留个保险 */
    if (!url.pathname.startsWith(AUDIO_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    /* 永远不带 Range 去要资源：资源库不支持分段，会返回完整的 200 */
    let asset;
    try {
      asset = await env.ASSETS.fetch(new URL(url.pathname, 'https://assets.local'));
    } catch (err) {
      /* 资源库异常：退回默认行为，绝不把音频彻底弄挂 */
      return env.ASSETS.fetch(request);
    }

    /* 文件不存在等情况：原样返回（保持 404 页面等既有行为） */
    if (!asset.ok) return asset;

    const total = Number(asset.headers.get('content-length') || 0);

    const headers = new Headers();
    const type = asset.headers.get('content-type');
    if (type) headers.set('content-type', type);
    const etag = asset.headers.get('etag');
    if (etag) headers.set('etag', etag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', IMMUTABLE);

    if (request.method === 'HEAD') {
      headers.set('content-length', String(total));
      return new Response(null, { status: 200, headers: headers });
    }

    const range = parseRange(request.headers.get('range'), total);

    if (range === 'unsatisfiable') {
      headers.set('content-range', 'bytes */' + total);
      return new Response(null, { status: 416, headers: headers });
    }

    if (!range) {
      headers.set('content-length', String(total));
      return new Response(asset.body, { status: 200, headers: headers });
    }

    headers.set('content-range', 'bytes ' + range.start + '-' + range.end + '/' + total);
    headers.set('content-length', String(range.end - range.start + 1));
    return new Response(slice(asset.body, range.start, range.end), { status: 206, headers: headers });
  }
};

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

/**
 * 把完整文件的流「切」出 [start, end] 这一段（含两端），边收边吐，不整份进内存
 *
 * ⚠️ 这里有一个实测踩到的坑，必须写清楚：
 *    ReadableStream 的 pull 函数**绝对不能「既不交付数据、也不关闭流」就返回**。
 *    最小复现（Node 24）：这样写的时候 pull 只会被调用 1 次，然后流永久停住，
 *    消费者读到的就是「永远加载不出来」。
 *    所以下面用 for(;;) 在**同一次 pull 内部**一直读，直到能交付一段、或者读到结尾为止。
 *    （曾经的写法是「这一块在起点之前就 return」，拖动进度条到歌曲靠后位置时
 *      前面要丢掉上百块，正好必然触发这个死锁。）
 */
function slice(body, start, end) {
  const reader = body.getReader();
  let pos = 0;

  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {                      /* 源文件读完了：关闭是安全的 */
          controller.close();
          return;
        }

        const value = chunk.value;
        const chunkStart = pos;
        pos += value.byteLength;
        const chunkEnd = pos - 1;

        if (chunkEnd < start) continue;        /* 整块都在起点之前：继续读，不要返回 */

        const from = Math.max(0, start - chunkStart);
        const to = Math.min(value.byteLength, end - chunkStart + 1);
        controller.enqueue(value.subarray(from, to));

        if (chunkEnd >= end) {                 /* 已经交付到终点：收工 */
          controller.close();
          reader.cancel();
        }
        return;                                /* 每次 pull 都恰好交付一段（或已关闭） */
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}
