// Armazena o material técnico (manual, esquema elétrico, catálogo de peças)
// por marca+modelo de equipamento. Separado propositalmente dos dados de
// clientes (appdata.js) — este é o espaço pensado para, no futuro, ser
// o "produto" acessível por qualquer técnico que use o app, sem expor
// nada sobre os clientes de ninguém.

const { getStore } = require('@netlify/blobs');

function indexStore() { return getStore('techdocs-index'); }
function fileStore() { return getStore('techdocs-files'); }

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const action = params.action;

  // Lista o índice de documentos disponíveis (metadados só, sem o PDF em si)
  if (event.httpMethod === 'GET' && action === 'list') {
    try {
      const idx = await indexStore().get('index', { type: 'json' });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(idx || {}) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao listar documentos: ' + err.message }) };
    }
  }

  // Serve o PDF em si, para visualizar/baixar
  if (event.httpMethod === 'GET' && action === 'file') {
    const { key, slotKey } = params;
    if (!key || !slotKey) return { statusCode: 400, body: 'Parâmetros ausentes' };
    try {
      const blob = await fileStore().get(`${key}::${slotKey}`, { type: 'arrayBuffer' });
      if (!blob) return { statusCode: 404, body: 'Documento não encontrado' };
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=3600',
        },
        body: Buffer.from(blob).toString('base64'),
        isBase64Encoded: true,
      };
    } catch (err) {
      return { statusCode: 500, body: 'Falha ao carregar documento: ' + err.message };
    }
  }

  // Recebe upload de um novo PDF
  if (event.httpMethod === 'POST' && action === 'upload') {
    try {
      const { key, slotKey, fileName, fileBase64 } = JSON.parse(event.body);
      if (!key || !slotKey || !fileBase64) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
      }
      const buffer = Buffer.from(fileBase64, 'base64');
      await fileStore().set(`${key}::${slotKey}`, buffer);

      const idx = (await indexStore().get('index', { type: 'json' })) || {};
      if (!idx[key]) idx[key] = {};
      idx[key][slotKey] = { name: fileName, updatedAt: new Date().toISOString() };
      await indexStore().setJSON('index', idx);

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao enviar documento: ' + err.message }) };
    }
  }

  // Remove um documento
  if (event.httpMethod === 'POST' && action === 'delete') {
    try {
      const { key, slotKey } = JSON.parse(event.body);
      await fileStore().delete(`${key}::${slotKey}`);
      const idx = (await indexStore().get('index', { type: 'json' })) || {};
      if (idx[key]) delete idx[key][slotKey];
      await indexStore().setJSON('index', idx);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao remover documento: ' + err.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Ação inválida' }) };
};
