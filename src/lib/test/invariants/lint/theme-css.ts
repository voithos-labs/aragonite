/**
 * `editor-theme.css` read as declarations. Base and light are each split across the
 * host-chrome and editor-owned tiers, so rules are classified by their own selector rather
 * than by one index split.
 */
import { readEditorFile, stripComments } from './scan-source';

export const LIGHT_SELECTOR = "[data-editor-theme='light']";

export interface ThemeBlocks {
	/** Every rule body without the light selector: the dark defaults. */
	base: string;
	/** Every light-selected rule body: the overrides layered over `base`. */
	light: string;
}

export function themeBlocks(): ThemeBlocks {
	const css = stripComments(readEditorFile('styles/editor-theme.css').text);
	let base = '';
	let light = '';
	for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
		if (selector.includes(LIGHT_SELECTOR)) light += body;
		else base += body;
	}
	return { base, light };
}

export function declaredValue(block: string, token: string): string | null {
	return block.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))?.[1].trim() ?? null;
}
