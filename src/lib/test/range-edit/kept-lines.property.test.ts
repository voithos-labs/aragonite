// @vitest-environment jsdom
// G4.350: a removal keeps every line after its range, each a line of its own inside the fenced
// containers that held it, and the line it starts on where that line's block stays, over ranges
// that leave a container from a block it takes whole, from mid-text or from a line's first byte,
// into the block after it, a table's rows, a later block's opening or the document's end. The range
// goes through the editor's own adapter, as a selection's does. Where the start's block went whole,
// Delete and a composition land on the text left after the range, or on a line emptied at its start.
// Miss-analysis: the law draws filled fenced bodies with paragraphs and `# head` only, and drew
// tables and rules outside fenced containers, so no range left one from a block it took whole. And
// no draw started at a line's first byte in a block that stays, with an end that joins no text.
// No draw ended in a later container's body, and nothing read where Delete put the caret. No draw
// started at the top level, crossed a details, a quote or an item on the way in, or went three deep.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isBlankText } from '#lib/core/lines.js';
import type { DocumentView } from '#lib/core/node-views.js';
import { editRange, removalOf } from '#lib/range-edit/edit-range.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { lineRest } from '#lib/range-edit/leaf-splice.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { normalizeCharEndpoint } from '#lib/selection/char-endpoint-snap.js';
import { pathsEqual } from '#lib/selection/path-math.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { removalBytes } from '#lib/selection/range-bytes.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { leafAt, readOf } from './expected';
import { gluedStart, movedLine } from './kept-lines';
import { checkHost, testReading } from './test-host';

const TABLE = ['| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'];
const quoted = (lines: string[]) => lines.map((l) => (l ? `> ${l}` : '>'));
const under = (first: string, rest: string) => (lines: string[]) =>
	lines.map((l, i) => (i === 0 ? first + l : l ? rest + l : ''));

/** Each container around its body; the last leaves the body at the top level. */
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
	footnote: under('[^1]: ', '    '),
	'no container': (b) => b
};

/** The container's body: `⟦` at the first byte of a block the range takes whole, inside a block's
 *  text, or at a line's first byte in a block that stays. */
const BODIES: Record<string, string[]> = {
	'a rule taken whole': ['⟦***', '', 'body'],
	'a table taken whole': [...TABLE.map((l, i) => (i ? l : `| ⟦a | b |`)), '', 'body'],
	'from mid-text': ['***', '', 'bo⟦dy'],
	'from a paragraph’s first byte': ['⟦body', '', 'more'],
	'from a paragraph’s second line': ['first', '⟦body'],
	'from a code line’s start': ['```', 'one', '⟦two', '```']
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
	'a later container’s title row': { lines: ['', ':::tip Ti⟧tle', 'inner', ':::', '', '# h'] },
	'a later container’s body': { lines: ['', ':::tip', 'in⟧ner', 'more', ':::', '', '# h'] },
	'a container in a later container': {
		lines: ['', '::::note', ':::tip', 'in⟧ner', ':::', '::::', '', '# h']
	},
	'a code block in a later container': {
		lines: ['', ':::tip', '```', 'co⟧de', '```', ':::', '', '# h']
	},
	'a code block three openings deep': {
		lines: ['', '::::note', ':::tip', '```', 'co⟧de', '```', ':::', '::::', '', '# h']
	},
	'a details in a later container': {
		lines: [
			'',
			':::tip',
			'<details open>',
			'<summary>Sum</summary>',
			'',
			'in⟧ner',
			'',
			'</details>',
			':::',
			'',
			'# h'
		]
	},
	'a container in a later details': {
		lines: [
			'',
			'<details open>',
			'<summary>Sum</summary>',
			'',
			':::tip',
			'in⟧ner',
			':::',
			'',
			'</details>',
			'',
			'# h'
		]
	},
	'a container in a quote': { lines: ['', '> :::tip', '> in⟧ner', '> :::', '', '# h'] },
	'a container in an item': { lines: ['', '- :::tip', '  in⟧ner', '  :::', '', '# h'] },
	'a code block right below': { lines: ['```', 'co⟧de', '```', '', '# h'] },
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
	const tableAt = (byte: number) => [...layout.within(byte, byte)].find((b) => b.type === 'table');
	// A range into or out of a table holds its cells, as a selection across blocks does.
	const first = tableAt(from);
	const anchor = first ? { path: first.path, offset: 0, cellCoordinate: true } : at(from);
	const table = cell === undefined ? null : tableAt(to);
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
		const landings: string[] = [];
		let waiting = 0;
		let landed = 0;
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
				// A document with no final line ending loses a line emptied at its end, a defect apart.
				if (!c.final && c.end === 'the document’s end' && c.body.startsWith('from a')) return;
				const read = readOf(host, source);
				const cut = editRange(source, range, 'cut', c.mode, host).source;
				const keys = (['backspace', 'delete'] as const).map(
					(g) => removalOf(source, range, g, c.mode, host).source
				);
				for (const got of [cut, ...keys]) {
					const moved =
						gluedStart(host, read, range.from, range.to, got) ??
						movedLine(host, read, range.from, range.to, got);
					if (moved) fails.push(`${moved}: ${JSON.stringify(got)}\n    ${JSON.stringify(c)}`);
				}
				// G4.351: where the start's block went whole, Delete lands on the text left after the range,
				// or on the line the removal left emptied at the range's start.
				const rest = lineRest(source, range.to);
				if (!c.body.endsWith('taken whole') || cell !== undefined || isBlankText(rest)) return;
				landed++;
				const kind = leafAt(read, range.to)?.type;
				for (const g of ['delete', 'compose'] as const) {
					const { caret, source: got } = removalOf(source, range, g, c.mode, host);
					const emptied = caret.at <= range.from && isBlankText(lineRest(got, caret.at));
					// The text after stays the kind of block it was, so an opening the removal lost shows.
					const after =
						got.startsWith(rest, caret.at) && leafAt(readOf(host, got), caret.at)?.type === kind;
					if (caret.holds !== 'text' || !(after || emptied))
						landings.push(
							`${g} landed at ${caret.at}: ${JSON.stringify(got)}\n    ${JSON.stringify(c)}`
						);
				}
			}),
			{ numRuns: 400, seed: freshOrFixedSeed(20261112) }
		);
		expect(fails.slice(0, 10)).toEqual([]);
		expect(landings.slice(0, 10), 'G4.351 Delete lands on the text after').toEqual([]);
		expect(waiting).toBeGreaterThan(0);
		expect(landed).toBeGreaterThan(0);
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

	// The law's own reading, on bytes no removal gives today: each is a way a kept line goes wrong.
	it.each([
		{
			name: 'a heading under the closing line that should stand above it',
			marked: '<details open>\n<summary>S</summary>\n\n⟦***\n\n</details>\n\npara⟧\n\n# h\n',
			got: '<details open>\n<summary>S</summary>\n\n# h\n</details>\n',
			reads: /# h/
		},
		{
			name: 'the outer closing line before the inner',
			marked: '::::note\n:::tip\n⟦***\n:::\n\npara⟧\n::::\n',
			got: '::::note\n:::tip\n::::\n:::\n',
			reads: /":::"/
		},
		{
			name: 'a closing line the removal dropped',
			marked: '::::note\n:::tip\n⟦***\n:::\n\npara⟧\n::::\n',
			got: '::::note\n:::tip\n::::\n',
			reads: /lost the line ":::"/
		},
		{
			name: 'a closing line glued to the text before it',
			marked: ':::note\nbo⟦dy\n:::\n\npara⟧\n\n# h\n',
			got: ':::note\nbo:::\n\n# h\n',
			reads: /glued the start’s line/
		},
		{
			name: 'an opening line where the start’s emptied line stood',
			marked: 'x\n⟦body\n:::tip\nin⟧ner\n:::\n',
			got: 'x\n:::tip\nner\n:::\n',
			reads: /glued the start’s line/
		},
		{
			name: 'nothing, where each stands in place',
			marked: '::::note\n:::tip\n⟦***\n:::\n\npara⟧\n::::\n',
			got: '::::note\n:::tip\n:::\n::::\n',
			reads: null
		}
	])('the law reads $name', ({ marked, got, reads }) => {
		const host = checkHost(testReading());
		const from = marked.indexOf('⟦');
		const to = marked.indexOf('⟧') - 1;
		const read = readOf(host, marked.replace('⟦', '').replace('⟧', ''));
		const line = gluedStart(host, read, from, to, got) ?? movedLine(host, read, from, to, got);
		if (reads) expect(line).toMatch(reads);
		else expect(line).toBeNull();
	});
});
