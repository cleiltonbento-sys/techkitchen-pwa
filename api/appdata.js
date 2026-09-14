// Armazena os dados PRIVADOS do negócio: empresas, unidades, setores,
// equipamentos, peças e diagnósticos.
// Usa @vercel/blob — BLOB_READ_WRITE_TOKEN é injetado automaticamente
// pelo Vercel quando um Blob store está conectado ao projeto.

const { put, list, download } = require('@vercel/blob');

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
      const { body } = await download(blobs[0].url);
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      const data = JSON.parse(text);
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
        access: 'private',
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
