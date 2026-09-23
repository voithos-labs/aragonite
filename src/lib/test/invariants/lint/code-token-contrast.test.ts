/**
 * WCAG AA for the text the editor paints, computed from the declared palette in both themes
 * against the surface and the fence (`--color-bg-secondary` composited over it): every
 * `--code-tok-*` color, the UI grey tokens that paint text (also over the menu background),
 * the greys that mark text as done or inert, and each marker color at the `--syntax-marker-dim`
 * opacity markers are drawn with. The axe gate cannot certify this: it scans the harness page.
 */
// Miss-analysis: the a11y gate measured the demo shell's background, so nothing ever
// computed a ratio against the library's declared surfaces, and no gate enumerated the
// token family, so three declarations sharing one failing hex read as one known failure.
// Miss-analysis (#290 #396 #397): the gate knew only the code tokens, then only named greys on
// the document's surfaces, so dimmed markers, greys over menus and alpha greys failed unseen.
import { describe, it, expect } from 'vitest';
import { readEditorFile, stripComments } from './scan-source';
import { declaredValue, themeBlocks } from './theme-css';

const AA_CONTRAST = 4.5;

type Rgb = [number, number, number];

// ── WCAG 2.1 contrast over composited colors ────────────────────────────────

function parseHex(value: string): Rgb | null {
	const digits = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];
	if (digits === undefined) return null;
	return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

function parseRgba(value: string): { color: Rgb; alpha: number } | null {
	const parts = /^rgba?\(([^)]*)\)$/i.exec(value.trim())?.[1];
	if (parts === undefined) return null;
	const numbers = parts.split(',').map((n) => Number(n.trim()));
	if (numbers.length !== 4 || numbers.some(Number.isNaN)) return null;
	return { color: numbers.slice(0, 3) as Rgb, alpha: numbers[3] };
}

/** Unquantized, matching what an auditing tool computes from the declared alpha. */
function composite(over: Rgb, alpha: number, under: Rgb): Rgb {
	return over.map((channel, i) => alpha * channel + (1 - alpha) * under[i]) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
	const linear = (channel: number): number => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
	const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (lighter + 0.05) / (darker + 0.05);
}

// ── The declared palette, per theme ─────────────────────────────────────────

const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

const CODE_TOKEN_DECL = /(--code-tok-[a-z-]+)\s*:\s*([^;]+);/g;

interface Palette {
	surface: Rgb;
	fence: Rgb;
	/** `--color-bg`: the menus, toolbars and link card paint on it. */
	menu: Rgb;
	/** Only the tokens naming a color; `inherit` takes the surrounding text color. */
	colors: Map<string, Rgb>;
}

// A light rule overrides the dark default it does not repeat, exactly as the cascade does.
function themeValue(theme: Theme): (token: string) => string {
	const { base, light } = themeBlocks();
	const layers = theme === 'light' ? [light, base] : [base];
	return (token) => {
		for (const block of layers) {
			const declared = declaredValue(block, token);
			if (declared !== null) return declared;
		}
		throw new Error(`${token} is declared in neither theme block`);
	};
}

function paletteFor(theme: Theme): Palette {
	const { base, light } = themeBlocks();
	const layers = theme === 'light' ? [base, light] : [base];
	const value = themeValue(theme);

	const surface = parseHex(value('--color-surface'));
	const veil = parseRgba(value('--color-bg-secondary'));
	const menu = parseHex(value('--color-bg'));
	if (surface === null || veil === null || menu === null)
		throw new Error(`${theme} surfaces are no longer literals`);

	const colors = new Map<string, Rgb>();
	for (const block of layers) {
		for (const [, token, declared] of block.matchAll(CODE_TOKEN_DECL)) {
			const color = parseHex(declared);
			if (color === null) colors.delete(token);
			else colors.set(token, color);
		}
	}
	return { surface, fence: composite(veil.color, veil.alpha, surface), menu, colors };
}

// ── UI text and dimmed markers ──────────────────────────────────────────────

/** The grey tokens menus, rails, cards and toolbars paint text with. */
const UI_TEXT_TOKENS = [
	'--color-ui-muted',
	'--color-ui-dulled',
	'--color-text-muted',
	'--color-text-secondary'
];

/** The colors a marker takes before the dim: its construct's syntax token. Every marker not
 *  listed inherits the prose color, which `currentColor` resolves to. */
const MARKER_COLOR_TOKENS = ['--syntax-heading', '--syntax-emphasis', '--syntax-list'];

/** The greys that set text apart as done or inert: a checked task, a reference label, a link
 *  whose scheme is refused, and inline raw HTML. All paint inside the document. */
const DE_EMPHASIS_TOKENS = [
	'--syntax-task-done',
	'--md-ref-label-color',
	'--md-link-blocked-color',
	'--md-raw-html-color'
];

/** A token's color: a hex, `currentColor` (the editor's text color), or a `var()` chain
 *  whose fallback stands in for an undeclared name. */
function resolveColor(declared: string, value: (token: string) => string): Rgb {
	const trimmed = declared.trim();
	if (trimmed === 'currentColor') return resolveColor(value('--color-text-primary'), value);
	const reference = /^var\(\s*(--[a-z-]+)\s*(?:,\s*(.+))?\)$/i.exec(trimmed);
	if (reference) {
		const [, token, fallback] = reference;
		try {
			return resolveColor(value(token), value);
		} catch (error) {
			if (fallback === undefined) throw error;
			return resolveColor(fallback, value);
		}
	}
	const color = parseHex(trimmed);
	if (color === null) throw new Error(`cannot measure ${trimmed}`);
	return color;
}

type Background = 'surface' | 'fence' | 'menu';

const BACKGROUND_NAMES: Record<Background, string> = {
	surface: 'surface',
	fence: 'fence',
	menu: 'menu background'
};

/** A token's paint over a background: an `rgba()` composites, any other color is opaque. */
function resolvePaint(declared: string, value: (token: string) => string): (under: Rgb) => Rgb {
	const translucent = parseRgba(declared);
	if (translucent !== null)
		return (under) => composite(translucent.color, translucent.alpha, under);
	const color = resolveColor(declared, value);
	return () => color;
}

interface TextSample {
	name: string;
	/** The painted color over a given background. */
	paint: (background: Rgb) => Rgb;
	backgrounds: Background[];
}

function textSamplesFor(theme: Theme): TextSample[] {
	const value = themeValue(theme);
	const dim = Number(value('--syntax-marker-dim'));
	const ui = UI_TEXT_TOKENS.map((token): TextSample => {
		const color = resolveColor(value(token), value);
		return { name: token, paint: () => color, backgrounds: ['surface', 'fence', 'menu'] };
	});
	const markers = ['currentColor', ...MARKER_COLOR_TOKENS].map((source): TextSample => {
		const color = resolveColor(source === 'currentColor' ? source : value(source), value);
		return {
			name: `a ${source === 'currentColor' ? 'prose' : source} marker at ${dim}`,
			paint: (background: Rgb) => composite(color, dim, background),
			backgrounds: ['surface', 'fence']
		};
	});
	const deEmphasis = DE_EMPHASIS_TOKENS.map((token): TextSample => ({
		name: token,
		paint: resolvePaint(value(token), value),
		backgrounds: ['surface', 'fence']
	}));
	return [...ui, ...markers, ...deEmphasis];
}

describe('WCAG AA: UI text, done or inert text and dimmed markers on the backgrounds they use', () => {
	it.each(THEMES)('%s: every sample clears AA on each background it paints on', (theme) => {
		const palette = paletteFor(theme);
		const violations: string[] = [];
		for (const sample of textSamplesFor(theme)) {
			for (const name of sample.backgrounds) {
				const background = palette[name];
				const ratio = contrastRatio(sample.paint(background), background);
				if (ratio < AA_CONTRAST)
					violations.push(`${sample.name} on the ${BACKGROUND_NAMES[name]}: ${ratio.toFixed(2)}:1`);
			}
		}
		expect(violations).toEqual([]);
	});

	// Non-vacuity: a dim read as NaN or a family that resolved to nothing passes the case above.
	it('reads a numeric dim and measures every family in both themes', () => {
		for (const theme of THEMES) {
			const samples = textSamplesFor(theme);
			expect(samples).toHaveLength(
				UI_TEXT_TOKENS.length + MARKER_COLOR_TOKENS.length + 1 + DE_EMPHASIS_TOKENS.length
			);
			expect(Number(themeValue(theme)('--syntax-marker-dim'))).toBeGreaterThan(0);
		}
		// The greys the widenings were built to catch: the light muted grey that shipped at 3.3:1,
		// and the muted greys that read 4.2 and 4.3:1 over the menu background.
		expect(contrastRatio([0x83, 0x83, 0x7b], paletteFor('light').surface)).toBeLessThan(
			AA_CONTRAST
		);
		expect(contrastRatio([0x67, 0x67, 0x61], paletteFor('light').menu)).toBeLessThan(AA_CONTRAST);
		expect(contrastRatio([0x8f, 0x8f, 0x89], paletteFor('dark').menu)).toBeLessThan(AA_CONTRAST);
		expect(contrastRatio([0x71, 0x71, 0x6a], paletteFor('light').menu)).toBeLessThan(AA_CONTRAST);
		// And the checked task's alpha grey, which read 2.2:1 composited over the light surface.
		const surface = paletteFor('light').surface;
		const taskDone = resolvePaint('rgba(128, 128, 128, 0.7)', themeValue('light'));
		expect(contrastRatio(taskDone(surface), surface)).toBeLessThan(AA_CONTRAST);
	});
});

describe('WCAG AA: code tokens against the surfaces the editor paints them on', () => {
	it.each(THEMES)('%s: every code token clears AA on the surface and on the fence', (theme) => {
		const { surface, fence, colors } = paletteFor(theme);
		const violations: string[] = [];
		for (const [token, color] of colors) {
			for (const [name, background] of [
				['surface', surface],
				['fence', fence]
			] as const) {
				const ratio = contrastRatio(color, background);
				if (ratio < AA_CONTRAST) violations.push(`${token} on the ${name}: ${ratio.toFixed(2)}:1`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('every `--code-tok-*` declaration is a color this test can measure', () => {
		const css = stripComments(readEditorFile('styles/editor-theme.css').text);
		const unmeasurable = [...css.matchAll(CODE_TOKEN_DECL)]
			.filter(([, , value]) => parseHex(value) === null && value.trim() !== 'inherit')
			.map(([, token, value]) => `${token}: ${value.trim()}`);
		expect(unmeasurable, 'teach parseHex the new form, or the token escapes the gate').toEqual([]);
	});

	// Non-vacuity: an empty palette or a broken ratio passes every assertion above.
	it('the palette read and the ratio are non-vacuous', () => {
		const dark = paletteFor('dark');
		const light = paletteFor('light');
		expect(dark.colors.size).toBeGreaterThan(10);
		expect(dark.colors.get('--code-tok-keyword')).not.toEqual(
			light.colors.get('--code-tok-keyword')
		);
		expect(dark.colors.has('--code-tok-variable')).toBe(false);
		expect(dark.fence).not.toEqual(dark.surface);
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
		// The comment grey this gate was built to catch: the assertion must be able to fail.
		expect(contrastRatio([0x75, 0x71, 0x5e], dark.fence)).toBeLessThan(AA_CONTRAST);
	});
});
