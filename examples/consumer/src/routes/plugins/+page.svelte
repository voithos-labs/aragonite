<script module lang="ts">
	import { calloutPlugin } from '../../plugins/callout/register';
	import { detailsPlugin } from '@voithos-labs/aragonite/plugins/details';
	import { admonitionsPlugin } from '@voithos-labs/aragonite/plugins/admonitions';
	import { latexPlugin } from '@voithos-labs/aragonite/plugins/latex';
	import { katexRenderer } from '@voithos-labs/aragonite/plugins/latex/renderer';
	import { mermaidPlugin } from '@voithos-labs/aragonite/plugins/mermaid';
	import { tocPlugin } from '@voithos-labs/aragonite/plugins/toc';
	import { highlightOccurrencesPlugin } from '@voithos-labs/aragonite/plugins/highlight-occurrences';
	import { emojiPlugin } from '@voithos-labs/aragonite/plugins/emoji';
	import { footnotesPlugin } from '@voithos-labs/aragonite/plugins/footnotes';

	// Module scope so the factories run once per process, not once per (SSR) render: a
	// re-render minting fresh same-name plugins trips installPlugins' first-wins dev-warn.
	const plugins = [
		calloutPlugin(),
		detailsPlugin(),
		admonitionsPlugin(),
		latexPlugin({ renderer: katexRenderer }),
		// No renderer: the consumer wires no mermaid engine, so this exercises the packaged
		// plugin's no-engine fallback from outside the repo.
		mermaidPlugin(),
		tocPlugin(),
		highlightOccurrencesPlugin(),
		// Trigger bytes shared with the seed's `:::name` and `[[toc]]`: installed here to prove
		// the recognizer rungs coexist rather than contest a claim.
		emojiPlugin(),
		footnotesPlugin()
	];
</script>

<script lang="ts">
	import { Editor, type EditorInstance } from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';
	import { PLUGINS_SEED } from './seed';

	let editor = $state<EditorInstance>();

	// Round-trip probe for the boundary smoke specs.
	$effect(() => {
		if (!editor) return;
		(window as { __consumer?: { getSource: () => string } }).__consumer = {
			getSource: () => editor!.getSource()
		};
	});
</script>

<Editor bind:this={editor} source={PLUGINS_SEED} theme="light" {plugins} />
