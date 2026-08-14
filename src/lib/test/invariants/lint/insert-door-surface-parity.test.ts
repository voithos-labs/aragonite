/**
 * G4.38 — every editable surface publishes the programmatic insertion door. The shared
 * clipboard skeleton mints `insertMarkdown` for all of them, but Svelte 5 instance exports
 * have no spread, so the last hop is hand-written per component and `BlockComponent` declares
 * it optional — surface N+1 would compile fine and silently decline every `editor.insertMarkdown`.
 * Two channels deliver it, and the census reads whichever one the component actually uses: an
 * instance export, or the surface literal it hands `publishRefSlot` (GH #148).
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/** A component owning an editable surface: the two factories that mint one. */
const SURFACE_FACTORY_RE = /\bcreateEditable(?:Surface|Leaf)\s*\(/;

/** The exported hop — an instance export, not a mention. */
const PUBLISHES_DOOR_RE = /\bexport\s+(?:const|function)\s+insertMarkdown\b/;

const RULE =
	'every component mounting an editable surface must publish `insertMarkdown` where its own ' +
	'mount reads it — an instance export, or the literal it hands publishRefSlot when it is ' +
	'mounted with no bind:this; without that hop editor.insertMarkdown() declines on that block';

function surfaceComponents(): Array<{ relPath: string; code: string }> {
	return collectEditorSources()
		.filter((f) => f.relPath.endsWith('.svelte') && SURFACE_FACTORY_RE.test(f.code))
		.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// ── The published-literal channel ────────────────────────────────────────

/**
 * Members of the surface literal a component hands `publishRefSlot`, or null where it publishes
 * no such literal. Tied to the published argument by NAME: a literal nothing publishes is the
 * decoy an instance export with no reader already was.
 */
function publishedSurfaceMembers(code: string): string[] | null {
	const at = code.search(/\bsatisfies\s+BlockComponent\b/);
	if (at < 0) return null;
	const close = code.lastIndexOf('}', at);
	if (close < 0) return null;

	let depth = 0;
	let open = -1;
	for (let i = close; i >= 0; i--) {
		if (code[i] === '}') depth += 1;
		else if (code[i] === '{' && --depth === 0) {
			open = i;
			break;
		}
	}
	if (open < 0) return null;

	const declared = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(code.slice(0, open));
	if (!declared) return null;
	if (!new RegExp(String.raw`publishRefSlot\s*\([^)]*\b${declared[1]}\b`).test(code)) return null;

	return code
		.slice(open + 1, close)
		.split(/[,\n]/)
		.map((entry) => entry.split(':')[0].trim())
		.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function publishesDoor(code: string): boolean {
	const published = publishedSurfaceMembers(code);
	return published ? published.includes('insertMarkdown') : PUBLISHES_DOOR_RE.test(code);
}

describe('G4.38 insertion-door surface parity', () => {
	const components = surfaceComponents();

	it('found the editable-surface components to inspect', () => {
		expect(components.length).toBeGreaterThanOrEqual(4);
	});

	it('every editable-surface component publishes insertMarkdown', () => {
		const silent = components.filter((f) => !publishesDoor(f.code)).map((f) => f.relPath);
		expect(silent, RULE).toEqual([]);
	});

	// The cell is the whole literal-channel population, and the arm that would go vacuous first:
	// losing it leaves the census scanning exports only, which is the blind spot #148 named.
	it('the table cell is scanned through the literal its row actually mounts', () => {
		const cell = components.find((f) => f.relPath.endsWith('TableCellBlock.svelte'));
		expect(cell, 'TableCellBlock left the editable-surface population').toBeDefined();
		expect(publishedSurfaceMembers(cell!.code)).toContain('insertMarkdown');
		expect(
			PUBLISHES_DOOR_RE.test(cell!.code),
			'the cell is mounted with no bind:this, so an instance export is a hop with no reader'
		).toBe(false);
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

	it('the literal reader takes members by shorthand and by key, past a nested value', () => {
		const src = [
			'const self = {',
			'	focus,',
			'	measurePartialRects: (r) => ({ rects: [] }),',
			'	insertMarkdown: clipboard.insertMarkdown',
			'} satisfies BlockComponent;',
			'return publishRefSlot(slots, index, self);'
		].join('\n');
		expect(publishedSurfaceMembers(src)).toEqual([
			'focus',
			'measurePartialRects',
			'insertMarkdown'
		]);
	});

	it('a literal nothing publishes is not a channel', () => {
		const decoy = 'const decoy = {\n\tinsertMarkdown\n} satisfies BlockComponent;';
		expect(publishedSurfaceMembers(decoy)).toBeNull();
		expect(publishesDoor(`${decoy}\nreturn publishRefSlot(slots, index, other);`)).toBe(false);
		expect(publishesDoor('void ({ focus } satisfies BlockComponent);')).toBe(false);
	});

	it('an omitted member fails the literal channel rather than falling back to the export', () => {
		const withoutMember = [
			'export function insertMarkdown(md) { return clipboard.insertMarkdown(md); }',
			'const self = { focus } satisfies BlockComponent;',
			'return publishRefSlot(slots, index, self);'
		].join('\n');
		expect(publishesDoor(withoutMember)).toBe(false);
	});
});
