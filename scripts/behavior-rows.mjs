// The behavior differential's rows: one JSON object per line, keyed by `in` (the input), sorted,
// fields in a fixed order. The behavior suites write them and `scripts/behavior.mjs` diffs two
// records of them.

/** Field order in a line; a field a row doesn't have is left out. */
const FIELDS = ['in', 'do', 'took', 'bytes', 'caret', 'undo', 'warns', 'outline'];

/** @typedef {{ in: string } & Record<string, string | string[] | undefined>} Row */

/**
 * The rows as record text: sorted by input, one line each, ending in a newline.
 * @param {Row[]} rows
 */
export function formatRows(rows) {
	const sorted = [...rows].sort((a, b) => (a.in < b.in ? -1 : a.in > b.in ? 1 : 0));
	return sorted.map(formatRow).join('\n') + (sorted.length ? '\n' : '');
}

/** A field's value as a line holds it: an empty list is no field at all. */
const present = (/** @type {unknown} */ value) =>
	Array.isArray(value) && value.length === 0 ? undefined : value;

/** @param {Row} row */
function formatRow(row) {
	const unknown = Object.keys(row).filter((field) => !FIELDS.includes(field));
	if (unknown.length) throw new Error(`row ${row.in}: unknown field ${unknown.join(', ')}`);
	/** @type {Record<string, unknown>} */
	const ordered = {};
	for (const field of FIELDS) {
		const value = present(row[field]);
		if (value !== undefined) ordered[field] = value;
	}
	return JSON.stringify(ordered);
}

/**
 * @param {string} text
 * @returns {Row[]}
 */
export function parseRows(text) {
	return text
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line));
}

/**
 * What changed from `base` to `tip`: rows whose input both hold but whose fields differ, counted
 * per field, and inputs only one of them holds.
 * @param {Row[]} base
 * @param {Row[]} tip
 */
export function diffRows(base, tip) {
	const before = new Map(base.map((row) => [row.in, row]));
	const after = new Map(tip.map((row) => [row.in, row]));
	/** @type {{ in: string, fields: Record<string, [unknown, unknown]> }[]} */
	const changed = [];
	/** @type {Record<string, number>} */
	const byField = {};
	for (const [input, row] of after) {
		const old = before.get(input);
		if (!old) continue;
		/** @type {Record<string, [unknown, unknown]>} */
		const fields = {};
		for (const field of FIELDS.slice(1)) {
			const [was, now] = [present(old[field]), present(row[field])];
			if (JSON.stringify(was) === JSON.stringify(now)) continue;
			fields[field] = [was, now];
			byField[field] = (byField[field] ?? 0) + 1;
		}
		if (Object.keys(fields).length) changed.push({ in: input, fields });
	}
	return {
		compared: [...after.keys()].filter((input) => before.has(input)).length,
		changed,
		byField,
		added: [...after.keys()].filter((input) => !before.has(input)),
		removed: [...before.keys()].filter((input) => !after.has(input))
	};
}

/** @typedef {ReturnType<typeof diffRows>} RowDiff */

/** The diff's one line of counts, the shape a lane pastes into its report. */
export function summaryLine(/** @type {string} */ label, /** @type {RowDiff} */ diff) {
	const kinds = Object.entries(diff.byField)
		.map(([field, count]) => `${field} ${count}`)
		.join(', ');
	return (
		`${label}: ${diff.compared} rows compared, ${diff.changed.length} changed` +
		(kinds ? ` (${kinds})` : '') +
		`, ${diff.added.length} added, ${diff.removed.length} removed`
	);
}

/**
 * The counts, then each changed, added and removed input, `limit` of them at most.
 * @param {string} label
 * @param {RowDiff} diff
 * @param {number} [limit]
 */
export function formatDiff(label, diff, limit = Infinity) {
	const lines = [summaryLine(label, diff)];
	const entries = [
		...diff.changed.map((change) => [
			`  changed ${change.in}`,
			...Object.entries(change.fields).map(
				([field, [was, now]]) => `    ${field}: ${show(was)} -> ${show(now)}`
			)
		]),
		...diff.added.map((input) => [`  added ${input}`]),
		...diff.removed.map((input) => [`  removed ${input}`])
	];
	for (const entry of entries.slice(0, limit)) lines.push(...entry);
	if (entries.length > limit) lines.push(`  ... and ${entries.length - limit} more`);
	return lines.join('\n');
}

const show = (/** @type {unknown} */ value) =>
	value === undefined ? '(none)' : JSON.stringify(value);
