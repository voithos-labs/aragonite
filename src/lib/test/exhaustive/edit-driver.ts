// The block edits the exhaustive suite runs at every offset, and how one is judged: the edit must
// change the bytes, read back as a reload, fire no dev check, and undo and redo cleanly.
import type { BlockEditActions } from '#lib/action-contracts.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { describeShapeDivergence } from '#lib/core/shape-divergence.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { serialize } from '#lib/core/serializer.js';
import { getContentRange } from '#lib/core/inline/index.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { describeConvergence } from '#lib/testing/parse-convergence.js';
import { createHeadlessActions } from '#lib/testing/headless-actions.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { endTypingBatchesForTests } from '#lib/editor-actions/commit/text-batch.js';
import { containerBundleOver } from '#lib/test/harness/editor-actions.js';
import { describeRunDivergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { EXHAUSTIVE_ALPHABET } from './alphabet';

/** Unspied, unlike the shared harness: a `vi.fn` lives until its file ends, and every edit here
 *  builds its own harness. */
export function harnessOver(doc: Document) {
	const { deps } = createHeadlessActions(doc);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

type Harness = ReturnType<typeof harnessOver>;

export interface Edit {
	name: string;
	/** Runs the edit; false where it doesn't apply at this offset or wrote nothing, so nothing is
	 *  checked. */
	apply(
		blockEdit: BlockEditActions,
		index: number,
		node: CstNode,
		offset: number
	): Promise<boolean>;
}

const write = (
	blockEdit: BlockEditActions,
	index: number,
	text: string,
	before: number,
	after: number
) => blockEdit.updateBlockContent(index, text, 'authored', 'join-typing', before, after);

export const EDITS: Edit[] = [
	...EXHAUSTIVE_ALPHABET.map((char) => ({
		name: `type ${JSON.stringify(char)}`,
		apply: async (blockEdit: BlockEditActions, index: number, node: CstNode, offset: number) => {
			const raw = node.raw;
			// A newline at the leaf's end is the line ending the leaf already has; Enter splits.
			if (char === '\n' && offset === trimTrailingLineEnding(raw).length) return false;
			return write(
				blockEdit,
				index,
				raw.slice(0, offset) + char + raw.slice(offset),
				offset,
				offset + 1
			);
		}
	})),
	{
		name: 'delete before',
		apply: async (blockEdit, index, node, offset) => {
			if (offset === 0) return blockEdit.mergeWithPrevious(index);
			return write(
				blockEdit,
				index,
				node.raw.slice(0, offset - 1) + node.raw.slice(offset),
				offset,
				offset - 1
			);
		}
	},
	{
		name: 'delete after',
		apply: async (blockEdit, index, node, offset) => {
			if (offset === trimTrailingLineEnding(node.raw).length) return blockEdit.mergeWithNext(index);
			return write(
				blockEdit,
				index,
				node.raw.slice(0, offset) + node.raw.slice(offset + 1),
				offset,
				offset
			);
		}
	},
	{
		name: 'split',
		apply: async (blockEdit, index, node, offset) => {
			const { start, end } = getContentRange(node);
			return offset >= start && offset <= end && blockEdit.splitBlock(index, offset);
		}
	}
];

export function leafPaths(nodes: readonly CstNode[], prefix: number[] = []): number[][] {
	return nodes.flatMap((node, i) =>
		node.children ? leafPaths(node.children, [...prefix, i]) : [[...prefix, i]]
	);
}

/** The block-edit bundle that writes the leaf at `path`: the document's, or its container's over
 *  its parent's, so a merge at a container's edge reaches the blocks around the container. */
function blockEditAt(h: Harness, path: number[]): BlockEditActions {
	if (path.length === 1) return h.blockEdit;
	const container = path.slice(0, -1);
	const parent = blockEditAt(h, container);
	return containerBundleOver(h.deps, h.controller, container, undefined, parent).bundle.blockEdit;
}

export function leafAt(nodes: readonly CstNode[], path: number[]): CstNode {
	for (const index of path.slice(0, -1)) nodes = nodes[index].children!;
	return nodes[path.at(-1)!];
}

/** `source` the way the editor opens it, a container left empty given a paragraph to type in. */
export const opened = (source: string) =>
	readAsOpened(source, { grammar: defaultGrammarView, scope: 'document' });

/** Where the tree differs from the editor opening its bytes. Emptied, the document keeps one
 *  empty paragraph, which no reading of no bytes builds, so the caller skips that case. */
export function reloadDivergence(doc: Document, edited: string): string | null {
	const shape = describeShapeDivergence(doc, opened(edited));
	if (shape) return shape;
	// The blank-line check reads with the plain parser, so it runs only where opening the bytes
	// gave no container an empty paragraph.
	return describeConvergence(doc) === null ? describeRunDivergence(doc) : null;
}

/** What went wrong with `edit` at `offset` of the leaf at `path`, dev checks included, or null. */
export async function judge(source: string, path: number[], offset: number, edit: Edit) {
	const failure = await editFailure(source, path, offset, edit);
	const fired = [...new Set(takeDevWarns().map((record) => record.tag))];
	if (fired.length === 0) return failure;
	return `${failure ? `${failure}; ` : ''}fired ${fired.join(', ')}`;
}

async function editFailure(source: string, path: number[], offset: number, edit: Edit) {
	const h = harnessOver(opened(source));
	try {
		const leaf = leafAt(h.deps.doc.children, path);
		const applied = await edit.apply(blockEditAt(h, path), path.at(-1)!, leaf, offset);
		if (!applied) return null;
		const edited = serialize(h.deps.doc);
		if (edited === source) return 'landed, but the bytes are the input';
		const diverged = edited === '' ? null : reloadDivergence(h.deps.doc, edited);
		if (diverged) return `${JSON.stringify(edited)} differs from a reload: ${diverged}`;
		const history = createHistoryActions(h.deps, h.controller);
		await history.requestUndo();
		const undone = serialize(h.deps.doc);
		await history.requestRedo();
		const redone = serialize(h.deps.doc);
		if (undone !== source || redone !== edited) {
			return `undo gave ${JSON.stringify(undone)}, redo ${JSON.stringify(redone)}`;
		}
		return null;
	} catch (error) {
		return `threw ${String(error)}`;
	} finally {
		// A typing write arms a pause timer that holds the harness; no timer runs in this loop.
		endTypingBatchesForTests();
	}
}
