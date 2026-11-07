/**
 * lib/agent/report.ts
 * Daily report: yesterday vs the day before, per shop, + low stock + an AI summary.
 * Stored in Redis (agent:report:latest and agent:report:<date>, kept 60 days).
 */
import { createClient } from 'redis';
import { SHOP_CONFIGS } from '@/lib/shops';
import { getShopStats, lowStock, localDate, addDays, type ShopStats } from './shopify-data';
import { callClaude } from './agent';

export interface DailyReport {
  date: string;              // the day the report describes (yesterday, RO time)
  generatedAt: string;
  shops: { yesterday: ShopStats; dayBefore: ShopStats; lowStock: { product: string; variant: string; qty: number }[] }[];
  summary: string;
}

let client: ReturnType<typeof createClient> | null = null;
async function redis() {
  if (!process.env.REDIS_URL) return null;
  if (client) return client;
  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (e) => { console.error('[agent redis]', e.message); client = null; });
    await client.connect();
    return client;
  } catch (e: any) {
    console.error('[agent redis] connect', e.message);
    client = null;
    return null;
  }
}

export async function loadReport(date?: string): Promise<DailyReport | null> {
  const r = await redis();
  if (!r) return null;
  const raw = await r.get(date ? `agent:report:${date}` : 'agent:report:latest');
  return raw ? JSON.parse(raw) : null;
}

export async function listReportDates(): Promise<string[]> {
  const r = await redis();
  if (!r) return [];
  const raw = await r.get('agent:report:index');
  return raw ? JSON.parse(raw) : [];
}

export async function generateReport(): Promise<DailyReport> {
  const today = localDate(Date.now(), 'Europe/Bucharest');
  const date = addDays(today, -1);

  const shops = await Promise.all(SHOP_CONFIGS.map(async s => {
    const [yesterday, dayBefore, low] = await Promise.all([
      getShopStats(s.key, 'yesterday'),
      getShopStats(s.key, 'custom', addDays(date, -1), addDays(date, -1)),
      lowStock(s.key, 5).catch(() => []),
    ]);
    return { yesterday, dayBefore, lowStock: low.map(l => ({ product: l.product, variant: l.variant, qty: l.qty })) };
  }));

  let summary = '';
  try {
    const res = await callClaude({
      max_tokens: 1200,
      system: 'Ești analistul de e-commerce al utilizatorului. Scrii raportul zilnic în română, scurt, pentru telefon. Folosește doar cifrele primite. Nu aduna RON cu HUF.',
      messages: [{
        role: 'user',
        content: `Date pentru ${date} (ieri) comparativ cu ziua dinainte, pe fiecare magazin, plus stocuri mici:\n${JSON.stringify(shops)}\n\nScrie:\n1. Un rând de rezumat general (comenzi total, vânzări pe monedă).\n2. Pe fiecare magazin un rând: comenzi, vânzări, schimbare față de ziua dinainte, funnel ATC/IC dacă există, produsul top.\n3. Maxim 3 lucruri de făcut azi (concrete: ce produs, ce problemă din funnel, ce stoc).\nFormat: rânduri scurte cu „-”, **bold** pe cifre cheie, fără titluri mari.`,
      }],
    });
    summary = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  } catch (e: any) {
    summary = `Rezumatul AI nu a putut fi generat: ${e.message}`;
  }

  const report: DailyReport = { date, generatedAt: new Date().toISOString(), shops, summary };

  const r = await redis();
  if (r) {
    const json = JSON.stringify(report);
    await r.set('agent:report:latest', json);
    await r.set(`agent:report:${date}`, json, { EX: 60 * 24 * 3600 });
    const idx = new Set<string>(await listReportDates());
    idx.add(date);
    await r.set('agent:report:index', JSON.stringify(Array.from(idx).sort().reverse().slice(0, 60)));
  }
  return report;
}
