// @vitest-environment jsdom
// Two paste edges typing can't reach: blocks pasted over a cut that leaves only stranded runs, and
// a pasted line's own ending where only a hidden closer follows it.
// Miss-analysis: every structural paste row cut a range with visible text left beside it, and every
// line-ending row pasted before visible text or at the bytes' very end.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { settleEditor } from '../../harness/settle';

const LIVE = fixtureReading({}, 'live');
const SOURCE = fixtureReading({}, 'source');

beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterAll(() => __resetLiveJoinSeamCleanerForTests());

/** Pastes `text` over `[start, end)` of the leaf at `leaf`: the document after, and what the leaf's
 *  own commit wrote when the paste stayed inline. */
async function paste(
	source: string,
	leaf: number[],
	[start, end]: number[],
	text: string,
	reading = LIVE
) {
	const { deps } = makeEditorActionsDeps(source, { reading });
	const blockEdit = makeStubBlockEdit();
	await pasteDispatch(
		{
			pastedText: text,
			targetPath: leaf,
			offset: start,
			preDelete: start === end ? undefined : { start, end }
		},
		pasteContext({
			doc: deps.doc,
			blockEdit,
			reading,
			controller: createPasteCoordinator(deps, createUndoController(deps))
		})
	);
	await settleEditor();
	const leafWrites = vi.mocked(blockEdit.updateBlockContent).mock.calls.map((call) => call[1]);
	return { doc: serialize(deps.doc), leafWrites };
}

describe('blocks pasted over a cut that leaves only stranded runs', () => {
	// The cut is the one Delete makes over `a`: the runs it strands go, as they do there.
	it.each([
		{ route: 'a paragraph', source: '***a***\n', leaf: [0], text: 'p\n\nq\n', want: 'p\n\nq\n' },
		{
			route: 'a list item',
			source: '- ***a***\n',
			leaf: [0, 0, 0],
			text: 'p\n\nq\n',
			want: '- p\n\n  q\n'
		},
		{
			route: 'a list into a list item',
			source: '- ***a***\n',
			leaf: [0, 0, 0],
			text: '- p\n- q\n',
			want: '- p\n- q\n'
		},
		{
			route: 'a quote into a quote',
			source: '> ***a***\n',
			leaf: [0, 0],
			text: '> p\n',
			want: '> p\n'
		}
	])('$route: no run stays on screen', async ({ source, leaf, text, want }) => {
		expect((await paste(source, leaf, [3, 4], text)).doc).toBe(want);
	});
});

describe('a pasted line’s own ending', () => {
	it.each([
		{ shape: 'before a hidden closer at the line’s end', source: '**ab**\n', range: [3, 4] },
		{ shape: 'over a whole bold word at the line’s end', source: 'c **ab**\n', range: [4, 6] }
	])('goes, $shape', async ({ source, range }) => {
		const { leafWrites } = await paste(source, [0], range, 'x\n');
		expect(leafWrites).toEqual([source.slice(0, range[0]) + 'x' + source.slice(range[1])]);
	});

	it('stays before text the user sees, and the runs it splits go', async () => {
		expect((await paste('**ab** c\n', [0], [3, 4], 'x\n')).leafWrites).toEqual(['ax\n c\n']);
	});
});

describe('a pasted line’s own ending at a caret', () => {
	it.each([
		{ shape: 'before a hidden closer', source: '**ab**\n', at: 4, want: '**abx**\n' },
		{ shape: 'before a hidden hard break', source: 'a\\\nb\n', at: 1, want: 'ax\\\nb\n' },
		{ shape: 'at a soft line break in bold', source: '**ab\ny**\n', at: 4, want: '**abx\ny**\n' }
	])('goes, $shape', async ({ source, at, want }) => {
		expect((await paste(source, [0], [at, at], 'x\n')).leafWrites).toEqual([want]);
	});

	// A caret the user put past a heading's closing run stays there, as a typed key's does.
	it('lands past a heading’s closing run when the caret is there', async () => {
		expect((await paste('# Hi #\n', [0], [6, 6], 'x')).leafWrites).toEqual(['# Hi #x\n']);
	});

	it('stays in source mode, where the closer after it shows', async () => {
		const { leafWrites } = await paste('**ab**\n', [0], [4, 4], 'x\n', SOURCE);
		expect(leafWrites).toEqual(['**abx\n**\n']);
	});
});
