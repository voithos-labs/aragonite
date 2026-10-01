/**
 * G4.107: an `edit` event fires at the write that changed the bytes, so only the writes emit it,
 * never a timer or a batch that outlives them. `input` also means "this write held the block's
 * kind", a premise the LRD signature check (`components/lrd-map-gate.ts`) reads but cannot verify,
 * so only the in-place leaf write, whose trial reparse found no kind change, may declare it.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, sourceFile, type SourceFile } from './scan-source';

/** The writes: a commit, a keystroke written in place, undo and redo, and a whole replace-all. */
const EDIT_EMITTERS = [
	'src/lib/editor-actions/commit/history.ts',
	'src/lib/editor-actions/commit/undo-controller.ts',
	'src/lib/editor-actions/leaf-write.ts',
	'src/lib/editor-actions/search-replace.ts'
];

const INPUT_EMITTER = 'src/lib/editor-actions/leaf-write.ts';

const EMITS_EDIT = /\bemit\(\s*['"]edit['"]/;

/** Either declaration shape: an OpDescriptor's `kind`, or an EditEvent's `op`. */
const DECLARES_INPUT_OP = /\b(?:kind|op)\s*:\s*'input'/g;

function editEmitters(sources: SourceFile[]): string[] {
	return sources.filter((f) => EMITS_EDIT.test(f.code)).map((f) => f.relPath);
}

function inputOpEmitters(sources: SourceFile[]): string[] {
	return sources.filter((f) => f.code.match(DECLARES_INPUT_OP)).map((f) => f.relPath);
}

describe('G4.107 only a write emits an edit event', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no file but the writes emits `edit`', () => {
		expect(editEmitters(sources).sort()).toEqual(EDIT_EMITTERS);
	});

	it('no site outside the in-place leaf write declares an input op', () => {
		expect(inputOpEmitters(sources)).toEqual([INPUT_EMITTER]);
	});

	it('the in-place leaf write declares it exactly once (a second op in the same file still fails)', () => {
		const write = sources.find((f) => f.relPath === INPUT_EMITTER);
		expect(write, `allowed emitter not found: ${INPUT_EMITTER}`).toBeDefined();
		expect(write!.code.match(DECLARES_INPUT_OP)).toHaveLength(1);
	});
});

describe('edit emitter scans: matcher self-tests', () => {
	const scanInput = (src: string) => inputOpEmitters([{ relPath: 'x.ts', text: src, code: src }]);
	const scanEdit = (src: string) => editEmitters([sourceFile('x.ts', src)]);

	it('catches an edit emit, and leaves another event and a subscription alone', () => {
		expect(scanEdit("deps.events.emit('edit', event)")).toEqual(['x.ts']);
		expect(scanEdit('events.emit(\n\t"edit",\n\tevent\n)')).toEqual(['x.ts']);
		expect(scanEdit("events.emit('error', report)")).toEqual([]);
		expect(scanEdit("events.on('edit', handler)")).toEqual([]);
	});

	it('catches both input declaration shapes', () => {
		expect(scanInput("op: { kind: 'input', detail: { byteLength: 1 } }")).toEqual(['x.ts']);
		expect(scanInput("events.emit('edit', { op: 'input', path, timestamp })")).toEqual(['x.ts']);
	});

	it('leaves a neighbouring op kind, a consumer read, and an inputType alone', () => {
		expect(scanInput("op: { kind: 'updateContent', detail: { length: 3 } }")).toEqual([]);
		expect(scanInput("if (event.op !== 'input') return true;")).toEqual([]);
		expect(scanInput("if (e.inputType !== 'insertText') return false;")).toEqual([]);
		expect(scanInput('input: { byteLength: number };')).toEqual([]);
	});

	it('ignores a declaration or an emit quoted inside a comment', () => {
		const src = "// op: 'input' means the kind held, emit('edit', e)\nconst held = true;";
		expect(inputOpEmitters([sourceFile('x.ts', src)])).toEqual([]);
		expect(editEmitters([sourceFile('x.ts', src)])).toEqual([]);
	});
});
