import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { base64, type } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY lipsește din Vercel Environment Variables' }, { status: 500 });
    }

    const system = type === 'dvi'
      ? `Ești expert în declarații vamale românești (DVI). Analizează documentul DVI și extrage datele pentru FIECARE segment de mărfuri separat.

Structura unui DVI are:
- SEGMENT GENERAL: cursul de schimb (Cursul de schimb - [14 09])
- SEGMENT MARFURI Nr. 1, Nr. 2 etc.: fiecare cu descriere, cantitate, taxe

Răspunde DOAR cu JSON valid, fără alt text:
{
  "cursSchimb": 4.3046,
  "segmente": [
    {
      "nr": 1,
      "descriere": "95 BUC CEASURI INTELIGENTE",
      "cantitate": 95,
      "taxaVamalaRON": 419,
      "taxaVamalaPercent": 3.7,
      "tvaRON": 2464,
      "tvaPercent": 21,
      "valoareVamaRON": 11315.49
    },
    {
      "nr": 2,
      "descriere": "1 BUC DISPOZITIV TRANSMITERE COMENZI IMPRIMANTA",
      "cantitate": 1,
      "taxaVamalaRON": 0,
      "taxaVamalaPercent": 0,
      "tvaRON": 24,
      "tvaPercent": 21,
      "valoareVamaRON": 116.23
    }
  ],
  "totalTaxaVamalaRON": 419,
  "totalTvaRON": 2488,
  "totalCantitate": 96
}`
      : `Ești expert în facturi DHL România. Răspunde DOAR cu JSON valid:
{"comisionProcessare":59,"comisionTVA":12.39,"totalDePlata":2978.39}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: type === 'dvi'
              ? 'Extrage toate segmentele de mărfuri din DVI cu taxele aferente. Returnează DOAR JSON.'
              : 'Extrage comisionul de procesare din factura DHL. Returnează DOAR JSON.' }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `API error ${response.status}: ${err.slice(0,200)}` }, { status: 500 });
    }

    const data = await response.json();
    const text = (data.content || []).map(c => c.text || '').join('').trim();

    try {
      const parsed = JSON.parse(text);
      return NextResponse.json({ parsed });
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return NextResponse.json({ parsed });
        } catch {}
      }
    }
    return NextResponse.json({ error: 'Nu am putut extrage JSON: ' + text.slice(0, 300) }, { status: 500 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
