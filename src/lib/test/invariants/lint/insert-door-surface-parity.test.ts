/**
 * G4.38 — every editable surface publishes the programmatic insertion door. The shared
 * clipboard skeleton mints `insertMarkdown` for all of them, but Svelte 5 instance exports
 * have no spread, so the last hop is hand-written per component and `BlockComponent` declares
 * it optional — surface N+1 would compile fine and silently decline every `editor.insertMarkdown`.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** A component owning an editable surface: the two factories that mint one. */
const SURFACE_FACTORY_RE = /\bcreateEditable(?:Surface|Leaf)\s*\(/;

/** The published hop — an instance export, not a mention. */
const PUBLISHES_DOOR_RE = /\bexport\s+(?:const|function)\s+insertMarkdown\b/;

const RULE =
	'every component mounting an editable surface must publish `insertMarkdown` as an instance ' +
	'export (the clipboard skeleton already returns it); without that hop editor.insertMarkdown() ' +
	'declines on that block';

function surfaceComponents(): Array<{ relPath: string; code: string }> {
	return collectEditorSources()
		.filter((f) => f.relPath.endsWith('.svelte') && SURFACE_FACTORY_RE.test(f.code))
		.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

describe('G4.38 insertion-door surface parity', () => {
	const components = surfaceComponents();

	it('found the editable-surface components to inspect', () => {
		expect(components.length).toBeGreaterThanOrEqual(4);
	});

	it('every editable-surface component publishes insertMarkdown', () => {
		const silent = components.filter((f) => !PUBLISHES_DOOR_RE.test(f.code)).map((f) => f.relPath);
		expect(silent, RULE).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the factory matcher covers both surface factories and nothing else', () => {
		expect(SURFACE_FACTORY_RE.test('const s = createEditableSurface({')).toBe(true);
		expect(SURFACE_FACTORY_RE.test('const leaf = createEditableLeaf({')).toBe(true);
		expect(SURFACE_FACTORY_RE.test('import type { EditableLeaf } from')).toBe(false);
	});

	it('the publish matcher demands an export, not a mention', () => {
		expect(PUBLISHES_DOOR_RE.test('export const insertMarkdown = leaf.insertMarkdown;')).toBe(true);
		expect(PUBLISHES_DOOR_RE.test('export function insertMarkdown(md: string): boolean {')).toBe(
			true
		);
		expect(PUBLISHES_DOOR_RE.test('const x = clipboard.insertMarkdown;')).toBe(false);
	});
});
