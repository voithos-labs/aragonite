/**
 * An `input` edit event means "this commit held the block's kind" — a premise the LRD
 * signature-epoch gate (`components/lrd-map-gate.ts`) reads and cannot verify, since it
 * runs post-commit. It holds only while exactly one site emits `input`. Both declaration
 * shapes are scanned, so emitter N+1 fails whichever it reaches for; an op kind assembled
 * from a variable has no literal to match, and `test/lrd-map-gate.test.ts` is the
 * outcome-level belt for that.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** The debounced typing flush: the one site whose `input` is kind-stable by construction. */
const SANCTIONED_EMITTER = 'src/lib/editor-actions/commit/undo-controller.ts';

/** Either declaration shape: an OpDescriptor's `kind`, or an EditEvent's `op`. */
const DECLARES_INPUT_OP = /\b(?:kind|op)\s*:\s*'input'/g;

function inputOpEmitters(sources: SourceFile[]): string[] {
	return sources.filter((f) => f.code.match(DECLARES_INPUT_OP)).map((f) => f.relPath);
}

describe("input-op kind stability — only the debounced flush emits op:'input'", () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no site outside the debounced typing flush declares an input op', () => {
		expect(inputOpEmitters(sources)).toEqual([SANCTIONED_EMITTER]);
	});

	it('the flush declares it exactly once (a second op in the same file still fails)', () => {
		const flush = sources.find((f) => f.relPath === SANCTIONED_EMITTER);
		expect(flush, `sanctioned emitter not found: ${SANCTIONED_EMITTER}`).toBeDefined();
		expect(flush!.code.match(DECLARES_INPUT_OP)).toHaveLength(1);
	});
});

describe('input-op scan — matcher self-tests', () => {
	const scan = (src: string) => inputOpEmitters([{ relPath: 'x.ts', text: src, code: src }]);

	it('catches both declaration shapes', () => {
		expect(scan("op: { kind: 'input', detail: { byteLength: 1 } }")).toEqual(['x.ts']);
		expect(scan("events.emit('edit', { op: 'input', path, timestamp })")).toEqual(['x.ts']);
	});

	it('leaves a neighbouring op kind, a consumer read, and an inputType alone', () => {
		expect(scan("op: { kind: 'updateContent', detail: { length: 3 } }")).toEqual([]);
		expect(scan("if (event.op !== 'input') return true;")).toEqual([]);
		expect(scan("if (e.inputType !== 'insertText') return false;")).toEqual([]);
		expect(scan('input: { byteLength: number };')).toEqual([]);
	});

	it('ignores a declaration quoted inside a comment', () => {
		const src = "// op: 'input' means the kind held\nconst held = true;";
		expect(inputOpEmitters([{ relPath: 'x.ts', text: src, code: stripComments(src) }])).toEqual([]);
	});
});
