/**
 * The one writer of the editor's scroll position: every other module reads the scroll container
 * through `port()`, and every write is a method here that first decides who owns the position.
 * One per editor, built in `Editor.svelte`. See `docs/design/virtual-rendering.md` § Keeping the
 * page still while heights change.
 */
import { tick } from 'svelte';
import type { BlockElLookup } from '../editor-keys';
import type { UserScrollport } from './scroll-ancestors';
import { createScrollport, type Scrollport, type ScrollportReader } from './scrollport';

export type PlaceBlock = 'nearest' | 'center';

/** The block a scroll into view holds in place, by its full path. */
export interface HeldTarget {
	path: readonly number[];
	block: PlaceBlock;
}

export interface PlaceOptions {
	block: PlaceBlock;
	/** Keep the block where it landed against later layout shifts, until a user gesture or a newer
	 *  placement. */
	hold: boolean;
}

export interface ScrollPlacement {
	/** Scroll the mounted block into view and follow it until it stops moving; true when it ends
	 *  in view. A newer placement stops it at once. */
	scroll(): Promise<boolean>;
}

/** Where a block's top sits in the scroll container's content, and its height. */
export interface TargetTop {
	top: number;
	height: number;
}

/** The root list's answer to where a held target is, installed by the root list alone. */
export interface TargetResolver {
	/** Null when the list can't place the path: out of its range, or windowed out inside a
	 *  mounted container. */
	resolve(path: readonly number[]): TargetTop | null;
	/** A scripted `scrollTop` write fires no `scroll` event in time, so the root window re-reads it. */
	syncScrollTop(): void;
}

/** Who runs a height change, which decides what a held placement does across it: only the root
 *  list re-places, and the header slot writes nothing only when the scroll already sits on target.
 *  An interim: it goes once the root list's correction comes from installing the resolver, so no
 *  caller passes a string. */
export type CompensationSource = 'root-list' | 'nested-list' | 'header';

export interface ScrollOwner {
	/** The scroll container, read-only; null until the editor root mounts. */
	port(): ScrollportReader | null;
	/** Whether the mounted block at `path` is visible in the editor's viewport. */
	isInView(path: readonly number[]): boolean;
	/** The block a scroll into view holds right now, or null. */
	heldTarget(): HeldTarget | null;
	/** Run a height change and keep what the user sees still. `held` runs the change and returns
	 *  how far the block it keeps still moved across it. */
	compensate(
		source: CompensationSource,
		mutate: () => void,
		held: (mutate: () => void) => number
	): void;
	/** Take the position for a scroll into view now, before the mount's awaits; `scroll()` once
	 *  the block is mounted. */
	place(path: readonly number[], opts: PlaceOptions): ScrollPlacement;
	/** Scroll so `contentTop` leads the viewport, to mount the block there. */
	scrollToMount(contentTop: number): void;
	/** Read the position now; the returned call puts it back after a view swap renders. */
	keep(): () => Promise<void>;
	/** Scroll a mounted block to the nearest edge once, holding nothing: the keyboard extension's
	 *  scroll, until `place` can bring a `'nearest'` target into view without moving it later. */
	showNearest(path: readonly number[]): void;
	/** A keydown, pointerdown or wheel on the scroll container: drop any held placement. */
	release(): void;
	/** Returns the uninstall. */
	resolveTargetsWith(resolver: TargetResolver): () => void;
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

// The measure passes after a mount finish within a few Svelte flushes; `tick` is the only
// sequencing tool in this repo, so the wait is a fixed number of them.
const REVEAL_SETTLE_TICKS = 12;

// Identity, not the path: two placements can aim at the same block, and only the one still
// holding may release it.
type Token = { superseded: boolean };

export function createScrollOwner(deps: ScrollOwnerDeps): ScrollOwner {
	const openPort = deps.openPort ?? createScrollport;
	let port: Scrollport | null = null;
	let resolver: TargetResolver | null = null;
	let heldBy: Token | null = null;
	let target: HeldTarget | null = null;
	// A new placement supersedes the last one made, not the current holder, or `place, release,
	// place` would leave the first scroll believing it still owns the viewport.
	let lastMinted: Token | null = null;

	function writable(): Scrollport | null {
		if (port) return port;
		const host = deps.getScrollHost();
		if (host) port = openPort(host);
		return port;
	}

	function drop(): void {
		heldBy = null;
		target = null;
	}

	/** Null with nothing held or nothing to place it by. Offsets come from the height table, since
	 *  the DOM hasn't laid out the table's latest writes yet. */
	function targetScrollTop(): number | null {
		const p = writable();
		if (!target || !resolver || !p) return null;
		const at = resolver.resolve(target.path);
		if (!at) return null;
		// Centred on the scroll container's height, not a list's, which reads list geometry
		// mid-change and would centre on a briefly tiny viewport.
		return target.block === 'center'
			? at.top - Math.max(0, (p.viewportHeight() - at.height) / 2)
			: at.top;
	}

	// The absolute write survives the browser clamping `scrollTop` while images decode above.
	function replace(): void {
		const top = targetScrollTop();
		const p = writable();
		if (top === null || !p) return;
		p.setScrollTop(top);
		resolver?.syncScrollTop();
	}

	// Sub-pixel tolerance: the follow loop lands a fraction of a device pixel off the position the
	// height table gives, and an exact compare would let the delta back in.
	function sitsOnTarget(): boolean {
		const top = targetScrollTop();
		const p = writable();
		return top !== null && !!p && Math.abs(p.scrollTop() - top) <= 1;
	}

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

	// The root list's correction estimates from the height table before the flush, so each tick
	// refines after it until the target stops moving.
	async function followIntoView(path: number[], block: PlaceBlock, token: Token): Promise<boolean> {
		const root = deps.getEditorRoot();
		if (!root) return deps.getBlockElByPath(path) != null;
		let placedTop: number | null = null;
		for (let i = 0; i < REVEAL_SETTLE_TICKS; i++) {
			await tick();
			if (token.superseded) break;
			const el = deps.getBlockElByPath(path);
			if (!el) {
				placedTop = null; // briefly unmounted while the window re-slices; keep going
				continue;
			}
			if (el.getBoundingClientRect().top === placedTop) break;
			el.scrollIntoView({ block });
			placedTop = el.getBoundingClientRect().top;
		}
		const el = deps.getBlockElByPath(path);
		return el != null && elementInView(el, root);
	}

	return {
		port: writable,
		isInView(path) {
			const root = deps.getEditorRoot();
			const el = deps.getBlockElByPath([...path]);
			return !!root && !!el && elementInView(el, root);
		},
		heldTarget: () => target,
		compensate(source, mutate, held) {
			if (!deps.editorCorrects()) {
				mutate();
				return;
			}
			if (source === 'root-list' && targetScrollTop() !== null) {
				mutate();
				replace();
				return;
			}
			if (source === 'header' && sitsOnTarget()) {
				mutate();
				return;
			}
			const delta = held(mutate);
			const p = writable();
			if (delta !== 0 && p) p.scrollBy(delta);
		},
		place(path, { block, hold }) {
			const p = [...path];
			const token: Token = { superseded: false };
			if (lastMinted) lastMinted.superseded = true;
			lastMinted = token;
			heldBy = token;
			target = { path: p, block };
			return {
				async scroll() {
					// Checked first: a placement another scroll took over during a long mount wait
					// would otherwise yank the viewport once, before the first tick could stop it.
					if (!token.superseded) deps.getBlockElByPath(p)?.scrollIntoView({ block });
					const landed = await followIntoView(p, block, token);
					// Released on 'center' or a failed scroll too: the approximate hold would drift a
					// target placed exactly, while holding the top approximately is 'nearest''s promise.
					if ((!hold || block === 'center' || !landed) && heldBy === token) drop();
					return landed;
				}
			};
		},
		scrollToMount(contentTop) {
			writable()?.setScrollTop(contentTop);
		},
		keep() {
			const p = writable();
			const before = p?.scrollTop() ?? 0;
			return async () => {
				await tick();
				// Native anchoring can't undo a max-scroll clamp, so this writes in host mode too.
				if (!p || target !== null || p.scrollTop() === before) return;
				p.setScrollTop(before);
			};
		},
		showNearest(path) {
			deps.getBlockElByPath([...path])?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		},
		release: drop,
		resolveTargetsWith(next) {
			resolver = next;
			return () => {
				if (resolver === next) resolver = null;
			};
		}
	};
}
