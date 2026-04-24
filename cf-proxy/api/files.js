export default async function handler(req, res) {
  try {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: CURSEFORGE_API_KEY missing' });

    const modId = String(req.query?.modId || '').trim();
    if (!modId) return res.status(400).json({ error: 'Missing modId' });

    const u = new URL(`https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files`);
    const allow = ['gameVersion', 'modLoaderType', 'index', 'pageSize'];
    for (const k of allow) {
      const v = req.query?.[k];
      if (v == null || v === '') continue;
      u.searchParams.set(k, String(v));
    }

    const r = await fetch(u.toString(), {
      headers: { Accept: 'application/json', 'x-api-key': apiKey }
    });
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

