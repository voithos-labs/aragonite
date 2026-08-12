/**
 * G4.39 — every component holding a focused command surface publishes `runCommand`. G4.38's
 * twin over the semantic door: `BlockComponent` declares the method optional and the last hop is
 * hand-written per component, so surface N+1 would compile clean and decline every
 * `editor.runCommand()` on its blocks. The population is wider than G4.38's by one signal: a
 * component that dispatches chords itself is a command surface even where no editable-surface
 * factory minted it (the thematic break is `editable = false` and still takes commands).
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** A component owning a command surface: a surface factory, or its own leaf chord dispatch. */
const COMMAND_SURFACE_RE = /\bcreateEditable(?:Surface|Leaf)\s*\(|\bdispatchKeyCommand\s*\(/;

/** The published hop — an instance export, not a mention. */
const PUBLISHES_DOOR_RE = /\bexport\s+(?:const|function)\s+runCommand\b/;

const RULE =
	'every component mounting a command surface must publish `runCommand` as an instance export ' +
	'(the surface factories already return it); without that hop editor.runCommand() declines on ' +
	'that block. A surface that genuinely takes no command belongs in this message, not in silence';

function surfaceComponents(): Array<{ relPath: string; code: string }> {
	return collectEditorSources()
		.filter((f) => f.relPath.endsWith('.svelte') && COMMAND_SURFACE_RE.test(f.code))
		.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

describe('G4.39 command-door surface parity', () => {
	const components = surfaceComponents();

	it('found the command-surface components to inspect', () => {
		expect(components.length).toBeGreaterThanOrEqual(5);
		// The dispatch-only arm is what widens this census past G4.38's; a population that lost it
		// would still pass every assertion below.
		expect(components.map((f) => f.relPath)).toContain(
			'src/lib/components/blocks/ThematicBreakBlock.svelte'
		);
	});

	it('every command-surface component publishes runCommand', () => {
		const silent = components.filter((f) => !PUBLISHES_DOOR_RE.test(f.code)).map((f) => f.relPath);
		expect(silent, RULE).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the surface matcher covers both signals and nothing else', () => {
		expect(COMMAND_SURFACE_RE.test('const s = createEditableSurface({')).toBe(true);
		expect(COMMAND_SURFACE_RE.test('const leaf = createEditableLeaf({')).toBe(true);
		expect(COMMAND_SURFACE_RE.test('if (chord && dispatchKeyCommand(chord, target, ctx))')).toBe(
			true
		);
		// The container bubble is not a focused surface: the door resolves a leaf path.
		expect(COMMAND_SURFACE_RE.test('dispatchKindCommand(chord, target, gates)')).toBe(false);
		expect(COMMAND_SURFACE_RE.test('import type { EditableLeaf } from')).toBe(false);
	});

	it('the publish matcher demands an export, not a mention', () => {
		expect(PUBLISHES_DOOR_RE.test('export const runCommand = leaf.runCommand;')).toBe(true);
		expect(PUBLISHES_DOOR_RE.test('export function runCommand(id: CommandId): boolean {')).toBe(
			true
		);
		expect(PUBLISHES_DOOR_RE.test('const x = component.runCommand;')).toBe(false);
		expect(PUBLISHES_DOOR_RE.test('if (!component?.runCommand) return null;')).toBe(false);
	});
});
