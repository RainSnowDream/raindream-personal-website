背景音乐放在这个文件夹里。歌单由 playlist.json 决定。

现在的 8 首（顺序 = 网站上的顺序，日文在上、英文在下）：

    uchiage-hanabi.mp3      打上花火
    suki-dakara.mp3         好きだから。 / 『ユイカ』
    shitsuren-song.mp3      失恋ソング沢山聴いて 泣いてばかりの私はもう。 / りりあ。
    one-last-kiss.mp3       One Last Kiss / 宇多田ヒカル   ★默认曲
    am.mp3                  AM
    head-in-the-clouds.mp3  Head In The Clouds / Hayd
    unhappy.mp3             unhappy / s0rrow
    magnolia.mp3            magnolia

加歌 / 换歌的写法：

    { "src": "audio/新文件名.mp3", "title": "歌名", "artist": "歌手", "default": true }

  · src 必填，路径要写对（文件名建议全小写英文，避免日文/空格在网址里出问题）
  · title 不写就显示文件名；artist 可以省略
  · "default": true 只写一条 = 默认曲：访客点播放先从它开始，列表里先高亮它
  · 数组的顺序就是列表顺序，随便调

播放规则：顺序随机，一首放完随机换下一首；「上一首」按播放历史回退。

访客一进网站就会在后台把整个歌单下载好（现在共 65 MiB）——
慢网（2G/3G）和「节省流量」模式会自动跳过。想把总量降下来，
可以把 MP3 从 320 kbps 转成 128 kbps（约 26 MB，当背景音乐听不出差别）。

注意：
- 单首不能超过 25 MiB（Cloudflare 静态资源上限）
- 这个 README.txt 本身不会上传到网站（已写进 .assetsignore）
