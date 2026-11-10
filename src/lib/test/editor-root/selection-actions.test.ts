// @vitest-environment jsdom
// What the selection toolbar asks the actions on every selection change: nothing at a bare caret,
// the selection's bytes only for a range an action could take, and no layout read for a capture
// until its box is read.
// Miss-analysis: every action row asked once per menu open, never what a caret move costs.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createSelectionActions } from '#lib/components/editor-root/selection-actions.js';
import type { InternalDraft } from '#lib/editor-actions/commit/draft-registry.svelte.js';
import type { Editor } from '#lib/schema/plugin-unit.js';
import type { SelectionAction } from '#lib/schema/selection-action.js';

const doc = parse('abc def ghi\n');

type Range = { from: number; to: number };

function actionsOver(selection: Range, action: SelectionAction | null) {
	const asked = { captures: 0, rects: 0, selections: 0 };
	const counted: SelectionAction | null = action && {
		...action,
		capture: (editor, over) => (asked.captures++, action.capture?.(editor, over) ?? over)
	};
	const actions = createSelectionActions({
		actions: () => (counted ? [{ plugin: 'acts', action: counted }] : []),
		editorFor: () => ({}) as Editor,
		getDoc: () => doc,
		source: () => serialize(doc),
		selection: () => (asked.selections++, selection),
		hasRange: () => selection.from < selection.to,
		editable: () => true,
		rangeRects: () => (asked.rects++, [new DOMRect(10, 20, 30, 16)]),
		edit: () => ({}) as InternalDraft,
		report: () => {}
	});
	return { actions, asked };
}

const at = (from: number, to = from): Range => ({ from, to });

const shout: SelectionAction = { label: 'Shout', rows: () => [] };

describe("the toolbar's captures", () => {
	it('asks no action anything at a bare caret', () => {
		const { actions, asked } = actionsOver(at(5), shout);
		expect(actions.wholeSelection()).toEqual([]);
		expect(asked).toMatchObject({ captures: 0, selections: 0 });
	});

	it('measures no selection with no action listed, for the toolbar or the right-click menu', () => {
		const { actions, asked } = actionsOver(at(4, 7), null);
		expect(actions.wholeSelection()).toEqual([]);
		expect(actions.atSelection()).toEqual([]);
		expect(asked.selections).toBe(0);
	});

	it('keeps only a capture that takes the selection whole', () => {
		const word = { ...shout, capture: () => ({ from: 4, to: 7 }) };
		expect(actionsOver(at(4, 7), word).actions.wholeSelection()).toHaveLength(1);
		expect(actionsOver(at(4, 6), word).actions.wholeSelection()).toEqual([]);
	});

	it('measures the range only when its box is read', () => {
		const { actions, asked } = actionsOver(at(4, 7), shout);
		const [group] = actions.wholeSelection();
		expect(group.captured.text).toBe('def');
		expect(asked.rects).toBe(0);
		expect(group.captured.box).toEqual(new DOMRect(10, 20, 30, 16));
		expect(group.captured.box).toBe(group.captured.box);
		expect(asked.rects).toBe(1);
	});
});
