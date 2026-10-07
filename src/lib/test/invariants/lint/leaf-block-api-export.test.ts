/**
 * A component built on `createEditableLeaf` publishes the leaf's block methods as its one
 * `blockApi` export and none of them flat (G4.73). A flat copy is still a valid `BlockComponent`,
 * so it compiles while dropping whatever it skipped. Test fixtures are in the scan too, since they
 * model a plugin author's leaf.
 */
import { describe, it, expect } from 'vitest';
import { balancedBlock, collectEditorSources, readSource } from './scan-source';
import { describeFileRules, svelteOnly, type FileRule, type Probe } from './file-rule';
import { SOURCE } from './source-paths';

const LEAF_FACTORY_RE = /\bcreateEditableLeaf\s*\(/;

/** `BlockComponent`'s members, read off its declaration so a member added there joins the scan. */
function blockComponentMembers(): Set<string> {
	const { code } = readSource(SOURCE.blockComponentApi);
	const open = code.indexOf('{', code.indexOf('export interface BlockComponent '));
	const body = balancedBlock(code, open + 1) ?? '';
	return new Set(
		[...body.matchAll(/^\t(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[(:]/gm)].map((m) => m[1])
	);
}

const MEMBERS = blockComponentMembers();

/** Every name the file's instance script exports, in either spelling. */
function exportedNames(code: string): string[] {
	const declared = [...code.matchAll(/\bexport\s+(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)];
	const listed = [...code.matchAll(/\bexport\s*\{([^}]*)\}/g)].flatMap((m) =>
		m[1].split(',').map(
			(name) =>
				name
					.trim()
					.split(/\s+as\s+/)
					.pop() ?? ''
		)
	);
	return [...declared.map((m) => m[1]), ...listed].filter(Boolean);
}

function publishesOnlyBlockApi(code: string): boolean {
	const names = exportedNames(code);
	return names.includes('blockApi') && !names.some((name) => MEMBERS.has(name));
}

const at = (code: string): Probe => ({ relPath: 'x.svelte', code });

const LEAF_EXPORT: FileRule = {
	id: 'G4.73 a component built on the editable leaf publishes blockApi and no flat block method',
	population: (file) => svelteOnly(file) && LEAF_FACTORY_RE.test(file.code),
	matches: (file) => !publishesOnlyBlockApi(file.code),
	reason:
		'export the leaf as `export const blockApi = leaf.blockApi;` and nothing else from its block surface: a flat copy compiles while dropping whatever it skipped (afterSourceCommit loses an open edit on editor.runCommand, insertMarkdown declines)',
	reaches: [SOURCE.latexBlockMath, SOURCE.revealLeafFixture, SOURCE.memoReferenceBlock],
	atLeast: 9,
	hits: [
		at('const leaf = createEditableLeaf({});'),
		at(
			[
				'const leaf = createEditableLeaf({});',
				'export const editable = true;',
				'export const focusable = true;',
				'export const focus = leaf.blockApi.focus;',
				'export const getCursorOffset = leaf.blockApi.getCursorOffset;',
				'export const parkCaret = leaf.blockApi.parkCaret;'
			].join('\n')
		),
		at(
			'createEditableLeaf({}); export const blockApi = leaf.blockApi; export function afterSourceCommit() {}'
		),
		at('createEditableLeaf({}); const { focus } = leaf.blockApi; export { focus };')
	],
	misses: [
		at('const leaf = createEditableLeaf({});\nexport const blockApi = leaf.blockApi;'),
		at('createEditableLeaf({}); const { blockApi } = leaf; export { blockApi };'),
		at('createEditableLeaf({}); export const blockApi = leaf.blockApi; export const caption = 1;'),
		{ relPath: 'x.ts', code: 'createEditableLeaf({}); export const focus = f;' },
		at('const s = createEditableSurface({}); export const focus = s.focus;')
	]
};

describe('G4.73 reads the block surface off its declaration', () => {
	it('finds the required and the optional members', () => {
		for (const member of [
			'editable',
			'focus',
			'parkCaret',
			'afterSourceCommit',
			'insertMarkdown'
		]) {
			expect(MEMBERS.has(member), member).toBe(true);
		}
		expect(MEMBERS.has('path'), 'a nested field is not a member').toBe(false);
	});
});

describeFileRules([LEAF_EXPORT], collectEditorSources(undefined, { includeTests: true }));
