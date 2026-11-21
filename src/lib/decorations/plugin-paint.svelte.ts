/**
 * Each plugin's `paint`, read a block at a time: asked for a block the editor renders (`paint` for
 * a block of text, `paintContainer` for one holding blocks), kept while the block's bytes and the
 * paint's version hold, and stored in the block's own offsets. A mark's handlers read its range in
 * document bytes as they run.
 */
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { tick, untrack } from 'svelte';
import type { NodeView } from '../core/node-views';
import type { MarkAt, MarkPaint, Paint, PaintContext } from './paint';
import type { PluginView } from '../plugin-view';
import { inlineWidgetMiss, paintsOnlyClasses } from './paint-lands';
import { recordPaintCall } from '../perf/instruments';
import type { BlockSource } from './block-paint';
import { pathKey } from './buckets';
import type { Decoration, DecorationWidgetSpec, MarkDecoration, MarkInteractions } from './types';

export interface PaintSource extends BlockSource {
	/** Asks again for `nodes`, or for every block once each is next read. */
	repaint(nodes?: readonly NodeView[]): void;
}

/** What a paint source maps positions through: a block as a plugin reads it. */
export interface PaintedBlock {
	byteAt(offset: number): number;
	offsetAt(at: number): number | null;
}

export interface PaintSourceDeps<B extends PaintedBlock> {
	plugin: string;
	/** The plugin's contribution, whose `paint` and `paintContainer` only this source calls. */
	contribution: {
		paint?(block: B, ctx: PaintContext): readonly Paint[];
		paintContainer?(block: B, ctx: PaintContext): readonly Paint[];
		paintDepends?(block: B): string;
	};
	blockOf(node: NodeView, path: readonly number[]): B;
	/** The block at `path` in the document now, which a handler reads its range through. */
	blockAt(path: readonly number[]): B | null;
	/** The viewport rects a mark paints, empty while its block is off screen. */
	rectsOf(dec: MarkDecoration): DOMRect[];
	/** Asks `depends` of every top-level block, then of the blocks each write replaced. */
	keys(depends: (block: B) => string, report: (cause: unknown) => void): Answers;
	/** Bumped by every write that changes the bytes: a reactive read. */
	contentVersion(): number;
	report(error: PaintError): void;
}

/** A throw from the plugin's paint or one of its handlers, as the editor reports a plugin's. */
export interface PaintError {
	readonly plugin: string;
	readonly doing: string;
	readonly cause: unknown;
}

export function createPaintSource<B extends PaintedBlock>(deps: PaintSourceDeps<B>): PaintSource {
	const { plugin } = deps;
	let version = $state(0);
	const held = new WeakMap<NodeView, Held>();
	const stamps = new WeakMap<NodeView, Stamp>();
	const warned = new Set<string>();
	const handlers = createHandlers(deps);
	let queued: PaintError[] = [];
	const { paintDepends } = deps.contribution;
	let keys: Answers | null = null;
	let keyed = 0;
	let keysAt = -1;

	// Inside a derived, where a listener that writes state would throw, so it waits for the flush.
	function reportLater(error: PaintError): void {
		if (queued.push(error) > 1) return;
		void tick().then(() => {
			const errors = queued;
			queued = [];
			for (const each of errors) deps.report(each);
		});
	}

	/** How often `paintDepends`' answers have changed. The first block read after a write asks the
	 *  blocks it replaced; a change paints every block again. */
	function answersVersion(): number {
		if (!paintDepends) return 0;
		const at = deps.contentVersion();
		if (at === keysAt) return keyed;
		keysAt = at;
		untrack(() => {
			if (!keys)
				keys = deps.keys(paintDepends, (cause) =>
					reportLater({ plugin, doing: 'paintDepends', cause })
				);
			else if (keys.changed()) keyed++;
		});
		return keyed;
	}

	function decorationsOf(node: NodeView, path: readonly number[]): readonly Decoration[] {
		// A block with children is asked only by a plugin that paints containers, so a keystroke deep
		// in a long list doesn't hand every plugin the whole list's text.
		const container = paintsOnlyClasses(node);
		if (!(container ? deps.contribution.paintContainer : deps.contribution.paint)) return NONE;
		const raw = node.raw;
		const asked = version;
		const answers = answersVersion();
		let stamp = stamps.get(node);
		if (!stamp) stamps.set(node, (stamp = new Stamp()));
		const repainted = stamp.n;
		const key = pathKey(path);
		const was = held.get(node);
		if (
			was &&
			was.raw === raw &&
			was.version === asked &&
			was.stamp === repainted &&
			was.answers === answers
		) {
			return atPath(was, path, key);
		}
		const decs = untrack(() => painted(container, node, path, was));
		held.set(node, { raw, version: asked, stamp: repainted, answers, key, decs });
		return decs;
	}

	function painted(
		container: boolean,
		node: NodeView,
		path: readonly number[],
		was: Held | undefined
	) {
		recordPaintCall(path);
		const block = deps.blockOf(node, path);
		let paints: readonly Paint[];
		try {
			const { contribution } = deps;
			const ctx: PaintContext = keys ? { depends: keys.keys() } : NO_ANSWERS;
			paints =
				(container
					? contribution.paintContainer?.(block, ctx)
					: contribution.paint?.(block, ctx)) ?? NONE;
		} catch (cause) {
			// The block keeps what it painted last; the same bytes aren't asked again.
			reportLater({ plugin, doing: 'paint', cause });
			return was ? atPath(was, path, pathKey(path)) : NONE;
		}
		const out: Decoration[] = [];
		for (const paint of paints) {
			const dec = placed(paint, block, node, path);
			if (dec) out.push(dec);
		}
		return out.length === 0 ? NONE : out;
	}

	function placed(
		paint: Paint,
		block: PaintedBlock,
		node: NodeView,
		path: readonly number[]
	): Decoration | null {
		const at = [...path];
		const { type } = paint;
		if (type === 'block') {
			const badge = paint.badge && viewSpec(paint.badge);
			const dec = { type, path: at, class: paint.class, attrs: copy(paint.attrs), badge };
			return withPaint(dec, paint);
		}
		if (paintsOnlyClasses(node)) return leftOut(paint, 'container', node);
		if (type === 'widget') {
			const offset = block.offsetAt(paint.at);
			if (offset === null) return leftOut(paint, 'outside', node);
			if (devChecksOn) warnIfUnrendered(paint, node, offset);
			return withPaint(
				{ type, path: at, offset, side: paint.side, widget: viewSpec(paint.view) },
				paint
			);
		}
		const range = rangeIn(block, paint.from, paint.to);
		if (!range) return leftOut(paint, 'outside', node);
		if (type === 'mark') {
			const { class: cls, attrs } = paint;
			return {
				type,
				path: at,
				...range,
				class: cls,
				attrs: copy(attrs),
				interactive: handlers.of(paint)
			};
		}
		if (devChecksOn) warnIfUnrendered(paint, node, range.start, range.end);
		const widget = paint.view && viewSpec(paint.view);
		return withPaint({ type, path: at, ...range, class: paint.class, widget }, paint);
	}

	function leftOut(paint: Paint, problem: PaintMiss, node: NodeView): null {
		if (devChecksOn) warnOnce(paint, problem, node);
		return null;
	}

	function warnIfUnrendered(paint: Paint, node: NodeView, start: number, end?: number): void {
		const unrendered = inlineWidgetMiss(node, start, end);
		if (unrendered) warnOnce(paint, unrendered.reason, node);
	}

	// Once per plugin and problem, not per block: a paint that misses once misses everywhere.
	// Reached only with dev checks on, so its sentences stay out of a production build.
	function warnOnce(paint: Paint, problem: PaintMiss, node: NodeView): void {
		const key = `${paint.type}\0${problem}`;
		if (warned.has(key)) return;
		warned.add(key);
		devWarn(
			'decorations',
			`plugin '${plugin}' paints ${missed(paint, problem, node)}; it's left out`
		);
	}

	return {
		name: `paint:${plugin}`,
		decorationsOf,
		repaint(nodes) {
			if (!nodes) {
				version++;
				return;
			}
			for (const node of nodes) {
				const stamp = stamps.get(node);
				if (stamp) stamp.n++;
			}
		}
	};
}

/** One editor's paint sources, one per contribution that paints, so a plugin `use` keeps holds on
 *  to what it painted. */
export function createPaintSources<B extends PaintedBlock>(
	deps: Omit<PaintSourceDeps<B>, 'plugin' | 'contribution'> & {
		/** The plugins that paint, in list order; a reactive read. */
		paints(): readonly { plugin: string; contribution: PaintSourceDeps<B>['contribution'] }[];
	}
) {
	const sources = new WeakMap<object, PaintSource>();
	const sourceOf = ({ plugin, contribution }: ReturnType<typeof deps.paints>[number]) =>
		cached(sources, contribution, () => createPaintSource({ ...deps, plugin, contribution }));
	return {
		/** Every painting plugin's source, in list order. */
		get list(): readonly PaintSource[] {
			return deps.paints().map(sourceOf);
		},
		/** Asks `plugin`'s paint again, or every plugin's for `null`. */
		repaint(plugin: string | null, nodes?: readonly NodeView[]): void {
			for (const paint of deps.paints()) {
				if (plugin === null || paint.plugin === plugin) sourceOf(paint).repaint(nodes);
			}
		}
	};
}

/** The paint a widget, replace or block decoration was placed from: its view is told this paint,
 *  not the decoration. */
export function paintBehind(dec: Decoration): Paint | undefined {
	return (dec as { [PAINT]?: Paint })[PAINT];
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The answers of the paint's `paintDepends`, kept across writes by the editor's document read. */
interface Answers {
	changed(): boolean;
	keys(): readonly string[];
}

type PaintMiss = 'container' | 'outside' | 'non-prose' | 'past-content';

function missed(paint: Paint, problem: PaintMiss, node: NodeView): string {
	const what = `a ${paint.type}`;
	if (problem === 'container') return `${what} on a ${node.kind}, whose children paint`;
	if (problem === 'non-prose') return `${what} on a ${node.kind}, which draws no inline widgets`;
	if (problem === 'past-content') return `${what} past its block's content`;
	const at =
		paint.type === 'widget'
			? `byte ${paint.at}`
			: paint.type === 'block'
				? ''
				: `bytes ${paint.from}..${paint.to}`;
	return `${what} at ${at}, which isn't its block's text`;
}

const NONE: readonly never[] = Object.freeze([]);
const NO_ANSWERS: PaintContext = Object.freeze({ depends: NONE });
const PAINT = Symbol('paint');

interface Held {
	raw: string;
	version: number;
	stamp: number;
	answers: number;
	key: string;
	decs: readonly Decoration[];
}

/** Bumped by `repaint` for one block; read beside the block's bytes. */
class Stamp {
	n = $state(0);
}

// A block moved by an edit above keeps its paint, under its new path.
function atPath(was: Held, path: readonly number[], key: string): readonly Decoration[] {
	if (was.key !== key) {
		was.key = key;
		was.decs = was.decs.map((dec) => ({ ...dec, path: [...path] }));
	}
	return was.decs;
}

// Spread copies a symbol key, so a decoration moved to a new path keeps its paint.
function withPaint<D extends Decoration>(dec: D, paint: Paint): D {
	return Object.assign(dec, { [PAINT]: paint });
}

function copy(attrs: Readonly<Record<string, string>> | undefined) {
	return attrs && { ...attrs };
}

/** `from`..`to` as offsets into the block's text; null where either end isn't its text. */
function rangeIn(
	block: PaintedBlock,
	from: number,
	to: number
): { start: number; end: number } | null {
	if (!(from <= to)) return null;
	const start = block.offsetAt(from);
	if (start === null) return null;
	if (to === from) return { start, end: start };
	// Its last byte, not `to`: in a quote the byte after a line's end is the next line's marker.
	const last = block.offsetAt(to - 1);
	return last === null ? null : { start, end: last + 1 };
}

/** The document range a stored mark covers now. */
function rangeOf(block: PaintedBlock | null, dec: MarkDecoration): MarkAt['range'] {
	const from = block ? block.byteAt(dec.start) : -1;
	const last = block && dec.end > dec.start ? block.byteAt(dec.end - 1) : -1;
	return { from, to: dec.end > dec.start && last >= 0 ? last + 1 : from };
}

/** One adapter per plugin function, so a mark painted again with the same handlers stays equal. */
function createHandlers(deps: PaintSourceDeps<PaintedBlock>) {
	const hovers = new WeakMap<object, MarkHandler<'onHover'>>();
	const activates = new WeakMap<object, MarkHandler<'onActivate'>>();
	const clicks = new WeakMap<object, MarkHandler<'onClick'>>();

	const at = (dec: MarkDecoration, anchor: DOMRect, rects: readonly DOMRect[]): MarkAt => ({
		range: rangeOf(deps.blockAt(dec.path), dec),
		anchor,
		rects
	});
	// A throw is the plugin's, reported naming it.
	function guarded(doing: string, run: () => void): void {
		try {
			run();
		} catch (cause) {
			deps.report({ plugin: deps.plugin, doing, cause });
		}
	}

	return {
		of({ hover, activate, click }: MarkPaint): MarkInteractions | undefined {
			if (!hover && !activate && !click) return undefined;
			return {
				onHover:
					hover &&
					cached(
						hovers,
						hover,
						() => (dec, seen) =>
							guarded('hover', () => hover(seen && at(dec, seen.anchor, seen.rects)))
					),
				onActivate:
					activate &&
					cached(
						activates,
						activate,
						() =>
							(dec, { anchor }) =>
								guarded('activate', () => activate(at(dec, anchor, deps.rectsOf(dec))))
					),
				onClick:
					click &&
					cached(
						clicks,
						click,
						() => (dec, event) =>
							guarded('click', () => {
								const rects = deps.rectsOf(dec);
								click(at(dec, rectUnder(rects, event), rects), event);
							})
					)
			} as MarkInteractions;
		}
	};
}

function cached<A>(cache: WeakMap<object, A>, fn: object, make: () => A): A {
	let made = cache.get(fn);
	if (!made) cache.set(fn, (made = make()));
	return made;
}

type MarkHandler<K extends 'onHover' | 'onActivate' | 'onClick'> = NonNullable<
	Extract<MarkInteractions, Record<K, unknown>>[K]
>;

function rectUnder(rects: readonly DOMRect[], event: MouseEvent): DOMRect {
	const { clientX: x, clientY: y } = event;
	const under = rects.find((r) => r.left <= x && x <= r.right && r.top <= y && y <= r.bottom);
	return under ?? rects[0] ?? new DOMRect(x, y, 0, 0);
}

// The decoration carries its paint, so `widget-dom.ts` mounts this view with `{ paint }`.
function viewSpec<P extends Paint>(view: PluginView<{ paint: P }>): DecorationWidgetSpec {
	return { view } as unknown as DecorationWidgetSpec;
}
