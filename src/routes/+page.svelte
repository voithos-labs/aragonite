<script module lang="ts">
	import { admonitionsPlugin } from '$lib/plugins/admonitions';
	import { detailsPlugin } from '$lib/plugins/details';
	import { tocPlugin } from '$lib/plugins/toc';
	import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
	import { latexPlugin } from '$lib/plugins/latex';
	import { katexRenderer } from '$lib/plugins/latex/renderer';
	import { mermaidPlugin } from '$lib/plugins/mermaid';
	import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';

	// The consumer shape: import each bundled plugin from its subpath, inject the
	// engine adapters, and hand the whole set to the set-once `plugins` prop. Built
	// once at module scope so the factories run once per process, not once per
	// (SSR) render — re-minting same-name plugins each render trips installPlugins'
	// first-wins dev-warn, and a stable array is what a real consumer copies.
	const showcasePlugins = [
		admonitionsPlugin(),
		detailsPlugin(),
		tocPlugin(),
		highlightOccurrencesPlugin,
		latexPlugin({ renderer: katexRenderer }),
		mermaidPlugin({ renderer: mermaidRenderer })
	];
</script>

<script lang="ts">
	import { Editor } from '$lib';
	import { SHOWCASE_DOCUMENT } from './showcase-content';
</script>

<div class="showcase aragonite-editor-theme">
	<header class="showcase-header">
		<span class="showcase-title">aragonite</span>
		<span class="showcase-tag">showcase</span>
		<a class="showcase-link" href="https://github.com/voithos-labs/aragonite/tree/main/docs">docs</a
		>
	</header>
	<div class="showcase-editor">
		<Editor source={SHOWCASE_DOCUMENT} plugins={showcasePlugins} />
	</div>
</div>

<style>
	.showcase {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.showcase-header {
		flex: 0 0 auto;
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
		font-family: var(--font-editor, ui-monospace, monospace);
	}
	.showcase-title {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.showcase-tag {
		font-size: 0.85rem;
		color: var(--color-text-secondary, #888);
	}
	.showcase-link {
		margin-left: auto;
		font-size: 0.85rem;
		color: var(--color-accent, #567b67);
	}
	.showcase-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
</style>
