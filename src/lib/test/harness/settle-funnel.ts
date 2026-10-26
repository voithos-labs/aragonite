/**
 * The steps every structural commit runs, for suites driving the primitives directly: the edit
 * against a body, then the commit's one fix-up (`settleEdit`), and at the document the step that
 * keeps an open last line open. The primitives leave their fix-up to the commit, so the edit alone
 * proves little.
 */

import { deleteNode } from '#lib/tree-operations/node-ops.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import {
	asBody,
	documentBody,
	type BodyParent,
	type BodyParentArg
} from '#lib/tree-operations/node-primitives.js';
import { documentLineEnding } from '#lib/core/lines.js';
import {
	createScopeWriter,
	rebuildOwnedChains,
	type ScopeWriter
} from '#lib/editor-actions/commit/scope-writes.js';
import {
	endsOpen,
	keepOpenTail,
	settleEdit,
	type BodyEdit,
	type EditKind,
	type SettledEdit,
	type TrackedPosition
} from '#lib/tree-operations/fix-up/apply.js';
import {
	mergeIntoPrevDeepLeaf,
	type JoinLanding,
	type MergeIntoPrevResult
} from '#lib/tree-operations/node-ops.js';
import { reorderChildrenWithTrivia } from '#lib/tree-operations/reorder.js';
import type { StructuralChange } from '#lib/tree-operations/structural-change.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import type { Reading } from '#lib/schema/reading.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState, type SharingState } from '#lib/tree-operations/sharing.js';

/** What a test's edit reports: its change, plus what it did beyond the splice. */
export type ReportedEdit = StructuralChange | ({ change: StructuralChange } & EditKind);

/** The commit's steps after `edit` ran over `parent`'s body: a document also gets its open last
 *  line kept as it was. */
function commitSteps(
	parent: BodyParentArg,
	edit: (body: BodyParent) => Omit<BodyEdit, 'before'>,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition
): SettledEdit {
	const doc = 'owner' in parent ? null : parent;
	const body = asBody(parent);
	const wasOpen = doc ? endsOpen(doc) : false;
	const before: CstNode[] = [...body.children];
	const settled = settleEdit(body, { ...edit(body), before }, grammar, sharing, tracked);
	if (doc) keepOpenTail(doc, wasOpen, sharing, grammar);
	return settled;
}

/** Runs `edit` over `parent`'s body and the commit's steps after it; returns the settled change. */
export function settledIn(
	parent: BodyParentArg,
	edit: (body: BodyParent) => ReportedEdit,
	grammar: GrammarView = defaultGrammarView,
	sharing: SharingState = createSharingState(),
	tracked?: TrackedPosition
): StructuralChange {
	const report = (body: BodyParent) => {
		const reported = edit(body);
		return 'op' in reported ? { change: reported } : reported;
	};
	return commitSteps(parent, report, grammar, sharing, tracked).change;
}

/** {@link settledIn} over a document. `grammar` is the editor's, which the fix-up reads blocks
 *  with. */
export function settled(
	doc: Document,
	mutate: (parent: BodyParent) => ReportedEdit,
	grammar: GrammarView = defaultGrammarView
): StructuralChange {
	return settledIn(doc, mutate, grammar);
}

/** `deleteNode` and its fix-up. */
export function deleteSettled(
	parent: BodyParentArg,
	index: number,
	grammar: GrammarView = defaultGrammarView,
	sharing: SharingState = createSharingState()
): StructuralChange {
	const removal = (body: BodyParent) => ({
		change: deleteNode(body, index, sharing),
		removed: true as const
	});
	return settledIn(parent, removal, grammar, sharing);
}

/** `mergeIntoPrevDeepLeaf` and its fix-up: where the join landed, and the settled change. */
export function mergePrevSettled(
	parent: BodyParentArg,
	index: number,
	sharing: SharingState,
	reading: Reading
): (JoinLanding & { change: StructuralChange }) | null {
	const tracked: TrackedPosition = { index: -1, offset: 0 };
	let merged: MergeIntoPrevResult | null = null;
	const { change } = commitSteps(
		parent,
		(body) => {
			merged = mergeIntoPrevDeepLeaf(body, index, sharing, reading, tracked);
			return merged ? { change: merged.change, removed: true } : { change: { op: 'noop' } };
		},
		reading.grammar,
		sharing,
		tracked
	);
	const result = merged as MergeIntoPrevResult | null;
	return result && { ...result.landing(asBody(parent).children), change };
}

/** `reorderChildrenWithTrivia` and its fix-up: the settled change and where the moved block is. */
export function reorderSettled(
	body: BodyParent,
	from: number,
	to: number,
	sharing: SharingState,
	grammar: GrammarView
): { change: StructuralChange; landing: number } {
	let landing = to;
	const settled = commitSteps(
		body,
		() => {
			const reordered = reorderChildrenWithTrivia(body, from, to, sharing);
			landing = reordered.landing;
			return {
				change: reordered.change,
				moved: { to: landing, uncovered: reordered.uncovered }
			};
		},
		grammar,
		sharing
	);
	return { change: settled.change, landing: settled.moved ?? landing };
}

/** Runs `write` against the document's commit-scope writes, then the commit's rebuild of every
 *  path it owned, for suites driving an op that writes below a scope. */
export function writtenBelow<T>(
	doc: Document,
	write: (scope: ScopeWriter & { sharing: SharingState }) => T,
	grammar: GrammarView = defaultGrammarView,
	sharing: SharingState = createSharingState()
): T {
	const writer = createScopeWriter(documentBody(doc), sharing, grammar, documentLineEnding(doc));
	const result = write({ ...writer, sharing });
	rebuildOwnedChains([writer], sharing, grammar);
	return result;
}
