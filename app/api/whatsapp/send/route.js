import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { to, message, twilioSid, twilioToken, twilioFrom, orderId, orderName } = await request.json();

    if (!to || !message || !twilioSid || !twilioToken || !twilioFrom) {
      return NextResponse.json({ error: 'Lipsesc parametri' }, { status: 400 });
    }

    // Formatăm numărul destinatar pentru WhatsApp
    const toWA = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    // Twilio REST API
    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const body = new URLSearchParams({
      From: twilioFrom,
      To: toWA,
      Body: message,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await res.json();

    if (!res.ok || data.status === 'failed' || data.error_code) {
      return NextResponse.json({
        error: data.message || data.error_message || 'Eroare Twilio',
        code: data.error_code,
      }, { status: 400 });
    }

    console.log('[WHATSAPP SENT]', 'order:', orderName, '| to:', to, '| sid:', data.sid);

    return NextResponse.json({
      success: true,
      sid: data.sid,
      status: data.status,
      to: data.to,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

