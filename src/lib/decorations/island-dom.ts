/**
 * Decoration widgets placed in the text flow: a zero-width `widget`, and a `replace` covering
 * real bytes. Each renders as an inline widget the caret cannot enter whose `data-source-*` span
 * equals the bytes it stands for, so the offset walk reads the block back byte-exact. A range
 * this pass cannot place drops silently; `decoration-state.svelte.ts` warns about it.
 */

import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { ContentLength } from '../core/inline';
import {
	rawOfWalkOffset,
	rawRangeToDomRange,
	walkOffsetOfRaw,
	widgetSpanContainingOffset
} from '../browser/offsets';
import { rawTextOfNode } from '../browser/block-text';
import type { IndexedDecoration } from './buckets';
import type {
	Decoration,
	DecorationWidgetSpec,
	ReplaceDecoration,
	WidgetDecoration
} from './types';
import type { MountedDecorationWidget } from './widget-dom';

type Island = IndexedDecoration<WidgetDecoration | ReplaceDecoration>;

export interface ApplyIslandsOpts {
	/** Mounts the view into `target`, the widget's span; null when it threw, and the span stays empty. */
	mountWidget: (
		spec: DecorationWidgetSpec,
		dec: Decoration,
		target: HTMLElement
	) => MountedDecorationWidget | null;
	onSkipped?: (dec: Decoration, reason: string) => void; // where a dev warning is reported
	/** Raw-space length of the block's rendered content (see {@link ContentLength}). */
	contentLength: ContentLength;
}

/** The widget views one rebuild mounted. */
export interface IslandViews {
	/** Hands each mounted view its decoration from `islands`, which share the rebuild's render key
	 *  (the same places, in the same order), so only a widget's own decoration can differ. */
	update(islands: Island[]): void;
	/** Destroys every view, before the next rebuild or as the block unmounts. */
	destroy(): void;
}

interface MountedIsland {
	dec: Decoration;
	view: MountedDecorationWidget;
	island: HTMLElement;
}

export const NO_ISLAND_VIEWS: IslandViews = { update() {}, destroy() {} };

/** Mutates `root`, the freshly built inline fragment. */
export function applyIslandDecorations(
	root: ParentNode,
	raw: string,
	islands: Island[],
	opts: ApplyIslandsOpts
): IslandViews {
	if (islands.length === 0) return NO_ISLAND_VIEWS;
	const contentLength = opts.contentLength;
	// By index into `islands`, so an update finds each view's place without re-reading the DOM.
	const mounted: (MountedIsland | undefined)[] = [];

	for (const i of orderForApplication(islands)) {
		const dec = islands[i].dec;
		if (dec.type === 'widget') applyWidget(dec, i);
		else applyReplace(dec, i);
	}
	return {
		update(next) {
			next.forEach(({ dec }, i) => {
				const at = mounted[i];
				if (!at || at.dec === dec) return;
				at.dec = dec;
				if (at.view.update({ decoration: dec })) return;
				at.island.replaceChildren();
				mounted[i] = undefined;
			});
		},
		destroy() {
			for (const at of mounted) at?.view.destroy();
		}
	};

	function mountInto(island: HTMLElement, spec: DecorationWidgetSpec, dec: Decoration, i: number) {
		const view = opts.mountWidget(spec, dec, island);
		if (view) mounted[i] = { dec, view, island };
		return view;
	}

	function applyWidget(dec: WidgetDecoration, i: number): void {
		if (dec.offset < 0 || dec.offset > contentLength) return;
		const range = rawRangeToDomRange(root, dec.offset, dec.offset);
		if (!range) {
			opts.onSkipped?.(dec, 'no DOM position at offset');
			return;
		}
		const island = buildIsland(dec.offset, dec.offset);
		if (!mountInto(island, dec.widget, dec, i)) {
			opts.onSkipped?.(dec, 'widget mount failed');
			return;
		}
		range.insertNode(island);
	}

	function applyReplace(dec: ReplaceDecoration, i: number): void {
		if (dec.start < 0 || dec.end > contentLength || dec.start >= dec.end) return;
		// A boundary strictly inside a widget snaps outward to cover the whole element, so the
		// span still equals the bytes it displaces.
		let start = dec.start;
		let end = dec.end;
		const startSpan = widgetSpanContainingOffset(root, walkOffsetOfRaw(root, start));
		if (startSpan) start = rawOfWalkOffset(root, startSpan.start);
		const endSpan = widgetSpanContainingOffset(root, walkOffsetOfRaw(root, end));
		if (endSpan) end = rawOfWalkOffset(root, endSpan.end);
		if (startSpan || endSpan) {
			devWarn(
				'decorations',
				`replace boundary inside an atomic widget; snapped ${dec.start}..${dec.end} outward to ${start}..${end}`
			);
		}
		const range = rawRangeToDomRange(root, start, end);
		if (!range) {
			opts.onSkipped?.(dec, 'no DOM range for span');
			return;
		}
		const extracted = range.extractContents();
		if (devChecksOn) {
			const displaced = rawTextOfNode(extracted, raw);
			if (displaced !== raw.slice(start, end)) {
				devWarn('decorations', 'replace decoration span disagrees with the displaced DOM bytes', {
					span: [start, end],
					displaced
				});
			}
		}
		const island = buildIsland(start, end);
		if (dec.class) island.classList.add(...dec.class.split(/\s+/).filter(Boolean));
		if (dec.widget) mountInto(island, dec.widget, dec, i);
		range.insertNode(island);
	}
}

/** What these widgets add to a render key: `''` for none, so an undecorated block's key is
 *  unchanged. Widget identity is ignored (see `DecorationWidgetSpec`). */
export function islandRenderKeyPart(islands: Island[]): string {
	if (islands.length === 0) return '';
	return `\0${islands.map((i) => islandSig(i.dec)).join(';')}`;
}

const islandSig = (d: WidgetDecoration | ReplaceDecoration): string =>
	d.type === 'widget'
		? `w:${d.offset}:${d.side ?? 'after'}`
		: `r:${d.start}-${d.end}:${d.class ?? ''}:${d.widget ? 1 : 0}`;

/** A decoration's position for ordering, shared by the pass that applies them and the
 *  render order. */
export function islandPosition(dec: WidgetDecoration | ReplaceDecoration): number {
	return dec.type === 'widget' ? dec.offset : dec.start;
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Indices in descending position order, so a `replace` extraction never spans a widget inserted
 *  earlier. On a tie `replace` goes first: a widget at the same start would be swallowed by it. */
function orderForApplication(islands: Island[]): number[] {
	return islands
		.map((_, i) => i)
		.sort((i, j) => {
			const a = islands[i];
			const b = islands[j];
			return (
				islandPosition(b.dec) - islandPosition(a.dec) ||
				tieRank(a.dec) - tieRank(b.dec) ||
				b.index - a.index
			);
		});
}

function tieRank(dec: WidgetDecoration | ReplaceDecoration): number {
	if (dec.type === 'replace') return 0;
	return dec.side === 'before' ? 2 : 1;
}

function buildIsland(sourceStart: number, sourceEnd: number): HTMLSpanElement {
	const island = document.createElement('span');
	island.className = 'decoration-island';
	island.dataset.inlineWidget = '';
	island.dataset.decorationIsland = '';
	island.dataset.hostContent = '';
	island.dataset.sourceStart = String(sourceStart);
	island.dataset.sourceEnd = String(sourceEnd);
	island.setAttribute('contenteditable', 'false');
	return island;
}
