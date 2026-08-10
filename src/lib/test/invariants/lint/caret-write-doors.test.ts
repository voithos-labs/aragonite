/**
 * No module outside the door homes writes a caret position (G4.36, the G4.33 twin). A caret
 * write is where a raw offset becomes a DOM seat, so every home must apply the landable clamp
 * or forward to one that does — a new writer re-opens the class the funnel closed (a byte typed
 * behind a hidden run dissolves a construct, G2.12). Name-level set equality per write family,
 * the #114 shape: an alias, a forward or a bracket spelling all still name the door once.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** Files that may name `setRaw` — the raw-offset caret write, one per cursor backend. */
const SET_RAW_NAMERS: Record<string, string> = {
	'src/lib/ambient/ambient-cursor.ts': 'defines the raw write: the offset walk + ambient landing',
	'src/lib/components/blocks/editable-surface.ts':
		'the park and column doors — the landable clamp lives here',
	'src/lib/components/blocks/plain-text-backend.ts': 'the plugin-leaf backend over content offsets',
	'src/lib/components/blocks/code/CodeBlock.svelte':
		'its backend forward, plus the fence-line clamp correction after a column landing',
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'its backend forward; widget steps and the pending-cursor restore',
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'its backend forward; the pending-cursor restore',
	'src/lib/components/blocks/text/widget-interaction.ts':
		'widget entry/exit seats beside an atomic island'
};

/** Files that may name `setToAmbientBoundary` — the raw-0 landing under an ambient marker. */
const AMBIENT_BOUNDARY_NAMERS: Record<string, string> = {
	'src/lib/ambient/ambient-cursor.ts': 'defines it; every other caller routes through a door'
};

/** Files that may write the native selection (`addRange` / `setBaseAndExtent`). */
const NATIVE_RANGE_WRITERS: Record<string, string> = {
	'src/lib/ambient/ambient-cursor.ts': 'the raw write lands as a native range',
	'src/lib/ambient/ambient-dom.ts': 'placeCaretAfterAmbientSpan, the shared boundary landing',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'its setSelection range write',
	'src/lib/components/blocks/editable-surface.ts': 'the factory setSelection range write',
	'src/lib/components/blocks/text/edge-policy-dispatch.ts':
		'selects a replace island whole — a range, not a caret seat',
	'src/lib/cursor/content-offsets.ts': 'setCursorOffset, the content-offset write helper',
	'src/lib/cursor/focused-caret.ts': 'restoreCaretAtWalkOffset, the render-rebuild carry',
	'src/lib/selection/caret-restore.ts': 'the menu-blur saved-range restore',
	'src/lib/selection/cross-block/keydown.ts': 'the first-press Ctrl+A content range',
	'src/lib/selection/native-bridge.ts':
		'the SelectionPoint door — the collapsed-caret landable clamp lives here'
};

/** Files that may name the two caret-write helpers the native census would otherwise hide. */
const WRITE_HELPER_NAMERS: Record<string, string> = {
	'src/lib/cursor/content-offsets.ts': 'defines setCursorOffset',
	'src/lib/cursor/focused-caret.ts': 'defines restoreCaretAtWalkOffset',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'DOM-first commit landing',
	'src/lib/components/blocks/editable-leaf.ts': 'pending restore + paste landing',
	'src/lib/components/blocks/plain-text-backend.ts': 'the backend write forward',
	'src/lib/components/blocks/table/cell-render.ts': 'render-rebuild caret carry',
	'src/lib/components/blocks/text/text-render.ts': 'render-rebuild caret carry',
	'src/lib/cursor/reveal-source.ts': 'reveal fold caret carry'
};

/** Files that may mint a public `focus` from `selection/caret-doors`' placeCaret. */
const PLACE_CARET_MINTERS: Record<string, string> = {
	'src/lib/components/blocks/editable-leaf.ts': 'the plugin leaf surface',
	'src/lib/components/blocks/editable-surface.ts': 'the shared editable factory',
	'src/lib/components/blocks/table/TableBlock.svelte': 'the cell-addressed grid surface',
	'src/lib/components/blocks/ThematicBreakBlock.svelte': 'the whole-block-focus leaf',
	'src/lib/editor-actions/container-block-component.ts': 'the container walk-in shim'
};

const namesToken = (token: string) => (file: SourceFile) =>
	new RegExp(`(?<![\\w'"])${token}\\b`).test(stripComments(file.text));

const writesNativeRange = (file: SourceFile): boolean =>
	/\.(addRange|setBaseAndExtent)\s*\(/.test(stripComments(file.text));

const namesWriteHelper = (file: SourceFile): boolean =>
	/(?<![\w'"])(setCursorOffset|restoreCaretAtWalkOffset)\b/.test(stripComments(file.text));

const mintsPlaceCaret = (file: SourceFile): boolean =>
	/import\s*(?:type\s*)?\{[^}]*(?<!\w)placeCaret\b[^}]*\}\s*from\s*'[^']*caret-doors'/.test(
		stripComments(file.text)
	);

function census(
	sources: SourceFile[],
	matches: (file: SourceFile) => boolean,
	allowed: Record<string, string>
): void {
	const namers = sources.filter(matches).map((file) => file.relPath);
	expect(namers.sort()).toEqual(Object.keys(allowed).sort());
}

describe('G4.36 caret-write-door census', () => {
	const sources = collectEditorSources();

	it('the files naming setRaw are the declared backends and doors', () => {
		census(sources, namesToken('setRaw'), SET_RAW_NAMERS);
	});

	it('the files naming setToAmbientBoundary are the declared door', () => {
		census(sources, namesToken('setToAmbientBoundary'), AMBIENT_BOUNDARY_NAMERS);
	});

	it('the files writing the native selection are the declared doors', () => {
		census(sources, writesNativeRange, NATIVE_RANGE_WRITERS);
	});

	it('the files naming the caret-write helpers are the declared ones', () => {
		census(sources, namesWriteHelper, WRITE_HELPER_NAMERS);
	});

	it('the files minting placeCaret are the declared surfaces', () => {
		census(sources, mintsPlaceCaret, PLACE_CARET_MINTERS);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the token matcher sees a call, a def, and a forward, and skips prose', () => {
		const probe = (text: string) => namesToken('setRaw')({ relPath: 'x', text, code: '' });
		expect(probe('deps.backend.setRaw(asRawOffset(0));')).toBe(true);
		expect(probe('setRaw: (offset) => write(offset),')).toBe(true);
		expect(probe('const write = io.setRaw;')).toBe(true);
		expect(probe('// setRaw is the door')).toBe(false);
		expect(probe('const mySetRaw = 1;')).toBe(false);
	});

	it('the native matcher sees both write verbs and skips reads', () => {
		const probe = (text: string) => writesNativeRange({ relPath: 'x', text, code: '' });
		expect(probe('sel?.addRange(range);')).toBe(true);
		expect(probe('sel.setBaseAndExtent(n, 0, n, 0);')).toBe(true);
		expect(probe('sel.getRangeAt(0);')).toBe(false);
	});

	it('an undeclared file naming setRaw fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/components/blocks/rogue.ts',
			text: 'deps.backend.setRaw(offset);',
			code: ''
		};
		const namers = [...sources, rogue].filter(namesToken('setRaw')).map((file) => file.relPath);
		expect(namers.sort()).not.toEqual(Object.keys(SET_RAW_NAMERS).sort());
	});
});
