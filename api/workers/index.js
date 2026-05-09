const { connectDB, Worker } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();

  if (req.method === 'GET') {
    const workers = await Worker.find().sort({ name: 1 });
    return res.json(workers);
  }

  if (req.method === 'POST') {
    const { name, wage } = req.body;
    if (!name || wage == null)
      return res.status(400).json({ error: 'name and wage required' });
    const worker = await Worker.create({ name, wage });
    return res.status(201).json(worker);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
