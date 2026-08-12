// Função que roda no servidor do Netlify — nunca no navegador do usuário.
// A chave da API fica guardada em segredo aqui, configurada como variável
// de ambiente no painel do Netlify (nunca aparece no código nem no app).

exports.handler = async function (event) {
  // Só aceita requisições do tipo POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Chave da API não configurada no servidor (ANTHROPIC_API_KEY ausente)' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Corpo da requisição inválido' }) };
  }

  const { imageBase64, mediaType } = payload;
  if (!imageBase64 || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Imagem ausente' }) };
  }

  const prompt = `Você está lendo a plaqueta de identificação de um equipamento de cozinha industrial (forno, fogão, fritadeira, refrigerador, máquina de gelo, etc). Extraia estes campos da imagem:
- brand: marca/fabricante
- model: modelo (código ou nome)
- category: tipo de equipamento em poucas palavras (ex: "Forno Combinado", "Máquina de Gelo", "Fritadeira a Gás")
- power: tensão e/ou potência resumida (ex: "220V 1,75kW")
- serial: número de série

Se algum campo não estiver legível, retorne "" para ele. Responda APENAS com JSON válido, sem markdown, sem explicação:
{"brand":"","model":"","category":"","power":"","serial":""}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return { statusCode: response.status, body: JSON.stringify({ error: 'Erro da API Anthropic (' + response.status + '): ' + errText.slice(0, 300) }) };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Resposta sem texto' }) };
    }

    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Não entendi a resposta da IA' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao chamar a API: ' + err.message }) };
  }
};
