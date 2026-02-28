const { tasksAPI, cors, json } = require('./_google-tasks');
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { list, taskId } = body;
    if (!list || !taskId) return json(res, 400, { error: 'list and taskId required' });
    const existing = await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(taskId)}`);
    existing.status = 'completed';
    const updated = await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(taskId)}`, 'PUT', existing);
    json(res, 200, updated);
  } catch (err) { json(res, 500, { error: err.message }); }
};
