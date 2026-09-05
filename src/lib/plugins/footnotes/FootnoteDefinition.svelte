<script lang="ts">
	// The marker rides the first child as an ambient prefix (the listItem `- ` model), so the
	// body edits like ordinary prose while the marker stays read-only chrome. Its `[^label]`
	// range is the way back, on the same click the reference took to get here.
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
	// The clickable half: the colon and its space are syntax nobody aims at.
	const marker = $derived(`[^${label}]`);

	const { blockListProps, containerApi, getPresentationMode } = createContainerBlock({
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
					onClick: jumpToFirstReference
				}
			]
		})
	});

	// Resolved on the gesture, never derived: the span's listener is bound once at build time,
	// so a captured path would be the walk's answer from whenever that was.
	function jumpToFirstReference(e: MouseEvent): void {
		if (!isWidgetActivationClick(e.ctrlKey || e.metaKey, getPresentationMode())) return;
		// Skips the leaf's caret clamp and the editor's root click handler on purpose: the
		// jump is the only thing this click does.
		e.preventDefault();
		e.stopPropagation();
		if (!document) return;
		// GFM numbers by first-reference order, so the first reference is the one this
		// definition's number was minted from.
		const first = collectFootnoteReferences(document).find((ref) => ref.label === label);
		if (first) void rects?.navigateTo(first.path, first.end);
	}

	// Where a plain click already acts, so the pointer cue matches the gesture.
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
	/* A gutter rail, not card chrome: the marker itself is the child leaf's prefix span. */
	.footnote-def {
		position: relative;
		margin: 0.4em 0;
		padding-left: 0.9em;
		border-left: 2px solid var(--color-border, #3d4047);
		font-size: 0.95em;
	}

	/* The marker span is built into the child leaf's DOM, outside this component's scope. */
	.footnote-def :global(.footnote-def-marker:hover) {
		text-decoration: underline;
	}

	.footnote-def[data-plain-click-jumps] :global(.footnote-def-marker) {
		cursor: pointer;
	}
</style>
