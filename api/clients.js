const JSONBIN = 'https://api.jsonbin.io/v3';
const MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const BIN_ID = process.env.JSONBIN_BIN_ID;

async function readBin() {
  try {
    const res = await fetch(`${JSONBIN}/b/${BIN_ID}/latest`, {
      headers: { 'X-Master-Key': MASTER_KEY }
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[readBin] JSONBin error', res.status, text);
      return { clients: [], campaigns: [] };
    }
    const data = await res.json();
    return data.record || { clients: [], campaigns: [] };
  } catch (e) {
    console.error('[readBin] fetch failed', e.message);
    return { clients: [], campaigns: [] };
  }
}

async function writeBin(value) {
  let res, text;
  try {
    res = await fetch(`${JSONBIN}/b/${BIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': MASTER_KEY },
      body: JSON.stringify(value)
    });
    text = await res.text();
    if (!res.ok) {
      console.error('[writeBin] JSONBin error', res.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[writeBin] fetch failed', e.message);
    return false;
  }
}

async function createBin() {
  let res, text;
  try {
    res = await fetch(`${JSONBIN}/b`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': MASTER_KEY,
        'X-Bin-Name': 'pikalov-media',
        'X-Bin-Private': 'true'
      },
      body: JSON.stringify({ clients: [], campaigns: [] })
    });
    text = await res.text();
    if (!res.ok) {
      console.error('[createBin] JSONBin error', res.status, text);
      return null;
    }
    const data = JSON.parse(text);
    return data.metadata?.id || null;
  } catch (e) {
    console.error('[createBin] fetch failed', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!MASTER_KEY) {
    return res.status(503).json({ error: 'JSONBIN_MASTER_KEY not set in Vercel environment variables' });
  }

  // Auto-create bin on first use if BIN_ID is not configured yet
  if (!BIN_ID) {
    if (req.method === 'POST') {
      const newId = await createBin();
      if (!newId) return res.status(500).json({ error: 'Failed to create JSONBin' });
      return res.status(200).json({
        ok: true,
        setup: true,
        bin_id: newId,
        message: `Bin created! Add JSONBIN_BIN_ID=${newId} to Vercel environment variables and redeploy.`
      });
    }
    return res.status(503).json({ error: 'JSONBIN_BIN_ID not set in Vercel environment variables' });
  }

  if (req.method === 'GET') {
    const { token } = req.query;
    const data = await readBin();

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
      console.error('[POST /api/clients] invalid body', JSON.stringify(body)?.slice(0, 200));
      return res.status(400).json({ error: 'invalid_body' });
    }
    console.log('[POST /api/clients] saving', body.clients.length, 'clients,', body.campaigns.length, 'campaigns');
    const ok = await writeBin({ clients: body.clients, campaigns: body.campaigns });
    if (!ok) console.error('[POST /api/clients] writeBin returned false');
    return res.status(ok ? 200 : 500).json({ ok });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
