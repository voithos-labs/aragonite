/**
 * The renderer one editor's diagrams draw through, and its cache, never mermaid itself, which stays
 * behind the `/renderer` subpath so it never lands in the main bundle. `MermaidBlock` reads it from
 * its component context, which the plugin's `contributes` fills once per editor.
 */
import { createBoundedMemo } from '@voithos-labs/aragonite/plugin';

/** What the editor knows at render time that the diagram text does not carry. */
export interface MermaidRenderContext {
	/** Mermaid paints colors into the SVG, so a stylesheet cannot retheme a drawn diagram:
	 *  the renderer has to draw for the theme. */
	theme: string;
}

/** Third parameter, so an existing `(code, id) => …` renderer stays assignable. */
export type MermaidRenderer = (
	code: string,
	id: string,
	context: MermaidRenderContext
) => Promise<string /* svg */>;

export interface MermaidRenderResult {
	svg?: string;
	error?: string;
}

/** One editor's renderings, each code drawn once per theme. */
export interface MermaidRenders {
	readonly configured: boolean;
	render(code: string, theme: string): Promise<MermaidRenderResult>;
}

/** The Svelte context key a diagram finds its editor's `MermaidRenders` under. */
export const DIAGRAMS = Symbol('mermaid.renders');

let renderSeq = 0;

export function mermaidRenders(renderer: MermaidRenderer | undefined): MermaidRenders {
	const drawn = createBoundedMemo<string, Promise<MermaidRenderResult>>({ cap: 256 });
	const draw = async (code: string, theme: string): Promise<MermaidRenderResult> => {
		try {
			// Mermaid needs a fresh element id per render.
			return { svg: await renderer!(code, `aragonite-mermaid-${renderSeq++}`, { theme }) };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	};
	return {
		configured: renderer !== undefined,
		render(code, theme) {
			if (!renderer) return Promise.resolve({ error: 'renderer not configured' });
			return drawn(`${theme}\0${code}`, () => draw(code, theme));
		}
	};
}
