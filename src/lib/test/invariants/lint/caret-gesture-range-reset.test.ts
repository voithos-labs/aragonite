/**
 * G2.12 — a caret placement ends a live cross-block range, unless it is an extend.
 * `BlockComponent.focus`, minted from `selection/caret-doors.ts`, funnels the
 * programmatic half. Three arms carry the rest: NATIVE placement, whose range-ending
 * lives in a pointerdown preamble; the `parkCaret` CALLERS, an allowlist because a park's
 * legitimacy is the caller's intent; and the park door's PRESENCE, which the optional
 * member lets a leaf forward drop while type-checking clean. Containers publish one
 * `containerApi` export instead, so their arm is publish-that-or-nothing.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** The preamble itself. */
const RESET_RE = /\bresetForPointerDown\s*\(/;
/** The delegating door: a surface handing its press to the cross-block dispatcher,
 *  whose own preamble is the reset. */
const DELEGATE_RE = /\bcrossBlock\.handlePointerDown\s*\(/;
/** A press handler of any spelling. The bundle-key form (`onpointerdown:`) is how a leaf
 *  hands its surface to a plugin component; omitting it hides `editable-leaf.ts`. A spread of
 *  the leaf's `renderProps` binds the press without naming it, and hides the component. */
const POINTER_HANDLER_RE =
	/\bon(pointerdown|mousedown)\s*[=:]|['"](pointerdown|mousedown)['"]|\brenderProps\b/;
/** A call THROUGH the park door, optional-call spelling included. A bare forward
 *  (`export const parkCaret = leaf.parkCaret;`) has no call and is not a caller. */
const PARK_CALL_RE = /\.parkCaret\s*\??\.?\s*\(/;
/** A block forwarding a shared caret seam's public verb. The `export` is load-bearing:
 *  an unexported `const focus = selection.focus` reads the selection ENDPOINT instead. */
const FOCUS_FORWARD_RE = /\bexport const focus = ((?:\w+\.)*\w+)\.focus\s*;/g;
/** A call to a container seam factory — the thing that mints a whole
 *  `ContainerBlockComponent`, both doors included. */
const CONTAINER_SEAM_RE = /\bcreateContainerBlock(?:Component)?\s*\(/;
/** The publication, in either spelling. The `export` keyword is load-bearing for the
 *  same reason as above: `bind:this` reads instance EXPORTS. */
const CONTAINER_API_EXPORT_RE =
	/\bexport\s+(?:const\s+containerApi\s*=|\{[^}]*\bcontainerApi\b[^}]*\})/;

type Door = 'reset' | 'delegate' | 'both';

/** Defines the preamble and binds no handler, so it is excluded from the press sweep. */
const PREAMBLE_MODULE = 'src/lib/selection/cross-block/pointer.ts';

/** They MINT the surface, so a factory call here is a definition, not a ref to publish. */
const CONTAINER_SEAM_MODULES = [
	'src/lib/editor-actions/container-block-component.ts',
	'src/lib/editor-actions/plugin/container.ts'
];

/** Gestures whose caret the BROWSER places, and the door(s) each one owes. */
const CARET_GESTURE_DOORS: Record<string, Door> = {
	[PREAMBLE_MODULE]: 'reset',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'reset',
	'src/lib/components/blocks/text/TextEditableBlock.svelte': 'delegate',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'delegate',
	// Two doors: the dispatcher hit-tests against SOURCE text the rendered view lacks, so
	// the rendered view calls the preamble itself rather than delegating.
	'src/lib/components/blocks/editable-leaf.ts': 'both',
	// The dead-space click — the root's own padding and the area below the last block.
	'src/lib/components/Editor.svelte': 'reset'
};

/**
 * Press handlers that place no caret. A new pointer-handling file joins this map or the
 * one above; there is no third answer, which is the whole point of the guard.
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
	'src/lib/components/link-card/LinkCardHost.svelte':
		'document-capture dismiss-on-outside-press for the link card; the press that dismisses places its own caret through the ordinary door',
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
 * The only callers allowed through the park door. A new entry claims the caller runs
 * WHILE an extend is growing a range; anything else wants `focus`.
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
 * Seams whose `focus` was forwarded without the sibling `parkCaret` forward. The pairing
 * string carries `export` because `bind:this` reads instance EXPORTS individually, so an
 * unexported forward is absent from the published ref while looking present in the file.
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

	it('every container publishes its surface as one containerApi instance export', () => {
		const containers = sources.filter(
			(f) => CONTAINER_SEAM_RE.test(f.code) && !CONTAINER_SEAM_MODULES.includes(f.relPath)
		);
		// Non-vacuity: the sweep is only a guard while it reaches real containers. No
		// enumeration here on purpose — this file's own list drifted once as plugins landed.
		expect(containers.length, 'the container sweep found no container components').toBeGreaterThan(
			0
		);

		const offenders = containers
			.filter((f) => !CONTAINER_API_EXPORT_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(
			offenders,
			'a container calls the seam factory but publishes no `containerApi` instance export. ' +
				'BlockHost resolves a container ref through that one export, so without it the block ' +
				'publishes a surface with no verbs — no focus, and no park door for an extend.'
		).toEqual([]);
	});

	it('every declared container-seam module still mints the surface (no dead entry)', () => {
		for (const relPath of CONTAINER_SEAM_MODULES) {
			const file = byPath.get(relPath);
			expect(file, `container-seam module not found: ${relPath}`).toBeDefined();
			expect(CONTAINER_SEAM_RE.test(file!.code), `stale entry: ${relPath}`).toBe(true);
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

	// A file-level "either door" check reads the sibling handler's delegate call and passes
	// a rendered view that resets nothing — which is why `both` exists.
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

	it('the container matchers read both publication spellings and reject a bare local', () => {
		expect(CONTAINER_SEAM_RE.test('const { containerApi } = createContainerBlock({')).toBe(true);
		expect(CONTAINER_SEAM_RE.test('const api = createContainerBlockComponent({')).toBe(true);
		expect(CONTAINER_API_EXPORT_RE.test('export { containerApi };')).toBe(true);
		expect(CONTAINER_API_EXPORT_RE.test('export { blockListProps, containerApi };')).toBe(true);
		expect(CONTAINER_API_EXPORT_RE.test('export const containerApi = createContainerBlock({')).toBe(
			true
		);
		// The discriminating cases: a destructure alone publishes nothing, and neither does
		// a local that lost its `export` — the same keystroke the park-forward arm catches.
		expect(CONTAINER_API_EXPORT_RE.test('const { blockListProps, containerApi } = f({')).toBe(
			false
		);
		expect(CONTAINER_API_EXPORT_RE.test('const containerApi = createContainerBlock({')).toBe(false);
		// A neighbouring export is not this one.
		expect(CONTAINER_API_EXPORT_RE.test('export { blockListProps };')).toBe(false);
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
		// `satisfies BlockComponent` cannot see export-ness and the member is optional, so
		// this arm is all that stands between a dropped `export` and a door-less block.
		expect(
			unforwardedParkSeams('export const focus = leaf.focus;\nconst parkCaret = leaf.parkCaret;')
		).toEqual(['leaf']);
	});
});
