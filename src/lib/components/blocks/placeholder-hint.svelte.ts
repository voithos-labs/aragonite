/**
 * The hint an empty block shows from the editor's `placeholder` prop, decided here for every block
 * built on `createEditableSurface`. The hint is an attribute the stylesheet paints, so it never
 * reaches the bytes, the undo history or the caret.
 */

import { untrack } from 'svelte';
import { getContentRange } from '../../core/inline';
import type { NodeView } from '../../core/node-views';
import type { EditorProps, PlaceholderBlock } from '../../editor-props';
import type { Reading } from '../../schema/reading';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';

/** The prop as the editor hands it down, and whether the document holds one top-level block. */
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
}

export interface PlaceholderHint {
	/** The text the block shows now, or null. */
	text(): string | null;
	/** Tracks focus on the editable element, attached through its spread. */
	track(el: HTMLElement): () => void;
	/** Set by the surface's own composition handlers. */
	setComposing(value: boolean): void;
	/** A shown source whose edits reach the node only on blur, judged in place of the node; null
	 *  once it folds. */
	setShownSource(text: string | null): void;
}

/** The string form shows only on an editable empty document; a function answers for itself. */
export function decidePlaceholder(
	hint: PlaceholderPolicy['hint'],
	block: PlaceholderBlock
): string | null {
	if (typeof hint !== 'string') return hint(block) || null;
	return block.documentEmpty && block.editable ? hint || null : null;
}

/** Whether nothing is typed in `node`: its fenced body where the kind declares one, else its
 *  content range. A fence with no body line has nowhere to type, so it is not empty. */
export function isEmptyBlock(node: NodeView): boolean {
	const { bodyRange } = getBlockKindDescriptor(node.kind);
	const range = bodyRange ? bodyRange(node) : getContentRange(node);
	return range !== null && range.start === range.end;
}

export function createPlaceholderHint(deps: PlaceholderHintDeps): PlaceholderHint {
	let focused = $state(false);
	// The composing text is in the element but not yet in the bytes, so the hint would sit over it.
	let composing = $state(false);
	let shown = $state<string | null>(null);

	const text = $derived.by(() => {
		const policy = deps.policy();
		if (!policy || composing) return null;
		const node = deps.getNode();
		if (!isEmptyBlock(shown === null ? node : { ...node, raw: shown })) return null;
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
		// Untracked: removing a focused element mid-render fires `focusout` inside Svelte's update,
		// where a plain state write throws.
		const syncFocus = () =>
			untrack(() => {
				focused = el.contains(el.ownerDocument.activeElement);
			});
		const detach = new AbortController();
		el.addEventListener('focusin', syncFocus, { signal: detach.signal });
		el.addEventListener('focusout', syncFocus, { signal: detach.signal });
		syncFocus();
		return () => detach.abort();
	}

	return {
		text: () => text,
		track,
		setComposing: (value) => {
			composing = value;
		},
		// Untracked: a fold can run from the focusout a source fires as it unmounts mid-render.
		setShownSource: (source) =>
			untrack(() => {
				shown = source;
			})
	};
}
