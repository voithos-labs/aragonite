<script lang="ts">
	import type { Document } from '../../core/nodes';
	import type { InlineRangeCommit } from '../../editor-actions/inline-range-commit';
	import type { EditorEvents } from '../../editor-events';
	import type { CaretRestore } from '../../selection/caret-restore';
	import { resolveHref } from '../../core/inline-render';
	import LinkCard from './LinkCard.svelte';
	import { createLinkCardCommitter } from './link-card-commit';
	import type { LinkCardState } from './link-card-state.svelte';
	import { keepsDraft, type MenuCloseCause, type MenuPresence } from '../menu/menu-presence.svelte';
	import type { TextMoves } from '../overlays/text-moves';
	import type { Reading } from '../../schema/reading';
	import type { CommandDispatchContext } from '../../schema/block-commands';
	import { opensLinkCard } from './opens-card';

	// Mounted unconditionally by Editor: the anchoring and dismiss effects must observe the card's
	// target changing, so the open/closed `{#if}` lives here rather than at the mount site.
	let {
		card,
		inlineRange,
		events,
		getDoc,
		getEditorEl,
		measureRange,
		activateLink,
		resolveLinkUrl,
		caretRestore,
		reading,
		menuPresence,
		commands,
		textMoves
	}: {
		card: LinkCardState;
		inlineRange: InlineRangeCommit;
		events: EditorEvents;
		getDoc: () => Document;
		getEditorEl: () => HTMLElement | null;
		measureRange: (path: number[], start: number, end: number) => DOMRect[];
		activateLink: (url: string, event: MouseEvent) => void;
		/** The consumer's href rewrite, the first thing the render path applies. */
		resolveLinkUrl: (rawUrl: string) => string;
		caretRestore: CaretRestore;
		reading: Reading;
		menuPresence: MenuPresence;
		/** The editor's command dispatch, which says what a keypress means at the card's block. */
		commands: CommandDispatchContext;
		textMoves: TextMoves;
	} = $props();

	let cardEl: HTMLDivElement | undefined = $state();
	let cardView: ReturnType<typeof LinkCard> | undefined = $state();

	// Props are stable for the editor's lifetime; reactive values already come in as getters.
	// svelte-ignore state_referenced_locally
	const linkCard = createLinkCardCommitter({
		getDoc,
		getEditorEl,
		getTarget: card.getTarget,
		getCreateTarget: card.getCreateTarget,
		inlineRange,
		events,
		measureRange,
		reading,
		textMoves
	});

	$effect(() => {
		card.getTarget(); // re-run + re-anchor when the card moves to another link
		card.getCreateTarget();
		return linkCard.syncCardToLink(() => cardEl ?? null);
	});

	// A target that stops resolving closes the card, or a later write that makes it resolve
	// again would bring it back holding an old draft.
	$effect(() => {
		const target = card.getTarget();
		if (target && !linkCard.resolve(target)) card.close();
	});

	// A create target is a bare range, which any other write would shift under it; the card's own
	// commit closes it before writing, so only an outside edit closes it here.
	$effect(() => {
		if (!card.getCreateTarget()) return;
		return events.on('edit', () => {
			if (card.getCreateTarget()) card.close();
		});
	});

	// Only a card holding the focus takes Escape and gives the caret back, so beside a live caret a
	// shown source closes on the same press. Any other close but a document swap saves the edit.
	function closeCard(cause: MenuCloseCause): boolean {
		const inCard = cause === 'escape-key' && (cardEl?.contains(document.activeElement) ?? false);
		const edit = keepsDraft(cause) ? cardView?.pendingEdit() : null;
		if (edit) save(edit.url, edit.text);
		card.close();
		if (inCard) void caretRestore.restore();
		return inCard;
	}

	/** Closes the card and writes its edit, the link it edits or the one it creates. */
	function save(url: string, text: string): void {
		const target = card.getTarget();
		const create = card.getCreateTarget();
		// An empty create draft has nothing to write; Enter does nothing rather than closing the
		// card having achieved nothing, which would drop the focus the card holds.
		if (!target && (!create || url.trim() === '')) return;
		card.close();
		if (target) linkCard.commit(target, url, text);
		else if (create) linkCard.commitCreate(create, url, text);
	}

	const opensCard = (e: KeyboardEvent): boolean => opensLinkCard(e, card, getDoc(), commands);

	function remove(): void {
		const target = card.getTarget();
		if (!target) return;
		card.close();
		linkCard.removeLink(target);
	}
</script>

{#if card.getTarget()}
	{@const target = card.getTarget()!}
	{@const resolved = linkCard.resolve(target)}
	{#if resolved}
		<div
			bind:this={cardEl}
			class="md-link-card-anchor"
			{@attach menuPresence.track(closeCard, { edits: true })}
		>
			{#key `${target.path.join(',')}@${target.sourceStart}`}
				<LinkCard
					bind:this={cardView}
					text={resolved.text}
					textEditable={resolved.textEditable}
					url={resolved.url}
					focusEpoch={card.getFocusEpoch()}
					canWrite={linkCard.buildBytes(target, resolved.url) !== null}
					onCommit={save}
					onOpenLink={activateLink}
					onRemove={remove}
					{opensCard}
					resolveHref={(url) => resolveHref({ resolveLinkUrl }, url)}
				/>
			{/key}
		</div>
	{/if}
{:else if card.getCreateTarget()}
	{@const create = card.getCreateTarget()!}
	<div
		bind:this={cardEl}
		class="md-link-card-anchor"
		{@attach menuPresence.track(closeCard, { edits: true })}
	>
		{#key `${create.path.join(',')}@${create.start}-${create.end}`}
			<LinkCard
				bind:this={cardView}
				text={linkCard.createText(create)}
				textEditable={true}
				url=""
				focusEpoch={card.getFocusEpoch()}
				canWrite={true}
				onCommit={save}
				onOpenLink={activateLink}
				{opensCard}
				resolveHref={(url) => resolveHref({ resolveLinkUrl }, url)}
			/>
		{/key}
	</div>
{/if}

<style>
	/* Zero-size positioned box: `syncCardToLink` writes its top/left, the card paints inside it. */
	.md-link-card-anchor {
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
