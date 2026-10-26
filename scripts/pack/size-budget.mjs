// The first-load size budget: each minimal-app number's blessed baseline and how far it may move
// either way, in `size-budget.json`. A number past its tolerance fails, grown or shrunk; blessing
// records the new value on purpose, so a shrink is locked in and a growth is a decision.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'size-budget.json'
);

/** @typedef {{ baseline: number, tolerance: number, unit: string }} BudgetRow */

/** @returns {Record<string, BudgetRow>} */
export function readBaseline(file = BASELINE_FILE) {
	return JSON.parse(readFileSync(file, 'utf8')).rows;
}

/**
 * Every row that moved past its tolerance, as a message; an empty list means each is in budget.
 * @param {Record<string, number>} measured
 * @param {Record<string, BudgetRow>} rows
 * @param {string} blessCommand What the reader runs to accept the new numbers.
 */
export function checkBudgets(measured, rows, blessCommand) {
	const failures = [];
	for (const [name, value] of Object.entries(measured)) {
		const row = rows[name];
		if (!row) {
			failures.push(`${name} has no row in ${path.basename(BASELINE_FILE)}; add one by hand`);
			continue;
		}
		const delta = value - row.baseline;
		if (Math.abs(delta) <= row.tolerance) continue;
		const action =
			delta > 0
				? `if the growth is on purpose, \`${blessCommand}\` accepts it`
				: `\`${blessCommand}\` locks the gain in`;
		failures.push(
			`${name} ${delta > 0 ? 'grew' : 'shrank'} to ${value} ${row.unit}, ${Math.abs(delta)} ` +
				`from its baseline ${row.baseline} (tolerance ${row.tolerance}); ${action}`
		);
	}
	return failures;
}

/**
 * Writes the measured values as the new baselines, keeping every row's tolerance.
 * @param {Record<string, number>} measured
 */
export function blessBudgets(measured, file = BASELINE_FILE) {
	const data = JSON.parse(readFileSync(file, 'utf8'));
	for (const [name, value] of Object.entries(measured)) {
		if (!data.rows[name]) throw new Error(`${name} has no row in ${file}; add one by hand`);
		data.rows[name].baseline = value;
	}
	writeFileSync(file, `${JSON.stringify(data, null, '\t')}\n`);
}
