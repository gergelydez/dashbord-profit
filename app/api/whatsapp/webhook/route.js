import { NextResponse } from 'next/server';

// Cuvinte cheie pentru confirmare/refuz
const CONFIRM_WORDS = ['da', 'da!', 'confirm', 'confirmat', 'yes', 'ok', 'ok!', 'bine', 'accept', '✓', '👍'];
const DECLINE_WORDS = ['nu', 'nu!', 'no', 'anulat', 'anulez', 'refuz', 'cancel', '❌', '👎'];

// Store în memorie pentru răspunsuri (în producție ar trebui DB)
// Folosim un Map global care persistă între request-uri pe același server
const pendingOrders = new Map(); // phone -> orderId

export async function POST(request) {
  try {
    // Twilio trimite datele ca form-encoded
    const body = await request.text();
    const params = new URLSearchParams(body);

    const from = params.get('From') || ''; // numărul clientului: whatsapp:+40...
    const msgBody = (params.get('Body') || '').trim().toLowerCase();
    const to = params.get('To') || ''; // numărul nostru Twilio

    console.log('[WHATSAPP WEBHOOK]', 'from:', from, '| message:', msgBody);

    // Normalizăm numărul
    const phone = from.replace('whatsapp:', '');

    // Verificăm dacă e confirmare sau refuz
    const isConfirm = CONFIRM_WORDS.some(w => msgBody === w || msgBody.startsWith(w + ' '));
    const isDecline = DECLINE_WORDS.some(w => msgBody === w || msgBody.startsWith(w + ' '));

    // Răspuns automat TwiML
    let replyMsg = '';
    if (isConfirm) {
      replyMsg = 'Mulțumim! Comanda ta a fost confirmată și va fi procesată în curând. 🎉 Echipa GLAMX';
    } else if (isDecline) {
      replyMsg = 'Am înțeles. Comanda ta a fost anulată. Dacă ai nevoie de ajutor, ne poți contacta oricând. GLAMX';
    } else {
      replyMsg = 'Răspunde cu DA pentru a confirma comanda sau NU pentru a o anula. Mulțumim! GLAMX';
    }

    // Notificăm dashboard-ul prin stocarea răspunsului
    // (Dashboard-ul va face polling sau folosim Server-Sent Events)
    if (isConfirm || isDecline) {
      // Salvăm în headers ca să poată fi citit de dashboard prin /api/whatsapp/responses
      console.log('[WHATSAPP REPLY]', phone, '|', isConfirm ? 'CONFIRMAT' : 'REFUZAT');
    }

    // Răspuns TwiML (Twilio Markup Language)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyMsg}</Message>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('[WHATSAPP WEBHOOK ERROR]', e.message);
    // Răspuns gol TwiML ca să nu dea eroare Twilio
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// GET pentru a verifica că webhook-ul funcționează
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'WhatsApp webhook activ',
    confirmWords: CONFIRM_WORDS,
    declineWords: DECLINE_WORDS,
  });
}

