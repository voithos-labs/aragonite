/**
 * G4.207: shipped CSS uses nothing Safari 15 can't parse outside an `@supports` block. Reads every
 * shipped stylesheet and component `<style>` block; the feature list matches limestone's bundle check.
 * Miss-analysis: no scan read the CSS for newer syntax, so a bare `color-mix` shipped in 0.11.0.
 */
import { describe, it, expect } from 'vitest';
import { balancedBlock, collectEditorSources, LIBRARY_ROOTS } from './scan-source';
import { SOURCE } from './source-paths';

const FEATURES: ReadonlyArray<[RegExp, string]> = [
	[/@container\b/g, 'container query'],
	[/\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/g, 'container unit'],
	[/color-mix\(/g, 'color-mix outside @supports']
];

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/** The text of a file's styles at its own offsets: the whole of a stylesheet, only the style blocks of a component. */
function styleText(relPath: string, code: string): string {
	if (relPath.endsWith('.css')) return code;
	let out = '';
	let at = 0;
	for (const m of code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
		const start = m.index + m[0].indexOf(m[1]);
		out += blank(code.slice(at, start)) + m[1];
		at = start + m[1].length;
	}
	return out + blank(code.slice(at));
}

/** Blank each `@supports` rule, braces balanced, keeping every line where it was. */
function withoutSupportsBlocks(css: string): string {
	let out = '';
	let i = 0;
	while (i < css.length) {
		const at = css.indexOf('@supports', i);
		if (at === -1) return out + css.slice(i);
		out += css.slice(i, at);
		const open = css.indexOf('{', at);
		const body = open === -1 ? null : balancedBlock(css, open + 1);
		const end = body === null ? css.length : open + 1 + body.length + 1;
		out += blank(css.slice(at, end));
		i = end;
	}
	return out;
}

function floorViolations(relPath: string, code: string): string[] {
	const css = withoutSupportsBlocks(styleText(relPath, code));
	return FEATURES.flatMap(([pattern, what]) =>
		[...css.matchAll(pattern)].map(
			(m) => `${relPath}:${css.slice(0, m.index).split('\n').length} ${what}`
		)
	);
}

describe('G4.207 shipped CSS keeps newer syntax behind @supports', () => {
	const files = collectEditorSources(LIBRARY_ROOTS, { includeStyles: true });
	const found = files
		.filter((f) => f.relPath.endsWith('.css') || f.relPath.endsWith('.svelte'))
		.flatMap((f) => floorViolations(f.relPath, f.code));

	it('no stylesheet or component style block holds unguarded newer syntax', () => {
		expect(found, 'move each into @supports with a plain fallback first').toEqual([]);
	});

	it('the scan flags a bare use and spares a guarded one', () => {
		const guarded =
			'@supports (color: color-mix(in srgb, red, blue)) { a { color: color-mix(in srgb, red, blue); } }';
		expect(floorViolations('x.css', guarded)).toEqual([]);
		expect(floorViolations('x.css', 'a {\n b: color-mix(in srgb, red, blue); }')).toEqual([
			'x.css:2 color-mix outside @supports'
		]);
		expect(
			floorViolations('x.css', '@container (min-width: 1px) { a { width: 3cqw; } }')
		).toHaveLength(2);
		expect(
			floorViolations(
				'x.svelte',
				'<script>const s = "color-mix(";</script><style>\na{b:color-mix(a)}</style>'
			)
		).toHaveLength(1);
	});

	it('the scan reaches the shipped stylesheets and component style blocks', () => {
		expect(files.some((f) => f.relPath === SOURCE.editorCss)).toBe(true);
		expect(files.some((f) => f.relPath.endsWith('.svelte') && f.code.includes('<style'))).toBe(
			true
		);
	});
});
