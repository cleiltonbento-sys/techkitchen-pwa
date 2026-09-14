// Armazena os dados do negócio via Vercel Blob (store privado).
// @vercel/blob 2.x: store privado não usa parâmetro access no put().

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
      // downloadUrl includes auth for private stores
      const blobUrl = blobs[0].downloadUrl || blobs[0].url;
      const r = await fetch(blobUrl);
      if (!r.ok) return res.status(200).json(null);
      const data = await r.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao ler: ' + err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      // private store: sem parâmetro access
      await put(BLOB_PATH, JSON.stringify(payload), {
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao salvar: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
