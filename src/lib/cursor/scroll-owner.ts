/**
 * The one writer of the editor's scroll position: every other module reads the scroll container
 * through `port()`, and every write is a method here that first decides who owns the position.
 * One per editor, built in `Editor.svelte`. See `docs/design/virtual-rendering.md` § Keeping the
 * page still while heights change.
 */
import { tick } from 'svelte';
import { devWarn } from '../dev-warn';
import type { BlockElLookup } from '../editor-keys';
import type { UserScrollport } from './scroll-ancestors';
import { createScrollport, type Scrollport, type ScrollportReader } from './scrollport';
import { createSharedResizeWatch } from './observe-resize';

export type PlaceBlock = 'nearest' | 'center';

export interface PlaceOptions {
	block: PlaceBlock;
	/** Keep the block where it landed against later layout shifts, until a user gesture or a newer
	 *  placement. */
	hold: boolean;
}

export interface ScrollPlacement {
	/** Scroll the mounted block into view once, then wait out the height changes that follow; true
	 *  when it ends in view. A newer placement stops it at once. */
	scroll(): Promise<boolean>;
}

/** Where a block's top sits in the scroll container's content, and its height. */
export interface TargetTop {
	top: number;
	height: number;
}

/** The root list's reads of the document's height tables, installed by the root list alone. */
export interface TargetResolver {
	/** Null when the list can't place the path: out of its range, or windowed out inside a
	 *  mounted container. */
	resolve(path: readonly number[]): TargetTop | null;
	/** The block a measure round keeps still, picked from the scroll before it, and a read of how far
	 *  it moved; the same walk `resolve` makes, so a held target and the round agree. */
	holdForRound(): (() => number) | null;
	/** Where to scroll so the block at `path` mounts in its list. */
	mountTop(path: readonly number[]): number | null;
	/** A scripted `scrollTop` write fires no `scroll` event in time, so the root window re-reads it. */
	syncScrollTop(): void;
}

/** `held` runs the change and returns how far the block the caller keeps still moved across it. */
export type Compensate = (mutate: () => void, held: (mutate: () => void) => number) => void;

/** What the root list gets for installing its resolver: the header slot's correction. A round
 *  measures below the root list's top, so the header's own growth joins it as a distance. */
export interface RootListScroll {
	compensate: Compensate;
	uninstall(): void;
}

export interface ScrollOwner {
	/** The scroll container, read-only; null until the editor root mounts. */
	port(): ScrollportReader | null;
	/** Whether any of the mounted block at `path` shows in the editor's viewport: the published
	 *  "placed and in view" answer, which a block partly on screen satisfies. */
	isInView(path: readonly number[]): boolean;
	/** Whether a viewport rect sits wholly inside what the editor shows, so a caret there needs no
	 *  scroll. */
	shows(rect: DOMRectReadOnly): boolean;
	/** Scroll the least distance that shows the rect `read` returns (a caret's line, a cell), read
	 *  after an open round's correction; null shows nothing. Holds nothing, and ends an older hold. */
	showRect(read: () => DOMRectReadOnly | null): void;
	/** Called before any list's height table changes: opens the round every height write of this
	 *  flush joins, picking the block to keep still now. The round writes once, at the next tick. */
	beginRound(): void;
	/** True from a round's first height write until it closes. */
	roundOpen(): boolean;
	/** Runs `run` after the current flush, with every other list's. */
	measureSoon(run: () => void): void;
	/** Watches a child's size with the editor's one observer; the callback only records heights. */
	watchSize(el: Element, onResize: (entry: ResizeObserverEntry) => void): () => void;
	/** Take the position for a scroll into view now, before the mount's awaits; `scroll()` once
	 *  the block is mounted. */
	place(path: readonly number[], opts: PlaceOptions): ScrollPlacement;
	/** Scroll so the block at `path` leads the viewport, to mount it there. */
	scrollToMount(path: readonly number[]): void;
	/** Read the position now; the returned call puts it back after a view swap renders. */
	keep(): () => Promise<void>;
	/** A keydown, pointerdown or wheel on the scroll container: drop any held placement. */
	release(): void;
	/** Called by the root list alone. */
	resolveTargetsWith(resolver: TargetResolver): RootListScroll;
}

export interface ScrollOwnerDeps {
	/** The element the editor scrolls, or null before the root mounts. */
	getScrollHost(): UserScrollport | null;
	/** Opens the scroll host as a scroll container the owner can write; a unit test hands in a
	 *  stub. */
	openPort?: (host: UserScrollport) => Scrollport;
	/** False while the browser's own scroll anchoring holds the user's place (host mode, root not
	 *  windowing): two writers on one position correct it twice. */
	editorCorrects(): boolean;
	getBlockElByPath: BlockElLookup;
	getEditorRoot(): HTMLElement | null;
	/** True when an ancestor owns the scroll: the root then spans the whole document, so
	 *  intersecting a block with it says nothing about visibility. */
	isHostScroll(): boolean;
	/** In host mode, the ancestors that bound what can be seen, intersected with the window. */
	getClipBounds(): HTMLElement[];
}

// A placement's mount wave goes quiet within a few flushes; one still compensating past this many
// is a loop worth a warning.
const SETTLE_TURNS = 12;

/** The round this flush's height writes join: the pick's read, and what the header adds. */
interface Round {
	moved: (() => number) | null;
	added: number;
}

/** Where one owner write goes, worked out once an open round has closed. */
type ScrollTarget = { top: number } | { by: number } | { reveal: HTMLElement; block: PlaceBlock };

// Identity, not the path: two placements can aim at the same block, and only the one still
// holding may release it.
type Token = { superseded: boolean };

interface Placement {
	token: Token;
	path: number[];
	block: PlaceBlock;
	/** The target's top below the viewport's top where the scroll put it; null until `scroll()`. */
	offset: number | null;
	/** What the height table doesn't know about the target's top: margins, chrome, a stale
	 *  estimate. Its DOM top in the content minus the table's. */
	bias: number;
}

export function createScrollOwner(deps: ScrollOwnerDeps): ScrollOwner {
	const openPort = deps.openPort ?? createScrollport;
	let port: Scrollport | null = null;
	let resolver: TargetResolver | null = null;
	let placement: Placement | null = null;
	// A new placement supersedes the last one made, not the current holder, or `place, release,
	// place` would leave the first scroll believing it still owns the viewport.
	let lastMinted: Token | null = null;
	let roundsOpened = 0;
	let open: Round | null = null;
	const soon = new Set<() => void>();

	function writable(): Scrollport | null {
		if (port) return port;
		const host = deps.getScrollHost();
		if (host) port = openPort(host);
		return port;
	}

	function drop(): void {
		placement = null;
	}

	/** Null with nothing held or nothing to place it by. Offsets come from the height table, since
	 *  the DOM hasn't laid out the table's latest writes yet. */
	function targetScrollTop(): number | null {
		const p = writable();
		if (!placement || !resolver || !p) return null;
		const at = resolver.resolve(placement.path);
		if (!at) return null;
		if (placement.offset !== null) return at.top + placement.bias - placement.offset;
		// Centred on the scroll container's height, not a list's, which reads list geometry
		// mid-change and would centre on a briefly tiny viewport.
		return placement.block === 'center'
			? at.top - Math.max(0, (p.viewportHeight() - at.height) / 2)
			: at.top;
	}

	function recordLanding(held: Placement, el: HTMLElement): void {
		const p = writable();
		if (!p) return;
		const offset = el.getBoundingClientRect().top - p.viewportTop();
		const at = resolver?.resolve(held.path);
		held.offset = offset;
		held.bias = at ? p.scrollTop() + offset - at.top : 0;
	}

	// Each round re-places a placed target from the height table itself, so nothing is left to
	// follow by hand once a flush passes with no round.
	async function settle(token: Token, path: number[]): Promise<void> {
		for (let turn = 1; ; turn++) {
			const seen = roundsOpened;
			await tick();
			if (token.superseded || (roundsOpened === seen && !open)) return;
			if (turn > SETTLE_TURNS) {
				devWarn('scroll', `a placement still compensating after ${SETTLE_TURNS} flushes`, { path });
				return;
			}
		}
	}

	function measureQueued(): void {
		const runs = [...soon];
		soon.clear();
		for (const queued of runs) queued();
	}

	/** Every owner write but the round's own: it measures the queued blocks and closes the round
	 *  first, so it reads tables that know every mounted block, and no correction lands after it. */
	function writeScroll(target: () => ScrollTarget | null): void {
		measureQueued();
		closeRound();
		const to = target();
		const p = writable();
		if (!to || !p) return;
		if ('reveal' in to) {
			to.reveal.scrollIntoView({ block: to.block });
			return;
		}
		if ('top' in to) p.setScrollTop(to.top);
		else p.scrollBy(to.by);
		resolver?.syncScrollTop();
	}

	// The round's own correction writes the port directly, so closing never recurses.
	function closeRound(): void {
		const round = open;
		if (!round) return;
		const corrects = deps.editorCorrects();
		// A held placement owns the position, and re-places from the same tables.
		const placed = corrects ? targetScrollTop() : null;
		const delta = corrects && placed === null ? (round.moved?.() ?? 0) + round.added : 0;
		// Cleared after the reads, so a table they rebuild joins this round instead of opening one.
		open = null;
		const p = writable();
		if (!p) return;
		// The absolute write survives the browser clamping `scrollTop` while images decode above.
		if (placed !== null) {
			p.setScrollTop(placed);
			resolver?.syncScrollTop();
		} else if (delta !== 0) p.scrollBy(delta);
	}

	// Whether the editor corrects at all is asked at the close: the root list's own table opens a
	// round while it builds, and that question reads the root's window.
	function beginRound(): void {
		if (open) return;
		const round: Round = { moved: resolver?.holdForRound() ?? null, added: 0 };
		open = round;
		roundsOpened++;
		void tick().then(() => {
			if (open === round) closeRound();
		});
	}

	const sizes = createSharedResizeWatch();

	function elementInView(el: HTMLElement, root: HTMLElement): boolean {
		const br = el.getBoundingClientRect();
		// Self mode: the root is the scroll container, and what lies outside it is the host
		// page's business, not the editor's.
		if (!deps.isHostScroll()) {
			const er = root.getBoundingClientRect();
			return br.top < er.bottom && br.bottom > er.top;
		}
		if (br.top >= window.innerHeight || br.bottom <= 0) return false;
		for (const bound of deps.getClipBounds()) {
			const cr = bound.getBoundingClientRect();
			if (br.top >= cr.bottom || br.bottom <= cr.top) return false;
		}
		return true;
	}

	/** What the editor shows, as a band of viewport pixels: the scroll container's box, cut down
	 *  in host mode by the ancestors that clip it. */
	function visibleBand(): { top: number; bottom: number } | null {
		const p = writable();
		if (!p) return null;
		let top = p.viewportTop();
		let bottom = top + p.viewportHeight();
		if (deps.isHostScroll()) {
			for (const bound of deps.getClipBounds()) {
				const r = bound.getBoundingClientRect();
				top = Math.max(top, r.top);
				bottom = Math.min(bottom, r.bottom);
			}
		}
		return { top, bottom };
	}

	// Sub-pixel tolerance: a scroll lands its target a fraction of a pixel off the edge.
	function bandShows(band: { top: number; bottom: number }, rect: DOMRectReadOnly): boolean {
		return rect.top >= band.top - 1 && rect.bottom <= band.bottom + 1;
	}

	function landedInView(path: number[]): boolean {
		const el = deps.getBlockElByPath(path);
		const root = deps.getEditorRoot();
		return el != null && (!root || elementInView(el, root));
	}

	return {
		port: writable,
		isInView(path) {
			const root = deps.getEditorRoot();
			const el = deps.getBlockElByPath([...path]);
			return !!root && !!el && elementInView(el, root);
		},
		shows(rect) {
			const band = visibleBand();
			return !!band && bandShows(band, rect);
		},
		showRect(read) {
			writeScroll(() => {
				// A newer scroll into view, like a newer placement: an older hold must not drag it back.
				if (lastMinted) lastMinted.superseded = true;
				drop();
				const band = visibleBand();
				const rect = read();
				if (!band || !rect || bandShows(band, rect)) return null;
				// A rect already filling the band has nothing to gain; otherwise its top wins a tie.
				if (rect.top < band.top && rect.bottom > band.bottom) return null;
				const by =
					rect.bottom > band.bottom
						? Math.min(rect.bottom - band.bottom, rect.top - band.top)
						: rect.top - band.top;
				return { by };
			});
		},
		beginRound,
		roundOpen: () => open !== null,
		watchSize: (el, onResize) => sizes.watch(el, onResize),
		measureSoon(run) {
			if (soon.size === 0) void tick().then(measureQueued);
			soon.add(run);
		},
		place(path, { block, hold }) {
			const p = [...path];
			const token: Token = { superseded: false };
			if (lastMinted) lastMinted.superseded = true;
			lastMinted = token;
			const mine: Placement = { token, path: p, block, offset: null, bias: 0 };
			placement = mine;
			return {
				async scroll() {
					// Checked first: a placement another scroll took over during a long mount wait
					// would otherwise yank the viewport once.
					if (token.superseded) return false;
					const el = deps.getBlockElByPath(p);
					// A fully visible target stays put under `'nearest'`: the browser moves nothing.
					writeScroll(() => el && { reveal: el, block });
					if (el && placement === mine) recordLanding(mine, el);
					await settle(token, p);
					const landed = !token.superseded && landedInView(p);
					// `'center'` places without holding, as `rects.scrollTo` promises, and a target that
					// didn't land has no position to keep.
					if ((!hold || block === 'center' || !landed) && placement === mine) drop();
					return landed;
				}
			};
		},
		scrollToMount(path) {
			writeScroll(() => {
				const top = resolver?.mountTop(path) ?? null;
				return top === null ? null : { top };
			});
		},
		keep() {
			// Closed first, so the position kept is the one the open round's correction leaves.
			closeRound();
			const p = writable();
			const before = p?.scrollTop() ?? 0;
			return async () => {
				await tick();
				// Native anchoring can't undo a max-scroll clamp, so this writes in host mode too.
				writeScroll(() =>
					!p || placement !== null || p.scrollTop() === before ? null : { top: before }
				);
			};
		},
		release: drop,
		resolveTargetsWith(next) {
			resolver = next;
			return {
				// The header sits above every list, so its distance adds to the round's.
				compensate(mutate, held) {
					beginRound();
					if (open) open.added += held(mutate);
					else mutate();
				},
				uninstall() {
					if (resolver === next) resolver = null;
				}
			};
		}
	};
}
