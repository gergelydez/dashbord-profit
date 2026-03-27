import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { base64, type, system } = await request.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 }
            },
            {
              type: 'text',
              text: type === 'dvi'
                ? 'Extrage datele din această Declarație Vamală de Import și returnează JSON.'
                : 'Extrage datele din această factură DHL și returnează JSON.'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = (data.content || []).map(c => c.text || '').join('');

    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
