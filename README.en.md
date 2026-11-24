# Magnet to 115 / aria2 / qBittorrent

[简体中文](README.md) | **English**

A userscript that finds magnet / ed2k links on any web page and sends them to **115 cloud download**, **aria2** or **qBittorrent**, one at a time or in batch.

**Install: [GreasyFork](https://greasyfork.org/scripts/607096) (recommended) · [GitHub raw](https://raw.githubusercontent.com/JovanCai/magnet-to-115/main/magnet-to-115.user.js)** (requires Tampermonkey or Violentmonkey)

The UI follows your browser language: Chinese for `zh*` locales, English for everything else. You can also switch it in Settings.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the [GreasyFork page](https://greasyfork.org/scripts/607096) and click "Install this script", or open the GitHub raw link above and click "Install".
3. For 115, sign in at [115.com](https://115.com) in the same browser. For aria2 / qBittorrent, fill in the connection details in the script's Settings.

Updates are installed automatically by your userscript manager.

## What it detects

- Regular `<a href="magnet:…">` and `ed2k://` links
- Magnet links in plain text, even when they run straight into CJK punctuation. These are turned into clickable links.
- "Copy magnet" buttons that store the link in `data-clipboard-text`, `data-magnet` and similar attributes
- Links inside input boxes and text areas
- Content loaded later: pagination, infinite scroll, single-page app navigation
- Duplicates are merged by info-hash (case and base32/hex forms are treated as the same link)
- Bare 40-character hashes are off by default, so git commit IDs aren't mistaken for torrents. You can turn this on in Settings.

## Usage

**Small button next to each link**

The button shows the current default target: `115`, `aria2` or `qB`.

| Action | Result |
|---|---|
| Click | Send to the default target |
| Right-click / Shift+click | Pick another target or a 115 folder |
| Alt+click | Copy the link |

The button turns green on success and red on failure. Hover it for details.

**Floating button and panel**

A small semi-transparent button on the right edge shows how many links the page has. Drag it up or down to move it. Click it to open the panel:

- **Links**: every link on the page, with name, size, hash and status. You can select all, filter, hide links you've already added, scroll to a link on the page, and copy or send links one at a time or in batch.
- **Manual**: paste any text and the links in it are extracted.
- **Settings**: default target, 115 account and folders, aria2 / qBittorrent connections, display options, per-site disable, language.

**Shortcuts**

- `Alt+Shift+M`: open or close the panel. If you have text with links selected, it opens the Manual tab with those links.
- `Esc`: close.

The userscript manager menu also has "Open panel", "Add links manually", "Settings" and "Disable on this site".

## Targets

### 115 cloud download
- Uses the 115 account you're already signed into in the browser. No cookie setup needed.
- Pick the save folder by browsing your 115 folder tree, or enter a folder ID (cid). You can save favorite folders.
- Links are sent 15 per request. Results are counted as added / already existed / failed, and failed links can be retried with one click.
- If 115 asks you to verify your account (error 911), add one task manually in 115's web cloud download page. The error message has a button that takes you there.

### aria2
- Fill in the RPC URL (default `http://localhost:6800/jsonrpc`), the secret (rpc-secret) and the save folder.
- aria2 must be started with `--enable-rpc`.

### qBittorrent
- Fill in the WebUI URL, username and password. Save path and category are optional.
- The script logs in automatically when needed. If CSRF or Host header validation blocks requests, turn it off in WebUI settings or whitelist the address.

aria2 and qBittorrent both have a "Test connection" button. The first time you connect to a non-local address (for example a NAS), the script asks you to confirm, and your userscript manager also asks whether to allow the connection.

## Privacy

- The script only sends requests to official 115 domains and to the aria2 / qBittorrent addresses you enter yourself.
- Settings and history are stored in your userscript manager's local storage and are never uploaded anywhere.

## APIs used

| Purpose | Request |
|---|---|
| 115 add tasks | `POST https://clouddownload.115.com/web/` with `ac=add_task_urls`, `url[0..n]`, optional `wp_path_id` (folder cid) |
| 115 list folders | `GET https://webapi.115.com/files?aid=1&cid=…&show_dir=1&format=json` |
| 115 sign-in status | `GET https://my.115.com/?ct=ajax&ac=nav` |
| aria2 | JSON-RPC `aria2.addUri` (`token:<secret>`, `dir`); connection test uses `aria2.getVersion` |
| qBittorrent | `POST /api/v2/auth/login`, `POST /api/v2/torrents/add` (`urls` / `savepath` / `category`); connection test uses `GET /api/v2/app/version` |

## Development

```bash
node test/serve.js
```

Then open <http://localhost:8115/test/>.

The test page mocks the `GM_*` functions and the 115, aria2 and qBittorrent APIs, so no real requests are sent. In the mock, the aria2 secret is `s3cret` and the qBittorrent password is `pw`.

## License

[MIT](LICENSE)
