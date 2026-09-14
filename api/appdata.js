// Armazena os dados PRIVADOS do negócio.
// Usa @vercel/blob 2.x — store público, blobs com URL pública.

const { put, list } = require('@vercel/blob');

const BLOB_PATH = 'appdata/main.json';

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (!blobs.length) return res.status(200).json(null);
      const r = await fetch(blobs[0].url);
      if (!r.ok) return res.status(200).json(null);
      const data = await r.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao ler dados: ' + err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      await put(BLOB_PATH, JSON.stringify(payload), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao salvar dados: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
