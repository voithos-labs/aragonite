/**
 * G4.12 — caret-edge destructive-key funnel: every plain Backspace/Delete intercepted at
 * a caret edge in a prose block routes through `edge-policy-dispatch.ts` and commits via
 * `blockEdit.updateBlockContent`, never native mutation. The allowlist adds
 * `widget-interaction.ts`, a selected-STATE seam that must run before the shared keymap.
 * Scope is `components/blocks/text/`, since destructive-key handling elsewhere would
 * drown the signal.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources, type SourceFile } from './scan-source';

const TEXT_BLOCK_SRC = path.resolve('src/lib/components/blocks/text');

// The CST-routing requirement is checked separately, so an unallowlisted
// native-mutating interceptor is still caught despite omitting updateBlockContent.
const DESTRUCTIVE_KEY_RE = /(['"])(?:Backspace|Delete)\1/;
const PREVENT_DEFAULT_RE = /\.preventDefault\s*\(/;
const UPDATE_CONTENT_RE = /\bupdateBlockContent\s*\(/;

function hasDestructiveGate(code: string): boolean {
	return DESTRUCTIVE_KEY_RE.test(code) && PREVENT_DEFAULT_RE.test(code);
}

function routesThroughCst(code: string): boolean {
	return UPDATE_CONTENT_RE.test(code);
}

function interceptorsOf(sources: SourceFile[]): string[] {
	return sources
		.filter((f) => hasDestructiveGate(f.code))
		.map((f) => f.relPath)
		.sort();
}

/** The funnel: the one dispatch, plus the selected-state carve-out → why each is sanctioned. */
const FUNNEL: Record<string, string> = {
	'src/lib/components/blocks/text/edge-policy-dispatch.ts':
		'the one caret-edge dispatch — CST widget / decoration island / ambient overlap, each routed to updateBlockContent',
	'src/lib/components/blocks/text/widget-interaction.ts':
		'the selected-widget second-press delete — a selected-STATE seam ordered before the shared keymap, distinct from the caret-edge classes'
};

describe('G4.12 caret-edge destructive-key funnel', () => {
	const sources = collectEditorSources(TEXT_BLOCK_SRC);
	const byPath = new Map(sources.map((f) => [f.relPath, f]));

	it('inspected the text-block source files', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('exactly the funnel files intercept a plain destructive key', () => {
		expect(
			interceptorsOf(sources),
			`plain Backspace/Delete preventDefault handlers under blocks/text/ must route through the ` +
				`edge-policy dispatch (or be the sanctioned selected-widget seam). Unexpected set: ${interceptorsOf(
					sources
				).join(', ')}`
		).toEqual(Object.keys(FUNNEL).sort());
	});

	it('each funnel file still holds the gate and routes through updateBlockContent', () => {
		for (const seam of Object.keys(FUNNEL)) {
			const file = byPath.get(seam);
			expect(file, `funnel file not found: ${seam}`).toBeDefined();
			expect(hasDestructiveGate(file!.code), `destructive gate gone from ${seam}`).toBe(true);
			expect(
				routesThroughCst(file!.code),
				`${seam} no longer routes through updateBlockContent`
			).toBe(true);
		}
	});

	// ── Mutation test: a rogue interceptor breaks the funnel ──────────────────

	it('a new unallowlisted destructive interceptor under blocks/text is caught', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/components/blocks/text/rogue-keys.ts',
			text: '',
			code: "if (e.key === 'Backspace') { e.preventDefault(); range.deleteContents(); }"
		};
		expect(hasDestructiveGate(rogue.code)).toBe(true);
		// The rogue joins the interceptor set, so the equality the real gate asserts fails.
		expect(interceptorsOf([...sources, rogue])).not.toEqual(Object.keys(FUNNEL).sort());
	});

	// ── Matcher self-tests (synthetic positive + benign negatives) ────────────

	it('the gate matches a plain destructive handler, not a preventDefault-only file', () => {
		expect(hasDestructiveGate("if (e.key === 'Backspace') { e.preventDefault(); }")).toBe(true);
		expect(hasDestructiveGate("if (e.key === 'Delete') e.preventDefault();")).toBe(true);
		// preventDefault with no destructive key (the text-clipboard shape) is not a seam.
		expect(hasDestructiveGate("if (e.key === 'ArrowLeft') e.preventDefault();")).toBe(false);
		// A destructive key with no preventDefault (native path) is not the gate.
		expect(hasDestructiveGate("const label = e.key === 'Backspace' ? 'del' : 'x';")).toBe(false);
	});

	it('routesThroughCst distinguishes a CST edit from a native one', () => {
		expect(routesThroughCst('deps.blockEdit.updateBlockContent(index, raw, a, b);')).toBe(true);
		expect(routesThroughCst('range.deleteContents();')).toBe(false);
	});
});
