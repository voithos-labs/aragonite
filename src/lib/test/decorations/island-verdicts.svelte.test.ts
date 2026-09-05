// @vitest-environment jsdom
//
// The engine's verdict on an island it can see will never render. It belongs at the source
// seam and nowhere downstream: only here are the decorations held beside the document they
// were derived from, so only here does "unrenderable" mean the author placed it wrong.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { createDecorationEngine } from '../../decorations/decoration-state.svelte';
import { takeDevWarns } from '../support/warn-gate';
import { mark, replace, widget } from './fixtures/decorations';

// [1] thematicBreak and [2] fencedCode render no inline pass, so an island targeting
// them never appears — the engine flags that at the source seam rather than silently.
const mixedDoc = parse('para\n\n---\n\n```\ncode\n```\n');

describe('non-prose island dev-warn', () => {
	function makeMixedEngine() {
		return createDecorationEngine({ getDoc: () => mixedDoc });
	}

	it('warns naming the source, kind, and path when a widget island targets a non-prose block', () => {
		makeMixedEngine().addSource({ name: 'w', provide: () => [widget([1], 0)] });
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain(
			"source 'w' places a widget island on a non-prose thematicBreak block"
		);
		expect(fires[0].details).toEqual({ path: [1] });
	});

	it('warns for a replace island on a fenced code block', () => {
		makeMixedEngine().addSource({ name: 'r', provide: () => [replace([2], 0, 1)] });
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('places a replace island on a non-prose fencedCode block');
		expect(fires[0].details).toEqual({ path: [2] });
	});

	it('stays silent for an island on a table cell — the cell surface applies islands', () => {
		const tableDoc = parse('| a | b |\n| --- | --- |\n| c | d |\n');
		const engine = createDecorationEngine({ getDoc: () => tableDoc });
		engine.addSource({ name: 'cell', provide: () => [replace([0, 0, 0], 0, 1)] });
		expect(takeDevWarns()).toEqual([]);
	});

	it('stays silent for islands on a prose block and for mark/block decorations anywhere', () => {
		makeMixedEngine().addSource({
			name: 'ok',
			provide: () => [
				widget([0], 0),
				replace([0], 0, 1),
				mark([1]),
				{ type: 'block', path: [2], class: 'b' }
			]
		});
		expect(takeDevWarns()).toEqual([]);
	});

	it('warns once per source+kind, not per island or per re-run', () => {
		const engine = makeMixedEngine();
		const handle = engine.addSource({
			name: 'w',
			provide: () => [widget([1], 0), replace([1], 0, 1)] // two islands, same non-prose kind
		});
		expect(takeDevWarns()).toHaveLength(1);
		handle.invalidate();
		engine.notifyEdit();
		expect(takeDevWarns(), 'subsequent runs stay quiet').toEqual([]);
	});
});

// Miss-analysis: the render pass owned the out-of-range verdict, and no test paired a source
// with the document it read — so a decoration one edit stale was indistinguishable from one
// the author placed wrong, and the engine blamed the author for its own deferred re-run.
describe('out-of-range island dev-warn', () => {
	// 'one\n' and 'two\n': content length 3 apiece.
	const doc = parse('one\n\ntwo\n');
	function makeSized() {
		return createDecorationEngine({ getDoc: () => doc });
	}

	it('warns naming the source and the block content bound when a replace range overruns it', () => {
		makeSized().addSource({ name: 'r', provide: () => [replace([0], 1, 9)] });
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain("source 'r' places a replace island at 1..9");
		expect(fires[0].message).toContain("block's content ends at 3");
		expect(fires[0].details).toEqual({ path: [0] });
	});

	it('warns for a widget offset past the content, and for an empty or inverted replace range', () => {
		for (const dec of [widget([0], 4), replace([0], 2, 2), replace([0], 3, 1)]) {
			makeSized().addSource({ name: 's', provide: () => [dec] });
			expect(takeDevWarns(), JSON.stringify(dec)).toHaveLength(1);
		}
	});

	it('stays silent at the exact content bounds', () => {
		makeSized().addSource({ name: 'edge', provide: () => [widget([0], 3), replace([1], 0, 3)] });
		expect(takeDevWarns()).toEqual([]);
	});

	// The trailing newline is not content: a range covering it is out of bounds, so the
	// engine's answer must be the content range, never `raw.length`.
	it('measures against the content range, not the raw bytes', () => {
		makeSized().addSource({ name: 'nl', provide: () => [replace([0], 0, 4)] });
		expect(takeDevWarns()).toHaveLength(1);
	});

	// A setext heading's underline is raw the render path never paints, so its content
	// range stops short of the block's own display length.
	it('respects a kind whose content range stops before the raw ends', () => {
		const setext = parse('head\n====\n');
		const engine = createDecorationEngine({ getDoc: () => setext });
		engine.addSource({ name: 'setext', provide: () => [replace([0], 0, 6)] });
		expect(takeDevWarns()).toHaveLength(1);
	});

	it('warns once per source, not per re-run', () => {
		const engine = makeSized();
		const handle = engine.addSource({ name: 'r', provide: () => [replace([0], 1, 9)] });
		expect(takeDevWarns()).toHaveLength(1);
		handle.invalidate();
		engine.notifyEdit();
		expect(takeDevWarns(), 'subsequent runs stay quiet').toEqual([]);
	});

	// The two defects are distinct verdicts: sharing a dedupe slot would swallow whichever
	// arrived second.
	it('reports a range defect even after the same source reported a non-prose one', () => {
		const engine = createDecorationEngine({ getDoc: () => mixedDoc });
		engine.addSource({ name: 'both', provide: () => [widget([1], 0), replace([0], 0, 99)] });
		expect(takeDevWarns()).toHaveLength(2);
	});
});
