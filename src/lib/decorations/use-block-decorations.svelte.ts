/**
 * Applies the block decorations addressed to one path onto the element that renders that block:
 * attributes and badges from effects, classes through the returned getter, which the caller
 * spreads into its own `class` so Svelte keeps owning that attribute.
 */
import type { EditorError } from '../editor-events';
import type { DecorationEngine } from './decoration-state.svelte';
import type { BlockDecoration } from './types';
import { acceptedBlockAttrs } from './reserved-attrs';
import { mountDecorationWidget } from './widget-dom';

export interface BlockDecorationDeps {
	getPath: () => number[];
	getEl: () => HTMLElement | null;
	/** Absent when a block mounts without the editor shell, as unit tests do. */
	engine: DecorationEngine | undefined;
	onRenderError: (error: EditorError) => void;
}

const NO_BLOCK_DECORATIONS: BlockDecoration[] = [];

export function useBlockDecorations(deps: BlockDecorationDeps): { readonly classes: string[] } {
	const decorations = $derived(
		deps.engine ? deps.engine.blockDecorationsForPath(deps.getPath()) : NO_BLOCK_DECORATIONS
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
	$effect(() => {
		const decs = decorations;
		const el = deps.getEl();
		if (!el) return;
		const destroys: Array<() => void> = [];
		const badges = document.createDocumentFragment();
		for (const dec of decs) {
			if (!dec.badge) continue;
			const handle = mountDecorationWidget(dec.badge, dec, (error) =>
				deps.onRenderError({ origin: 'render', error, context: { path: deps.getPath() } })
			);
			if (!handle) continue;
			const wrapper = document.createElement('div');
			wrapper.className = 'decoration-badge';
			wrapper.setAttribute('contenteditable', 'false');
			wrapper.appendChild(handle.el);
			badges.appendChild(wrapper);
			destroys.push(() => {
				handle.destroy();
				wrapper.remove();
			});
		}
		if (destroys.length === 0) return;
		el.insertBefore(badges, el.firstChild);
		return () => {
			for (const destroy of destroys) destroy();
		};
	});

	return {
		get classes() {
			return classes;
		}
	};
}
