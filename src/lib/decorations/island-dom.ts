/**
 * In-flow decoration islands: zero-width `widget` insertions and byte-carrying `replace`
 * covers. An island is an atomic inline widget, so the shared raw-offset walk reads the
 * block back byte-exact with no walker changes — a widget island spans zero bytes, and a
 * replace island's `data-source-*` span equals the raw span of the DOM it displaced.
 *
 * Whether a range is one the author could place at all is decided where the source and the
 * document it read are provably the same version (`decoration-state.svelte.ts`); a range
 * this pass cannot honour is one the document has since outgrown, so it drops silently.
 */

import { DEV } from 'esm-env';
import { ambientSpanOf } from '../ambient/ambient-dom';
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
	onSkipped?: (dec: Decoration, reason: string) => void; // dev-warn hook
	/** Raw-space length of the block's rendered content — `getContentRange(node).end`, the
	 *  CST's answer. Measuring the DOM instead would read a container this pass is itself
	 *  mutating, and would answer in walk space rather than the offsets a decoration carries. */
	contentLength: number;
	/** Rendered ambient-marker length. Island offsets are raw-relative and the shared walk
	 *  counts ambient text as ordinary text, so every boundary adds this (the
	 *  TextEditableBlock compensation pattern). Default 0. */
	ambientLength?: number;
}

/** Mutates `root` (the freshly built inline fragment). Returns destroy handles for
 *  mounted widgets — the caller sweeps them next rebuild. */
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
		// A boundary strictly inside an atomic widget snaps outward to whole-element
		// coverage, so the island's span still equals the bytes it displaces.
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
				devWarn('decorations', 'replace island span disagrees with the displaced DOM bytes', {
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

	// The walk resolves a position at the ambient boundary to the END of the span's text,
	// but an island must land after the span, never inside the read-only marker.
	function insertHoistedOutOfAmbient(range: Range, island: HTMLElement): void {
		const ambient = ambientSpanOf(root);
		if (ambient && ambient.contains(range.startContainer)) {
			ambient.after(island);
			return;
		}
		range.insertNode(island);
	}
}

/** Gated island signature for a render key. No islands ⇒ '', keeping an undecorated
 *  block's key byte-identical to the island-free format. Widget identity is deliberately
 *  untracked: same position + class ⇒ equal signature (see DecorationWidgetSpec). */
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

/** An island's ordering position, shared by the application pass and the render order. */
export function islandPosition(dec: WidgetDecoration | ReplaceDecoration): number {
	return dec.type === 'widget' ? dec.offset : dec.start;
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Descending position order, so a replace extraction never spans an island inserted
 * earlier in the pass. Ties put replaces first, since a same-start widget island would be
 * swallowed by the extraction; `side: 'after'` widgets follow, leaving the final DOM order
 * at one offset as [before, after].
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
