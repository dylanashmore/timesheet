const { connectDB, Worker, Record, Hourly } = require('../_db');
const ExcelJS = require('exceljs');
const path = require('path');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await connectDB();

  const { workerId, periodStart, periodEnd } = req.query;

  const worker = await Worker.findById(workerId);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  // Fetch daily records
  const recFilter = { workerIds: workerId };
  if (periodStart && periodEnd) recFilter.date = { $gte: periodStart, $lte: periodEnd };
  const dailyRecords = await Record.find(recFilter).sort({ date: 1 });

  // Fetch hourly records
  const hrFilter = { workerId };
  if (periodStart && periodEnd) hrFilter.date = { $gte: periodStart, $lte: periodEnd };
  const hourlyRecords = await Hourly.find(hrFilter).sort({ date: 1 });

  // Load template
  const templatePath = path.join(__dirname, '..', 'templates', 'WEEKLY_TIMESHEET_TEMPLATE.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const ws = workbook.getWorksheet('Weekly Time Record');

  // Employee name
  ws.getCell('H6').value = worker.name;

  // Week ending date
  if (periodEnd) {
    ws.getCell('H8').value = new Date(periodEnd + 'T12:00:00');
    ws.getCell('H8').numFmt = 'mm/dd/yyyy';
  }

  // Rate per day
  ws.getCell('F19').value = worker.wage;
  ws.getCell('F19').numFmt = '"$"#,##0.00';

  // Build date -> entries map
  const entryMap = {};
  dailyRecords.forEach(r => {
    if (!entryMap[r.date]) entryMap[r.date] = [];
    entryMap[r.date].push({ desc: r.location + (r.note ? ' — ' + r.note : ''), amount: worker.wage });
  });
  hourlyRecords.forEach(e => {
    if (!entryMap[e.date]) entryMap[e.date] = [];
    entryMap[e.date].push({ desc: `${e.hours}h @ $${e.rate}/hr`, amount: e.hours * e.rate });
  });

  // Rows 11-17: row11=Wed(start) ... row17=Tue(end)
  // Template DATE col derives from H8, so we only write E (job site) and F (amount)
  for (let i = 0; i < 7; i++) {
    const row = 11 + i;
    ws.getCell('E' + row).value = null;
    ws.getCell('F' + row).value = null;

    if (periodStart) {
      const d = new Date(periodStart + 'T12:00:00');
      d.setDate(d.getDate() + i);
      const dateKey = d.toISOString().split('T')[0];
      const entries = entryMap[dateKey];
      if (entries && entries.length > 0) {
        ws.getCell('E' + row).value = entries.map(e => e.desc).join(' | ');
        ws.getCell('F' + row).value = entries.reduce((s, e) => s + e.amount, 0);
        ws.getCell('F' + row).numFmt = '"$"#,##0.00';
      }
    }
  }

  // Stream back as xlsx
  const lastName   = worker.name.split(' ').pop();
  const safePeriod = periodStart && periodEnd ? `${periodStart}_to_${periodEnd}` : 'export';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${lastName}_Timesheet_${safePeriod}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
};
