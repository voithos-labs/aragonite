// A keystroke that changes its block's kind joins the undo entry its typing burst opened, at
// every depth.
// Miss-analysis: no test ended a typing burst with a kind change inside a container.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serialize } from '$lib/core/serializer';
import type { BlockEditActions } from '$lib/action-contracts';
import type { Document } from '$lib/core/nodes';
import type { UndoController } from '$lib/editor-actions/deps';
import type { UndoEntry } from '$lib/undo/types';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { makeContainerHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { allowDevWarns } from '$lib/test/support/warn-gate';

interface Typed {
	actions: BlockEditActions;
	controller: UndoController;
	doc: Document;
	undoEntries: () => UndoEntry[];
	/** The controller commit the level's structural keystroke goes through. */
	commitName: 'commitStructural' | 'commitContainerStructural';
}

/** One list the keystrokes land in: the document root, a quote, or an item two levels down. */
const LEVELS = [
	{
		level: 'at the top level',
		wrap: (body: string) => body,
		leafPath: [0],
		mount: (source: string): Typed => {
			const h = makeTopHarness(source);
			return {
				actions: h.actions,
				controller: h.controller,
				doc: h.deps.doc,
				undoEntries: () => h.deps.undoManager.getStacks().undo,
				commitName: 'commitStructural'
			};
		}
	},
	{
		level: 'in a quote',
		wrap: (body: string) => body.replace(/^(?=.)/gm, '> '),
		leafPath: [0, 0],
		mount: (source: string): Typed => container(source, [0])
	},
	{
		level: 'in a list item',
		wrap: (body: string) => '- ' + body.replace(/\n(?=.)/g, '\n  '),
		leafPath: [0, 0, 0],
		mount: (source: string): Typed => container(source, [0, 0])
	}
];

function container(source: string, path: number[]): Typed {
	const h = makeContainerHarness(source, path);
	return {
		actions: h.bundle.blockEdit,
		controller: h.controller,
		doc: h.deps.doc,
		undoEntries: () => h.deps.undoManager.getStacks().undo,
		commitName: 'commitContainerStructural'
	};
}

/** Each keystroke's leaf text, the caret before it and the caret after it, in stored bytes. */
const BURSTS = [
	{
		burst: 'erasing a setext underline',
		body: 'Plan\n===\n',
		keys: [
			['Plan\n==\n', 8, 7],
			['Plan\n=\n', 7, 6],
			['Plan\n\n', 6, 5]
		] as const,
		kind: 'paragraph'
	},
	{
		burst: 'typing a heading marker',
		body: 'x\n',
		keys: [
			['#x\n', 0, 1],
			['# x\n', 1, 2]
		] as const,
		kind: 'heading'
	}
];

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a typing burst that ends in a kind change is one undo entry', () => {
	for (const { level, wrap, leafPath, mount } of LEVELS) {
		for (const { burst, body, keys, kind } of BURSTS) {
			it(`${burst} ${level}`, async () => {
				const source = wrap(body);
				const typed = mount(source);

				for (const [text, pre, post] of keys) {
					await typed.actions.updateBlockContent(leafPath.at(-1)!, text, 'authored', pre, post);
				}

				expect(nodeAt(typed.doc, leafPath)?.kind).toBe(kind);
				// The emptied underline stays as a blank line inside the item's paragraph, which a
				// reload reads differently: a separate defect, declared here so this row tests undo.
				if (level === 'in a list item' && kind === 'paragraph')
					allowDevWarns(['invariant:stale-raw']);
				const entries = typed.undoEntries();
				expect(entries).toHaveLength(1);
				expect(serialize(entries[0].snapshot)).toBe(source);
				const point = { path: leafPath, offset: keys[0][1] };
				expect(entries[0].selection).toEqual({ anchor: point, focus: point });
			});
		}
	}
});

// The commit joins the burst's entry only while the push and the commit call share one
// synchronous stretch: an await between them splits the entry again.
describe('the kind-changing keystroke pushes and commits before it first yields', () => {
	for (const { level, wrap, leafPath, mount } of LEVELS) {
		it(level, async () => {
			const typed = mount(wrap('#x\n'));
			const push = vi.spyOn(typed.controller, 'pushUndoSnapshotDebounced');
			const commit = vi.spyOn(typed.controller, typed.commitName);

			const write = typed.actions.updateBlockContent(leafPath.at(-1)!, '# x\n', 'authored', 1, 2);

			expect(push).toHaveBeenCalledTimes(1);
			expect(commit).toHaveBeenCalledTimes(1);
			expect(push.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
			await write;
			expect(nodeAt(typed.doc, leafPath)?.kind).toBe('heading');
		});
	}
});
