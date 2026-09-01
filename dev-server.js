/**
 * Local dev server. Not used in production — Vercel serves public/ statically
 * and runs each api/*.js as its own function. This reproduces that locally:
 * the API handlers below are the real files, unmodified.
 *
 *   node dev-server.js            → in-memory demo data, nothing to install
 *   MONGO_URI=... node dev-server.js → your real database
 *
 * Sign in with PIN 0523 (Boss) or 2004 (Viewer, read-only).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const USE_MEMORY = !process.env.MONGO_URI;

// ── In-memory stand-in for Mongo ──────────────────────────────────
// Installed into require.cache so the real handlers pick it up without
// knowing anything changed. Only the persistence is faked; dailyAmountFor
// and every handler is the genuine article.
function installMemoryDb() {
  const dbPath = require.resolve('./api/_db.js');
  const real = require(dbPath); // safe: requiring only defines schemas

  let seq = 0;
  const oid = () => (Date.now().toString(16) + (seq++).toString().padStart(8, '0')).slice(-24);

  function matches(doc, filter) {
    return Object.entries(filter || {}).every(([key, want]) => {
      const got = doc[key];

      if (want && typeof want === 'object' && !Array.isArray(want)) {
        if ('$gte' in want && !(got >= want.$gte)) return false;
        if ('$lte' in want && !(got <= want.$lte)) return false;
        if ('$regex' in want && !new RegExp(want.$regex).test(String(got))) return false;
        return true;
      }
      // A scalar against an array field means "array contains".
      if (Array.isArray(got)) return got.some(v => String(v) === String(want));
      return String(got) === String(want);
    });
  }

  function collection(seed = []) {
    const docs = [];

    const wrap = raw => {
      const doc = { ...raw, _id: raw._id || oid() };
      doc.save = async () => {
        const i = docs.findIndex(d => d._id === doc._id);
        if (i >= 0) docs[i] = doc;
        return doc;
      };
      return doc;
    };

    seed.forEach(s => docs.push(wrap(s)));

    const query = rows => ({
      sort(spec) {
        const [field, dir] = Object.entries(spec || {})[0] || [];
        const out = [...rows];
        if (field) {
          out.sort((a, b) =>
            (String(a[field] ?? '')).localeCompare(String(b[field] ?? '')) * (dir < 0 ? -1 : 1));
        }
        return Promise.resolve(out);
      },
      then(res, rej) { return Promise.resolve(rows).then(res, rej); },
    });

    return {
      _docs: docs,
      find: (filter = {}) => query(docs.filter(d => matches(d, filter))),
      findOne: async (filter = {}) => docs.find(d => matches(d, filter)) || null,
      findById: async id => docs.find(d => d._id === String(id)) || null,
      create: async obj => { const d = wrap(obj); docs.push(d); return d; },
      findByIdAndUpdate: async (id, patch) => {
        const d = docs.find(x => x._id === String(id));
        if (d) Object.assign(d, patch);
        return d || null;
      },
      findByIdAndDelete: async id => {
        const i = docs.findIndex(x => x._id === String(id));
        return i >= 0 ? docs.splice(i, 1)[0] : null;
      },
    };
  }

  // ── Seed data, shaped to exercise what changed ──────────────────
  const day = n => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const W = [
    { _id: oid(), name: 'Miguel Ramos',  wage: 220, payType: 'daily',  hourlyRate: 0,  showOnAttendance: true },
    { _id: oid(), name: 'Luis Herrera',  wage: 200, payType: 'daily',  hourlyRate: 0,  showOnAttendance: true },
    { _id: oid(), name: 'Andre Willis',  wage: 190, payType: 'both',   hourlyRate: 28, showOnAttendance: true },
    { _id: oid(), name: 'Tomas Delgado', wage: 180, payType: 'daily',  hourlyRate: 0,  showOnAttendance: true },
    { _id: oid(), name: 'Ray Okafor',    wage: 0,   payType: 'hourly', hourlyRate: 32, showOnAttendance: false },
  ];

  const Worker = collection(W);
  const Record = collection([
    // Three people already on one day — try adding a fourth to this date and
    // job site and confirm nobody gets erased.
    { _id: oid(), date: day(2), location: 'Riverside Ave', note: 'Back run + gate',
      workerIds: [W[0]._id, W[1]._id, W[3]._id],
      entries: [{ workerId: W[3]._id, halfDay: true, note: 'left at noon for dentist' }] },
    // A record with no entries field at all, the way everything looked before
    // half-days existed. Must still pay a full day.
    { _id: oid(), date: day(3), location: 'Oak St', note: '',
      workerIds: [W[0]._id, W[2]._id] },
  ]);
  const Hourly = collection([
    { _id: oid(), workerId: W[4]._id, date: day(2), location: 'Shop repairs',
      timeIn: '08:00', timeOut: '14:30', hours: 6.5, rate: 32 },
  ]);

  const stub = { connectDB: async () => {}, Worker, Record, Hourly, dailyAmountFor: real.dailyAmountFor };
  const m = new Module(dbPath, null);
  m.filename = dbPath;
  m.loaded = true;
  m.exports = stub;
  require.cache[dbPath] = m;
}

if (USE_MEMORY) installMemoryDb();

// ── Route table, mirroring Vercel's file-based routing ────────────
const routes = [
  [/^\/api\/export\/?$/,            './api/export.js',        null],
  [/^\/api\/workers\/?$/,           './api/workers/index.js', null],
  [/^\/api\/workers\/([^/]+)\/?$/,  './api/workers/[id].js',  'id'],
  [/^\/api\/records\/?$/,           './api/records/index.js', null],
  [/^\/api\/records\/([^/]+)\/?$/,  './api/records/[id].js',  'id'],
  [/^\/api\/hourly\/?$/,            './api/hourly/index.js',  null],
  [/^\/api\/hourly\/([^/]+)\/?$/,   './api/hourly/[id].js',   'id'],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  // export.js builds the template URL from this; without it we'd try https.
  req.headers['x-forwarded-proto'] = 'http';

  const route = routes.find(([re]) => re.test(pathname));

  if (route) {
    const [re, file, param] = route;
    const match = pathname.match(re);

    req.query = Object.fromEntries(url.searchParams);
    if (param && match[1]) req.query[param] = match[1];
    req.body = await readBody(req);

    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
      return res;
    };

    try {
      await require(file)(req, res);
    } catch (err) {
      console.error(`  ${req.method} ${pathname} failed:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    }
    return;
  }

  // Static files out of public/, defaulting to the app itself.
  let file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end('Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  D Ramos Payroll — local dev');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  PIN 0523  Boss (submit, view, manage)');
  console.log('  PIN 2004  Viewer (view only)');
  console.log('');
  console.log(USE_MEMORY
    ? '  Data: in-memory demo data, seeded fresh. Nothing is saved when you stop\n        the server, and your real database is not touched.'
    : '  Data: your real MongoDB. Anything you change here is REAL.');
  console.log('');
});
