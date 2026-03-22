import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');
  const cif = searchParams.get('cif');
  const month = searchParams.get('month'); // YYYY-MM
  const type = searchParams.get('type') || 'expense'; // expense or invoice

  if (!email || !token || !cif) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    
    let url;
    if (type === 'expense') {
      // Get purchase invoices (facturi de achizitie) to find product costs
      const [year, m] = (month || new Date().toISOString().slice(0, 7)).split('-');
      const daysInMonth = new Date(year, m, 0).getDate();
      url = `https://ws.smartbill.ro/SBORO/api/expense/list?cif=${cif}&seriesname=&from=${year}-${m}-01&to=${year}-${m}-${daysInMonth}&page=1&pageSize=500`;
    } else {
      // Get sales invoices
      const [year, m] = (month || new Date().toISOString().slice(0, 7)).split('-');
      const daysInMonth = new Date(year, m, 0).getDate();
      url = `https://ws.smartbill.ro/SBORO/api/invoice/list?cif=${cif}&seriesname=&from=${year}-${m}-01&to=${year}-${m}-${daysInMonth}&page=1&pageSize=500`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `SmartBill error ${response.status}: ${text}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
}

