<script lang="ts">
	import { Editor } from '$lib';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// A post-hydration readiness signal: once both editor instances are bound, their
	// mount effects (including each document-level keydown listener) have run. Tests
	// wait on this before pressing chords, so a chord never races a cold editor.
	let left = $state<ReturnType<typeof Editor>>();
	let right = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => left);
	trackParityDocument(() => right);

	$effect(() => {
		if (left && right) (window as unknown as { __editorsReady?: boolean }).__editorsReady = true;
	});
</script>

<!-- Two plain editors on one page: the fixture for multi-instance document-chord
     containment (keybinding-multi-editor.spec.ts). The outside input is a focus
     target that belongs to neither editor. -->
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
