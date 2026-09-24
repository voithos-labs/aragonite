<script module lang="ts">
	import { parrotPlugin } from '$lib/plugins/parrot';
	import { emojiPlugin } from '$lib/plugins/emoji';
	import { admonitionsPlugin } from '$lib/plugins/admonitions';
	import { DEMO_LATEX, DEMO_TOC } from '../../../demo-plugins';
	import { blockBadgePlugin } from '../block-badge/block-badge-plugin';
	import { docStatsPlugin } from '../doc-stats/doc-stats-plugin';

	// Module scope so the entry arrays stay identity-stable across (SSR) renders.
	const listedPlugins = [
		parrotPlugin(),
		blockBadgePlugin,
		emojiPlugin(),
		admonitionsPlugin(),
		DEMO_LATEX
	];
	const unlistedPlugins = [docStatsPlugin];

	// The `?reads` variant: live mode, so the link card and pending marks run, and the toc in both
	// editors, so its labels show which inline syntax each editor reads.
	const listedReadsPlugins = [...listedPlugins, DEMO_TOC];
	const unlistedReadsPlugins = [...unlistedPlugins, DEMO_TOC];
	const READS_SEED = '# Title $*x*$\n\n[[toc]]\n\na :smile: b\n\na $x$ b\n';

	// Each editor parses the seed in its own grammar: the first reads a parrot block, an emoji, a
	// note and math; the second, which listed none of those plugins, reads the parrot bytes as a
	// paragraph, the shortcode and the dollars as text, and the fence as the generic directive.
	const SEED =
		'# Heading :smile:\n\n%%parrot party responsibly\n\n:::note\n\nTip\n\n:::\n\n$**x**$\n\nBody\n';
</script>

<script lang="ts">
	import { Editor, serialize } from '$lib';
	import { parseConverges } from '$lib/testing/parse-convergence';
	import { trackParityDocument } from '../../../parity-documents.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const seed = $derived(data.reads ? READS_SEED : SEED);
	const mode = $derived(data.reads ? 'live' : 'source');

	let listing = $state<ReturnType<typeof Editor>>();
	let notListing = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => listing);
	trackParityDocument(() => notListing);

	// Nothing in the DOM shows which chords an instance took: a chord this one never took is a
	// chord the host keeps, and only `reservedChords` and `claimsChord` answer that. Recorded
	// from a real keystroke as it passes, so the spec presses the keys rather than inventing an
	// event.
	const claims: { listing: boolean; notListing: boolean }[] = [];

	$effect(() => {
		const record = (event: KeyboardEvent) => {
			claims.push({
				listing: listing?.claimsChord(event) ?? false,
				notListing: notListing?.claimsChord(event) ?? false
			});
		};
		document.addEventListener('keydown', record, true);
		(window as unknown as { __activation?: unknown }).__activation = {
			reserved: (pane: 'listing' | 'notListing') => [
				...((pane === 'listing' ? listing : notListing)?.reservedChords() ?? [])
			],
			claims: () => claims,
			converged: (pane: 'listing' | 'notListing') => {
				const editor = pane === 'listing' ? listing : notListing;
				return !!editor && parseConverges(editor.__test.getDocument(), editor.__test.getGrammar());
			},
			source: (pane: 'listing' | 'notListing') => {
				const editor = pane === 'listing' ? listing : notListing;
				return editor ? serialize(editor.__test.getDocument()) : '';
			}
		};
		return () => document.removeEventListener('keydown', record, true);
	});
</script>

<div class="activation-harness aragonite-editor-theme">
	<div class="pane" data-testid="editor-listing">
		<h2>lists parrot, block-badge, emoji, admonitions, latex</h2>
		<Editor
			bind:this={listing}
			source={seed}
			plugins={data.reads ? listedReadsPlugins : listedPlugins}
			presentationMode={mode}
		/>
	</div>
	<div class="pane" data-testid="editor-not-listing">
		<h2>lists neither</h2>
		<Editor
			bind:this={notListing}
			source={seed}
			plugins={data.reads ? unlistedReadsPlugins : unlistedPlugins}
			presentationMode={mode}
		/>
	</div>
</div>

<style>
	.activation-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
	}
	.pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--color-ui-muted, #ccc);
	}
	.pane h2 {
		margin: 0;
		padding: 0.4rem;
		font-size: 0.85rem;
	}
</style>
