/**
 * G4.31 — the affinity reaches every seam the sticky column does. Both are ephemeral caret
 * state with the same lifetime: an arrival sets them, a commit invalidates them. The sticky
 * column paid for that rule at N−1 of N sites (G2.10), so the affinity inherits it as a scan
 * rather than at the next audit — a new `stickyColumn.reset()` beside no affinity clear leaks
 * a side across an edit, which the typing seat then spends on the wrong byte.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

const STICKY_RESET_RE = /\bstickyColumn\.reset\s*\(/g;
const STICKY_NOTE_KEY_RE = /\bstickyColumn\.noteKey\s*\(/g;
// `noteTyping` is the commit-side clear: it overwrites the arrival with the typed side, which
// is the same invalidation the column's reset performs, so it counts as the pair.
const AFFINITY_CLEAR_RE = /\bedgeAffinity\.(reset|noteTyping)\s*\(/g;
const AFFINITY_NOTE_RE = /\bedgeAffinity\.note\s*\(/g;

/**
 * Files where the affinity legitimately runs BEHIND the column, each saying why. Empty by
 * design: an entry is a stated hole, and the reason has to survive review.
 */
const CLEAR_EXCEPTIONS: Record<string, string> = {};

/**
 * Capture doors that classify for the column but not for the affinity, each saying why.
 * Empty by design — every whole-block and dispatcher door pairs today.
 */
const CAPTURE_EXCEPTIONS: Record<string, string> = {};

function count(code: string, re: RegExp): number {
	return code.match(new RegExp(re.source, 'g'))?.length ?? 0;
}

/** Files whose affinity calls do not cover their sticky calls: `site: sticky/affinity`. */
function unpaired(sources: SourceFile[], sticky: RegExp, affinity: RegExp): string[] {
	return sources
		.map((f) => ({
			relPath: f.relPath,
			sticky: count(f.code, sticky),
			affinity: count(f.code, affinity)
		}))
		.filter(({ sticky, affinity }) => sticky > affinity)
		.map(({ relPath, sticky, affinity }) => `${relPath}: ${sticky} sticky / ${affinity} affinity`);
}

describe('G4.31 affinity-reaches-every-sticky-seam guard', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every sticky reset site is matched by an affinity clear in the same file', () => {
		const offenders = unpaired(sources, STICKY_RESET_RE, AFFINITY_CLEAR_RE).filter(
			(line) => !(line.split(':')[0] in CLEAR_EXCEPTIONS)
		);
		expect(
			offenders,
			'a stickyColumn.reset() with no edgeAffinity.reset()/noteTyping() beside it leaks the ' +
				'arrival side across the edit — pair it, or add the file to CLEAR_EXCEPTIONS with why'
		).toEqual([]);
	});

	it('every sticky capture door also classifies the arrival side', () => {
		const offenders = unpaired(sources, STICKY_NOTE_KEY_RE, AFFINITY_NOTE_RE).filter(
			(line) => !(line.split(':')[0] in CAPTURE_EXCEPTIONS)
		);
		expect(
			offenders,
			'a stickyColumn.noteKey() door with no edgeAffinity.note() lets a stale side survive ' +
				'the arrival it classified — pair it, or add the file to CAPTURE_EXCEPTIONS with why'
		).toEqual([]);
	});

	it('the doors the scan finds are the ones the map names', () => {
		const captureDoors = sources
			.filter((f) => count(f.code, STICKY_NOTE_KEY_RE) > 0)
			.map((f) => f.relPath)
			.sort();
		expect(captureDoors).toEqual([
			'src/lib/editor-actions/container-block-component.ts',
			'src/lib/editor-actions/plugin/container.ts',
			'src/lib/selection/cross-block/keydown.ts',
			'src/lib/selection/shared-keydown.ts'
		]);
	});

	it('every exception entry names a file that still exists (no dead entry)', () => {
		const known = new Set(sources.map((f) => f.relPath));
		for (const relPath of [...Object.keys(CLEAR_EXCEPTIONS), ...Object.keys(CAPTURE_EXCEPTIONS)]) {
			expect(known.has(relPath), `exception file not found: ${relPath}`).toBe(true);
		}
	});

	// ── Mutation tests: a rogue seam breaks the pairing ────────────────────────

	it('a new sticky reset with no affinity clear is caught', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/rogue-commit.ts',
			text: '',
			code: 'function commit() { stickyColumn.reset(); }'
		};
		expect(unpaired([rogue], STICKY_RESET_RE, AFFINITY_CLEAR_RE)).toEqual([
			'src/lib/rogue-commit.ts: 1 sticky / 0 affinity'
		]);
	});

	it('a second sticky reset beside one affinity clear is caught', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/rogue-pair.ts',
			text: '',
			code: 'stickyColumn.reset(); edgeAffinity.reset(); stickyColumn.reset();'
		};
		expect(unpaired([rogue], STICKY_RESET_RE, AFFINITY_CLEAR_RE)).toEqual([
			'src/lib/rogue-pair.ts: 2 sticky / 1 affinity'
		]);
	});

	it('a new capture door with no affinity classification is caught', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/rogue-keydown.ts',
			text: '',
			code: 'ctx.stickyColumn.noteKey(e);'
		};
		expect(unpaired([rogue], STICKY_NOTE_KEY_RE, AFFINITY_NOTE_RE)).toEqual([
			'src/lib/rogue-keydown.ts: 1 sticky / 0 affinity'
		]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('an affinity-only clear is not an offence — a mode flip invalidates the side alone', () => {
		const modeFlip: SourceFile = {
			relPath: 'src/lib/mode-flip.ts',
			text: '',
			code: 'edgeAffinity.reset();'
		};
		expect(unpaired([modeFlip], STICKY_RESET_RE, AFFINITY_CLEAR_RE)).toEqual([]);
	});

	it('the clear matcher reads both handles and skips unrelated calls', () => {
		expect(count('deps.edgeAffinity.noteTyping();', AFFINITY_CLEAR_RE)).toBe(1);
		expect(count('edgeAffinity.reset();', AFFINITY_CLEAR_RE)).toBe(1);
		expect(count('edgeAffinity.note(e);', AFFINITY_CLEAR_RE)).toBe(0);
		expect(count('stickyColumn.capture(x);', STICKY_RESET_RE)).toBe(0);
	});
});
