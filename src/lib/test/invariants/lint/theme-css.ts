/**
 * `editor-theme.css` read as declarations. Base and light are each split across the
 * host-supplied and editor-owned rules, so each rule is classified by its own selector rather
 * than by one index split.
 */
import { readEditorFile } from './scan-source';

export const LIGHT_SELECTOR = "[data-editor-theme='light']";

export interface ThemeBlocks {
	/** Every rule body without the light selector: the dark defaults. */
	base: string;
	/** Every light-selected rule body: the overrides layered over `base`. */
	light: string;
}

export function themeBlocks(): ThemeBlocks {
	const css = readEditorFile('styles/editor-theme.css').code;
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
