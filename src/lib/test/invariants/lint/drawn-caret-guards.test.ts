/**
 * The drawn caret's source guards. One module writes its element and the attribute that hides the
 * browser's caret (G4.141); `caret-color` is declared only for the surfaces that hide it on purpose
 * (G4.142); and every native selection write sits inside the per-editor caret writer, whose writes
 * ask for a repaint, while the paint at an animation frame only paints (G4.143). The class names
 * and blink of the widget and gap carets' own painters appear nowhere in `src/lib` (G4.144).
 */

import { describe, expect, it } from 'vitest';
import { describeFileRules, describeManifests, type ManifestRule } from './file-rule';
import { balancedBlock, balancedCall, collectEditorSources, readSource } from './scan-source';
import { SOURCE } from './source-paths';
import { NATIVE_SELECTION_WRITE } from './native-selection-write';

const DRAWN_CARET = 'src/lib/caret/drawn-caret.svelte.ts';
const CARET_WRITER = 'src/lib/caret/widget-offset.ts';

// ── G4.141 one writer for the element and the mark ──────────────────────────

const ONE_WRITER: ManifestRule[] = [
	{
		id: 'G4.141 only the drawn caret names the attribute that hides the browser’s caret',
		matches: /data-caret-drawn/,
		declared: { [DRAWN_CARET]: 'adds it to the surface it draws for, in the paint that draws' },
		reason:
			'the mark and the drawn bar change in one paint, so the page never shows two carets or none; a surface asks for a repaint instead of writing the mark',
		hits: ["el.setAttribute('data-caret-drawn', '');", '<div data-caret-drawn={drawn}>'],
		misses: [
			"el.setAttribute('data-caret-draw', '');",
			'// data-caret-drawn hides the native caret'
		]
	},
	{
		id: 'G4.141 only the drawn caret makes the drawn caret’s element',
		matches: /md-drawn-caret/,
		declared: {
			[DRAWN_CARET]: 'makes the one element per editor and moves it between hosts',
			'src/lib/caret/block-content-selector.ts':
				'names the bar among a block host’s children, so a lookup of block content skips it'
		},
		reason: 'one element per editor is what keeps the drawn caret one caret',
		hits: ["bar.className = 'md-drawn-caret';", "root.querySelector('.md-drawn-caret')"],
		misses: ["const name = 'md-drawn';"]
	}
];

describeManifests(ONE_WRITER, collectEditorSources());

// ── G4.142 caret-color only on the known surfaces ───────────────────────────

/** Each rule allowed to set `caret-color`, by file and selector. */
const CARET_COLOR_RULES: Record<string, string> = {
	[`${SOURCE.editorCss} :: :where(.editor) [data-caret-drawn]`]:
		'the surface the drawn caret is drawing for, in the paint that draws it',
	[`${SOURCE.editorCss} :: :where(.editor)[data-cross-block] [contenteditable]`]:
		'a cross-block range, whose overlay paints and whose parked caret takes paste only',
	[`${SOURCE.editorCss} :: :where(.editor) .whole-block-input`]:
		'the proxy that takes input for a block held whole, which holds no caret anyone sees',
	['src/lib/components/GapCaret.svelte :: .gap-caret-proxy']:
		'the gap caret’s proxy, whose caret is the drawn bar across the gap'
};

const CARET_COLOR_REASON =
	'a `caret-color` rule outside these hides or recolors the browser’s caret behind the drawn caret’s back, so the page can show none or two; hide it through the drawn caret';

/** Every rule declaring `caret-color` in `code`, keyed `relPath :: selector`. */
function caretColorRules(relPath: string, code: string): string[] {
	const keys: string[] = [];
	for (const match of code.matchAll(/(?<![\w-])caret-color\s*:/g)) {
		const open = code.lastIndexOf('{', match.index);
		const before = Math.max(code.lastIndexOf('}', open), code.lastIndexOf('{', open - 1));
		const selector = code
			.slice(before + 1, open)
			.replace(/\s+/g, ' ')
			.trim();
		keys.push(`${relPath} :: ${selector}`);
	}
	return keys;
}

describe('G4.142 caret-color is declared only for the known surfaces', () => {
	const styled = collectEditorSources(undefined, { includeStyles: true }).filter(
		(file) => file.relPath.endsWith('.css') || file.relPath.endsWith('.svelte')
	);
	const found = styled.flatMap((file) => caretColorRules(file.relPath, file.code));

	it('the rules setting it are exactly the declared ones', () => {
		expect(found.sort(), CARET_COLOR_REASON).toEqual(Object.keys(CARET_COLOR_RULES).sort());
	});

	it('reads the selector of every rule, nested or not, and no custom property', () => {
		const css =
			'a { color: red; }\n@media (x) {\n\t.b .c {\n\t\tcaret-color: auto;\n\t}\n}\n.d{caret-color:red}\n.e { --md-caret-color: red; }';
		expect(caretColorRules('x.css', css)).toEqual(['x.css :: .b .c', 'x.css :: .d']);
	});
});

// ── G4.144 no widget or gap painter of their own ────────────────────────────

// Spelled in parts, so this file's own probes are not a second painter.
const OLD_NAMES = [
	...['after', 'before', 'caret-active'].map((part) => `md-snap-${part}`),
	['gap-caret', 'line'].join('-'),
	// The edge ring, which the caret's look replaced.
	['md', 'edge', 'held'].join('-'),
	['EDGE', 'HELD', 'CLASS'].join('_'),
	['held', 'Elements'].join('')
];
const OLD_PAINTER = new RegExp(`\\b(?:${OLD_NAMES.join('|')})\\b`);
const OTHER_CARET_BLINK = /@keyframes\s+(?!md-caret-blink-[ab]\b)[\w-]*(?:caret|blink)/;
const keyframes = (name: string) => ['@keyframes', name, '{ 50% { opacity: 0; } }'].join(' ');

describeFileRules(
	[
		{
			id: 'G4.144 the old widget and gap caret painters and the edge ring stay gone',
			matches: (file) => OLD_PAINTER.test(file.code) || OTHER_CARET_BLINK.test(file.code),
			reason:
				'a second element painting a caret (a class drawing one beside a widget, a line at a gap, its own blink, a ring on the construct at an edge) is a second caret cue beside the drawn one; draw it as a state or a look of the drawn caret',
			hits: [
				`:where(.editor) [data-inline-widget].${OLD_NAMES[0]}::before { width: 1.5px; }`,
				`<div class="${OLD_NAMES[3]}"></div>`,
				`el.classList.add('${OLD_NAMES[2]}');`,
				keyframes(['gap', 'caret', 'blink'].join('-')),
				`content.classList.add('${OLD_NAMES[4]}');`,
				`outline: 2px solid var(--${OLD_NAMES[4]}-ring);`,
				`export const ${OLD_NAMES[5]} = 'x';`,
				`mark(${OLD_NAMES[6]}(at));`
			],
			misses: [
				keyframes('md-caret-blink-a'),
				keyframes('kind-cue-fade'),
				`// the ${OLD_NAMES[3]} went into the drawn caret`,
				"bar.setAttribute('data-caret-state', 'widget');"
			]
		}
	],
	collectEditorSources(undefined, { includeTests: true, includeStyles: true })
);

// ── G4.143 every caret write asks for a repaint ─────────────────────────────

/** A write to the native selection, or a call of the private function that makes one. */
const NATIVE_WRITE = new RegExp(`${NATIVE_SELECTION_WRITE.source}|\\bwriteSelection\\s*\\(`, 'g');

/** Offsets of every native write in `code` that sits outside `createCaretWriter`'s body. */
function writesOutsideWriter(code: string): number[] {
	const factory = /\bexport function createCaretWriter\s*\(/.exec(code);
	let span: [number, number] = [0, 0];
	if (factory) {
		const params = balancedCall(code, factory.index + factory[0].length) ?? '';
		const open = code.indexOf('{', factory.index + factory[0].length + params.length);
		const body = balancedBlock(code, open + 1) ?? '';
		span = [open, open + body.length + 1];
	}
	return [...code.matchAll(NATIVE_WRITE)]
		.map((match) => match.index)
		.filter((at) => at < span[0] || at > span[1]);
}

/** The names a function body calls, for a frame callback that may only paint. */
function callsIn(code: string, fn: string): string[] | null {
	const decl = new RegExp(String.raw`\bfunction ${fn}\s*\(\s*\)[^{]*\{`).exec(code);
	if (!decl) return null;
	const body = balancedBlock(code, decl.index + decl[0].length) ?? '';
	return [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

/** Every frame callback in `code` and what it calls; an inline callback reads as `null`. */
function frameCallbacks(code: string): Array<{ callback: string; calls: string[] | null }> {
	return [...code.matchAll(/\brequestAnimationFrame\s*\(/g)].map((match) => {
		const arg = (balancedCall(code, match.index + match[0].length) ?? '').trim();
		const named = /^[A-Za-z_$][\w$]*$/.test(arg);
		return { callback: arg, calls: named ? callsIn(code, arg) : null };
	});
}

describe('G4.143 every caret write asks the drawn caret to repaint', () => {
	it('the caret writer module writes the native selection only inside the per-editor writer', () => {
		const { code } = readSource(CARET_WRITER);
		expect(
			/\bexport function createCaretWriter\s*\(/.test(code),
			'createCaretWriter is the writer'
		).toBe(true);
		expect(
			writesOutsideWriter(code),
			'a write outside createCaretWriter skips the repaint request its onWrite makes'
		).toEqual([]);
	});

	it('the paint at an animation frame calls the paint and nothing else', () => {
		const callbacks = frameCallbacks(readSource(DRAWN_CARET).code);
		expect(callbacks.length).toBeGreaterThan(0);
		for (const { callback, calls } of callbacks) {
			expect(
				calls?.filter((name) => name !== 'paint'),
				`${callback}: a frame callback only reads and paints, so it orders nothing`
			).toEqual([]);
		}
	});

	it('the scans flag a write outside the writer and a frame callback that does more', () => {
		const writer =
			'export function createCaretWriter(onWrite) {\n\tfunction writeSelection(a) { sel.setBaseAndExtent(a); onWrite(); }\n}\n';
		expect(writesOutsideWriter(writer)).toEqual([]);
		expect(
			writesOutsideWriter(`${writer}export function rogue() { sel.removeAllRanges(); }`)
		).toHaveLength(1);
		expect(
			writesOutsideWriter('export function placeCaretAtRaw() { writeSelection(p, p); }')
		).toHaveLength(1);

		// Spelled in parts, so the unit suites' own timer scan reads no frame request here.
		const request = ['request', 'Animation', 'Frame'].join('');
		const frame = `function atFrame() { frame = 0; paint(); }\n${request}(atFrame);`;
		expect(frameCallbacks(frame)).toEqual([{ callback: 'atFrame', calls: ['paint'] }]);
		const sequencing = `function atFrame() { paint(); selection.clear(); }\n${request}(atFrame);`;
		expect(frameCallbacks(sequencing)[0].calls).toEqual(['paint', 'clear']);
		expect(frameCallbacks(`${request}(() => paint());`)[0].calls).toBeNull();
	});
});
