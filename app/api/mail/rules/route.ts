/**
 * CRUD for SortRule — editable from the /documente rules panel.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rules = await db.sortRule.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    category?: string; subcategory?: string; matchType?: string; matchValue?: string; filenameContains?: string;
  };
  const { category, subcategory, matchType, matchValue, filenameContains } = body;
  if (!category || !matchType || !matchValue) {
    return NextResponse.json({ error: 'category, matchType, matchValue sunt obligatorii' }, { status: 400 });
  }
  if (matchType !== 'sender_email' && matchType !== 'sender_domain') {
    return NextResponse.json({ error: 'matchType invalid' }, { status: 400 });
  }
  const rule = await db.sortRule.create({
    data: {
      category, subcategory: subcategory || null, matchType, matchValue: matchValue.toLowerCase().trim(),
      filenameContains: filenameContains?.trim() || null,
    },
  });
  return NextResponse.json({ ok: true, rule });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id lipsă' }, { status: 400 });
  await db.sortRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
