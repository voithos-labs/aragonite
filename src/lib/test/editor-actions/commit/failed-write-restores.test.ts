// A write that fails (a throw, or a no-op it discards) leaves the document as it was, whatever
// scope it wrote and however deep: every node holds the bytes and the children it held.
// Miss-analysis: every rollback row failed a commit that had to copy the block it wrote, so the
// array the rollback puts back dropped the copy. A commit that joins its undo entry writes a block
// the entry already copied where it stands, and no row threw after one.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { asDocPath } from '#lib/core/coordinate-spaces.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { ContainerScope, MultiScopeTarget } from '#lib/action-contracts.js';
import type { EditorActionsDeps, UndoController } from '#lib/editor-actions/deps.js';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import {
	makeBlockListState,
	makeNestedHarness,
	makeTopHarness
} from '#lib/test/harness/editor-actions.js';

// Top-level blocks: a paragraph, a list whose first item holds a nested list, a quote, a paragraph.
const SOURCE = 'alpha\n\n- a\n  - x\n  - y\n- b\n\n> quote\n\nomega\n';
const LIST = 1;
const snapshot = { path: asDocPath([0]), offset: 0 };

const originalListRebuild = tryGetBlockKindDescriptor('list')!.rebuildRaw!;
const originalQuoteRebuild = tryGetBlockKindDescriptor('blockquote')!.rebuildRaw!;
afterEach(() => {
	augmentBuiltin('list', { container: { rebuildRaw: originalListRebuild } });
	augmentBuiltin('blockquote', { container: { rebuildRaw: originalQuoteRebuild } });
});

interface Harness {
	deps: EditorActionsDeps;
	controller: UndoController;
}

/** An editor over `SOURCE` with its list's own scope; the state is made once, as a mounted list's is. */
function listHarness() {
	const h = makeTopHarness(SOURCE);
	const getList = () => h.deps.doc.children[LIST];
	const state = makeBlockListState(getList);
	// Read when a commit starts: an earlier commit copied the list's node.
	const listScope = (): MultiScopeTarget => ({ node: getList(), state, path: [LIST] });
	return { ...h, listScope };
}
type ListHarness = ReturnType<typeof listHarness>;

/** The path of every block below `root` that holds no block of its own. */
function leafPaths(root: { children?: CstNode[] }, path: number[] = []): number[][] {
	const children = root.children ?? [];
	if (children.length === 0) return path.length > 0 ? [path] : [];
	return children.flatMap((child, i) => leafPaths(child, [...path, i]));
}

/** All that every block below `root` holds that a write could change, outermost first. */
function held(root: { children?: CstNode[] }, path: number[] = []): unknown[] {
	return (root.children ?? []).flatMap((node, i) => [
		{
			path: [...path, i].join('.'),
			kind: node.kind,
			leadingTrivia: node.leadingTrivia,
			raw: node.raw,
			metadata: JSON.stringify(node.metadata),
			markerWidths: node.markerWidths?.slice(),
			childIds: node.childIds?.slice()
		},
		...held(node, [...path, i])
	]);
}

/** Opens an undo step that stays open and copies every block inside it, so each later commit
 *  joins that entry and writes whatever it reaches where it stands. */
async function ownEveryBlock({ deps, controller }: Harness): Promise<void> {
	void controller.undoStep(snapshot, () => new Promise(() => {}));
	await controller.commitStructural({
		snapshot,
		mutate: (_, scope) => {
			for (const path of leafPaths(deps.doc)) scope.own(path);
			return { op: 'noop' };
		}
	});
}

/** The document as it stands, and the check that it stands so again. */
function standing({ deps }: Harness): () => void {
	const [source, blocks] = [serialize(deps.doc), held(deps.doc)];
	return () => {
		expect(serialize(deps.doc)).toBe(source);
		expect(held(deps.doc)).toEqual(blocks);
	};
}

type Write = (scopes: ContainerScope[]) => void;
/** Commits `write` over a row's scopes, reporting no change to any scope's own list. */
type Commit = (h: ListHarness, write: Write, discardIfNoop?: boolean) => Promise<boolean>;

const overDocument: Commit = (h, write, discardIfNoop) =>
	h.controller.commitStructural({
		snapshot,
		discardIfNoop,
		mutate: (_, scope) => {
			write([scope]);
			return { op: 'noop' };
		}
	});

const overList: Commit = (h, write, discardIfNoop) =>
	h.controller.commitMultiScope({
		scopes: [h.listScope()],
		snapshot,
		discardIfNoop,
		mutate: ([scope]) => {
			write([scope]);
			return [{ op: 'noop' }];
		}
	});

const overBoth: Commit = (h, write, discardIfNoop) =>
	h.controller.commitMultiScope({
		scopes: [h.controller.getDocScope(), h.listScope()],
		snapshot,
		discardIfNoop,
		mutate: ([doc, list]) => {
			write([doc, list]);
			return [{ op: 'noop' }, { op: 'noop' }];
		}
	});

const newItem = () => parse('- new\n').children[0].children!;

interface Row {
	name: string;
	commit: Commit;
	write: Write;
	/** Whether the commit rebuilds the top-level list once the write is in. */
	throughList: boolean;
}

const ROWS: Row[] = [
	{
		name: 'the document scope, a top-level block',
		commit: overDocument,
		throughList: false,
		write: ([doc]) => void (doc.own([0])[0].raw = 'written\n')
	},
	{
		name: 'the document scope, a top-level block through its leaf write',
		commit: overDocument,
		throughList: false,
		write: ([doc]) => void doc.writeLeaf([0], 'written\n')
	},
	{
		name: 'the document scope, a leaf three containers down',
		commit: overDocument,
		throughList: true,
		write: ([doc]) => void doc.writeLeaf([LIST, 0, 1, 0, 0], 'written\n')
	},
	{
		name: 'the document scope, a list spliced two containers down',
		commit: overDocument,
		throughList: true,
		write: ([doc]) => {
			doc.own([LIST, 0, 1]);
			doc.splice([LIST, 0, 1], 1, 1, newItem());
		}
	},
	{
		name: 'a container scope, a leaf in its own child',
		commit: overList,
		throughList: true,
		write: ([list]) => void list.writeLeaf([1, 0], 'written\n')
	},
	{
		name: 'a container scope, a leaf three containers below it',
		commit: overList,
		throughList: true,
		write: ([list]) => void list.writeLeaf([0, 1, 1, 0], 'written\n')
	},
	{
		name: 'a container scope, a list spliced below it',
		commit: overList,
		throughList: true,
		write: ([list]) => {
			list.own([0, 1]);
			list.splice([0, 1], 0, 1, newItem());
		}
	},
	{
		name: 'the document and a container scope together',
		commit: overBoth,
		throughList: true,
		write: ([doc, list]) => {
			doc.own([0])[0].raw = 'written\n';
			list.writeLeaf([0, 1, 0, 0], 'written\n');
		}
	}
];

describe.each(ROWS)('a commit that writes in place and fails: $name', (row) => {
	it('writes, when nothing fails', async () => {
		const h = listHarness();
		await ownEveryBlock(h);
		const before = serialize(h.deps.doc);

		expect(await row.commit(h, row.write)).toBe(true);

		expect(serialize(h.deps.doc)).not.toBe(before);
	});

	it('thrown out of the mutation', async () => {
		const h = listHarness();
		await ownEveryBlock(h);
		const expectStanding = standing(h);

		const thrown = row.commit(h, (scopes) => {
			row.write(scopes);
			throw new Error('part way');
		});

		await expect(thrown).rejects.toThrow('part way');
		expectStanding();
	});

	it('discarded as a no-op', async () => {
		const h = listHarness();
		await ownEveryBlock(h);
		const expectStanding = standing(h);

		expect(await row.commit(h, row.write, true)).toBe(false);

		expectStanding();
	});

	it.runIf(row.throughList)('thrown out of the top-level list’s rebuild', async () => {
		const h = listHarness();
		await ownEveryBlock(h);
		const expectStanding = standing(h);
		augmentBuiltin('list', {
			container: {
				rebuildRaw: (node: CstNode) => {
					if (node === h.deps.doc.children[LIST]) throw new Error('rebuild blew up');
					originalListRebuild(node);
				}
			}
		});

		await expect(row.commit(h, row.write)).rejects.toThrow('rebuild blew up');
		expectStanding();
	});
});

describe('a keystroke that writes in place and fails', () => {
	it.each([
		{ name: 'in its leaf alone', source: '> ab\n', index: 0, text: 'abx\n' },
		// Indented text on the blank line makes the list above absorb it.
		{
			name: 'with blocks its fix-up merges',
			source: '> - a\n>\n>\n> zz\n',
			index: 1,
			text: '  b\n'
		}
	])('$name, thrown out of the quote’s rebuild', async ({ source, index, text }) => {
		const h = makeNestedHarness(source, { index: 0 });
		await ownEveryBlock(h);
		const expectStanding = standing(h);
		augmentBuiltin('blockquote', {
			container: {
				rebuildRaw: () => {
					throw new Error('rebuild blew up');
				}
			}
		});

		await expect(
			h.bundle.blockEdit.updateBlockContent(index, text, 'authored', 'join-typing', 0)
		).rejects.toThrow('rebuild blew up');

		expectStanding();
	});
});

describe('a byte splice that fails', () => {
	it('thrown once its blocks are in', async () => {
		const h = listHarness();
		await ownEveryBlock(h);
		const expectStanding = standing(h);
		// The splice clears a held range once its blocks are in, which is where this one throws.
		h.deps.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [3], offset: 1 });
		h.deps.caretWriter.clear = () => {
			throw new Error('part way');
		};

		const thrown = h.controller.commitSource({
			changes: [{ from: 0, to: 5, insert: 'written' }],
			caret: 'keep',
			op: { kind: 'input' },
			snapshot
		});

		await expect(thrown).rejects.toThrow('part way');
		expectStanding();
	});
});
