const { connectDB, Hourly } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();

  if (req.method === 'GET') {
    const filter = {};
    if (req.query.workerId) filter.workerId = req.query.workerId;
    if (req.query.month)    filter.date = { $regex: `^${req.query.month}` };
    const entries = await Hourly.find(filter).sort({ date: -1 });
    return res.json(entries);
  }

 if (req.method === 'POST') {
    const { workerId, date, location, hours, rate } = req.body;

    if (!workerId || !date || !hours || !rate) {
      return res.status(400).json({ error: 'workerId, date, hours, and rate are required' });
    }

    const entry = await Hourly.create({
      workerId,
      date,
      location: location || '',
      hours,
      rate
    });

  res.status(405).json({ error: 'Method not allowed' });
};
