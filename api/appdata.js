// Armazena os dados do negócio via Vercel Blob (store privado).
// @vercel/blob 2.x: store privado usa access: 'private'

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
      const listResult = await list({ prefix: BLOB_PATH, limit: 1 });
      const blobs = listResult.blobs;
      if (!blobs || !blobs.length) {
        return res.status(200).json({ _debug: true, blobs: blobs, listResult });
      }
      const blob = blobs[0];
      const blobUrl = blob.downloadUrl || blob.url;
      const r = await fetch(blobUrl);
      if (!r.ok) {
        return res.status(200).json({ _debug: true, fetchStatus: r.status, blobUrl: blobUrl.substring(0, 80) });
      }
      const data = await r.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao ler: ' + err.message, stack: err.stack });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const putResult = await put(BLOB_PATH, JSON.stringify(payload), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true, url: putResult.url });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao salvar: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
