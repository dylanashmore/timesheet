const { connectDB, Worker, Record, Hourly } = require('./_db');
const ExcelJS = require('exceljs');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    await connectDB();

    const { workerId, periodStart, periodEnd } = req.query;

    if (!workerId) {
      return res.status(400).json({ error: 'workerId required' });
    }

    const worker = await Worker.findById(workerId);

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const recFilter = { workerIds: workerId };
    if (periodStart && periodEnd) {
      recFilter.date = { $gte: periodStart, $lte: periodEnd };
    }

    const dailyRecords = await Record.find(recFilter).sort({ date: 1 });

    const hrFilter = { workerId };
    if (periodStart && periodEnd) {
      hrFilter.date = { $gte: periodStart, $lte: periodEnd };
    }

    const hourlyRecords = await Hourly.find(hrFilter).sort({ date: 1 });

    // Load template from public URL instead of filesystem
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

    // Top template fields
    ws.getCell('H6').value = worker.name;

    if (periodEnd) {
      ws.getCell('H8').value = new Date(periodEnd + 'T12:00:00');
      ws.getCell('H8').numFmt = 'mm/dd/yyyy';
    }

    // Daily wage reference row
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

    // Fill rows 11–17 for the selected pay period
    for (let i = 0; i < 7; i++) {
      const row = 11 + i;

      // Clear old row values but keep formatting
      ws.getCell(`B${row}`).value = null; // Day
      ws.getCell(`C${row}`).value = null; // Date
      ws.getCell(`D${row}`).value = null; // Job Site
      ws.getCell(`E${row}`).value = null; // Amount
      ws.getCell(`F${row}`).value = null; // Leave alone / extra column if template has it

      if (!periodStart) continue;

      const d = new Date(periodStart + 'T12:00:00');
      d.setDate(d.getDate() + i);

      const dateKey = d.toISOString().split('T')[0];

      const dailyForDay = dailyRecords.filter(r => r.date === dateKey);
      const hourlyForDay = hourlyRecords.filter(e => e.date === dateKey);

      const entries = [];

      // Daily attendance entries: amount = worker's daily wage
      dailyForDay.forEach(r => {
        entries.push({
          type: 'daily',
          jobSite: r.location || '',
          note: r.note || '',
          amount: Number(worker.wage || 0),
          description: ''
        });
      });

      // Hourly entries: amount = hours × rate
      hourlyForDay.forEach(e => {
        const hours = Number(e.hours || 0);
        const rate = Number(e.rate || 0);

        entries.push({
          type: 'hourly',
          jobSite: e.location || 'Hourly Entry',
          note: '',
          amount: hours * rate,
          description: `${hours}h × $${rate}/hr`
        });
      });

      if (entries.length === 0) continue;

      const totalForDay = entries.reduce((sum, entry) => {
        return sum + Number(entry.amount || 0);
      }, 0);

      const jobSiteText = entries
        .map(entry => {
          let text = entry.jobSite || '';

          if (entry.note) {
            text += ` — ${entry.note}`;
          }

          if (entry.type === 'hourly' && entry.description) {
            text += text ? ` (${entry.description})` : entry.description;
          }

          return text;
        })
        .filter(Boolean)
        .join(' | ');

      ws.getCell(`B${row}`).value = dayNames[d.getDay()];

      ws.getCell(`C${row}`).value = d;
      ws.getCell(`C${row}`).numFmt = 'm/d/yyyy';

      ws.getCell(`D${row}`).value = jobSiteText;

      ws.getCell(`E${row}`).value = totalForDay;
      ws.getCell(`E${row}`).numFmt = '"$"#,##0.00';
    }

    const lastName = worker.name.split(' ').pop();
    const safePeriod = periodStart && periodEnd
      ? `${periodStart}_to_${periodEnd}`
      : 'export';

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
