// Miss-analysis: GH #636; the copy and the delete each had suites of their own, and none ran the
// two over one range to compare what the cut puts on the clipboard with what it removes.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { CstNode, Document } from '../../core/nodes';
import { collectCrossBlockText } from '../../selection/clipboard-text';
import { rangeDelete } from '../../selection/range-delete';
import { coverRange } from '../../selection/range-coverage';
import { cellPoint, type SelectionPoint } from '../../selection/primitives';
import { createSharingState } from '../../tree-operations/sharing';
import { reservedChromeKindOf } from '../../schema/reserved-chrome';
import { fixtureReading } from '../harness/fixture-grammar';
import { registerChromePluginsForTests } from './chrome-plugins';

// Every block's text is one capital letter repeated, and no markup holds a capital, so a letter
// missing from the result means that block went whole and a block's raw still in it means it stayed.
const CLOSED = '<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n';
const OPEN = '<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n';
const TABLE = '| TT | UU |\n| --- | --- |\n| VV | WW |\n';

const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The other endpoint, per branch: prose, an open details' title row, a table's cell. */
const OTHER = {
	prose: { source: 'MMMM\n', before: point([0], 1), after: point([2], 1) },
	'title-line': { source: OPEN, before: point([0, 0], 1), after: point([2, 0], 1) },
	table: { source: TABLE, before: cellPoint([0], 2), after: cellPoint([2], 1) }
} as const;

const TITLE_OFFSETS = { 'offset 0': 0, inside: 1, end: 4 } as const;

/** Every block a cut can take or keep: reserved title rows, table rows and cells are parts of
 *  their container, not blocks of their own. */
function blocksOf(nodes: readonly CstNode[], out: CstNode[] = []): CstNode[] {
	for (const node of nodes) {
		if (node.kind === 'tableRow') continue;
		out.push(node);
		const children = node.children ?? [];
		const body = reservedChromeKindOf(node.kind) === undefined ? children : children.slice(1);
		blocksOf(body, out);
	}
	return out;
}

const letters = (raw: string) => new Set(raw.match(/[A-Z]/g) ?? []);
const bare = (raw: string) => raw.replace(/\n+$/, '');

/** A cut as the editor runs it: the copy, then the delete, over one covered range. */
function cutThenDelete(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc: Document = parse(source);
	const range = coverRange(doc, start, end);
	const copied = collectCrossBlockText(doc, range);
	const left = serialize(
		rangeDelete(doc, range, createSharingState(), fixtureReading(), 'keyless').newDoc
	);
	return { copied, left };
}

function expectCutAgrees(source: string, start: SelectionPoint, end: SelectionPoint): void {
	const { copied, left } = cutThenDelete(source, start, end);
	const pasted = blocksOf(parse(copied).children);
	for (const block of blocksOf(parse(source).children)) {
		const own = [...letters(block.raw)];
		if (own.length === 0) continue;
		const whole = pasted.some((p) => p.kind === block.kind && bare(p.raw) === bare(block.raw));
		if (whole) {
			expect(
				own.some((letter) => left.includes(letter)),
				`${block.kind} copied whole is gone from what the delete left ${JSON.stringify(left)}`
			).toBe(false);
		}
		if (own.every((letter) => !left.includes(letter))) {
			expect(
				whole,
				`${block.kind} removed whole is whole in the copy ${JSON.stringify(copied)}`
			).toBe(true);
		} else if (left.includes(block.raw)) {
			expect(
				own.some((letter) => copied.includes(letter)),
				`${block.kind} kept whole is not in the copy ${JSON.stringify(copied)}`
			).toBe(false);
		}
	}
}

beforeEach(registerChromePluginsForTests);

describe('a cut copies exactly what it deletes', () => {
	describe.each(Object.entries(OTHER))('the other endpoint in %s', (_, other) => {
		it.each(Object.entries(TITLE_OFFSETS))('a start on a closed title row at %s', (_, k) => {
			expectCutAgrees('AAAA\n\n' + CLOSED + '\n' + other.source, point([1, 0], k), other.after);
		});

		it.each(Object.entries(TITLE_OFFSETS))('an end on a closed title row at %s', (_, k) => {
			expectCutAgrees(other.source + '\n' + CLOSED + '\nEEEE\n', other.before, point([1, 0], k));
		});
	});

	it('select-all over a document that is one closed details', () => {
		expectCutAgrees(CLOSED, point([0, 0], 0), point([0, 1], 4));
	});
});
