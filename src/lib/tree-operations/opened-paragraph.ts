/**
 * The paragraph the caret between blocks opens: one writer for the commit that opens it in the
 * editor's tree (`editor-actions/block-edit-core.ts :: insertParagraph`) and for the range-edit
 * core, which asks what the same paragraph's bytes would be before anything commits.
 */

import type { Document } from '../core/nodes';
import type { DocumentView } from '../core/node-views';
import { documentLineEnding } from '../core/lines';
import { blockFacts } from '../schema/block-facts';
import { rebuildContainerRaw } from '../schema/container-raw';
import { takeBareLastLine } from '../schema/child-spans';
import type { GrammarView } from '../schema/block-openers';
import {
	attachedChainPrefix,
	blockNodeAt,
	documentBody,
	paragraphNode,
	type BodyParent
} from './node-primitives';
import { fixUpEdit } from './fix-up/apply';
import { restoreSeparatorOnFill } from './separator-writes';
import { detachedSharing, type SharingState } from './sharing';
import { stampStructuralChange, type StructuralChange } from './structural-change';
import { ensureUnsharedPath } from './unshare';

/** Opens a paragraph holding `text` as child `i` of `body`. `partedBelow`: a blank line parts the
 *  block after `body`'s container from it, so a container's own blank last line stays its own. */
export function openParagraph(
	body: BodyParent,
	i: number,
	text: string,
	sharing: SharingState,
	partedBelow: boolean
): StructuralChange {
	const lineEnding = body.lineEnding;
	const atEnd = i > 0 && i === body.children.length && partedBelow;
	// Past the last block, the body's trailing blank line is the separator, or it would stay under
	// the new one as an empty paragraph or a blank container line.
	const trailing = atEnd ? /^[ \t]*\r?\n/.exec(trailingText(body)) : null;
	if (trailing) setTrailingText(body, trailingText(body).slice(trailing[0].length));
	if (atEnd && !trailing && body.owner) takeBareLastLine(body.owner, body.children.at(-1));
	// Only a list's first block has no separator; anywhere else the new paragraph needs a blank line
	// after its predecessor, whatever the displaced sibling carried.
	const trivia = trailing
		? trailing[0]
		: i > 0
			? lineEnding
			: (body.children[0]?.leadingTrivia ?? '');
	body.children.splice(i, 0, paragraphNode(trivia, text, lineEnding));
	const change: StructuralChange = { op: 'insert', at: i, count: 1 };
	stampStructuralChange(body.children, change, sharing);
	// The commit's blank-line fix-up cannot infer that the displaced sibling, pushed off the first
	// position, needs a separator.
	restoreSeparatorOnFill(body, i + 1, sharing);
	return change;
}

/** Whether the first block after the container at `path`, at whatever depth one stands, reads a
 *  blank line apart from it; true where none follows. */
export function partedBelow(doc: DocumentView, path: readonly number[]): boolean {
	for (let depth = path.length; depth > 0; depth--) {
		const above = path.slice(0, depth - 1);
		const siblings = above.length === 0 ? doc.children : blockNodeAt(doc, above)?.children;
		const next = siblings?.[path[depth - 1] + 1];
		if (next) return /^[ \t]*\r?\n/.test(next.leadingTrivia ?? '');
	}
	return true;
}

/** `view` with an empty paragraph opened as child `index` of the block at `parent`, on a copy, its
 *  containers rebuilt around it as the commit rebuilds them; null where `parent` holds no body. */
export function openedIn(
	view: DocumentView,
	parent: readonly number[],
	index: number,
	grammar: GrammarView
): Document | null {
	const doc = {
		kind: 'document',
		prefix: view.prefix,
		children: [...view.children],
		suffix: view.suffix
	} as Document;
	const sharing = detachedSharing();
	const lineEnding = documentLineEnding(view);
	const chain = ensureUnsharedPath(doc, [...parent], sharing);
	const owner = chain.at(-1);
	if (parent.length > 0 && !owner?.children) return null;
	// No paragraph opens among a list's items or a table's rows.
	if (owner && ['items', 'rows', 'cells'].includes(blockFacts(owner.kind).lines)) return null;
	const body: BodyParent = owner
		? { children: owner.children!, owner, lineEnding }
		: documentBody(doc);
	const before = body.children.slice();
	const change = openParagraph(body, index, '', sharing, !owner || partedBelow(view, parent));
	// The fix-up the commit runs over the body it wrote, then its containers rebuilt around it.
	fixUpEdit(body, { change, before }, grammar, sharing);
	for (const node of attachedChainPrefix(doc, chain).reverse()) rebuildContainerRaw(node, grammar);
	return doc;
}

/** The blank text past a body's last block: the document's own, or its container's. */
const trailingText = (body: BodyParent): string => body.suffix ?? body.owner?.innerSuffix ?? '';

function setTrailingText(body: BodyParent, text: string): void {
	if (body.suffix !== undefined) body.suffix = text;
	else if (body.owner) body.owner.innerSuffix = text;
}
