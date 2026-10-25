// @vitest-environment jsdom
// Writes the rows a rebuilt fix-up is checked against: every call the editor makes into the
// commit's fix-up steps while block edits and block moves run over short strings, the behavior
// corpus and generated documents, with no plugin installed. Runs only with `FIXUP_ROWS=<file>`.
import { it, vi } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import fc from 'fast-check';
import { serialize } from '#lib/core/serializer.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { endTypingBatchesForTests } from '#lib/editor-actions/commit/text-batch.js';
import { makeReorderHarness } from '#lib/test/editor-actions/reorder-harness.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { parse } from '#lib/core/parser.js';
import { enumerateStrings } from '../gfm-conformance/corpus';
import { EXHAUSTIVE_ALPHABET } from '../exhaustive/alphabet';
import {
	EDITS,
	judge,
	leafAt,
	leafPaths,
	opened,
	reloadDivergence,
	type Edit
} from '../exhaustive/edit-driver';
import {
	FLUSH_JOIN_DOCUMENTS,
	LONG_DOCUMENTS,
	SMALL_DOCUMENTS,
	blockPairs
} from '../behavior/corpus';
import { arbBlankSeparatedGfmDoc, arbRespelledContainerDoc } from '../invariants/arbitraries/gfm';
import { beginEdit, capRowsPerShape, endEdit, rowCount, writeRowsTo } from './recorder';

vi.mock('#lib/tree-operations/settle.js', async (load) =>
	(await import('./recorder')).wrapSettle(await load())
);
vi.mock('#lib/tree-operations/neighbour-merge.js', async (load) =>
	(await import('./recorder')).wrapMerge(await load())
);
vi.mock('#lib/tree-operations/open-tail.js', async (load) =>
	(await import('./recorder')).wrapOpenTail(await load())
);
vi.mock('#lib/tree-operations/keep-one-block.js', async (load) =>
	(await import('./recorder')).wrapKeepOneBlock(await load())
);

const SEED = 20261024;

type Offsets = (end: number, path: number[], paths: number[][]) => number[];

/** Every edit at the offsets `pick` chooses in each leaf of `source`. */
async function editsOver(source: string, pick: Offsets, edits = EDITS) {
	const blocks = opened(source).children;
	const paths = leafPaths(blocks);
	for (const path of paths) {
		const end = trimTrailingLineEnding(leafAt(blocks, path).raw).length;
		for (const offset of pick(end, path, paths)) {
			for (const edit of edits) {
				beginEdit();
				const failure = await judge(source, path, offset, edit);
				endEdit(failure === null);
			}
		}
	}
}

/** Each block of `source` moved up and down, and with `nested`, each block one level into a
 *  container too. */
async function movesOver(source: string, nested = true) {
	const blocks = opened(source).children;
	const paths = blocks.flatMap((block, i) => [
		[i],
		...(nested ? (block.children ?? []) : []).map((_, j) => [i, j])
	]);
	for (const path of paths) {
		for (const step of [-1, 1] as const) {
			beginEdit();
			endEdit(await moveCameOut(source, path, step));
		}
	}
}

async function moveCameOut(source: string, path: number[], step: 1 | -1): Promise<boolean> {
	const h = makeReorderHarness(opened(source));
	try {
		await h.reorder.nudgeReorderUnit(path, step);
		const edited = serialize(h.doc);
		const fired = takeDevWarns().length > 0;
		return !fired && (edited === '' || reloadDivergence(h.doc, edited) === null);
	} catch {
		return false;
	} finally {
		takeDevWarns();
		endTypingBatchesForTests();
	}
}

const every: Offsets = (end) => Array.from({ length: end + 1 }, (_, i) => i);
const edges: Offsets = (end) => [...new Set([0, Math.floor(end / 2), end])];
/** The two sides of the join between a pair's blocks: the first block's last line end, the
 *  second's first line start. */
const atJoin: Offsets = (end, path, paths) => {
	if (path === paths.filter((p) => p[0] === 0).at(-1)) return [end];
	return path === paths.find((p) => p[0] === 1) ? [0] : [];
};
/** A document's text with every letter an `x`, so its shapes ship and its words (about this
 *  editor's own code) don't; a lowercase HTML tag keeps its name, which decides how it reads. */
const neutralText = (text: string): string =>
	text.replace(
		/(<\/?[a-z][a-z0-9-]*)|[A-Za-z]/g,
		(match, tag?: string) => tag ?? (match === match.toUpperCase() ? 'X' : 'x')
	);

/** A long document's pair past this many bytes repeats shapes the shorter pairs already have. */
const PAIR_BYTES = 1500;
/** Generated documents differ mostly in their text, so a few rows of each shape cover them. */
const GENERATED_PER_SHAPE = 3;
const sample = <T>(arb: fc.Arbitrary<T>, numRuns: number) =>
	fc.sample(arb, { numRuns, seed: SEED });

it('records the fix-up rows', async () => {
	const out = process.env.FIXUP_ROWS;
	if (!out) return;
	writeFileSync(out, '');
	writeRowsTo((line) => appendFileSync(out, line + '\n'));
	const progress = (phase: string) => appendFileSync(`${out}.log`, `${phase}: ${rowCount()}\n`);
	const short = [...enumerateStrings(EXHAUSTIVE_ALPHABET, 1, 3)].filter(
		(source, i) => source.length < 3 || i % 5 === 0
	);
	for (const source of short) await editsOver(source, every);
	progress('short strings');
	const corpus = [...Object.values(SMALL_DOCUMENTS), ...Object.values(FLUSH_JOIN_DOCUMENTS)];
	for (const source of corpus) {
		await editsOver(source, every);
		await movesOver(source);
	}
	progress('small documents');
	const neutral = LONG_DOCUMENTS.map((doc) => ({ ...doc, source: neutralText(doc.source) }));
	for (const pair of neutral.flatMap(blockPairs)) {
		if (pair.source.length > PAIR_BYTES) continue;
		await editsOver(pair.source, atJoin);
		await movesOver(pair.source, false);
	}
	progress('long document pairs');
	capRowsPerShape(GENERATED_PER_SHAPE);
	const generated = [
		...sample(arbBlankSeparatedGfmDoc, 150),
		...sample(arbRespelledContainerDoc, 150)
	];
	for (const source of generated) {
		await editsOver(source, edges);
		await movesOver(source);
	}
	progress('generated documents');
}, 3_600_000);

/** The gestures behind the join rules the spec states, each recorded as rows named after it:
 *  a block between two others deleted or moved away, a block or a list placed beside another. */
const NAMED: [string, (h: Harnesses) => Promise<unknown>, string][] = [
	...['a\n# h\nb\n', '> q\n# h\np\n', 'a\n# h\n| A | B |\n| - | - |\n', 'a\n# h\n---\n'].flatMap(
		(source): [string, (h: Harnesses) => Promise<unknown>, string][] => [
			[
				`delete the block between: ${JSON.stringify(source)}`,
				(h) => h.top.actions.deleteBlock(1, 'keyless'),
				source
			],
			[
				`move the block between up: ${JSON.stringify(source)}`,
				(h) => h.reorder.reorder.nudgeReorderUnit([1], -1),
				source
			]
		]
	),
	[
		'delete the block between a list and indented code',
		(h) => h.top.actions.deleteBlock(1, 'keyless'),
		'- a\n\n# h\n\n      code\n'
	],
	...['x\n# h\n\n| A |\n| - |\n', 'x\n# h\n\n---\n', 'x\n# h\n\nb\n'].map(
		(source): [string, (h: Harnesses) => Promise<unknown>, string] => [
			`move a block up under a paragraph: ${JSON.stringify(source)}`,
			(h) => h.reorder.reorder.nudgeReorderUnit([2], -1),
			source
		]
	),
	[
		'paste a list after the text on a line',
		(h) =>
			h.top.actions.replaceBlock(0, parse('intro\n- [ ] x\n').children, undefined, {
				snapshotOffset: 0
			}),
		'intro\n\n- [ ] fold\n'
	],
	[
		'move a list beside a list',
		(h) => h.reorder.reorder.nudgeReorderUnit([2], -1),
		'- c\n\npara\n\n- x\n'
	]
];

/** The edits behind the known defects the rebuild must fix, each the shortest input that reaches
 *  its defect (`exhaustive/known-failures.ts`). */
const MUST_FIX: [string, string, number[], number, string][] = [
	['must-fix 1: a newline typed before a whitespace-only last line', '# ', [0], 1, 'type "\\n"'],
	[
		'must-fix 2: a delete that empties the line under a marker-only quote line',
		'>\n#',
		[1],
		0,
		'delete after'
	],
	['must-fix 3: a split above an unended whitespace-only last line', '#\n ', [0], 1, 'split'],
	[
		'must-fix 4: a merge out of a quote above an unended whitespace-only last line',
		'>\n ',
		[0, 0],
		0,
		'delete before'
	],
	['must-fix 5: a split on an unclosed fence opener', '```', [0], 3, 'split'],
	[
		'must-fix 6: the third backtick of a fence typed above a blank line',
		'``\n\n',
		[0],
		0,
		'type "`"'
	]
];

interface Harnesses {
	top: ReturnType<typeof makeTopHarness>;
	reorder: ReturnType<typeof makeReorderHarness>;
}

it('records the named example rows', async () => {
	const out = process.env.FIXUP_ROWS;
	if (!out) return;
	const named = `${out}.named`;
	writeFileSync(named, '');
	writeRowsTo((line) => appendFileSync(named, line + '\n'));
	for (const [label, run, source] of NAMED) {
		const h = { top: makeTopHarness(source), reorder: makeReorderHarness(source) };
		beginEdit(label);
		await run(h);
		takeDevWarns();
		endEdit(true);
	}
	for (const [label, source, path, offset, editName] of MUST_FIX) {
		beginEdit(label);
		await judge(
			source,
			path,
			offset,
			EDITS.find((edit) => edit.name === editName)!
		);
		endEdit(true);
	}
	// A re-read the editor's cheap ask skips here does not read back, so the rows pin the outcome.
	const nested = opened(EMPTIED_NESTED);
	for (const path of leafPaths(nested.children)) {
		beginEdit(`empty each block of a nested list: [${path}]`);
		endEdit((await judge(EMPTIED_NESTED, path, 0, EMPTY)) === null);
	}
});

const EMPTIED_NESTED =
	'- [ ] ```\n      ```\n      - # word\n        \n        \n        > # foo@bar.com\n\n> > | H0 |\n> > | --- |\n';

/** A block's bytes written as its line ending alone. */
const EMPTY: Edit = {
	name: 'empty',
	apply: (blockEdit, index, node) =>
		blockEdit.updateBlockContent(
			index,
			/\r?\n$/.exec(node.raw)?.[0] ?? '',
			'authored',
			'join-typing',
			0,
			0
		)
};
