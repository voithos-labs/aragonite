/**
 * G4.12 — caret-edge destructive-key seam parity. Three sibling seams intercept a
 * plain (no ctrl/meta/alt) Backspace/Delete at a caret edge in a prose block and
 * route the edit through `blockEdit.updateBlockContent`, never native
 * contenteditable mutation: the CST inline-widget handler, the decoration-island
 * handler, and TextEditableBlock's ambient-marker selection branch. Each guards a
 * different atomic thing native deletion would silently corrupt (a widget's raw
 * span, an island's hidden bytes, a range overlapping the non-editable ambient
 * marker).
 *
 * Consolidating the three into one declarative edge policy is deliberately
 * deferred (presentation modes). Until then this pins the set: a NEW file under
 * `components/blocks/text/` that intercepts a plain destructive key with
 * `preventDefault` is the exact shape that must route through the CST — the guard
 * fails the day it appears unallowlisted, forcing the author to route through an
 * existing seam or join the allowlist. The scan is scoped to this directory
 * because Backspace/Delete key handling is common elsewhere and would drown the
 * signal.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources } from './scan-source';

const TEXT_BLOCK_SRC = path.resolve('src/lib/components/blocks/text');

// The intercept shape: a Backspace/Delete key literal AND a preventDefault. The
// CST-routing requirement is checked separately so an unallowlisted native-mutating
// interceptor (the bug) is still caught even though it omits updateBlockContent.
const DESTRUCTIVE_KEY_RE = /(['"])(?:Backspace|Delete)\1/;
const PREVENT_DEFAULT_RE = /\.preventDefault\s*\(/;
const UPDATE_CONTENT_RE = /\bupdateBlockContent\s*\(/;

function hasDestructiveGate(code: string): boolean {
	return DESTRUCTIVE_KEY_RE.test(code) && PREVENT_DEFAULT_RE.test(code);
}

function routesThroughCst(code: string): boolean {
	return UPDATE_CONTENT_RE.test(code);
}

/** Each sanctioned caret-edge seam → the atomic thing its destructive-key branch protects. */
const SEAMS: Record<string, string> = {
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'ambient-marker branch: deletes a range overlapping the non-editable ambient span',
	'src/lib/components/blocks/text/decoration-island-keys.ts':
		'decoration islands: deletes a replace-island hidden range / zero-width widget-island edge',
	'src/lib/components/blocks/text/widget-interaction.ts':
		'CST inline widgets: deletes a selected widget raw span'
};

describe('G4.12 caret-edge destructive-key seam parity', () => {
	const sources = collectEditorSources(TEXT_BLOCK_SRC);
	const byPath = new Map(sources.map((f) => [f.relPath, f]));

	it('inspected the text-block source files', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('exactly the three sanctioned seams intercept a plain destructive key', () => {
		const interceptors = sources
			.filter((f) => hasDestructiveGate(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(
			interceptors,
			`plain Backspace/Delete preventDefault handlers under blocks/text/ must be a sanctioned seam: route the edit through updateBlockContent via an existing seam, or add the file to this allowlist. Unexpected set: ${interceptors.join(
				', '
			)}`
		).toEqual(Object.keys(SEAMS).sort());
	});

	it('each seam still holds the gate and routes through updateBlockContent', () => {
		for (const seam of Object.keys(SEAMS)) {
			const file = byPath.get(seam);
			expect(file, `seam not found: ${seam}`).toBeDefined();
			expect(hasDestructiveGate(file!.code), `destructive gate gone from ${seam}`).toBe(true);
			expect(
				routesThroughCst(file!.code),
				`${seam} no longer routes through updateBlockContent`
			).toBe(true);
		}
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
