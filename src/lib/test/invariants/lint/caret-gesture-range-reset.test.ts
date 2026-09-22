/**
 * G2.12: placing the caret ends a live cross-block range, unless the gesture is extending one.
 * `BlockComponent.focus`, built by `selection/caret-doors.ts`, covers the programmatic half.
 * Three more checks carry the rest: placement by the browser, whose range-ending happens in a
 * pointerdown preamble; the callers of `parkCaret`, an allowlist because whether parking the
 * caret is legitimate depends on the caller's intent; and whether that function is present at all, since
 * the member is optional and a leaf can drop the forward while still type-checking. Containers
 * publish one `containerApi` export instead, so for them it is publish that or nothing.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** The preamble itself. */
const RESET_RE = /\bresetForPointerDown\s*\(/;
/** The delegating call: a block handing its click to the cross-block dispatcher,
 *  whose own preamble is the reset. */
const DELEGATE_RE = /\bcrossBlock\.handlePointerDown\s*\(/;
/** A click handler of any spelling. The bundle-key form (`onpointerdown:`) is how a leaf hands
 *  its editable element to a plugin component; leaving it out hides `editable-leaf.ts`. A spread
 *  of the leaf's `renderProps` binds the handler without naming it, and hides the component. */
const POINTER_HANDLER_RE =
	/\bon(pointerdown|mousedown)\s*[=:]|['"](pointerdown|mousedown)['"]|\brenderProps\b/;
/** A call to `parkCaret`, optional-call spelling included. A bare forward
 *  (`export const parkCaret = leaf.parkCaret;`) makes no call and is not a caller. */
const PARK_CALL_RE = /\.parkCaret\s*\??\.?\s*\(/;
/** A block forwarding the shared caret module's public method. The `export` is required: an
 *  unexported `const focus = selection.focus` reads the selection endpoint instead. */
const FOCUS_FORWARD_RE = /\bexport const focus = ((?:\w+\.)*\w+)\.focus\s*;/g;
/** A call to a container factory, the thing that builds a whole
 *  `ContainerBlockComponent`, both caret functions included. */
const CONTAINER_SEAM_RE = /\bcreateContainerBlock(?:Component)?\s*\(/;
/** The publication, in either spelling. The `export` keyword is required for the
 *  same reason as above: `bind:this` reads instance exports. */
const CONTAINER_API_EXPORT_RE =
	/\bexport\s+(?:const\s+containerApi\s*=|\{[^}]*\bcontainerApi\b[^}]*\})/;

type Door = 'reset' | 'delegate' | 'both';

/** Defines the preamble and binds no handler, so it is excluded from the click scan. */
const PREAMBLE_MODULE = 'src/lib/selection/cross-block/pointer.ts';

/** These build the editable element, so a factory call here defines it rather than publishing. */
const CONTAINER_SEAM_MODULES = [
	'src/lib/editor-actions/container-block-component.ts',
	'src/lib/editor-actions/plugin/container.ts'
];

/** Gestures whose caret the browser places, and the call or calls each one has to make. */
const CARET_GESTURE_DOORS: Record<string, Door> = {
	[PREAMBLE_MODULE]: 'reset',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'reset',
	'src/lib/components/blocks/text/TextEditableBlock.svelte': 'delegate',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'delegate',
	// Two calls: the dispatcher hit-tests against source text the rendered view does not have,
	// so the rendered view calls the preamble itself rather than delegating.
	'src/lib/components/blocks/editable-leaf.ts': 'both',
	// The dead-space click (the root's own padding, the area below the last block) and the
	// margin drag, both of which land a caret the browser did not place.
	'src/lib/components/editor-root-gestures.ts': 'reset'
};

/**
 * Click handlers that place no caret. A new pointer-handling file joins this map or the one
 * above; there is no third answer, which is the whole point of the check.
 */
const NON_CARET_PRESS_FILES: Record<string, string> = {
	'src/lib/components/TailInsert.svelte':
		'swallows the press so no caret seats under it; the paragraph it mints focuses itself',
	'src/lib/components/menu/BlockMenu.svelte':
		'swallows the press on its rows so the caret it inserts at keeps focus',
	'src/lib/components/menu/InlineMenuHost.svelte':
		'swallows the press on its rows so the caret the pick writes at keeps focus',
	'src/lib/components/menu/SelectionToolbar.svelte':
		'swallows the press on its buttons so the selection they act on survives it; the release is only heard to place the bar',
	'src/lib/components/editor-root-listeners.ts':
		'the reveal-anchor release: a press on the scroll port drops the pin and touches no caret',
	'src/lib/selection/multi-click.ts':
		'the second and third presses of a click run select the word or the surface under them: a selection gesture whose first press already went through the door',
	'src/lib/components/blocks/table/TableActionMenu.svelte':
		'document-capture dismiss-on-outside-press for the menu',
	'src/lib/components/blocks/table/TableBlock.svelte':
		'the add-row and add-column strips swallow their press so the cell keeps the caret that pinned them',
	'src/lib/components/blocks/code/CodeBlockRail.svelte':
		'preventDefault on a language-list option so the field keeps focus long enough to commit the pick; the caret returns through the block’s own door afterwards',
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
	'src/lib/plugins/parrot/ParrotBlock.svelte':
		'binds the shared editable-leaf reveal handler on its caption; the reset lives there',
	'src/lib/plugins/toc/TocBlock.svelte':
		'binds the shared editable-leaf reveal handler, plus entry navigation',
	'src/lib/plugins/mermaid/MermaidBlock.svelte':
		'stopPropagation on its toolbar and a diagram-surface press that selects the block',
	'src/routes/test/plugins/+page.svelte':
		'harness chrome — preventDefault on a mode toggle so the press takes no focus'
};

/**
 * The only callers allowed to call `parkCaret`. A new entry claims the caller runs while an
 * extend is growing a range; anything else wants `focus`.
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
 * Modules whose `focus` was forwarded without the matching `parkCaret` forward. The pairing
 * string carries `export` because `bind:this` reads instance exports one by one, so an unexported
 * forward is missing from the published ref while looking present in the file.
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

	it('every native-caret gesture reaches every entry point it declares', () => {
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

	// ── Calling parkCaret ────────────────────────────────────────────────────

	it('only declared extend paths and entry point implementations call parkCaret', () => {
		const callers = sources
			.filter((f) => PARK_CALL_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(
			callers,
			'a file reached through `parkCaret`: it must be a selection-extend path (placing the caret ' +
				'while the range is still growing) or a caret-writer implementation. Anything else ' +
				'wants `focus`, which ends the range.'
		).toEqual(Object.keys(PARK_DOOR_CALLERS).sort());
	});

	it('every declared `parkCaret` caller still calls it (no dead entry)', () => {
		for (const [relPath, why] of Object.entries(PARK_DOOR_CALLERS)) {
			const file = byPath.get(relPath);
			expect(file, `\`parkCaret\` caller not found: ${relPath} (${why})`).toBeDefined();
			expect(PARK_CALL_RE.test(file!.code), `stale entry: ${relPath}`).toBe(true);
		}
	});

	it('every container publishes its surface as one containerApi instance export', () => {
		const containers = sources.filter(
			(f) => CONTAINER_SEAM_RE.test(f.code) && !CONTAINER_SEAM_MODULES.includes(f.relPath)
		);
		// The scan only checks anything while it reaches real containers. Deliberately not a
		// list of names: a list here would go stale as plugins land.
		expect(containers.length, 'the container sweep found no container components').toBeGreaterThan(
			0
		);

		const offenders = containers
			.filter((f) => !CONTAINER_API_EXPORT_RE.test(f.code))
			.map((f) => f.relPath)
			.sort();
		expect(
			offenders,
			'a container calls the shared caret factory but publishes no `containerApi` instance export. ' +
				'BlockHost resolves a container ref through that one export, so without it the block ' +
				'publishes a surface with no verbs: no focus, and no `parkCaret` for an extend.'
		).toEqual([]);
	});

	it('every declared container caret module still creates the surface (no dead entry)', () => {
		for (const relPath of CONTAINER_SEAM_MODULES) {
			const file = byPath.get(relPath);
			expect(file, `container caret module not found: ${relPath}`).toBeDefined();
			expect(CONTAINER_SEAM_RE.test(file!.code), `stale entry: ${relPath}`).toBe(true);
		}
	});

	it('a block forwarding a shared helper’s focus forwards its `parkCaret` too', () => {
		const offenders = sources
			.filter((f) => unforwardedParkSeams(f.code).length > 0)
			.map((f) => `${f.relPath}: ${unforwardedParkSeams(f.code).join(', ')}`)
			.sort();
		expect(
			offenders,
			'a block forwards a shared caret helper’s `focus` without its `parkCaret`. parkCaret is ' +
				'optional on BlockComponent, so this type-checks, and every extend that lands on ' +
				'the block silently fails to place the caret.'
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

	// A file-level "either call" check reads the sibling handler's delegate call and passes a
	// rendered view that resets nothing, which is why `both` exists.
	it('a two-gesture file with only the delegate entry point is reported', () => {
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

	it('the put the caret-call matcher reads both call spellings and ignores a bare forward', () => {
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
		// The cases that tell them apart: a destructure alone publishes nothing, and neither does
		// a local that lost its `export`, the same keystroke the forward check catches.
		expect(CONTAINER_API_EXPORT_RE.test('const { blockListProps, containerApi } = f({')).toBe(
			false
		);
		expect(CONTAINER_API_EXPORT_RE.test('const containerApi = createContainerBlock({')).toBe(false);
		// A neighbouring export is not this one.
		expect(CONTAINER_API_EXPORT_RE.test('export { blockListProps };')).toBe(false);
	});

	it('the forward check names the module that lost its `parkCaret`', () => {
		expect(unforwardedParkSeams('export const focus = leaf.focus;')).toEqual(['leaf']);
		expect(
			unforwardedParkSeams(
				'export const focus = leaf.focus;\nexport const parkCaret = leaf.parkCaret;'
			)
		).toEqual([]);
		// The module has to match: forwarding a sibling's `parkCaret` is not forwarding this one's.
		expect(
			unforwardedParkSeams(
				'export const focus = editableSurface.surface.focus;\nexport const parkCaret = other.parkCaret;'
			)
		).toEqual(['editableSurface.surface']);
		// A selection-endpoint read is not a forward of the caret module.
		expect(unforwardedParkSeams('const focus = ctx.selection.focus;')).toEqual([]);
		// `satisfies BlockComponent` cannot see whether something is exported, and the member is
		// optional, so this check is all that stands between a dropped `export` and a block that
		// has no way to place a caret at all.
		expect(
			unforwardedParkSeams('export const focus = leaf.focus;\nconst parkCaret = leaf.parkCaret;')
		).toEqual(['leaf']);
	});
});
