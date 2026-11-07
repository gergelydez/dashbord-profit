/**
 * lib/agent/agent.ts
 * Claude tool-use loop for the multi-shop agent.
 * Reads run immediately; writes are only collected as proposals (see actions.ts).
 */
import {
  listShops, resolveShopKeys, getShopStats, shopifyql, searchProducts, recentOrders, lowStock, getLocations, localDate,
  type Period,
} from './shopify-data';
import { validateAction, type AgentAction } from './actions';

export const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5';

export async function callClaude(body: Record<string, unknown>) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY lipsește din Vercel Environment Variables');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
    body: JSON.stringify({ model: AGENT_MODEL, max_tokens: 2500, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Eroare Anthropic ${res.status}`);
  return data;
}

const shopsParam = {
  type: 'array', items: { type: 'string' },
  description: 'Chei de magazin (ex. "ro", "glato") sau ["all"] pentru toate.',
};
const shopParam = { type: 'string', description: 'O singură cheie de magazin, ex. "glato".' };

export const TOOLS = [
  { name: 'list_shops', description: 'Lista magazinelor conectate (cheie, nume, domeniu).', input_schema: { type: 'object', properties: {} } },
  {
    name: 'get_stats',
    description: 'Statistici pe magazin: comenzi, vânzări, AOV, comenzi ramburs, top produse vândute și funnel sesiuni → ATC (adăugări în coș) → IC (checkout inițiat) → comenzi finalizate, rată conversie.',
    input_schema: {
      type: 'object', required: ['shops', 'period'],
      properties: {
        shops: shopsParam,
        period: { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'month', 'custom'] },
        from: { type: 'string', description: 'YYYY-MM-DD, doar pentru custom' },
        to:   { type: 'string', description: 'YYYY-MM-DD, doar pentru custom' },
      },
    },
  },
  {
    name: 'run_shopifyql',
    description: 'Interogare ShopifyQL liberă pentru analize avansate (ex. vânzări pe surse de trafic, pe țări, pe dispozitive, timeseries). Sintaxă: FROM sales|sessions|inventory SHOW ... [GROUP BY ...] [TIMESERIES day] SINCE -7d UNTIL today.',
    input_schema: { type: 'object', required: ['shop', 'query'], properties: { shop: shopParam, query: { type: 'string' } } },
  },
  {
    name: 'recent_orders',
    description: 'Ultimele comenzi ale unui magazin (cu filtru opțional în sintaxa de căutare Shopify, ex. "financial_status:pending" sau "name:#1042").',
    input_schema: { type: 'object', required: ['shop'], properties: { shop: shopParam, limit: { type: 'integer' }, query: { type: 'string' } } },
  },
  {
    name: 'search_products',
    description: 'Caută produse într-un magazin după titlu/SKU. Întoarce ID-urile produsului, variantelor și inventoryItem necesare pentru modificări.',
    input_schema: { type: 'object', required: ['shop', 'query'], properties: { shop: shopParam, query: { type: 'string', description: 'ex. "title:*delta max*" sau "sku:DM-01"' } } },
  },
  {
    name: 'low_stock',
    description: 'Variante active cu stoc sub prag.',
    input_schema: { type: 'object', required: ['shop'], properties: { shop: shopParam, threshold: { type: 'integer' } } },
  },
  {
    name: 'get_locations',
    description: 'Locațiile de stoc ale unui magazin.',
    input_schema: { type: 'object', required: ['shop'], properties: { shop: shopParam } },
  },
  {
    name: 'propose_action',
    description: 'Propune o MODIFICARE pe un magazin. NU se execută acum: utilizatorul vede un card și apasă Confirmă. Apelează o dată pentru fiecare magazin/produs. Folosește doar ID-uri primite de la search_products.',
    input_schema: {
      type: 'object', required: ['action'],
      properties: {
        action: {
          type: 'object',
          description: `Unul din:
- {type:"update_variant_prices", shop, summary, productId, variants:[{variantId, price?, compareAtPrice?}]}
- {type:"update_product", shop, summary, productId, fields:{title?, status?: "ACTIVE"|"DRAFT"|"ARCHIVED", descriptionHtml?, tags?}}
- {type:"set_inventory", shop, summary, items:[{inventoryItemId, quantity}], locationId?}
- {type:"create_discount", shop, summary, code, percentage (ex. 15), title?, startsAt?, endsAt?}
summary = descriere scurtă în română a schimbării, cu valorile vechi → noi.`,
        },
      },
    },
  },
];

async function runTool(name: string, input: any, proposals: AgentAction[]): Promise<unknown> {
  switch (name) {
    case 'list_shops': return listShops();
    case 'get_stats': {
      const keys = resolveShopKeys(input.shops);
      return Promise.all(keys.map(k => getShopStats(k, (input.period || 'today') as Period, input.from, input.to)));
    }
    case 'run_shopifyql': {
      const t = await shopifyql(resolveShopKeys(input.shop)[0], input.query);
      return { columns: t.columns.map(c => c.name), rows: t.rows.slice(0, 60) };
    }
    case 'recent_orders':  return recentOrders(resolveShopKeys(input.shop)[0], input.limit || 10, input.query);
    case 'search_products': return searchProducts(resolveShopKeys(input.shop)[0], input.query);
    case 'low_stock':      return lowStock(resolveShopKeys(input.shop)[0], input.threshold ?? 5);
    case 'get_locations':  return getLocations(resolveShopKeys(input.shop)[0]);
    case 'propose_action': {
      const err = validateAction(input.action);
      if (err) return { ok: false, error: err };
      proposals.push(input.action as AgentAction);
      return { ok: true, status: 'Propunere afișată utilizatorului. Așteaptă confirmarea lui — NU e încă aplicată.' };
    }
  }
  throw new Error(`Unealtă necunoscută: ${name}`);
}

function systemPrompt(focusShops?: string[]) {
  const shops = listShops().map(s => `- ${s.key}: ${s.label} (${s.domain})`).join('\n');
  return `Ești agentul AI al magazinelor Shopify ale utilizatorului (GLAMX / GLATO). Răspunzi în română, scurt și concret, potrivit pentru telefon.

Magazine conectate:
${shops}
Azi este ${localDate(Date.now(), 'Europe/Bucharest')} (ora României). Magazinele HU au prețuri în HUF, cele RO în RON — nu le aduna, raportează separat pe monedă.
${focusShops?.length ? `Utilizatorul a selectat în interfață: ${focusShops.join(', ')}. Când nu spune alt magazin, lucrează pe acestea.` : 'Când nu spune magazinul, lucrează pe toate.'}

Reguli:
- Orice cifră vine din unelte, niciodată din memorie. Pentru „azi/ieri/săptămâna asta” folosește get_stats.
- ATC = sesiuni cu adăugare în coș, IC = sesiuni care au ajuns la checkout. Dacă un magazin nu are permisiunea read_reports, spune asta pe scurt.
- Pentru modificări: caută întâi produsul cu search_products pe FIECARE magazin cerut, apoi apelează propose_action câte o dată pe magazin/produs. Nu spune niciodată că ai aplicat ceva: spune că ai pregătit modificarea și că trebuie confirmată pe cardul de mai jos.
- Dacă produsul nu e găsit sau sunt mai multe potriviri, întreabă înainte de a propune.
- La statistici adaugă 1-2 observații utile (ce merge, ce nu, ce să verifice), fără umplutură.
- Folosește formatare simplă: rânduri scurte, liste cu „-”, **bold** pentru cifrele cheie.`;
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export async function runAgent(history: ChatTurn[], focusShops?: string[]) {
  // Collapse into strictly alternating text turns, starting with user.
  const msgs: { role: 'user' | 'assistant'; content: any }[] = [];
  for (const t of history.slice(-20)) {
    if (!t?.content) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else msgs.push({ role: t.role, content: String(t.content) });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) throw new Error('Mesaj gol');

  const proposals: AgentAction[] = [];
  const toolLog: { name: string; ok: boolean }[] = [];
  const system = systemPrompt(focusShops);

  for (let step = 0; step < 10; step++) {
    const res = await callClaude({ system, messages: msgs, tools: TOOLS });
    msgs.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const reply = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      return { reply, actions: proposals, toolLog };
    }

    const results = await Promise.all(res.content.filter((b: any) => b.type === 'tool_use').map(async (b: any) => {
      try {
        const out = await runTool(b.name, b.input || {}, proposals);
        toolLog.push({ name: b.name, ok: true });
        return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 30000) };
      } catch (e: any) {
        toolLog.push({ name: b.name, ok: false });
        return { type: 'tool_result', tool_use_id: b.id, content: `Eroare: ${e.message}`, is_error: true };
      }
    }));
    msgs.push({ role: 'user', content: results });
  }
  return { reply: 'Am făcut prea mulți pași fără un răspuns final. Încearcă o întrebare mai precisă.', actions: proposals, toolLog };
}
