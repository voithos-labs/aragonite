/**
 * WCAG AA for code text, computed from the declared palette: every `--code-tok-*` color in
 * `editor-theme.css`, in both themes, against the two backgrounds code paints on — the
 * surface and the fence (`--color-bg-secondary` composited over it). The axe gate cannot
 * certify this, because it scans the harness page, whose own background shows through.
 */
// Miss-analysis: the a11y gate measured the demo shell's background, so nothing ever
// computed a ratio against the library's declared surfaces, and no gate enumerated the
// token family, so three declarations sharing one failing hex read as one known failure.
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
	/** Only the tokens naming a color; `inherit` takes the surrounding text color. */
	colors: Map<string, Rgb>;
}

function paletteFor(theme: Theme): Palette {
	const { base, light } = themeBlocks();
	// A light rule overrides the dark default it does not repeat, exactly as the cascade does.
	const layers = theme === 'light' ? [base, light] : [base];
	const value = (token: string): string => {
		for (const block of [...layers].reverse()) {
			const declared = declaredValue(block, token);
			if (declared !== null) return declared;
		}
		throw new Error(`${token} is declared in neither theme block`);
	};

	const surface = parseHex(value('--color-surface'));
	const veil = parseRgba(value('--color-bg-secondary'));
	if (surface === null || veil === null)
		throw new Error(`${theme} surfaces are no longer literals`);

	const colors = new Map<string, Rgb>();
	for (const block of layers) {
		for (const [, token, declared] of block.matchAll(CODE_TOKEN_DECL)) {
			const color = parseHex(declared);
			if (color === null) colors.delete(token);
			else colors.set(token, color);
		}
	}
	return { surface, fence: composite(veil.color, veil.alpha, surface), colors };
}

describe('WCAG AA — code tokens against the surfaces the editor paints them on', () => {
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
