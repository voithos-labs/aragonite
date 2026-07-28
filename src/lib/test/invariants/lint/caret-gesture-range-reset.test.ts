/**
 * G2.12 — every pointer gesture that places a caret must end a live cross-block range.
 *
 * The rule cannot be seated in a funnel. `BlockComponent.focus(offset)` looks like
 * the choke point every caret placement crosses, and it is not one: the cross-block
 * dispatcher parks its own dispatch caret through the same verb while an extend is
 * still growing the range (`revealActiveEndpoint`). Seating a `selection.clear()`
 * there was tried and reverted — it reds `extend-offwindow-endpoint`,
 * `keyboard/vertical-skip` and `cross-block-delete-container-survivor-caret`. No
 * position test separates the two uses either: the consumer-door reproduction parked
 * a caret at a path INSIDE the live range. One verb, two meanings, and the meaning is
 * the caller's intent.
 *
 * So the rule is carried, and this is the rung culture.md prescribes when the funnel
 * can't be built: the entry set is the subject, and a gesture joining it either
 * routes through `resetForPointerDown` or says here why it places no caret. Both
 * instances of the miss this guard exists for cost a whole-document delete — the
 * dead-space click (entry path N+1, caught in review) and the render-primary reveal
 * click (found by writing this list out).
 *
 * Door granularity is per FILE, so a file holding two press handlers declares both
 * doors: `editable-leaf.ts` is exactly that case, and a file-level "either door"
 * check would have passed it on the sibling handler's delegate call while the
 * rendered view's reveal reset nothing.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** The preamble itself. */
const RESET_RE = /\bresetForPointerDown\s*\(/;
/** The delegating door: a surface handing its press to the cross-block dispatcher,
 *  whose own preamble is the reset. */
const DELEGATE_RE = /\bcrossBlock\.handlePointerDown\s*\(/;
/** A press handler of any spelling — Svelte attribute, handler-bundle key, or
 *  listener registration. The bundle-key form (`onpointerdown:`) is how a leaf hands
 *  its surface to a plugin component, and omitting it hid `editable-leaf.ts` — the
 *  file that held the second instance of this bug. */
const POINTER_HANDLER_RE = /\bon(pointerdown|mousedown)\s*[=:]|['"](pointerdown|mousedown)['"]/;

type Door = 'reset' | 'delegate' | 'both';

/**
 * `cross-block/pointer.ts` DEFINES the preamble and binds no handler of its own, so
 * it is named as the seam and excluded from the press sweep below.
 */
const PREAMBLE_MODULE = 'src/lib/selection/cross-block/pointer.ts';

/** Gestures that place a caret, and the door(s) each one owes. */
const CARET_GESTURE_DOORS: Record<string, Door> = {
	[PREAMBLE_MODULE]: 'reset',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'reset',
	'src/lib/components/blocks/text/TextEditableBlock.svelte': 'delegate',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'delegate',
	// Two gestures, two doors: the source surface delegates, and the rendered view
	// calls the preamble itself, because the dispatcher hit-tests the pointer against
	// SOURCE text the rendered view does not have.
	'src/lib/components/blocks/editable-leaf.ts': 'both',
	// The dead-space click — the root's own padding and the area below the last block.
	'src/lib/components/Editor.svelte': 'reset'
};

/**
 * Press handlers that place no caret, and what each one does instead. A new
 * pointer-handling file joins this map or the one above; there is no third answer,
 * and that is the whole point of the guard.
 */
const NON_CARET_PRESS_FILES: Record<string, string> = {
	'src/lib/components/blocks/table/TableActionMenu.svelte':
		'document-capture dismiss-on-outside-press for the menu',
	'src/lib/components/blocks/table/TableBlock.svelte':
		'column-grip forwarder; the grip selects cells, not a caret',
	'src/lib/components/blocks/table/TableRowBlock.svelte':
		'row-grip forwarder; same as the column grip',
	'src/lib/components/blocks/table/TableGrip.svelte':
		'selects a row/column rectangle — a selection gesture, not a caret one',
	'src/lib/components/image/ImageOverlayHost.svelte':
		'widget selection + overlay placement; the caret stays where it was',
	'src/lib/components/image/ImageProperties.svelte':
		'document-capture dismiss-on-outside-press for the properties popover',
	'src/lib/components/image/ImageResizeHandles.svelte': 'starts a resize drag',
	'src/lib/editor-actions/reorder-drag.ts': 'starts a block reorder drag off the handle',
	'src/lib/plugins/details/DetailsBlock.svelte':
		'preventDefault on the summary so the disclosure toggle takes no focus',
	'src/lib/plugins/latex/BlockMath.svelte':
		'binds the shared editable-leaf reveal handler; the reset lives there',
	'src/lib/plugins/toc/TocBlock.svelte':
		'binds the shared editable-leaf reveal handler, plus entry navigation',
	'src/lib/plugins/mermaid/MermaidBlock.svelte':
		'stopPropagation on its toolbar and a diagram-surface press that selects the block',
	'src/routes/test/plugins/+page.svelte':
		'harness chrome — preventDefault on a mode toggle so the press takes no focus'
};

function missingDoors(code: string, door: Door): string[] {
	const missing: string[] = [];
	if (door !== 'delegate' && !RESET_RE.test(code)) missing.push('resetForPointerDown');
	if (door !== 'reset' && !DELEGATE_RE.test(code)) missing.push('crossBlock.handlePointerDown');
	return missing;
}

describe('G2.12 caret-placing gesture ends a live cross-block range', () => {
	const sources = collectEditorSources();
	const byPath = new Map(sources.map((f) => [f.relPath, f]));

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every caret-placing gesture reaches every door it declares', () => {
		const offenders: string[] = [];
		for (const [relPath, door] of Object.entries(CARET_GESTURE_DOORS)) {
			const file = byPath.get(relPath);
			expect(file, `caret-gesture file not found: ${relPath}`).toBeDefined();
			const missing = missingDoors(file!.code, door);
			if (missing.length > 0) offenders.push(`${relPath}: missing ${missing.join(' + ')}`);
		}
		expect(offenders).toEqual([]);
	});

	it('no file calls the preamble without being declared a caret gesture', () => {
		const undeclared = sources
			.filter((f) => RESET_RE.test(f.code))
			.map((f) => f.relPath)
			.filter((relPath) => !(relPath in CARET_GESTURE_DOORS))
			.sort();
		expect(
			undeclared,
			'a file ends the range without being declared a caret-placing gesture'
		).toEqual([]);
	});

	it('every press handler in the tree is accounted for on one list or the other', () => {
		const pressFiles = sources
			.filter((f) => POINTER_HANDLER_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		const accounted = [
			...Object.keys(CARET_GESTURE_DOORS).filter((p) => p !== PREAMBLE_MODULE),
			...Object.keys(NON_CARET_PRESS_FILES)
		].sort();
		expect(
			pressFiles,
			'a file grew a pointerdown/mousedown handler: add it to CARET_GESTURE_DOORS if it places ' +
				'a caret (and route it through resetForPointerDown), or to NON_CARET_PRESS_FILES saying ' +
				'what it does instead'
		).toEqual(accounted);
	});

	it('every non-caret press file still handles a press (no dead entry)', () => {
		for (const [relPath, role] of Object.entries(NON_CARET_PRESS_FILES)) {
			const file = byPath.get(relPath);
			expect(file, `non-caret press file not found: ${relPath} (${role})`).toBeDefined();
			expect(POINTER_HANDLER_RE.test(file!.code), `stale entry: ${relPath}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the press matcher reads every spelling and ignores unrelated pointer verbs', () => {
		expect(POINTER_HANDLER_RE.test('onpointerdown={handle}')).toBe(true);
		expect(POINTER_HANDLER_RE.test('onpointerdown: onPointerDown,')).toBe(true);
		expect(POINTER_HANDLER_RE.test("root.addEventListener('mousedown', h)")).toBe(true);
		expect(POINTER_HANDLER_RE.test("root.addEventListener('pointermove', h)")).toBe(false);
		expect(POINTER_HANDLER_RE.test('onpointerup={handle}')).toBe(false);
	});

	// The `both` requirement is the arm that discriminates the render-primary bug: a
	// file-level "either door" check reads the sibling handler's delegate call and
	// passes a rendered view that resets nothing.
	it('a two-gesture file with only the delegate door is reported', () => {
		expect(missingDoors('if (crossBlock.handlePointerDown(e)) return;', 'both')).toEqual([
			'resetForPointerDown'
		]);
		expect(
			missingDoors('resetForPointerDown(selection, stickyColumn, e.shiftKey)', 'both')
		).toEqual(['crossBlock.handlePointerDown']);
		expect(
			missingDoors(
				'if (crossBlock.handlePointerDown(e)) return; resetForPointerDown(a, b, c);',
				'both'
			)
		).toEqual([]);
	});
});
