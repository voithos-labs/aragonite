<script lang="ts">
	import { Editor, type PresentationMode } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import { installTestProbes } from '../editor/test-probes';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// The second host-scroll shape: `scrollMode="host"` with NOTHING scrollable
	// between the editor and the document, so the window's own viewport is the
	// scrollport and the PAGE scrolls. `/test/flow` covers the other one (an
	// ancestor scroller), and its page is deliberately pinned to 100vh — so the
	// question "what happens when the walk finds no scrollable ancestor at all"
	// had no route to ask it on.

	const ENTRY =
		Array.from(
			{ length: 160 },
			(_, i) => `Paragraph ${i} — lorem ipsum dolor sit amet, consectetur adipiscing elit.`
		).join('\n\n') + '\n';

	// A late-sizing box ABOVE the editor: zero-height until the decode gives the
	// image its intrinsic size, which is the image-decode stall in miniature. A
	// SIBLING of the entry, never a wrapper — a geometry change on the anchor's own
	// ancestor chain suppresses the browser's anchor adjustment for that frame, so a
	// wrapper would manufacture a shift that says nothing about anchoring.
	const LATE_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(
		"<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'></svg>"
	)}`;

	let source = $state(ENTRY);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let presentationMode = $state<PresentationMode>('source');
	let lateImageSrc = $state<string | undefined>(undefined);
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
		// Driven from the spec rather than a control in the page: any button that
		// could be clicked would itself be a non-editor box in the viewport, and the
		// oracle's premise is that nothing but editor content is in view.
		(window as unknown as { __pageScroll?: unknown }).__pageScroll = {
			loadLateImage: () => {
				lateImageSrc = LATE_IMAGE_SRC;
			}
		};
	});
</script>

<div class="page aragonite-editor-theme">
	<div class="filler" data-testid="filler-top">Above the entry</div>
	<img class="late-image" data-testid="late-image" src={lateImageSrc} alt="" />
	<div class="entry" data-testid="entry">
		<Editor bind:this={editor} {source} {keybindings} {presentationMode} scrollMode="host" />
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
