# D Ramos Enterprises — Attendance Tracker

# Made to help track employee payroll

## File structure
  index.html        — the full frontend
  vercel.json       — Vercel routing config
  package.json      — dependencies
  api/
    _db.js          — shared MongoDB connection
    workers/
      index.js      — GET all workers, POST new worker
      [id].js       — PATCH wage, DELETE worker
    records/
      index.js      — GET records, POST attendance
      [id].js       — DELETE record
