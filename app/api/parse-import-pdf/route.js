import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { base64, type } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY lipsește din Vercel Environment Variables' }, { status: 500 });
    }

    const system = type === 'dvi'
      ? `Ești expert în declarații vamale românești (DVI/MRN). Documentul are un SEGMENT GENERAL (pagina 1) și câte un SEGMENT MĂRFURI ("Nr. art. 1", "Nr. art. 2", ... "Nr. art. N") pentru fiecare tip de produs din import.

IMPORTANT: un DVI poate conține 1, 2, 3 sau mai multe segmente de mărfuri (câte unul pentru fiecare tip de produs diferit). Caută în tot documentul toate secțiunile "SEGMENT MARFURI" / "Nr. art." și extrage-le pe TOATE, nu doar prima.

Pentru fiecare câmp, folosește exact aceste surse din document:
- cursSchimb: câmpul "Cursul de schimb - [14 09]" din SEGMENT GENERAL (ex: 4.5101)
- Pentru fiecare segment "Nr. art. N":
  - descriere: textul din "Descrierea mărfurilor" (ex: "80 BUC CEAS INTELIGENT" sau "1 Set aparat electric pentru tuns părul și barbă, cu accesorii")
  - cantitate: numărul de la începutul câmpului "Descrierea mărfurilor" dacă există (ex: 80); dacă nu există un număr clar acolo, folosește "Cantitatea în unități suplimentare - [18 02]"
  - taxaVamalaPercent și taxaVamalaRON: din linia "Tip taxă: A00" — Cota de impozitare = procent, Cuantumul taxelor de plătit = valoarea în RON
  - tvaPercent și tvaRON: din linia "Tip taxă: B00" — Cota de impozitare = procent (de obicei 21), Cuantumul taxelor de plătit = valoarea în RON
  - valoareVamaRON: din "Valoarea statistică - [99 06]"
- totalTaxaVamalaRON: suma tuturor valorilor A00 (taxaVamalaRON) de pe toate segmentele
- totalTvaRON: suma tuturor valorilor B00 (tvaRON) de pe toate segmentele
- totalCantitate: suma tuturor cantităților de pe toate segmentele (poate diferi de "Total colete")

Fii foarte precis cu cifrele — copiază exact valorile numerice din document, nu le rotunji și nu le aproxima.

Răspunde DOAR cu JSON valid, fără alt text, în acest format (numărul de elemente din "segmente" trebuie să corespundă exact numărului de segmente găsite în document):
{
  "cursSchimb": 4.5101,
  "segmente": [
    {
      "nr": 1,
      "descriere": "80 BUC CEAS INTELIGENT",
      "cantitate": 80,
      "taxaVamalaRON": 381,
      "taxaVamalaPercent": 3.7,
      "tvaRON": 2240,
      "tvaPercent": 21,
      "valoareVamaRON": 10286.19
    },
    {
      "nr": 2,
      "descriere": "1 Set aparat electric pentru tuns părul și barbă, cu accesorii",
      "cantitate": 1,
      "taxaVamalaRON": 3,
      "taxaVamalaPercent": 2.2,
      "tvaRON": 31,
      "tvaPercent": 21,
      "valoareVamaRON": 145.95
    }
  ],
  "totalTaxaVamalaRON": 384,
  "totalTvaRON": 2271,
  "totalCantitate": 81
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
        model: 'claude-sonnet-5',
        max_tokens: 3000,
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
