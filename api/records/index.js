const { connectDB, Record } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();

  if (req.method === 'GET') {
    const filter = {};
    if (req.query.month)    filter.date = { $regex: `^${req.query.month}` };
    if (req.query.workerId) filter.workerIds = req.query.workerId;
    const records = await Record.find(filter).sort({ date: -1 });
    return res.json(records);
  }

  if (req.method === 'POST') {
    const { date, location, note, workerIds } = req.body;
    if (!date || !location || !workerIds?.length)
      return res.status(400).json({ error: 'date, location, and workerIds required' });

    const existing = await Record.findOne({ date });
    if (existing) {
      existing.location  = location;
      existing.note      = note || '';
      existing.workerIds = workerIds;
      await existing.save();
      return res.json(existing);
    }

    const record = await Record.create({ date, location, note: note || '', workerIds });
    return res.status(201).json(record);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
