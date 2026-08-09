<script lang="ts">
	import type { Document } from '../../core/nodes';
	import type { UndoController } from '../../editor-actions/deps';
	import type { EditorEvents } from '../../editor-events';
	import type { LinkReferenceResolverRef } from '../../editor-keys';
	import type { GrammarView } from '../../schema/block-openers';
	import type { CaretRestore } from '../../selection/caret-restore';
	import { resolveHref } from '../../core/inline-render';
	import LinkCard from './LinkCard.svelte';
	import { createLinkCardCommitter } from './link-card-commit';
	import type { LinkCardState } from './link-card-state.svelte';

	// Mounted unconditionally by Editor: the anchoring and dismiss effects must observe the card's
	// target changing, so the open/closed `{#if}` lives here rather than at the mount site.
	let {
		card,
		controller,
		events,
		getDoc,
		getEditorEl,
		measureRange,
		landCaret,
		activateLink,
		resolveLinkUrl,
		caretRestore,
		linkRef,
		grammar
	}: {
		card: LinkCardState;
		controller: UndoController;
		events: EditorEvents;
		getDoc: () => Document;
		getEditorEl: () => HTMLElement | null;
		measureRange: (path: number[], start: number, end: number) => DOMRect[];
		landCaret: (path: number[], offset: number) => Promise<boolean>;
		activateLink: (url: string, event: MouseEvent) => void;
		/** The consumer's href rewrite, the render path's first funnel stage. */
		resolveLinkUrl: (rawUrl: string) => string;
		caretRestore: CaretRestore;
		linkRef?: LinkReferenceResolverRef;
		grammar?: GrammarView;
	} = $props();

	let cardEl: HTMLDivElement | undefined = $state();

	// Props are stable for the editor's lifetime; reactive values already cross as getters.
	// svelte-ignore state_referenced_locally
	const linkCard = createLinkCardCommitter({
		getDoc,
		getEditorEl,
		getTarget: card.getTarget,
		controller,
		events,
		measureRange,
		landCaret,
		linkRef,
		grammar
	});

	$effect(() => {
		card.getTarget(); // re-run + re-anchor when the card moves to another link
		return linkCard.syncCardToLink(() => cardEl ?? null);
	});

	// A target that stops resolving unrenders the card but leaves the state set, so its
	// document-capture listeners live on and the next write that makes it resolve again
	// resurrects it holding a draft from before. Closing is the only honest answer.
	$effect(() => {
		const target = card.getTarget();
		if (target && !linkCard.resolve(target)) card.close();
	});

	// An outside press is a non-destructive dismiss and leaves the caret where it just landed —
	// the search bar's blur policy, and TableActionMenu's split between Escape and a click away.
	// Escape is document-level because the opening click leaves the caret in the DOCUMENT: the
	// card is chrome beside a live caret until the user steps into it, and both states close.
	$effect(() => {
		if (!card.getTarget()) return;
		const onPointerDown = (e: PointerEvent) => {
			const el = e.target as Element | null;
			if (el?.closest('[data-link-card]')) return;
			card.close();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			// A composing Escape cancels the IME's conversion, not the card.
			if (e.key !== 'Escape' || e.isComposing) return;
			const inCard = cardEl?.contains(document.activeElement) ?? false;
			// Only a card that HOLDS the focus consumes the key and owes the caret back; beside a
			// live caret it just closes, leaving Escape to whatever else was listening.
			if (inCard) {
				e.preventDefault();
				e.stopPropagation();
			}
			card.close();
			if (inCard) caretRestore.restore();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	function commit(url: string): void {
		const target = card.getTarget();
		if (!target) return;
		card.close();
		linkCard.commitUrl(target, url);
	}

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
		<div bind:this={cardEl} class="md-link-card-anchor">
			{#key `${target.path.join(',')}@${target.sourceStart}`}
				<LinkCard
					url={resolved.url}
					focusEpoch={card.getFocusEpoch()}
					canWrite={linkCard.buildBytes(target, resolved.url) !== null}
					onCommit={commit}
					onOpenLink={activateLink}
					onRemove={remove}
					resolveHref={(url) => resolveHref({ resolveLinkUrl }, url)}
				/>
			{/key}
		</div>
	{/if}
{/if}

<style>
	/* Zero-size positioned box: `syncCardToLink` writes its top/left, the card paints inside it. */
	.md-link-card-anchor {
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
