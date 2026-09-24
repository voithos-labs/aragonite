<script lang="ts">
	// The `[^label]: ` marker is drawn in front of the first child instead of being part of its
	// text, the way a list item's `- ` is, so the body edits like ordinary prose and the marker
	// stays read-only. Clicking the marker, or Enter on it in reading mode, jumps back to the first
	// reference.
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		isWidgetActivationClick,
		type DocumentView,
		type EditorRects,
		type NodeView
	} from '$lib/plugin';
	import type { FootnoteDefMetadata } from './footnote-definition';
	import { backToReferenceLabel } from './constants';
	import { collectFootnoteReferences } from './footnote-numbering';

	let {
		node,
		index,
		myPath = [],
		document,
		rects
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		document?: DocumentView;
		rects?: EditorRects;
	} = $props();

	let boxEl: HTMLElement | undefined = $state();

	const label = $derived(getPluginMetadata<FootnoteDefMetadata>(node)?.label ?? '');
	// Only `[^label]` is clickable; the colon and space after it are syntax nobody aims at.
	const marker = $derived(`[^${label}]`);

	const { blockListProps, containerApi, getPresentationMode, getEditor } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		getAmbientPrefix: () => ({
			text: `${marker}: `,
			interactive: [
				{
					start: 0,
					end: marker.length,
					className: 'footnote-def-marker',
					role: 'link',
					label: backToReferenceLabel(label),
					// A tab stop only where the block holds no caret for it to interrupt.
					focusable: getPresentationMode() === 'reading',
					onClick: onMarkerClick,
					onActivate: jumpToFirstReference
				}
			]
		})
	});

	function onMarkerClick(e: MouseEvent): void {
		if (!isWidgetActivationClick(e.ctrlKey || e.metaKey, getPresentationMode())) return;
		// Skips the block's caret handling and the editor's root click handler on purpose:
		// jumping is the only thing this click does.
		e.preventDefault();
		e.stopPropagation();
		jumpToFirstReference();
	}

	// Looked up on each jump, never derived: the span's listeners are bound once when the span is
	// built, so a path captured then would be the answer from whenever that was.
	function jumpToFirstReference(): void {
		if (!document) return;
		// GFM numbers by first-reference order, so the first reference is the one this
		// definition's number comes from.
		const first = collectFootnoteReferences(document, getEditor()?.computeInlineContent).find(
			(ref) => ref.label === label
		);
		if (first) void rects?.navigateTo(first.path, first.end);
	}

	// True where a plain click already jumps, so the pointer shape matches what a click does.
	const plainClickJumps = $derived(isWidgetActivationClick(false, getPresentationMode()));

	export { containerApi };
</script>

<div
	class="footnote-def"
	data-footnote-label={label}
	data-plain-click-jumps={plainClickJumps ? '' : undefined}
	bind:this={boxEl}
>
	<BlockList {...blockListProps} />
</div>

<style>
	/* A line down the left margin, not a card: the marker itself is drawn in front of the
	   first child. */
	.footnote-def {
		position: relative;
		margin: 0.4em 0;
		padding-left: 0.9em;
		border-left: 2px solid var(--color-border, #3d4047);
		font-size: 0.95em;
	}

	/* The marker span is built into the child block's DOM, outside this component's styles. */
	.footnote-def :global(.footnote-def-marker:hover) {
		text-decoration: underline;
	}

	/* Where the marker is a link, a dotted underline tells it from the note's text without
	   relying on colour. */
	.footnote-def[data-plain-click-jumps] :global(.footnote-def-marker) {
		cursor: pointer;
		text-decoration: underline dotted;
	}
</style>
