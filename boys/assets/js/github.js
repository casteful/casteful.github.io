/* Кінобаза — GitHub Contents API client (direct commit of data/movies.json) */
(function () {
  'use strict';
  window.MB = window.MB || {};

  var API = 'https://api.github.com';

  function headers(token) {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  function fileUrl(cfg) {
    return API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + cfg.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(cfg.branch || 'main');
  }

  /* UTF-8 safe base64 */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function ghErr(res, body) {
    var msg = (body && body.message) || ('HTTP ' + res.status);
    if (res.status === 401) msg = '401 — ' + (body && body.message || 'bad credentials / token');
    if (res.status === 403) msg = '403 — ' + (body && body.message || 'forbidden (check token permissions)');
    if (res.status === 404) msg = '404 — ' + (body && body.message || 'repo, branch or file path not found');
    return new Error(msg);
  }

  /* GET current file: returns { sha, size, contentText } */
  async function ghGet(cfg) {
    var res = await fetch(fileUrl(cfg), { headers: headers(cfg.token), cache: 'no-store' });
    var body = null;
    try { body = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw ghErr(res, body);
    var contentText = '';
    if (body.content && body.encoding === 'base64') {
      var bin = atob(body.content.replace(/\n/g, ''));
      contentText = new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }));
    }
    return { sha: body.sha, size: body.size, contentText: contentText };
  }

  /* PUT new content: commits file. Retries once on sha conflict (409). */
  async function ghPut(cfg, jsonText, message) {
    var cur = await ghGet(cfg);
    var payload = {
      message: message,
      content: b64encode(jsonText),
      branch: cfg.branch || 'main',
      sha: cur.sha
    };
    var res = await fetch(fileUrl(cfg), {
      method: 'PUT',
      headers: headers(cfg.token),
      body: JSON.stringify(payload)
    });
    var body = null;
    try { body = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 409) { /* stale sha — refresh once and retry */
      cur = await ghGet(cfg);
      payload.sha = cur.sha;
      res = await fetch(fileUrl(cfg), {
        method: 'PUT', headers: headers(cfg.token), body: JSON.stringify(payload)
      });
      try { body = await res.json(); } catch (e) { /* ignore */ }
    }
    if (!res.ok) throw ghErr(res, body);
    return { commit: body.commit && body.commit.sha ? body.commit.sha : null };
  }

  /* Test connection: file exists + latest commit touching that path */
  async function ghTest(cfg) {
    var info = await ghGet(cfg);
    var out = { sha: info.sha, size: info.size, commit: null };
    try {
      var u = API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
        '/commits?sha=' + encodeURIComponent(cfg.branch || 'main') +
        '&path=' + encodeURIComponent(cfg.path) + '&per_page=1';
      var res = await fetch(u, { headers: headers(cfg.token), cache: 'no-store' });
      if (res.ok) {
        var arr = await res.json();
        if (arr && arr.length) {
          out.commit = {
            date: arr[0].commit && arr[0].commit.author && arr[0].commit.author.date,
            msg: arr[0].commit && arr[0].commit.message
          };
        }
      }
    } catch (e) { /* commit info is optional */ }
    return out;
  }

  /* Prefill sync settings when hosted on *.github.io */
  function suggestCfg() {
    var h = location.hostname;
    if (!/(^|\.)github\.io$/.test(h)) return null;
    var owner = h.split('.')[0];
    var segs = location.pathname.split('/').filter(Boolean);
    var repo, prefix = '';
    if (segs.length) { repo = segs[0]; prefix = segs[0] + '/'; }
    else { repo = owner + '.github.io'; }
    return { owner: owner, repo: repo, branch: 'main', path: prefix + 'data/movies.json', token: '' };
  }

  window.MB.github = { ghGet: ghGet, ghPut: ghPut, ghTest: ghTest, suggestCfg: suggestCfg };
})();
