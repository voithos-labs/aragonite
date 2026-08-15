/**
 * G4.47 — the whole-block editing host looks exactly like a plugin's own editable and paints
 * nothing, so every reader of "is this a REAL editable surface" owes it an answer: route through
 * the predicate that knows the host, or declare your own below. Two of the three known spellings
 * are scanned; the third, dispatch-target identity (`editor-root-clipboard :: landedNowhere`), is
 * probed-benign and not enumerable.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

/** The seam that answers the question, plus the attribute a selector-level reader excludes by. */
const HOST_AWARE_RE =
	/(?<![\w'"])(isEditableEventTarget|isWholeBlockInputProxy|holdsWholeBlockFocus|WHOLE_BLOCK_INPUT_ATTR)\b/;

/**
 * A `[contenteditable…]` selector handed to a DOM lookup. Prettier wraps the call across lines and
 * `closest<HTMLElement>` carries a type argument — the two shapes that escaped the hand grep.
 */
const SELECTOR_READ_RE =
	/\.(?:querySelector(?:All)?|closest|matches)\s*(?:<[^<>()]*>)?\s*\(\s*[`'"][^`'"]*\[contenteditable/;

/** `document.activeElement` compared by identity, which the host taking focus silently falsifies. */
const ACTIVE_IDENTITY_RE = /document\.activeElement\s*[!=]==|[!=]==\s*document\.activeElement/;

/** Selector readers whose answer for the host is stated rather than routed. */
const SELECTOR_READERS: Record<string, string> = {
	'src/lib/active-editor.ts': 'the host IS a text-entry surface: a focus move must yield to it',
	'src/lib/invariants/landable-caret.ts':
		'G1.33 resolves the host as the focused editable and stands down on its emptiness',
	'src/lib/selection/caret-restore.ts':
		'a caret saved at whole-block focus restores TO the host, the wanted target',
	'src/lib/selection/cross-block/pointer.ts':
		'a shift-click anchored on a whole-block kind resolves to the host, so the funnel takes the unit whole',
	'src/lib/selection/dead-space-caret.ts':
		'reads hit.charSurface, which the hit-test already withdrew the host from'
};

/** Identity readers that compare a surface the host can never be. */
const ACTIVE_IDENTITY_READERS: Record<string, string> = {
	'src/lib/ambient/ambient-cursor.ts':
		'the prose surface this cursor was constructed over; a whole-block kind has none',
	'src/lib/components/blocks/editable-surface.ts':
		'the pending-restore guard, reachable only from an editable leaf surface',
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'its own cell surface; the host never holds a cell caret',
	'src/lib/cursor/content-offsets.ts':
		'the caller supplies a block text surface, never the chrome host',
	'src/lib/cursor/reveal-source.ts':
		'the reveal target is a text surface; the host paints no source',
	'src/lib/selection/native-bridge.ts':
		'blockEl is an editable leaf surface — neither door is reachable from whole-block focus'
};

const matching = (sources: SourceFile[], re: RegExp): SourceFile[] =>
	sources.filter((file) => re.test(file.code));

describe('whole-block editing host — reader census', () => {
	const sources = collectEditorSources();

	function auditArm(re: RegExp, allowed: Record<string, string>): void {
		const readers = matching(sources, re);
		expect(readers.length, 'the spelling matched nothing — the scan went vacuous').toBeGreaterThan(
			0
		);
		const undeclared = readers
			.filter((file) => !HOST_AWARE_RE.test(file.code) && !(file.relPath in allowed))
			.map((file) => file.relPath);
		expect(
			undeclared.sort(),
			'route through isEditableEventTarget/isWholeBlockInputProxy, or declare what this reader answers for the whole-block host'
		).toEqual([]);
	}

	function auditNoDeadEntries(re: RegExp, allowed: Record<string, string>): void {
		for (const relPath of Object.keys(allowed)) {
			const file = sources.find((source) => source.relPath === relPath);
			expect(file, `${relPath} is allowlisted but no longer exists`).toBeDefined();
			expect(re.test(file!.code), `${relPath} no longer asks the question`).toBe(true);
			expect(HOST_AWARE_RE.test(file!.code), `${relPath} routes now — drop its entry`).toBe(false);
		}
	}

	it('every [contenteditable] selector read answers for the host', () => {
		auditArm(SELECTOR_READ_RE, SELECTOR_READERS);
	});

	it('every activeElement identity read answers for the host', () => {
		auditArm(ACTIVE_IDENTITY_RE, ACTIVE_IDENTITY_READERS);
	});

	it('no allowlist entry is dead', () => {
		auditNoDeadEntries(SELECTOR_READ_RE, SELECTOR_READERS);
		auditNoDeadEntries(ACTIVE_IDENTITY_RE, ACTIVE_IDENTITY_READERS);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the selector matcher sees the two shapes that escaped the hand grep', () => {
		const probe = (code: string) => SELECTOR_READ_RE.test(code);
		// Prettier-wrapped call with a template-literal selector, and a generic type argument.
		expect(probe('wrapper.querySelector(\n\t`[contenteditable]:not([${ATTR}])`\n)')).toBe(true);
		expect(probe("host.closest<HTMLElement>('[contenteditable]')")).toBe(true);
		expect(probe('el.matches(\'[contenteditable]:not([contenteditable="false"])\')')).toBe(true);
	});

	it('the selector matcher skips attribute writes and prose', () => {
		expect(SELECTOR_READ_RE.test("el.setAttribute('contenteditable', 'false')")).toBe(false);
		expect(SELECTOR_READ_RE.test("wrapper.querySelector('[data-block-path]')")).toBe(false);
	});

	it('the identity matcher sees both operand orders and skips containment', () => {
		expect(ACTIVE_IDENTITY_RE.test('document.activeElement === focusSurfaceEl()')).toBe(true);
		expect(ACTIVE_IDENTITY_RE.test('if (document.activeElement !== container) return null;')).toBe(
			true
		);
		expect(ACTIVE_IDENTITY_RE.test('const applied = el === document.activeElement;')).toBe(true);
		// The answer shape: a whole-block kind holds focus THROUGH the host, so containment is
		// how a correct reader asks, and flagging it would invert the census.
		expect(ACTIVE_IDENTITY_RE.test('!!boxEl?.contains(document.activeElement)')).toBe(false);
	});

	it('a new undeclared reader fails the arm', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/selection/rogue.ts',
			text: '',
			code: 'if (document.activeElement === surfaceEl) return null;'
		};
		const undeclared = [...sources, rogue]
			.filter((file) => ACTIVE_IDENTITY_RE.test(file.code))
			.filter(
				(file) => !HOST_AWARE_RE.test(file.code) && !(file.relPath in ACTIVE_IDENTITY_READERS)
			);
		expect(undeclared.map((file) => file.relPath)).toEqual(['src/lib/selection/rogue.ts']);
	});
});
