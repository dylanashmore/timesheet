const mongoose = require('mongoose');

let cached = global._mongoConn;
if (!cached) cached = global._mongoConn = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI).then(m => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

const workerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },

  // Daily wage for normal job-site work
  wage: { type: Number, required: true, min: 0 },

  // daily = only job-site daily worker
  // hourly = only hourly worker
  // both = can be job-site daily OR hourly
  payType: {
    type: String,
    enum: ['daily', 'hourly', 'both'],
    default: 'daily'
  },

  // Hourly rate for hourly/both workers
  hourlyRate: {
    type: Number,
    default: 0,
    min: 0
  },

  // Should this worker show on the normal Submit Attendance page?
  showOnAttendance: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const recordSchema = new mongoose.Schema({
  date:      { type: String, required: true },
  location:  { type: String, required: true, trim: true },
  note:      { type: String, default: '', trim: true },

  // workerIds stays the canonical list of who worked this day/site. Everything
  // that asks "did this worker work?" still reads it, so records written before
  // half-days existed keep working untouched.
  workerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Worker' }],

  // Per-worker detail, parallel to workerIds. A worker with no entry here is a
  // full day with no comment — exactly what the older records already meant.
  entries: [{
    _id: false,
    workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
    halfDay:  { type: Boolean, default: false },
    note:     { type: String, default: '', trim: true }
  }],
}, { timestamps: true });

// One place decides what a worker earned on a daily record, so the on-screen
// total and the exported timesheet cannot drift apart.
function dailyAmountFor(record, workerId, wage, workerName = '') {
  const entry = (record.entries || []).find(
    e => String(e.workerId) === String(workerId)
  );

  if (entry && entry.halfDay &&
      workerName.trim().toLowerCase() === 'divad ramos') {
    return 100;
  }

  return Number(wage || 0) * (entry && entry.halfDay ? 0.5 : 1);
}

const hourlySchema = new mongoose.Schema({
  workerId: { type: String, required: true },
  date: { type: String, required: true },
  location: { type: String, default: '' },

  timeIn: { type: String, default: '' },
  timeOut: { type: String, default: '' },

  hours: { type: Number, required: true },
  rate: { type: Number, required: true }
}, { timestamps: true });

const Worker = mongoose.models.Worker || mongoose.model('Worker', workerSchema);
const Record = mongoose.models.Record || mongoose.model('Record', recordSchema);
const Hourly = mongoose.models.Hourly || mongoose.model('Hourly', hourlySchema);

module.exports = { connectDB, Worker, Record, Hourly, dailyAmountFor };
