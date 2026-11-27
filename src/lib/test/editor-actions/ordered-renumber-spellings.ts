// The list spellings the renumber rule is checked over, and the expected result written out: the
// items above the edit keep the author's numbers, and from it on each takes the start or the number
// above plus the step, 0 when the first two numbers match.
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';

export const SPELLINGS = [
	'1. 1. 1. 1.',
	'1. 1. 2. 3.',
	'1. 2. 3. 4.',
	'0. 1. 2. 3.',
	'0. 0. 0. 0.',
	'5. 6. 7. 8.',
	'3. 5. 7. 9.',
	'1. 5. 3. 7.',
	'1) 2) 3) 4)'
];

/** The markers a list of `count` items shows after an edit renumbering from item `from`. */
export function expectedMarkers(written: string[], from: number, count: number): string[] {
	const numbers = written.map((m) => parseInt(m, 10));
	const step = numbers[0] === numbers[1] ? 0 : 1;
	const delimiter = written[0].at(-1)!;
	const out: number[] = [];
	for (let k = 0; k < count; k++) {
		out.push(k < from ? numbers[k] : k === 0 ? numbers[0] : out[k - 1] + step);
	}
	return out.map((n) => `${n}${delimiter}`);
}

/** The markers of the top-level ordered items in `source`, every list in order. */
export function topMarkers(source: string): string[] {
	return [...source.matchAll(/^(\d+[.)])[ \n]/gm)].map((m) => m[1]);
}

export function listOf(source: string): CstNode {
	return parse(source).children[0];
}
