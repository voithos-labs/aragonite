// GFM table parser. Produces a structured `table` container with `tableRow`
// children, each containing `tableCell` leaves. The delimiter row is
// structural-only — its alignment data is captured on `table.metadata.alignments`
// and the row itself is not stored.

// ── Cell splitter ──────────────────────────────────────────────────────────

export function splitRowCells(rowText: string): string[] {
	const trimmed = rowText.trim();
	const head = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
	const inner = head.endsWith('|') ? head.slice(0, -1) : head;
	const cells: string[] = [];
	let current = '';
	let i = 0;
	while (i < inner.length) {
		const ch = inner[i];
		if (ch === '|' && !isEscaped(inner, i)) {
			cells.push(trimOneSpace(current));
			current = '';
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	cells.push(trimOneSpace(current));
	return cells;
}

function isEscaped(s: string, index: number): boolean {
	let backslashes = 0;
	let j = index - 1;
	while (j >= 0 && s[j] === '\\') {
		backslashes++;
		j--;
	}
	return backslashes % 2 === 1;
}

function trimOneSpace(s: string): string {
	let out = s;
	if (out.startsWith(' ')) out = out.slice(1);
	if (out.endsWith(' ')) out = out.slice(0, -1);
	return out;
}
