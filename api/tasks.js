const { tasksAPI, cors, json } = require('./_google-tasks');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);

    // GET — list tasks
    if (req.method === 'GET') {
      let listId = url.searchParams.get('list');
      const showCompleted = url.searchParams.get('showCompleted') !== 'false';
      const showHidden = url.searchParams.get('showHidden') === 'true';
      if (!listId) {
        const lists = await tasksAPI('/tasks/v1/users/@me/lists?maxResults=1');
        listId = lists.items?.[0]?.id;
        if (!listId) return json(res, 404, { error: 'No task lists found' });
      }
      const data = await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?maxResults=100&showCompleted=${showCompleted}&showHidden=${showHidden}`);
      return json(res, 200, { listId, tasks: data.items || [] });
    }

    // POST — create task
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      let listId = body.list;
      if (!listId) {
        const lists = await tasksAPI('/tasks/v1/users/@me/lists?maxResults=1');
        listId = lists.items?.[0]?.id;
      }
      const task = { title: body.title };
      if (body.notes) task.notes = body.notes;
      if (body.due) task.due = new Date(body.due).toISOString();
      const created = await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, 'POST', task);
      return json(res, 201, created);
    }

    // PUT — update task
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { list, taskId, title, notes, due, status } = body;
      if (!list || !taskId) return json(res, 400, { error: 'list and taskId required' });
      const existing = await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(taskId)}`);
      const update = { ...existing };
      if (title !== undefined) update.title = title;
      if (notes !== undefined) update.notes = notes;
      if (due !== undefined) update.due = due ? new Date(due).toISOString() : null;
      if (status !== undefined) update.status = status;
      const updated = await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(taskId)}`, 'PUT', update);
      return json(res, 200, updated);
    }

    // DELETE — delete task
    if (req.method === 'DELETE') {
      const listId = url.searchParams.get('list');
      const taskId = url.searchParams.get('taskId');
      if (!listId || !taskId) return json(res, 400, { error: 'list and taskId required' });
      await tasksAPI(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, 'DELETE');
      return json(res, 200, { ok: true });
    }

    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Tasks API error:', err);
    json(res, 500, { error: err.message });
  }
};
