<script lang="ts">
	// A host that keeps its note as an object and replaces it on every load, the way a store
	// hands out a fresh record, so `source` re-reads even when the text is unchanged. With `echo`
	// it reloads the note from `getSource()` after every edit.
	import { onMount } from 'svelte';
	import Editor from '$lib/components/Editor.svelte';
	import type { EditorInstance } from '$lib/editor-props';

	let { text, echo = false }: { text: string; echo?: boolean } = $props();

	// svelte-ignore state_referenced_locally
	let note = $state({ text });
	let editor = $state<EditorInstance>();

	export function load(next: string): void {
		note = { text: next };
	}

	export function getEditor(): EditorInstance {
		return editor!;
	}

	onMount(() => {
		if (echo) return editor!.getEvents().on('edit', () => load(editor!.getSource()));
	});
</script>

<Editor bind:this={editor} source={note.text} />
