<script lang="ts">
	import { Editor, type ImageLoadPolicy, type PresentationMode } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import { installTestProbes } from '../editor/test-probes';
	import { trackParityDocument } from '../../parity-documents.svelte';
	import type { PageData } from './$types';

	// The second shape of host scrolling: `scrollMode="host"` with nothing scrollable between
	// the editor and the document, so the window is the scroll container and the page scrolls.
	// `/test/flow` covers the other one, an ancestor scroller pinned to 100vh.

	let { data }: { data: PageData } = $props();

	// No bytes to fetch, so the decode is fast and the intrinsic size is exact.
	const LATE_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(
		"<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'></svg>"
	)}`;

	// Mounted under `imageLoadPolicy="placeholder"` until the spec changes the policy, so the
	// image sizes late inside the editor's own subtree, where the scroll-anchoring opt-out applies.
	const IMAGE_BLOCK_INDEX = 6;
	// A divider shows a drag handle where prose does not; the drag spec grabs this one.
	const HANDLE_BLOCK_INDEX = 30;
	// The default is long enough to turn windowing on; a short `?blocks=` keeps the browser's own
	// scroll anchoring. Built once, so the fixture is the one the spec measured.
	// svelte-ignore state_referenced_locally
	const ENTRY =
		Array.from({ length: data.blocks }, (_, i) =>
			i === IMAGE_BLOCK_INDEX
				? `![late](${LATE_IMAGE_SRC})`
				: i === HANDLE_BLOCK_INDEX
					? '---'
					: `Paragraph ${i} — lorem ipsum dolor sit amet, consectetur adipiscing elit.`
		).join('\n\n') + '\n';

	let source = $state(ENTRY);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let presentationMode = $state<PresentationMode>('source');
	let imageLoadPolicy = $state<ImageLoadPolicy>('placeholder');
	let outerImageSrc = $state<string | undefined>(undefined);
	let editor = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => editor);

	$effect(() => {
		if (!editor) return;
		installTestProbes({
			editor,
			setSource: (md) => (source = md),
			setKeybindings: (overrides) => (keybindings = overrides),
			setPresentationMode: (mode) => (presentationMode = mode)
		});
		// Assigned after `installTestProbes`, so waiting for `__pageScroll` also waits for `__test`.
		// Spec driven, since a page button would be a box in view that isn't the editor's.
		(window as unknown as { __pageScroll?: unknown }).__pageScroll = {
			loadDocumentImage: () => {
				imageLoadPolicy = 'auto';
			},
			loadOuterImage: () => {
				outerImageSrc = LATE_IMAGE_SRC;
			}
		};
	});
</script>

<div class="page aragonite-editor-theme">
	<div class="filler" data-testid="filler-top">Above the entry</div>
	<!-- The comparison case: the same late sizing outside the entry, where the host's own
	     box can still be the browser's scroll anchor. -->
	<img class="late-image" data-testid="outer-image" src={outerImageSrc} alt="" />
	<div class="entry" data-testid="entry">
		<Editor
			bind:this={editor}
			{source}
			{keybindings}
			{presentationMode}
			{imageLoadPolicy}
			scrollMode="host"
			blockDragHandles
		/>
	</div>
	<div class="filler" data-testid="filler-bottom">Below the entry</div>
</div>

<style>
	/* app.css pins the document to `height: 100%; overflow: hidden` for the routes where the
	   editor owns its scroll container; this route is about the page scrolling instead. */
	:global(html),
	:global(body) {
		height: auto;
		overflow: visible;
	}
	/* Short: the user must be able to scroll past it into a viewport holding
	   nothing but editor content. */
	.filler {
		height: 400px;
		padding: 1rem;
		color: var(--color-text-secondary, #888);
	}
	.late-image {
		display: block;
		width: 400px;
		height: auto;
	}
	/* Padding, no overflow: host mode drops the editor's own padding, and the drag handle
	   hangs off the block's left edge, where a wrapper with no room would clip it. */
	.entry {
		padding: 0.75rem 1rem;
	}
</style>
