/**
 * The one hover lifecycle for an editor's marks. Hover comes from a hit-test of the pointer
 * against the rects the overlays painted, so a hover-only mark renders nothing that takes the
 * pointer, and a hover is keyed by the decoration, never by a rect: a repaint keeps it, and every
 * route that takes the mark away ends it exactly once.
 */

import type { LocalRect } from '../core/coordinate-spaces';
import type { IndexedDecoration } from './buckets';
import { comparePrecedence, hitRect } from './mark-interactions';
import type { MarkDecoration, MarkHover } from './types';

/** Which decoration a hover is on. The class is left out on purpose: a source restyling the
 *  hovered mark keeps the hover. */
export interface MarkIdentity {
	source: string;
	path: readonly number[];
	start: number;
	end: number;
	/** Its place among the source's hover marks over the same range. */
	ordinal: number;
}

/** A hover mark one overlay painted, its rects in the block's own pixels. */
export interface HoverTarget {
	mark: IndexedDecoration<MarkDecoration>;
	rects: LocalRect[];
}

/** The fields of a pointer event the hit-test reads. */
export interface HoverPointer {
	clientX: number;
	clientY: number;
	pointerType: string;
	buttons: number;
	target: EventTarget | null;
}

export interface MarkHoverDeps {
	/** Null for a mark no live source offers, or one without `onHover`. */
	identify(dec: MarkDecoration): MarkIdentity | null;
	/** Runs a plugin's handler, reporting a throw instead of raising it. */
	runHandler(dec: MarkDecoration, call: () => void): void;
}

/** `owner` is the overlay instance that painted the targets; `block` is its block's element. */
export interface MarkHoverTracker {
	/** Replaces what `owner` painted and re-runs the hit-test at the last pointer position. */
	paint(owner: object, block: HTMLElement | null, targets: HoverTarget[]): void;
	/** Called when the overlay unmounts. */
	unpaint(owner: object): void;
	/** The editor root's `pointermove`. */
	move(ev: HoverPointer): void;
	/** The pointer left the editor root, or the editor is unmounting. */
	leave(): void;
	end(): void;
}

export function createMarkHover(deps: MarkHoverDeps): MarkHoverTracker {
	const painted = new Map<object, { block: HTMLElement; targets: HoverTarget[] }>();
	let point: { x: number; y: number } | null = null;
	let current: { id: MarkIdentity; dec: MarkDecoration } | null = null;

	// Cleared before the handler runs, so a handler that invalidates its source re-enters with
	// no hover left to end twice.
	function end(): void {
		const ended = current;
		if (!ended) return;
		current = null;
		const { dec } = ended;
		deps.runHandler(dec, () => dec.interactive?.onHover?.(dec, null));
	}

	function enter(dec: MarkDecoration, hover: MarkHover): void {
		// Moving inside the hovered mark between repaints skips `identify`, a scan of every decoration.
		if (current?.dec === dec) return;
		const id = deps.identify(dec);
		if (!id) return;
		if (current && sameMark(current.id, id)) {
			current.dec = dec;
			return;
		}
		end();
		// Set before the handler runs: a start that throws still gets its end.
		current = { id, dec };
		deps.runHandler(dec, () => dec.interactive?.onHover?.(dec, hover));
	}

	// Costs one block-box read per painted block holding a hover mark, and one comparison per
	// hover rect; nothing at all when no hover mark is painted.
	function recheck(): void {
		if (!point) return;
		let best: { target: HoverTarget; rect: LocalRect; origin: DOMRect } | undefined;
		for (const { block, targets } of painted.values()) {
			const origin = block.getBoundingClientRect();
			const x = point.x - origin.left;
			const y = point.y - origin.top;
			for (const target of targets) {
				const rect = hitRect(target.rects, x, y);
				if (rect && (!best || comparePrecedence(target.mark, best.target.mark) < 0)) {
					best = { target, rect, origin };
				}
			}
		}
		if (!best) return end();
		const { origin } = best;
		const toViewport = (r: LocalRect) =>
			new DOMRect(origin.left + r.left, origin.top + r.top, r.width, r.height);
		enter(best.target.mark.dec, {
			anchor: toViewport(best.rect),
			rects: best.target.rects.map(toViewport)
		});
	}

	// Any scroll up to the window moves content under a still pointer with no pointermove (and in
	// host scroll mode no repaint); armed only while a pointer position is held.
	const onScroll = () => recheck();
	const SCROLL_CAPTURE = { capture: true, passive: true } as const;

	function hold(next: { x: number; y: number }): void {
		if (!point) window.addEventListener('scroll', onScroll, SCROLL_CAPTURE);
		point = next;
	}

	function release(): void {
		if (point) window.removeEventListener('scroll', onScroll, SCROLL_CAPTURE);
		point = null;
		end();
	}

	return {
		paint(owner, block, targets) {
			const had = painted.delete(owner);
			if (block && targets.length > 0) painted.set(owner, { block, targets });
			else if (!had) return;
			recheck();
		},
		unpaint(owner) {
			if (painted.delete(owner)) recheck();
		},
		move(ev) {
			// A touch never hovers; a pressed button or a pen in contact is a drag, which holds none.
			if (ev.pointerType === 'touch') return;
			if (ev.buttons !== 0 || !inDocumentContent(ev.target)) return release();
			hold({ x: ev.clientX, y: ev.clientY });
			recheck();
		},
		leave: release,
		end
	};
}

// A pointer over a popup is off the document even where the popup covers a mark: a host's popup
// sits outside every block, and a block's own menu sits between the target and the block.
const POPUP = '[role="menu"], [role="listbox"], [role="dialog"], [role="toolbar"]';

function inDocumentContent(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest(`${POPUP}, .block-host`)?.classList.contains('block-host') === true;
}

function sameMark(a: MarkIdentity, b: MarkIdentity): boolean {
	return (
		a.source === b.source &&
		a.start === b.start &&
		a.end === b.end &&
		a.ordinal === b.ordinal &&
		a.path.length === b.path.length &&
		a.path.every((step, i) => step === b.path[i])
	);
}
