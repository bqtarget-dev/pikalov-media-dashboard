const JSONBIN = 'https://api.jsonbin.io/v3';
const MASTER_KEY = process.env.JSONBIN_MASTER_KEY;

// bin_id can come from env (production) or from request (no-config mode)
function getBinId(req) {
  return process.env.JSONBIN_BIN_ID || req.query?.bid || req.body?.bid || null;
}

async function readBin(binId) {
  try {
    const res = await fetch(`${JSONBIN}/b/${binId}/latest`, {
      headers: { 'X-Master-Key': MASTER_KEY }
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[readBin] JSONBin error', res.status, text);
      return { clients: [], campaigns: [], vk_token: '' };
    }
    const data = await res.json();
    return data.record || { clients: [], campaigns: [], vk_token: '' };
  } catch (e) {
    console.error('[readBin] fetch failed', e.message);
    return { clients: [], campaigns: [], vk_token: '' };
  }
}

async function writeBin(binId, value) {
  try {
    const res = await fetch(`${JSONBIN}/b/${binId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': MASTER_KEY },
      body: JSON.stringify(value)
    });
    if (!res.ok) {
      const text = await res.text();
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
  try {
    const res = await fetch(`${JSONBIN}/b`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': MASTER_KEY,
        'X-Bin-Name': 'pikalov-media',
        'X-Bin-Private': 'true'
      },
      body: JSON.stringify({ clients: [], campaigns: [], vk_token: '' })
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[createBin] JSONBin error', res.status, text);
      return null;
    }
    const data = await res.json();
    return data.metadata?.id || null;
  } catch (e) {
    console.error('[createBin] fetch failed', e.message);
    return null;
  }
}

async function fetchVkStats(campaigns, vkToken) {
  if (!vkToken || !campaigns.length) return campaigns;
  const today = new Date().toISOString().split('T')[0];
  const result = campaigns.map(c => ({ ...c }));
  const batchSize = 50;
  try {
    for (let i = 0; i < result.length; i += batchSize) {
      const batch = result.slice(i, i + batchSize);
      const ids = batch.map(c => c.id).join(',');
      const url = `https://ads.vk.com/api/v2/statistics/ad_plans/day.json?date_from=2025-02-23&date_to=${today}&id=${ids}&metrics=base`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${vkToken}` }
      });
      if (!res.ok) {
        console.error('[fetchVkStats] VK API error', res.status, await res.text());
        continue;
      }
      const data = await res.json();
      if (!data.items) continue;
      data.items.forEach(item => {
        const idx = result.findIndex(c => String(c.id) === String(item.id));
        if (idx === -1) return;
        let spent = 0, plays = 0;
        (item.rows || []).forEach(r => {
          if (r.base) {
            spent += parseFloat(r.base.spent || 0);
            if (r.base.vk) plays += parseInt(r.base.vk.goals || 0);
          }
        });
        result[idx] = { ...result[idx], spent, plays, cpa_play: plays ? spent / plays : 0 };
      });
    }
  } catch (e) {
    console.error('[fetchVkStats] error', e.message);
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!MASTER_KEY) {
    return res.status(503).json({ error: 'JSONBIN_MASTER_KEY not set in Vercel environment variables' });
  }

  if (req.method === 'GET') {
    const binId = getBinId(req);
    if (!binId) {
      return res.status(503).json({ error: 'bin_id missing — pass ?bid= or set JSONBIN_BIN_ID env var' });
    }

    const { token } = req.query;
    const data = await readBin(binId);

    if (token) {
      const client = data.clients.find(c => c.token === token);
      if (!client) return res.status(404).json({ error: 'not_found' });
      let campaigns = client.campaigns
        .map(id => data.campaigns.find(c => c.id === id))
        .filter(Boolean);
      if (data.vk_token) {
        console.log('[GET /api/clients] fetching fresh VK stats for client', client.name, '—', campaigns.length, 'campaigns');
        campaigns = await fetchVkStats(campaigns, data.vk_token);
      }
      return res.status(200).json({ client, campaigns, bin_id: binId });
    }

    return res.status(200).json({ ...data, bin_id: binId });
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (!body || !Array.isArray(body.clients) || !Array.isArray(body.campaigns)) {
      console.error('[POST /api/clients] invalid body', JSON.stringify(body)?.slice(0, 200));
      return res.status(400).json({ error: 'invalid_body' });
    }

    let binId = getBinId(req);

    // Auto-create bin on first save if no bin_id anywhere
    if (!binId) {
      console.log('[POST /api/clients] no bin_id, creating new bin');
      binId = await createBin();
      if (!binId) return res.status(500).json({ error: 'Failed to create JSONBin' });
      console.log('[POST /api/clients] created bin', binId);
      // Return bin_id without writing data — frontend must retry with bin_id
      return res.status(200).json({ ok: true, bin_id: binId, created: true });
    }

    const vk_token = body.vk_token || '';
    console.log('[POST /api/clients] saving', body.clients.length, 'clients,', body.campaigns.length, 'campaigns to bin', binId, vk_token ? '(with vk_token)' : '(no vk_token)');
    const ok = await writeBin(binId, { clients: body.clients, campaigns: body.campaigns, vk_token });
    if (!ok) console.error('[POST /api/clients] writeBin returned false');
    return res.status(ok ? 200 : 500).json({ ok, bin_id: binId });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
