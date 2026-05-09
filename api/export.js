const { connectDB, Worker, Record, Hourly } = require('./_db');
const ExcelJS = require('exceljs');

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateText(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatTime12(time) {
  if (!time) return '';

  const [hourStr, minute] = time.split(':');
  let hour = Number(hourStr);

  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;

  return `${hour}:${minute} ${ampm}`;
}

function safeFileName(name) {
  return String(name || 'worker')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
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

    // Default to current Wed–Tue pay period if no period is passed
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

    // Daily entries: amount = worker daily wage
    dailyRecords.forEach(record => {
      if (!entriesByDate[record.date]) entriesByDate[record.date] = [];

      entriesByDate[record.date].push({
        type: 'daily',
        location: record.location || '',
        note: record.note || '',
        amount: Number(worker.wage || 0)
      });
    });

    // Hourly entries: amount = hours × hourly rate
hourlyRecords.forEach(entry => {
  if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];

  const hours = Number(entry.hours || 0);
  const rate = Number(entry.rate || 0);

  entriesByDate[entry.date].push({
    type: 'hourly',
    location: entry.location || 'Hourly Entry',
    note: '',
    amount: hours * rate,
    hours,
    rate,
    timeIn: entry.timeIn || '',
    timeOut: entry.timeOut || ''
  });
});

    let weeklyTotal = 0;
    let weeklyHours = 0;

    // Fill rows 11–17
    for (let i = 0; i < 7; i++) {
      const row = 11 + i;

      const date = new Date(periodStart + 'T12:00:00');
      date.setDate(date.getDate() + i);

      const dateKey = toYMD(date);
      const entries = entriesByDate[dateKey] || [];

      // Clear old values but keep formatting
      ws.getCell(`B${row}`).value = null; // Day
      ws.getCell(`D${row}`).value = null; // Date
      ws.getCell(`E${row}`).value = null; // Location
      ws.getCell(`F${row}`).value = null; // Amount
      ws.getCell(`G${row}`).value = null; // Clock In
      ws.getCell(`H${row}`).value = null; // Clock Out
      ws.getCell(`I${row}`).value = null; // Total
      // Always fill day/date for the pay period
      ws.getCell(`B${row}`).value = dayNames[date.getDay()];
      ws.getCell(`D${row}`).value = formatDateText(date);

      if (entries.length === 0) continue;

      const locationText = entries.map(entry => {
        let text = entry.location || '';

        if (entry.note) {
          text += ` — ${entry.note}`;
        }

        return text;
      }).filter(Boolean).join(' | ');

      const dayTotal = entries.reduce((sum, entry) => {
        return sum + Number(entry.amount || 0);
      }, 0);

      const hourlyEntriesForDay = entries.filter(entry => entry.type === 'hourly');

      const totalHoursForDay = hourlyEntriesForDay.reduce((sum, entry) => {
        return sum + Number(entry.hours || 0);
      }, 0);
      
      const clockInText = hourlyEntriesForDay
        .map(entry => formatTime12(entry.timeIn))
        .filter(Boolean)
        .join(' | ');
      
      const clockOutText = hourlyEntriesForDay
        .map(entry => formatTime12(entry.timeOut))
        .filter(Boolean)
        .join(' | ');

      weeklyTotal += dayTotal;
      weeklyHours += totalHoursForDay;

      ws.getCell(`E${row}`).value = locationText;

      ws.getCell(`F${row}`).value = dayTotal;
      ws.getCell(`F${row}`).numFmt = '"$"#,##0.00';

      ws.getCell(`I${row}`).value = dayTotal;
      ws.getCell(`I${row}`).numFmt = '"$"#,##0.00';

      if (hourlyEntriesForDay.length > 0) {
        ws.getCell(`G${row}`).value = clockInText;
        ws.getCell(`H${row}`).value = clockOutText;
      }
    }

    // Weekly total
    ws.getCell('I20').value = weeklyTotal;
    ws.getCell('I20').numFmt = '"$"#,##0.00';

    ws.getCell('H18').value = weeklyHours;
    ws.getCell('H18').numFmt = '0.00';

    const employeeName = safeFileName(worker.name);
    const safePeriod = `${periodStart}_to_${periodEnd}`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${employeeName}_Timesheet_${safePeriod}.xlsx"`
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
