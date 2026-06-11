/**
 * Which prose nodes must refresh `inlineContent` after a commit. Render
 * correctness never depends on this (the render path re-parses raw locally);
 * the cache feeds non-render consumers. Scoping rules:
 *
 *   - Intra-block ops (input, updateContent, metadataUpdate) — the sustained
 *     per-keystroke hot path — touch one top-level subtree.
 *   - An LRD edit always changes the map signature (typing in an LRD's
 *     label/URL, creating or deleting one), which forces whole-doc — this
 *     subsumes "blocks holding unresolved references": a reference can only
 *     change resolution when the signature changes.
 *   - Structural splices (split/merge/paste/undo/...) are single user
 *     gestures, not sustained costs — whole-doc keeps them simple and safe.
 */
import type { CstNode, Document } from './core/nodes';
import type { EditEvent } from './editor-events';

const SUBTREE_OPS: ReadonlySet<EditEvent['op']> = new Set([
	'input',
	'updateContent',
	'metadataUpdate'
]);

export function collectInlineDirty(
	doc: Document,
	event: EditEvent,
	signatureChanged: boolean
): CstNode[] | 'all' {
	if (signatureChanged) return 'all';
	if (!SUBTREE_OPS.has(event.op)) return 'all';
	const top = doc.children[event.path[0]];
	return top ? [top] : 'all';
}
