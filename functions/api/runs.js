// Cloudflare Pages Function: 他プレイヤーのランを記録/配信する最小API。
// KV 名前空間 "RUNS" を Pages の設定でバインドして使う（未バインドなら空配列を返す）。
//   GET  /api/runs?seed=<n>  → そのシードの最新ラン配列（最大100）
//   POST /api/runs           → 1ランを追記（同シードで最大100件に丸める）

const MAX = 100;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// 受け取ったランを安全な形に整える（サイズ・型を制限）
function sanitize(run) {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const cl = (v) => Math.max(-2000, Math.min(2000, Math.round(num(v)))); // フィールド外は丸める
  const path = Array.isArray(run.path)
    ? run.path.slice(0, 64).map((p) => [cl(p[0]), cl(p[1]), +num(p[2]).toFixed(3)])
    : [];
  return {
    path,
    best: num(run.best) | 0,
    flagged: !!run.flagged,
    t: Date.now(),
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.RUNS) return json([]);
  const seed = new URL(request.url).searchParams.get('seed') || '0';
  const data = await env.RUNS.get('runs:' + seed);
  return json(data ? JSON.parse(data) : []);
}

export async function onRequestPost({ request, env }) {
  if (!env.RUNS) return json({ ok: false, reason: 'no-kv' });
  let run;
  try { run = await request.json(); } catch { return json({ ok: false }, 400); }
  const seed = String(run.seed != null ? run.seed : '0').slice(0, 24);
  const key = 'runs:' + seed;
  const prev = await env.RUNS.get(key);
  let arr = prev ? JSON.parse(prev) : [];
  arr.push(sanitize(run));
  if (arr.length > MAX) arr = arr.slice(arr.length - MAX);
  await env.RUNS.put(key, JSON.stringify(arr));
  return json({ ok: true, count: arr.length });
}
