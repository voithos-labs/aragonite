<script module lang="ts">
	import type { TocOptions } from '@voithos-labs/aragonite-toc';
	import { DEMO_PLUGINS, DEMO_TOC } from './../demo-plugins';

	// This route's own outline depth, declared per instance so the shared set still installs once.
	// `satisfies` because the prop's options are `unknown` to the editor.
	const changelogPlugins = DEMO_PLUGINS.map((entry) =>
		entry === DEMO_TOC ? { plugin: DEMO_TOC, options: { maxDepth: 3 } satisfies TocOptions } : entry
	);
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { Editor } from '#lib/svelte.js';
	import { STORED_THEME_SCRIPT, readTheme, toggleTheme } from '../../../examples/showcase/theme';
	import '../../../examples/showcase/showcase-bar.css';
	import { CHANGELOG_FAMILIES } from './changelog-content';
	import { mountChangelogBar, type ChangelogBarState } from './changelog-bar';
	import './changelog-bar.css';
	import { trackParityDocument } from '../parity-documents.svelte';

	// The showcase's theme, so the two pages match.
	let theme = $state(readTheme());

	// The changelog ships one file per release family; the picker is a `source` prop swap.
	let familyId = $state(CHANGELOG_FAMILIES[0].id);
	const family = $derived(
		CHANGELOG_FAMILIES.find((entry) => entry.id === familyId) ?? CHANGELOG_FAMILIES[0]
	);

	// This route installs no test probes, so `trackParityDocument` is the only thing putting
	// its document under the e2e teardown parity check.
	let editor = $state<ReturnType<typeof Editor>>();
	trackParityDocument(() => editor);

	const barState = $derived<ChangelogBarState>({ family: familyId, theme });

	function mountBar(header: HTMLElement) {
		const bar = mountChangelogBar(
			header,
			{
				families: CHANGELOG_FAMILIES.map((entry) => entry.id),
				showcaseHref: resolve('/'),
				onFamily: (id) => (familyId = id),
				onTheme: () => (theme = toggleTheme(theme))
			},
			untrack(() => barState)
		);
		$effect(() => bar.update(barState));
		return () => bar.destroy();
	}
</script>

<!-- Reading only: the showcase's mode switcher is where the other modes are shown. -->
<div class="changelog aragonite-editor-theme" data-editor-theme={theme}>
	<header class="showcase-header changelog-header" {@attach mountBar}></header>
	<div class="changelog-editor">
		<Editor
			bind:this={editor}
			source={family.document}
			plugins={changelogPlugins}
			presentationMode="reading"
			{theme}
		/>
	</div>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a constant of ours, not user content -->
	{@html STORED_THEME_SCRIPT}
</div>

<style>
	.changelog {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		/* The wrapper holds the theme tokens, so the page around the editor switches with it. */
		background: var(--color-bg, #2c2c2a);
		color: var(--color-text-secondary, #cfcfca);
		font-family: var(--font-ui, system-ui, sans-serif);
	}
	.changelog-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
</style>
