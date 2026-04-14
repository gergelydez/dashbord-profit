// app/api/smartbill/stock/route.js
import { NextResponse } from 'next/server';

export async function GET() {
  const token = process.env.SMARTBILL_TOKEN;
  const vat = process.env.SMARTBILL_VAT;
  const apiUrl = process.env.SMARTBILL_API_URL || 'https://api.smartbill.ro/v2';

  if (!token || !vat) {
    return NextResponse.json(
      { error: 'Lipsesc variabilele de mediu SMARTBILL_TOKEN sau SMARTBILL_VAT' },
      { status: 500 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const url = `${apiUrl}/report/inventory?date=${today}&warehouseId=all`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Company-Vat': vat,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SmartBill error ${response.status}:`, errorText);
      return NextResponse.json(
        { error: `SmartBill a răspuns cu ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : data.items || [];

    // Hartă: nume produs → cost unitar (cel mai mare, abordare conservatoare)
    const productCostMap = {};
    for (const item of items) {
      const productName = item.productName?.trim();
      const unitCost = parseFloat(item.cost);
      if (!productName || isNaN(unitCost) || unitCost <= 0) continue;

      if (!productCostMap[productName] || unitCost > productCostMap[productName]) {
        productCostMap[productName] = unitCost;
      }
    }

    return NextResponse.json({
      costs: productCostMap,
      date: today,
      count: Object.keys(productCostMap).length,
    });
  } catch (error) {
    console.error('Eroare la apelul SmartBill:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
