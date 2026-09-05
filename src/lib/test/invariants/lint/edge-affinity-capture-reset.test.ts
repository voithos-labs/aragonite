/**
 * G4.31 — the affinity reaches every sticky seam, and the pending marks every affinity seam.
 * All three are ephemeral caret state with one lifetime: an arrival sets them, a commit
 * invalidates them. The column paid for that parity at N−1 of N sites (G2.10), so the affinity
 * inherits it as a scan — a `stickyColumn.reset()` beside no affinity clear leaks a side the
 * typing seat then spends on the wrong byte. The MARKS ride one rung higher: one construction
 * composes them onto the affinity's invalidation, so the third axis pins that composition and
 * fails on the first clear written at a seam of their own.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

const STICKY_RESET_RE = /\bstickyColumn\.reset\s*\(/g;
const STICKY_NOTE_KEY_RE = /\bstickyColumn\.noteKey\s*\(/g;
// `noteTyping` is the commit-side clear: it overwrites the arrival with the typed side, which
// is the same invalidation the column's reset performs, so it counts as the pair.
// `noteExtreme` counts on BOTH axes and is spelled out on both: it classifies an arrival (a
// collapse seating at the range's own edge) and settles it, which invalidates the marks riding
// the affinity. A `note` pattern ending in `\(` matches neither of the longer doors.
const AFFINITY_CLEAR_RE = /\bedgeAffinity\.(reset|noteTyping|noteExtreme)\s*\(/g;
const AFFINITY_NOTE_RE = /\bedgeAffinity\.(note|noteExtreme)\s*\(/g;
const MARKS_CLEAR_CALL_RE = /\bpendingMarks\.reset\s*\(/g;
const MARKS_COMPOSITION_RE = /onInvalidate:\s*pendingMarks\.reset\b/g;
const MARKS_SPEND_RE = /\bpendingMarks\.consume\s*\(/g;

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

	// ── Third axis: the marks ride the affinity, they do not copy it ──────────

	it('exactly one site composes the marks onto the affinity’s invalidation', () => {
		const composers = sources
			.filter((f) => count(f.code, MARKS_COMPOSITION_RE) > 0)
			.map((f) => f.relPath);
		expect(
			composers,
			'the marks clear at every affinity seam because ONE construction composes them there — ' +
				'a second composer means two lifetimes, none means the marks survive a caret move'
		).toEqual(['src/lib/components/Editor.svelte']);
	});

	it('no module clears the marks at a seam of its own', () => {
		const offenders = sources
			.filter((f) => count(f.code, MARKS_CLEAR_CALL_RE) > 0)
			.map((f) => `${f.relPath}: ${count(f.code, MARKS_CLEAR_CALL_RE)} pendingMarks.reset()`);
		expect(
			offenders,
			'a pendingMarks.reset() call site is seam copy N+1 — the composition above already ' +
				'clears at every affinity seam, so a hand-written clear can only fall out of parity'
		).toEqual([]);
	});

	it('the marks are spent at the seats that write bytes, and nowhere else', () => {
		const spenders = sources
			.filter((f) => count(f.code, MARKS_SPEND_RE) > 0)
			.map((f) => f.relPath)
			.sort();
		expect(
			spenders,
			'a set spent outside a byte-writing seat is a promise dropped with nothing written'
		).toEqual([
			'src/lib/components/blocks/table/TableCellBlock.svelte',
			'src/lib/components/blocks/text/TextEditableBlock.svelte',
			'src/lib/components/blocks/text/edge-policy-dispatch.ts'
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

	// The third door had to be spelled out in both patterns; a `note\(`-anchored one reads it as
	// neither a capture nor a clear, and a file paired only by it scanned as unpaired on both axes.
	it('the third capture door counts on both axes', () => {
		expect(count('ctx.edgeAffinity.noteExtreme();', AFFINITY_NOTE_RE)).toBe(1);
		expect(count('ctx.edgeAffinity.noteExtreme();', AFFINITY_CLEAR_RE)).toBe(1);
	});

	it('a door paired only by noteExtreme is not an offence on either axis', () => {
		const collapse: SourceFile = {
			relPath: 'src/lib/rogue-collapse.ts',
			text: '',
			code: 'stickyColumn.noteKey(e); stickyColumn.reset(); edgeAffinity.noteExtreme();'
		};
		expect(unpaired([collapse], STICKY_NOTE_KEY_RE, AFFINITY_NOTE_RE)).toEqual([]);
		expect(unpaired([collapse], STICKY_RESET_RE, AFFINITY_CLEAR_RE)).toEqual([]);
	});

	// The composition passes the reset as a VALUE; only a call is the copy-N+1 shape.
	it('the marks matchers tell the composition from a hand-written clear', () => {
		const composed = 'createEdgeAffinityState({ onInvalidate: pendingMarks.reset });';
		expect(count(composed, MARKS_COMPOSITION_RE)).toBe(1);
		expect(count(composed, MARKS_CLEAR_CALL_RE)).toBe(0);
		expect(count('pendingMarks.reset();', MARKS_CLEAR_CALL_RE)).toBe(1);
		expect(count('deps.pendingMarks.consume();', MARKS_SPEND_RE)).toBe(1);
		expect(count('pendingMarks.toggle(format);', MARKS_SPEND_RE)).toBe(0);
	});
});
