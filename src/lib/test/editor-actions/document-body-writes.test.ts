import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { displayLength } from '$lib/core/lines';
import { asDocPath } from '$lib/selection/path-math';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { ensureUnsharedChild } from '$lib/tree-operations/unshare';
import { stampStructuralChange } from '$lib/tree-operations/structural-change';
import { makeTopHarness, type TopHarness } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// Every top-level write hands the tree operations the document as a body, trailing blank line
// included, so each route leaves the blocks a reload reads.
// Miss-analysis: no write that blanks the last block drove a multi-scope commit's document scope.

/** Documents whose parse keeps a trailing blank line aside, under different last blocks. */
const SOURCES = [
	'a\n\nb\n\n',
	'a\n\n# h\n\n',
	'a\r\n\r\nb\r\n\r\n',
	'> q\n\nb\n\n',
	'a\n\n```\nc\n```\n\n'
];

/** The structural edits a user can make at the last block, which no trial reparse checks. */
const TAIL_EDITS: [string, (h: TopHarness, last: number) => Promise<boolean>][] = [
	['delete', (h, last) => h.actions.deleteBlock(last)],
	[
		'split at the end',
		(h, last) => h.actions.splitBlock(last, displayLength(h.deps.doc.children[last].raw))
	],
	['split at the start', (h, last) => h.actions.splitBlock(last, 0)],
	['append an empty paragraph', (h, last) => h.actions.insertParagraph(last + 1, '')],
	['append a paragraph with text', (h, last) => h.actions.insertParagraph(last + 1, 'new')],
	['merge into the previous block', (h, last) => h.actions.mergeWithPrevious(last)],
	['merge the previous block into it', (h, last) => h.actions.mergeWithNext(last - 1)],
	['replace with nothing', (h, last) => h.actions.replaceBlock(last, [])],
	['update to blank', (h, last) => h.actions.updateBlockContent(last, '\n', 'authored')],
	['update to text', (h, last) => h.actions.updateBlockContent(last, 'z\n', 'authored')]
];

describe('a structural edit at the last block, with a trailing blank line', () => {
	for (const source of SOURCES) {
		for (const [name, edit] of TAIL_EDITS) {
			it(`${JSON.stringify(source)}: ${name} leaves the blocks a reload reads`, async () => {
				const h = makeTopHarness(source);
				expect(h.deps.doc.suffix).not.toBe('');
				await edit(h, h.deps.doc.children.length - 1);

				expectParseConverged(h.deps.doc);
				expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
			});
		}
	}
});

describe('the document scope of a multi-scope commit', () => {
	it('hands its mutate the document body, which names no owner', async () => {
		const h = makeTopHarness('a\n\nb\n\n');
		let owner: unknown = 'unread';
		let suffix: string | undefined;

		await h.controller.commitMultiScope({
			scopes: [h.controller.getDocScope()],
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: ([scope]) => {
				owner = scope.body.owner;
				suffix = scope.body.suffix;
				return [{ op: 'noop' }];
			},
			discardIfNoop: true
		});

		expect(owner).toBeUndefined();
		expect(suffix).toBe('\n');
	});

	it('blanks the last block into the blocks the top-level content commit leaves', async () => {
		const source = 'a\n\nb\n\n';
		const viaContent = makeTopHarness(source);
		await viaContent.actions.updateBlockContent(1, '\n', 'authored');

		const h = makeTopHarness(source);
		await h.controller.commitMultiScope({
			scopes: [h.controller.getDocScope()],
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: ([scope]) => {
				ensureUnsharedChild(scope, 1, scope.sharing);
				const grammar = h.deps.reading.grammar;
				const { change } = updateNodeContent(scope.body, 1, '\n', grammar, scope.sharing);
				stampStructuralChange(scope.children, change, scope.sharing);
				return [change];
			},
			op: { kind: 'updateContent', detail: { length: 1 }, eventPath: asDocPath([1]) }
		});

		expect(serialize(h.deps.doc)).toBe(serialize(viaContent.deps.doc));
		expect(h.deps.doc.children).toHaveLength(viaContent.deps.doc.children.length);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});
});
