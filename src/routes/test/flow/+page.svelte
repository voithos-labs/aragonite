<script lang="ts">
	import { Editor, type EditorSelection } from '$lib';
	import { nodeAt } from '$lib/tree-operations/node-ops';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// Journal shape: two entries in ONE ancestor scroller, plus a clipped pane whose
	// content no scroll can reveal (the honest-reveal arm). Every editor here runs
	// `scrollMode="host"`, so the page — not the editor — owns the scroll.

	function entry(label: string, count: number): string {
		return (
			Array.from(
				{ length: count },
				(_, i) => `${label} paragraph ${i} — lorem ipsum dolor sit amet, consectetur.`
			).join('\n\n') + '\n'
		);
	}

	// Every entry clears the windowing activation watermark on estimated height, so
	// "no spacers" below is a statement about the mode, not about a small document.
	const ENTRY_A = entry('Alpha', 200);
	const ENTRY_B = entry('Beta', 120);
	const CLIPPED = entry('Clipped', 60);

	// A list (a direct-`{#each}` scope whose items are themselves BlockList-bearing
	// scopes) and a table (the grid scope), each over the watermark: the nested
	// windowing scopes a journal entry really contains.
	const NESTED = [
		'Nested entry intro.',
		Array.from({ length: 120 }, (_, i) => `- item ${i}`).join('\n'),
		['| col a | col b |', '| --- | --- |']
			.concat(Array.from({ length: 120 }, (_, i) => `| r${i}a | r${i}b |`))
			.join('\n')
	].join('\n\n');

	type EditorHandle = ReturnType<typeof Editor>;
	let editors = $state<Record<string, EditorHandle | undefined>>({});
	const ids = ['a', 'b', 'nested', 'clipped'];

	for (const id of ids) trackParityDocument(() => editors[id]);

	// One handle per instance, addressed by id — `installTestProbes` binds a single
	// `window.__test` to one editor, which can't express a multi-instance route.
	$effect(() => {
		if (!ids.every((id) => editors[id])) return;
		(window as unknown as { __flow?: unknown }).__flow = {
			getSource: (id: string) => editors[id]?.getSource() ?? null,
			blockCount: (id: string) => editors[id]?.__test.getDocument().children.length ?? null,
			// Children of the node at `path` — the CST-side count a nested scope's
			// mounted-DOM census is compared against.
			childCount: (id: string, path: number[]) => {
				const doc = editors[id]?.__test.getDocument();
				return doc ? (nodeAt(doc, path)?.children?.length ?? null) : null;
			},
			scrollTo: (id: string, path: number[], opts?: { block?: 'nearest' | 'center' }) =>
				editors[id]?.getRects().scrollTo(path, opts) ?? Promise.resolve(null),
			// Task 1's door, whose "a true focus block is IN VIEW" contract routes
			// through the same mode-dependent in-view read as scrollTo.
			setSelection: (id: string, selection: EditorSelection) =>
				editors[id]?.setSelection(selection) ?? Promise.resolve(null),
			blockRect: (id: string, path: number[]) => {
				const r = editors[id]?.getRects().blockRect(path);
				return r ? { top: r.top, bottom: r.bottom } : null;
			}
		};
	});
</script>

<div class="flow-page aragonite-editor-theme">
	<div class="flow-scroller" data-testid="scroller">
		<div class="filler" data-testid="filler-top">Above the journal</div>
		<div class="entry" data-testid="entry-a">
			<Editor bind:this={editors.a} source={ENTRY_A} scrollMode="host" />
		</div>
		<div class="entry" data-testid="entry-b">
			<Editor bind:this={editors.b} source={ENTRY_B} scrollMode="host" />
		</div>
		<div class="entry" data-testid="entry-nested">
			<Editor bind:this={editors.nested} source={NESTED} scrollMode="host" searchBar={false} />
		</div>
		<div class="filler" data-testid="filler-bottom">Below the journal</div>
	</div>
	<!-- Outside the scroller, in a box that CLIPS rather than scrolls: nothing can
	     bring its lower blocks into view, so a reveal there must report false. -->
	<div class="clipped-pane" data-testid="entry-clipped">
		<Editor bind:this={editors.clipped} source={CLIPPED} scrollMode="host" searchBar={false} />
	</div>
</div>

<style>
	/* Fixed to the viewport so the PAGE never scrolls: the only scrollport is
	   .flow-scroller, which the clipped pane is deliberately outside of. */
	.flow-page {
		display: flex;
		align-items: flex-start;
		height: 100vh;
		overflow: hidden;
	}
	.flow-scroller {
		flex: 1;
		height: 100vh;
		overflow-y: auto;
		min-width: 0;
	}
	.filler {
		height: 1000px;
		padding: 1rem;
		color: var(--color-text-secondary, #888);
	}
	.entry {
		margin: 1rem;
	}
	.clipped-pane {
		flex: 0 0 320px;
		height: 240px;
		overflow: clip;
	}
</style>
