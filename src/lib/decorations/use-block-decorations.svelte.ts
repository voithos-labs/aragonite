/**
 * Applies the block decorations addressed to one path onto the element that renders that block:
 * attributes and badges from effects, classes through the returned getter, which the caller
 * spreads into its own `class` so Svelte keeps owning that attribute.
 */
import type { EditorError } from '../editor-events';
import type { NodeView } from '../core/node-views';
import type { DecorationEngine } from './decoration-state.svelte';
import type { BlockDecoration, DecorationWidgetSpec } from './types';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { acceptedBlockAttrs } from './reserved-attrs';
import { mountDecorationWidget, type MountedDecorationWidget } from './widget-dom';

export interface BlockDecorationDeps {
	getNode: () => NodeView;
	getPath: () => number[];
	getEl: () => HTMLElement | null;
	/** Absent when a block mounts without the editor shell, as unit tests do. */
	engine: DecorationEngine | undefined;
	onRenderError: (error: EditorError) => void;
	/** Why this element cannot hold a badge; when set, every badge is dropped with a dev warning. */
	badgeRefusal?: string;
}

const NO_BLOCK_DECORATIONS: readonly BlockDecoration[] = [];

type BlockWithBadge = BlockDecoration & { badge: DecorationWidgetSpec };

interface MountedBadge {
	dec: BlockDecoration;
	/** Null once the view threw: its badge stays out, and it isn't mounted again for this block. */
	view: MountedDecorationWidget | null;
	wrapper: HTMLElement;
}

export function useBlockDecorations(deps: BlockDecorationDeps): { readonly classes: string[] } {
	const decorations = $derived(
		deps.engine ? deps.engine.paintOf(deps.getNode(), deps.getPath()).blocks : NO_BLOCK_DECORATIONS
	);
	const classes = $derived(decorations.flatMap((d) => d.class ?? []));

	// Set imperatively, not spread, so a source change or dispose removes exactly the
	// keys it applied and leaves the element's own attributes alone.
	$effect(() => {
		const decs = decorations;
		const el = deps.getEl();
		if (!el || decs.length === 0) return;
		const appliedKeys: string[] = [];
		for (const dec of decs) {
			for (const [key, value] of acceptedBlockAttrs(dec.attrs, deps.getPath())) {
				el.setAttribute(key, value);
				appliedKeys.push(key);
			}
		}
		return () => {
			for (const key of appliedKeys) el.removeAttribute(key);
		};
	});

	// Badges go in ahead of the block's content, so BLOCK_CONTENT_SELECTOR
	// (block-content-selector.ts) excludes `.decoration-badge`; keep the two in step.
	let badges: MountedBadge[] = [];
	let badgeHost: HTMLElement | null = null;

	function clearBadges(): void {
		for (const badge of badges) {
			badge.view?.destroy();
			badge.wrapper.remove();
		}
		badges = [];
	}

	function badgeDecorations(decs: readonly BlockDecoration[]): BlockWithBadge[] {
		const withBadge = decs.filter((dec): dec is BlockWithBadge => dec.badge !== undefined);
		if (withBadge.length === 0 || deps.badgeRefusal === undefined) return withBadge;
		const path = deps.getPath();
		withBadge.forEach(() =>
			devWarn('decorations', `block decoration badge dropped: ${deps.badgeRefusal}`, { path })
		);
		return [];
	}

	function mountBadges(el: HTMLElement, decs: BlockWithBadge[]): void {
		const fragment = document.createDocumentFragment();
		for (const dec of decs) {
			const wrapper = document.createElement('div');
			wrapper.className = 'decoration-badge';
			wrapper.dataset.hostContent = '';
			wrapper.setAttribute('contenteditable', 'false');
			const view = mountDecorationWidget(dec.badge, dec, wrapper, (error) =>
				deps.onRenderError({ origin: 'render', error, context: { path: deps.getPath() } })
			);
			if (view) fragment.appendChild(wrapper);
			badges.push({ dec, view, wrapper });
		}
		el.insertBefore(fragment, el.firstChild);
	}

	function updateBadges(decs: BlockWithBadge[]): void {
		badges.forEach((badge, i) => {
			const dec = decs[i];
			if (badge.dec === dec) return;
			badge.dec = dec;
			if (!badge.view || badge.view.update({ decoration: dec })) return;
			badge.view = null;
			badge.wrapper.remove();
		});
	}

	$effect(() => {
		const el = deps.getEl();
		const decs = el ? badgeDecorations(decorations) : [];
		// A badge whose view is unchanged takes `update` rather than a remount.
		const sameViews =
			el === badgeHost &&
			decs.length === badges.length &&
			decs.every((dec, i) => dec.badge.view === badges[i].dec.badge?.view);
		if (sameViews) {
			updateBadges(decs);
			return;
		}
		clearBadges();
		badgeHost = el;
		if (el && decs.length > 0) mountBadges(el, decs);
	});
	$effect(() => clearBadges);

	return {
		get classes() {
			return classes;
		}
	};
}
