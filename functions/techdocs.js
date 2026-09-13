// Armazena o material técnico (manual, esquema elétrico, catálogo de peças)
// por marca+modelo de equipamento. Separado propositalmente dos dados de
// clientes (appdata.js) — este é o espaço pensado para, no futuro, ser
// o "produto" acessível por qualquer técnico que use o app, sem expor
// nada sobre os clientes de ninguém.
//
// Estrutura do índice (techdocs-index / "index"):
//   { "<marca>::<modelo>": { "<slotKey>": [{ id, name, updatedAt }] } }
//
// Estrutura dos arquivos (techdocs-files):
//   "<marca>::<modelo>::<slotKey>::<fileId>"  → buffer do PDF
//   "<marca>::<modelo>::<slotKey>::<fileId>::chunk::<n>"  → chunk temporário
//
// Compatibilidade com formato antigo ({ name, updatedAt } em vez de array):
//   normalizeSlot() converte automaticamente ao ler.

const { getStore } = require('@netlify/blobs');

// Usa credenciais explícitas SOMENTE quando siteID E token estão presentes.
// Sem token, passar apenas siteID quebra a auto-detecção do NETLIFY_BLOBS_CONTEXT.
// NETLIFY_AUTH_TOKEN deve ser configurado no painel do Netlify:
//   netlify.com → User settings → Applications → Personal access tokens
function makeStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

function indexStore() { return makeStore('techdocs-index'); }
function fileStore()  { return makeStore('techdocs-files'); }

// Garante que um slot do índice seja sempre um array
function normalizeSlot(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  // Formato antigo: { name, updatedAt }
  return [{ id: 'legacy', name: val.name, updatedAt: val.updatedAt || '' }];
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const action = params.action;

  // ── LISTAR índice completo ──────────────────────────────────────────────
  if (event.httpMethod === 'GET' && action === 'list') {
    try {
      const raw = (await indexStore().get('index', { type: 'json' })) || {};
      const out = {};
      for (const [k, slots] of Object.entries(raw)) {
        out[k] = {};
        for (const [sk, val] of Object.entries(slots)) {
          out[k][sk] = normalizeSlot(val);
        }
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao listar: ' + err.message }) };
    }
  }

  // ── SERVIR PDF (com suporte a Range requests para arquivos grandes) ────
  if (event.httpMethod === 'GET' && action === 'file') {
    const { key, slotKey, fileId } = params;
    if (!key || !slotKey) return { statusCode: 400, body: 'Parâmetros ausentes' };
    try {
      // Suporta chave antiga (sem fileId) e nova (com fileId)
      const blobKey = fileId && fileId !== 'legacy'
        ? `${key}::${slotKey}::${fileId}`
        : `${key}::${slotKey}`;
      const blob = await fileStore().get(blobKey, { type: 'arrayBuffer' });
      if (!blob) return { statusCode: 404, body: 'Documento não encontrado' };

      const buf = Buffer.from(blob);
      const totalBytes = buf.length;

      // Suporte a Range requests (PDF.js usa para carregar PDFs grandes em partes)
      const reqHeaders = event.headers || {};
      const rangeHeader = reqHeaders['range'] || reqHeaders['Range'] || '';
      let start = 0, end = totalBytes - 1, statusCode = 200;

      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          start = parseInt(m[1], 10);
          end = m[2] ? Math.min(parseInt(m[2], 10), totalBytes - 1) : totalBytes - 1;
          statusCode = 206;
        }
      }

      const slice = buf.slice(start, end + 1);
      return {
        statusCode,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
          'Content-Length': String(slice.length),
          'Cache-Control': 'public, max-age=3600',
        },
        body: slice.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (err) {
      return { statusCode: 500, body: 'Falha ao carregar: ' + err.message };
    }
  }

  // ── UPLOAD DE CHUNK ────────────────────────────────────────────────────
  // Cada chunk chega como base64 (≤4MB base64 ≈ 3MB raw, dentro do limite de 6MB da função)
  if (event.httpMethod === 'POST' && action === 'upload-chunk') {
    try {
      const { key, slotKey, fileId, chunkIndex, chunkData } = JSON.parse(event.body);
      if (!key || !slotKey || !fileId || chunkData === undefined || chunkIndex === undefined) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
      }
      const buf = Buffer.from(chunkData, 'base64');
      await fileStore().set(`${key}::${slotKey}::${fileId}::chunk::${chunkIndex}`, buf);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao enviar chunk: ' + err.message }) };
    }
  }

  // ── FINALIZAR UPLOAD (junta chunks e salva o PDF final) ─────────────────
  if (event.httpMethod === 'POST' && action === 'finalize') {
    try {
      const { key, slotKey, fileId, totalChunks, fileName } = JSON.parse(event.body);
      if (!key || !slotKey || !fileId || !totalChunks || !fileName) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
      }

      // Lê e concatena todos os chunks
      const parts = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = await fileStore().get(`${key}::${slotKey}::${fileId}::chunk::${i}`, { type: 'arrayBuffer' });
        if (!chunk) throw new Error(`Chunk ${i} não encontrado`);
        parts.push(Buffer.from(chunk));
        // Apaga o chunk temporário
        await fileStore().delete(`${key}::${slotKey}::${fileId}::chunk::${i}`);
      }
      const finalBuf = Buffer.concat(parts);
      await fileStore().set(`${key}::${slotKey}::${fileId}`, finalBuf);

      // Atualiza o índice
      const idx = (await indexStore().get('index', { type: 'json' })) || {};
      if (!idx[key]) idx[key] = {};
      const slot = normalizeSlot(idx[key][slotKey]);
      slot.push({ id: fileId, name: fileName, updatedAt: new Date().toISOString() });
      idx[key][slotKey] = slot;
      await indexStore().setJSON('index', idx);

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao finalizar: ' + err.message }) };
    }
  }

  // ── REMOVER documento específico ───────────────────────────────────────
  if (event.httpMethod === 'POST' && action === 'delete') {
    try {
      const { key, slotKey, fileId } = JSON.parse(event.body);
      const blobKey = fileId && fileId !== 'legacy'
        ? `${key}::${slotKey}::${fileId}`
        : `${key}::${slotKey}`;
      await fileStore().delete(blobKey);

      const idx = (await indexStore().get('index', { type: 'json' })) || {};
      if (idx[key] && idx[key][slotKey]) {
        const slot = normalizeSlot(idx[key][slotKey]);
        const updated = slot.filter(f => f.id !== fileId);
        if (updated.length === 0) {
          delete idx[key][slotKey];
        } else {
          idx[key][slotKey] = updated;
        }
        if (Object.keys(idx[key]).length === 0) delete idx[key];
      }
      await indexStore().setJSON('index', idx);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao remover: ' + err.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Ação inválida' }) };
};
