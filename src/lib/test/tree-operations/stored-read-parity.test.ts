// @vitest-environment jsdom
// Miss-analysis: the join's container check read a field the parse result lacks, so it refused
// every candidate under a list marker; the fuzzer took any refusal as no worse than the literal
// edit, ran its caret-edge gestures on top-level blocks only, and no unit gave the join a container.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseInline, getContentRange } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode, Document } from '$lib/core/nodes';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { createSharingState } from '$lib/tree-operations/sharing';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { rangeDelete } from '$lib/selection/range-delete';
import { coverRange, rangeCoverage } from '$lib/selection/range-coverage';
import { replaceRangeInLeaf } from '$lib/tree-operations/leaf-range';
import { resolveEdgeDeletion } from '$lib/components/blocks/text/construct-edge-delete';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { makeContainerHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';

// A live cut under a container marker writes the text bytes the same cut writes at the top level,
// and leaves a tree a reload of those bytes reads back unchanged.

beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
beforeEach(() => installPlugins([footnotesPlugin()]));
afterAll(() => __resetLiveJoinSeamCleanerForTests());

const LIVE = fixtureReading({}, 'live');

interface Container {
	name: string;
	/** One or two blocks' text, written as the container holds them. */
	wrap(blocks: readonly string[]): string;
	/** The path of the first block's leaf, and of the second block's. */
	first: number[];
	second: number[];
}

const CONTAINERS: Container[] = [
	{ name: 'the top level', wrap: (b) => b.join('\n\n') + '\n', first: [0], second: [1] },
	{
		name: 'a quote',
		wrap: (b) => b.map((line) => `> ${line}`).join('\n>\n') + '\n',
		first: [0, 0],
		second: [0, 1]
	},
	{
		name: 'a list item',
		wrap: (b) => b.map((line) => `- ${line}`).join('\n') + '\n',
		first: [0, 0, 0],
		second: [0, 1, 0]
	},
	{
		name: 'a task item',
		wrap: (b) => b.map((line) => `- [ ] ${line}`).join('\n') + '\n',
		first: [0, 0, 0],
		second: [0, 1, 0]
	},
	{
		name: 'an ordered item',
		wrap: (b) => b.map((line, i) => `${i + 1}. ${line}`).join('\n') + '\n',
		first: [0, 0, 0],
		second: [0, 1, 0]
	},
	{
		name: 'a nested item',
		wrap: (b) => '- p\n' + b.map((line) => `  - ${line}`).join('\n') + '\n',
		first: [0, 0, 1, 0, 0],
		second: [0, 0, 1, 1, 0]
	},
	{
		name: 'a footnote definition',
		wrap: (b) =>
			`[^1]: ${b[0]}\n` +
			b
				.slice(1)
				.map((line) => `\n    ${line}\n`)
				.join(''),
		first: [0, 0],
		second: [0, 1]
	}
];

/** Writes `raw` into the leaf at `path` through the block-edit route its holder's block uses. */
async function writeLeaf(source: string, path: number[], raw: string): Promise<Document> {
	if (path.length === 1) {
		const h = makeTopHarness(source, { reading: LIVE });
		await h.actions.updateBlockContent(path[0], raw, 'authored', 0, 0);
		return h.deps.doc;
	}
	const h = makeContainerHarness(source, path.slice(0, -1), { reading: LIVE });
	await h.bundle.blockEdit.updateBlockContent(path[path.length - 1], raw, 'authored', 0, 0);
	return h.deps.doc;
}

/** The two things a row checks: the bytes, and that a reload reads the tree the write left. */
function expectParity(doc: Document, container: Container, text: string): void {
	expect(serialize(doc)).toBe(container.wrap([text]));
	expect(describeConvergence(doc)).toBeNull();
}

// ── The routes ───────────────────────────────────────────────────────────────

/** A selection deleted or typed over, read back where the leaf keeps its bytes. */
async function rangeEdit(
	container: Container,
	text: string,
	range: { start: number; end: number },
	typed: string
): Promise<Document> {
	const source = container.wrap([text]);
	const doc = parse(source);
	const node = nodeAt(doc, container.first) as CstNode;
	const store = storedAsAt(doc, container.first, LIVE);
	const { raw } = replaceRangeInLeaf(node, range, typed, store);
	return writeLeaf(source, container.first, raw);
}

/** A cross-block delete from inside `bc` to inside `ef`, both endpoints in the container. */
function crossBlockDelete(container: Container): Document {
	const doc = parse(container.wrap(['a **bc**', 'd *ef* g']));
	const range = coverRange(
		doc,
		{ path: container.first, offset: 5 },
		{ path: container.second, offset: 5 }
	);
	rangeDelete(doc, rangeCoverage(doc, range), createSharingState(), LIVE, 'Backspace');
	return doc;
}

/** Backspace just after `a` in `**a** b`: the key takes the `a` and the pair it empties. */
async function edgeBackspace(container: Container): Promise<Document | null> {
	const source = container.wrap(['**a** b']);
	const doc = parse(source);
	const node = nodeAt(doc, container.first) as CstNode;
	const display = trimTrailingLineEnding(node.raw);
	const deletion = resolveEdgeDeletion({
		display,
		content: getContentRange(node),
		caret: 3,
		direction: 'backward',
		screen: screenVisibility('live', { chromePaints: false }),
		inlines: parseInline(display, 0, display.length),
		store: storedAsAt(doc, container.first, LIVE)
	});
	if (!deletion || 'swallow' in deletion) return null;
	return writeLeaf(source, container.first, deletion.raw + '\n');
}

describe.each(CONTAINERS)('a live cut in $name', (container) => {
	// From inside `ab` past its hidden closer: `b** c` goes, and so does the stranded opener.
	it('a deleted selection drops the runs it strands', async () => {
		expectParity(
			await rangeEdit(container, '**ab** cd', { start: 3, end: 8 }, ''),
			container,
			'ad'
		);
	});

	it('a typed-over selection drops them too', async () => {
		const doc = await rangeEdit(container, '**ab** cd', { start: 3, end: 8 }, 'x');
		expectParity(doc, container, 'axd');
	});

	it('a cross-block delete joins without a run on screen', () => {
		expectParity(crossBlockDelete(container), container, 'a b g');
	});

	// Both runs go with the construct the cut emptied; the space left against a list marker widens
	// the marker on reload, and the tree takes the wider marker at the write, as the reload does.
	it('a cut emptying the first construct leaves the space and no run', async () => {
		const doc = await rangeEdit(container, '**a b** c', { start: 2, end: 5 }, '');
		expectParity(doc, container, ' c');
	});

	it('Backspace at a hidden run takes the character and the pair it empties', async () => {
		const doc = await edgeBackspace(container);
		expect(doc).not.toBeNull();
		expectParity(doc!, container, ' b');
	});
});
