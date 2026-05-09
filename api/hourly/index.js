const { connectDB, Hourly } = require('../_db');

module.exports = async (req, res) => {
  try {
    await connectDB();

    if (req.method === 'GET') {
      const filter = {};

      if (req.query.workerId) {
        filter.workerId = req.query.workerId;
      }

      if (req.query.month) {
        filter.date = { $regex: `^${req.query.month}` };
      }

      const entries = await Hourly.find(filter).sort({ date: -1 });
      return res.status(200).json(entries);
    }

    if (req.method === 'POST') {
      const { workerId, date, location, hours, rate } = req.body;

      if (!workerId || !date || !hours || !rate) {
        return res.status(400).json({
          error: 'workerId, date, hours, and rate are required'
        });
      }

      const entry = await Hourly.create({
        workerId,
        date,
        location: location || '',
        hours,
        rate
      });

      return res.status(201).json(entry);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('HOURLY API ERROR:', err);
    return res.status(500).json({
      error: err.message || 'Hourly API failed'
    });
  }
};
