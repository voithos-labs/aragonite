// @vitest-environment jsdom
//
// A cross-block endpoint inside a kind with no character positions must carry 0 or
// displayLength(raw) — anything between makes every byte consumer slice a whole block in half.
import { describe, it, expect, afterEach } from 'vitest';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { collectCrossBlockText } from '$lib/selection/clipboard-text';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import type { Document } from '$lib/core/nodes';

const DIAGRAM = '```mermaid\ngraph TD\n```\n';
const DIAGRAM_END = 23;
const MERMAID_DOC = `Above text\n\n${DIAGRAM}\ntail text\n`;
const BREAK_DOC = 'Above text\n\n---\n\ntail text\n';

function stateOver(doc: Document) {
	return createSelectionState({ getDoc: () => doc });
}

function mermaidDoc(): Document {
	registerMermaidKind();
	return parse(MERMAID_DOC);
}

function copySelected(doc: Document, s: ReturnType<typeof stateOver>): string {
	return collectCrossBlockText(doc, s.start!, s.end!);
}

function deleteSelected(doc: Document, s: ReturnType<typeof stateOver>): string {
	return serialize(rangeDelete(doc, s.start!, s.end!, createSharingState(), undefined).newDoc);
}

afterEach(() => resetPluginPlatformForTests());

describe('cross-block endpoints inside a whole-block kind', () => {
	it('snaps a range END to the unit end, so the copy carries the diagram whole', () => {
		const doc = mermaidDoc();
		const s = stateOver(doc);

		// The offset a character hit-test over the rendered SVG and its toolbar mints.
		s.enterCrossBlock({ path: [0], offset: 6 }, { path: [1], offset: 12 });

		expect(s.end).toEqual({ path: [1], offset: DIAGRAM_END });
		expect(copySelected(doc, s)).toBe('text\n\n```mermaid\ngraph TD\n```');
	});

	it('snaps a range START to the unit start, so the delete removes the fence whole', () => {
		const doc = mermaidDoc();
		const s = stateOver(doc);

		s.enterCrossBlock({ path: [1], offset: 12 }, { path: [2], offset: 4 });

		expect(s.start).toEqual({ path: [1], offset: 0 });
		const after = deleteSelected(doc, s);
		expect(after).not.toContain('```');
		expect(after).toBe('Above text\n text\n');
	});

	// Document order, not the anchor/focus role: a backward drag ends its anchor AFTER the
	// diagram, and `normalize` reorders the pair only later.
	it('decides the side by document order, not by which endpoint is the anchor', () => {
		const doc = mermaidDoc();
		const s = stateOver(doc);

		s.enterCrossBlock({ path: [2], offset: 4 }, { path: [1], offset: 12 });

		expect(s.start).toEqual({ path: [1], offset: 0 });
		expect(s.end).toEqual({ path: [2], offset: 4 });
	});

	it('leaves an in-set offset alone, so keyboard extension stays byte-identical', () => {
		const doc = mermaidDoc();
		const s = stateOver(doc);

		// Shift+ArrowDown out of the paragraph above lands at offset 0 and selects none of it.
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		expect(s.end).toEqual({ path: [1], offset: 0 });
		expect(copySelected(doc, s)).toBe('Above text\n\n');

		s.extendFocus({ path: [1], offset: DIAGRAM_END });
		expect(s.end).toEqual({ path: [1], offset: DIAGRAM_END });
	});

	it('resolves a drag endpoint that named no character position at all', () => {
		const doc = mermaidDoc();
		const s = stateOver(doc);

		// What the pointer drag mints once the hit-test declines a surface with no characters.
		s.enterCrossBlock({ path: [0], offset: 6 }, { path: [1], wholeBlock: true });

		expect(s.end).toEqual({ path: [1], offset: DIAGRAM_END });
	});

	// Immune today only because it renders no text node for a hit-test to walk; the contract
	// is the kind class, not the accident.
	it('holds for a thematic break, the built-in of the same class', () => {
		const doc = parse(BREAK_DOC);
		const s = stateOver(doc);

		s.enterCrossBlock({ path: [0], offset: 6 }, { path: [1], offset: 1 });

		expect(s.end).toEqual({ path: [1], offset: 3 });
		expect(copySelected(doc, s)).toBe('text\n\n---');
	});
});

describe('cross-block endpoints outside the whole-block class', () => {
	it('clamps a prose endpoint into its own raw instead of snapping it', () => {
		const doc = mermaidDoc();
		const s = stateOver(doc);

		s.enterCrossBlock({ path: [0], offset: 999 }, { path: [2], offset: 4 });

		expect(s.start).toEqual({ path: [0], offset: 10 });
	});

	it('still converts a deep table endpoint to a cell coordinate', () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---\n');
		const s = stateOver(doc);

		s.enterCrossBlock({ path: [0, 1, 1], offset: 1 }, { path: [1], offset: 1 });

		// Row 1, column 1 of a two-column grid; `start` then row-snaps it to the row head.
		expect(s.anchor).toEqual({ path: [0], offset: 3, cellCoordinate: true });
		expect(s.start).toEqual({ path: [0], offset: 2, cellCoordinate: true });
		expect(s.end).toEqual({ path: [1], offset: 3 });
	});
});
