<script module lang="ts">
	import { parrotPlugin } from '$lib/plugins/parrot';
	import { blockBadgePlugin } from '../block-badge/block-badge-plugin';
	import { docStatsPlugin } from '../doc-stats/doc-stats-plugin';

	// Module scope so the entry arrays stay identity-stable across (SSR) renders.
	const listedPlugins = [parrotPlugin(), blockBadgePlugin];
	const unlistedPlugins = [docStatsPlugin];

	// The listing editor renders first, so the parrot opener is live before the second editor
	// parses: both hold a parrot CST node, and only the second resolves no component for it.
	const SEED = '# Heading\n\n%%parrot party responsibly\n\nBody\n';
</script>

<script lang="ts">
	import { Editor } from '$lib';
	import { trackParityDocument } from '../../../parity-documents.svelte';

	let listing = $state<ReturnType<typeof Editor>>();
	let notListing = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => listing);
	trackParityDocument(() => notListing);

	// The chord half of activation has no DOM tell: a chord this instance never claimed is one
	// the host keeps, and only `reservedChords`/`claimsChord` answer that. Recorded from a real
	// keystroke on the way past, so the spec presses the chord rather than fabricating one.
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
			claims: () => claims
		};
		return () => document.removeEventListener('keydown', record, true);
	});
</script>

<div class="activation-harness aragonite-editor-theme">
	<div class="pane" data-testid="editor-listing">
		<h2>lists parrot + block-badge</h2>
		<Editor bind:this={listing} source={SEED} plugins={listedPlugins} />
	</div>
	<div class="pane" data-testid="editor-not-listing">
		<h2>lists neither</h2>
		<Editor bind:this={notListing} source={SEED} plugins={unlistedPlugins} />
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
