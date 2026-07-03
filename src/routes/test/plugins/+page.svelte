<script lang="ts">
	import { Editor } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import { installTestProbes } from '../editor/test-probes';
	import { registerCallout } from './callout/register';
	import { registerDetails } from './details/register';

	// Runs before the child <Editor> mounts and parses `source`, so `:::note` /
	// `<details>` resolve to their plugin container kinds rather than plain prose.
	// If this ordering breaks, the editability gate silently tests a paragraph.
	registerCallout();
	registerDetails();

	const CALLOUT_SEED = ':::note Title\nFirst\n:::\n';
	const DETAILS_SEED = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';

	// The callout is the default document (the landed callout e2e read it directly);
	// `?seed=details` swaps in the details seed for the Task 4-5 collapse route,
	// leaving the default document — and those tests — untouched.
	function initialSource(): string {
		if (typeof window === 'undefined') return CALLOUT_SEED;
		return new URLSearchParams(window.location.search).get('seed') === 'details'
			? DETAILS_SEED
			: CALLOUT_SEED;
	}

	let source = $state(initialSource());
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
