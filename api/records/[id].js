const { connectDB, Record } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();

  if (req.method === 'DELETE') {
    await Record.findByIdAndDelete(req.query.id);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
