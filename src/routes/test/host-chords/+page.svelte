<script lang="ts">
	import { Editor } from '#lib/svelte.js';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// A host shaped like a desktop app: a window keydown listener in the capture phase runs its own
	// action on Alt or Ctrl with ←/→ (Back, Forward) unless `claimsChord` says the editor takes it.

	const SOURCE = 'A paragraph to read.\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

	let editor = $state<ReturnType<typeof Editor>>();
	trackParityDocument(() => editor);

	const ran: string[] = [];

	/** `Alt+ArrowLeft` and the like, or null for a key the host binds nothing to. */
	function hostAction(e: KeyboardEvent): string | null {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return null;
		if (e.metaKey || e.shiftKey || e.altKey === e.ctrlKey) return null;
		return `${e.altKey ? 'Alt' : 'Control'}+${e.key}`;
	}

	$effect(() => {
		const onKeydown = (e: KeyboardEvent) => {
			const action = hostAction(e);
			if (!action || editor?.claimsChord(e)) return;
			e.preventDefault();
			e.stopPropagation();
			ran.push(action);
		};
		window.addEventListener('keydown', onKeydown, true);
		(window as unknown as { __hostChords?: unknown }).__hostChords = {
			ran: () => [...ran],
			source: () => editor?.getSource() ?? '',
			caret: () => editor?.getSelection()?.focus.offset ?? null
		};
		return () => window.removeEventListener('keydown', onKeydown, true);
	});
</script>

<div class="host aragonite-editor-theme">
	<Editor bind:this={editor} source={SOURCE} presentationMode="source" />
</div>

<style>
	.host {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
</style>
