const { connectDB, Record } = require('../_db');
const { isFutureDate, todayStr } = require('../_date');

// Keeps only the entries whose worker is actually on the record, and drops
// anything the client sent that we don't store.
function cleanEntries(entries, allowedIds) {
  const allowed = new Set(allowedIds.map(String));

  return (entries || [])
    .filter(e => e && e.workerId && allowed.has(String(e.workerId)))
    .map(e => ({
      workerId: String(e.workerId),
      halfDay: Boolean(e.halfDay),
      note: typeof e.note === 'string' ? e.note.trim() : ''
    }));
}

// Folds a submission into the record that already exists for that day and job
// site. Pure and mutating-in-place so it can be tested without a database.
//
// Merge, never replace. Logging one worker after the fact used to overwrite
// workerIds outright, erasing everyone else already on that day. Taking a
// worker off a day stays a separate, deliberate action:
// DELETE /api/records/:id?workerId=...
function mergeIntoRecord(existing, { workerIds, entries, note }) {
  const mergedIds = new Map(existing.workerIds.map(id => [String(id), id]));
  workerIds.forEach(id => mergedIds.set(String(id), id));
  existing.workerIds = [...mergedIds.values()];

  // Same merge for the per-worker detail: whatever the user just entered wins
  // for those workers, everyone else keeps what they had.
  const mergedEntries = new Map(
    (existing.entries || []).map(e => [
      String(e.workerId),
      { workerId: String(e.workerId), halfDay: Boolean(e.halfDay), note: e.note || '' }
    ])
  );
  cleanEntries(entries, existing.workerIds).forEach(e => {
    mergedEntries.set(String(e.workerId), e);
  });
  existing.entries = [...mergedEntries.values()];

  // Only replace the day note when a new one was actually typed, so adding a
  // worker later doesn't wipe the note from the original entry.
  if (typeof note === 'string' && note.trim()) {
    existing.note = note.trim();
  }

  return existing;
}

module.exports = async (req, res) => {
  try {
    await connectDB();

    if (req.method === 'GET') {
      const records = await Record.find({}).sort({ date: -1, createdAt: -1 });
      return res.status(200).json(records);
    }

    if (req.method === 'POST') {
      const { date, location, note, workerIds, entries } = req.body;

      if (!date || !location || !Array.isArray(workerIds)) {
        return res.status(400).json({
          error: 'date, location, and workerIds are required'
        });
      }

      // The browser blocks future dates too, but that guard is only as good as
      // the browser — a stale tab open past midnight would still post yesterday's
      // form against today's clock.
      if (isFutureDate(date)) {
        return res.status(400).json({
          error: `You can't log work for ${date} because that day hasn't happened yet. Today is ${todayStr()}.`
        });
      }

      // Only update if the SAME date and SAME location already exist.
      // Different job sites on the same day should create separate records.
      const existing = await Record.findOne({
        date,
        location: location.trim()
      });

      if (existing) {
        mergeIntoRecord(existing, { workerIds, entries, note });

        await existing.save();

        return res.status(200).json(existing);
      }

      const record = await Record.create({
        date,
        location: location.trim(),
        note: note || '',
        workerIds,
        entries: cleanEntries(entries, workerIds)
      });

      return res.status(201).json(record);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('RECORDS API ERROR:', err);
    return res.status(500).json({
      error: err.message || 'Records API failed'
    });
  }
};

// Exposed for tests; Vercel only ever calls the exported handler itself.
module.exports.mergeIntoRecord = mergeIntoRecord;
module.exports.cleanEntries = cleanEntries;
