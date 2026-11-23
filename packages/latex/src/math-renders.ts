/**
 * One editor's formulas as its renderer draws them: cached by theme, display and source, so a
 * formula the document repeats renders once. Without a renderer a formula shows its source, and
 * a renderer that throws shows the source in the error colour with the message on hover.
 */
import { renderSourceFallback } from '@voithos-labs/aragonite/plugin';
import { mathErrorNode, type MathRender, type MathRenderer } from './math-renderer';
import type { MathBlockLayout } from './math-layout';

/** A live preview adds a formula a key, so the oldest drawing goes past this many. */
const KEPT = 256;

export interface MathRenders {
	/** A copy of the drawing of its own, since a node can sit in one place only. */
	render(source: string, display: boolean, theme: string): MathRender;
}

/** What one editor's math blocks read: its renderings and the layout an open block starts in. */
export interface MathEditor {
	renders: MathRenders;
	layout: MathBlockLayout;
}

/** The Svelte context key a math block finds its `MathEditor` under. */
export const MATH_EDITOR = Symbol('latex.editor');

export function mathRenders(renderer: MathRenderer | undefined): MathRenders {
	const drawn = new Map<string, MathRender>();
	const draw = (source: string, display: boolean, theme: string): MathRender => {
		try {
			return renderer!(source, { display, theme });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { dom: mathErrorNode(source, message), error: message };
		}
	};
	return {
		render(source, display, theme) {
			if (!renderer) return { dom: renderSourceFallback(source, 'Math renderer not configured') };
			const key = `${theme}\0${display}\0${source}`;
			const made = drawn.get(key) ?? draw(source, display, theme);
			// Kept last, so the first key is always the one used longest ago.
			drawn.delete(key);
			drawn.set(key, made);
			if (drawn.size > KEPT) drawn.delete(drawn.keys().next().value!);
			return { dom: made.dom.cloneNode(true) as HTMLElement, error: made.error };
		}
	};
}
