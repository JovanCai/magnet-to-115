// ==UserScript==
// @name         磁力一键离线：115 / aria2 / qBittorrent
// @name:zh-CN   磁力一键离线：115 / aria2 / qBittorrent
// @name:en      Magnet to 115 / aria2 / qBittorrent
// @namespace    https://github.com/JovanCai/magnet-to-115
// @version      1.2.0
// @description  自动识别网页里的磁力 / ed2k 链接（包括纯文本、复制按钮、输入框里的），一键或批量发送到 115 云下载、aria2 或 qBittorrent。可选 115 保存目录，会记住已添加过的链接，也支持手动粘贴添加。
// @description:zh-CN 自动识别网页里的磁力 / ed2k 链接（包括纯文本、复制按钮、输入框里的），一键或批量发送到 115 云下载、aria2 或 qBittorrent。可选 115 保存目录，会记住已添加过的链接，也支持手动粘贴添加。
// @description:en Detect magnet / ed2k links on any page (anchors, plain text, copy buttons, inputs) and send them to 115 cloud download, aria2 or qBittorrent in one click or in batch.
// @author       JovanCai
// @homepageURL  https://github.com/JovanCai/magnet-to-115
// @supportURL   https://github.com/JovanCai/magnet-to-115/issues
// @updateURL    https://raw.githubusercontent.com/JovanCai/magnet-to-115/main/magnet-to-115.user.js
// @downloadURL  https://raw.githubusercontent.com/JovanCai/magnet-to-115/main/magnet-to-115.user.js
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20rx%3D%226%22%20fill%3D%22%232777f8%22%2F%3E%3Cpath%20d%3D%22M6%204h4v7.5a2%202%200%200%200%204%200V4h4v7.5a6%206%200%200%201-12%200z%22%20fill%3D%22%23fff%22%2F%3E%3Cpath%20d%3D%22M6%208h4M14%208h4%22%20stroke%3D%22%232777f8%22%20stroke-width%3D%221.5%22%2F%3E%3C%2Fsvg%3E
// @match        *://*/*
// @exclude      *://115.com/*
// @exclude      *://*.115.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @connect      115.com
// @connect      clouddownload.115.com
// @connect      webapi.115.com
// @connect      my.115.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ========================= 常量 ========================= */
  const API_ADD = 'https://clouddownload.115.com/web/';
  const API_FILES = 'https://webapi.115.com/files';
  const API_NAV = 'https://my.115.com/?ct=ajax&ac=nav';
  const URL_OFFLINE = 'https://115.com/?tab=offline&mode=wangpan';
  const URL_LOGIN = 'https://115.com/';
  const CHUNK = 15;          // 每次请求提交的链接数
  const TIMEOUT = 20000;
  const HISTORY_MAX = 5000;
  const HOST = location.hostname;

  /* ========================= 存储 ========================= */
  const store = {
    get(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch { return d; } },
    set(k, v) { try { GM_setValue(k, v); } catch { /* ignore */ } },
  };
  const DEFAULTS = {
    folderId: '',          // 默认保存目录 cid，空 = 115 默认（云下载）
    folderName: '',
    favFolders: [],        // [{cid, name}]
    inlineButtons: true,   // 链接旁显示 115 按钮
    linkifyText: true,     // 纯文本磁力转为可点击链接
    detectEd2k: true,
    detectBareHash: false, // 识别 40 位裸 btih
    showBadge: true,
    hideBadgeWhenEmpty: true,
    hideAdded: false,      // 列表中隐藏已添加
    badgeY: 70,            // 悬浮球纵向位置（vh 百分比）
    disabledHosts: [],
    lang: 'auto',          // 'auto' | 'zh' | 'en'
    defaultTarget: '115',  // '115' | 'aria2' | 'qbit'
    aria2: { enabled: false, rpc: 'http://localhost:6800/jsonrpc', secret: '', dir: '' },
    qbit: { enabled: false, url: 'http://localhost:8080', username: 'admin', password: '', savepath: '', category: '' },
  };
  const loadCfg = () => {
    const s = store.get('cfg', {});
    return { ...DEFAULTS, ...s, aria2: { ...DEFAULTS.aria2, ...(s.aria2 || {}) }, qbit: { ...DEFAULTS.qbit, ...(s.qbit || {}) } };
  };
  let cfg = loadCfg();
  const saveCfg = () => store.set('cfg', cfg);
  /** 界面语言：auto 时跟随浏览器（zh* 用中文，其它用英文） */
  const isZh = () => (cfg.lang === 'zh' || (cfg.lang !== 'en' && /^zh\b/i.test(navigator.language || '')));
  const L = (zh, en) => (isZh() ? zh : en);

  const history = {
    load() { return store.get('history', {}); },
    has(key) { return !!this.cache[key]; },
    add(keys) {
      if (!keys.length) return;
      const h = this.load();               // 合并其它标签页的写入
      const now = Date.now();
      keys.forEach(k => { h[k] = now; });
      const ks = Object.keys(h);
      if (ks.length > HISTORY_MAX) {
        ks.sort((a, b) => h[a] - h[b]).slice(0, ks.length - HISTORY_MAX).forEach(k => delete h[k]);
      }
      store.set('history', h);
      this.cache = h;
    },
    clear() { store.set('history', {}); this.cache = {}; },
    cache: {},
  };
  history.cache = history.load();

  /* ========================= 菜单 / 站点禁用 ========================= */
  const disabledHere = cfg.disabledHosts.includes(HOST);
  const menu = (name, fn) => { try { GM_registerMenuCommand(name, fn); } catch { /* ignore */ } };
  if (disabledHere) {
    menu(L(`✅ 在 ${HOST} 启用磁力探测`, `✅ Enable magnet detection on ${HOST}`), () => {
      cfg.disabledHosts = cfg.disabledHosts.filter(h => h !== HOST); saveCfg(); location.reload();
    });
    return;
  }

  /* ========================= 工具 ========================= */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const fmtSize = n => {
    if (!n || !isFinite(n)) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const chunks = (arr, n) => { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'checked' || k === 'value' || k === 'disabled' || k === 'title' || k === 'placeholder' || k === 'type') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const ICONS = {
    magnet: ['M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0z', 'M5 7h4M15 7h4'],
    close: ['M6 6l12 12M18 6L6 18'],
    locate: ['M12 2v4M12 18v4M2 12h4M18 12h4', 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    folder: ['M3 6h6l2 2h10v11H3z'],
    up: ['M12 19V5M5 12l7-7 7 7'],
    download: ['M12 3v12M7 10l5 5 5-5', 'M4 20h16'],
    star: ['M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9z'],
  };
  function icon(name, size = 16) {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  }
  function copyText(text) {
    try { GM_setClipboard(text, 'text'); return true; } catch { /* fallthrough */ }
    try { navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
  const openTab = url => { try { GM_openInTab(url, { active: true }); } catch { window.open(url, '_blank', 'noopener'); } };

  /* ========================= 链接解析 ========================= */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32ToHex(s) {
    let bits = '';
    for (const c of s.toUpperCase()) { const i = B32.indexOf(c); if (i < 0) return null; bits += i.toString(2).padStart(5, '0'); }
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }
  const TRAIL = /[)\]}>.,;:!?'"，。；：！？、）】」』》”’]+$/;

  /** 解析单个链接，返回 {key,url,name,size,type,hash} 或 null */
  function parseLink(raw) {
    let url = String(raw || '').trim().replace(TRAIL, '');
    if (/^magnet:\?/i.test(url)) {
      const m = url.match(/xt=urn:btih:([0-9a-z]+)/i);
      if (!m) return null;
      let hash = m[1];
      if (hash.length === 32) hash = b32ToHex(hash);
      else if (!(hash.length === 40 && /^[0-9a-f]+$/i.test(hash))) return null;
      if (!hash) return null;
      hash = hash.toLowerCase();
      let name = '', size = 0;
      try {
        const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
        name = q.get('dn') || ''; size = Number(q.get('xl')) || 0;
      } catch { /* ignore */ }
      return { key: 'bt:' + hash, url, name, size, type: 'magnet', hash };
    }
    if (/^ed2k:\/\/\|file\|/i.test(url)) {
      const p = url.split('|');
      const hash = p[4];
      if (!hash || !/^[0-9a-f]{32}$/i.test(hash) || !/^\d+$/.test(p[3])) return null;
      if (!/\|\/$/.test(url)) url = p.slice(0, 5).join('|') + '|/';
      return { key: 'ed2k:' + hash.toLowerCase(), url, name: safeDecode(p[2]), size: Number(p[3]) || 0, type: 'ed2k', hash: hash.toLowerCase() };
    }
    if (/^[0-9a-f]{40}$/i.test(url)) {
      const hash = url.toLowerCase();
      return { key: 'bt:' + hash, url: 'magnet:?xt=urn:btih:' + hash, name: '', size: 0, type: 'magnet', hash };
    }
    return null;
  }

  function textRegex(opts = cfg) {
    const parts = ['magnet:\\?[^\\s<>"\'`\\u3000-\\u303f\\uff00-\\uffef]+'];
    if (opts.detectEd2k) parts.push('ed2k://\\|file\\|[^\\r\\n<>"|]+\\|\\d+\\|[0-9a-fA-F]{32}\\|(?:[^\\s<>"]*?\\|)?/?');
    if (opts.detectBareHash) parts.push('\\b[0-9a-fA-F]{40}\\b');
    return new RegExp(parts.join('|'), 'gi');
  }
  /** 从任意文本中提取所有链接（去重） */
  function extractAll(text, opts) {
    const out = new Map();
    for (const m of String(text).matchAll(textRegex(opts))) {
      const p = parseLink(m[0]);
      if (p && !out.has(p.key)) out.set(p.key, p);
    }
    return [...out.values()];
  }

  /* ========================= 链接注册表 ========================= */
  /** key -> {key,url,name,size,type,hash,els:[],state:'',msg:''} */
  const items = new Map();
  function register(p, el) {
    let it = items.get(p.key);
    if (!it) { it = { ...p, els: [], state: '', msg: '' }; items.set(p.key, it); }
    else {
      if (!it.name && p.name) it.name = p.name;
      if (!it.size && p.size) it.size = p.size;
      if (p.url.length > it.url.length && p.type === it.type) it.url = p.url; // 保留信息更全的版本（含 tracker/dn）
    }
    if (el && !it.els.includes(el)) it.els.push(el);
    scheduleRefresh();
    return it;
  }
  function liveItems() {
    for (const [k, it] of items) {
      it.els = it.els.filter(e => e.isConnected);
      if (!it.els.length && !it.state) items.delete(k);
    }
    const first = it => it.els.find(e => e.isConnected);
    return [...items.values()].filter(it => it.els.length)
      .sort((a, b) => (first(a).compareDocumentPosition(first(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }
  const isAdded = it => it.state === 'added' || it.state === 'existed' || history.has(it.key);

  /* ========================= 115 API ========================= */
  const connErr = m => Object.assign(new Error(m), { conn: true });
  function gm(opts, netMsg = L('网络异常，无法连接 115', 'Network error: cannot reach 115')) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: TIMEOUT, anonymous: false, ...opts,
        onload: r => resolve({ status: r.status, text: r.responseText ?? '' }),
        onerror: () => reject(new Error(netMsg)),
        ontimeout: () => reject(new Error(L('请求超时', 'Request timed out'))),
      });
    });
  }
  const DUP_RE = /无法重复|任务已存在|重复(?:下载|添加)|请勿重复|无需重复|already exists/i;
  const codeOf = j => j?.errcode ?? j?.errno ?? j?.code;
  const isDup = j => Number(codeOf(j)) === 10008 || DUP_RE.test(String(j?.error_msg || j?.error || j?.msg || ''));
  const errText = j => j?.error_msg || j?.error || j?.msg || L(`错误码 ${codeOf(j)}`, `Error code ${codeOf(j)}`);
  const isLoginErr = j => [990001, 99, 990002].includes(Number(codeOf(j))) || /登录|login/i.test(errText(j));

  /**
   * 提交链接到 115 云下载
   * @returns {{per: Map<url,{status:'added'|'existed'|'failed',msg}>, fatal: null|'login'|'verify', fatalMsg}}
   */
  async function add115(urls, cid) {
    const per = new Map();
    let fatal = null, fatalMsg = '';
    for (const part of chunks(urls, CHUNK)) {
      if (fatal) { part.forEach(u => per.set(u, { status: 'failed', msg: fatalMsg })); continue; }
      const form = new URLSearchParams({ ac: 'add_task_urls' });
      part.forEach((u, i) => form.set(`url[${i}]`, u));
      if (cid) form.set('wp_path_id', cid);
      let r;
      try {
        r = await gm({ method: 'POST', url: API_ADD, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: form.toString() });
      } catch (e) {
        part.forEach(u => per.set(u, { status: 'failed', msg: e.message })); continue;
      }
      let j;
      try { j = JSON.parse(r.text); } catch {
        fatal = 'login'; fatalMsg = L(`HTTP ${r.status}，可能未登录 115`, `HTTP ${r.status}, probably not signed in to 115`);
        part.forEach(u => per.set(u, { status: 'failed', msg: fatalMsg })); continue;
      }
      if (!j.state) {
        if (isDup(j)) { part.forEach(u => per.set(u, { status: 'existed', msg: errText(j) })); continue; }
        const msg = errText(j);
        if (Number(codeOf(j)) === 911) { fatal = 'verify'; fatalMsg = L(`${msg}（需要在 115 网页版完成一次验证）`, `${msg} (verify once on the 115 website first)`); }
        else if (isLoginErr(j)) { fatal = 'login'; fatalMsg = L(`${msg}（请先登录 115）`, `${msg} (please sign in to 115)`); }
        part.forEach(u => per.set(u, { status: 'failed', msg: fatalMsg || msg }));
        continue;
      }
      const res = Array.isArray(j.result) ? j.result : [];
      part.forEach((u, i) => {
        const x = res.find(r => r && r.url === u) || res[i];
        if (!x || x.state) per.set(u, { status: 'added', msg: '' });
        else if (isDup(x)) per.set(u, { status: 'existed', msg: errText(x) });
        else per.set(u, { status: 'failed', msg: errText(x) });
      });
      if (urls.length > CHUNK) await sleep(300);
    }
    return { per, fatal, fatalMsg };
  }

  async function listFolders(cid) {
    const q = new URLSearchParams({
      aid: '1', cid: String(cid || 0), o: 'user_ptime', asc: '0', offset: '0',
      show_dir: '1', limit: '1000', natsort: '0', format: 'json', record_open_time: '0',
    });
    const r = await gm({ method: 'GET', url: `${API_FILES}?${q}` });
    let j;
    try { j = JSON.parse(r.text); } catch { throw new Error(L('读取目录失败，可能未登录 115', 'Failed to load folders, probably not signed in to 115')); }
    if (!j.state) throw new Error(errText(j) || L('读取目录失败', 'Failed to load folders'));
    const dirs = (j.data || [])
      .filter(x => x && x.cid != null && x.fid == null)
      .map(x => ({ cid: String(x.cid), name: String(x.n ?? x.name ?? x.cid) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
    const ROOT = L('根目录', 'Root');
    let path = (j.path || []).map(p => ({ cid: String(p.cid), name: String(p.cid) === '0' ? ROOT : String(p.name || p.cid) }));
    if (!path.length || path[0].cid !== '0') path.unshift({ cid: '0', name: ROOT });
    path = path.filter((p, i, a) => a.findIndex(x => x.cid === p.cid) === i);
    return { dirs, path };
  }

  async function checkLogin() {
    try {
      const r = await gm({ method: 'GET', url: API_NAV });
      const j = JSON.parse(r.text);
      if (j.state && j.data) return { ok: true, name: j.data.user_name || j.data.user_id || '' };
      return { ok: false };
    } catch { return { ok: null }; }
  }

  /* ========================= aria2 / qBittorrent ========================= */
  const isLoopback = host => host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
  /** 校验用户配置的服务地址；非本机地址首次连接需确认 */
  function checkUrl(raw, name) {
    raw = String(raw ?? '').trim();
    const badScheme = L(`${name} 地址需以 http:// 或 https:// 开头`, `${name} URL must start with http:// or https://`);
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) throw connErr(L(`${name} 地址未填写或格式无效`, `${name} URL is empty or invalid`));
    let u;
    try { u = new URL(raw); } catch { throw connErr(badScheme); }
    if (!/^https?:$/.test(u.protocol)) throw connErr(badScheme);
    if (u.username || u.password) throw connErr(L(`${name} 地址中不能包含账号密码`, `${name} URL must not contain credentials`));
    if (!isLoopback(u.hostname)) {
      const allowed = store.get('allowedHosts', []);
      if (!allowed.includes(u.host)) {
        if (!confirm(L(`确认将下载任务发送到 ${u.host}（${name}）？\n\n仅当该服务由你本人控制时点击「确定」。`,
          `Send download tasks to ${u.host} (${name})?\n\nOnly click OK if you control this service.`))) throw connErr(L(`未授权连接 ${u.host}`, `Connection to ${u.host} not allowed`));
        store.set('allowedHosts', [...allowed, u.host]);
      }
    }
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }
  const noCtrl = (v, name) => {
    if (/[\r\n\u0000]/.test(v || '')) throw new Error(L(`${name} 包含非法字符`, `${name} contains invalid characters`));
    return v || '';
  };

  const ARIA2_NET = () => L('无法连接 aria2：请检查 RPC 地址、aria2 是否运行以及 --enable-rpc', 'Cannot reach aria2: check the RPC URL, that aria2 is running, and --enable-rpc');
  async function aria2Call(method, params = []) {
    const a = cfg.aria2;
    const url = checkUrl(a.rpc, 'aria2 RPC');
    const token = a.secret ? [`token:${a.secret}`] : [];
    const r = await gm({
      method: 'POST', url, headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ jsonrpc: '2.0', id: 'm115', method, params: [...token, ...params] }),
    }, ARIA2_NET()).catch(e => { throw connErr(e.message); });
    let j;
    try { j = JSON.parse(r.text); } catch { throw connErr(L(`aria2 返回 HTTP ${r.status}，请检查 RPC 地址`, `aria2 returned HTTP ${r.status}, check the RPC URL`)); }
    if (j.error) {
      if (j.error.message === 'Unauthorized') throw connErr(L('aria2 密钥（secret）错误', 'Wrong aria2 secret'));
      throw new Error(`aria2: ${String(j.error.message).slice(0, 100)}`);
    }
    return j.result;
  }
  async function addAria2(urls) {
    const per = new Map();
    const opt = cfg.aria2.dir ? { dir: noCtrl(cfg.aria2.dir, L('保存目录', 'Save folder')) } : {};
    let fatalMsg = '';
    for (const u of urls) {
      if (fatalMsg) { per.set(u, { status: 'failed', msg: fatalMsg }); continue; }
      try {
        await aria2Call('aria2.addUri', [[u], opt]);
        per.set(u, { status: 'added', msg: '' });
      } catch (e) {
        if (/already registered|duplicate/i.test(e.message)) per.set(u, { status: 'existed', msg: e.message });
        else {
          per.set(u, { status: 'failed', msg: e.message });
          if (e.conn) fatalMsg = e.message; // 连接级错误，后续不再尝试
        }
      }
    }
    return { per, fatal: fatalMsg ? 'conn' : null, fatalMsg };
  }

  const QB_NET = () => L('无法连接 qBittorrent：请检查 WebUI 地址、程序是否运行以及是否开启 WebUI', 'Cannot reach qBittorrent: check the WebUI URL, that it is running, and that WebUI is enabled');
  async function qbitReq(opts) {
    const q = cfg.qbit;
    const base = checkUrl(q.url, 'qBittorrent WebUI');
    const hdr = { Referer: `${base}/`, Origin: base };
    const send = () => gm({ ...opts, url: base + opts.path, headers: { ...hdr, ...(opts.headers || {}) } }, QB_NET());
    const r = await send();
    if (r.status !== 403 && r.status !== 401) return r;
    const lr = await gm({
      method: 'POST', url: `${base}/api/v2/auth/login`,
      headers: { ...hdr, 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({ username: q.username || '', password: q.password || '' }).toString(),
    }, QB_NET());
    if (lr.status === 403) throw new Error(L('qBittorrent 登录失败次数过多，IP 已被临时封禁', 'Too many failed qBittorrent logins, IP temporarily banned'));
    if (lr.status !== 200 || lr.text.trim() === 'Fails.') throw new Error(L('qBittorrent 用户名或密码错误', 'Wrong qBittorrent username or password'));
    return send();
  }
  async function addQbit(urls) {
    const per = new Map();
    const fail = msg => { urls.forEach(u => per.set(u, { status: 'failed', msg })); return { per, fatal: 'conn', fatalMsg: msg }; };
    try {
      const q = cfg.qbit;
      const buf = new Uint8Array(12); crypto.getRandomValues(buf);
      const boundary = '----m115' + Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
      const fields = { urls: urls.join('\n'), savepath: noCtrl(q.savepath, L('保存目录', 'Save path')), category: noCtrl(q.category, L('分类', 'Category')) };
      const data = Object.entries(fields).filter(([, v]) => v)
        .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${boundary}--\r\n`;
      const r = await qbitReq({ method: 'POST', path: '/api/v2/torrents/add', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, data });
      if (r.status === 200 && r.text.trim() !== 'Fails.') { urls.forEach(u => per.set(u, { status: 'added', msg: '' })); return { per, fatal: null }; }
      if (r.status === 200) { urls.forEach(u => per.set(u, { status: 'failed', msg: L('qBittorrent 拒绝添加（可能已存在或链接无效）', 'qBittorrent rejected it (already exists or invalid link)') })); return { per, fatal: null }; }
      return fail(L(`qBittorrent 添加失败（HTTP ${r.status}）`, `qBittorrent add failed (HTTP ${r.status})`));
    } catch (e) { return fail(e.message); }
  }

  async function testTarget(type) {
    const ver = v => { const s = String(v ?? '').trim(); return /^v?\d[\w.+-]{0,30}$/.test(s) ? s : ''; };
    const okMsg = L('连接成功', 'connected');
    if (type === 'aria2') return `aria2 ${ver((await aria2Call('aria2.getVersion'))?.version) || ''} ${okMsg}`;
    const r = await qbitReq({ method: 'GET', path: '/api/v2/app/version' });
    if (r.status !== 200) throw new Error(L(`qBittorrent 返回 HTTP ${r.status}`, `qBittorrent returned HTTP ${r.status}`));
    return `qBittorrent ${ver(r.text)} ${okMsg}`;
  }

  /* ========================= 下载目标 ========================= */
  // dest: {type:'115', cid, name} | {type:'aria2', name} | {type:'qbit', name}
  const SHORT = { 115: '115', aria2: 'aria2', qbit: 'qB' };
  const folderLabel = () => cfg.folderName || (cfg.folderId ? L(`目录 ${cfg.folderId}`, `Folder ${cfg.folderId}`) : L('默认目录', 'Default folder'));
  const DEF = () => L('（默认）', ' (default)');
  const destKey = d => (d.type === '115' ? `115:${d.cid}` : d.type);
  const destLabel = d => (d.type === '115' ? `115 · ${d.name}` : d.name);
  const aria2Dest = () => ({ type: 'aria2', name: cfg.aria2.dir ? `aria2 · ${cfg.aria2.dir}` : 'aria2' });
  const qbitDest = () => ({ type: 'qbit', name: `qBittorrent${cfg.qbit.category ? ' · ' + cfg.qbit.category : cfg.qbit.savepath ? ' · ' + cfg.qbit.savepath : ''}` });
  function defaultDest() {
    if (cfg.defaultTarget === 'aria2' && cfg.aria2.enabled) return aria2Dest();
    if (cfg.defaultTarget === 'qbit' && cfg.qbit.enabled) return qbitDest();
    return { type: '115', cid: cfg.folderId, name: folderLabel() };
  }
  function destChoices() {
    const list = [{ type: '115', cid: cfg.folderId, name: folderLabel() }];
    for (const f of cfg.favFolders) if (!list.some(x => x.cid === f.cid)) list.push({ type: '115', cid: f.cid, name: f.name });
    if (cfg.aria2.enabled) list.push(aria2Dest());
    if (cfg.qbit.enabled) list.push(qbitDest());
    const dk = destKey(defaultDest());
    const i = list.findIndex(d => destKey(d) === dk);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
    list[0].isDefault = true;
    return list;
  }
  const destFromFolder = f => ({ type: '115', cid: String(f.cid), name: f.name });

  /* ========================= 发送流程 ========================= */
  async function sendTo(list, dest) {
    list = list.filter(it => it.state !== 'loading');
    if (!list.length) return;
    dest = dest || defaultDest();
    const label = destLabel(dest);
    list.forEach(it => { it.state = 'loading'; it.msg = ''; });
    refreshAll();
    const t = toast(L(`正在发送 ${list.length} 个链接到「${label}」…`, `Sending ${list.length} link(s) to "${label}"…`), { type: 'info', timeout: 0 });
    let res;
    try {
      const urls = list.map(it => it.url);
      res = dest.type === 'aria2' ? await addAria2(urls)
        : dest.type === 'qbit' ? await addQbit(urls)
          : await add115(urls, dest.cid);
    } catch (e) {
      list.forEach(it => { it.state = 'error'; it.msg = e.message; });
      t.close(); toast(L(`发送失败：${e.message}`, `Send failed: ${e.message}`), { type: 'err' }); refreshAll(); return;
    }
    t.close();
    let added = 0, existed = 0; const failed = []; const ok = [];
    for (const it of list) {
      const r = res.per.get(it.url) || { status: 'failed', msg: L('无返回', 'No response') };
      it.state = r.status === 'failed' ? 'error' : r.status; it.msg = r.msg;
      if (r.status === 'added') { added++; ok.push(it.key); }
      else if (r.status === 'existed') { existed++; ok.push(it.key); }
      else failed.push(it);
    }
    history.add(ok);
    ok.forEach(k => P.sel.delete(k));   // 成功项自动取消勾选，方便处理剩余项
    refreshAll();

    const parts = [];
    if (added) parts.push(L(`成功 ${added}`, `${added} added`));
    if (existed) parts.push(L(`已存在 ${existed}`, `${existed} already existed`));
    if (failed.length) parts.push(L(`失败 ${failed.length}`, `${failed.length} failed`));
    const sum = parts.join(L('，', ', '));
    const actions = dest.type === '115' ? [{ text: L('打开云下载', 'Open 115 downloads'), fn: () => openTab(URL_OFFLINE) }] : [];
    if (res.fatal === 'verify') {
      toast(res.fatalMsg, { type: 'err', timeout: 0, actions: [{ text: L('去 115 验证', 'Verify on 115'), fn: () => openTab(URL_OFFLINE) }] });
    } else if (res.fatal === 'login') {
      toast(res.fatalMsg, { type: 'err', timeout: 0, actions: [{ text: L('登录 115', 'Sign in to 115'), fn: () => openTab(URL_LOGIN) }] });
    } else if (res.fatal === 'conn') {
      toast(res.fatalMsg, { type: 'err', timeout: 10000, actions: [{ text: L('打开设置', 'Settings'), fn: () => openPanel('settings') }, { text: L('重试', 'Retry'), fn: () => sendTo(failed, dest) }] });
    } else if (failed.length) {
      actions.unshift({ text: L('重试失败项', 'Retry failed'), fn: () => sendTo(failed, dest) });
      toast(`${sum} | ${failed[0].msg}`, { type: added || existed ? 'warn' : 'err', timeout: 10000, actions });
    } else {
      toast(L(`已发送到「${label}」：${sum}`, `Sent to "${label}": ${sum}`), { type: 'ok', actions });
    }
  }

  /* ========================= 内联按钮 ========================= */
  const BTN_CSS = `
    :host{all:initial}
    button{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:2px;
      height:14px;padding:0 4px;border-radius:4px;background:#2777f8;color:#fff;opacity:.75;
      font:600 9.5px/14px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer;white-space:nowrap;
      transition:opacity .15s,transform .1s;user-select:none}
    button:hover{opacity:1} button:active{transform:scale(.94)}
    button.done{background:#16a34a} button.err{background:#dc2626} button.busy{background:#64748b;cursor:progress}`;
  const buttons = new Set();

  function makeBtn(list) {
    const host = document.createElement('span');
    host.setAttribute('data-m115', 'btn');
    host.style.cssText = 'all:initial;display:inline-block;vertical-align:middle;margin:0 1px 0 3px;line-height:0;';
    const sr = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = BTN_CSS;
    const b = document.createElement('button');
    sr.append(style, b);
    const rec = {
      host, list,
      render() {
        const busy = list.some(it => it.state === 'loading');
        const err = list.find(it => it.state === 'error');
        const done = list.every(isAdded);
        b.className = busy ? 'busy' : err ? 'err' : done ? 'done' : '';
        const n = list.length > 1 ? ` ×${list.length}` : '';
        const dest = defaultDest();
        const s = SHORT[dest.type];
        b.textContent = busy ? '…' : err ? `!${s}${n}` : done ? `✓${s}${n}` : `${s}${n}`;
        const nm = list.length === 1 ? (list[0].name || list[0].hash) : L(`${list.length} 个链接`, `${list.length} links`);
        b.title = [
          nm,
          err ? L(`上次失败：${err.msg}`, `Last attempt failed: ${err.msg}`) : done ? L('已添加过（点击可再次提交）', 'Already added (click to send again)') : '',
          L(`点击：发送到「${destLabel(dest)}」`, `Click: send to "${destLabel(dest)}"`),
          L('右键 / Shift+点击：选择目标 / 目录', 'Right-click / Shift+click: choose target or folder'),
          L('Alt+点击：复制链接', 'Alt+click: copy link'),
        ].filter(Boolean).join('\n');
      },
    };
    const stop = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    b.addEventListener('click', e => {
      stop(e);
      if (e.altKey) { copyText(list.map(it => it.url).join('\n')); toast(L('已复制链接', 'Link copied'), { type: 'ok', timeout: 1500 }); return; }
      if (e.shiftKey) { const r = b.getBoundingClientRect(); showDestMenu(r.left, r.bottom + 4, d => sendTo(list, d)); return; }
      sendTo(list);
    }, true);
    b.addEventListener('contextmenu', e => { stop(e); showDestMenu(e.clientX, e.clientY, d => sendTo(list, d)); }, true);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
    buttons.add(rec);
    rec.render();
    return host;
  }
  function renderButtons() {
    for (const r of buttons) { if (!r.host.isConnected) buttons.delete(r); else r.render(); }
  }

  /* ========================= 页面扫描 ========================= */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'IFRAME', 'CANVAS', 'SVG', 'MATH']);
  const seen = new WeakSet();
  const LINK_ATTRS = ['data-clipboard-text', 'data-magnet', 'data-href', 'data-url', 'data-link', 'data-src', 'data-copy', 'value'];
  const ATTR_SEL = LINK_ATTRS.filter(a => a !== 'value').map(a => `[${a}*="magnet:?" i],[${a}^="ed2k://" i]`).join(',');
  const QUICK = () => (cfg.detectBareHash ? /magnet:\?|ed2k:\/\/|[0-9a-f]{40}/i : /magnet:\?|ed2k:\/\//i);

  const inUI = el => !!el.closest('[data-m115]');

  function scanAnchors(root) {
    const list = root.querySelectorAll ? [...root.querySelectorAll('a[href^="magnet:" i],a[href^="ed2k:" i]')] : [];
    if (root.matches && root.matches('a[href^="magnet:" i],a[href^="ed2k:" i]')) list.push(root);
    for (const a of list) {
      if (seen.has(a) || inUI(a)) continue;
      seen.add(a);
      const p = parseLink(a.getAttribute('href'));
      if (!p) continue;
      if (p.type === 'ed2k' && !cfg.detectEd2k) continue;
      const it = register(p, a);
      if (cfg.inlineButtons && !a.hasAttribute('data-m115-t')) a.after(makeBtn([it]));
    }
  }

  function scanAttrs(root) {
    if (!root.querySelectorAll) return;
    const list = [...root.querySelectorAll(ATTR_SEL)];
    if (root.matches && root.matches(ATTR_SEL)) list.push(root);
    for (const el of list) {
      if (seen.has(el) || inUI(el) || el.matches('a[href^="magnet:" i],a[href^="ed2k:" i]')) continue;
      seen.add(el);
      const found = [];
      for (const a of LINK_ATTRS) {
        const v = el.getAttribute(a);
        if (v && QUICK().test(v)) found.push(...extractAll(v));
      }
      const its = [...new Map(found.map(p => [p.key, p])).values()].map(p => register(p, el));
      if (its.length && cfg.inlineButtons) el.after(makeBtn(its));
    }
  }

  function scanFields(root) {
    if (!root.querySelectorAll) return;
    const list = [...root.querySelectorAll('textarea,input:not([type]),input[type="text"],input[type="url"],input[type="search"]')];
    for (const el of list) {
      if (seen.has(el) || inUI(el)) continue;
      const v = el.value || el.textContent || '';
      if (!QUICK().test(v)) continue;
      seen.add(el);
      const its = extractAll(v).map(p => register(p, el));
      if (its.length && cfg.inlineButtons) el.after(makeBtn(its));
    }
  }

  function acceptText(n) {
    if (n.data.length < 20 || !QUICK().test(n.data)) return false;
    const p = n.parentElement;
    if (!p || SKIP_TAGS.has(p.tagName.toUpperCase()) || p.isContentEditable) return false;
    if (p.closest('[data-m115],[data-m115-t],a[href^="magnet:" i],a[href^="ed2k:" i]')) return false;
    return true;
  }

  function processText(node) {
    const text = node.data;
    const re = textRegex();
    const matches = [...text.matchAll(re)];
    if (!matches.length) return;
    const inAnchor = !!node.parentElement.closest('a,button');
    const frag = document.createDocumentFragment();
    let last = 0, hit = false;
    for (const m of matches) {
      const raw = m[0];
      const clean = raw.replace(TRAIL, '');
      const p = parseLink(clean);
      if (!p) continue;
      hit = true;
      const start = m.index, end = m.index + clean.length;
      if (start > last) frag.append(text.slice(last, start));
      const it = register(p, null);
      let el;
      if (cfg.linkifyText && !inAnchor) {
        el = h('a', { href: p.url, 'data-m115-t': '1', title: p.name || p.hash, style: 'word-break:break-all' }, clean);
      } else {
        el = h('span', { 'data-m115-t': '1' }, clean);
      }
      seen.add(el);
      register(p, el);
      frag.append(el);
      if (cfg.inlineButtons) frag.append(makeBtn([it]));
      last = end;
    }
    if (!hit) return;
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }

  function scanText(root) {
    if (root.nodeType === 3) { if (root.isConnected && acceptText(root)) processText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const nodes = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (acceptText(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(processText);
  }

  function scan(root) {
    if (!root) return;
    try {
      if (root.nodeType === 1 || root.nodeType === 9) {
        if (root.nodeType === 1 && inUI(root)) return;
        scanAnchors(root); scanAttrs(root); scanFields(root);
      }
      scanText(root);
    } catch (e) { console.warn('[magnet-to-115] scan error', e); }
  }

  /* 动态内容监听 */
  const pending = new Set();
  let scanTimer = 0;
  function flush() {
    scanTimer = 0;
    const nodes = [...pending]; pending.clear();
    for (const n of nodes) {
      if (!n.isConnected) continue;
      // 跳过已被其它待扫描祖先覆盖的节点
      let covered = false;
      for (let p = n.parentNode; p; p = p.parentNode) if (pending.has(p)) { covered = true; break; }
      if (!covered) scan(n);
    }
  }
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') { if (m.target.parentElement && !inUI(m.target.parentElement)) pending.add(m.target); continue; }
      if (m.type === 'attributes') { const t = m.target; if (!seen.has(t) && !inUI(t)) pending.add(t); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) { if (n.hasAttribute('data-m115') || n.hasAttribute('data-m115-t')) continue; pending.add(n); }
        else if (n.nodeType === 3) pending.add(n);
      }
    }
    if (pending.size && !scanTimer) scanTimer = setTimeout(flush, 250);
  });

  /* ========================= 主 UI ========================= */
  const UI_CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .v{--bg:#fff;--fg:#1f2328;--mut:#6b7280;--bd:#e5e7eb;--hv:#f3f4f6;--ac:#2777f8;--ok:#16a34a;--warn:#d97706;--err:#dc2626;
     --sh:0 12px 32px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.08);
     font:13px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg)}
  @media (prefers-color-scheme:dark){.v{--bg:#1e2126;--fg:#e6e8eb;--mut:#9aa0a6;--bd:#353a41;--hv:#2a2f36;--ac:#4b8dfb;--sh:0 12px 32px rgba(0,0,0,.55)}}
  button{font:inherit;color:inherit;cursor:pointer}
  .badge{position:fixed;right:8px;width:30px;height:30px;padding:0;border-radius:50%;background:var(--ac);color:#fff;border:none;
     display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2);z-index:2;touch-action:none;user-select:none;
     opacity:.45;transition:opacity .2s,transform .15s}
  .badge:hover{opacity:1;transform:scale(1.08)}
  .badge .cnt{position:absolute;top:-5px;right:-5px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#ef4444;
     color:#fff;font:700 9px/15px system-ui,sans-serif;text-align:center}
  .panel{position:fixed;right:14px;bottom:14px;width:min(460px,calc(100vw - 28px));height:min(600px,calc(100vh - 28px));display:flex;flex-direction:column;
     background:var(--bg);border:1px solid var(--bd);border-radius:12px;box-shadow:var(--sh);overflow:hidden;z-index:3}
  .hd{display:flex;align-items:center;gap:6px;padding:8px 8px 0 12px;border-bottom:1px solid var(--bd)}
  .hd .ttl{display:flex;align-items:center;gap:6px;font-weight:700;color:var(--ac);margin-right:6px;padding-bottom:8px}
  .tabs{display:flex;gap:2px;flex:1}
  .tab{background:none;border:none;padding:6px 10px 9px;border-bottom:2px solid transparent;color:var(--mut)}
  .tab.on{color:var(--fg);border-bottom-color:var(--ac);font-weight:600}
  .x{background:none;border:none;padding:4px;border-radius:6px;color:var(--mut);display:flex;margin-bottom:8px}
  .x:hover{background:var(--hv);color:var(--fg)}
  .bd{flex:1;overflow:auto;min-height:0}
  .bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--bg);z-index:1}
  .bar input[type=search]{flex:1;min-width:0}
  input[type=search],input[type=text],textarea,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--bd);border-radius:7px;padding:5px 8px;outline:none}
  input:focus,textarea:focus,select:focus{border-color:var(--ac)}
  label.ck{display:inline-flex;align-items:center;gap:5px;color:var(--mut);white-space:nowrap;cursor:pointer}
  input[type=checkbox]{accent-color:var(--ac);margin:0;width:15px;height:15px;cursor:pointer}
  .row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--bd);cursor:pointer}
  .row:hover{background:var(--hv)}
  .row .mn{flex:1;min-width:0}
  .row .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
  .row .sb{display:flex;gap:8px;color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden}
  .tag{font-size:11px;padding:0 6px;border-radius:9px;border:1px solid var(--bd);color:var(--mut)}
  .tag.ok{color:var(--ok);border-color:currentColor}.tag.err{color:var(--err);border-color:currentColor}.tag.busy{color:var(--ac);border-color:currentColor}
  .ib{background:none;border:none;padding:4px;border-radius:6px;color:var(--mut);display:flex}
  .ib:hover{background:var(--bd);color:var(--fg)}
  .empty{padding:40px 16px;text-align:center;color:var(--mut)}
  .ft{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--bd)}
  .ft select{flex:1;min-width:0}
  .btn{border:1px solid var(--bd);background:var(--bg);border-radius:7px;padding:6px 12px;white-space:nowrap}
  .btn:hover{background:var(--hv)}
  .btn.pr{background:var(--ac);border-color:var(--ac);color:#fff;font-weight:600}
  .btn.pr:hover{filter:brightness(1.1)}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn.sm{padding:3px 9px;font-size:12px}
  .sec{padding:12px;border-bottom:1px solid var(--bd)}
  .sec h4{margin:0 0 8px;font-size:12px;color:var(--mut);font-weight:600}
  .line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}
  .line .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 9px;border:1px solid var(--bd);border-radius:12px;font-size:12px}
  .chip button{background:none;border:none;padding:1px;display:flex;color:var(--mut);border-radius:50%}
  .chip button:hover{color:var(--err)}
  .mut{color:var(--mut);font-size:12px}
  textarea{width:100%;min-height:180px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .menu{position:fixed;min-width:200px;max-width:320px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;box-shadow:var(--sh);padding:4px;z-index:5}
  .menu .mh{padding:4px 10px;color:var(--mut);font-size:12px}
  .menu button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;padding:7px 10px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .menu button:hover{background:var(--hv)}
  .mask{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:6}
  .dlg{width:min(480px,calc(100vw - 28px));height:min(560px,calc(100vh - 40px));background:var(--bg);border-radius:12px;box-shadow:var(--sh);display:flex;flex-direction:column;overflow:hidden}
  .dlg .hd{padding:10px 8px 10px 14px;font-weight:700}
  .crumb{display:flex;flex-wrap:wrap;gap:2px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:12px}
  .crumb button{background:none;border:none;color:var(--ac);padding:2px 4px;border-radius:5px}
  .crumb button:hover{background:var(--hv)}
  .dir{display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;border-bottom:1px solid var(--bd)}
  .dir:hover{background:var(--hv)}
  .dir svg{color:#f5a623;flex:none}
  .toasts{position:fixed;left:50%;top:20px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:7;pointer-events:none}
  .toast{pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 28px));padding:9px 12px 9px 14px;border-radius:9px;
     background:#1f2328;color:#fff;box-shadow:var(--sh);border-left:4px solid var(--ac);animation:tin .18s ease-out}
  .toast.ok{border-left-color:#22c55e}.toast.err{border-left-color:#ef4444}.toast.warn{border-left-color:#f59e0b}
  .toast .msg{flex:1;word-break:break-all}
  .toast button{background:rgba(255,255,255,.12);border:none;color:#fff;border-radius:6px;padding:3px 9px;white-space:nowrap}
  .toast button:hover{background:rgba(255,255,255,.22)}
  @keyframes tin{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
  .kbd{font-family:ui-monospace,Consolas,monospace;font-size:11px;padding:0 4px;border:1px solid var(--bd);border-radius:4px}
  `;

  let UI = null;
  function ui() {
    if (UI) return UI;
    const host = document.createElement('div');
    host.setAttribute('data-m115', 'ui');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
    const sr = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = UI_CSS;
    const root = h('div', { class: 'v' });
    const toasts = h('div', { class: 'toasts' });
    root.append(toasts);
    sr.append(st, root);
    document.documentElement.append(host);
    UI = { host, sr, root, toasts, badge: null, panel: null, menu: null };
    return UI;
  }

  /* ---------- Toast ---------- */
  function toast(msg, { type = 'info', timeout = 4000, actions = [] } = {}) {
    const { toasts } = ui();
    const el = h('div', { class: `toast ${type}` }, h('span', { class: 'msg' }, msg));
    let closed = false;
    const close = () => { if (!closed) { closed = true; el.remove(); } };
    for (const a of actions) el.append(h('button', { onclick: () => { a.fn(); close(); } }, a.text));
    el.append(h('button', { onclick: close, title: L('关闭', 'Close') }, '×'));
    toasts.append(el);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    if (timeout) setTimeout(close, timeout);
    return { close };
  }

  /* ---------- 目录快捷菜单 ---------- */
  function closeMenu() { if (UI?.menu) { UI.menu.remove(); UI.menu = null; } }
  function showDestMenu(x, y, onPick) {
    closeMenu();
    const u = ui();
    const m = h('div', { class: 'menu' }, h('div', { class: 'mh' }, L('发送到…', 'Send to…')));
    for (const d of destChoices()) {
      const label = destLabel(d);
      m.append(h('button', { title: label, onclick: () => { closeMenu(); onPick(d); } },
        icon(d.isDefault ? 'star' : d.type === '115' ? 'folder' : 'download', 14), d.isDefault ? label + DEF() : label));
    }
    m.append(h('button', { onclick: () => { closeMenu(); openFolderPicker(L('选择 115 保存目录', 'Choose 115 folder'), f => onPick(destFromFolder(f))); } }, icon('folder', 14), L('浏览 115 目录…', 'Browse 115 folders…')));
    u.root.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    u.menu = m;
  }
  document.addEventListener('pointerdown', e => {
    if (UI?.menu && !e.composedPath().includes(UI.menu)) closeMenu();
  }, true);

  /* ---------- 目录浏览器 ---------- */
  function openFolderPicker(title, onPick, { extra } = {}) {
    const u = ui();
    let cur = { cid: '0', name: L('根目录', 'Root') };
    const crumb = h('div', { class: 'crumb' });
    const listEl = h('div', { class: 'bd' });
    const cidIn = h('input', { type: 'text', placeholder: L('或输入目录 ID (cid)', 'Or enter folder ID (cid)'), style: 'flex:1;min-width:0' });
    const pickBtn = h('button', { class: 'btn pr' }, L('选择此目录', 'Choose this folder'));
    const close = () => mask.remove();
    const dlg = h('div', { class: 'dlg' },
      h('div', { class: 'hd', style: 'border-bottom:1px solid var(--bd)' },
        h('span', { style: 'flex:1' }, title),
        h('button', { class: 'x', style: 'margin:0', onclick: close }, icon('close'))),
      crumb, listEl,
      h('div', { class: 'ft' }, cidIn, h('button', { class: 'btn', onclick: () => { const v = cidIn.value.trim(); if (/^\d+$/.test(v)) load(v); } }, L('转到', 'Go')), pickBtn));
    const mask = h('div', { class: 'mask', onclick: e => { if (e.target === mask) close(); } }, dlg);
    pickBtn.addEventListener('click', () => { close(); onPick({ cid: cur.cid === '0' ? '0' : cur.cid, name: cur.name }); });
    if (extra) dlg.querySelector('.ft').prepend(extra(() => cur, close));
    u.root.append(mask);

    async function load(cid) {
      listEl.replaceChildren(h('div', { class: 'empty' }, L('加载中…', 'Loading…')));
      try {
        const { dirs, path } = await listFolders(cid);
        cur = path[path.length - 1] || { cid, name: cid };
        if (String(cur.cid) !== String(cid)) cur = { cid: String(cid), name: cur.name };
        crumb.replaceChildren(...path.flatMap((p, i) => [
          i ? h('span', { class: 'mut' }, '/') : null,
          h('button', { onclick: () => load(p.cid) }, p.name),
        ]).filter(Boolean));
        pickBtn.textContent = L(`选择「${cur.name}」`, `Choose "${cur.name}"`);
        listEl.replaceChildren(...(dirs.length ? dirs.map(d => h('div', { class: 'dir', onclick: () => load(d.cid) },
          icon('folder', 18), h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, d.name))) : [h('div', { class: 'empty' }, L('没有子目录', 'No subfolders'))]));
      } catch (e) {
        listEl.replaceChildren(h('div', { class: 'empty' }, e.message, h('br'), h('br'),
          h('button', { class: 'btn', onclick: () => openTab(URL_LOGIN) }, L('登录 115', 'Sign in to 115')), ' ',
          h('button', { class: 'btn', onclick: () => load(cid) }, L('重试', 'Retry'))));
      }
    }
    load('0');
  }

  /* ---------- 悬浮球 ---------- */
  function renderBadge() {
    const u = ui();
    const n = liveItems().length;
    const show = cfg.showBadge && !(cfg.hideBadgeWhenEmpty && n === 0) && !P.open;
    if (!show) { if (u.badge) u.badge.style.display = 'none'; return; }
    if (!u.badge) {
      const cnt = h('span', { class: 'cnt' });
      const b = h('button', { class: 'badge', title: L('磁力链接面板（Alt+Shift+M）\n拖动可调整位置', 'Magnet links panel (Alt+Shift+M)\nDrag to move') }, icon('magnet', 15), cnt);
      b.style.top = `calc(${cfg.badgeY}vh - 15px)`;
      let sy = 0, moved = false, startTop = 0;
      b.addEventListener('pointerdown', e => {
        sy = e.clientY; moved = false; startTop = b.getBoundingClientRect().top; b.setPointerCapture(e.pointerId);
      });
      b.addEventListener('pointermove', e => {
        if (!b.hasPointerCapture(e.pointerId)) return;
        const dy = e.clientY - sy;
        if (Math.abs(dy) > 4) moved = true;
        if (moved) b.style.top = Math.max(8, Math.min(innerHeight - 38, startTop + dy)) + 'px';
      });
      b.addEventListener('pointerup', e => {
        b.releasePointerCapture(e.pointerId);
        if (moved) { cfg.badgeY = Math.round((b.getBoundingClientRect().top + 15) / innerHeight * 100); saveCfg(); }
        else openPanel();
      });
      u.root.append(b);
      u.badge = b; u.badgeCnt = cnt;
    }
    u.badge.style.display = '';
    u.badgeCnt.textContent = n > 99 ? '99+' : String(n);
    u.badgeCnt.style.display = n ? '' : 'none';
  }

  /* ---------- 面板 ---------- */
  const P = { open: false, tab: 'links', sel: new Set(), selInit: new Set(), filter: '', destKey: '', manualText: '' };

  function openPanel(tab) {
    if (tab) P.tab = tab;
    P.open = true; renderPanel(); renderBadge();
  }
  function closePanel() {
    P.open = false;
    if (UI?.panel) { UI.panel.remove(); UI.panel = null; }
    renderBadge();
  }
  function togglePanel() { P.open ? closePanel() : openPanel(); }

  function renderPanel() {
    if (!P.open) return;
    const u = ui();
    const keepScroll = u.panel?.querySelector('.bd')?.scrollTop || 0;
    const focusedSearch = u.sr.activeElement?.dataset?.role === 'search';
    const all = liveItems();
    const tabBtn = (id, label) => h('button', { class: `tab ${P.tab === id ? 'on' : ''}`, onclick: () => { P.tab = id; renderPanel(); } }, label);
    const panel = h('div', { class: 'panel' },
      h('div', { class: 'hd' },
        h('span', { class: 'ttl' }, icon('magnet', 18), '115'),
        h('div', { class: 'tabs' }, tabBtn('links', L(`页面链接 (${all.length})`, `Links (${all.length})`)), tabBtn('manual', L('手动添加', 'Manual')), tabBtn('settings', L('设置', 'Settings'))),
        h('button', { class: 'x', title: L('关闭 (Esc)', 'Close (Esc)'), onclick: closePanel }, icon('close'))));
    if (P.tab === 'links') panel.append(...linksView(all));
    else if (P.tab === 'manual') panel.append(...manualView());
    else panel.append(...settingsView());
    if (u.panel) u.panel.replaceWith(panel); else u.root.append(panel);
    u.panel = panel;
    const bd = panel.querySelector('.bd'); if (bd) bd.scrollTop = keepScroll;
    if (focusedSearch) { const s = panel.querySelector('[data-role=search]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  function folderSelect() {
    const choices = destChoices();
    const cur = currentDest();
    const sel = h('select', { title: L('发送目标', 'Send target') },
      ...choices.map(d => {
        const o = h('option', { value: destKey(d) }, `${d.type === '115' ? '📁' : '⬇️'} ${destLabel(d)}${d.isDefault ? DEF() : ''}`);
        if (destKey(d) === destKey(cur)) o.selected = true;
        return o;
      }),
      h('option', { value: 'browse' }, L('浏览 115 目录…', 'Browse 115 folders…')));
    sel.addEventListener('change', () => {
      if (sel.value === 'browse') {
        sel.value = destKey(cur);
        openFolderPicker(L('选择 115 保存目录', 'Choose 115 folder'), f => {
          if (!cfg.favFolders.some(x => x.cid === f.cid) && f.cid !== cfg.folderId) { cfg.favFolders.push(f); saveCfg(); }
          P.destKey = destKey(destFromFolder(f));
          renderPanel();
        });
      } else { P.destKey = sel.value; renderPanel(); }
    });
    return sel;
  }
  const currentDest = () => { const c = destChoices(); return c.find(d => destKey(d) === P.destKey) || c[0]; };

  function stateTag(it) {
    if (it.state === 'loading') return h('span', { class: 'tag busy' }, L('提交中', 'Sending'));
    if (it.state === 'error') return h('span', { class: 'tag err', title: it.msg }, L('失败', 'Failed'));
    if (it.state === 'added') return h('span', { class: 'tag ok' }, L('已添加', 'Added'));
    if (it.state === 'existed') return h('span', { class: 'tag ok', title: it.msg }, L('已存在', 'Exists'));
    if (history.has(it.key)) return h('span', { class: 'tag ok', title: L('历史记录中已添加过', 'Added before (history)') }, L('添加过', 'Added before'));
    return null;
  }

  function locate(it) {
    const el = it.els.find(e => e.isConnected);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try {
      el.animate([{ outline: '3px solid #2777f8', outlineOffset: '2px', background: 'rgba(39,119,248,.15)' },
        { outline: '3px solid transparent', outlineOffset: '2px', background: 'transparent' }], { duration: 1800, easing: 'ease-out' });
    } catch { /* ignore */ }
  }

  function linksView(all) {
    // 新出现的条目：默认勾选未添加过的
    for (const it of all) if (!P.selInit.has(it.key)) { P.selInit.add(it.key); if (!isAdded(it)) P.sel.add(it.key); }
    const kw = P.filter.trim().toLowerCase();
    const shown = all.filter(it => (!cfg.hideAdded || !isAdded(it) || it.state === 'error')
      && (!kw || (it.name + ' ' + it.hash + ' ' + it.url).toLowerCase().includes(kw)));
    const selShown = shown.filter(it => P.sel.has(it.key));

    const allCk = h('input', { type: 'checkbox', title: L('全选 / 取消', 'Select all / none'), checked: shown.length > 0 && selShown.length === shown.length });
    allCk.indeterminate = selShown.length > 0 && selShown.length < shown.length;
    allCk.addEventListener('change', () => { shown.forEach(it => (allCk.checked ? P.sel.add(it.key) : P.sel.delete(it.key))); renderPanel(); });
    const search = h('input', { type: 'search', placeholder: L('筛选名称 / 哈希', 'Filter by name / hash'), value: P.filter, 'data-role': 'search' });
    search.addEventListener('input', () => { P.filter = search.value; renderPanel(); });
    const hideCk = h('input', { type: 'checkbox', checked: cfg.hideAdded });
    hideCk.addEventListener('change', () => { cfg.hideAdded = hideCk.checked; saveCfg(); renderPanel(); });

    const bar = h('div', { class: 'bar' }, allCk, search, h('label', { class: 'ck', title: L('隐藏已添加过的链接', 'Hide links added before') }, hideCk, L('隐藏已添加', 'Hide added')));

    const rows = shown.map(it => {
      const ck = h('input', { type: 'checkbox', checked: P.sel.has(it.key) });
      ck.addEventListener('click', e => e.stopPropagation());
      ck.addEventListener('change', () => { ck.checked ? P.sel.add(it.key) : P.sel.delete(it.key); renderPanel(); });
      const name = it.name || `${it.hash}`;
      return h('div', {
        class: 'row', title: `${name}\n${it.url.slice(0, 300)}`,
        onclick: () => { P.sel.has(it.key) ? P.sel.delete(it.key) : P.sel.add(it.key); renderPanel(); },
      },
      ck,
      h('div', { class: 'mn' },
        h('div', { class: 'nm' }, name),
        h('div', { class: 'sb' },
          h('span', { class: 'tag' }, it.type === 'ed2k' ? 'ED2K' : 'BT'),
          it.size ? h('span', null, fmtSize(it.size)) : null,
          h('span', null, it.hash.slice(0, 10) + '…'),
          stateTag(it))),
      h('button', { class: 'ib', title: L('在页面中定位', 'Locate on page'), onclick: e => { e.stopPropagation(); locate(it); } }, icon('locate')),
      h('button', { class: 'ib', title: L('复制链接', 'Copy link'), onclick: e => { e.stopPropagation(); copyText(it.url); toast(L('已复制', 'Copied'), { type: 'ok', timeout: 1200 }); } }, icon('copy')),
      h('button', { class: 'btn sm', title: L('单独发送到所选目标', 'Send this one to the selected target'), onclick: e => { e.stopPropagation(); sendTo([it], currentDest()); } }, SHORT[currentDest().type]));
    });

    const body = h('div', { class: 'bd' }, bar, ...(rows.length ? rows : [h('div', { class: 'empty' },
      all.length ? L('没有符合条件的链接', 'No matching links') : L('当前页面未检测到磁力 / ed2k 链接', 'No magnet / ed2k links found on this page'), h('br'), h('br'),
      h('button', { class: 'btn', onclick: () => openPanel('manual') }, L('手动粘贴链接', 'Paste links manually')))]));

    const selected = all.filter(it => P.sel.has(it.key));
    const copyBtn = h('button', { class: 'btn', disabled: !selected.length, onclick: () => { copyText(selected.map(i => i.url).join('\n')); toast(L(`已复制 ${selected.length} 条链接`, `Copied ${selected.length} link(s)`), { type: 'ok', timeout: 1500 }); } }, L('复制', 'Copy'));
    const addBtn = h('button', { class: 'btn pr', disabled: !selected.length, onclick: () => sendTo(selected, currentDest()) }, L(`发送 (${selected.length})`, `Send (${selected.length})`));
    return [body, h('div', { class: 'ft' }, folderSelect(), copyBtn, addBtn)];
  }

  function manualView() {
    const ta = h('textarea', { placeholder: L('粘贴磁力链接 / ed2k 链接 / 40 位哈希，每行一个；\n也可以直接粘贴包含链接的整段文本，会自动提取。', 'Paste magnet / ed2k links or 40-char hashes, one per line.\nYou can also paste any text that contains links; they will be extracted.') });
    ta.value = P.manualText;
    const info = h('span', { class: 'mut', style: 'flex:1' });
    const addBtn = h('button', { class: 'btn pr' });
    const parse = () => extractAll(ta.value, { detectEd2k: true, detectBareHash: true });
    const upd = () => {
      P.manualText = ta.value;
      const n = parse().length;
      info.textContent = n ? L(`识别到 ${n} 个链接`, `${n} link(s) found`) : L('未识别到链接', 'No links found');
      addBtn.textContent = L(`发送 (${n})`, `Send (${n})`); addBtn.disabled = !n;
    };
    ta.addEventListener('input', upd);
    addBtn.addEventListener('click', () => {
      const list = parse().map(p => { const it = items.get(p.key) || { ...p, els: [], state: '', msg: '' }; items.set(p.key, it); return it; });
      sendTo(list, currentDest()).then(() => {
        const failed = list.filter(it => it.state === 'error');
        P.manualText = failed.map(it => it.url).join('\n');
        if (P.tab === 'manual') renderPanel();
      });
    });
    const pasteBtn = h('button', { class: 'btn sm', onclick: async () => {
      try { const t = await navigator.clipboard.readText(); ta.value = (ta.value ? ta.value + '\n' : '') + t; upd(); }
      catch { toast(L('无法读取剪贴板，请手动 Ctrl+V 粘贴', 'Cannot read the clipboard, please paste with Ctrl+V'), { type: 'warn' }); }
    } }, L('从剪贴板粘贴', 'Paste from clipboard'));
    const clrBtn = h('button', { class: 'btn sm', onclick: () => { ta.value = ''; upd(); } }, L('清空', 'Clear'));
    upd();
    setTimeout(() => ta.focus(), 0);
    return [
      h('div', { class: 'bd' }, h('div', { class: 'sec', style: 'border:none' }, ta, h('div', { class: 'line' }, info, pasteBtn, clrBtn))),
      h('div', { class: 'ft' }, folderSelect(), addBtn),
    ];
  }

  function toggleRow(label, key, hint) {
    const ck = h('input', { type: 'checkbox', checked: !!cfg[key] });
    ck.addEventListener('change', () => { cfg[key] = ck.checked; saveCfg(); renderBadge(); });
    return h('div', { class: 'line' }, h('label', { class: 'ck', style: 'color:var(--fg)' }, ck, label), hint ? h('span', { class: 'mut' }, hint) : null);
  }

  /** aria2 / qBittorrent 配置输入行 */
  function field(label, sect, key, { type = 'text', placeholder = '' } = {}) {
    const inp = h('input', { type, placeholder, value: cfg[sect][key] ?? '', style: 'flex:1;min-width:0' });
    inp.addEventListener('change', () => { cfg[sect][key] = inp.value.trim(); saveCfg(); renderButtons(); });
    return h('div', { class: 'line' }, h('span', { class: 'mut', style: 'width:76px;flex:none' }, label), inp);
  }
  function targetSection(sect, title, fields, hint) {
    const on = cfg[sect].enabled;
    const ck = h('input', { type: 'checkbox', checked: on });
    ck.addEventListener('change', () => {
      cfg[sect].enabled = ck.checked;
      if (!ck.checked && cfg.defaultTarget === sect) cfg.defaultTarget = '115';
      saveCfg(); renderPanel(); renderButtons();
    });
    const result = h('span', { class: 'mut grow' });
    const testBtn = h('button', { class: 'btn sm' }, L('测试连接', 'Test connection'));
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true; result.style.color = ''; result.textContent = L('连接中…', 'Connecting…');
      try { result.textContent = '✅ ' + await testTarget(sect); result.style.color = 'var(--ok)'; }
      catch (e) { result.textContent = '❌ ' + e.message; result.style.color = 'var(--err)'; }
      testBtn.disabled = false;
    });
    return h('div', { class: 'sec' },
      h('div', { class: 'line', style: 'margin-top:0' }, h('label', { class: 'ck', style: 'color:var(--fg);font-weight:600' }, ck, L(`启用 ${title}`, `Enable ${title}`))),
      on ? [...fields, h('div', { class: 'line' }, testBtn, result), hint ? h('div', { class: 'mut' }, hint) : null] : null);
  }

  function settingsView() {
    const defSel = h('select', { style: 'flex:1;min-width:0' },
      ...[['115', L('115 云下载', '115 cloud download'), true], ['aria2', 'aria2', cfg.aria2.enabled], ['qbit', 'qBittorrent', cfg.qbit.enabled]]
        .filter(x => x[2]).map(([v, t]) => { const o = h('option', { value: v }, t); if (v === cfg.defaultTarget) o.selected = true; return o; }));
    defSel.addEventListener('change', () => { cfg.defaultTarget = defSel.value; saveCfg(); P.destKey = ''; renderButtons(); });
    const langSel = h('select', { style: 'flex:1;min-width:0' },
      ...[['auto', L('跟随浏览器', 'Follow browser')], ['zh', '中文'], ['en', 'English']]
        .map(([v, t]) => { const o = h('option', { value: v }, t); if (v === cfg.lang) o.selected = true; return o; }));
    langSel.addEventListener('change', () => { cfg.lang = langSel.value; saveCfg(); renderPanel(); refreshAll(); });
    const loginLine = h('span', { class: 'grow' }, L('检测中…', 'Checking…'));
    checkLogin().then(r => {
      loginLine.textContent = r.ok ? L(`✅ 已登录：${r.name}`, `✅ Signed in: ${r.name}`) : r.ok === false ? L('❌ 未登录 115', '❌ Not signed in to 115') : L('⚠️ 无法确认登录状态', '⚠️ Unable to check sign-in status');
    });
    const favChips = cfg.favFolders.map((f, i) => h('span', { class: 'chip', title: `cid: ${f.cid}` }, f.name,
      h('button', { title: L('移除', 'Remove'), onclick: () => { cfg.favFolders.splice(i, 1); saveCfg(); renderPanel(); } }, icon('close', 12))));
    const disChips = cfg.disabledHosts.map((d, i) => h('span', { class: 'chip' }, d,
      h('button', { title: L('移除', 'Remove'), onclick: () => { cfg.disabledHosts.splice(i, 1); saveCfg(); renderPanel(); } }, icon('close', 12))));
    const histN = Object.keys(history.load()).length;

    return [h('div', { class: 'bd' },
      h('div', { class: 'sec' }, h('h4', null, L('默认下载方式', 'Default target')),
        h('div', { class: 'line' }, h('span', { class: 'mut', style: 'width:76px;flex:none' }, L('点击按钮', 'On click')), defSel),
        h('div', { class: 'mut' }, L('页面按钮点击即发送到这里；右键按钮或在面板底部可临时选择其它目标。启用 aria2 / qBittorrent 后才会出现在列表中。',
          'Clicking a page button sends here. Right-click a button or use the panel footer to pick another target. aria2 / qBittorrent appear after you enable them below.'))),
      h('div', { class: 'sec' }, h('h4', null, L('115 账号', '115 account')),
        h('div', { class: 'line' }, loginLine,
          h('button', { class: 'btn sm', onclick: () => openTab(URL_LOGIN) }, L('登录 / 打开 115', 'Sign in / open 115')),
          h('button', { class: 'btn sm', onclick: () => openTab(URL_OFFLINE) }, L('云下载列表', 'Download list'))),
        h('div', { class: 'mut' }, L('提示“请验证账号 / 911”时，在 115 网页版云下载中手动添加一次任务完成验证即可。',
          'If you see "please verify your account" / error 911, add one task manually in 115 web cloud download to verify.'))),
      h('div', { class: 'sec' }, h('h4', null, L('115 保存目录', '115 save folder')),
        h('div', { class: 'line' }, h('span', { class: 'grow', title: cfg.folderId ? `cid: ${cfg.folderId}` : '' }, L(`默认：${folderLabel()}`, `Default: ${folderLabel()}`)),
          h('button', { class: 'btn sm', onclick: () => openFolderPicker(L('设置默认保存目录', 'Set default save folder'), f => { cfg.folderId = f.cid; cfg.folderName = f.name; saveCfg(); renderPanel(); toast(L(`默认目录已设为「${f.name}」`, `Default folder set to "${f.name}"`), { type: 'ok' }); }) }, L('更改', 'Change')),
          cfg.folderId ? h('button', { class: 'btn sm', onclick: () => { cfg.folderId = ''; cfg.folderName = ''; saveCfg(); renderPanel(); } }, L('恢复 115 默认', 'Reset to 115 default')) : null),
        h('div', { class: 'line' }, h('span', { class: 'mut' }, L('常用目录：', 'Favorites:')), ...(favChips.length ? favChips : [h('span', { class: 'mut' }, L('无', 'none'))]),
          h('button', { class: 'btn sm', onclick: () => openFolderPicker(L('添加常用目录', 'Add favorite folder'), f => { if (!cfg.favFolders.some(x => x.cid === f.cid)) { cfg.favFolders.push(f); saveCfg(); } renderPanel(); }) }, L('+ 添加', '+ Add')))),
      targetSection('aria2', 'aria2', [
        field(L('RPC 地址', 'RPC URL'), 'aria2', 'rpc', { placeholder: 'http://localhost:6800/jsonrpc' }),
        field(L('密钥', 'Secret'), 'aria2', 'secret', { type: 'password', placeholder: L('rpc-secret（没有则留空）', 'rpc-secret (leave empty if none)') }),
        field(L('保存目录', 'Save folder'), 'aria2', 'dir', { placeholder: L('留空使用 aria2 默认目录', 'Empty = aria2 default') }),
      ], L('需以 --enable-rpc 启动 aria2；非本机地址首次连接会弹窗确认。', 'aria2 must run with --enable-rpc. Non-local addresses ask for confirmation on first use.')),
      targetSection('qbit', 'qBittorrent', [
        field('WebUI', 'qbit', 'url', { placeholder: 'http://localhost:8080' }),
        field(L('用户名', 'Username'), 'qbit', 'username', { placeholder: 'admin' }),
        field(L('密码', 'Password'), 'qbit', 'password', { type: 'password' }),
        field(L('保存目录', 'Save path'), 'qbit', 'savepath', { placeholder: L('留空使用默认', 'Empty = default') }),
        field(L('分类', 'Category'), 'qbit', 'category', { placeholder: L('可选', 'Optional') }),
      ], L('需在 qBittorrent「设置 → WebUI」中启用；若开启了 CSRF / Host 头校验导致失败，可在 WebUI 设置中关闭或加入白名单。',
        'Enable it in qBittorrent "Options → WebUI". If CSRF / Host header validation blocks requests, disable it or whitelist the address.')),
      h('div', { class: 'sec' }, h('h4', null, L('探测与显示（部分选项刷新页面后生效）', 'Detection & display (some options apply after reload)')),
        toggleRow(L('在链接旁显示发送按钮', 'Show send buttons next to links'), 'inlineButtons'),
        toggleRow(L('把纯文本中的磁力链接转为可点击链接', 'Turn plain-text magnets into clickable links'), 'linkifyText'),
        toggleRow(L('识别 ed2k 链接', 'Detect ed2k links'), 'detectEd2k'),
        toggleRow(L('识别纯 40 位 BT 哈希', 'Detect bare 40-char BT hashes'), 'detectBareHash', L('可能误判 git 提交号等', 'may match git commit IDs')),
        toggleRow(L('显示悬浮球', 'Show floating button'), 'showBadge'),
        toggleRow(L('页面无链接时隐藏悬浮球', 'Hide floating button when no links'), 'hideBadgeWhenEmpty')),
      h('div', { class: 'sec' }, h('h4', null, L('站点', 'Sites')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, HOST),
          h('button', { class: 'btn sm', onclick: () => { if (!cfg.disabledHosts.includes(HOST)) cfg.disabledHosts.push(HOST); saveCfg(); toast(L('已在此站点禁用，刷新后生效', 'Disabled on this site, takes effect after reload'), { type: 'ok' }); renderPanel(); } }, L('在此站点禁用', 'Disable on this site'))),
        disChips.length ? h('div', { class: 'line' }, h('span', { class: 'mut' }, L('已禁用：', 'Disabled:')), ...disChips) : null),
      h('div', { class: 'sec' }, h('h4', null, L('语言、记录与快捷键', 'Language, history & shortcuts')),
        h('div', { class: 'line' }, h('span', { class: 'mut', style: 'width:76px;flex:none' }, L('界面语言', 'Language')), langSel),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, L(`已添加记录 ${histN} 条（用于标记“添加过”）`, `${histN} links in history (used to mark "added before")`)),
          h('button', { class: 'btn sm', onclick: () => { if (confirm(L('清空全部已添加记录？', 'Clear all history?'))) { history.clear(); refreshAll(); } } }, L('清空', 'Clear'))),
        h('div', { class: 'mut' }, h('span', { class: 'kbd' }, 'Alt+Shift+M'), L(' 打开/关闭面板（若选中了含链接的文字，会直接进入手动添加）；', ' toggles the panel (with link text selected, opens manual add); '),
          h('span', { class: 'kbd' }, 'Esc'), L(' 关闭；页面按钮：右键选择目标，Alt+点击复制。', ' closes. Page buttons: right-click to choose target, Alt+click to copy.')))),
    ];
  }

  /* ---------- 刷新调度 ---------- */
  let refreshTimer = 0;
  function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(refreshAll, 120); }
  function refreshAll() {
    clearTimeout(refreshTimer); refreshTimer = 0;
    renderButtons(); renderBadge();
    if (P.open && P.tab === 'links') renderPanel();
  }

  /* ========================= 快捷键 / 菜单 ========================= */
  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyM' || e.key === 'M' || e.key === 'm')) {
      e.preventDefault();
      const sel = String(window.getSelection() || '');
      const found = sel ? extractAll(sel, { detectEd2k: true, detectBareHash: true }) : [];
      if (found.length) { P.manualText = found.map(p => p.url).join('\n'); openPanel('manual'); return; }
      togglePanel();
    } else if (e.key === 'Escape' && P.open) {
      if (UI?.root.querySelector('.mask')) UI.root.querySelector('.mask').remove();
      else if (UI?.menu) closeMenu();
      else closePanel();
    }
  }, true);

  menu(L('🧲 打开磁力面板', '🧲 Open magnet panel'), () => openPanel('links'));
  menu(L('📋 手动添加链接', '📋 Add links manually'), () => openPanel('manual'));
  menu(L('⚙️ 设置', '⚙️ Settings'), () => openPanel('settings'));
  menu(L(`🚫 在 ${HOST} 禁用`, `🚫 Disable on ${HOST}`), () => { cfg.disabledHosts.push(HOST); saveCfg(); location.reload(); });

  // 同步其它标签页写入的历史
  window.addEventListener('focus', () => { history.cache = history.load(); cfg = loadCfg(); refreshAll(); });

  /* ========================= 启动 ========================= */
  function start() {
    scan(document.body || document.documentElement);
    mo.observe(document.body || document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['href', 'data-clipboard-text', 'data-magnet'],
    });
    refreshAll();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  // 只读调试钩子（不暴露任何提交能力）
  window.__m115 = { parseLink, extractAll, count: () => liveItems().length };
})();
