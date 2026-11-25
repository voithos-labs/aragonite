<script module lang="ts">
	import { calloutPlugin } from '../../plugins/callout/register';
	import { details } from '@voithos-labs/aragonite-details';
	import { admonitions } from '@voithos-labs/aragonite-admonitions';
	import { latex } from '@voithos-labs/aragonite-latex';
	import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';
	import { mermaid } from '@voithos-labs/aragonite-mermaid';
	import { toc } from '@voithos-labs/aragonite-toc';
	import { highlightOccurrences } from '@voithos-labs/aragonite-highlight-occurrences';
	import { emoji } from '@voithos-labs/aragonite-emoji';
	import { footnotes } from '@voithos-labs/aragonite-footnotes';
	import { highlight } from '@voithos-labs/aragonite-highlight';
	import { highlightJs } from '@voithos-labs/aragonite-highlight/renderer';

	// Module scope so the factories run once per process, not once per (SSR) render: a
	// re-render minting fresh same-name plugins trips installPlugins' first-wins dev-warn.
	const plugins = [
		calloutPlugin(),
		details,
		admonitions,
		latex({ renderer: katexRenderer }),
		// No renderer: the consumer wires no mermaid engine, so this exercises the packaged
		// plugin's no-engine fallback from outside the repo.
		mermaid,
		toc,
		highlightOccurrences,
		// Trigger bytes shared with the seed's `:::name` and `[[toc]]`: listed here to prove the
		// readings coexist rather than contest a claim.
		emoji,
		footnotes,
		highlight({ renderer: highlightJs() })
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
