// Armazena o material técnico (manual, esquema elétrico, catálogo de peças)
// por marca+modelo de equipamento. Separado propositalmente dos dados de
// clientes (appdata.js) — este é o espaço pensado para, no futuro, ser
// o "produto" acessível por qualquer técnico que use o app, sem expor
// nada sobre os clientes de ninguém.
//
// Netlify Functions v2 + @netlify/blobs v7+
// O `context` precisa ser passado para getStore funcionar corretamente.

import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  function indexStore() {
    return getStore({ name: 'techdocs-index', context });
  }
  function fileStore() {
    return getStore({ name: 'techdocs-files', context });
  }

  // Lista o índice de documentos disponíveis (metadados só, sem o PDF em si)
  if (req.method === 'GET' && action === 'list') {
    try {
      const idx = await indexStore().get('index', { type: 'json' });
      return new Response(JSON.stringify(idx || {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Falha ao listar documentos: ' + err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Serve o PDF em si, para visualizar/baixar
  if (req.method === 'GET' && action === 'file') {
    const key = url.searchParams.get('key');
    const slotKey = url.searchParams.get('slotKey');
    if (!key || !slotKey) {
      return new Response('Parâmetros ausentes', { status: 400 });
    }
    try {
      const blob = await fileStore().get(`${key}::${slotKey}`, { type: 'arrayBuffer' });
      if (!blob) return new Response('Documento não encontrado', { status: 404 });
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (err) {
      return new Response('Falha ao carregar documento: ' + err.message, { status: 500 });
    }
  }

  // Recebe upload de um novo PDF
  if (req.method === 'POST' && action === 'upload') {
    try {
      const { key, slotKey, fileName, fileBase64 } = await req.json();
      if (!key || !slotKey || !fileBase64) {
        return new Response(
          JSON.stringify({ error: 'Dados incompletos' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const buffer = Buffer.from(fileBase64, 'base64');
      await fileStore().set(`${key}::${slotKey}`, buffer);

      const idx = (await indexStore().get('index', { type: 'json' })) || {};
      if (!idx[key]) idx[key] = {};
      idx[key][slotKey] = { name: fileName, updatedAt: new Date().toISOString() };
      await indexStore().setJSON('index', idx);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Falha ao enviar documento: ' + err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Remove um documento
  if (req.method === 'POST' && action === 'delete') {
    try {
      const { key, slotKey } = await req.json();
      await fileStore().delete(`${key}::${slotKey}`);
      const idx = (await indexStore().get('index', { type: 'json' })) || {};
      if (idx[key]) delete idx[key][slotKey];
      await indexStore().setJSON('index', idx);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Falha ao remover documento: ' + err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: 'Ação inválida' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
};
