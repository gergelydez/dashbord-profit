import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { base64, type } = await request.json();

    // API key din Vercel Environment Variables
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY lipsește din Environment Variables Vercel' }, { status: 500 });
    }

    const system = type === 'dvi'
      ? `Ești expert în declarații vamale românești. Răspunde DOAR cu JSON valid, fără alt text înainte sau după:
{"cursSchimb":4.3046,"taxaVamalaPercent":3.7,"taxaVamalaRON":419,"tvaPercent":21,"tvaRON":2488}`
      : `Ești expert în facturi DHL România. Răspunde DOAR cu JSON valid, fără alt text înainte sau după:
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
        max_tokens: 300,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: 'Returnează DOAR JSON cu valorile extrase.' }
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

    // Parse JSON din răspuns
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
    return NextResponse.json({ error: 'Nu am putut extrage JSON. Text: ' + text.slice(0,300) }, { status: 500 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
