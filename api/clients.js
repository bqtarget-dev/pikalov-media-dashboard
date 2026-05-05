const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'pm_data';

async function kvGet() {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(value) {
  if (!KV_URL || !KV_TOKEN) return false;
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', KEY, JSON.stringify(value)]])
  });
  return res.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { token } = req.query;
    const stored = await kvGet();
    const data = stored || { clients: [], campaigns: [] };

    if (token) {
      const client = data.clients.find(c => c.token === token);
      if (!client) return res.status(404).json({ error: 'not_found' });
      const campaigns = client.campaigns
        .map(id => data.campaigns.find(c => c.id === id))
        .filter(Boolean);
      return res.status(200).json({ client, campaigns });
    }

    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (!body || !Array.isArray(body.clients) || !Array.isArray(body.campaigns)) {
      return res.status(400).json({ error: 'invalid_body' });
    }
    const ok = await kvSet({ clients: body.clients, campaigns: body.campaigns });
    return res.status(ok ? 200 : 500).json({ ok });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
