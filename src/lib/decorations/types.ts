/**
 * View-only annotations layered over the rendered document. Decorations never enter the
 * CST: pure sources produce them per-instance, and overlays/islands consume them.
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

/** Render keys don't track widget identity: same position + class ⇒ equal. Vary `class`
 *  to force a re-render. */
export type DecorationWidgetSpec =
	| { component: import('svelte').Component<{ decoration: Decoration }> }
	| { buildDom: (dec: Decoration) => HTMLElement };

export interface ProvideContext {
	/** Bumped once per document change, never by invalidate(). The memo key for sources that
	 *  cache their scan; `doc.children` identity is NOT one, since typing mutates in place. */
	editEpoch: number;
}
export interface DecorationSource {
	name: string; // per-instance unique; duplicate addSource throws
	// Property, not method, syntax on purpose: params then check contravariantly, so an
	// implementation annotating the mutable Document is a compile error.
	provide: (doc: DocumentView, ctx: ProvideContext) => Decoration[];
}
export interface DecorationSourceHandle {
	/** Synchronous by contract: decorations and buckets reflect the new result before this
	 *  returns. Search's setQuery relies on it — never defer. The one exception is a call
	 *  from inside a commit (an `edit` handler): those coalesce to one run once it publishes,
	 *  since a source must never read a half-applied tree. */
	invalidate(): void;
	dispose(): void;
}
export interface DecorationRegistry {
	addSource(source: DecorationSource): DecorationSourceHandle;
}
