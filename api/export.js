const { connectDB, Worker, Record, Hourly } = require('./_db');
const ExcelJS = require('exceljs');

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getCurrentPayPeriod() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const day = today.getDay(); // Sun=0 Mon=1 Tue=2 Wed=3
  const daysSinceWednesday = (day - 3 + 7) % 7;

  const start = new Date(today);
  start.setDate(start.getDate() - daysSinceWednesday);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return {
    periodStart: toYMD(start),
    periodEnd: toYMD(end)
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    await connectDB();

    let { workerId, periodStart, periodEnd } = req.query;

    if (!workerId) {
      return res.status(400).json({ error: 'workerId required' });
    }

    const worker = await Worker.findById(workerId);

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // If no period was passed, use the current Wed–Tue pay period
    if (!periodStart || !periodEnd) {
      const currentPeriod = getCurrentPayPeriod();
      periodStart = currentPeriod.periodStart;
      periodEnd = currentPeriod.periodEnd;
    }

    const dailyRecords = await Record.find({
      workerIds: workerId,
      date: { $gte: periodStart, $lte: periodEnd }
    }).sort({ date: 1 });

    const hourlyRecords = await Hourly.find({
      workerId,
      date: { $gte: periodStart, $lte: periodEnd }
    }).sort({ date: 1 });

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const templateUrl = `${protocol}://${host}/templates/WEEKLY_TIMESHEET_TEMPLATE.xlsx`;

    const templateRes = await fetch(templateUrl);

    if (!templateRes.ok) {
      throw new Error(`Could not load template: ${templateRes.status} ${templateRes.statusText}`);
    }

    const templateBuffer = await templateRes.arrayBuffer();

    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(Buffer.from(templateBuffer), {
      ignoreNodes: ['autoFilter', 'tableParts', 'extLst']
    });

    const ws = workbook.getWorksheet('Weekly Time Record') || workbook.worksheets[0];

    if (!ws) {
      throw new Error('No worksheet found in template');
    }

    // Header fields
    ws.getCell('H6').value = worker.name;
    ws.getCell('H8').value = new Date(periodEnd + 'T12:00:00');
    ws.getCell('H8').numFmt = 'mm/dd/yyyy';

    // Daily wage reference
    ws.getCell('F19').value = Number(worker.wage || 0);
    ws.getCell('F19').numFmt = '"$"#,##0.00';

    const dayNames = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday'
    ];

    // Build map by date
    const entriesByDate = {};

    dailyRecords.forEach(r => {
      if (!entriesByDate[r.date]) entriesByDate[r.date] = [];

      entriesByDate[r.date].push({
        type: 'daily',
        jobSite: r.location || '',
        note: r.note || '',
        amount: Number(worker.wage || 0),
        details: ''
      });
    });

    hourlyRecords.forEach(e => {
      if (!entriesByDate[e.date]) entriesByDate[e.date] = [];

      const hours = Number(e.hours || 0);
      const rate = Number(e.rate || 0);

      entriesByDate[e.date].push({
        type: 'hourly',
        jobSite: e.location || 'Hourly Entry',
        note: '',
        amount: hours * rate,
        details: `${hours}h × $${rate}/hr`
      });
    });

    // Fill rows 11–17, one row per date in the pay period
    for (let i = 0; i < 7; i++) {
      const row = 11 + i;

      const d = new Date(periodStart + 'T12:00:00');
      d.setDate(d.getDate() + i);

      const dateKey = toYMD(d);
      const entries = entriesByDate[dateKey] || [];

      // Clear old values but keep formatting
      ws.getCell(`B${row}`).value = null; // Day
      ws.getCell(`C${row}`).value = null; // Date
      ws.getCell(`D${row}`).value = null; // Job Site
      ws.getCell(`E${row}`).value = null; // Amount

      ws.getCell(`B${row}`).value = dayNames[d.getDay()];
      ws.getCell(`C${row}`).value = d;
      ws.getCell(`C${row}`).numFmt = 'm/d/yyyy';

      if (entries.length === 0) continue;

      const jobSiteText = entries.map(entry => {
        let text = entry.jobSite || '';

        if (entry.note) {
          text += ` — ${entry.note}`;
        }

        if (entry.type === 'hourly' && entry.details) {
          text += text ? ` (${entry.details})` : entry.details;
        }

        return text;
      }).filter(Boolean).join(' | ');

      const totalForDay = entries.reduce((sum, entry) => {
        return sum + Number(entry.amount || 0);
      }, 0);

      ws.getCell(`D${row}`).value = jobSiteText;
      ws.getCell(`E${row}`).value = totalForDay;
      ws.getCell(`E${row}`).numFmt = '"$"#,##0.00';
    }

    const lastName = worker.name.split(' ').pop();
    const safePeriod = `${periodStart}_to_${periodEnd}`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${lastName}_Timesheet_${safePeriod}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('EXPORT ERROR:', err);
    return res.status(500).json({
      error: err.message || 'Export failed'
    });
  }
};
