背景音乐放在这个文件夹里。歌单由 playlist.json 决定（现在就是它在管）：

    [
      { "src": "audio/bgm.mp3",  "title": "magnolia" },
      { "src": "audio/song2.mp3", "title": "第二首", "artist": "歌手" }
    ]

  加歌 = 把文件放进本文件夹 + 在 json 里加一行。
  src 必填（路径要写对）；title 不写就显示文件名；artist 可以省略。

  文件名完全随你：bgm.mp3、song2.mp3、magnolia.mp3 都行，没有编号约定。
  一旦有了 playlist.json，按编号（bgm-1.mp3…）自动探测就不再生效。

没有 playlist.json 时的备选（现在用不到）：
  · 按编号命名：bgm-1.mp3、bgm-2.mp3……（编号必须连续，最多 30 首）
  · 或单曲：bgm.mp3

播放规则：顺序随机，一首放完随机换下一首；「上一首」按播放历史回退。
访客一进网站就会在后台把整个歌单下载好，所以点播放能立刻响。

注意：
- 单首不能超过 25 MiB（Cloudflare 静态资源上限）；建议 MP3、128 kbps 左右
- 歌单越大，访客一进站下载的总量越大（N 首 ≈ N × 单曲大小）
- 这个 README.txt 本身不会上传到网站（已写进 .assetsignore）
