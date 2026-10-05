/**
 * Compares two summary.csv files (base vs head) and fails when the mean HazeHash error at the
 * reference budget grows by more than the allowed percentage.
 * Usage: tsx src/compare.ts <base summary.csv> <head summary.csv> [maxIncreasePercent=2] [budget=28]
 */
import { readFileSync } from 'node:fs';

function meanError(path: string, budget: number): number {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = header.split(',');
  const codec = cols.indexOf('codec');
  const bud = cols.indexOf('budget');
  const dE = cols.indexOf('dE');
  for (const row of rows) {
    const cells = row.split(',');
    if (cells[codec] === 'hazehash' && Number(cells[bud]) === budget) return Number(cells[dE]);
  }
  throw new Error(`No hazehash row for budget ${budget} in ${path}`);
}

const [basePath, headPath, maxArg, budgetArg] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error(
    'Usage: compare <base summary.csv> <head summary.csv> [maxIncreasePercent] [budget]',
  );
  process.exit(2);
}
const limit = Number(maxArg ?? 2);
const budget = Number(budgetArg ?? 28);
const base = meanError(basePath, budget);
const head = meanError(headPath, budget);
const change = ((head - base) / base) * 100;
console.log(
  `mean dE at ${budget} B: base ${base.toFixed(4)}, head ${head.toFixed(4)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`,
);
if (change > limit) {
  console.error(`Regression: error grew by more than ${limit}%`);
  process.exit(1);
}
