const { connectDB, Record } = require('../_db');

module.exports = async (req, res) => {
  try {
    await connectDB();

    if (req.method === 'GET') {
      const records = await Record.find({}).sort({ date: -1, createdAt: -1 });
      return res.status(200).json(records);
    }

    if (req.method === 'POST') {
      const { date, location, note, workerIds } = req.body;

      if (!date || !location || !Array.isArray(workerIds)) {
        return res.status(400).json({
          error: 'date, location, and workerIds are required'
        });
      }

      // Only update if the SAME date and SAME location already exist.
      // Different job sites on the same day should create separate records.
      const existing = await Record.findOne({
        date,
        location: location.trim()
      });

      if (existing) {
        existing.note = note || '';
        existing.workerIds = workerIds;
        await existing.save();

        return res.status(200).json(existing);
      }

      const record = await Record.create({
        date,
        location: location.trim(),
        note: note || '',
        workerIds
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
