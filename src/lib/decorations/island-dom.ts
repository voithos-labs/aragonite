/**
 * Decoration widgets placed in the text flow: a zero-width `widget`, and a `replace` covering
 * real bytes. Each renders as an inline widget the caret cannot enter whose `data-source-*` span
 * equals the bytes it stands for, so the offset walk reads the block back byte-exact. A range
 * this pass cannot place drops silently; `decoration-state.svelte.ts` warns about it.
 */

import { DEV } from 'esm-env';
import { ambientSpanOf } from '../ambient/ambient-dom';
import type { ContentLength } from '../core/inline';
import { asRawOffset, toDomTextOffset, toRawOffset } from '../cursor/coordinate-spaces';
import {
	createRangeAtDomTextOffsets,
	rawTextOfNode,
	widgetSpanContainingOffset
} from '../cursor/widget-offset';
import { devWarn } from '../dev-warn';
import type { IndexedDecoration } from './buckets';
import type {
	Decoration,
	DecorationWidgetSpec,
	ReplaceDecoration,
	WidgetDecoration
} from './types';

export interface ApplyIslandsOpts {
	mountWidget: (
		spec: DecorationWidgetSpec,
		dec: Decoration
	) => { el: HTMLElement; destroy(): void } | null;
	onSkipped?: (dec: Decoration, reason: string) => void; // where a dev warning is reported
	/** Raw-space length of the block's rendered content (see {@link ContentLength}). */
	contentLength: ContentLength;
	/** The rendered length of the container's marker prefix. These offsets are relative to raw
	 *  and the shared traversal counts that prefix as ordinary text, so every boundary adds it.
	 *  Default 0. */
	ambientLength?: number;
}

/** Mutates `root`, the freshly built inline fragment. Returns one destroy function per
 *  mounted widget; the caller runs them on the next rebuild. */
export function applyIslandDecorations(
	root: ParentNode,
	raw: string,
	islands: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[],
	opts: ApplyIslandsOpts
): Array<() => void> {
	if (islands.length === 0) return [];
	const ambientLength = opts.ambientLength ?? 0;
	const contentLength = opts.contentLength;
	const destroys: Array<() => void> = [];

	for (const { dec } of orderForApplication(islands)) {
		if (dec.type === 'widget') applyWidget(dec);
		else applyReplace(dec);
	}
	return destroys;

	function applyWidget(dec: WidgetDecoration): void {
		if (dec.offset < 0 || dec.offset > contentLength) return;
		const walkOffset = toDomTextOffset(asRawOffset(dec.offset), ambientLength);
		const range = createRangeAtDomTextOffsets(root, walkOffset, walkOffset);
		if (!range) {
			opts.onSkipped?.(dec, 'no DOM position at offset');
			return;
		}
		const mounted = opts.mountWidget(dec.widget, dec);
		if (!mounted) {
			opts.onSkipped?.(dec, 'widget mount failed');
			return;
		}
		destroys.push(mounted.destroy);
		const island = buildIsland(dec.offset, dec.offset);
		island.appendChild(mounted.el);
		insertHoistedOutOfAmbient(range, island);
	}

	function applyReplace(dec: ReplaceDecoration): void {
		if (dec.start < 0 || dec.end > contentLength || dec.start >= dec.end) return;
		// A boundary strictly inside a widget snaps outward to cover the whole element, so the
		// span still equals the bytes it displaces.
		let start = dec.start;
		let end = dec.end;
		const startSpan = widgetSpanContainingOffset(
			root,
			toDomTextOffset(asRawOffset(start), ambientLength)
		);
		if (startSpan) start = toRawOffset(startSpan.start, ambientLength);
		const endSpan = widgetSpanContainingOffset(
			root,
			toDomTextOffset(asRawOffset(end), ambientLength)
		);
		if (endSpan) end = toRawOffset(endSpan.end, ambientLength);
		if (startSpan || endSpan) {
			devWarn(
				'decorations',
				`replace boundary inside an atomic widget; snapped ${dec.start}..${dec.end} outward to ${start}..${end}`
			);
		}
		const range = createRangeAtDomTextOffsets(
			root,
			toDomTextOffset(asRawOffset(start), ambientLength),
			toDomTextOffset(asRawOffset(end), ambientLength)
		);
		if (!range) {
			opts.onSkipped?.(dec, 'no DOM range for span');
			return;
		}
		const ambient = ambientSpanOf(root);
		if (ambient && ambient.contains(range.startContainer)) range.setStartAfter(ambient);

		const extracted = range.extractContents();
		if (DEV) {
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
		if (dec.widget) {
			const mounted = opts.mountWidget(dec.widget, dec);
			if (mounted) {
				destroys.push(mounted.destroy);
				island.appendChild(mounted.el);
			}
		}
		range.insertNode(island);
	}

	// The traversal resolves a position at the marker prefix's boundary to the end of that
	// span's text, but the widget has to go after the span, never inside the read-only marker.
	function insertHoistedOutOfAmbient(range: Range, island: HTMLElement): void {
		const ambient = ambientSpanOf(root);
		if (ambient && ambient.contains(range.startContainer)) {
			ambient.after(island);
			return;
		}
		range.insertNode(island);
	}
}

/** What these widgets add to a render key: `''` for none, so an undecorated block's key is
 *  unchanged. Widget identity is ignored (see `DecorationWidgetSpec`). */
export function islandRenderKeyPart(
	islands: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[]
): string {
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

/**
 * Descending position order, so a `replace` extraction never spans a widget inserted earlier
 * in the pass. On a tie `replace` goes first, since a widget at the same start would be
 * swallowed by the extraction; `side: 'after'` widgets follow, leaving the final DOM order at
 * one offset as [before, after].
 */
function orderForApplication(
	islands: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[]
): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] {
	return [...islands].sort(
		(a, b) =>
			islandPosition(b.dec) - islandPosition(a.dec) ||
			tieRank(a.dec) - tieRank(b.dec) ||
			b.index - a.index
	);
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
	island.dataset.sourceStart = String(sourceStart);
	island.dataset.sourceEnd = String(sourceEnd);
	island.setAttribute('contenteditable', 'false');
	return island;
}
