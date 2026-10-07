/**
 * The hint an empty block shows from the editor's `placeholder` prop, decided here for every block
 * built on `createEditableSurface`. The hint is an attribute the stylesheet paints, so it never
 * reaches the bytes, the undo history or the caret. A block is empty when its content range is.
 */

import { untrack } from 'svelte';
import { getContentRange } from '../../core/inline';
import type { NodeView } from '../../core/node-views';
import type { RawRange } from '../../cursor/widget-offset';
import type { EditorProps, PlaceholderBlock } from '../../editor-props';
import type { Reading } from '../../schema/reading';

/** The prop as the editor hands it to every block, and whether the document is one top-level block. */
export interface PlaceholderPolicy {
	hint: NonNullable<EditorProps['placeholder']>;
	singleBlock: boolean;
}

export interface PlaceholderHintDeps {
	/** Null while the prop is unset, which is what keeps an editor without one from reading bytes. */
	policy: () => PlaceholderPolicy | null;
	getNode: () => NodeView;
	getPath: () => number[];
	reading: Reading;
	/** The bytes that count as the block's content; `getContentRange` when omitted. */
	contentRange?: () => RawRange;
}

export interface PlaceholderHint {
	/** The text the block shows now, or null. */
	text(): string | null;
	/** Tracks focus and composition on the editable element, attached through its spread. */
	track(el: HTMLElement): () => void;
}

/** The string form shows only on an editable empty document; the function form answers for itself. */
export function decidePlaceholder(
	hint: PlaceholderPolicy['hint'],
	block: PlaceholderBlock
): string | null {
	if (typeof hint !== 'string') return hint(block) || null;
	return block.documentEmpty && block.editable ? hint || null : null;
}

export function createPlaceholderHint(deps: PlaceholderHintDeps): PlaceholderHint {
	let focused = $state(false);
	// The composing text is in the element but not yet in the bytes, so the hint would sit over it.
	let composing = $state(false);

	const text = $derived.by(() => {
		const policy = deps.policy();
		if (!policy || composing) return null;
		const node = deps.getNode();
		const range = deps.contentRange?.() ?? getContentRange(node);
		if (range.start !== range.end) return null;
		const path = deps.getPath();
		return decidePlaceholder(policy.hint, {
			kind: node.kind,
			path: [...path],
			documentEmpty: policy.singleBlock && path.length === 1,
			focused,
			editable: deps.reading.mode() !== 'reading'
		});
	});

	function track(el: HTMLElement): () => void {
		const syncFocus = () => (focused = el.contains(el.ownerDocument.activeElement));
		const writes: Record<string, () => void> = {
			focusin: syncFocus,
			focusout: syncFocus,
			compositionstart: () => (composing = true),
			compositionend: () => (composing = false)
		};
		const detach = new AbortController();
		// Untracked: an element removed mid-render fires its focusout inside Svelte's update, where a
		// plain state write throws.
		for (const [type, write] of Object.entries(writes)) {
			el.addEventListener(type, () => untrack(write), { signal: detach.signal });
		}
		syncFocus();
		return () => detach.abort();
	}

	return { text: () => text, track };
}
