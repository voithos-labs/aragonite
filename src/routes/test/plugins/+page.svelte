<script lang="ts">
	import { Editor } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import { installTestProbes } from '../editor/test-probes';
	import { registerCallout } from './callout/register';

	// Runs before the child <Editor> mounts and parses `source`, so `:::note`
	// resolves to the plugin container kind rather than a plain paragraph. If this
	// ordering breaks, the editability gate silently tests a paragraph instead.
	registerCallout();

	const SEED = ':::note Title\nFirst\n:::\n';

	let source = $state(SEED);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let editor = $state<ReturnType<typeof Editor>>();

	$effect(() => {
		if (!editor) return;
		installTestProbes({
			editor,
			setSource: (md) => {
				source = md;
			},
			setKeybindings: (overrides) => {
				keybindings = overrides;
			}
		});
	});
</script>

<div class="plugins-harness aragonite-editor-theme">
	<Editor bind:this={editor} {source} {keybindings} />
</div>

<style>
	.plugins-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
</style>
