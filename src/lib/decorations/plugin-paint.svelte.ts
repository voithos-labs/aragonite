/**
 * One plugin's `paint`, read a block at a time: asked for a block the editor renders, kept while the
 * block's bytes and the paint's version hold, and stored in the block's own offsets. A mark's
 * handlers read its range in document bytes as they run.
 */
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { tick, untrack } from 'svelte';
import type { NodeView } from '../core/node-views';
import type { MarkAt, MarkPaint, Paint } from './paint';
import type { PluginView } from '../plugin-view';
import { inlineWidgetMiss, paintsOnlyClasses } from './paint-lands';
import { recordPaintCall } from '../perf/instruments';
import type { BlockSource } from './block-paint';
import { pathKey } from './buckets';
import type {
	Decoration,
	DecorationWidgetSpec,
	MarkDecoration,
	MarkHover,
	MarkInteractions
} from './types';

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
	/** The plugin's contribution, whose `paint` only this source calls. */
	contribution: { paint?(block: B): readonly Paint[] };
	blockOf(node: NodeView, path: readonly number[]): B;
	/** The block at `path` in the document now, which a handler reads its range through. */
	blockAt(path: readonly number[]): B | null;
	/** The viewport rects a mark paints, empty while its block is off screen. */
	rectsOf(dec: MarkDecoration): DOMRect[];
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

	// Inside a derived, where a listener that writes state would throw, so it waits for the flush.
	function reportLater(error: PaintError): void {
		if (queued.push(error) > 1) return;
		void tick().then(() => {
			const errors = queued;
			queued = [];
			for (const each of errors) deps.report(each);
		});
	}

	function decorationsOf(node: NodeView, path: readonly number[]): readonly Decoration[] {
		const raw = node.raw;
		const asked = version;
		let stamp = stamps.get(node);
		if (!stamp) stamps.set(node, (stamp = new Stamp()));
		const repainted = stamp.n;
		const key = pathKey(path);
		const was = held.get(node);
		if (was && was.raw === raw && was.version === asked && was.stamp === repainted) {
			return atPath(was, path, key);
		}
		const decs = untrack(() => painted(node, path, was));
		held.set(node, { raw, version: asked, stamp: repainted, key, decs });
		return decs;
	}

	function painted(node: NodeView, path: readonly number[], was: Held | undefined) {
		recordPaintCall(path);
		const block = deps.blockOf(node, path);
		let paints: readonly Paint[];
		try {
			paints = deps.contribution.paint?.(block) ?? NONE;
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
		if (paintsOnlyClasses(node)) {
			return miss(`${type}\0container`, `a ${type} on a ${node.kind}, whose children paint`);
		}
		if (type === 'widget') {
			const offset = block.offsetAt(paint.at);
			if (offset === null) return outside(type, `byte ${paint.at}`);
			if (devChecksOn) warnIfUnrendered(type, node, offset);
			return withPaint(
				{ type, path: at, offset, side: paint.side, widget: viewSpec(paint.view) },
				paint
			);
		}
		const range = rangeIn(block, paint.from, paint.to);
		if (!range) return outside(type, `bytes ${paint.from}..${paint.to}`);
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
		if (devChecksOn) warnIfUnrendered(type, node, range.start, range.end);
		const widget = paint.view && viewSpec(paint.view);
		return withPaint({ type, path: at, ...range, class: paint.class, widget }, paint);
	}

	function outside(type: Paint['type'], where: string): null {
		return miss(`${type}\0outside`, `a ${type} at ${where}, which isn't its block's text`);
	}

	function warnIfUnrendered(
		type: Paint['type'],
		node: NodeView,
		start: number,
		end?: number
	): void {
		const unrendered = inlineWidgetMiss(node, start, end);
		if (!unrendered) return;
		const where =
			unrendered.reason === 'non-prose'
				? `on a ${node.kind}, which draws no inline widgets`
				: "past its block's content";
		miss(`${type}\0${unrendered.reason}`, `a ${type} ${where}`);
	}

	// Once per plugin and problem, not per block: a paint that misses once misses everywhere.
	function miss(key: string, what: string): null {
		if (devChecksOn && !warned.has(key)) {
			warned.add(key);
			devWarn('decorations', `plugin '${plugin}' paints ${what}; it's left out`);
		}
		return null;
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

/** The paint a widget, replace or block decoration was placed from: its view is told this paint,
 *  not the decoration. */
export function paintBehind(dec: Decoration): Paint | undefined {
	return (dec as { [PAINT]?: Paint })[PAINT];
}

// ── Internal ─────────────────────────────────────────────────────────────────

const NONE: readonly never[] = Object.freeze([]);
const PAINT = Symbol('paint');

interface Held {
	raw: string;
	version: number;
	stamp: number;
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
	const hovers = new WeakMap<NonNullable<MarkPaint['hover']>, MarkHandler<'onHover'>>();
	const activates = new WeakMap<NonNullable<MarkPaint['activate']>, MarkHandler<'onActivate'>>();
	const clicks = new WeakMap<NonNullable<MarkPaint['click']>, MarkHandler<'onClick'>>();

	const range = (dec: MarkDecoration) => rangeOf(deps.blockAt(dec.path), dec);
	function guarded(doing: string, run: () => void): void {
		try {
			run();
		} catch (cause) {
			deps.report({ plugin: deps.plugin, doing, cause });
		}
	}

	function hover(fn: NonNullable<MarkPaint['hover']>): MarkHandler<'onHover'> {
		let adapter = hovers.get(fn);
		if (!adapter) {
			adapter = (dec: MarkDecoration, at: MarkHover | null) =>
				guarded('hover', () => fn(at && { range: range(dec), anchor: at.anchor, rects: at.rects }));
			hovers.set(fn, adapter);
		}
		return adapter;
	}

	function activate(fn: NonNullable<MarkPaint['activate']>): MarkHandler<'onActivate'> {
		let adapter = activates.get(fn);
		if (!adapter) {
			adapter = (dec: MarkDecoration, { anchor }: { anchor: DOMRect }) =>
				guarded('activate', () => fn({ range: range(dec), anchor, rects: deps.rectsOf(dec) }));
			activates.set(fn, adapter);
		}
		return adapter;
	}

	function click(fn: NonNullable<MarkPaint['click']>): MarkHandler<'onClick'> {
		let adapter = clicks.get(fn);
		if (!adapter) {
			adapter = (dec: MarkDecoration, event: MouseEvent) =>
				guarded('click', () => {
					const rects = deps.rectsOf(dec);
					fn({ range: range(dec), anchor: rectUnder(rects, event), rects }, event);
				});
			clicks.set(fn, adapter);
		}
		return adapter;
	}

	return {
		of(paint: MarkPaint): MarkInteractions | undefined {
			if (!paint.hover && !paint.activate && !paint.click) return undefined;
			return {
				onHover: paint.hover && hover(paint.hover),
				onActivate: paint.activate && activate(paint.activate),
				onClick: paint.click && click(paint.click)
			} as MarkInteractions;
		}
	};
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
