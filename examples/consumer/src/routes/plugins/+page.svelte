<script module lang="ts">
	import { calloutPlugin } from '../../plugins/callout/register';
	import { detailsPlugin } from 'aragonite/plugins/details';
	import { admonitionsPlugin } from 'aragonite/plugins/admonitions';
	import { latexPlugin } from '../../plugins/latex/register';

	// Module scope so the factories run once per process, not once per (SSR) render —
	// a re-render minting fresh same-name plugins would trip installPlugins' first-wins
	// dev-warn. The prop installs before the Editor parses `source`, so the seed
	// resolves to plugin kinds; callout/admonitions turn the `:::name` grammar on, so
	// `:::mystery` still renders as the generic directive fallback.
	const plugins = [calloutPlugin(), detailsPlugin(), admonitionsPlugin(), latexPlugin()];
</script>

<script lang="ts">
	import { Editor, type EditorInstance } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	const SEED = [
		':::note Title',
		'Callout body',
		':::',
		'',
		'<details open>',
		'<summary>Summary</summary>',
		'',
		'Details body',
		'',
		'</details>',
		'',
		'Math $x^2$ inline',
		'',
		'$$e^{i\\pi} + 1 = 0$$',
		'',
		':::tip Consumer tip',
		'Admonition body',
		':::',
		'',
		':::mystery',
		'Unregistered directive body',
		':::',
		''
	].join('\n');

	let editor = $state<EditorInstance>();

	// Round-trip probe for the boundary smoke specs; runs client-side only.
	$effect(() => {
		if (!editor) return;
		(window as { __consumer?: { getSource: () => string } }).__consumer = {
			getSource: () => editor!.getSource()
		};
	});
</script>

<Editor bind:this={editor} source={SEED} theme="light" {plugins} />
