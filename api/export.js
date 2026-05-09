const { connectDB, Worker, Record, Hourly } = require('./_db');
const ExcelJS = require('exceljs');

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateText(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
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
    ws.getCell('H8').value = formatDateText(new Date(periodEnd + 'T12:00:00'));

    // Use columns like this:
    // E = daily days worked
    // F = hourly hours worked
    // Row 19 = rates
    ws.getCell('E10').value = 'DAYS';
    ws.getCell('F10').value = 'HOURS';
    ws.getCell('G10').value = '';
    ws.getCell('H10').value = 'TOTAL';

    // Clear old rate row values but keep formatting
    ws.getCell('E19').value = null;
    ws.getCell('F19').value = null;
    ws.getCell('G19').value = null;

    // Daily rate goes under daily column
    ws.getCell('E19').value = Number(worker.wage || 0);
    ws.getCell('E19').numFmt = '"$"#,##0.00';

    // If hourly entries exist, put the hourly rate under hourly column.
    // If multiple rates exist, this uses the first one and notes each rate in the job site text.
    const firstHourlyRate = hourlyRecords.length > 0
      ? Number(hourlyRecords[0].rate || 0)
      : null;

    if (firstHourlyRate !== null) {
      ws.getCell('F19').value = firstHourlyRate;
      ws.getCell('F19').numFmt = '"$"#,##0.00';
    }

    const dayNames = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday'
    ];

    const entriesByDate = {};

    dailyRecords.forEach(r => {
      if (!entriesByDate[r.date]) entriesByDate[r.date] = [];

      entriesByDate[r.date].push({
        type: 'daily',
        jobSite: r.location || '',
        note: r.note || '',
        dailyUnits: 1,
        hourlyHours: null,
        hourlyRate: null
      });
    });

    hourlyRecords.forEach(e => {
      if (!entriesByDate[e.date]) entriesByDate[e.date] = [];

      entriesByDate[e.date].push({
        type: 'hourly',
        jobSite: e.location || 'Hourly Entry',
        note: '',
        dailyUnits: null,
        hourlyHours: Number(e.hours || 0),
        hourlyRate: Number(e.rate || 0)
      });
    });

    for (let i = 0; i < 7; i++) {
      const row = 11 + i;

      const d = new Date(periodStart + 'T12:00:00');
      d.setDate(d.getDate() + i);

      const dateKey = toYMD(d);
      const entries = entriesByDate[dateKey] || [];

      // Clear old values but keep formatting
      ws.getCell(`B${row}`).value = null; // Day
      ws.getCell(`C${row}`).value = null; // Date
      ws.getCell(`D${row}`).value = null; // Job site
      ws.getCell(`E${row}`).value = null; // Daily days
      ws.getCell(`F${row}`).value = null; // Hourly hours
      ws.getCell(`G${row}`).value = null;

      ws.getCell(`B${row}`).value = dayNames[d.getDay()];

      // Write date as text so Excel does not show #####
      ws.getCell(`C${row}`).value = formatDateText(d);

      if (entries.length === 0) continue;

      const dailyEntries = entries.filter(e => e.type === 'daily');
      const hourlyEntries = entries.filter(e => e.type === 'hourly');

      const jobSiteText = entries.map(entry => {
        let text = entry.jobSite || '';

        if (entry.note) {
          text += ` — ${entry.note}`;
        }

        if (entry.type === 'hourly') {
          text += ` (${entry.hourlyHours}h @ $${entry.hourlyRate}/hr)`;
        }

        return text;
      }).filter(Boolean).join(' | ');

      ws.getCell(`D${row}`).value = jobSiteText;

      // Daily: put 1 day, not $1000
      if (dailyEntries.length > 0) {
        ws.getCell(`E${row}`).value = dailyEntries.length;
      }

      // Hourly: put hours worked, not total pay
      if (hourlyEntries.length > 0) {
        const totalHours = hourlyEntries.reduce((sum, entry) => {
          return sum + Number(entry.hourlyHours || 0);
        }, 0);

        ws.getCell(`F${row}`).value = totalHours;
      }

      // If hourly rates differ, template formulas cannot represent multiple rates in one column.
      // In that case, the job site text still shows the exact per-entry rate.
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
