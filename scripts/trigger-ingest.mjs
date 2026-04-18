/**
 * 手動で ingest を叩く（ローカル cron / CI / ワンショット用）
 *
 * 例:
 *   INGEST_URL=http://localhost:3000/api/ingest INGEST_TOKEN=xxx node scripts/trigger-ingest.mjs
 *   INGEST_LIMIT=20 node scripts/trigger-ingest.mjs
 */

const base =
  process.env.INGEST_URL?.replace(/\/$/, '') ?? 'http://localhost:3000/api/ingest';
const token = process.env.INGEST_TOKEN ?? '';
const limit = process.env.INGEST_LIMIT ?? '15';

const url = new URL(base.includes('/api/ingest') ? base : `${base}/api/ingest`);
url.searchParams.set('limit', limit);
if (token) url.searchParams.set('token', token);

const res = await fetch(url, {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log(res.status, body);
process.exit(res.ok ? 0 : 1);
