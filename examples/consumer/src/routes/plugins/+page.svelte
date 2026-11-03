<script module lang="ts">
	import { calloutPlugin } from '../../plugins/callout/register';
	import { detailsPlugin } from '@voithos-labs/aragonite-details';
	import { admonitionsPlugin } from '@voithos-labs/aragonite-admonitions';
	import { latexPlugin } from '@voithos-labs/aragonite-latex';
	import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';
	import { mermaidPlugin } from '@voithos-labs/aragonite-mermaid';
	import { tocPlugin } from '@voithos-labs/aragonite-toc';
	import { highlightOccurrencesPlugin } from '@voithos-labs/aragonite-highlight-occurrences';
	import { emojiPlugin } from '@voithos-labs/aragonite-emoji';
	import { footnotesPlugin } from '@voithos-labs/aragonite-footnotes';

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
	import { type EditorInstance } from '@voithos-labs/aragonite';
	import { Editor } from '@voithos-labs/aragonite/svelte';
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
