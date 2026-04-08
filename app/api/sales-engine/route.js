import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { system, messages, max_tokens } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY lipsește din Vercel Environment Variables' }, { status: 500 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 4000,
        system,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.error?.message || 'Eroare Anthropic API' }, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Eroare server' }, { status: 500 });
  }
}
