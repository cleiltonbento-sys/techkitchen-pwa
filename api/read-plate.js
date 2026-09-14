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

  // Sanitiza a chave: substitui qualquer caractere não-ASCII (ex: travessão U+2013) por hífen
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/[^\x00-\x7F]/g, '-');
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

  const prompt = `Você está analisando a plaqueta de identificação de um equipamento de cozinha industrial (forno, fogão, fritadeira, refrigerador, máquina de gelo, etc).

Extraia com MÁXIMA PRECISÃO estes campos da imagem:

- brand: marca/fabricante do equipamento
- model: modelo exato (código alfanumérico ou nome do modelo)
- category: tipo de equipamento em poucas palavras (ex: "Forno Combinado", "Máquina de Gelo", "Fritadeira a Gás")
- voltage: tensão elétrica seguida da classificação de fase. Combine os dois na resposta:
  • 220V → "220V Monofásico" ou "220V Trifásico" conforme indicado
  • 380V → "380V Trifásico" (quase sempre trifásico)
  • 440V → "440V Trifásico" (quase sempre trifásico)
  • 127V → "127V Monofásico"
  • Indicadores de TRIFÁSICO na plaqueta: "3AC" (padrão europeu/Rational), "3F", "3~", "3Ph", "III", símbolo Δ (delta) ou Y (estrela), "Three Phase", "3 Phase"
  • Indicadores de MONOFÁSICO: "1AC", "1F", "1~", "1Ph", "Mono", "Single Phase"
  • ATENÇÃO: "3AC 440V" significa 440V Trifásico; "3AC 380V" significa 380V Trifásico
  • Se houver múltiplas tensões (ex: 220/380V), informe ambas com a fase de cada uma
  • Se for equipamento a gás ou não houver tensão elétrica, retorne ""
- power: potência elétrica total (ex: "3000W", "37,2kW", "5kW"). Aceite tanto "kW" quanto "W". Para equipamentos a gás, retorne "Gás". Se não identificar, retorne "".
- serial: número de série COMPLETO e EXATO como aparece na plaqueta. Procure por rótulos como "serial – no.", "serial no.", "S/N:", "No. Série:", "N° Série:", "Série:", "SN:". Copie TODOS os caracteres — letras, números, hífens e barras — sem abreviar nem omitir nenhuma parte. Se não encontrar, retorne "".

Se algum campo não estiver visível ou legível, retorne "" para ele.
Responda APENAS com JSON válido, sem markdown, sem explicação:
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
