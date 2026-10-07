/**
 * G4.107: an `edit` event fires at the write that changed the bytes, so only the writes emit it,
 * never a timer or a batch that outlives them. `input` also means "this write held the block's
 * kind", a premise the link-reference map check (`components/link-reference-map.ts`) reads but cannot verify,
 * so only the in-place leaf write, whose trial reparse found no kind change, may declare it.
 */

import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	enclosingFunction,
	fileClasses,
	sourceFile,
	type SourceFile
} from './scan-source';

/** The writes, one site each: a commit, a keystroke written in place, undo and redo, and a whole
 *  replace-all. Keyed by function, so a second emit in one of these files still fails. */
const EDIT_EMITTERS = [
	'src/lib/editor-actions/commit/history.ts :: restore',
	'src/lib/editor-actions/commit/undo-controller.ts :: runCommitCeremony',
	'src/lib/editor-actions/leaf-write.ts :: writeLeafInPlace',
	'src/lib/editor-actions/search-replace.ts :: replaceSubtrees'
];

const INPUT_EMITTER = 'src/lib/editor-actions/leaf-write.ts :: writeLeafInPlace';

const EMITS_EDIT = /\bemit\(\s*['"]edit['"]/g;

/** Either declaration shape: an OpDescriptor's `kind`, or an EditEvent's `op`. */
const DECLARES_INPUT_OP = /\b(?:kind|op)\s*:\s*'input'/g;

/** One `path :: function` per match, so a site counts once per occurrence. */
function sitesOf(sources: SourceFile[], pattern: RegExp): string[] {
	return sources.flatMap((file) => {
		const classes = fileClasses(file);
		return [...file.code.matchAll(pattern)].map(
			(m) => `${file.relPath} :: ${enclosingFunction(file.code, m.index, classes)}`
		);
	});
}

const editEmitters = (sources: SourceFile[]) => sitesOf(sources, EMITS_EDIT);
const inputOpEmitters = (sources: SourceFile[]) => sitesOf(sources, DECLARES_INPUT_OP);

describe('G4.107 only a write emits an edit event', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('only the writes emit `edit`, one site each', () => {
		expect(editEmitters(sources).sort()).toEqual(EDIT_EMITTERS);
	});

	it('only the in-place leaf write declares an input op, once', () => {
		expect(inputOpEmitters(sources)).toEqual([INPUT_EMITTER]);
	});
});

describe('edit emitter scans: matcher self-tests', () => {
	const scanInput = (src: string) => inputOpEmitters([sourceFile('x.ts', src)]);
	const scanEdit = (src: string) => editEmitters([sourceFile('x.ts', src)]);
	const top = 'x.ts :: <module>';

	it('catches an edit emit, and leaves another event and a subscription alone', () => {
		expect(scanEdit("deps.events.emit('edit', event)")).toEqual([top]);
		expect(scanEdit('events.emit(\n\t"edit",\n\tevent\n)')).toEqual([top]);
		expect(scanEdit("events.emit('error', report)")).toEqual([]);
		expect(scanEdit("events.on('edit', handler)")).toEqual([]);
	});

	it('names the function around each emit, once per emit', () => {
		const src = "function write() {\n\temit('edit', a);\n\temit('edit', b);\n}";
		expect(scanEdit(src)).toEqual(['x.ts :: write', 'x.ts :: write']);
	});

	it('catches both input declaration shapes', () => {
		expect(scanInput("op: { kind: 'input' }")).toEqual([top]);
		expect(scanInput("events.emit('edit', { op: 'input', path, timestamp })")).toEqual([top]);
	});

	it('leaves a neighbouring op kind, a consumer read, and an inputType alone', () => {
		expect(scanInput("op: { kind: 'updateContent', detail: { length: 3 } }")).toEqual([]);
		expect(scanInput("if (event.op !== 'input') return true;")).toEqual([]);
		expect(scanInput("if (e.inputType !== 'insertText') return false;")).toEqual([]);
		expect(scanInput('input: undefined;')).toEqual([]);
	});

	it('ignores a declaration or an emit quoted inside a comment', () => {
		const src = "// op: 'input' means the kind held, emit('edit', e)\nconst held = true;";
		expect(inputOpEmitters([sourceFile('x.ts', src)])).toEqual([]);
		expect(editEmitters([sourceFile('x.ts', src)])).toEqual([]);
	});
});
