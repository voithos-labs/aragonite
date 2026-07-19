/**
 * G4.11 — paste-transform two-site parity. Per the `paste-transforms.ts` header,
 * every site where clipboard text reaches `parse()` must run
 * `applyPasteTransforms` first, or a plugin's registered transform is silently
 * skipped for that route. Exactly two sanctioned sites route clipboard text to
 * the parser: the tree-op paste dispatch and the cross-block selection paste.
 *
 * This is a sibling-path parity guard for a funnel that can't exist yet — the two
 * paste routes are structurally different (one is a tree-op input, one a
 * selection handler), so there's no shared seam to force the call through. A
 * third clipboard→parse route born without the pipeline would drop every plugin
 * transform undetected until an author noticed. The set-equality check fails the
 * day a caller is added or removed: a new site must either route through one of
 * the two sanctioned sites, or join the allowlist WITH its own
 * `applyPasteTransforms` call.
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

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

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
