// Armazena os dados PRIVADOS do negócio: empresas, unidades, setores,
// equipamentos, peças e diagnósticos. Não inclui o material técnico
// (manual/elétrico/catálogo), que fica em um espaço separado (techdocs.js)
// pensado para ser compartilhável no futuro.
//
// Netlify Functions v2 + @netlify/blobs v7+
// O `context` precisa ser passado para getStore funcionar corretamente.

import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const store = getStore({ name: 'appdata', context });

  if (req.method === 'GET') {
    try {
      const data = await store.get('main', { type: 'json' });
      return new Response(JSON.stringify(data || null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Falha ao ler dados: ' + err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (req.method === 'POST') {
    try {
      const payload = await req.json();
      await store.setJSON('main', payload);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Falha ao salvar dados: ' + err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: 'Método não permitido' }),
    { status: 405, headers: { 'Content-Type': 'application/json' } }
  );
};
