const { connectDB, Worker } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();

  if (req.method === 'GET') {
    const workers = await Worker.find().sort({ name: 1 });
    return res.json(workers);
  }

if (req.method === 'POST') {
  const {
    name,
    wage,
    payType = 'daily',
    hourlyRate = 0,
    showOnAttendance = true
  } = req.body;

  if (!name || wage == null) {
    return res.status(400).json({ error: 'Name and wage are required' });
  }

  const worker = await Worker.create({
    name,
    wage,
    payType,
    hourlyRate,
    showOnAttendance
  });

  return res.status(201).json(worker);
}

  res.status(405).json({ error: 'Method not allowed' });
};
