<script lang="ts">
	import { Editor, type EditorSelection } from '$lib';
	import { nodeAt } from '$lib/tree-operations/node-primitives';
	import { trackParityDocument } from '../../parity-documents.svelte';

	// Journal shape: two entries in one ancestor scroll container, plus a clipped pane no scroll
	// can bring into view. Every editor runs `scrollMode="host"`, so the page owns the scroll.

	// The third block is a divider: it has the drag handle prose never shows, so the autoscroll
	// drag spec has something to grab.
	function entry(label: string, count: number): string {
		return (
			Array.from({ length: count }, (_, i) =>
				i === 2 ? '---' : `${label} paragraph ${i} — lorem ipsum dolor sit amet, consectetur.`
			).join('\n\n') + '\n'
		);
	}

	// Every entry is long enough to turn windowing on by estimated height, so "no spacers" below
	// says something about the mode rather than about a small document.
	const ENTRY_A = entry('Alpha', 200);
	const ENTRY_B = entry('Beta', 120);
	const CLIPPED = entry('Clipped', 60);

	// A list (a direct `{#each}` whose items hold block lists of their own) and a table (the
	// grid), each long enough to turn windowing on: the child lists a journal entry nests.
	const NESTED = [
		'Nested entry intro.',
		Array.from({ length: 120 }, (_, i) => `- item ${i}`).join('\n'),
		['| col a | col b |', '| --- | --- |']
			.concat(Array.from({ length: 120 }, (_, i) => `| r${i}a | r${i}b |`))
			.join('\n')
	].join('\n\n');

	// The entry with a header slot: the host's own content inside an editor that does not own
	// its scroll. Short, because what it tests is the slot, not how much the mode mounts.
	const HEADER_ENTRY = entry('Header', 40);

	type EditorHandle = ReturnType<typeof Editor>;
	let editors = $state<Record<string, EditorHandle | undefined>>({});
	const ids = ['a', 'b', 'nested', 'clipped', 'header'];

	// Toggled from a control fixed to the page: a button in the flow would be scrolled into
	// view by the click, moving the very scrollTop the compensation contract is about.
	let headerTall = $state(false);

	for (const id of ids) trackParityDocument(() => editors[id]);

	// One handle per instance, addressed by id: `installTestProbes` binds one `window.__test`
	// to one editor, which cannot describe a route holding several.
	$effect(() => {
		if (!ids.every((id) => editors[id])) return;
		(window as unknown as { __flow?: unknown }).__flow = {
			getSource: (id: string) => editors[id]?.getSource() ?? null,
			blockCount: (id: string) => editors[id]?.__test.getDocument().children.length ?? null,
			// The children of the node at `path`: the count in the CST that a nested list's
			// mounted DOM is compared against.
			childCount: (id: string, path: number[]) => {
				const doc = editors[id]?.__test.getDocument();
				return doc ? (nodeAt(doc, path)?.children?.length ?? null) : null;
			},
			scrollTo: (id: string, path: number[], opts?: { block?: 'nearest' | 'center' }) =>
				editors[id]?.getRects().scrollTo(path, opts) ?? Promise.resolve(null),
			// Its promise that a block given real focus ends up in view goes through the same
			// in-view read as scrollTo, which depends on the scroll mode.
			setSelection: (id: string, selection: EditorSelection) =>
				editors[id]?.setSelection(selection) ?? Promise.resolve(null),
			blockRect: (id: string, path: number[]) => {
				const r = editors[id]?.getRects().blockRect(path);
				return r ? { top: r.top, bottom: r.bottom } : null;
			}
		};
	});
</script>

{#snippet entryHero()}
	<div class="entry-hero" data-testid="flow-header" style:height={headerTall ? '240px' : '80px'}>
		Entry chrome
	</div>
{/snippet}

<div class="flow-page aragonite-editor-theme">
	<div class="flow-scroller" data-testid="scroller">
		<div class="filler" data-testid="filler-top">Above the journal</div>
		<div class="entry card" data-testid="entry-a">
			<Editor bind:this={editors.a} source={ENTRY_A} scrollMode="host" blockDragHandles />
		</div>
		<div class="entry card" data-testid="entry-b">
			<Editor bind:this={editors.b} source={ENTRY_B} scrollMode="host" />
		</div>
		<div class="entry card" data-testid="entry-nested">
			<Editor bind:this={editors.nested} source={NESTED} scrollMode="host" searchBar={false} />
		</div>
		<!-- Last, so the entries above keep the offsets the other specs scroll to. -->
		<div class="entry card" data-testid="entry-header">
			<Editor
				bind:this={editors.header}
				source={HEADER_ENTRY}
				scrollMode="host"
				header={entryHero}
			/>
		</div>
		<div class="filler" data-testid="filler-bottom">Below the journal</div>
	</div>
	<!-- Fixed, so adding it takes no width from the scroller (whose measurements the
	     other specs pin) and the click cannot scroll the journal. -->
	<button
		type="button"
		class="header-toggle"
		data-testid="flow-header-toggle"
		onclick={() => (headerTall = !headerTall)}
	>
		Entry header: {headerTall ? 'tall' : 'short'}
	</button>
	<!-- Outside the scroll container, in a box that clips rather than scrolls: nothing can
	     bring its lower blocks into view, so scrolling to one there must report false. -->
	<div class="clipped-pane" data-testid="entry-clipped">
		<div class="card">
			<Editor bind:this={editors.clipped} source={CLIPPED} scrollMode="host" searchBar={false} />
		</div>
	</div>
</div>

<style>
	/* Fixed to the viewport so the page never scrolls: the only scroll container is
	   .flow-scroller, which the clipped pane sits outside of on purpose. */
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
	/* The rounded card matches the "scrolls or clips" test but does neither, so code that
	   stopped at the innermost match would autoscroll an element that cannot move. The padding
	   is needed: host mode drops the editor's own, and the drag handle hangs off to the left. */
	.card {
		overflow: hidden;
		border-radius: 8px;
		padding: 0.75rem 1rem;
	}
	.clipped-pane {
		flex: 0 0 320px;
		height: 240px;
		overflow: clip;
	}
	.entry-hero {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
	}
	.header-toggle {
		position: fixed;
		right: 8px;
		bottom: 8px;
		z-index: 10;
	}
</style>
