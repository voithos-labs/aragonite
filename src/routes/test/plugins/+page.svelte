<script lang="ts">
	import { Editor } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import type { PageData } from './$types';
	import { installTestProbes } from '../editor/test-probes';
	import { registerCallout } from './callout/register';
	import { registerDetails } from './details/register';
	import { registerLatex } from './latex/register';

	let { data }: { data: PageData } = $props();

	// Runs before the child <Editor> mounts and parses `source`, so `:::note` /
	// `<details>` resolve to their plugin container kinds and `$…$` to inline math
	// rather than plain prose. If this ordering breaks, the editability gate
	// silently tests a paragraph.
	registerCallout();
	registerDetails();
	registerLatex();

	const CALLOUT_SEED = ':::note Title\nFirst\n:::\n';
	const DETAILS_SEED = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';
	const MATH_SEED = 'Before $x^2$ after\n\nNext\n';

	// The callout is the default document (the landed callout e2e reads it directly);
	// `?seed=details` swaps in the details seed for the collapse route, `?seed=math`
	// an inline-math paragraph. The seed arrives via the load data, so the server and
	// client render the same document. One-time snapshot: the harness never
	// re-navigates client-side, and the test probes then own `source`.
	// svelte-ignore state_referenced_locally
	let source = $state(
		data.seed === 'details' ? DETAILS_SEED : data.seed === 'math' ? MATH_SEED : CALLOUT_SEED
	);
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
