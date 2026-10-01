/**
 * Every editable block publishes `insertMarkdown` (G4.38). `BlockComponent` declares the member
 * optional, so a block missing it would compile and quietly ignore every `editor.insertMarkdown`.
 * A leaf built on `createEditableLeaf` publishes the factory's `blockApi`, whose type requires it,
 * so the scan reads the components that build their own surface, by whichever route each uses.
 */
import { describe, it, expect } from 'vitest';
import { balancedRegion, callArguments, callsTo, collectEditorSources } from './scan-source';

/** A component building its own editable element. */
const SURFACE_FACTORY_RE = /\bcreateEditableSurface\s*\(/;

/** The exported step: an instance export, not a mention. */
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

// ── The published-object route ───────────────────────────────────────────

/** Members of the object a component hands `publishRefSlot`, or null where it publishes none.
 *  Matched to the published argument by name, since an object nothing publishes doesn't count. */
function publishedSurfaceMembers(code: string): string[] | null {
	for (const declared of code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
		const open = declared.index + declared[0].length - 1;
		const literal = balancedRegion(code, open);
		if (literal === null) continue;
		if (!/^\s*satisfies\s+BlockComponent\b/.test(code.slice(open + literal.length))) continue;
		const name = new RegExp(String.raw`\b${declared[1]}\b`);
		if (!callsTo(code, 'publishRefSlot').some((args) => name.test(args))) return null;
		return callArguments(literal.slice(1, -1)).flatMap((member) => {
			const key = /^([A-Za-z_$][\w$]*)\s*(?::|\(|$)/.exec(member);
			return key ? [key[1]] : [];
		});
	}
	return null;
}

function publishesDoor(code: string): boolean {
	const published = publishedSurfaceMembers(code);
	return published ? published.includes('insertMarkdown') : PUBLISHES_DOOR_RE.test(code);
}

describe('G4.38 insertion entry-point surface parity', () => {
	const components = surfaceComponents();

	it('found the editable-surface components to inspect', () => {
		expect(components.length).toBeGreaterThanOrEqual(3);
	});

	it('every editable-surface component publishes insertMarkdown', () => {
		const silent = components.filter((f) => !publishesDoor(f.code)).map((f) => f.relPath);
		expect(silent, RULE).toEqual([]);
	});

	// The cell is the only component on the published-object route, so losing it would leave this
	// scan reading instance exports alone.
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

	it('the factory matcher covers the surface factory and nothing else', () => {
		expect(SURFACE_FACTORY_RE.test('const s = createEditableSurface({')).toBe(true);
		expect(SURFACE_FACTORY_RE.test('const leaf = createEditableLeaf({')).toBe(false);
		expect(SURFACE_FACTORY_RE.test('import type { EditableSurface } from')).toBe(false);
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

	it('the literal reader reads past a brace inside a string member', () => {
		const src = [
			"const self = { label: '}', focus, insertMarkdown } satisfies BlockComponent;",
			'return publishRefSlot(slots, index, self);'
		].join('\n');
		expect(publishedSurfaceMembers(src)).toEqual(['label', 'focus', 'insertMarkdown']);
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
