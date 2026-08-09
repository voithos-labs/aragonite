/**
 * What an open link card can read and write: the construct re-resolved from its target identity
 * after every edit, the bytes the write seam would produce, and the anchoring measure. Kept out of
 * the component so the card stays a rendering shell.
 */

import type { Document } from '../../core/nodes';
import type { InlineNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { wireOverlayRemeasure } from '../../cursor/overlay-remeasure';
import type { UndoController } from '../../editor-actions/deps';
import { createInlineRangeCommit } from '../../editor-actions/inline-range-commit';
import type { EditorEvents } from '../../editor-events';
import type { LinkReferenceResolverRef } from '../../editor-keys';
import type { GrammarView } from '../../schema/block-openers';
import { isBlockNode, nodeAt } from '../../tree-operations/node-ops';
import { linkConstructAt, type LinkTarget } from '../blocks/text/link-at-point';
import {
	buildLinkEditBytes,
	buildLinkUnwrapBytes,
	linkFieldsFromInline,
	type LinkFields
} from '../blocks/text/link-source-bytes';

// ── Public API ──────────────────────────────────────────────────────────────

export interface LinkCardCommitterDeps {
	getDoc: () => Document;
	getEditorEl: () => HTMLElement | null;
	/** The open card's target, read live: the anchor re-measures against whatever it names now. */
	getTarget: () => LinkTarget | null;
	controller: UndoController;
	events: EditorEvents;
	/** Rect measure for a raw range in a mounted block — the anchoring geometry. */
	measureRange: (path: number[], start: number, end: number) => DOMRect[];
	/** Reveal + land the caret at a raw offset, so the next keystroke addresses the document. */
	landCaret: (path: number[], offset: number) => Promise<boolean>;
	linkRef?: LinkReferenceResolverRef;
	grammar?: GrammarView;
}

export interface ResolvedLinkTarget {
	block: NodeView;
	link: InlineNode;
	/** The destination as the author wrote it, decoded — what the card's field shows. */
	url: string;
}

export interface LinkCardCommitter {
	/** The construct the target names, re-read from the live tree; null once an edit removed it. */
	resolve(target: LinkTarget): ResolvedLinkTarget | null;
	/** The bytes a url commit would write, or null if the seam would decline — the card's dirty
	 *  check compares against these rather than deciding bytes itself. */
	buildBytes(target: LinkTarget, url: string): string | null;
	commitUrl(target: LinkTarget, url: string): void;
	removeLink(target: LinkTarget): void;
	/** Position `getCard()` under the link and keep it there across edits and scrolls. */
	syncCardToLink(getCard: () => HTMLElement | null): () => void;
}

export function createLinkCardCommitter(deps: LinkCardCommitterDeps): LinkCardCommitter {
	const inlineRange = createInlineRangeCommit({
		getDoc: deps.getDoc,
		controller: deps.controller,
		grammar: deps.grammar
	});

	function resolve(target: LinkTarget): ResolvedLinkTarget | null {
		const block = nodeAt(deps.getDoc() as DocumentView, target.path);
		if (block === null || !isBlockNode(block)) return null;
		const link = linkConstructAt(block, target.sourceStart, deps.linkRef);
		return link === null ? null : { block, link, url: link.url ?? '' };
	}

	function editBytes(target: LinkTarget, url: string): { bytes: string; link: InlineNode } | null {
		const resolved = resolve(target);
		if (!resolved) return null;
		const { block, link } = resolved;
		const current = linkFieldsFromInline(link, block.raw);
		// A reference form cannot carry a NEW destination without editing its definition, which
		// lives in another block; changing the url is the user opting into the inline form. The
		// title rides along either way — the card never shows it, so it is not the card's to drop.
		const fields: LinkFields =
			url === current.url
				? current
				: {
						text: current.text,
						url,
						...(current.title !== undefined ? { title: current.title } : {})
					};
		const bytes = buildLinkEditBytes(link, block.raw, fields, deps.linkRef?.current);
		return bytes === null ? null : { bytes, link };
	}

	function buildBytes(target: LinkTarget, url: string): string | null {
		return editBytes(target, url)?.bytes ?? null;
	}

	function commitUrl(target: LinkTarget, url: string): void {
		const edit = editBytes(target, url);
		if (!edit) return;
		void write(target, edit.link, edit.bytes);
	}

	function removeLink(target: LinkTarget): void {
		const resolved = resolve(target);
		if (!resolved) return;
		const bytes = buildLinkUnwrapBytes(resolved.link, resolved.block.raw, deps.linkRef?.current);
		if (bytes === null) return;
		void write(target, resolved.link, bytes);
	}

	async function write(target: LinkTarget, link: InlineNode, bytes: string): Promise<void> {
		await inlineRange.commitInlineRange(target.path, link.start, link.end, bytes, link.start);
		// The construct's outer start, which is also the offset the undo entry records: the caret
		// before an undo and the caret after it then agree, and a remove-link lands where the
		// unwrapped text now begins.
		await deps.landCaret(target.path, link.start);
	}

	function syncCardToLink(getCard: () => HTMLElement | null): () => void {
		const cardEl = getCard();
		const editorEl = deps.getEditorEl();
		if (!cardEl || !editorEl) return () => {};

		// Measured through the rects API off RAW offsets, so the anchor survives the DOM rebuild
		// every commit does — there is no element reference here to go stale.
		const measure = () => {
			const target = deps.getTarget();
			const resolved = target && resolve(target);
			if (!target || !resolved) return;
			const rect = deps.measureRange(target.path, resolved.link.start, resolved.link.end)[0];
			if (!rect) return;
			const editorRect = editorEl.getBoundingClientRect();
			const style = getComputedStyle(editorEl);
			const borderTop = parseFloat(style.borderTopWidth) || 0;
			const borderLeft = parseFloat(style.borderLeftWidth) || 0;
			cardEl.style.top = `${rect.bottom - editorRect.top - borderTop + editorEl.scrollTop}px`;
			cardEl.style.left = `${rect.left - editorRect.left - borderLeft + editorEl.scrollLeft}px`;
		};

		// The setup measure reads the document, and letting that register would make the caller's
		// $effect tear down and re-wire these listeners on every keystroke. The `edit` subscription
		// below is the one document trigger.
		const unwireScroll = wireOverlayRemeasure({
			el: cardEl,
			editorRoot: editorEl,
			blockRef: undefined,
			measure,
			untrackSetupMeasure: true
		});
		// An edit anywhere above the link shifts its y without touching the link itself.
		const unsubscribe = deps.events.on('edit', measure);
		window.addEventListener('resize', measure);
		return () => {
			unwireScroll();
			unsubscribe();
			window.removeEventListener('resize', measure);
		};
	}

	return { resolve, buildBytes, commitUrl, removeLink, syncCardToLink };
}
