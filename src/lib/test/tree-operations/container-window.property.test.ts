// A splice inside a list, quote or table reads only the children it reaches, and comes out as the
// top-level window would: the same bytes, the same tree, the same nodes and ids kept, and what a
// reload reads. The shapes at the run's edges are drawn by name, so each fallback has a row, and
// the pastes the range-edit core writes are drawn as it answers them.
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import type { Document } from '#lib/core/nodes.js';
import type { NodeView } from '#lib/core/node-views.js';
import { serialize } from '#lib/core/serializer.js';
import { describeShapeDivergence } from '#lib/core/shape-divergence.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import {
	spliceReading,
	topLevelReading,
	type SpliceReading
} from '#lib/tree-operations/byte-splice.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { changesBetween, type ByteChange } from '#lib/tree-operations/byte-changes.js';
import { splicedOpenerClosers, withSplicedClosers } from '#lib/tree-operations/spliced-openers.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { reloadDivergence } from '#lib/test/exhaustive/edit-driver.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

afterEach(() => disablePerfInstruments());

/** `source` opened as the editor opens it, every container carrying its children's ids. */
function open(source: string): Document {
	installPlugins(SYNTAX_PLUGINS);
	const doc = initDocument(source, defaultGrammarView).doc;
	for (const block of doc.children) assignChildIdsDeep(block);
	return doc;
}

function install(doc: Document, reading: SpliceReading | null): void {
	for (const window of [...(reading?.windows ?? [])].reverse()) {
		doc.children.splice(window.at, window.count, ...window.blocks);
	}
	if (reading) doc.suffix = reading.suffix;
}

/** Each child as the index of the node `was` held there, or `new`, and whether its id is `was`'s. */
function kept(was: readonly NodeView[], wasIds: readonly string[] | undefined, node: NodeView) {
	return (node.children ?? []).map((child, i) => [
		was.includes(child) ? was.indexOf(child) : 'new',
		node.childIds && wasIds?.includes(node.childIds[i]) ? 'kept id' : 'new id'
	]);
}

/** Why the splice inside a container came out other than the top-level one or a reload; null
 *  when it didn't. Also the bytes the window's read parsed. */
function divergence(source: string, changes: (before: string) => ByteChange[]) {
	const inside = open(source);
	const outside = open(source);
	const before = serialize(inside);
	const made = changes(before);
	const olds = inside.children.map((block) => ({
		kids: block.children ?? [],
		ids: block.childIds
	}));
	enablePerfInstruments();
	resetPerfInstruments();
	const reading = spliceReading(measured(inside), before, made, defaultGrammarView);
	const parsed = perfSnapshot().parseBytes;
	disablePerfInstruments();
	const oldsOut = outside.children.map((b) => ({ kids: b.children ?? [], ids: b.childIds }));
	install(inside, reading);
	install(outside, topLevelReading(measured(outside), before, made, defaultGrammarView));
	const bytes = serialize(inside);
	const failure = (() => {
		if (bytes !== serialize(outside)) return `bytes ${JSON.stringify(bytes)}`;
		const shape = describeShapeDivergence(inside, outside);
		if (shape) return `the tree: ${shape}`;
		// The trees are the same shape, so a window's blocks sit at the same index in both, past
		// however many blocks the windows above it added or took.
		let shift = 0;
		for (const window of reading?.windows ?? []) {
			for (let i = 0; i < window.blocks.length; i++) {
				const at = window.at + shift + i;
				const was = olds[window.at + i];
				const wasOut = oldsOut[window.at + i];
				if (!was || !wasOut) continue;
				const a = JSON.stringify(kept(was.kids, was.ids, inside.children[at]));
				const b = JSON.stringify(kept(wasOut.kids, wasOut.ids, outside.children[at]));
				if (a !== b) return `kept nodes ${a}, not ${b}`;
				const spans = inside.children[at].childSpans;
				const reload = open(bytes).children[at]?.childSpans;
				if (spans && reload && String(Array.from(spans)) !== String(Array.from(reload))) {
					return `child spans ${Array.from(spans)}, not ${Array.from(reload)}`;
				}
			}
			shift += window.blocks.length - window.count;
		}
		if (bytes === '') return null;
		// One the top-level window shares (a table read anew keeps rows another column count spelt)
		// is that window's own, booked apart; only the window inside a container is judged here.
		const reload = reloadDivergence(inside, bytes);
		return reload && !reloadDivergence(outside, bytes) ? reload : null;
	})();
	return { failure, parsed, size: before.length };
}

const to = (after: string) => (before: string) => changesBetween(before, after);

// ── Generated documents ──────────────────────────────────────────────────────

const LIST_ITEM = ['- a', '- two words', '  continued', '- [ ] task', '- $$', '  $$', '- ```', '-'];
const ORDERED_ITEM = ['1. a', '2. b', '10. c', '   lazy?', '3. ``` x'];
const QUOTE_LINE = [
	'> a',
	'>',
	'> two words',
	'>     code',
	'>   indented',
	'>\n>',
	// Blank lines, then a line an item or code block above them would take in.
	'>\n>\n>     code',
	'lazy',
	'> > nested',
	'> - item',
	'> $$',
	'> :::note',
	'> :::'
];
const TABLE_ROW = ['| a | b |', '| one |', '| x | y | z |', '| $$ | x |', 'a | b'];

const KINDS = ['list', 'ordered', 'quote', 'table'] as const;

/** One container of one of `kinds`, its lines drawn from its kind's, with blocks above and below. */
const arbContainerDoc = (kinds: readonly (typeof KINDS)[number][]) =>
	fc
		.record({
			kind: fc.constantFrom(...kinds),
			lines: fc.array(fc.nat({ max: 99 }), { minLength: 6, maxLength: 40 }),
			above: fc.constantFrom('', 'para\n\n', ':::note\n\n', '$$\n\n', '```\n\n'),
			below: fc.constantFrom(
				'',
				'\npara\n',
				'\npara\n\n',
				'\n\n',
				'\n:::\n',
				'\n$$\n',
				'next\n',
				'\n- other\n'
			),
			ending: fc.constantFrom('\n', '\r\n')
		})
		.map(({ kind, lines, above, below, ending }) => {
			const pool = { list: LIST_ITEM, ordered: ORDERED_ITEM, quote: QUOTE_LINE, table: TABLE_ROW }[
				kind
			];
			const first = {
				list: '- first',
				ordered: '1. first',
				quote: '> first',
				table: '| h | i |\n| - | - |'
			}[kind];
			const body = [first, ...lines.map((n) => pool[n % pool.length])].join('\n') + '\n';
			return (above + body + below).replace(/\n/g, ending);
		});

/** What an edit writes: plain text, line breaks, every opener and closer that reaches past its own
 *  line, and a quoted item or code line that reads on past blank lines. */
const INSERTS = [
	'x',
	'two words',
	'\n',
	'\n\n',
	'  ',
	'- ',
	'> ',
	'$$',
	'```',
	':::note',
	':::',
	'| ',
	'\n> b',
	'\n  c',
	'\n> - e',
	'\n>     d',
	''
];

/** What an edit writes at a blank line's edge: a line break, or a line that reads on past it. */
const EDGE_INSERTS = ['', '\n', '\n> b', '\n> - e', '\n>     d'];

/** Where a change lands: any byte, a line's start, the start of its text behind a quote's markers,
 *  or the line break above a blank line (taking that blank line too, when it has a span). */
const PLACES = ['byte', 'line', 'text', 'edge'] as const;
type Place = (typeof PLACES)[number];

/** One or two changes landing at `places`, drawn mostly inside the container's lines. */
const arbEdit = (kinds: readonly (typeof KINDS)[number][], places: readonly Place[]) =>
	fc.record({
		source: arbContainerDoc(kinds),
		spots: fc.array(
			fc.record({
				at: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
				place: fc.constantFrom(...places),
				span: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.15, noNaN: true })),
				insert: fc.constantFrom(...INSERTS),
				edgeInsert: fc.constantFrom(...EDGE_INSERTS),
				// A change wider than its bytes: the insert carries the bytes on either side again.
				widen: fc.constantFrom(0, 0, 3, 12)
			}),
			{ minLength: 1, maxLength: 2 }
		)
	});

type Spot = {
	at: number;
	place: Place;
	span: number;
	insert: string;
	edgeInsert: string;
	widen: number;
};

/** Where `spot` starts and ends in `before`, before any widening. */
function spotRange(before: string, spot: Spot): { from: number; end: number; insert: string } {
	const at = Math.floor(spot.at * before.length);
	const line = before.lastIndexOf('\n', at - 1) + 1;
	const span = Math.floor(spot.span * before.length);
	if (spot.place === 'edge') {
		const edge = /\r?\n(?=[ \t>]*\r?\n)/g;
		edge.lastIndex = line;
		const found = edge.exec(before);
		if (!found) return { from: at, end: at + span, insert: spot.insert };
		const below = found.index + found[0].length;
		const end = span > 0 ? before.indexOf('\n', below) + 1 || before.length : found.index;
		return { from: found.index, end, insert: spot.edgeInsert };
	}
	const from =
		spot.place === 'line'
			? line
			: spot.place === 'text'
				? line + /^[ \t>]*/.exec(before.slice(line))![0].length
				: at;
	return { from, end: from + span, insert: spot.insert };
}

function changesAt(before: string, spots: Spot[]) {
	const whole = (n: number) => (before[n - 1] === '\r' && before[n] === '\n' ? n - 1 : n);
	const changes: ByteChange[] = [];
	let floor = 0;
	for (const spot of [...spots].sort((a, b) => a.at - b.at)) {
		const range = spotRange(before, spot);
		const from = whole(Math.max(floor, range.from));
		const end = whole(Math.min(before.length, Math.max(from, range.end)));
		if (from < floor || end < from) continue;
		const lo = whole(Math.max(floor, from - spot.widen));
		const hi = whole(Math.min(before.length, end + spot.widen));
		const insert = before.slice(lo, from) + range.insert + before.slice(end, hi);
		changes.push({ from: lo, to: hi, insert });
		floor = hi;
	}
	return changes;
}

describe('a splice inside a container comes out as the top-level window does', () => {
	it('over generated containers and edits', () => {
		fc.assert(
			fc.property(arbEdit(KINDS, PLACES), ({ source, spots }) => {
				expect(divergence(source, (before) => changesAt(before, spots)).failure).toBeNull();
			}),
			{ numRuns: 400, seed: freshOrFixedSeed(20261108) }
		);
	});

	// A quote is one draw in four and the line above a blank run one spot in hundreds, so a quote's
	// line edges, where a lookahead can stop at a blank child, get a draw of their own.
	it("over quotes edited at their lines' edges", () => {
		fc.assert(
			fc.property(arbEdit(['quote'], ['text', 'edge']), ({ source, spots }) => {
				expect(divergence(source, (before) => changesAt(before, spots)).failure).toBeNull();
			}),
			{ numRuns: 200, seed: freshOrFixedSeed(20261108) }
		);
	});
});

// ── Pastes, as the range-edit core answers them ──────────────────────────────

/** What a paste brings: blocks that land beside the caret's, a list or quote the caret's container
 *  takes in or a list of the other kind leaves, and blocks whose opener waits on a closing line. */
const CLIPS = [
	'one\n\ntwo',
	'- q\n- r',
	'1. q\n2. r',
	'> q\n\n> r\n',
	'# h\n| a |\n| - |\n',
	'```\ncode\n```\n',
	':::note\nx\n:::\n',
	'$$\nx\n'
];

/** The changes a paste of `clip` makes at the first place in a block's text from `at` on, as the
 *  byte splice writes them: the core's bytes, and a closing line under an opener they leave open. */
function pasteChanges(before: string, at: number, clip: string): ByteChange[] {
	const doc = open(before);
	const layout = documentLayout(measured(doc));
	let from = at;
	while (from < before.length && !layout.pointAt(from)) from++;
	const host = rangeHost(fixtureReading({ grammar: defaultGrammarView }, 'source'));
	const paste = { paste: clip, plain: false, holds: 'text' as const };
	const pasting = { ...host, transformPaste: (text: string) => text };
	const after = editRange(before, { from, to: from }, paste, 'source', pasting).source;
	const changes = changesBetween(before, after);
	const read = spliceReading(measured(doc), before, changes, defaultGrammarView);
	const closers = read
		? splicedOpenerClosers(measured(doc), before, changes, read, defaultGrammarView)
		: [];
	return withSplicedClosers(before, changes, closers);
}

describe('a paste inside a container comes out as the top-level window does', () => {
	// Miss-analysis: the draws above write one line's worth at a spot, so no edit added several
	// blocks, changed how many children a container holds by a merge, or closed an opener inside one.
	it('over generated containers, places and clipboards', () => {
		fc.assert(
			fc.property(
				arbContainerDoc(KINDS),
				fc.double({ min: 0.05, max: 0.95, noNaN: true }),
				fc.constantFrom(...CLIPS),
				(source, spot, clip) => {
					const pasted = (before: string) =>
						pasteChanges(before, Math.floor(spot * before.length), clip);
					expect(divergence(source, pasted).failure).toBeNull();
				}
			),
			{ numRuns: 300, seed: freshOrFixedSeed(20261110) }
		);
	});
});

// ── Named rows ───────────────────────────────────────────────────────────────

const ITEMS = (n: number) => Array.from({ length: n }, (_, i) => `- item ${i}\n`).join('');
const QUOTED = (n: number) => Array.from({ length: n }, (_, i) => `> line ${i}\n>\n`).join('');
const ROWS = (n: number) =>
	'| a | b |\n| - | - |\n' + Array.from({ length: n }, (_, i) => `| r ${i} | x |\n`).join('');

/** `before` with `find` replaced by `put`, at its first match. */
const edit = (before: string, find: string, put: string) => before.replace(find, put);

describe('the window inside a container, by its edges', () => {
	// Miss-analysis: every row and draw made a change exactly as wide as its bytes, and every
	// document ended on one line break, so the window's own bytes and blank line were never asked.
	it('writes a change wider than the bytes it changes once', () => {
		const source = ITEMS(40);
		const { failure } = divergence(source, (before) => {
			const from = before.indexOf('- item 18');
			const to = before.indexOf('- item 23');
			const insert = before.slice(from, to).replace('item 20', 'item 2X');
			return [{ from, to, insert }];
		});
		expect(failure).toBeNull();
	});

	it("keeps the document's trailing blank line under a block below", () => {
		const source = ITEMS(40) + '\npara\n\n';
		const { failure } = divergence(source, to(edit(source, 'item 39', 'item 39!')));
		expect(failure).toBeNull();
	});

	// Miss-analysis: every row ended its run above a child with text, and the generator drew no
	// quote line indented into the child above, so no lookahead stopped at a blank child.
	it.each([
		[
			'an item taking in the line below',
			'> first\n> - item\n>\n> text\n>\n> \n>     code\n> text\n',
			(s: string) => edit(s, 'item\n>\n', 'item ')
		],
		[
			'indented code',
			'> a\n>\n> text\n>\n>\n>     code\n> after\n',
			(s: string) => edit(s, '> t', '>     t')
		],
		[
			'a list item',
			'> a\n>\n> text\n>\n>\n>   code\n> after\n',
			(s: string) => edit(s, '> t', '> - t')
		],
		[
			'an item, CRLF',
			'> first\r\n> - item\r\n>\r\n> text\r\n>\r\n> \r\n>     code\r\n> text\r\n',
			(s: string) => edit(s, 'item\r\n>\r\n', 'item ')
		]
	])('reads on past blank children for %s that continues across them', (_name, source, after) => {
		expect(divergence(source, to(after(source))).failure).toBeNull();
	});

	// The blank children below the run must read as they stood; `byte-splice.test.ts` holds the
	// top-level twin of this row, and one check serves both.
	it('text in a blank child moves the blank lines below it', () => {
		const source = '> p\n>\n> a\n>\n>\n>\n>\n> b\n';
		const after = edit(source, '> a\n>\n>\n>\n>\n', '> a\n>\n> x\n>\n');
		expect(divergence(source, to(after)).failure).toBeNull();
	});

	// Rows that read a few children: far less than the container.
	it.each([
		[
			'a paste inside a list',
			ITEMS(40),
			(s: string) => edit(s, 'item 20\n', 'item 20one\n  two\n')
		],
		['a removal over list items', ITEMS(40), (s: string) => edit(s, 'em 20\n- item 21\n- it', '')],
		[
			'a paste inside a quote',
			QUOTED(40),
			(s: string) => edit(s, 'line 20\n', 'line 20one\n> two\n')
		],
		[
			'a removal over quote lines',
			QUOTED(40),
			(s: string) => edit(s, 'ne 20\n>\n> line 21\n>\n> li', '')
		],
		['a paste into a table cell', ROWS(40), (s: string) => edit(s, '| r 20 |', '| r 20 one |')],
		// The head says how many columns there are, so a body row with more or fewer reads as it would.
		[
			'a table row gaining a cell',
			ROWS(40),
			(s: string) => edit(s, '| r 20 | x |', '| r 20 | x | y |')
		],
		['a table row losing a cell', ROWS(40), (s: string) => edit(s, '| r 20 | x |', '| r 20 |')],
		[
			'the last item, a block below',
			ITEMS(40) + '\npara\n',
			(s: string) => edit(s, 'item 39', 'item 39!')
		],
		['the last item, to the end', ITEMS(40), (s: string) => edit(s, 'item 39', 'item 39!')],
		// The next line flips between continuing the item and opening one, by its indent.
		[
			'an item line indented into the one above',
			ITEMS(40),
			(s: string) => edit(s, '- item 21', '  item 21')
		],
		[
			'a continuation line out-dented into an item',
			edit(ITEMS(40), '- item 21\n', '- item 21\n  more\n'),
			(s: string) => edit(s, '  more', '- more')
		],
		// A lazy line as the first line after the run's start child.
		[
			'a lazy line after the start child',
			edit(QUOTED(40), '> line 20\n', '> line 20\nlazy\n'),
			(s: string) => edit(s, 'line 21', 'line 21!')
		]
	])('%s reads a few children', (_name, source, after) => {
		const { failure, parsed, size } = divergence(source, to(after(source)));
		expect(failure).toBeNull();
		expect(parsed).toBeLessThan(size / 4);
	});

	// Rows that fall back to the top-level window: the change may reach past its run.
	it.each([
		[
			'a `$$` opened in an item, closed in the next',
			ITEMS(40),
			(s: string) => edit(s, '- item 20', '- $$')
		],
		['a fence opened in a quote line', QUOTED(40), (s: string) => edit(s, 'line 20', '```')],
		[
			'a `$$` closer taken',
			edit(QUOTED(40), '> line 20\n', '> $$\n> x\n> $$\n'),
			(s: string) => edit(s, '> $$\n>\n', '')
		],
		[
			'a directive closer written',
			':::note\n' + QUOTED(40) + '\n',
			(s: string) => edit(s, 'line 20', ':::')
		],
		['the first item', ITEMS(40), (s: string) => edit(s, '- item 0', '1. item 0')],
		[
			'a blank line splitting the list',
			ITEMS(40),
			(s: string) => edit(s, '- item 21', '\n- item 21')
		],
		[
			'a nested quote at the run start',
			edit(QUOTED(40), '> line 19\n', '> > line 19\n'),
			(s: string) => edit(s, 'line 20', 'line 20!')
		],
		['the table delimiter line', ROWS(40), (s: string) => edit(s, '| - | - |', '| :- | - |')],
		[
			'a `$$` line in a table, its closer a row far below',
			edit(ROWS(40), '| r 35 | x |', '$$'),
			(s: string) => edit(s, '| r 20 | x |', '$$')
		],
		// A closer written far below its opener: nothing in the run's own reading waits on it.
		[
			'a directive closer in a table, its opener a row far above',
			edit(ROWS(40), '| r 5 | x |', ':::note'),
			(s: string) => edit(s, '| r 30 | x |', ':::')
		],
		[
			'a directive closer in a quote, its opener a line far above',
			edit(QUOTED(40), '> line 5\n', '> :::note\n'),
			(s: string) => edit(s, '> line 30', '> :::')
		],
		// Only a list opening at 1 interrupts a paragraph, so the paragraph takes in every item.
		[
			'the first item renumbered under a paragraph',
			'para\n' + Array.from({ length: 40 }, (_, i) => `${i + 1}. item ${i}\n`).join(''),
			(s: string) => edit(s, '1. item 0', '2. item 0')
		],
		// A change at the last child makes the paragraph below a lazy line of the quote.
		[
			'a paragraph below the container absorbed',
			'> first\n> - a\nb\n',
			(s: string) => edit(s, '> - a', '> a')
		],
		[
			'a CRLF closer finished mid-line',
			':::note\r\n' + QUOTED(10).replace(/\n/g, '\r\n') + '::\r\n',
			(s: string) => edit(s, '::\r\n', ':::\r\n')
		]
	])('%s takes the top-level window', (_name, source, after) => {
		const { failure } = divergence(source, to(after(source)));
		expect(failure).toBeNull();
	});
});
