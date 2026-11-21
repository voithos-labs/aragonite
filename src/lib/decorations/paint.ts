/**
 * What a plugin's `paint` lays over one block: marks, widgets, replaced ranges and the block's own
 * classes, every position in document bytes. The editor asks only about blocks it has on screen and
 * keeps an answer while the block's bytes hold, so a paint that reads anything else asks again
 * through `editor.repaint`, or declares what it reads of the document with `paintDepends`.
 */
import type { PluginView } from '../plugin-view';

type Attrs = Readonly<Record<string, string>>;

/** What `paint` and `paintContainer` get beside the block. */
export interface PaintContext {
	/** What `paintDepends` answered for each top-level block, in `editor.doc.blocks`' order;
	 *  never changed after it's handed over, so it can key a cache. Empty without `paintDepends`. */
	readonly depends: readonly string[];
}

/** One thing `paint` lays over its block. */
export type Paint = MarkPaint | WidgetPaint | ReplacePaint | BlockPaint;

/** Where a mark is as one of its handlers runs: its bytes in the document now, the rect the pointer
 *  or the caret is on, and every rect it paints (one per line). */
export interface MarkAt {
	readonly range: { readonly from: number; readonly to: number };
	readonly anchor: DOMRect;
	readonly rects: readonly DOMRect[];
}

/** A class drawn behind `from`..`to`. Only a mark with `click` takes the pointer; one with just
 *  `hover` or `activate` lets a press through to the text. */
export interface MarkPaint {
	readonly type: 'mark';
	readonly from: number;
	readonly to: number;
	readonly class: string;
	readonly attrs?: Attrs;
	/** The pointer entered the mark; `null` once it left, or the mark went. */
	hover?(at: MarkAt | null): void;
	/** The `decorations.activateAtCaret` command ran with the caret in the mark. */
	activate?(at: MarkAt): void;
	/** Runs before the caret lands where the press was; `event.preventDefault()` keeps it in place. */
	click?(at: MarkAt, event: MouseEvent): void;
}

/** A view at byte `at`, taking no bytes, drawn after it unless `side` is `'before'`. */
export interface WidgetPaint {
	readonly type: 'widget';
	readonly at: number;
	readonly side?: 'before' | 'after';
	readonly view: PluginView<{ paint: WidgetPaint }>;
	readonly data?: unknown;
}

/** A view, or an empty span with `class`, standing in for `from`..`to`; the bytes stay. */
export interface ReplacePaint {
	readonly type: 'replace';
	readonly from: number;
	readonly to: number;
	readonly view?: PluginView<{ paint: ReplacePaint }>;
	readonly class?: string;
	readonly data?: unknown;
}

/** Classes and attributes on the block's own element, and a badge view drawn ahead of it. */
export interface BlockPaint {
	readonly type: 'block';
	readonly class?: string;
	readonly attrs?: Attrs;
	readonly badge?: PluginView<{ paint: BlockPaint }>;
	readonly data?: unknown;
}
