// Armazena os dados PRIVADOS do negócio: empresas, unidades, setores,
// equipamentos, peças e diagnósticos. Não inclui o material técnico
// (manual/elétrico/catálogo), que fica em um espaço separado (techdocs.js)
// pensado para ser compartilhável no futuro.

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const store = getStore('appdata');

  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get('main', { type: 'json' });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || null),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao ler dados: ' + err.message }) };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const payload = JSON.parse(event.body);
      await store.setJSON('main', payload);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao salvar dados: ' + err.message }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
};
