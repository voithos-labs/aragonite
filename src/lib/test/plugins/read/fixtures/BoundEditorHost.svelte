<script lang="ts">
	// A Svelte host binding the editor: `landed` hears the handle's element at the moment the
	// host's `bind:this` lands, before any effect of the host's own runs.
	import Editor from '#lib/components/Editor.svelte';

	let { landed }: { landed: (element: HTMLElement | undefined) => void } = $props();
	let editor: Editor | undefined = $state();

	function bound(next: Editor | undefined): void {
		editor = next;
		if (next) landed(next.element);
	}
</script>

<Editor bind:this={() => editor, bound} source={'one\n'} />
