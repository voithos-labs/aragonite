<script lang="ts">
	import { Editor } from '$lib';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// A signal that the page is ready after hydration: once both instances are bound, their mount
	// effects have run, the document-level keydown listeners included, so no shortcut arrives
	// before an editor is listening.
	let left = $state<ReturnType<typeof Editor>>();
	let right = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => left);
	trackParityDocument(() => right);

	$effect(() => {
		if (left && right) (window as unknown as { __editorsReady?: boolean }).__editorsReady = true;
	});
</script>

<!-- The fixture for keybinding-multi-editor.spec.ts; the outside input is a focus target
     belonging to neither editor. -->
<div class="multi-harness aragonite-editor-theme">
	<input data-testid="outside-input" aria-label="outside field" />
	<Editor bind:this={left} source={'# One\n\nAlpha paragraph\n'} />
	<Editor bind:this={right} source={'# Two\n\nBeta paragraph\n'} />
</div>

<style>
	.multi-harness {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		height: 100vh;
		box-sizing: border-box;
	}
	.multi-harness :global(.editor) {
		flex: 1;
		min-height: 0;
		border: 1px solid var(--color-border, #3d4047);
	}
</style>
