#!/usr/bin/env node
// GitGraph : affiche le graphe des branches d'un dépôt Git dans le navigateur.
//
//   gitgraph [chemin-du-depot] [--main develop] [--max 2000] [--port 5180] [--no-open]

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
      console.log(`gitgraph ${VERSION}`);
      process.exit(0);
    } else if (a === '-h' || a === '--help') {
      console.log('Usage : gitgraph [chemin-du-depot] [--main <branche>] [--max <nb commits>] [--port <port>] [--no-open] [--version]');
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
  const refsToShow = [...new Set([...Object.values(local), ...Object.values(remote), ...Object.values(tags)])];
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
      headCommit,
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
// Dépôts récents, mémorisés dans ~/.gitgraph.json
// ---------------------------------------------------------------------------
const CONFIG = path.join(os.homedir(), '.gitgraph.json');
const MAX_RECENT = 12;

function loadRecent() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')).recent || []; } catch { return []; }
}
function addRecent(repoPath) {
  const recent = [repoPath, ...loadRecent().filter(p => p !== repoPath)].slice(0, MAX_RECENT);
  try { fs.writeFileSync(CONFIG, JSON.stringify({ recent }, null, 2)); } catch {}
}
// Racine du dépôt contenant ce dossier, ou null
function repoRoot(dir) {
  try { return path.resolve(git(dir, ['rev-parse', '--show-toplevel']).trim()); } catch { return null; }
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
    console.error(`« ${opts.repo} » n'est pas un dépôt Git.`);
    process.exit(1);
  }
  opts.repo = root;
} else {
  // Sinon : le dossier courant, puis le dernier dépôt ouvert, puis le choix dans la page
  opts.repo = repoRoot(process.cwd()) || loadRecent().map(repoRoot).find(Boolean) || null;
}
if (opts.repo) addRecent(opts.repo);

function openRepo(dir) {
  if (!dir) throw new Error('Chemin manquant');
  const root = repoRoot(path.resolve(dir));
  if (!root) throw new Error(`« ${dir} » n'est pas un dépôt Git (ou le dossier n'existe pas).`);
  opts.repo = root;
  addRecent(root);
  console.log(`GitGraph : ${root}`);
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
  // Seules les pages servies par GitGraph lui-même peuvent l'interroger
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
    if (req.method !== 'POST' || req.headers['x-gitgraph'] !== '1') { res.writeHead(403); return res.end(); }
    let body = {};
    try { body = await readBody(req); } catch {}
    return sendJson(res, () => openRepo(body.path), "Impossible d'ouvrir ce dépôt");
  }
  if (url.pathname === '/api/browse') {
    if (req.method !== 'POST' || req.headers['x-gitgraph'] !== '1') { res.writeHead(403); return res.end(); }
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
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(PAGE).pipe(res);
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, () => ({ error: 'Fonction inconnue de ce serveur : relancez gitgraph.' }), '');
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
    console.log(`GitGraph : ${opts.repo || 'aucun dépôt, à choisir dans la page'}`);
    console.log(`→ ${url}   (Ctrl+C pour arrêter, rechargez la page pour mettre à jour)`);
    if (opts.open) openBrowser(url);
  });
}
listen(opts.port);
