/**
 * The drawn caret's source guards. One module writes its element and the class that hides the
 * browser's caret (G4.141); `caret-color` is declared only for the surfaces that hide it on purpose
 * (G4.142); and every native selection write sits inside the per-editor caret writer, whose writes
 * ask for a repaint, while the paint at an animation frame only paints (G4.143).
 */

import { describe, expect, it } from 'vitest';
import { describeManifests, type ManifestRule } from './file-rule';
import { balancedBlock, balancedCall, collectEditorSources, readSource } from './scan-source';
import { SOURCE } from './source-paths';

const DRAWN_CARET = 'src/lib/caret/drawn-caret.svelte.ts';
const CARET_WRITER = 'src/lib/caret/widget-offset.ts';

// ── G4.141 one writer for the element and the class ─────────────────────────

const ONE_WRITER: ManifestRule[] = [
	{
		id: 'G4.141 only the drawn caret names the class that hides the browser’s caret',
		matches: /md-caret-drawn/,
		declared: { [DRAWN_CARET]: 'adds it to the surface it draws for, in the paint that draws' },
		reason:
			'the class and the drawn bar change in one paint, so the page never shows two carets or none; a surface asks for a repaint instead of writing the class',
		hits: ["el.classList.add('md-caret-drawn');", '<div class:md-caret-drawn={drawn}>'],
		misses: ["el.classList.add('md-caret-draw');", '// md-caret-drawn hides the native caret']
	},
	{
		id: 'G4.141 only the drawn caret makes the drawn caret’s element',
		matches: /md-drawn-caret/,
		declared: { [DRAWN_CARET]: 'makes the one element per editor and moves it between hosts' },
		reason: 'one element per editor is what keeps the drawn caret one caret',
		hits: ["bar.className = 'md-drawn-caret';", "root.querySelector('.md-drawn-caret')"],
		misses: ["const name = 'md-drawn';"]
	}
];

describeManifests(ONE_WRITER, collectEditorSources());

// ── G4.142 caret-color only on the known surfaces ───────────────────────────

/** Each rule allowed to set `caret-color`, by file and selector. */
const CARET_COLOR_RULES: Record<string, string> = {
	[`${SOURCE.editorCss} :: :where(.editor) .md-caret-drawn`]:
		'the surface the drawn caret is drawing for, in the paint that draws it',
	[`${SOURCE.editorCss} :: :where(.editor)[data-cross-block] [contenteditable]`]:
		'a cross-block range, whose overlay paints and whose parked caret takes paste only',
	[`${SOURCE.editorCss} :: :where(.editor) .whole-block-input`]:
		'the proxy that takes input for a block held whole, which holds no caret anyone sees',
	[`${SOURCE.editorCss} :: :where(.editor) .md-snap-caret-active`]:
		'a block whose snap caret is drawn beside an inline widget',
	['src/lib/components/GapCaret.svelte :: .gap-caret-proxy']:
		'the gap caret’s proxy, whose own line is the caret'
};

const CARET_COLOR_REASON =
	'a `caret-color` rule outside these hides or recolors the browser’s caret behind the drawn caret’s back, so the page can show none or two; hide it through the drawn caret';

/** Every rule declaring `caret-color` in `code`, keyed `relPath :: selector`. */
function caretColorRules(relPath: string, code: string): string[] {
	const keys: string[] = [];
	for (const match of code.matchAll(/caret-color\s*:/g)) {
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

	it('reads the selector of every rule, nested or not', () => {
		const css =
			'a { color: red; }\n@media (x) {\n\t.b .c {\n\t\tcaret-color: auto;\n\t}\n}\n.d{caret-color:red}';
		expect(caretColorRules('x.css', css)).toEqual(['x.css :: .b .c', 'x.css :: .d']);
	});
});

// ── G4.143 every caret write asks for a repaint ─────────────────────────────

/** A write to the native selection, or a call of the private function that makes one. */
const NATIVE_WRITE =
	/\.(?:addRange|setBaseAndExtent|extend|selectAllChildren|removeAllRanges|empty)\s*\(|\.(?:collapse|setPosition)\s*\([^,()]*,|\bwriteSelection\s*\(/g;

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

		const frame = 'function atFrame() { frame = 0; paint(); }\nrequestAnimationFrame(atFrame);';
		expect(frameCallbacks(frame)).toEqual([{ callback: 'atFrame', calls: ['paint'] }]);
		const sequencing =
			'function atFrame() { paint(); selection.clear(); }\nrequestAnimationFrame(atFrame);';
		expect(frameCallbacks(sequencing)[0].calls).toEqual(['paint', 'clear']);
		expect(frameCallbacks('requestAnimationFrame(() => paint());')[0].calls).toBeNull();
	});
});
