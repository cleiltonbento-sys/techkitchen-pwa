// Lê plaqueta de equipamento via Claude Vision.
// ANTHROPIC_API_KEY configurada como variável de ambiente no painel do Vercel.

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chave da API não configurada (ANTHROPIC_API_KEY ausente)' });
  }

  let payload;
  try {
    const body = await readBody(req);
    payload = JSON.parse(body);
  } catch (e) {
    return res.status(400).json({ error: 'Corpo da requisição inválido' });
  }

  const { imageBase64, mediaType } = payload;
  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'Imagem ausente' });
  }

  const prompt = `Você está lendo a plaqueta de identificação de um equipamento de cozinha industrial (forno, fogão, fritadeira, refrigerador, máquina de gelo, etc). Extraia estes campos da imagem:
- brand: marca/fabricante
- model: modelo (código ou nome)
- category: tipo de equipamento em poucas palavras (ex: "Forno Combinado", "Máquina de Gelo", "Fritadeira a Gás")
- voltage: tensão elétrica exata conforme indicada na plaqueta (ex: "220V", "380V", "127V", "Bivolt", "110/220V"). Se não identificar ou for equipamento a gás, retorne "".
- power: potência elétrica do equipamento (ex: "3000W", "1,75kW", "5kW"). Para equipamentos a gás, retorne "Gás". Se não identificar, retorne "".
- serial: número de série completo como aparece na plaqueta

Se algum campo não estiver legível, retorne "" para ele. Responda APENAS com JSON válido, sem markdown, sem explicação:
{"brand":"","model":"","category":"","voltage":"","power":"","serial":""}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Erro da API (' + response.status + '): ' + errText.slice(0, 300) });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(500).json({ error: 'Resposta sem texto' });

    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch (e) {
      return res.status(500).json({ error: 'Não entendi a resposta da IA' });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao chamar a API: ' + err.message });
  }
};
