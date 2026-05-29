const { connectDB, Record } = require('../_db');

module.exports = async (req, res) => {
  await connectDB();

  if (req.method === 'DELETE') {
    const { id, workerId } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Record id required' });
    }

    const record = await Record.findById(id);

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // If workerId is passed, remove only that worker from the record
    if (workerId) {
      record.workerIds = record.workerIds.filter(
        id => id.toString() !== workerId.toString()
      );

      // If no workers are left, delete the whole record
      if (record.workerIds.length === 0) {
        await Record.findByIdAndDelete(id);
        return res.json({ ok: true, deletedRecord: true });
      }

      await record.save();
      return res.json({ ok: true, removedWorker: true });
    }

    // Fallback: delete whole record only if no workerId is given
    await Record.findByIdAndDelete(id);
    return res.json({ ok: true, deletedRecord: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
