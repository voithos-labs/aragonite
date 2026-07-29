<script lang="ts">
	import { Editor, type ImageLoadPolicy, type PresentationMode } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import { installTestProbes } from '../editor/test-probes';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// The second host-scroll shape: `scrollMode="host"` with NOTHING scrollable
	// between the editor and the document, so the window's own viewport is the
	// scrollport and the PAGE scrolls. `/test/flow` covers the other one (an
	// ancestor scroller), and its page is deliberately pinned to 100vh — so the
	// question "what happens when the walk finds no scrollable ancestor at all"
	// had no route to ask it on.

	// 400x300 with no bytes to fetch, so the decode is fast and its intrinsic size
	// is exact. Both late-sizing boxes on this route use it.
	const LATE_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(
		"<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'></svg>"
	)}`;

	// The image-decode stall as DOCUMENT content: an image paragraph near the top,
	// mounted under `imageLoadPolicy="placeholder"` (widget built, `src` unset, zero
	// height) until the spec flips the policy. That is late-sizing content INSIDE the
	// editor's subtree, which is the case the editor's own anchoring opt-out decides.
	const IMAGE_BLOCK_INDEX = 6;
	const ENTRY =
		Array.from({ length: 160 }, (_, i) =>
			i === IMAGE_BLOCK_INDEX
				? `![late](${LATE_IMAGE_SRC})`
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
		// Driven from the spec rather than controls in the page: any button that could
		// be clicked would itself be a non-editor box in the viewport, and the oracle's
		// premise is that nothing but editor content is in view.
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
	<!-- The control arm's grower: the same late sizing OUTSIDE the entry, where the
	     host's own box is still an anchor candidate. -->
	<img class="late-image" data-testid="outer-image" src={outerImageSrc} alt="" />
	<div class="entry" data-testid="entry">
		<Editor
			bind:this={editor}
			{source}
			{keybindings}
			{presentationMode}
			{imageLoadPolicy}
			scrollMode="host"
		/>
	</div>
	<div class="filler" data-testid="filler-bottom">Below the entry</div>
</div>

<style>
	/* app.css pins the document to `height: 100%; overflow: hidden` for the
	   editor-owns-its-scrollport routes. This route's whole subject is the page
	   scrolling, so it hands the scrollport back to the document. */
	:global(html),
	:global(body) {
		height: auto;
		overflow: visible;
	}
	/* Short: the reader must be able to scroll past it into a viewport holding
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
	/* Padding, no overflow: host mode drops the editor's own padding, and the hover
	   drag handle sits at left:-0.85rem — a flush wrapper clips it away and no drag
	   can start. */
	.entry {
		padding: 0.75rem 1rem;
	}
</style>
