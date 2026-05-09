const { connectDB, Worker } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();
  const { id } = req.query;

  if (req.method === 'PATCH') {
    const worker = await Worker.findByIdAndUpdate(
      id, { wage: req.body.wage }, { new: true }
    );
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    return res.json(worker);
  }

  if (req.method === 'DELETE') {
    await Worker.findByIdAndDelete(id);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
