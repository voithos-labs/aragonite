/**
 * View-only annotations layered over the rendered document. Decorations never
 * enter the CST — they are produced per-instance by pure sources and consumed by
 * overlays/islands. The kinds: an inline `mark` span, a positioned `widget`, a
 * range `replace`, and a whole-block `block` treatment.
 */

import type { DocumentView } from '../core/node-views';

export interface MarkDecoration {
	type: 'mark';
	path: number[];
	start: number;
	end: number;
	class: string;
	attrs?: Record<string, string>;
	interactive?: { onClick: (dec: MarkDecoration, ev: MouseEvent) => void };
}
export interface WidgetDecoration {
	type: 'widget';
	path: number[];
	offset: number;
	side?: 'before' | 'after'; // default 'after'
	widget: DecorationWidgetSpec;
}
export interface ReplaceDecoration {
	type: 'replace';
	path: number[];
	start: number;
	end: number;
	widget?: DecorationWidgetSpec; // absent → island renders `class` span with no content
	class?: string;
}
export interface BlockDecoration {
	type: 'block';
	path: number[];
	class?: string;
	attrs?: Record<string, string>;
	badge?: DecorationWidgetSpec;
}
export type Decoration = MarkDecoration | WidgetDecoration | ReplaceDecoration | BlockDecoration;

/** Widget identity is untracked by render keys: two specs at the same position
 *  with the same class are treated as equal — vary `class` to force a re-render. */
export type DecorationWidgetSpec =
	| { component: import('svelte').Component<{ decoration: Decoration }> }
	| { buildDom: (dec: Decoration) => HTMLElement };

export interface ProvideContext {
	/** Monotonic counter bumped once per document change — an edit, or a whole-document
	 *  `source` replacement — and never by invalidate(). The memo key for sources that
	 *  cache their scan. `doc.children` identity is NOT a valid change signal: routine
	 *  typing mutates in place. */
	editEpoch: number;
}
export interface DecorationSource {
	name: string; // per-instance unique; duplicate addSource throws
	// Pure over doc + ctx + the source's own state. Property (not method) syntax
	// on purpose: params check contravariantly, so an implementation annotating
	// the mutable Document is a compile error — sources read through the view.
	provide: (doc: DocumentView, ctx: ProvideContext) => Decoration[];
}
export interface DecorationSourceHandle {
	/** Synchronous by contract: decorations and buckets reflect the new result
	 *  before this returns (search's setQuery relies on it — never defer). */
	invalidate(): void;
	dispose(): void;
}
export interface DecorationRegistry {
	addSource(source: DecorationSource): DecorationSourceHandle;
}
