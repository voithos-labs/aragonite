/**
 * G2.12 — a caret placement ends a live cross-block range, unless it is an extend.
 *
 * Half the rule is now a funnel. `BlockComponent.focus` ends the range itself, minted
 * from `selection/caret-doors.ts`' `placeCaret` over each surface's park primitive, so
 * a programmatic caret landing is safe by construction and its callers declare nothing.
 * What is left un-funnelable is what the guards below carry.
 *
 * 1. NATIVE caret placement. A plain click inside a paragraph moves the caret through
 *    the browser's own default — no `focus` call for a funnel to sit in — so the range
 *    must be ended by the pointerdown preamble. Both instances of the miss this arm
 *    exists for cost a whole-document delete: the dead-space click (entry path N+1,
 *    caught in review) and the render-primary reveal click (found by writing the list
 *    out). Door granularity is per FILE, so a file holding two press handlers declares
 *    both: `editable-leaf.ts` is exactly that case, and a file-level "either door"
 *    check would have passed it on the sibling handler's delegate call while the
 *    rendered view's reveal reset nothing.
 *
 * 2. The park door's callers. `parkCaret` is `focus` WITHOUT the range-ending — the one
 *    thing an extend needs and nothing else may have. It is an allowlist because the
 *    legitimacy of a park is the caller's intent, and no position test separates the
 *    two uses: the consumer-door reproduction parked a caret at a path INSIDE the live
 *    range.
 *
 * 3. The park door's presence. `parkCaret` is optional on `BlockComponent`, so a block
 *    that forwards a shared seam's `focus` and forgets its `parkCaret` type-checks
 *    clean and silently degrades every extend that lands on it. Four blocks did exactly
 *    that on the first pass of the split. Scope: FORWARDS only. A hand-rolled
 *    `export function focus(offset)` — CodeBlock, ThematicBreak, the two table
 *    surfaces — is outside the matcher, and deliberately so: there is no seam to pair
 *    against, and the worst outcome for a hand-roll that omits the door is the benign
 *    one the contract already documents (a missed park, not a lost caret), because the
 *    container walk lands `focus` through the child's `focus`.
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
/** A call THROUGH the park door, optional-call spelling included. A bare forward
 *  (`export const parkCaret = leaf.parkCaret;`) has no call and is not a caller. */
const PARK_CALL_RE = /\.parkCaret\s*\??\.?\s*\(/;
/** A block forwarding a shared caret seam's public verb, capturing the seam. The
 *  `export` is load-bearing: an unexported `const focus = selection.focus` is a read
 *  of the selection's focus ENDPOINT, a different `focus` entirely. */
const FOCUS_FORWARD_RE = /\bexport const focus = ((?:\w+\.)*\w+)\.focus\s*;/g;

type Door = 'reset' | 'delegate' | 'both';

/**
 * `cross-block/pointer.ts` DEFINES the preamble and binds no handler of its own, so
 * it is named as the seam and excluded from the press sweep below.
 */
const PREAMBLE_MODULE = 'src/lib/selection/cross-block/pointer.ts';

/** Gestures whose caret the BROWSER places, and the door(s) each one owes. */
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

/**
 * The only callers allowed through the park door, and why each one is not a
 * range-ending placement. A new entry is a claim that the caller runs WHILE an extend
 * is growing a range; anything else wants `focus`.
 */
const PARK_DOOR_CALLERS: Record<string, string> = {
	'src/lib/selection/cross-block/keydown.ts':
		'revealActiveEndpoint — parks the dispatch caret in a just-revealed endpoint while the extend still owns the range',
	'src/lib/editor-actions/container-block-component.ts':
		"implementation: the container walk lands through its child's park door",
	'src/lib/components/blocks/editable-leaf.ts':
		"implementation: the leaf's park door over the shared surface",
	'src/lib/components/blocks/code/CodeBlock.svelte':
		'implementation: clamps the parked offset onto fence body before delegating',
	'src/lib/components/blocks/table/TableBlock.svelte':
		'implementation: the 2D park collapses to a cell park',
	'src/lib/components/blocks/table/TableRowBlock.svelte':
		'implementation: the row park collapses to its first cell'
};

function missingDoors(code: string, door: Door): string[] {
	const missing: string[] = [];
	if (door !== 'delegate' && !RESET_RE.test(code)) missing.push('resetForPointerDown');
	if (door !== 'reset' && !DELEGATE_RE.test(code)) missing.push('crossBlock.handlePointerDown');
	return missing;
}

/**
 * Seams whose `focus` was forwarded without the sibling `parkCaret` forward. The
 * pairing string carries `export` for the same reason the matcher does: `bind:this`
 * reads instance EXPORTS individually, so an unexported `const parkCaret = leaf.parkCaret;`
 * is absent from the published ref while looking like a forward in the file.
 */
export function unforwardedParkSeams(code: string): string[] {
	const missing: string[] = [];
	for (const [, seam] of code.matchAll(FOCUS_FORWARD_RE)) {
		if (!code.includes(`export const parkCaret = ${seam}.parkCaret;`)) missing.push(seam);
	}
	return missing;
}

describe('G2.12 caret placement ends a live cross-block range', () => {
	const sources = collectEditorSources();
	const byPath = new Map(sources.map((f) => [f.relPath, f]));

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every native-caret gesture reaches every door it declares', () => {
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

	// ── The park door ────────────────────────────────────────────────────────

	it('only declared extend paths and door implementations call parkCaret', () => {
		const callers = sources
			.filter((f) => PARK_CALL_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(
			callers,
			'a file reached through the park door: it must be a selection-extend path (parking ' +
				'while the range is still growing) or a caret-door implementation. Anything else ' +
				'wants `focus`, which ends the range.'
		).toEqual(Object.keys(PARK_DOOR_CALLERS).sort());
	});

	it('every declared park caller still calls the door (no dead entry)', () => {
		for (const [relPath, why] of Object.entries(PARK_DOOR_CALLERS)) {
			const file = byPath.get(relPath);
			expect(file, `park caller not found: ${relPath} (${why})`).toBeDefined();
			expect(PARK_CALL_RE.test(file!.code), `stale entry: ${relPath}`).toBe(true);
		}
	});

	it('a block forwarding a seam’s focus forwards that seam’s parkCaret too', () => {
		const offenders = sources
			.filter((f) => unforwardedParkSeams(f.code).length > 0)
			.map((f) => `${f.relPath}: ${unforwardedParkSeams(f.code).join(', ')}`)
			.sort();
		expect(
			offenders,
			'a block forwards a shared caret seam’s `focus` without its `parkCaret`. parkCaret is ' +
				'optional on BlockComponent, so this type-checks — and every extend that lands on ' +
				'the block silently fails to park.'
		).toEqual([]);
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

	it('the park-call matcher reads both call spellings and ignores a bare forward', () => {
		expect(PARK_CALL_RE.test('ref.parkCaret?.(offset)')).toBe(true);
		expect(PARK_CALL_RE.test('surface.parkCaret(offset)')).toBe(true);
		expect(PARK_CALL_RE.test('refs[last]?.parkCaret?.(FOCUS_LAST_START)')).toBe(true);
		expect(PARK_CALL_RE.test('export const parkCaret = leaf.parkCaret;')).toBe(false);
		expect(PARK_CALL_RE.test('export function parkCaret(offset: number): void {')).toBe(false);
	});

	it('the forward check names the seam that lost its park door', () => {
		expect(unforwardedParkSeams('export const focus = leaf.focus;')).toEqual(['leaf']);
		expect(
			unforwardedParkSeams(
				'export const focus = leaf.focus;\nexport const parkCaret = leaf.parkCaret;'
			)
		).toEqual([]);
		// The seam must MATCH: forwarding a sibling's park door is not forwarding this one's.
		expect(
			unforwardedParkSeams(
				'export const focus = editableSurface.surface.focus;\nexport const parkCaret = other.parkCaret;'
			)
		).toEqual(['editableSurface.surface']);
		// A selection-endpoint read is not a caret-seam forward.
		expect(unforwardedParkSeams('const focus = ctx.selection.focus;')).toEqual([]);
		// The discriminating case: a park forward that lost only its `export` keyword is
		// absent from the published ref, so the pair is NOT satisfied. `satisfies
		// BlockComponent` cannot see export-ness and the member is optional, so this
		// arm is the only thing between that keystroke and a silently door-less block.
		expect(
			unforwardedParkSeams('export const focus = leaf.focus;\nconst parkCaret = leaf.parkCaret;')
		).toEqual(['leaf']);
	});
});
