const DEFAULT_TEST_PATTERNS = [
  /\.test\.(t|j)sx?$/,
  /\.spec\.(t|j)sx?$/,
  /\.cy\.(t|j)sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)__snapshots__\//,
  /(^|\/)tests?\//,
  /(^|\/)e2e\//,
  /(^|\/)cypress\//,
  /(^|\/)playwright\//,
  /(^|\/)fixtures?\//,
  /_test\.(py|go)$/,
  /_spec\.rb$/,
  /(^|\/)test_[^/]+\.py$/,
];

let userPatterns = [];
let githubToken = '';
let cache = { key: '', files: null };
let inFlight = false;

async function loadSettings() {
  try {
    const { testPatterns, githubToken: tok } = await chrome.storage.sync.get([
      'testPatterns',
      'githubToken',
    ]);
    userPatterns = (testPatterns || [])
      .map((s) => {
        try { return new RegExp(s); } catch { return null; }
      })
      .filter(Boolean);
    githubToken = (tok || '').trim();
  } catch {
    userPatterns = [];
    githubToken = '';
  }
}

function isTest(path) {
  if (userPatterns.some((re) => re.test(path))) return true;
  return DEFAULT_TEST_PATTERNS.some((re) => re.test(path));
}

function parsePrUrl() {
  const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: m[3] };
}

async function fetchAllFiles(owner, repo, number) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
    const r = await fetch(url, { headers });
    if (r.status === 404) {
      throw new Error(githubToken ? 'PR not found (token lacks access?)' : 'private repo — set a GitHub token in extension options');
    }
    if (r.status === 401 || r.status === 403) {
      throw new Error(`GitHub API ${r.status} — check token / rate limit`);
    }
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

function summarize(files) {
  let prodAdd = 0, prodDel = 0, testAdd = 0, testDel = 0, prodFiles = 0, testFiles = 0;
  for (const f of files) {
    if (isTest(f.filename)) {
      testAdd += f.additions; testDel += f.deletions; testFiles++;
    } else {
      prodAdd += f.additions; prodDel += f.deletions; prodFiles++;
    }
  }
  return { prodAdd, prodDel, testAdd, testDel, prodFiles, testFiles };
}

function findDiffstatAnchor() {
  // 1. Anchor right next to whatever element shows GitHub's +X −Y diffstat.
  const numberSelectors = [
    '.diffbar-item.diffstat',
    '.toc-diff-stats',
    '[data-testid="diffstat"]',
    '[class*="diffstat"]',
    '[aria-label*="addition"][aria-label*="deletion"]',
    '[aria-label*="additions"][aria-label*="deletions"]',
    '.gh-header-meta [aria-label*="addition"]',
    'summary[aria-label*="addition"]',
    'a.tabnav-tab[href$="/files"]',
    'a[href$="/files"][data-tab-item*="files"]',
  ];
  for (const sel of numberSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      console.log('[gh-pvt] diffstat anchor:', sel);
      return { el, mode: 'after' };
    }
  }
  // 2. Content-based fallback: any small element whose own text matches "+N -M".
  const re = /[+]\s*\d[\d,]*\s*[−\-]\s*\d[\d,]*/;
  const all = document.querySelectorAll(
    'header *, .gh-header-meta *, [data-testid*="header"] *, nav *, .tabnav *'
  );
  for (const el of all) {
    if (el.children.length > 4) continue;
    const t = el.textContent || '';
    if (t.length > 60) continue;
    if (re.test(t)) {
      console.log('[gh-pvt] content-matched anchor:', el);
      return { el, mode: 'after' };
    }
  }
  // 3. Fallback: append to PR header.
  const headerSelectors = [
    '.gh-header-meta',
    '.gh-header-show',
    '#partial-discussion-header',
    '[data-component="PH_Title"]',
    '[data-testid="pull-request-header"]',
  ];
  for (const sel of headerSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      console.log('[gh-pvt] header anchor:', sel);
      return { el, mode: 'append' };
    }
  }
  console.warn('[gh-pvt] no anchor — using floating fallback');
  return { el: document.body, mode: 'floating' };
}

function renderHeaderPill(s) {
  document.querySelector('#gh-pvt-pill')?.remove();

  const { el: anchor, mode } = findDiffstatAnchor();
  if (!anchor) return;

  const totalDel = s.prodDel + s.testDel;
  const totalAdd = s.prodAdd + s.testAdd;

  const pill = document.createElement('span');
  pill.id = 'gh-pvt-pill';
  pill.className = 'gh-pvt-pill' + (mode === 'floating' ? ' gh-pvt-pill-floating' : ' gh-pvt-pill-inline');
  pill.title =
    `raw (prod): +${s.prodAdd} across ${s.prodFiles} file(s)\n` +
    `tests:      +${s.testAdd} across ${s.testFiles} file(s)\n` +
    `removals:   −${totalDel} (prod −${s.prodDel} · tests −${s.testDel})\n` +
    `\nsum: +${totalAdd} −${totalDel} (matches GitHub diff)`;
  pill.innerHTML = `
    <span class="gh-pvt-bar" aria-hidden="true">
      <span class="gh-pvt-seg gh-pvt-bg-add"   style="flex:${s.prodAdd}"></span>
      <span class="gh-pvt-seg gh-pvt-bg-test"  style="flex:${s.testAdd}"></span>
      <span class="gh-pvt-seg gh-pvt-bg-del"   style="flex:${totalDel}"></span>
    </span>
    <span class="gh-pvt-chip gh-pvt-chip-raw">
      <span class="gh-pvt-chip-label">raw</span>
      <span class="gh-pvt-chip-num">+${s.prodAdd}</span>
    </span>
    <span class="gh-pvt-chip gh-pvt-chip-test">
      <span class="gh-pvt-chip-label">tests</span>
      <span class="gh-pvt-chip-num">+${s.testAdd}</span>
    </span>
    <span class="gh-pvt-chip gh-pvt-chip-del">
      <span class="gh-pvt-chip-label">removals</span>
      <span class="gh-pvt-chip-num">−${totalDel}</span>
    </span>
  `;

  placePill(pill, anchor, mode);
}

function placePill(pill, anchor, mode) {
  if (mode === 'after') {
    const parent = anchor.parentElement;
    if (parent) parent.appendChild(pill);
    else anchor.insertAdjacentElement('afterend', pill);
  } else {
    anchor.appendChild(pill);
  }
}

function decorateDiff(files) {
  const byPath = new Map(files.map((f) => [f.filename, f]));

  document.querySelectorAll('[data-tagsearch-path]').forEach((row) => {
    const path = row.getAttribute('data-tagsearch-path');
    if (!path || !byPath.has(path)) return;
    const test = isTest(path);
    row.classList.toggle('gh-pvt-test-file', test);
    row.classList.toggle('gh-pvt-prod-file', !test);

    if (test && !row.querySelector('.gh-pvt-test-badge')) {
      const header =
        row.querySelector('.file-header .file-info') ||
        row.querySelector('.file-header') ||
        row.querySelector('[data-testid="diff-file-header"]');
      if (header) {
        const badge = document.createElement('span');
        badge.className = 'gh-pvt-test-badge';
        badge.textContent = 'TEST';
        header.prepend(badge);
      }
    }
  });

  document
    .querySelectorAll('.ActionList-item, [data-testid="file-tree-item-row"]')
    .forEach((row) => {
      const link = row.querySelector('a[href*="#diff-"]') || row.querySelector('a[href]');
      if (!link) return;
      const path = (link.title || link.textContent || '').trim().split('\n')[0].trim();
      if (!path || !byPath.has(path)) return;
      row.classList.toggle('gh-pvt-test-row', isTest(path));
    });
}

function renderErrorPill(msg) {
  document.querySelector('#gh-pvt-pill')?.remove();
  const { el: anchor, mode } = findDiffstatAnchor();
  if (!anchor) return;
  const pill = document.createElement('span');
  pill.id = 'gh-pvt-pill';
  pill.className =
    'gh-pvt-pill gh-pvt-pill-error' +
    (mode === 'floating' ? ' gh-pvt-pill-floating' : ' gh-pvt-pill-inline');
  pill.title = msg + '\n\n(click to open extension options)';
  pill.textContent = `prod·tests · ${msg}`;
  placePill(pill, anchor, mode);
}

async function run() {
  const pr = parsePrUrl();
  if (!pr || inFlight) return;
  inFlight = true;
  console.log('[gh-pvt] run', pr);
  try {
    await loadSettings();
    const key = `${pr.owner}/${pr.repo}/${pr.number}`;
    if (cache.key !== key || !cache.files) {
      cache = { key, files: await fetchAllFiles(pr.owner, pr.repo, pr.number) };
      console.log(`[gh-pvt] fetched ${cache.files.length} files`);
    }
    renderHeaderPill(summarize(cache.files));
    decorateDiff(cache.files);
  } catch (e) {
    console.warn('[gh-pvt]', e.message || e);
    renderErrorPill(String(e.message || e));
  } finally {
    inFlight = false;
  }
}

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    cache = { key: '', files: null };
    setTimeout(run, 400);
    return;
  }
  if (cache.files && document.querySelector(
    '[data-tagsearch-path]:not(.gh-pvt-test-file):not(.gh-pvt-prod-file)'
  )) {
    decorateDiff(cache.files);
  }
}).observe(document.body, { childList: true, subtree: true });

document.addEventListener('turbo:load', () => setTimeout(run, 200));
document.addEventListener('pjax:end', () => setTimeout(run, 200));
window.addEventListener('popstate', () => setTimeout(run, 200));

setTimeout(run, 250);
