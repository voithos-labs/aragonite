/**
 * G4.11 — paste-transform two-site parity. Per the `paste-transforms.ts` header,
 * every site where clipboard text reaches `parse()` must run
 * `applyPasteTransforms` first, or a plugin's registered transform is silently
 * skipped for that route. Exactly two sanctioned sites route clipboard text to
 * the parser: the tree-op paste dispatch and the cross-block selection paste.
 *
 * This is a sibling-path parity guard for a funnel that can't exist yet — the two
 * paste routes are structurally different (one is a tree-op input, one a
 * selection handler), so there's no shared seam to force the call through.
 *
 * Two arms, because the two directions fail differently:
 *  - CALLER parity. Set-equality over the files that call `applyPasteTransforms`
 *    fails the day a caller is added or removed.
 *  - READ-SITE enumeration. Caller parity cannot see the shape this guard was
 *    written for: a new clipboard→parse route that never mentions the symbol
 *    contributes nothing to the caller set and passes. So the reads themselves
 *    are enumerated — every site that pulls text out of a clipboard or a drop
 *    payload must be a known site that reaches a sanctioned route, and each
 *    entry names the handoff symbol that carries it there, so ripping the
 *    handoff out fails the entry rather than silently orphaning the read.
 *
 * `deps.readText()` is deliberately NOT a read shape here despite its name: it
 * is `el.textContent`, the editable surface's own DOM text on input, and never
 * carries clipboard bytes. `dataTransfer.getData` has no site today and is
 * scanned so the drop route fires the day it is born.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

// A CALL to `applyPasteTransforms(`, excluding the `function applyPasteTransforms(`
// declaration in the module that defines it — a fixed-length negative lookbehind
// V8 accepts.
const CALL_RE = /(?<!function\s)\bapplyPasteTransforms\s*\(/;

/** Each sanctioned clipboard→parse site → why it legitimately parses clipboard text. */
const SANCTIONED_SITES: Record<string, string> = {
	'src/lib/selection/cross-block/paste.ts': 'cross-block selection paste parses the pasted slice',
	'src/lib/tree-operations/paste/dispatch.ts':
		'the paste tree-op parses the pasted text into blocks'
};

const RULE = `every clipboard→parse route must run applyPasteTransforms; the two sanctioned sites are ${Object.keys(
	SANCTIONED_SITES
).join(
	' and '
)}. A new site must route through one of them, or join this allowlist WITH an applyPasteTransforms call`;

// ── Read-site enumeration ────────────────────────────────────────────────────

/**
 * Pulling text out of a clipboard or a drop payload — the routes this rule
 * governs. The accessor arm tolerates `?.` and `!.` between the carrier and the
 * read: a non-null assertion is the shape a new route is most likely to be
 * written with, and matching only `.`/`?.` let a planted probe through.
 */
const CLIPBOARD_READ_RE =
	/(?:clipboardData|dataTransfer)\s*[!?]?\s*\.\s*getData\s*\(|clipboard\s*[!?]?\s*\.\s*read(?:Text)?\s*\(/;

/** Each site that reads external text → the sanctioned route it hands the text to. */
const READ_SITE_ROUTES: Record<string, { handoff: string; why: string }> = {
	'src/lib/components/blocks/editable-surface.ts': {
		handoff: 'pasteTail',
		why: 'the shared paste handler hands the text to the block’s pasteTail, which dispatches through the paste tree-op'
	},
	'src/lib/components/blocks/table/TableCellBlock.svelte': {
		handoff: 'pasteDispatch',
		why: 'the right-click menu paste has no ClipboardEvent to read, so it reads through navigator.clipboard and calls the paste tree-op directly'
	},
	'src/lib/selection/cross-block/paste.ts': {
		handoff: 'applyPasteTransforms',
		why: 'a sanctioned site itself: runs the transforms before parsing the pasted slice'
	}
};

const READ_RULE =
	'every clipboard/drop read must reach a sanctioned paste route. A new read site joins ' +
	'READ_SITE_ROUTES naming the handoff symbol that carries its text to applyPasteTransforms — ' +
	'a read that reaches parse() without one drops every plugin paste transform on that route';

function clipboardReadSites(sources: Array<{ relPath: string; code: string }>): string[] {
	return sources
		.filter((f) => CLIPBOARD_READ_RE.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('G4.11 paste-transform two-site parity', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('exactly the two sanctioned sites call applyPasteTransforms', () => {
		const callers = sources
			.filter((f) => CALL_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(callers, RULE).toEqual(Object.keys(SANCTIONED_SITES).sort());
	});

	it('each sanctioned site still holds a live call (no dead allowlist entry)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const site of Object.keys(SANCTIONED_SITES)) {
			const file = byPath.get(site);
			expect(file, `sanctioned site not found: ${site}`).toBeDefined();
			expect(CALL_RE.test(file!.code), `applyPasteTransforms call gone from ${site}`).toBe(true);
		}
	});

	// ── Arm 2: read-site enumeration ─────────────────────────────────────────

	it('every clipboard/drop read site is a known route to the transforms', () => {
		expect(clipboardReadSites(sources), READ_RULE).toEqual(Object.keys(READ_SITE_ROUTES).sort());
	});

	it('each read site still carries the handoff that reaches a sanctioned route', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const [relPath, route] of Object.entries(READ_SITE_ROUTES)) {
			const file = byPath.get(relPath);
			expect(file, `read site not found: ${relPath}`).toBeDefined();
			expect(
				file!.code.includes(route.handoff),
				`${relPath} reads external text but no longer mentions ${route.handoff} — ${route.why}`
			).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('flags a clipboard→parse route that never mentions the transforms', () => {
		// The shape caller parity structurally cannot see: a new route contributes
		// no element to the caller set, so only the read enumeration catches it.
		const rogue = {
			relPath: 'src/lib/blocks/rogue-paste.ts',
			code: "const t = e.clipboardData.getData('text/plain'); parse(t);"
		};
		expect(CALL_RE.test(rogue.code)).toBe(false);
		expect(clipboardReadSites([rogue])).toEqual(['src/lib/blocks/rogue-paste.ts']);
		expect(clipboardReadSites([rogue])).not.toEqual(Object.keys(READ_SITE_ROUTES).sort());
	});

	it('read matcher covers the async, drop, and assertion shapes, and ignores a DOM text read', () => {
		expect(CLIPBOARD_READ_RE.test('raw = await navigator.clipboard.readText();')).toBe(true);
		expect(CLIPBOARD_READ_RE.test("e.clipboardData?.getData('text/plain')")).toBe(true);
		expect(CLIPBOARD_READ_RE.test("e.dataTransfer?.getData('text/plain')")).toBe(true);
		expect(CLIPBOARD_READ_RE.test("e.clipboardData!.getData('text/plain')")).toBe(true);
		expect(CLIPBOARD_READ_RE.test('await navigator.clipboard!.readText()')).toBe(true);
		// The ClipboardItem API — the shape a rich-paste route would be born with.
		expect(CLIPBOARD_READ_RE.test('const items = await navigator.clipboard.read();')).toBe(true);
		// `deps.readText()` is `el.textContent`, not a clipboard read.
		expect(CLIPBOARD_READ_RE.test('const text = deps.readText();')).toBe(false);
	});

	it('matches an invocation but not the function declaration', () => {
		expect(CALL_RE.test('const out = applyPasteTransforms(text);')).toBe(true);
		expect(CALL_RE.test('parse(applyPasteTransforms(pasted))')).toBe(true);
		expect(CALL_RE.test('export function applyPasteTransforms(text: string): string {')).toBe(
			false
		);
	});

	it('ignores a bare import of the symbol (no call)', () => {
		expect(CALL_RE.test("import { applyPasteTransforms } from './paste-transforms';")).toBe(false);
	});
});
