export interface Row {
  file: string;
  category: string;
  codec: string;
  budget: number;
  bytes: number;
  dE: number;
  dE95: number;
  ssim: number;
  encMs: number;
  decMs: number;
}

export interface SheetItem {
  file: string;
  kind: 'random' | 'worst';
  original: string;
  previews: Record<string, string>;
  dE: Record<string, number>;
}

interface Summary {
  codec: string;
  budget: number;
  n: number;
  bytesMedian: number;
  bytesMean: number;
  dE: number;
  dE95px: number;
  dEp95img: number;
  ssim: number;
  encMs: number;
  decMs: number;
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1);

function quantile(v: number[], q: number): number {
  if (!v.length) return NaN;
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function summarize(rows: Row[]): Summary[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.codec}|${r.budget}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: Summary[] = [];
  for (const g of groups.values()) {
    out.push({
      codec: g[0].codec,
      budget: g[0].budget,
      n: g.length,
      bytesMedian: quantile(
        g.map((r) => r.bytes),
        0.5,
      ),
      bytesMean: mean(g.map((r) => r.bytes)),
      dE: mean(g.map((r) => r.dE)),
      dE95px: mean(g.map((r) => r.dE95)),
      dEp95img: quantile(
        g.map((r) => r.dE),
        0.95,
      ),
      ssim: mean(g.map((r) => r.ssim)),
      encMs: quantile(
        g.map((r) => r.encMs),
        0.5,
      ),
      decMs: quantile(
        g.map((r) => r.decMs),
        0.5,
      ),
    });
  }
  const order = ['hazehash', 'blurhash', 'thumbhash'];
  return out.sort((a, b) => order.indexOf(a.codec) - order.indexOf(b.codec) || a.budget - b.budget);
}

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '');

function chartSvg(sum: Summary[], budgets: number[]): string {
  const W = 640;
  const H = 360;
  const m = { l: 56, r: 20, t: 20, b: 44 };
  const xs = [Math.min(...budgets), Math.max(...budgets)];
  const all = sum.map((s) => s.dE);
  const yMax = Math.ceil(Math.max(...all) * 1.05);
  const X = (b: number) => m.l + ((b - xs[0]) / (xs[1] - xs[0] || 1)) * (W - m.l - m.r);
  const Y = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const colors: Record<string, string> = {
    hazehash: '#2563eb',
    blurhash: '#dc2626',
    thumbhash: '#16a34a',
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="bytes vs error">`;
  for (let t = 0; t <= yMax; t += Math.max(1, Math.round(yMax / 6))) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="currentColor" opacity=".12"/>`;
    svg += `<text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="currentColor">${t}</text>`;
  }
  for (const b of budgets) {
    svg += `<text x="${X(b)}" y="${H - m.b + 18}" text-anchor="middle" font-size="11" fill="currentColor">${b}</text>`;
  }
  svg += `<text x="${(W + m.l) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="currentColor">bytes</text>`;
  svg += `<text x="14" y="${H / 2}" font-size="12" fill="currentColor" transform="rotate(-90 14 ${H / 2})" text-anchor="middle">mean ΔE (OKLab x100)</text>`;
  for (const codec of ['hazehash', 'blurhash']) {
    const pts = sum.filter((s) => s.codec === codec);
    svg += `<polyline fill="none" stroke="${colors[codec]}" stroke-width="2" points="${pts
      .map((p) => `${X(p.budget)},${Y(p.dE)}`)
      .join(' ')}"/>`;
    for (const p of pts)
      svg += `<circle cx="${X(p.budget)}" cy="${Y(p.dE)}" r="3.5" fill="${colors[codec]}"/>`;
  }
  const th = sum.find((s) => s.codec === 'thumbhash');
  if (th) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(th.dE)}" y2="${Y(th.dE)}" stroke="${colors.thumbhash}" stroke-width="2" stroke-dasharray="6 4"/>`;
    svg += `<circle cx="${X(Math.min(xs[1], Math.max(xs[0], th.bytesMean)))}" cy="${Y(th.dE)}" r="4.5" fill="${colors.thumbhash}"/>`;
  }
  svg += '</svg>';
  const legend = Object.entries(colors)
    .map(([c, col]) => `<span><i style="background:${col}"></i>${c}</span>`)
    .join('');
  return `<div class="legend">${legend}</div>${svg}`;
}

export function buildReport(
  rows: Row[],
  sheet: SheetItem[],
  budgets: number[],
  meta: { profile: string; images: number },
): { csv: string; summaryCsv: string; html: string; summaryText: string } {
  const csv =
    'file,category,codec,budget,bytes,dE,dE95,ssim,encMs,decMs\n' +
    rows
      .map(
        (r) =>
          `${r.file},${r.category},${r.codec},${r.budget},${r.bytes},${f(r.dE, 4)},${f(r.dE95, 4)},${f(r.ssim, 5)},${f(r.encMs, 3)},${f(r.decMs, 3)}`,
      )
      .join('\n');
  const sum = summarize(rows);
  const summaryCsv =
    'codec,budget,n,bytesMedian,bytesMean,dE,dE95px,dEp95img,ssim,encMs,decMs\n' +
    sum
      .map(
        (s) =>
          `${s.codec},${s.budget},${s.n},${s.bytesMedian},${f(s.bytesMean)},${f(s.dE, 4)},${f(s.dE95px, 4)},${f(s.dEp95img, 4)},${f(s.ssim, 5)},${f(s.encMs, 3)},${f(s.decMs, 3)}`,
      )
      .join('\n');

  const th = sum.find((s) => s.codec === 'thumbhash');
  const compare = budgets
    .map((b) => {
      const h = sum.find((s) => s.codec === 'hazehash' && s.budget === b);
      const bl = sum.find((s) => s.codec === 'blurhash' && s.budget === b);
      if (!h || !bl || !th) return '';
      return `<tr><td>${b}</td><td>${f(h.dE)}</td><td>${f(bl.dE)}</td><td>${f(th.dE)}</td><td>${f((1 - h.dE / bl.dE) * 100, 1)}%</td><td>${f((1 - h.dE / th.dE) * 100, 1)}%</td></tr>`;
    })
    .join('');

  const table = sum
    .map(
      (s) =>
        `<tr><td>${s.codec}</td><td>${s.budget || 'native'}</td><td>${s.n}</td><td>${s.bytesMedian}</td><td>${f(s.dE)}</td><td>${f(s.dE95px)}</td><td>${f(s.dEp95img)}</td><td>${f(s.ssim, 4)}</td><td>${f(s.encMs)}</td><td>${f(s.decMs, 3)}</td></tr>`,
    )
    .join('');

  const mainBudget = budgets.includes(28) ? 28 : budgets[Math.floor(budgets.length / 2)];
  const hz = rows.filter((r) => r.codec === 'hazehash' && r.budget === mainBudget);
  const lengths = new Map<number, number>();
  for (const r of hz) lengths.set(r.bytes, (lengths.get(r.bytes) ?? 0) + 1);
  const maxCount = Math.max(1, ...lengths.values());
  const hist = [...lengths.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([len, c]) =>
        `<div class="bar"><span>${len} B</span><b style="width:${(c / maxCount) * 240}px"></b><em>${c}</em></div>`,
    )
    .join('');

  const cats = [...new Set(rows.map((r) => r.category))].sort();
  const catRows = cats
    .map((c) => {
      const pick = (codec: string, b: number) =>
        mean(
          rows
            .filter((r) => r.category === c && r.codec === codec && r.budget === b)
            .map((r) => r.dE),
        );
      const n = rows.filter((r) => r.category === c && r.codec === 'thumbhash').length;
      return `<tr><td>${c}</td><td>${n}</td><td>${f(pick('hazehash', mainBudget))}</td><td>${f(pick('blurhash', mainBudget))}</td><td>${f(pick('thumbhash', 0))}</td></tr>`;
    })
    .join('');

  const sheetRows = sheet
    .map(
      (s) =>
        `<tr class="${s.kind}"><td class="name">${s.file}<br><small>${s.kind}</small></td><td><img src="${s.original}"></td>${[
          'blurhash',
          'thumbhash',
          'hazehash',
        ]
          .map(
            (c) =>
              `<td>${s.previews[c] ? `<img class="pv" src="${s.previews[c]}">` : ''}<br><small>ΔE ${f(s.dE[c] ?? NaN, 1)}</small></td>`,
          )
          .join('')}</tr>`,
    )
    .join('');

  const hMain = sum.find((s) => s.codec === 'hazehash' && s.budget === mainBudget);
  const bMain = sum.find((s) => s.codec === 'blurhash' && s.budget === mainBudget);
  const summaryText = [
    `HazeHash profile=${meta.profile}, images=${meta.images}`,
    'codec        budget  bytes(med)  dE      dE95px  dEp95img  ssim    enc ms  dec ms',
    ...sum.map(
      (s) =>
        `${s.codec.padEnd(12)} ${String(s.budget || 'native').padEnd(7)} ${String(s.bytesMedian).padEnd(11)} ${f(s.dE).padEnd(7)} ${f(s.dE95px).padEnd(7)} ${f(s.dEp95img).padEnd(9)} ${f(s.ssim, 4).padEnd(7)} ${f(s.encMs).padEnd(7)} ${f(s.decMs, 3)}`,
    ),
    hMain && bMain && th
      ? `At ${mainBudget} B: ${f((1 - hMain.dE / bMain.dE) * 100, 1)}% lower dE than BlurHash, ${f((1 - hMain.dE / th.dE) * 100, 1)}% lower than ThumbHash`
      : '',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HazeHash benchmark</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--mut:#6b7280;--line:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:980px;margin:0 auto}h1{margin:0 0 4px}h2{margin-top:36px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}
.wrap{overflow-x:auto}.legend{display:flex;gap:16px;margin:8px 0}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px}
svg{width:100%;max-width:640px;height:auto}.bar{display:flex;align-items:center;gap:8px}.bar span{width:48px;text-align:right}.bar b{height:12px;background:#2563eb;border-radius:2px}
.name{max-width:160px;word-break:break-all}.pv{width:96px;image-rendering:auto}small{color:var(--mut)}tr.worst{background:rgba(220,38,38,.06)}
td img{vertical-align:middle;border-radius:4px}
</style></head><body><main>
<h1>HazeHash benchmark</h1>
<p><small>profile ${meta.profile} · ${meta.images} images · ΔE is OKLab distance ×100 against an area-averaged linear-light reference; alpha images are scored over white and black.</small></p>
<h2>Bytes vs error</h2>${chartSvg(sum, budgets)}
<h2>Same-budget comparison (mean ΔE)</h2>
<div class="wrap"><table><tr><th>budget, B</th><th>HazeHash</th><th>BlurHash</th><th>ThumbHash (native)</th><th>vs BlurHash</th><th>vs ThumbHash</th></tr>${compare}</table></div>
<h2>All metrics</h2>
<div class="wrap"><table><tr><th>codec</th><th>budget</th><th>n</th><th>bytes (median)</th><th>mean ΔE</th><th>mean pixel p95 ΔE</th><th>p95 over images</th><th>SSIM(L)</th><th>enc ms</th><th>dec ms</th></tr>${table}</table></div>
<h2>HazeHash length distribution at ${mainBudget} B</h2>${hist}
<h2>By category at ${mainBudget} B (mean ΔE)</h2>
<div class="wrap"><table><tr><th>category</th><th>n</th><th>HazeHash</th><th>BlurHash</th><th>ThumbHash</th></tr>${catRows}</table></div>
<h2>Contact sheet</h2>
<div class="wrap"><table><tr><th>file</th><th>original</th><th>BlurHash</th><th>ThumbHash</th><th>HazeHash</th></tr>${sheetRows}</table></div>
</main></body></html>`;
  return { csv, summaryCsv, html, summaryText };
}
