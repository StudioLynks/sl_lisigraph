#!/usr/bin/env node
// LisiGraph : affiche le graphe des branches d'un dépôt Git dans le navigateur.
//
//   lisigraph [chemin-du-depot] [--main develop] [--max 2000] [--port 5180] [--no-open]

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execFile, exec } = require('child_process');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { repo: null, main: null, max: 2000, port: 5180, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--main') opts.main = argv[++i];
    else if (a === '--max') opts.max = parseInt(argv[++i], 10);
    else if (a === '--port') opts.port = parseInt(argv[++i], 10);
    else if (a === '--no-open') opts.open = false;
    else if (a === '-v' || a === '--version') {
      console.log(`lisigraph ${VERSION}`);
      process.exit(0);
    } else if (a === '-h' || a === '--help') {
      console.log('Usage : lisigraph [chemin-du-depot] [--main <branche>] [--max <nb commits>] [--port <port>] [--no-open] [--version]');
      process.exit(0);
    } else opts.repo = path.resolve(a);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Lecture du dépôt
// ---------------------------------------------------------------------------
const FIELD = '\x1f', RECORD = '\x1e';
const VERSION = require('./package.json').version;

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function readGraph(repo, max) {
  const root = git(repo, ['rev-parse', '--show-toplevel']).trim();

  // Branches, branches distantes et tags
  const local = {}, remotesByName = {}, tags = {};
  const refLines = git(root, ['for-each-ref', `--format=%(refname)${FIELD}%(objectname)${FIELD}%(*objectname)`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  for (const line of refLines.split('\n').filter(Boolean)) {
    const [ref, obj, peeled] = line.split(FIELD);
    const commit = peeled || obj; // un tag annoté pointe vers un objet tag : on prend le commit
    if (ref.startsWith('refs/heads/')) local[ref.slice(11)] = commit;
    else if (ref.startsWith('refs/tags/')) tags[ref.slice(10)] = commit;
    else if (ref.startsWith('refs/remotes/')) {
      const [remote, ...rest] = ref.slice(13).split('/');
      const name = rest.join('/');
      if (name === 'HEAD') continue;
      (remotesByName[remote] ||= {})[name] = commit;
    }
  }
  // Un seul dépôt distant affiché : origin s'il existe, sinon le premier
  const remoteNames = Object.keys(remotesByName);
  const remoteName = remoteNames.includes('origin') ? 'origin' : remoteNames[0] || 'origin';
  const remote = remotesByName[remoteName] || {};

  // HEAD
  let head = null, headCommit = null;
  try { headCommit = git(root, ['rev-parse', 'HEAD']).trim(); } catch {}
  try { head = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim(); } catch {}

  // Commits : --date-order garantit qu'un commit apparaît avant ses parents
  // HEAD en plus : un HEAD détaché peut pointer sur un commit qu'aucune branche ne contient
  const refsToShow = [...new Set([...Object.values(local), ...Object.values(remote), ...Object.values(tags), ...(headCommit ? [headCommit] : [])])];
  let commits = [];
  if (refsToShow.length) {
    const out = git(root, ['log', '--date-order', `--max-count=${max + 1}`,
      `--format=%H${FIELD}%h${FIELD}%P${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`, ...refsToShow]);
    commits = out.split(RECORD).map(s => s.replace(/^\n/, '')).filter(Boolean).map(rec => {
      const [id, hash, parents, author, date, msg] = rec.split(FIELD);
      return { id, hash, parents: parents ? parents.split(' ') : [], author, date, msg };
    });
  }
  const truncated = commits.length > max;
  if (truncated) commits = commits.slice(0, max);

  // On retire ce qui pointe en dehors des commits chargés
  const known = new Set(commits.map(c => c.id));
  for (const c of commits) c.parents = c.parents.filter(p => known.has(p));
  const keepKnown = obj => Object.fromEntries(Object.entries(obj).filter(([, id]) => known.has(id)));

  return {
    repo: path.basename(root),
    version: VERSION,
    now: new Date().toISOString(),
    truncated,
    commits,
    refs: {
      head: head && local[head] ? head : null,
      headCommit: known.has(headCommit) ? headCommit : null,
      headOutside: !!headCommit && !known.has(headCommit), // HEAD au-delà des commits chargés (--max)
      remoteName,
      local: keepKnown(local),
      remote: keepKnown(remote),
      tags: keepKnown(tags),
    },
  };
}

// Détail d'un commit : message complet et fichiers modifiés (par rapport au premier parent)
const MAX_FILES = 500;

function readCommit(repo, id) {
  if (!/^[0-9a-f]{4,40}$/i.test(id)) throw new Error('Identifiant de commit invalide');
  const out = git(repo, ['log', '-1', `--format=%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%cn${FIELD}%cI${FIELD}%B`, id, '--']);
  const [hash, parentList, author, email, date, committer, committerDate, ...body] = out.split(FIELD);
  const parents = parentList ? parentList.split(' ') : [];

  // -z : chemins bruts séparés par \0 ; un renommage donne « +\t-\t\0ancien\0nouveau\0 »
  const diffArgs = parents.length
    ? ['diff-tree', '-r', '-z', '--numstat', '-M', parents[0], hash]
    : ['diff-tree', '-r', '-z', '--numstat', '--root', '--no-commit-id', hash];
  const tokens = git(repo, diffArgs).split('\0');
  const files = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^(-|\d+)\t(-|\d+)\t(.*)$/s);
    if (!m) continue;
    const file = { added: m[1] === '-' ? null : +m[1], deleted: m[2] === '-' ? null : +m[2], path: m[3] };
    if (!m[3]) { file.oldPath = tokens[++i]; file.path = tokens[++i]; }
    files.push(file);
  }

  return {
    id: hash, parents, author, email, date, committer, committerDate,
    message: body.join(FIELD).trim(),
    totalFiles: files.length,
    files: files.slice(0, MAX_FILES),
  };
}

// Modifications d'un fichier dans un commit (diff unifié, par rapport au premier parent)
const MAX_DIFF = 400 * 1024;

function readDiff(repo, id, filePath, oldPath) {
  if (!/^[0-9a-f]{4,40}$/i.test(id)) throw new Error('Identifiant de commit invalide');
  if (!filePath) throw new Error('Fichier manquant');
  const parents = git(repo, ['log', '-1', '--format=%P', id, '--']).trim().split(' ').filter(Boolean);
  const paths = oldPath && oldPath !== filePath ? [oldPath, filePath] : [filePath];
  const args = parents.length
    ? ['-c', 'core.quotePath=false', 'diff', '-M', '--no-color', '--no-ext-diff', parents[0], id, '--', ...paths]
    : ['-c', 'core.quotePath=false', 'diff-tree', '-p', '-M', '--no-color', '--no-ext-diff', '--root', id, '--', ...paths];
  const diff = git(repo, args);
  return { diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF };
}

// Un commit au format patch (git format-patch), à appliquer ailleurs avec git am.
// Octets bruts : un patch peut contenir du binaire ou un autre encodage que l'UTF-8.
function sendPatch(res, repo, id) {
  try {
    if (!/^[0-9a-f]{4,40}$/i.test(id)) throw new Error('Identifiant de commit invalide');
    const [hash, parents, subject] = git(repo, ['log', '-1', `--format=%h${FIELD}%P${FIELD}%s`, id, '--']).trim().split(FIELD);
    if (parents.split(' ').length > 1) throw new Error("Un commit de fusion ne s'exporte pas en patch.");
    const patch = execFileSync('git', ['-C', repo, 'format-patch', '-1', '--stdout', id, '--'], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const slug = subject.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52) || 'commit';
    res.writeHead(200, {
      'Content-Type': 'text/x-patch; charset=utf-8',
      'Content-Disposition': `attachment; filename="${hash}-${slug}.patch"`,
      'Cache-Control': 'no-store',
    });
    res.end(patch);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Impossible d'exporter ce commit :\n${err.stderr || err.message}`);
  }
}

// État du dossier de travail (git status).
// --no-optional-locks : git status n'écrit pas son cache dans .git, LisiGraph reste en lecture seule.
const STATUS_MAX = 1000;
const READ_ONLY = ['--no-optional-locks', '-c', 'core.quotePath=false'];

function readStatus(repo) {
  // -z : chemins bruts séparés par \0 ; un renommage donne « XY nouveau\0ancien\0 »
  const tokens = git(repo, [...READ_ONLY, 'status', '--porcelain=v1', '-z']).split('\0');
  const files = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length < 4) continue;
    const file = { x: t[0], y: t[1], path: t.slice(3) };
    if (file.x === 'R' || file.x === 'C') file.oldPath = tokens[++i];
    files.push(file);
  }
  // Opération interrompue : repérée par les fichiers que Git laisse dans .git
  const gitDir = git(repo, ['rev-parse', '--absolute-git-dir']).trim();
  const has = name => fs.existsSync(path.join(gitDir, name));
  const operation = has('rebase-merge') || has('rebase-apply') ? 'rebase'
    : has('MERGE_HEAD') ? 'merge'
    : has('CHERRY_PICK_HEAD') ? 'cherry-pick'
    : has('REVERT_HEAD') ? 'revert'
    : has('BISECT_LOG') ? 'bisect' : null;
  let lastFetch = null;
  try { lastFetch = fs.statSync(path.join(gitDir, 'FETCH_HEAD')).mtime.toISOString(); } catch {}
  return { root: repo, operation, lastFetch, total: files.length, files: files.slice(0, STATUS_MAX) };
}

// Modifications d'un fichier du dossier de travail par rapport au dernier commit (HEAD)
function readWorkingDiff(repo, filePath, oldPath, untracked) {
  if (!filePath) throw new Error('Fichier manquant');
  if (!untracked) {
    const paths = oldPath && oldPath !== filePath ? [oldPath, filePath] : [filePath];
    const diff = git(repo, [...READ_ONLY, 'diff', 'HEAD', '-M', '--no-color', '--no-ext-diff', '--', ...paths]);
    return { diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF };
  }
  // Fichier non suivi : Git n'a rien à comparer, on présente tout le contenu comme ajouté
  const root = fs.realpathSync(repo);
  const full = fs.realpathSync(path.resolve(root, filePath));
  if (!full.startsWith(root + path.sep)) throw new Error('Chemin hors du dépôt');
  if (fs.statSync(full).isDirectory()) return { dir: true };
  const fd = fs.openSync(full, 'r');
  const buf = Buffer.alloc(MAX_DIFF);
  const size = fs.readSync(fd, buf, 0, MAX_DIFF, 0);
  fs.closeSync(fd);
  const content = buf.subarray(0, size);
  if (content.includes(0)) return { diff: 'Binary files differ' };
  const lines = content.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  return { diff: `@@ -0,0 +1,${lines.length} @@\n${lines.map(l => '+' + l).join('\n')}`, truncated: fs.statSync(full).size > MAX_DIFF };
}

// Fetch : la seule commande qui écrit dans le dépôt. Elle ne met à jour que les branches distantes
// (origin/…) dans .git : ni les fichiers du dossier, ni HEAD, ni les branches locales.
const FETCH_TIMEOUT = 120 * 1000;
let fetching = false;

function runFetch(repo) {
  const remotes = git(repo, ['remote']).split('\n').map(s => s.trim()).filter(Boolean);
  if (!remotes.length) return Promise.resolve({ error: "Ce dépôt n'a aucun dépôt distant." });
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  return new Promise(resolve => {
    // Aucune demande d'identifiants : personne ne pourrait y répondre, le fetch resterait bloqué
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    // --no-prune : les branches distantes supprimées restent connues, rien n'est effacé
    execFile('git', ['-C', repo, 'fetch', '--no-prune', remote], { encoding: 'utf8', timeout: FETCH_TIMEOUT, windowsHide: true, env }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, remote });
      const auth = /terminal prompts disabled|could not read (Username|Password)|Authentication failed|Permission denied/i.test(stderr);
      resolve({ error: err.killed ? `Le fetch a dépassé ${FETCH_TIMEOUT / 1000} s et a été arrêté.`
        : auth ? `${remote} demande des identifiants que LisiGraph ne peut pas saisir.\nLancez une fois « git fetch » dans un terminal, dans ce dossier, puis réessayez.\n\n${stderr.trim()}`
        : stderr.trim() || err.message });
    });
  });
}

function sendJson(res, fn, errorLabel) {
  let body;
  try {
    body = fn();
  } catch (err) {
    body = { error: `${errorLabel} :\n${err.stderr || err.message}` };
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Dépôts récents, mémorisés dans ~/.lisigraph.json
// ---------------------------------------------------------------------------
const CONFIG = path.join(os.homedir(), '.lisigraph.json');
const MAX_RECENT = 12;

const OLD_CONFIG = path.join(os.homedir(), '.gitgraph.json'); // avant le renommage en LisiGraph

function loadRecent() {
  for (const file of [CONFIG, OLD_CONFIG]) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).recent || []; } catch {}
  }
  return [];
}
function addRecent(repoPath) {
  const recent = [repoPath, ...loadRecent().filter(p => p !== repoPath)].slice(0, MAX_RECENT);
  try { fs.writeFileSync(CONFIG, JSON.stringify({ recent }, null, 2)); } catch {}
}
// Racine du dépôt contenant ce dossier, ou null
function repoRoot(dir) {
  try { return path.resolve(git(dir, ['rev-parse', '--show-toplevel']).trim()); } catch { return null; }
}
// Pourquoi Git refuse ce dossier alors que c'est bien un dépôt (null s'il n'en est simplement pas un)
function repoRefusal(dir) {
  try { git(dir, ['rev-parse', '--show-toplevel']); return null; } catch (e) {
    const err = String(e.stderr || '');
    // Guillemets doubles : les simples ne fonctionnent pas dans l'invite de commande (cmd)
    const fix = err.match(/git config --global --add safe\.directory '?([^'\r\n]+)'?/);
    if (/dubious ownership/.test(err)) {
      return `Git refuse d'ouvrir « ${dir} » : le dossier appartient à un autre compte Windows (lecteur réseau, par exemple).\n`
           + `Si vous faites confiance à ce dossier, autorisez-le une fois pour toutes :\n  git config --global --add safe.directory "${fix ? fix[1] : dir}"`;
    }
    return /not a git repository/i.test(err) || !fs.existsSync(dir) ? null : err.trim() || null;
  }
}

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------
const opts = parseArgs(process.argv.slice(2));
const PAGE = path.join(__dirname, 'public', 'index.html');

if (opts.repo) {
  // Chemin donné explicitement : il doit être valide
  const root = repoRoot(opts.repo);
  if (!root) {
    console.error(repoRefusal(opts.repo) || `« ${opts.repo} » n'est pas un dépôt Git.`);
    process.exit(1);
  }
  opts.repo = root;
} else {
  // Un dépôt que Git refuse n'est pas remplacé en silence par le dernier dépôt ouvert
  const refusal = repoRefusal(process.cwd());
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  // Sinon : le dossier courant, puis le dernier dépôt ouvert, puis le choix dans la page
  opts.repo = repoRoot(process.cwd()) || loadRecent().map(repoRoot).find(Boolean) || null;
}
if (opts.repo) addRecent(opts.repo);

function openRepo(dir) {
  if (!dir) throw new Error('Chemin manquant');
  const root = repoRoot(path.resolve(dir));
  if (!root) throw new Error(repoRefusal(path.resolve(dir)) || `« ${dir} » n'est pas un dépôt Git (ou le dossier n'existe pas).`);
  opts.repo = root;
  addRecent(root);
  console.log(`LisiGraph : ${root}`);
  return { ok: true, repo: root };
}

// Fenêtre native « Choisir un dossier », ouverte par le serveur (le navigateur ne peut pas donner un chemin complet)
const PICK_PROMPT = 'Choisissez le dossier du dépôt Git';
let picking = false;

function pickFolder() {
  let cmd, args;
  if (process.platform === 'win32') {
    // Fenêtre au premier plan, chemin renvoyé en UTF-8 pour garder les accents
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [Console]::OutputEncoding = [Text.Encoding]::UTF8
      $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.Description = '${PICK_PROMPT}'
      $dialog.ShowNewFolderButton = $false
      if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.SelectedPath }`;
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  } else if (process.platform === 'darwin') {
    cmd = 'osascript';
    args = ['-e', `POSIX path of (choose folder with prompt "${PICK_PROMPT}")`];
  } else {
    cmd = 'zenity';
    args = ['--file-selection', '--directory', `--title=${PICK_PROMPT}`];
  }
  return new Promise(resolve => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      const chosen = (stdout || '').trim();
      if (chosen) resolve({ path: chosen });
      else if (err && err.code === 'ENOENT') resolve({ error: "Impossible d'ouvrir la fenêtre de sélection sur ce système : collez le chemin à la place." });
      else resolve({ cancelled: true }); // fenêtre fermée sans choix
    });
  });
}

function listRepos() {
  return {
    current: opts.repo,
    recent: loadRecent().map(p => ({ path: p, name: path.basename(p), exists: fs.existsSync(p) })),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Seules les pages servies par LisiGraph lui-même peuvent l'interroger
  const port = server.address().port;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
    res.writeHead(403);
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  const q = name => url.searchParams.get(name) || '';
  if (url.pathname === '/api/repos') return sendJson(res, listRepos, 'Impossible de lire les dépôts récents');
  if (url.pathname === '/api/open') {
    // En-tête personnalisé : un autre site ne peut pas envoyer cette requête sans autorisation (CORS)
    if (req.method !== 'POST' || req.headers['x-lisigraph'] !== '1') { res.writeHead(403); return res.end(); }
    let body = {};
    try { body = await readBody(req); } catch {}
    return sendJson(res, () => openRepo(body.path), "Impossible d'ouvrir ce dépôt");
  }
  if (url.pathname === '/api/browse') {
    if (req.method !== 'POST' || req.headers['x-lisigraph'] !== '1') { res.writeHead(403); return res.end(); }
    let result;
    if (picking) result = { error: 'Une fenêtre de sélection est déjà ouverte.' };
    else {
      picking = true;
      try { result = await pickFolder(); } finally { picking = false; }
    }
    return sendJson(res, () => result, '');
  }
  if (url.pathname.startsWith('/api/') && !opts.repo) return sendJson(res, () => ({ needRepo: true }), '');
  if (url.pathname === '/api/graph') return sendJson(res, () => readGraph(opts.repo, opts.max), 'Impossible de lire le dépôt');
  if (url.pathname === '/api/commit') return sendJson(res, () => readCommit(opts.repo, q('id')), 'Impossible de lire le commit');
  if (url.pathname === '/api/diff') return sendJson(res, () => readDiff(opts.repo, q('id'), q('path'), q('old')), 'Impossible de lire les modifications');
  if (url.pathname === '/api/fetch') {
    if (req.method !== 'POST' || req.headers['x-lisigraph'] !== '1') { res.writeHead(403); return res.end(); }
    let result;
    if (fetching) result = { error: 'Un fetch est déjà en cours.' };
    else {
      fetching = true;
      try { result = await runFetch(opts.repo); } catch (err) { result = { error: err.stderr || err.message }; } finally { fetching = false; }
    }
    return sendJson(res, () => result, '');
  }
  if (url.pathname === '/api/patch') return sendPatch(res, opts.repo, q('id'));
  if (url.pathname === '/api/status') return sendJson(res, () => readStatus(opts.repo), "Impossible de lire l'état du dossier");
  if (url.pathname === '/api/wdiff') return sendJson(res, () => readWorkingDiff(opts.repo, q('path'), q('old'), q('untracked') === '1'), 'Impossible de lire les modifications');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(PAGE).pipe(res);
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, () => ({ error: 'Fonction inconnue de ce serveur : relancez lisigraph.' }), '');
  res.writeHead(404);
  res.end();
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd);
}

function listen(port) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE') return listen(0); // port occupé : on en prend un libre
    throw err;
  });
  server.listen(port, '127.0.0.1', () => {
    const query = opts.main ? `?main=${encodeURIComponent(opts.main)}` : '';
    const url = `http://127.0.0.1:${server.address().port}/${query}`;
    console.log(`LisiGraph : ${opts.repo || 'aucun dépôt, à choisir dans la page'}`);
    console.log(`→ ${url}   (Ctrl+C pour arrêter, rechargez la page pour mettre à jour)`);
    if (opts.open) openBrowser(url);
  });
}
listen(opts.port);
