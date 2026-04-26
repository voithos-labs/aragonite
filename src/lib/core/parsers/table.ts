import type { TableAlignment } from '../nodes';

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

// ── Delimiter row ──────────────────────────────────────────────────────────

export function matchTableDelimiterRow(
	text: string
): { columnCount: number; alignments: TableAlignment[] } | null {
	const trimmed = text.trim();
	if (!trimmed.includes('|')) return null;

	const inner = trimmed.replace(/^\||\|$/g, '');
	const cells = inner.split('|');
	const alignments: TableAlignment[] = [];

	for (const cell of cells) {
		const c = cell.trim();
		if (!/^:?-+:?$/.test(c)) return null;
		const left = c.startsWith(':');
		const right = c.endsWith(':');
		if (left && right) alignments.push('center');
		else if (left) alignments.push('left');
		else if (right) alignments.push('right');
		else alignments.push('none');
	}

	return { columnCount: cells.length, alignments };
}
