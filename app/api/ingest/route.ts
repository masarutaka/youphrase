import { NextRequest, NextResponse } from 'next/server';
import { runIngest } from '@/lib/ingest/run-ingest';

const INGEST_TOKEN = process.env.INGEST_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(req: NextRequest): boolean {
  if (!INGEST_TOKEN) {
    return true;
  }
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token === INGEST_TOKEN || bearer === INGEST_TOKEN) {
    return true;
  }
  if (CRON_SECRET && bearer === CRON_SECRET) {
    return true;
  }
  if (req.headers.get('x-vercel-cron') === '1') {
    return true;
  }
  return false;
}

function parseLimit(req: NextRequest): number {
  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 10);
  return Number.isFinite(limitParam) ? Math.max(1, Math.min(50, limitParam)) : 10;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limit = parseLimit(req);
  const body = await runIngest(limit);
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limit = parseLimit(req);
  const body = await runIngest(limit);
  return NextResponse.json(body);
}
