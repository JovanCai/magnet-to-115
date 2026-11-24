# 磁力一键离线：115 / aria2 / qBittorrent

一个油猴脚本：自动识别网页里的磁力 / ed2k 链接，一键或批量发送到 **115 云下载**、**aria2** 或 **qBittorrent**。

**[点此安装](https://raw.githubusercontent.com/JovanCai/magnet-to-115/main/magnet-to-115.user.js)**（需要先装好 Tampermonkey 或 Violentmonkey）

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 打开上面的安装链接，在弹出的页面里点“安装”。
3. 用 115 的话，先在浏览器里登录 [115.com](https://115.com)。用 aria2 / qBittorrent 的话，在脚本设置里填好连接信息。

脚本写了 `@updateURL`，之后的新版本会由扩展自动更新。

## 能识别哪些链接

- 普通的 `<a href="magnet:…">` 和 `ed2k://` 链接
- 正文里的纯文本磁力，和中文标点连在一起也能识别，会顺便转成可点击的链接
- “复制磁力”按钮上的 `data-clipboard-text`、`data-magnet` 等属性
- 输入框、文本框里的链接
- 后来才加载出来的内容，比如翻页、无限滚动、单页应用切换页面
- 同一个 info-hash 只算一条（大小写不同、base32 和 hex 两种写法都会合并）
- 40 位的裸哈希默认不识别，避免把 git 提交号当成磁力，需要的话可以在设置里打开

## 怎么用

**链接旁的小按钮**

按钮上显示当前默认目标：`115`、`aria2` 或 `qB`。

| 操作 | 效果 |
|---|---|
| 点击 | 发送到默认目标 |
| 右键 / Shift+点击 | 临时选择目标或 115 目录 |
| Alt+点击 | 复制链接 |

添加成功后按钮变绿，失败变红。把鼠标停在按钮上可以看到详细信息。

**悬浮球和面板**

页面右侧有一个半透明的小悬浮球，显示本页识别到的链接数，可以上下拖动。点开就是面板：

- **页面链接**：列出本页所有链接，带文件名、大小、哈希和状态。可以全选、筛选、隐藏已添加的，能在页面上定位到某条链接，也能单条或批量复制、发送。
- **手动添加**：粘贴一段任意文本，脚本会把里面的链接提取出来。
- **设置**：默认下载方式、115 账号与保存目录、aria2 / qBittorrent 连接、显示选项、按站点禁用。

**快捷键**

- `Alt+Shift+M`：打开或关闭面板。如果当前选中的文字里有链接，会直接进入手动添加。
- `Esc`：关闭。

油猴扩展菜单里也有“打开面板”“手动添加”“设置”“在此站点禁用”几个入口。

## 下载方式

### 115 云下载
- 用浏览器里已经登录的 115 账号，不需要另外填 Cookie。
- 保存目录可以在 115 的目录树里浏览选择，也可以直接输入目录 ID（cid）。常用目录可以收藏。
- 每次请求提交 15 条，结果分“成功 / 已存在 / 失败”统计，失败的可以一键重试。
- 提示“请验证账号”（错误码 911）时，到 115 网页版的云下载里手动添加一次任务完成验证就行，提示框里有直达按钮。

### aria2
- 填 RPC 地址（默认 `http://localhost:6800/jsonrpc`）、密钥（rpc-secret）和保存目录。
- aria2 需要用 `--enable-rpc` 启动。

### qBittorrent
- 填 WebUI 地址、用户名、密码，保存目录和分类可选。
- 未登录时脚本会自动登录。如果开启了 CSRF 或 Host 头校验导致失败，请在 WebUI 设置里关闭，或者把地址加入白名单。

aria2 和 qBittorrent 设置里都有“测试连接”按钮。第一次连接非本机地址（比如 NAS）时，脚本会弹窗确认，Tampermonkey 也会询问是否允许连接。

## 隐私

- 脚本只会向 115 官方域名，以及你自己在设置里填写的 aria2 / qBittorrent 地址发送请求。
- 设置和“已添加”记录都存在油猴扩展的本地存储里，不会上传到任何地方。

## 用到的接口

| 用途 | 请求 |
|---|---|
| 115 添加任务 | `POST https://clouddownload.115.com/web/`，参数 `ac=add_task_urls`、`url[0..n]`，可选 `wp_path_id`（目录 cid） |
| 115 浏览目录 | `GET https://webapi.115.com/files?aid=1&cid=…&show_dir=1&format=json` |
| 115 登录状态 | `GET https://my.115.com/?ct=ajax&ac=nav` |
| aria2 | JSON-RPC `aria2.addUri`（`token:密钥`、`dir`），测试连接用 `aria2.getVersion` |
| qBittorrent | `POST /api/v2/auth/login`、`POST /api/v2/torrents/add`（`urls` / `savepath` / `category`），测试连接用 `GET /api/v2/app/version` |

## 本地开发

```bash
node test/serve.js
```

然后打开 <http://localhost:8115/test/> 。

测试页模拟了 `GM_*` 函数以及 115、aria2、qBittorrent 的接口，不会发出真实请求。模拟环境里 aria2 的密钥是 `s3cret`，qBittorrent 的密码是 `pw`。

## 许可

[MIT](LICENSE)
