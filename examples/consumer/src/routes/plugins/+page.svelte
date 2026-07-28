<script module lang="ts">
	import { calloutPlugin } from '../../plugins/callout/register';
	import { detailsPlugin } from 'aragonite/plugins/details';
	import { admonitionsPlugin } from 'aragonite/plugins/admonitions';
	import { latexPlugin } from 'aragonite/plugins/latex';
	import { katexRenderer } from 'aragonite/plugins/latex/renderer';
	import { mermaidPlugin } from 'aragonite/plugins/mermaid';
	import { tocPlugin } from 'aragonite/plugins/toc';
	import { highlightOccurrencesPlugin } from 'aragonite/plugins/highlight-occurrences';
	import { emojiPlugin } from 'aragonite/plugins/emoji';
	import { footnotesPlugin } from 'aragonite/plugins/footnotes';

	// Module scope so the factories run once per process, not once per (SSR) render —
	// a re-render minting fresh same-name plugins would trip installPlugins' first-wins
	// dev-warn. The prop installs before the Editor parses `source`, so the seed
	// resolves to plugin kinds; callout/admonitions turn the `:::name` grammar on, so
	// `:::mystery` still renders as the generic directive fallback. latex wires the
	// katex adapter (a consumer devDependency); mermaid installs WITHOUT a renderer —
	// the consumer has no mermaid engine, so its block renders its code statically,
	// exercising the packaged plugin's no-engine fallback from outside the repo. toc
	// turns on the `[[toc]]` leaf (its render lists the seed's headings);
	// highlightOccurrencesPlugin marks every occurrence of the word under the caret.
	//
	// emoji and footnotes share their trigger byte with constructs already in the seed
	// (`:` with `:::name`, `[` with `[[toc]]`), so installing them here is also the
	// outside-the-repo check that the recognizer rungs coexist rather than contest a
	// claim — a mis-ordered priority would eat `:::mystery` or the toc leaf.
	const plugins = [
		calloutPlugin(),
		detailsPlugin(),
		admonitionsPlugin(),
		latexPlugin({ renderer: katexRenderer }),
		mermaidPlugin(),
		tocPlugin(),
		highlightOccurrencesPlugin(),
		emojiPlugin(),
		footnotesPlugin()
	];
</script>

<script lang="ts">
	import { Editor, type EditorInstance } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	const SEED = [
		'# Consumer plugins',
		'',
		'[[toc]]',
		'',
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
		'```mermaid',
		'graph TD',
		'  A --> B',
		'```',
		'',
		':::mystery',
		'Unregistered directive body',
		':::',
		'',
		'Emoji :sparkles: inline',
		'',
		'Footnote reference[^1] in prose',
		'',
		'[^1]: Footnote definition body',
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
