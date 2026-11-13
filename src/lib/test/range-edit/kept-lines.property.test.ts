// @vitest-environment jsdom
// G4.350: a removal keeps every line after its range, each a line of its own inside the fenced
// containers that held it, over ranges that leave a container from a block it takes whole or from
// mid-text, into the block after it, a table's rows or the document's end. The range goes through
// the editor's own adapter, as a selection's does.
// Miss-analysis: the law draws filled fenced bodies with paragraphs and `# head` only, and drew
// tables and rules outside fenced containers, so no range left one from a block it took whole.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DocumentView } from '#lib/core/node-views.js';
import { editRange, removalOf } from '#lib/range-edit/edit-range.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { normalizeCharEndpoint } from '#lib/selection/char-endpoint-snap.js';
import { pathsEqual } from '#lib/selection/path-math.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { removalBytes } from '#lib/selection/range-bytes.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { readOf } from './expected';
import { movedLine } from './kept-lines';
import { checkHost, testReading } from './test-host';

const TABLE = ['| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'];
const quoted = (lines: string[]) => lines.map((l) => (l ? `> ${l}` : '>'));
const under = (first: string, rest: string) => (lines: string[]) =>
	lines.map((l, i) => (i === 0 ? first + l : l ? rest + l : ''));

/** Each container around its body. */
const WRAPS: Record<string, (body: string[]) => string[]> = {
	'open details': (b) => ['<details open>', '<summary>Sum</summary>', '', ...b, '', '</details>'],
	note: (b) => [':::note', ...b, ':::'],
	'titled note': (b) => [':::note Title', ...b, ':::'],
	'tip in a note': (b) => ['::::note', ':::tip', ...b, ':::', '::::'],
	'tip in a note, a paragraph after it': (b) => [
		'::::note',
		':::tip',
		...b,
		':::',
		'',
		'more',
		'::::'
	],
	'details in a note': (b) => [
		':::note',
		'<details open>',
		'<summary>Sum</summary>',
		'',
		...b,
		'',
		'</details>',
		':::'
	],
	'quote in a note': (b) => [':::note', ...quoted(b), ':::'],
	'note in a quote': (b) => quoted([':::note', ...b, ':::']),
	alert: (b) => ['> [!NOTE]', ...quoted(b)],
	quote: quoted,
	item: under('- ', '  '),
	footnote: under('[^1]: ', '    ')
};

/** The container's body: `⟦` at the first block's first byte, or inside its text. */
const BODIES: Record<string, string[]> = {
	'a rule taken whole': ['⟦***', '', 'body'],
	'a table taken whole': [...TABLE.map((l, i) => (i ? l : `| ⟦a | b |`)), '', 'body'],
	'from mid-text': ['***', '', 'bo⟦dy']
};

/** What follows the container: `⟧` marks the end, `cell` names a table's cell end. */
const ENDS: Record<string, { lines: string[]; cell?: number }> = {
	'a paragraph’s start': { lines: ['', '⟧para', '', '# h'] },
	'a paragraph’s middle': { lines: ['', 'pa⟧ra', '', '# h'] },
	'a paragraph’s end': { lines: ['', 'para⟧', '', '# h'] },
	'a table’s first row': { lines: ['', '| ⟧a | b |', ...TABLE.slice(1), '', '# h'], cell: 0 },
	'a table’s middle row': {
		lines: ['', ...TABLE.slice(0, 2), '| ⟧1 | 2 |', TABLE[3], '', '# h'],
		cell: 2
	},
	'a table’s last row': { lines: ['', ...TABLE.slice(0, 3), '| ⟧3 | 4 |', '', '# h'], cell: 4 },
	'the document’s end': { lines: ['', 'para⟧'] }
};

const arbCase = fc.record({
	wrap: fc.constantFrom(...Object.keys(WRAPS)),
	body: fc.constantFrom(...Object.keys(BODIES)),
	end: fc.constantFrom(...Object.keys(ENDS)),
	eol: fc.constantFrom('\n', '\r\n', 'mixed'),
	final: fc.boolean(),
	mode: fc.constantFrom('source' as const, 'live' as const)
});
type Case = typeof arbCase extends fc.Arbitrary<infer T> ? T : never;

function sourceOf(c: Case): { marked: string; cell?: number } {
	const end = ENDS[c.end];
	const lines = [...WRAPS[c.wrap](BODIES[c.body]), ...end.lines];
	let i = 0;
	const eol = () => (c.eol === 'mixed' ? (i++ % 2 ? '\n' : '\r\n') : c.eol);
	const marked = lines.map((l, n) => l + (n < lines.length - 1 || c.final ? eol() : '')).join('');
	return { marked, cell: end.cell };
}

/** The range a selection between the two marks reads as, through the editor's adapter. */
function rangeOf(doc: DocumentView, source: string, from: number, to: number, cell?: number) {
	const layout = documentLayout(measured(doc));
	const at = (byte: number): SelectionPoint | null => {
		const p = layout.pointAt(byte);
		return p ? { path: p.path, offset: p.offset } : null;
	};
	const anchor = at(from);
	const table =
		cell === undefined ? null : [...layout.within(to, to)].find((b) => b.type === 'table');
	const focus = table ? { path: table.path, offset: cell!, cellCoordinate: true } : at(to);
	if (!anchor || !focus) return null;
	const snap = (p: SelectionPoint, o: SelectionPoint) =>
		p.cellCoordinate || pathsEqual(p.path, o.path) ? p : normalizeCharEndpoint(doc, p, o.path);
	const covered = coverRange(doc, snap(anchor, focus), snap(focus, anchor));
	return removalBytes(doc, rangeCoverage(doc, covered), layout);
}

/** A range the adapter ends past a table's last line ending, which the removal glues to the next
 *  line: its fix waits on the paste back of a cut that ends at a table's text end. */
const pastTable = (source: string, doc: DocumentView, to: number) =>
	[...documentLayout(measured(doc)).within(to, to)].some(
		(b) => b.type === 'table' && b.to === to && source[to - 1] === '\n'
	);

describe('G4.350 a removal keeps the lines after its range', () => {
	it('in place, each in the fenced containers that held it', () => {
		const reading = testReading();
		const host = checkHost(reading);
		const fails: string[] = [];
		let waiting = 0;
		fc.assert(
			fc.property(arbCase, (c) => {
				const { marked, cell } = sourceOf(c);
				const from = marked.indexOf('⟦');
				const to = marked.indexOf('⟧') - 1;
				const source = marked.replace('⟦', '').replace('⟧', '');
				const doc = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
				const range = rangeOf(doc, source, from, to, cell);
				if (!range) return;
				if (pastTable(source, doc, range.to)) return void waiting++;
				const read = readOf(host, source);
				const cut = editRange(source, range, 'cut', c.mode, host).source;
				const keys = (['backspace', 'delete'] as const).map(
					(g) => removalOf(source, range, g, c.mode, host).source
				);
				for (const got of [cut, ...keys]) {
					const moved = movedLine(host, read, range.from, range.to, got);
					if (moved) fails.push(`${moved}: ${JSON.stringify(got)}\n    ${JSON.stringify(c)}`);
				}
			}),
			{ numRuns: 400, seed: freshOrFixedSeed(20261112) }
		);
		expect(fails.slice(0, 10)).toEqual([]);
		expect(waiting).toBeGreaterThan(0);
	});

	// The draws above skip that range; this row goes red the day its fix lands.
	it('still glues the line after a table’s last row where the adapter ends past it', () => {
		const reading = testReading();
		const host = checkHost(reading);
		const { marked, cell } = sourceOf({
			wrap: 'note',
			body: 'from mid-text',
			end: 'a table’s last row',
			eol: '\n',
			final: true,
			mode: 'source'
		});
		const source = marked.replace('⟦', '').replace('⟧', '');
		const doc = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
		const range = rangeOf(doc, source, marked.indexOf('⟦'), marked.indexOf('⟧') - 1, cell)!;
		const got = editRange(source, range, 'cut', 'source', host).source;
		expect(pastTable(source, doc, range.to)).toBe(true);
		expect(movedLine(host, readOf(host, source), range.from, range.to, got)).not.toBeNull();
	});
});
