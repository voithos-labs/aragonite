<script lang="ts">
	import { onMount } from 'svelte';
	import Editor from '$lib/editor/components/Editor.svelte';
	import { parse } from '$lib/editor/core/parser';
	import { DEFAULT_CONTENT } from '$lib/editor/e2e/test-content';
	import { applyTheme, DEFAULT_THEME } from '$lib/theme';

	let source = $state(DEFAULT_CONTENT);
	let editor: ReturnType<typeof Editor>;

	onMount(() => {
		applyTheme(DEFAULT_THEME);
	});

	$effect(() => {
		if (typeof window === 'undefined' || !editor) return;

		(window as any).__test = {
			getSource: () => editor.getSource(),
			setSource: (md: string) => {
				source = md;
			},
			getBlockCount: () => {
				const doc = parse(editor.getSource());
				return doc.children.length;
			},
			getBlockKind: (index: number) => {
				const doc = parse(editor.getSource());
				return doc.children[index]?.kind ?? '';
			}
		};
	});
</script>

<div class="test-harness">
	<Editor bind:this={editor} {source} />
</div>

<style>
	.test-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
</style>
