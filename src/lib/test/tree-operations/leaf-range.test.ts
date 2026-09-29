// @vitest-environment jsdom
// Every in-leaf range replace and the merge's join write the bytes the functions they replaced
// wrote: rows drawn from those, and the merge checked against every built-in kind pair.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { displayLength, ownTrailingLineEnding, trimTrailingLineEnding } from '$lib/core/lines';
import { isProseKind } from '$lib/core/inline';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt, storedAsIn } from '$lib/tree-operations/stored-as';
import { cleanJoinedRaw, joinLeaves, replaceRangeInLeaf } from '$lib/tree-operations/leaf-range';
import { joinKeepingSuffix } from '$lib/tree-operations/structural-suffix';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import {
	getAllRegisteredKinds,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { fixtureReading } from '../harness/fixture-grammar';
import { testLeaf } from '../harness/test-kinds';

beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterAll(() => __resetLiveJoinSeamCleanerForTests());

interface Row {
	source: string;
	leaf: number[];
	mode: 'live' | 'source';
	range: [number, number];
	typed: string;
	/** The leaf's bytes after the edit, less the line ending it keeps. */
	display: string;
	caret: number;
	matchesBrowserEdit: boolean;
}

const ROWS: Row[] = [
	// The join cleaned: a delimiter run the range stranded goes.
	{
		source: '***a***\n',
		leaf: [0],
		mode: 'live',
		range: [3, 4],
		typed: '',
		display: '',
		caret: 0,
		matchesBrowserEdit: false
	},
	{
		source: '__a__\n===\n',
		leaf: [0],
		mode: 'live',
		range: [0, 2],
		typed: '😀',
		display: '😀a\n===',
		caret: 2,
		matchesBrowserEdit: false
	},
	{
		source: '- ***a**b*\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [0, 3],
		typed: ' ',
		display: ' ab',
		caret: 1,
		matchesBrowserEdit: false
	},
	{
		source: '## *a*)  ##\n',
		leaf: [0],
		mode: 'live',
		range: [3, 5],
		typed: '',
		display: '## )  ##',
		caret: 3,
		matchesBrowserEdit: false
	},
	{
		source: '- [ ] 42`a`\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [2, 3],
		typed: '😀',
		display: '42😀a',
		caret: 4,
		matchesBrowserEdit: false
	},
	{
		source: '*****a*****汉字\n',
		leaf: [0],
		mode: 'live',
		range: [1, 3],
		typed: '~',
		display: '*~**a***汉字',
		caret: 2,
		matchesBrowserEdit: false
	},
	{
		source: '- **a**\n  ===\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [2, 3],
		typed: '',
		display: '\n===',
		caret: 0,
		matchesBrowserEdit: false
	},
	{
		source: '- [ ] ## `a` ##\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [4, 6],
		typed: '',
		display: '##  ##',
		caret: 3,
		matchesBrowserEdit: false
	},
	{
		source: '- ## *a***b** ##\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [5, 8],
		typed: 'a*b',
		display: '## aa*bb ##',
		caret: 7,
		matchesBrowserEdit: false
	},
	{
		source: '- **a***b*\n  ===\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [2, 3],
		typed: '**',
		display: '***b*\n===',
		caret: 2,
		matchesBrowserEdit: false
	},
	{
		source: '## [**b**](u) ##\n',
		leaf: [0],
		mode: 'live',
		range: [4, 13],
		typed: '**',
		display: '## ** ##',
		caret: 5,
		matchesBrowserEdit: false
	},
	{
		source: '- [ ] ém**a***b*\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [1, 10],
		typed: '',
		display: 'e',
		caret: 1,
		matchesBrowserEdit: false
	},
	{
		source: '| h |\n| - |\n| *a* |\n',
		leaf: [0, 1, 0],
		mode: 'live',
		range: [0, 2],
		typed: '~',
		display: '~',
		caret: 1,
		matchesBrowserEdit: false
	},
	{
		source: '| h |\n| - |\n| *a*)  |\n',
		leaf: [0, 1, 0],
		mode: 'live',
		range: [1, 3],
		typed: '~',
		display: '~)',
		caret: 1,
		matchesBrowserEdit: false
	},
	// The typed text refills the pair the range emptied, so nothing is stranded.
	{
		source: '**a** b\n',
		leaf: [0],
		mode: 'live',
		range: [2, 3],
		typed: 'x',
		display: '**x** b',
		caret: 3,
		matchesBrowserEdit: true
	},
	{
		source: '- **a** b\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [2, 3],
		typed: 'x',
		display: '**x** b',
		caret: 3,
		matchesBrowserEdit: true
	},
	{
		source: '| h |\n| - |\n| **a** b |\n',
		leaf: [0, 1, 0],
		mode: 'live',
		range: [2, 3],
		typed: 'x',
		display: '**x** b',
		caret: 3,
		matchesBrowserEdit: true
	},
	// Cut back from a hidden heading suffix the user never saw.
	{
		source: '&\n===\n',
		leaf: [0],
		mode: 'live',
		range: [0, 5],
		typed: '',
		display: '\n===',
		caret: 0,
		matchesBrowserEdit: false
	},
	{
		source: '\\*\n===\n',
		leaf: [0],
		mode: 'live',
		range: [0, 5],
		typed: '**',
		display: '**\n===',
		caret: 2,
		matchesBrowserEdit: false
	},
	// A caret past the closing run stays there: only a drawn range is cut back.
	{
		source: '##  ##\n',
		leaf: [0],
		mode: 'live',
		range: [6, 6],
		typed: 'x',
		display: '##  ##x',
		caret: 7,
		matchesBrowserEdit: true
	},
	{
		source: '- ##  ##\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [2, 4],
		typed: '😀',
		display: '##😀 ##',
		caret: 4,
		matchesBrowserEdit: false
	},
	{
		source: '- ## x ##\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [4, 5],
		typed: '',
		display: '## x ##',
		caret: 4,
		matchesBrowserEdit: false
	},
	// Nothing to clean: the plain splice, which the browser makes too.
	{
		source: ' \n',
		leaf: [0],
		mode: 'source',
		range: [0, 1],
		typed: 'a*b',
		display: 'a*b',
		caret: 3,
		matchesBrowserEdit: true
	},
	{
		source: '\\\\\n',
		leaf: [0],
		mode: 'live',
		range: [1, 2],
		typed: '**',
		display: '\\**',
		caret: 3,
		matchesBrowserEdit: true
	},
	{
		source: '~~a~~\n',
		leaf: [0],
		mode: 'source',
		range: [0, 2],
		typed: '',
		display: 'a~~',
		caret: 0,
		matchesBrowserEdit: true
	},
	{
		source: '- *a*x\n',
		leaf: [0, 0, 0],
		mode: 'source',
		range: [1, 2],
		typed: '',
		display: '**x',
		caret: 1,
		matchesBrowserEdit: true
	},
	{
		source: '- [ ] a\n',
		leaf: [0, 0, 0],
		mode: 'source',
		range: [0, 1],
		typed: '`',
		display: '`',
		caret: 1,
		matchesBrowserEdit: true
	},
	{
		source: '| h |\n| - |\n| 😀 |\n',
		leaf: [0, 1, 0],
		mode: 'live',
		range: [0, 2],
		typed: '😀',
		display: '😀',
		caret: 2,
		matchesBrowserEdit: true
	},
	{
		source: '| h |\n| - |\n| 汉字 |\n',
		leaf: [0, 1, 0],
		mode: 'live',
		range: [0, 2],
		typed: 'a*b',
		display: 'a*b',
		caret: 3,
		matchesBrowserEdit: true
	},
	{
		source: '| h |\n| - |\n| x |\n',
		leaf: [0, 1, 0],
		mode: 'source',
		range: [0, 1],
		typed: '~',
		display: '~',
		caret: 1,
		matchesBrowserEdit: true
	},
	{
		source: '| h |\n| - |\n| ém |\n',
		leaf: [0, 1, 0],
		mode: 'source',
		range: [0, 1],
		typed: '`',
		display: '`m',
		caret: 1,
		matchesBrowserEdit: true
	},
	{
		source: '- x\n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [0, 1],
		typed: 'x',
		display: 'x',
		caret: 1,
		matchesBrowserEdit: true
	},
	{
		source: '- foo\n',
		leaf: [0, 0, 0],
		mode: 'source',
		range: [2, 3],
		typed: '**',
		display: 'fo**',
		caret: 4,
		matchesBrowserEdit: true
	},
	{
		source: '- [ ] ) \n',
		leaf: [0, 0, 0],
		mode: 'live',
		range: [0, 2],
		typed: 'a*b',
		display: 'a*b',
		caret: 3,
		matchesBrowserEdit: true
	}
];

describe('replaceRangeInLeaf', () => {
	it.each(ROWS)('$mode $source [$range] with $typed', (row) => {
		const doc = parse(row.source);
		const node = nodeAt(doc, row.leaf) as CstNode;
		const store = storedAsAt(doc, row.leaf, fixtureReading({}, row.mode));
		const [start, end] = row.range;
		const edit = replaceRangeInLeaf(node, { start, end }, row.typed, store);
		expect({
			display: trimTrailingLineEnding(edit.raw),
			caret: edit.caret,
			matchesBrowserEdit: edit.matchesBrowserEdit
		}).toEqual({
			display: row.display,
			caret: row.caret,
			matchesBrowserEdit: row.matchesBrowserEdit
		});
		expect(edit.raw.endsWith(ownTrailingLineEnding(node.raw))).toBe(true);
	});
});

// ── The merge ────────────────────────────────────────────────────────────────

/** A block of every built-in kind, plus the shapes whose own write rule could move a byte. */
function everyKindBlock(): CstNode[] {
	const sources = getAllRegisteredKinds().flatMap(
		(kind) => tryGetBlockKindDescriptor(kind)?.conformanceFixture ?? []
	);
	sources.push('# a **b** #\n', '**a** b\n', '~~~\ny\n', '*a*\n---\n', '<div>\nh\n</div>\n');
	const blocks = sources.flatMap((source) => parse(source).children);
	return [
		...blocks,
		...parse('| h |\n| - |\n| c\\|d **e** |\n').children[0].children![1].children!
	];
}

describe('joinLeaves across two leaves', () => {
	// The absorbed kind's own write rule runs on its bytes; on every built-in pair it moves none.
	it('writes the join the merge wrote, for every built-in kind pair', () => {
		const blocks = everyKindBlock();
		const moved: string[] = [];
		for (const mode of ['live', 'source'] as const) {
			const reading = fixtureReading({}, mode);
			for (const head of blocks.filter((block) => isProseKind(block.kind))) {
				for (const tail of blocks) {
					const store = storedAsIn(
						{ owner: undefined, children: [head], lineEnding: '\n' },
						0,
						reading
					);
					const at = displayLength(head.raw);
					const plain = joinKeepingSuffix(head, at, tail, 0, (bytes) => bytes);
					const want = cleanJoinedRaw({
						mergedRaw: plain.raw,
						seam: plain.start,
						start: { node: head, offset: plain.start },
						end: { node: tail, offset: plain.end },
						typed: '',
						store
					});
					const got = joinLeaves(
						{ node: head, offset: at },
						{ node: tail, offset: 0 },
						'',
						store,
						'\n'
					);
					if (got.raw !== want.raw || got.seam !== want.seam) {
						moved.push(`${mode} ${head.kind} + ${tail.kind}: ${JSON.stringify(got.raw)}`);
					}
				}
			}
		}
		expect(moved).toEqual([]);
	});
});

// No built-in kind's write rule moves a byte of a merge, so a kind whose rule does shows it runs.
describe('joinLeaves runs the absorbed kind’s write rule', () => {
	it('on the bytes it takes from the other leaf', () => {
		const kind = testLeaf('shouting-leaf', {
			rawWrite: { normalize: (raw) => raw.toUpperCase(), mapOffset: (_raw, offset) => offset }
		});
		const head = parse('x\n').children[0];
		const tail = { kind, leadingTrivia: '', raw: 'abc\n' } as CstNode;
		const store = storedAsIn(
			{ owner: undefined, children: [head], lineEnding: '\n' },
			0,
			fixtureReading()
		);
		const joined = joinLeaves(
			{ node: head, offset: 1 },
			{ node: tail, offset: 0 },
			'',
			store,
			'\n'
		);
		expect(joined).toEqual({ raw: 'xABC\n', seam: 1 });
	});
});
