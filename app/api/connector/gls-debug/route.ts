/**
 * GET /api/connector/gls-debug?tracking=6240529419
 * Endpoint temporar de debugging — șterge după ce rezolvi problema
 */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const GLS_BASE = 'https://api.mygls.ro/ParcelService.svc/json';

async function buildAuth() {
  const username     = process.env.GLS_USERNAME || '';
  const password     = process.env.GLS_PASSWORD || '';
  const clientNumber = parseInt(process.env.GLS_CLIENT_NUMBER || '0', 10);
  const encoded  = new TextEncoder().encode(password);
  const hashBuf  = await globalThis.crypto.subtle.digest('SHA-512', encoded);
  const pwdBytes = Array.from(new Uint8Array(hashBuf));
  return { Username: username, Password: pwdBytes, ClientNumberList: [clientNumber] };
}

async function glsPost(endpoint: string, body: Record<string, unknown>) {
  const auth = await buildAuth();
  const res  = await fetch(`${GLS_BASE}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ ...auth, ...body }),
    cache:   'no-store',
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tracking = (searchParams.get('tracking') || '6240529419').replace(/\s/g, '');
  const results: Record<string, unknown> = { tracking };

  // Test 1: GetParcelStatuses — direct cu ParcelNumber
  const t1 = await glsPost('GetParcelStatuses', {
    ParcelNumber:    parseInt(tracking, 10),
    ReturnPOD:       false,
    LanguageIsoCode: 'RO',
  });
  results.test1_GetParcelStatuses = t1;

  // Test 2: GetParcelList PrintDate 30 zile
  const today = new Date();
  const from  = new Date(); from.setDate(today.getDate() - 30);
  const t2 = await glsPost('GetParcelList', {
    PrintDateFrom: from.toISOString(),
    PrintDateTo:   today.toISOString(),
  });
  const list2 = (t2.body as Record<string,unknown>).PrintDataInfoList as Array<Record<string,unknown>> || [];
  results.test2_GetParcelList_PrintDate = {
    httpStatus:  t2.status,
    totalCount:  list2.length,
    first3:      list2.slice(0, 3).map(p => ({ ParcelId: p.ParcelId, ParcelNumber: p.ParcelNumber, ParcelNumberWithCheckdigit: p.ParcelNumberWithCheckdigit })),
    targetFound: list2.find(p => String(p.ParcelNumber) === tracking || String(p.ParcelNumberWithCheckdigit) === tracking) || null,
  };

  // Test 3: GetParcelList PickupDate 30 zile
  const t3 = await glsPost('GetParcelList', {
    PickupDateFrom: from.toISOString(),
    PickupDateTo:   today.toISOString(),
  });
  const list3 = (t3.body as Record<string,unknown>).PrintDataInfoList as Array<Record<string,unknown>> || [];
  results.test3_GetParcelList_PickupDate = {
    httpStatus:  t3.status,
    totalCount:  list3.length,
    targetFound: list3.find(p => String(p.ParcelNumber) === tracking || String(p.ParcelNumberWithCheckdigit) === tracking) || null,
  };

  // Test 4: GetPrintedLabels cu ParcelId din test2 dacă l-am găsit
  const found = (results.test2_GetParcelList_PrintDate as Record<string,unknown>).targetFound as Record<string,unknown> | null
             || (results.test3_GetParcelList_PickupDate as Record<string,unknown>).targetFound as Record<string,unknown> | null;

  if (found?.ParcelId) {
    const t4 = await glsPost('GetPrintedLabels', {
      ParcelIdList:    [found.ParcelId],
      PrintPosition:   1,
      ShowPrintDialog: false,
      TypeOfPrinter:   'A4_4x1',
    });
    const body4 = t4.body as Record<string,unknown>;
    results.test4_GetPrintedLabels = {
      httpStatus:   t4.status,
      errors:       body4.GetPrintedLabelsErrorList,
      hasLabels:    !!(body4.Labels),
      labelsLength: typeof body4.Labels === 'string' ? body4.Labels.length : 0,
    };
  } else {
    results.test4_GetPrintedLabels = 'SKIP — ParcelId nu a fost găsit în GetParcelList';
  }

  return NextResponse.json(results, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
