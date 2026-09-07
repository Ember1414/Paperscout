/* PaperScout 前端逻辑：检索、来源标签、明暗主题、爬虫热门板块 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('search-form');
  var qInput = $('q');
  var authorInput = $('author');
  var yearFromInput = $('yearFrom');
  var yearToInput = $('yearTo');
  var sortSelect = $('sort');
  var languageSelect = $('language');
  var paperTypeSelect = $('paperType');
  var fieldSelect = $('field');
  var paginationEl = $('pagination');
  var prevPageBtn = $('prev-page');
  var nextPageBtn = $('next-page');
  var pageInfoEl = $('page-info');
  var currentPage = 1;
  var limitSelect = $('limit');
  var searchBtn = $('search-btn');
  var statusEl = $('status');
  var resultsEl = $('results');
  var toastEl = $('toast');

  /* ---------- 明暗主题 ---------- */
  var themeBtn = $('theme-toggle');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var savedTheme = localStorage.getItem('ps-theme');
  applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('ps-theme', theme);
  }

  themeBtn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  /* ---------- 通用 ---------- */
  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    var html = div.innerHTML;
    // innerHTML 不转义引号，补齐以防属性注入
    return html.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }

  function setStatus(msg, isError) {
    if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function showSkeletons(n) {
    resultsEl.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var d = document.createElement('div');
      d.className = 'skeleton';
      resultsEl.appendChild(d);
    }
  }

  /* ---------- 客户端标识 / 收藏 / 对比 / 当前结果 ---------- */
  var CLIENT_ID = localStorage.getItem('ps-cid');
  if (!CLIENT_ID) {
    CLIENT_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    localStorage.setItem('ps-cid', CLIENT_ID);
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Client-Id': CLIENT_ID }, opts.headers || {});
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  function djb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  var currentPapers = [];
  var favSet = {};            // id -> true
  var compareList = [];       // 待对比论文

  function favId(p) { return djb2(p.doi ? 'doi:' + p.doi : p.url); }

  /* ---------- 弹窗 ---------- */
  function openModal(html) {
    $('modal-content').innerHTML = html;
    $('modal-overlay').hidden = false;
  }
  function closeModal() { $('modal-overlay').hidden = true; }
  $('modal-close').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', function (e) {
    if (e.target === $('modal-overlay')) closeModal();
  });

  /* ---------- BibTeX / RIS 导出 ---------- */
  function download(filename, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function toBibTeX(papers) {
    return papers.map(function (p, i) {
      var first = (p.authors[0] || 'anon').split(/[\s,]+/)[0].toLowerCase().replace(/\W/g, '');
      var key = first + (p.year || '') + (i + 1);
      return '@article{' + key + ',\n' +
        '  title = {' + p.title + '},\n' +
        '  author = {' + p.authors.join(' and ') + '},\n' +
        '  year = {' + (p.year || '') + '},\n' +
        '  journal = {' + (p.venue || '') + '},\n' +
        '  doi = {' + (p.doi || '') + '},\n' +
        '  url = {' + p.url + '}\n}';
    }).join('\n\n');
  }
  function toRIS(papers) {
    return papers.map(function (p) {
      var lines = ['TY  - JOUR', 'TI  - ' + p.title];
      p.authors.forEach(function (a) { lines.push('AU  - ' + a); });
      if (p.year) lines.push('PY  - ' + p.year);
      if (p.venue) lines.push('JO  - ' + p.venue);
      if (p.doi) lines.push('DO  - ' + p.doi);
      lines.push('UR  - ' + p.url, 'ER  - ');
      return lines.join('\n');
    }).join('\n\n');
  }

  /* ---------- 检索历史 ---------- */
  function loadHistory() {
    api('/api/history').then(function (d) {
      var chips = (d.history || []).filter(function (h) { return h.q || h.author; });
      var box = $('history-chips');
      box.innerHTML = '';
      if (!chips.length) { $('history-section').hidden = true; return; }
      $('history-section').hidden = false;
      chips.forEach(function (h) {
        var b = document.createElement('button');
        b.className = 'h-chip';
        b.textContent = h.q || h.author;
        b.addEventListener('click', function () {
          qInput.value = h.q || '';
          authorInput.value = h.author || '';
          currentPage = 1;
          doSearch();
        });
        box.appendChild(b);
      });
    }).catch(function () { });
  }
  $('history-clear').addEventListener('click', function () {
    api('/api/history', { method: 'DELETE' }).then(loadHistory);
  });

  /* ---------- 收藏夹 ---------- */
  function loadFavSet() {
    api('/api/favorites').then(function (d) {
      favSet = {};
      (d.favorites || []).forEach(function (p) { favSet[favId(p)] = p; });
    }).catch(function () { });
  }
  function toggleFav(p, btn) {
    var id = favId(p);
    var action = favSet[id] ? 'remove' : 'add';
    api('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, paper: p })
    }).then(function (d) {
      if (action === 'add') { favSet[id] = p; toast('⭐ 已加入收藏'); }
      else { delete favSet[id]; toast('已取消收藏'); }
      if (btn) {
        btn.textContent = favSet[id] ? '★' : '☆';
        btn.classList.toggle('active', Boolean(favSet[id]));
      }
    }).catch(function () { toast('❌ 收藏操作失败'); });
  }
  function showFavorites() {
    api('/api/favorites').then(function (d) {
      var list = d.favorites || [];
      var items = list.length
        ? list.map(function (p) {
          return '<div class="trend-item"><div><div class="trend-title"><a href="' + esc(p.url) +
            '" target="_blank" rel="noopener noreferrer">' + esc(p.title) + '</a></div>' +
            '<div class="trend-authors">' + esc((p.authors || []).slice(0, 4).join(', ')) +
            (p.year ? ' · ' + p.year : '') + '</div></div>' +
            '<button class="link-btn fav-remove" data-id="' + favId(p) + '">移除</button></div>';
        }).join('')
        : '<div class="empty">还没有收藏，点击结果卡片中的 ☆ 收藏论文</div>';
      openModal(
        '<h3>⭐ 我的收藏（' + list.length + '）</h3>' + items +
        (list.length
          ? '<div class="export-row">' +
            '<button class="page-btn" id="export-bib">📥 导出 BibTeX</button>' +
            '<button class="page-btn" id="export-ris">📥 导出 RIS</button></div>'
          : '')
      );
      document.querySelectorAll('.fav-remove').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-id');
          api('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', paper: { title: 'x', url: id } })
          }).then(function () { delete favSet[id]; showFavorites(); });
        });
      });
      var bibBtn = $('export-bib');
      if (bibBtn) {
        bibBtn.addEventListener('click', function () { download('paperscout-favorites.bib', toBibTeX(list)); });
        $('export-ris').addEventListener('click', function () { download('paperscout-favorites.ris', toRIS(list)); });
      }
    });
  }
  $('fav-open').addEventListener('click', showFavorites);

  /* ---------- 相关论文 / 作者聚合 ---------- */
  function showRelated(p) {
    openModal('<h3>🔗 相关论文</h3><div class="empty">加载中…</div>');
    var qs = new URLSearchParams();
    if (p.doi) qs.set('doi', p.doi);
    if (p.title) qs.set('title', p.title);
    api('/api/related?' + qs.toString()).then(function (d) {
      var list = d.related || [];
      $('modal-content').innerHTML = '<h3>🔗 相关论文（' + list.length + '）</h3>' +
        (list.length
          ? list.map(function (p) {
            return '<div class="trend-item"><div><div class="trend-title"><a href="' + esc(p.url) +
              '" target="_blank" rel="noopener noreferrer">' + esc(p.title) + '</a></div>' +
              '<div class="trend-authors">' + esc(p.authors.slice(0, 4).join(', ')) +
              (p.year ? ' · ' + p.year : '') + (p.citations ? ' · 被引 ' + p.citations : '') + '</div></div></div>';
          }).join('')
          : '<div class="empty">该论文暂无关联推荐</div>');
    }).catch(function () { openModal('<h3>🔗 相关论文</h3><div class="empty">加载失败，请稍后重试</div>'); });
  }
  function showAuthor(name) {
    openModal('<h3>👤 ' + esc(name) + '</h3><div class="empty">加载中…</div>');
    api('/api/author?name=' + encodeURIComponent(name)).then(function (d) {
      if (d.error) { openModal('<h3>👤 ' + esc(name) + '</h3><div class="empty">' + esc(d.error) + '</div>'); return; }
      var pr = d.profile;
      var works = (d.works || []).map(function (w) {
        return '<div class="trend-item"><div><div class="trend-title"><a href="' + esc(w.url) +
          '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a></div>' +
          '<div class="trend-authors">' + (w.year || '') + (w.citations ? ' · 被引 ' + w.citations : '') + '</div></div></div>';
      }).join('');
      openModal(
        '<h3>👤 ' + esc(pr.name) + '</h3>' +
        '<div class="paper-meta">' +
        (pr.institution ? '<span class="badge">' + esc(pr.institution) + '</span>' : '') +
        '<span class="badge">论文 ' + pr.worksCount + '</span>' +
        '<span class="badge cite">总被引 ' + pr.citedByCount + '</span>' +
        '<span class="badge oa">h 指数 ' + pr.hIndex + '</span></div>' +
        '<h3 style="margin-top:16px">高被引论文</h3>' + (works || '<div class="empty">暂无数据</div>')
      );
    }).catch(function () { openModal('<h3>👤 ' + esc(name) + '</h3><div class="empty">加载失败</div>'); });
  }

  /* ---------- 对比 ---------- */
  function updateCompareBar() {
    var bar = $('compare-bar');
    $('compare-count').textContent = '已选 ' + compareList.length + ' 篇';
    bar.hidden = compareList.length === 0;
  }
  function showCompare() {
    var rows = ['年份', '来源', '期刊/会议', '被引', '开放获取', 'PDF'];
    var table = '<table><tr><th></th>' +
      compareList.map(function (p) { return '<th style="max-width:180px">' + esc(p.title.slice(0, 40)) + '</th>'; }).join('') +
      '</tr>' +
      rows.map(function (label) {
        var vals = compareList.map(function (p) {
          switch (label) {
            case '年份': return p.year || '—';
            case '来源': return esc(p.sourceName);
            case '期刊/会议': return esc(String(p.venue || '—').slice(0, 30));
            case '被引': return p.citations != null ? p.citations : '—';
            case '开放获取': return p.openAccess ? '✅' : '—';
            case 'PDF': return p.pdfUrl ? '<a href="' + esc(p.pdfUrl) + '" target="_blank">下载</a>' : '—';
          }
        });
        return '<tr><th>' + label + '</th>' + vals.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>';
    openModal('<h3>⚖️ 论文对比</h3>' + table);
  }
  $('compare-run').addEventListener('click', function () { if (compareList.length >= 2) showCompare(); });
  $('compare-clear').addEventListener('click', function () {
    compareList = [];
    document.querySelectorAll('.cmp-check').forEach(function (c) { c.checked = false; });
    updateCompareBar();
  });

  /* ---------- AI 总结 / 问答 ---------- */
  function setAiPanel(html) {
    var panel = $('ai-panel');
    if (!html) { panel.hidden = true; return; }
    panel.innerHTML = html;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('ai-summary-btn').addEventListener('click', function () {
    if (!currentPapers.length) return;
    var btn = this;
    btn.disabled = true; btn.textContent = '⏳ AI 正在分析…';
    setAiPanel('⏳ 正在基于本页论文生成研究现状总结…');
    api('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: lastQuery,
        papers: currentPapers.slice(0, 10).map(function (p) {
          return { title: p.title, abstract: p.abstract || '', year: p.year, citations: p.citations };
        })
      })
    }).then(function (d) {
      setAiPanel(d.summary ? '🤖 <b>研究现状总结</b>\n\n' + esc(d.summary) : '❌ ' + esc(d.error || '生成失败'));
    }).catch(function () { setAiPanel('❌ AI 服务暂不可用'); })
      .finally(function () { btn.disabled = false; btn.textContent = '🤖 AI 总结研究现状'; });
  });

  $('ai-ask-btn').addEventListener('click', function () {
    if (!lastQuery) return;
    var btn = this;
    btn.disabled = true; btn.textContent = '⏳ AI 正在检索文献回答…';
    setAiPanel('⏳ 正在检索相关论文并生成回答…');
    api('/api/ask?q=' + encodeURIComponent(lastQuery)).then(function (d) {
      if (d.error) { setAiPanel('❌ ' + esc(d.error)); return; }
      var src = '<div class="ai-src">参考来源：<br>' +
        (d.sources || []).map(function (s, i) {
          return '[' + (i + 1) + '] <a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + '</a>';
        }).join('<br>') + '</div>';
      setAiPanel('🤖 <b>AI 回答</b>\n\n' + esc(d.answer) + src);
    }).catch(function () { setAiPanel('❌ AI 服务暂不可用'); })
      .finally(function () { btn.disabled = false; btn.textContent = '🤖 AI 问答本文献'; });
  });

  /* ---------- 关键词高亮 ---------- */
  var lastQuery = '';

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 在已转义的 HTML 中高亮检索关键词 */
  var HIGHLIGHT_STOP = {
    the: 1, a: 1, an: 1, of: 1, for: 1, in: 1, on: 1, is: 1, are: 1, and: 1, or: 1,
    to: 1, with: 1, by: 1, from: 1, at: 1, as: 1, it: 1, its: 1, this: 1, that: 1,
    using: 1, use: 1, via: 1, based: 1, how: 1, what: 1, why: 1, can: 1, we: 1, you: 1
  };

  function highlight(text) {
    var safe = esc(text);
    if (!lastQuery) return safe;
    var terms = lastQuery.split(/\s+/).filter(function (t) {
      var low = t.toLowerCase();
      if (HIGHLIGHT_STOP[low]) return false;
      return /[\u4e00-\u9fff]/.test(t) ? t.length >= 1 : t.length >= 2;
    });
    if (!terms.length) return safe;
    terms.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(' + terms.map(escapeRegExp).join('|') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  /* ---------- 来源配色 ---------- */
  var SOURCE_COLORS = {
    arxiv: '#b197fc', openalex: '#74c0fc', crossref: '#63e6be',
    semanticscholar: '#ffa8a8', pubmed: '#a9e34b', dblp: '#ffd43b',
    doaj: '#ff922b', europepmc: '#f783ac', openaire: '#4dd0e1',
    zenodo: '#20c997', baiduxueshu: '#4263eb'
  };

  /* ---------- 结果渲染 ---------- */
  function renderPapers(papers) {
    resultsEl.innerHTML = '';
    if (!papers.length) {
      resultsEl.innerHTML =
        '<div class="empty"><span class="big">🔍</span>没有找到符合条件的论文，试试更换关键词或勾选更多数据源。</div>';
      return;
    }

    papers.forEach(function (p, idx) {
      var card = document.createElement('article');
      card.className = 'paper-card';
      card.style.animationDelay = Math.min(idx * 40, 400) + 'ms';

      // 逐个作者转义后拼 HTML（BUG 修复：此前拼接结果被整体二次转义，标签显示为文字）
      var authorsHtml = (p.authors && p.authors.length)
        ? p.authors.slice(0, 6).map(function (a) {
          return '<span class="author-link" data-name="' + esc(a) + '" style="cursor:pointer;text-decoration:underline dotted">' + esc(a) + '</span>';
        }).join(', ') + (p.authors.length > 6 ? ' 等' : '')
        : '佚名';

      var dotColor = SOURCE_COLORS[p.source] || '#ced4da';
      var TYPE_NAMES = { journal: '期刊论文', conference: '会议论文', preprint: '预印本', other: '' };

      var metaHtml =
        '<span class="badge"><span class="dot" style="background:' + dotColor + '"></span>' +
        esc(p.sourceName) + '</span>' +
        (p.year ? '<span>' + p.year + ' 年</span>' : '') +
        (p.type && TYPE_NAMES[p.type] ? '<span class="badge">' + TYPE_NAMES[p.type] + '</span>' : '') +
        (p.venue ? '<span title="' + esc(p.venue) + '">· ' + esc(String(p.venue).slice(0, 40)) + '</span>' : '') +
        (p.openAccess ? '<span class="badge oa">开放获取</span>' : '') +
        (typeof p.citations === 'number' && p.citations > 0
          ? '<span class="badge cite">被引 ' + p.citations + '</span>' : '');

      var fid = favId(p);
      var isFav = Boolean(favSet[fid]);
      var titleTr = p.title && !/[\u4e00-\u9fff]/.test(p.title)
        ? '<button class="title-tr" title="翻译标题为中文">译</button>' : '';

      card.innerHTML =
        '<h2 class="paper-title"><a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' +
        highlight(p.title) + '</a>' + titleTr +
        '<button class="fav-btn' + (isFav ? ' active' : '') + '" title="收藏论文">' + (isFav ? '★' : '☆') + '</button></h2>' +
        '<div class="paper-meta">' + metaHtml + '</div>' +
        '<div class="paper-authors">' + authorsHtml + '</div>' +
        (p.abstract
          ? '<p class="paper-abstract">' + highlight(p.abstract) + '</p>' +
            '<button class="abs-toggle">展开摘要 ▾</button>'
          : '') +
        '<div class="paper-actions">' +
        '<a class="btn-open" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">打开原文 ↗</a>' +
        (p.pdfUrl
          ? '<a class="btn-pdf" href="' + esc(p.pdfUrl) + '" target="_blank" rel="noopener noreferrer">📥 下载 PDF</a>'
          : '') +
        (p.doi ? '<button class="rel-btn link-btn">🔗 相关论文</button>' : '') +
        '<label style="font-size:0.82rem;color:var(--muted);display:inline-flex;align-items:center;gap:4px;cursor:pointer">' +
        '<input type="checkbox" class="cmp-check" data-fid="' + fid + '">对比</label>' +
        '<button class="copy-btn">📋 复制引用</button>' +
        '</div>';

      // 摘要展开 / 收起
      var absBtn = card.querySelector('.abs-toggle');
      if (absBtn) {
        absBtn.addEventListener('click', function () {
          var abs = card.querySelector('.paper-abstract');
          var expanded = abs.classList.toggle('expanded');
          absBtn.textContent = expanded ? '收起摘要 ▴' : '展开摘要 ▾';
        });
      }

      // 英文论文翻译按钮（摘要不含中文时显示）
      if (p.abstract && !/[\u4e00-\u9fff]/.test(p.abstract)) {
        var trBtn = document.createElement('button');
        trBtn.className = 'btn-translate';
        trBtn.textContent = '🌐 翻译为中文';
        card.querySelector('.paper-actions').appendChild(trBtn);

        trBtn.addEventListener('click', function () {
          var abs = card.querySelector('.paper-abstract');
          if (trBtn.dataset.state === 'translated') {
            abs.textContent = p.abstract;
            abs.classList.remove('expanded');
            trBtn.dataset.state = '';
            trBtn.textContent = '🌐 翻译为中文';
            return;
          }
          trBtn.disabled = true;
          trBtn.textContent = '⏳ 翻译中…';
          fetch('/api/translate?q=' + encodeURIComponent(p.abstract) + '&tl=zh-CN')
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d.translated) throw new Error(d.error || '翻译失败');
              abs.textContent = d.translated;
              abs.classList.add('expanded');
              trBtn.dataset.state = 'translated';
              trBtn.textContent = '🌐 查看原文';
            })
            .catch(function () {
              toast('❌ 翻译服务暂不可用，请稍后重试');
              trBtn.textContent = '🌐 翻译为中文';
            })
            .finally(function () { trBtn.disabled = false; });
        });
      }

      // 收藏
      card.querySelector('.fav-btn').addEventListener('click', function () { toggleFav(p, this); });

      // 相关论文
      var relBtn = card.querySelector('.rel-btn');
      if (relBtn) relBtn.addEventListener('click', function () { showRelated(p); });

      // 作者聚合
      card.querySelectorAll('.author-link').forEach(function (span) {
        span.addEventListener('click', function () { showAuthor(span.getAttribute('data-name')); });
      });

      // 标题翻译
      var tTr = card.querySelector('.title-tr');
      if (tTr) {
        tTr.addEventListener('click', function () {
          var link = card.querySelector('.paper-title a');
          tTr.disabled = true;
          api('/api/translate?q=' + encodeURIComponent(p.title) + '&tl=zh-CN').then(function (d) {
            if (d.translated) {
              link.textContent = d.translated;
              tTr.remove();
            } else { toast('❌ 翻译失败'); }
          }).catch(function () { toast('❌ 翻译服务暂不可用'); })
            .finally(function () { tTr.disabled = false; });
        });
      }

      // 对比勾选
      var cmp = card.querySelector('.cmp-check');
      cmp.addEventListener('change', function () {
        if (cmp.checked) {
          if (compareList.length >= 4) { cmp.checked = false; toast('最多同时对比 4 篇'); return; }
          compareList.push(p);
        } else {
          compareList = compareList.filter(function (x) { return x !== p; });
        }
        updateCompareBar();
      });

      // 复制引用
      card.querySelector('.copy-btn').addEventListener('click', function () {
        var cite = p.authors.slice(0, 3).join(', ') +
          (p.authors.length > 3 ? ' et al. ' : '. ') +
          '(' + (p.year || 'n.d.') + '). ' + p.title + '.' +
          (p.venue ? ' ' + p.venue + '.' : '') + ' ' + p.url;
        navigator.clipboard.writeText(cite).then(
          function () { toast('✅ 引用已复制到剪贴板'); },
          function () { toast('❌ 复制失败，请手动复制'); }
        );
      });

      resultsEl.appendChild(card);
    });
  }

  /* ---------- 检索 ---------- */
  function buildQuery() {
    var params = new URLSearchParams();
    var q = qInput.value.trim();
    var author = authorInput.value.trim();
    if (q) params.set('q', q);
    if (author) params.set('author', author);

    var sources = Array.prototype.slice.call(document.querySelectorAll('.src:checked'))
      .map(function (c) { return c.value; });
    if (sources.length) params.set('sources', sources.join(','));

    var yf = parseInt(yearFromInput.value, 10);
    var yt = parseInt(yearToInput.value, 10);
    if (yf) params.set('yearFrom', yf);
    if (yt) params.set('yearTo', yt);

    params.set('sort', sortSelect.value);
    params.set('limit', limitSelect.value);
    params.set('language', languageSelect.value);
    if (paperTypeSelect.value !== 'all') params.set('paperType', paperTypeSelect.value);
    if (fieldSelect.value) params.set('field', fieldSelect.value);
    if (currentPage > 1) params.set('page', currentPage);
    return params.toString();
  }

  /* 年份快捷选择：近 N 年 —— 点击立即生效并自动重新检索 */
  document.querySelectorAll('.qy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var n = parseInt(btn.getAttribute('data-years'), 10);
      document.querySelectorAll('.qy').forEach(function (b) { b.classList.remove('active'); });
      if (n) {
        var thisYear = new Date().getFullYear();
        yearFromInput.value = thisYear - n + 1;
        yearToInput.value = thisYear;
        btn.classList.add('active');
      } else {
        yearFromInput.value = '';
        yearToInput.value = '';
      }
      // 已有检索内容时自动重新检索；否则仅设定条件
      if (qInput.value.trim() || authorInput.value.trim()) doSearch();
    });
  });

  function updatePagination() {
    var isPageOne = currentPage <= 1;
    paginationEl.hidden = isPageOne && !resultsEl.querySelector('.paper-card');
    pageInfoEl.textContent = '第 ' + currentPage + ' 页';
    prevPageBtn.disabled = isPageOne;
    // 无结果时禁用下一页
    nextPageBtn.disabled = !resultsEl.querySelector('.paper-card');
  }

  async function doSearch() {
    if (!qInput.value.trim() && !authorInput.value.trim()) {
      setStatus('请输入主题关键词或作者后再检索', true);
      return;
    }
    var queryStr = buildQuery();

    searchBtn.disabled = true;
    lastQuery = [qInput.value.trim(), authorInput.value.trim()].filter(Boolean).join(' ');
    var checkedCount = document.querySelectorAll('.src:checked').length;
    setStatus('正在并行检索 ' + checkedCount + ' 个数据源，请稍候…');
    showSkeletons(4);
    $('trending-section').hidden = true;
    paginationEl.hidden = true;

    try {
      var res = await fetch('/api/search?' + queryStr);
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

      renderPapers(data.papers || []);
      currentPapers = data.papers || [];
      $('ai-toolbar').hidden = !currentPapers.length;
      var notes = [];
      if (data.cached) notes.push('本次结果来自缓存');
      // 源可用性：轻量展示，只列未响应的源名
      if (typeof data.sourcesOk === 'number') {
        notes.push('成功检索 ' + data.sourcesOk + '/' + data.sourcesTotal + ' 个数据源');
      }
      if (data.cooldown && data.cooldown.length) {
        notes.push('冷却中（稍后自动恢复）：' + data.cooldown.join('、'));
      }
      if (data.errors && data.errors.length) {
        var failedNames = data.errors.map(function (e) { return e.split(':')[0]; }).join('、');
        notes.push('未响应：' + failedNames);
      }
      setStatus('共找到 ' + (data.total || 0) + ' 篇论文（' + notes.join(' · ') + '）');
      updatePagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });

      history.replaceState(null, '', location.pathname + '?' + queryStr);
    } catch (err) {
      resultsEl.innerHTML = '<div class="empty"><span class="big">⚠️</span>检索失败：' + esc(err.message) + '</div>';
      setStatus('检索失败：' + err.message, true);
      paginationEl.hidden = true; // BUG 修复：失败后残留的过期分页控件
      $('ai-toolbar').hidden = true;
      setAiPanel('');
      currentPapers = [];
    } finally {
      searchBtn.disabled = false;
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    currentPage = 1; // 新检索从第一页开始
    doSearch();
  });

  prevPageBtn.addEventListener('click', function () {
    if (currentPage > 1) { currentPage--; doSearch(); }
  });
  nextPageBtn.addEventListener('click', function () {
    currentPage++; doSearch();
  });

  /* ---------- 最新论文雷达（爬虫数据） ---------- */
  async function loadTrending(forceRefresh) {
    var refreshBtn = $('trending-refresh');
    if (forceRefresh) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ 正在实时抓取…';
    }
    try {
      var res = await fetch('/api/trending' + (forceRefresh ? '?refresh=1' : ''));
      var data = await res.json();
      if (!res.ok || !data.papers || !data.papers.length) return;

      var listEl = $('trending-list');
      listEl.innerHTML = '';
      data.papers.slice(0, 8).forEach(function (t, i) {
        var item = document.createElement('div');
        item.className = 'trend-item';
        item.innerHTML =
          '<span class="trend-no">' + (i + 1) + '</span>' +
          '<div><div class="trend-title"><a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(t.title) + '</a></div>' +
          '<div class="trend-authors">' + esc(t.authors.slice(0, 4).join(', ') || '佚名') + '</div></div>';
        listEl.appendChild(item);
      });

      var time = new Date(data.crawledAt).toLocaleString('zh-CN', { hour12: false });
      var viaText = data.via === 'scrape' ? '爬虫实时抓取' : data.via === 'api' ? 'API 降级' : '缓存';
      $('trending-meta').textContent = '更新于 ' + time + ' · ' + viaText;
      $('trending-section').hidden = false;
    } catch (e) {
      /* 雷达数据加载失败不影响主功能 */
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 实时刷新';
    }
  }

  $('trending-refresh').addEventListener('click', function () {
    loadTrending(true);
  });

  /* ---------- 初始化：URL 参数自动检索，否则展示雷达 ---------- */
  var urlParams = new URLSearchParams(location.search);
  if (urlParams.get('q') || urlParams.get('author')) {
    if (urlParams.get('q')) qInput.value = urlParams.get('q');
    lastQuery = [urlParams.get('q') || '', urlParams.get('author') || ''].filter(Boolean).join(' ');
    if (urlParams.get('author')) authorInput.value = urlParams.get('author');
    if (urlParams.get('yearFrom')) yearFromInput.value = urlParams.get('yearFrom');
    if (urlParams.get('yearTo')) yearToInput.value = urlParams.get('yearTo');
    if (urlParams.get('sort')) sortSelect.value = urlParams.get('sort');
    if (urlParams.get('limit')) limitSelect.value = urlParams.get('limit');
    if (urlParams.get('language')) languageSelect.value = urlParams.get('language');
    if (urlParams.get('paperType')) paperTypeSelect.value = urlParams.get('paperType');
    if (urlParams.get('field')) fieldSelect.value = urlParams.get('field');
    // URL 无排序参数时，默认使用智能质量排序
    sortSelect.value = urlParams.get('sort') || 'smart';
    if (parseInt(urlParams.get('page'), 10) > 1) currentPage = parseInt(urlParams.get('page'), 10);
    if (urlParams.get('sources')) {
      var wanted = urlParams.get('sources').split(',');
      document.querySelectorAll('.src').forEach(function (c) {
        c.checked = wanted.indexOf(c.value) !== -1;
      });
    }
    doSearch();
  } else {
    loadTrending();
  }

  // 初始化：历史 + 收藏 + Service Worker（PWA）
  loadHistory();
  loadFavSet();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () { });
  }
})();
