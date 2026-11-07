// @vitest-environment jsdom
// G1.188: until range stage 3, a cut writes the range-edit core's clipboard and today's removal
// deletes, so the words it writes are the words the removal takes, save the named classes below.
// Miss-analysis: GH #636; the copy and the delete each had suites of their own, and none ran the
// two over one range to compare what the cut puts on the clipboard with what it removes.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { sharedPrefixLength, sharedSuffixLength } from '#lib/core/written-span.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost, type Mode } from '#lib/range-edit/host.js';
import { isReservedChromeChild, rowContentRange } from '#lib/schema/reserved-chrome.js';
import { rangeDelete } from '../../selection/cross-block/range-delete/range-delete';
import { rangeBytes } from '#lib/selection/range-bytes.js';
import { rangeClipboard } from '#lib/selection/range-clipboard.js';
import { coverRange, rangeCoverage } from '../../selection/range-coverage';
import { cellPoint, type SelectionPoint } from '../../selection/primitives';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { fixtureReading } from '../harness/fixture-grammar';
import { registerChromePluginsForTests } from './chrome-plugins';
import { writtenBelow } from '#lib/test/harness/settle-funnel.js';
import { readOf, startsBelowTableHead } from '../range-edit/expected';
import { checkHost } from '../range-edit/test-host';

interface CutCase {
	source: string;
	mode: Mode;
	start: SelectionPoint;
	end: SelectionPoint;
}

const TABLE_HEAD = 'the copy carries the table header both removals keep';
const TITLE_START = 'the copy carries the container a title row it starts in opens';
const TITLE_EDGE = 'the copy carries the empty opening of a container whose title it ends at';
const TAKES_MORE = 'today’s removal takes words the core’s removal leaves';
const LEAVES_MORE = 'today’s removal leaves words the core’s removal takes';

/** Each class with a cut that must keep parting that way; the first two are law 3's declared
 *  exceptions, the third law 10's open edge question, the last two range stage 3's to close. */
const DIVERGENCES: Record<string, CutCase> = {
	[TABLE_HEAD]: {
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n',
		mode: 'source',
		start: cellPoint([0], 2),
		end: { path: [1], offset: 3 }
	},
	[TITLE_START]: {
		source: '<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n\nAAAA\n',
		mode: 'source',
		start: { path: [0, 0], offset: 1 },
		end: { path: [1], offset: 2 }
	},
	[TITLE_EDGE]: {
		source: 'MMMM\n\n<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n',
		mode: 'source',
		start: { path: [0], offset: 1 },
		end: { path: [1, 0], offset: 0 }
	},
	[TAKES_MORE]: {
		source: 'a\n# h\nb\n',
		mode: 'source',
		start: { path: [0], offset: 0 },
		end: { path: [1], offset: 3 }
	},
	[LEAVES_MORE]: {
		source: '> word\n1. n\n> - x\n\n-\t- x\n',
		mode: 'live',
		start: { path: [0, 0], offset: 0 },
		end: { path: [2, 0, 0, 0], offset: 1 }
	}
};

/** The letters and digits of `text`, its containers' line markers (a list number, an alert's
 *  type, a footnote label) aside. */
const words = (text: string) =>
	text
		.replace(/\[\^[^\]]*\]:|\[![A-Za-z]+\]/g, '')
		.replace(/(^|\n)[ \t>]*(?:\d{1,9}[.)])?/g, '$1')
		.replace(/[^\p{L}\p{N}]/gu, '');

/** The words `left` lacks of `source`, as one run: a removal deletes one span and joins. */
function wordsTaken(source: string, left: string): string {
	const [a, b] = [words(source), words(left)];
	const head = sharedPrefixLength(a, b, Math.min(a.length, b.length));
	const tail = sharedSuffixLength(a, b, Math.min(a.length, b.length) - head);
	return a.slice(head, a.length - tail);
}

/** What the cut writes, and the words today's removal and the core's removal each take. */
function cutLegs(c: CutCase) {
	const doc = parse(c.source);
	const reading = fixtureReading({}, c.mode);
	const coverage = rangeCoverage(doc, coverRange(doc, c.start, c.end));
	const source = serialize(doc);
	const written = rangeClipboard(doc, coverage, reading)?.text ?? '';
	const bytes = rangeBytes(doc, source, coverage)!;
	const core = editRange(source, bytes, 'cut', c.mode, rangeHost(reading, { source, tree: doc }));
	// Today's removal writes into the tree it reads, so it runs last.
	const today = writtenBelow(
		doc,
		(scope) => rangeDelete(doc, coverage, scope, reading, 'cut'),
		reading.grammar
	).newDoc;
	return {
		written: words(written),
		today: wordsTaken(source, serialize(today)),
		core: wordsTaken(source, core.source),
		from: bytes.from
	};
}

/** Whether `point` sits on a container's title row, at or before its title text when `atStart`. */
function onTitleRow(c: CutCase, point: SelectionPoint, atStart = false): boolean {
	const doc = parse(c.source);
	const parent = blockNodeAt(doc, point.path.slice(0, -1));
	if (!parent || !isReservedChromeChild(parent, point.path.at(-1)!)) return false;
	return !atStart || point.offset <= rowContentRange(parent).start;
}

/** The class a cut falls in: null where the clipboard holds what today's removal takes. */
function divergenceOf(c: CutCase): string | null {
	const legs = cutLegs(c);
	if (legs.written === legs.today) return null;
	if (legs.today !== legs.core) {
		if (legs.today.length === legs.core.length)
			return `unclassified: today's removal took ${legs.today}, the core's ${legs.core}`;
		return legs.today.length > legs.core.length ? TAKES_MORE : LEAVES_MORE;
	}
	const host = checkHost(fixtureReading({}, c.mode));
	if (startsBelowTableHead(readOf(host, c.source), legs.from, host)) return TABLE_HEAD;
	if (onTitleRow(c, c.start)) return TITLE_START;
	if (onTitleRow(c, c.end, true)) return TITLE_EDGE;
	return `unclassified: the copy wrote ${legs.written}, both removals took ${legs.core}`;
}

const CLASSES = [null, ...Object.keys(DIVERGENCES)];

// Every block's text is one capital letter repeated, so a block's words name it.
const CLOSED = '<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n';
const OPEN = '<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n';
const TABLE = '| TT | UU |\n| --- | --- |\n| VV | WW |\n';
const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The other end, per branch: prose, an open details' title row, a table's cell. */
const OTHER = {
	prose: { source: 'MMMM\n', before: point([0], 1), after: point([2], 1) },
	'title-line': { source: OPEN, before: point([0, 0], 1), after: point([2, 0], 1) },
	table: { source: TABLE, before: cellPoint([0], 2), after: cellPoint([2], 1) }
} as const;

const TITLE_OFFSETS = { 'offset 0': 0, inside: 1, end: 4 } as const;

beforeEach(registerChromePluginsForTests);

describe('a cut writes the words its removal takes, save the named classes', () => {
	it.each(Object.entries(DIVERGENCES))('%s: its repro still parts that way', (name, c) => {
		expect(divergenceOf(c)).toBe(name);
	});

	describe.each(['source', 'live'] as const)('in %s mode', (mode) => {
		describe.each(Object.entries(OTHER))('the other end in %s', (_, other) => {
			it.each(Object.entries(TITLE_OFFSETS))('a start on a closed title row at %s', (_, k) => {
				const source = 'AAAA\n\n' + CLOSED + '\n' + other.source;
				const c = { source, mode, start: point([1, 0], k), end: other.after };
				expect(CLASSES).toContain(divergenceOf(c));
			});

			it.each(Object.entries(TITLE_OFFSETS))('an end on a closed title row at %s', (_, k) => {
				const source = other.source + '\n' + CLOSED + '\nEEEE\n';
				const c = { source, mode, start: other.before, end: point([1, 0], k) };
				expect(CLASSES).toContain(divergenceOf(c));
			});
		});

		it('select-all over a document that is one closed details', () => {
			const c = { source: CLOSED, mode, start: point([0, 0], 0), end: point([0, 1], 4) };
			expect(divergenceOf(c)).toBeNull();
		});
	});
});
