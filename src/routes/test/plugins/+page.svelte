<script lang="ts">
	import { Editor } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import type { PageData } from './$types';
	import { installTestProbes } from '../editor/test-probes';
	import { registerCallout } from './callout/register';
	import { registerDetails } from './details/register';
	import { registerLatex } from './latex/register';
	import { activateDirectives } from '$lib/plugin';

	let { data }: { data: PageData } = $props();

	// These run before the child <Editor> mounts and parses `source`, so `:::note` /
	// `<details>` / `$…$` resolve to their plugin kinds rather than plain prose — if the
	// ordering breaks, the editability gate silently tests a paragraph. activateDirectives()
	// turns on the generic `:::name` grammar + render (the generic-directive e2e needs a real
	// editing surface); the dogfoods add their own names on top, each idempotently re-activating.
	activateDirectives();
	registerCallout();
	registerDetails();
	registerLatex();

	const CALLOUT_SEED = ':::note Title\nFirst\n:::\n';
	const DETAILS_SEED = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';
	const MATH_SEED = 'Before $x^2$ after\n\nNext\n';
	// Math on the first visual line; a soft-wrapped second line (pre-wrap renders the
	// internal newline as a break) column-aligns real text beneath the widget, for the
	// reveal hit-test's X-and-Y coverage.
	const MATH_MULTILINE_SEED = '$x^2$ first line padding\nsecond visual line here\n\nNext\n';
	// A block `$$…$$` leaf between two paragraphs, so the block-math e2e can drive
	// focus/click reveal, blur re-render, and arrow nav in and out of the block.
	const MATH_BLOCK_SEED = 'Before\n\n$$x^2$$\n\nAfter\n';
	// A multi-line `aligned` fence: the render must survive internal `\n`s (A7), and
	// the revealed source must stay a single text node so the offset walk is exact.
	const MATH_BLOCK_MULTILINE_SEED =
		'Before\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nAfter\n';

	// The callout is the default document (the landed callout e2e reads it directly);
	// `?seed=details` swaps in the details seed for the collapse route, `?seed=math` an
	// inline-math paragraph, `?seed=math-multiline` the two-line reveal-hit-test doc,
	// `?seed=mathblock` a block `$$…$$` leaf, `?seed=mathblock-multiline` an `aligned`
	// fence. The seed arrives via the load data, so the server and client render the
	// same document. One-time snapshot: the harness never re-navigates client-side, and
	// the test probes then own `source`.
	// svelte-ignore state_referenced_locally
	let source = $state(
		data.seed === 'details'
			? DETAILS_SEED
			: data.seed === 'math'
				? MATH_SEED
				: data.seed === 'math-multiline'
					? MATH_MULTILINE_SEED
					: data.seed === 'mathblock'
						? MATH_BLOCK_SEED
						: data.seed === 'mathblock-multiline'
							? MATH_BLOCK_MULTILINE_SEED
							: CALLOUT_SEED
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
