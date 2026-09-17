// Armazena os dados do negócio via Vercel Blob (store privado).
// @vercel/blob 2.x: private store — leitura requer Authorization header com BLOB_READ_WRITE_TOKEN

const { put, list } = require('@vercel/blob');

const BLOB_PATH    = 'appdata/main.json';
const BACKUP_PFX   = 'appdata/backup_';
const MAX_BACKUPS  = 5;

async function readBlob(url, token) {
  try {
    const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

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

  const token  = process.env.BLOB_READ_WRITE_TOKEN;
  const action = req.query?.action || '';

  // ── GET ────────────────────────────────────────────────────────────────────

  if (req.method === 'GET') {

    // Listar backups disponíveis
    if (action === 'list_backups') {
      try {
        const { blobs } = await list({ prefix: BACKUP_PFX, limit: MAX_BACKUPS + 2 });
        const infos = await Promise.all(blobs.map(async b => {
          const data = await readBlob(b.url, token);
          return {
            slot:       b.pathname.replace(BACKUP_PFX, '').replace('.json', ''),
            savedAt:    data?._savedAt   ?? null,
            equipCount: data?.equipment?.length ?? 0,
          };
        }));
        // Mais recente primeiro
        infos.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        return res.status(200).json(infos);
      } catch (err) {
        return res.status(500).json({ error: 'Falha ao listar backups: ' + err.message });
      }
    }

    // Ler um backup específico
    if (action === 'get_backup') {
      const slot = req.query.slot;
      try {
        const { blobs } = await list({ prefix: BACKUP_PFX + slot + '.json', limit: 1 });
        if (!blobs.length) return res.status(404).json({ error: 'Backup não encontrado' });
        const data = await readBlob(blobs[0].url, token);
        return res.status(200).json(data);
      } catch (err) {
        return res.status(500).json({ error: 'Falha ao ler backup: ' + err.message });
      }
    }

    // Leitura padrão
    try {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (!blobs.length) return res.status(200).json(null);
      const data = await readBlob(blobs[0].url, token);
      return res.status(200).json(data || null);
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao ler: ' + err.message });
    }
  }

  // ── POST ───────────────────────────────────────────────────────────────────

  if (req.method === 'POST') {

    // Restaurar backup
    if (action === 'restore_backup') {
      const slot = req.query.slot;
      try {
        const { blobs } = await list({ prefix: BACKUP_PFX + slot + '.json', limit: 1 });
        if (!blobs.length) return res.status(404).json({ error: 'Backup não encontrado' });
        const data = await readBlob(blobs[0].url, token);
        if (!data) return res.status(500).json({ error: 'Backup vazio ou ilegível' });
        // Atualiza timestamp para que o sync reconheça como mais recente
        data._savedAt = Date.now();
        await put(BLOB_PATH, JSON.stringify(data), {
          access: 'private', contentType: 'application/json',
          addRandomSuffix: false, allowOverwrite: true,
        });
        return res.status(200).json({ ok: true, equipCount: data.equipment?.length ?? 0 });
      } catch (err) {
        return res.status(500).json({ error: 'Falha ao restaurar: ' + err.message });
      }
    }

    // Criar backup manual do estado atual
    if (action === 'create_backup') {
      try {
        const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
        if (!blobs.length) return res.status(200).json({ ok: true, msg: 'Nada para fazer backup' });
        const current = await readBlob(blobs[0].url, token);
        if (!current || !(current.equipment?.length)) {
          return res.status(200).json({ ok: true, msg: 'Dados atuais vazios — backup não criado' });
        }
        // Slot baseado em hora atual (0-4), garante variedade temporal
        const slot = Math.floor(Date.now() / (1000 * 3600)) % MAX_BACKUPS;
        await put(BACKUP_PFX + slot + '.json', JSON.stringify(current), {
          access: 'private', contentType: 'application/json',
          addRandomSuffix: false, allowOverwrite: true,
        });
        return res.status(200).json({ ok: true, slot, equipCount: current.equipment.length });
      } catch (err) {
        return res.status(500).json({ error: 'Falha ao criar backup: ' + err.message });
      }
    }

    // Gravação padrão — SEMPRE faz backup do dado atual antes de sobrescrever
    try {
      const body    = await readBody(req);
      const payload = JSON.parse(body);

      // Faz backup da versão atual antes de sobrescrever (somente se tiver dados)
      const { blobs: existing } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (existing.length) {
        const current = await readBlob(existing[0].url, token);
        if (current && (current.equipment?.length ?? 0) > 0) {
          const slot = Math.floor(Date.now() / (1000 * 3600)) % MAX_BACKUPS;
          // Não sobrescreve o slot se o backup já foi feito nesta hora (evita destruir backups mais antigos)
          const { blobs: bSlot } = await list({ prefix: BACKUP_PFX + slot + '.json', limit: 1 });
          const slotData = bSlot.length ? await readBlob(bSlot[0].url, token) : null;
          const slotHour = slotData?._savedAt ? Math.floor(slotData._savedAt / (1000 * 3600)) : -1;
          const thisHour = Math.floor(Date.now() / (1000 * 3600));
          if (slotHour !== thisHour) {
            await put(BACKUP_PFX + slot + '.json', JSON.stringify(current), {
              access: 'private', contentType: 'application/json',
              addRandomSuffix: false, allowOverwrite: true,
            }).catch(() => {}); // backup nunca bloqueia a gravação principal
          }
        }
      }

      // Grava dados principais
      await put(BLOB_PATH, JSON.stringify(payload), {
        access: 'private', contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao salvar: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
