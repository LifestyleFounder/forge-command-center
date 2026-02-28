const { tasksAPI, cors, json } = require('./_google-tasks');
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const data = await tasksAPI('/tasks/v1/users/@me/lists?maxResults=100');
    json(res, 200, data.items || []);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
};
