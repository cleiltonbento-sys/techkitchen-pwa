// Armazena material técnico (manual, esquema elétrico, catálogo de peças)
// por marca+modelo. PDFs ficam no Vercel Blob e são servidos diretamente
// pelo CDN — sem proxy, com suporte nativo a Range requests.
//
// Índice: appdata/techdocs-index.json
//   { "<marca>||<modelo>": { "<slotKey>": [{ id, name, updatedAt, url }] } }
//
// Arquivos: techdocs-files/{key}/{slotKey}/{fileId}
// Chunks temporários: techdocs-chunks/{key}/{slotKey}/{fileId}/{i}

const { put, list, del } = require('@vercel/blob');

const INDEX_PATH = 'appdata/techdocs-index.json';

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function getIndex() {
  const { blobs } = await list({ prefix: INDEX_PATH, limit: 1 });
  if (!blobs.length) return {};
  const r = await fetch(blobs[0].url);
  if (!r.ok) return {};
  return await r.json();
}

async function saveIndex(idx) {
  await put(INDEX_PATH, JSON.stringify(idx), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

function normalizeSlot(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [{ id: 'legacy', name: val.name, updatedAt: val.updatedAt || '', url: null }];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const { action, key, slotKey, fileId } = q;

  // ── LISTAR índice completo ─────────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    try {
      const raw = await getIndex();
      const out = {};
      for (const [k, slots] of Object.entries(raw)) {
        out[k] = {};
        for (const [sk, val] of Object.entries(slots)) {
          out[k][sk] = normalizeSlot(val);
        }
      }
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(out);
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao listar: ' + err.message });
    }
  }

  // ── UPLOAD DE CHUNK ────────────────────────────────────────────────────
  // Chunks de até 2MB raw (≈2.7MB base64), dentro do limite de 4.5MB do Vercel
  if (req.method === 'POST' && action === 'upload-chunk') {
    try {
      const buf = await readBody(req);
      const { key: k, slotKey: sk, fileId: fid, chunkIndex, chunkData } = JSON.parse(buf.toString());
      if (!k || !sk || !fid || chunkData === undefined || chunkIndex === undefined) {
        return res.status(400).json({ error: 'Dados incompletos' });
      }
      const chunkBuf = Buffer.from(chunkData, 'base64');
      await put(`techdocs-chunks/${k}/${sk}/${fid}/${chunkIndex}`, chunkBuf, {
        access: 'public',
        contentType: 'application/octet-stream',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao enviar chunk: ' + err.message });
    }
  }

  // ── FINALIZAR UPLOAD ───────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'finalize') {
    try {
      const buf = await readBody(req);
      const { key: k, slotKey: sk, fileId: fid, totalChunks, fileName } = JSON.parse(buf.toString());
      if (!k || !sk || !fid || !totalChunks || !fileName) {
        return res.status(400).json({ error: 'Dados incompletos' });
      }

      // Busca e concatena todos os chunks
      const parts = [];
      for (let i = 0; i < totalChunks; i++) {
        const prefix = `techdocs-chunks/${k}/${sk}/${fid}/${i}`;
        const { blobs } = await list({ prefix, limit: 1 });
        if (!blobs.length) throw new Error(`Chunk ${i} não encontrado`);
        const r = await fetch(blobs[0].url);
        parts.push(Buffer.from(await r.arrayBuffer()));
        await del(blobs[0].url);
      }
      const finalBuf = Buffer.concat(parts);

      // Salva o PDF final e obtém a URL pública do CDN
      const { url } = await put(`techdocs-files/${k}/${sk}/${fid}`, finalBuf, {
        access: 'public',
        contentType: 'application/pdf',
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      // Atualiza o índice com a URL do blob
      const idx = await getIndex();
      if (!idx[k]) idx[k] = {};
      const slot = normalizeSlot(idx[k][sk]);
      slot.push({ id: fid, name: fileName, updatedAt: new Date().toISOString(), url });
      idx[k][sk] = slot;
      await saveIndex(idx);

      return res.status(200).json({ ok: true, url });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao finalizar: ' + err.message });
    }
  }

  // ── REMOVER documento ──────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'delete') {
    try {
      const buf = await readBody(req);
      const { key: k, slotKey: sk, fileId: fid } = JSON.parse(buf.toString());

      // Encontra e deleta o blob do PDF
      const { blobs } = await list({ prefix: `techdocs-files/${k}/${sk}/${fid}`, limit: 1 });
      if (blobs.length) await del(blobs[0].url);

      // Atualiza o índice
      const idx = await getIndex();
      if (idx[k] && idx[k][sk]) {
        const slot = normalizeSlot(idx[k][sk]);
        const updated = slot.filter(f => f.id !== fid);
        if (updated.length === 0) delete idx[k][sk];
        else idx[k][sk] = updated;
        if (Object.keys(idx[k]).length === 0) delete idx[k];
      }
      await saveIndex(idx);

      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao remover: ' + err.message });
    }
  }

  return res.status(400).json({ error: 'Ação inválida' });
};
