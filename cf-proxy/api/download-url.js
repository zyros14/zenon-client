export default async function handler(req, res) {
  try {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: CURSEFORGE_API_KEY missing' });

    const modId = String(req.query?.modId || '').trim();
    const fileId = String(req.query?.fileId || '').trim();
    if (!modId || !fileId) return res.status(400).json({ error: 'Missing modId or fileId' });

    const u = `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/download-url`;
    const r = await fetch(u, { headers: { Accept: 'application/json', 'x-api-key': apiKey } });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(r.status).json(json);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: e?.message || String(e) });
  }
}

