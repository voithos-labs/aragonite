// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '../../core/parser';
import { createDecorationEngine } from '../../decorations/decoration-state.svelte';
import { configureEditorEnv, resetEditorEnv } from '../../env';
import type { Decoration, DecorationWidgetSpec } from '../../decorations/types';

const doc = parse('one\n\ntwo\n');

// Opaque widget payload — never invoked by the engine, so no DOM is needed.
const stubWidget: DecorationWidgetSpec = { buildDom: () => ({}) as HTMLElement };
const mark = (path: number[]): Decoration => ({ type: 'mark', path, start: 0, end: 1, class: 'x' });
const widget = (path: number[], offset: number): Decoration => ({
	type: 'widget',
	path,
	offset,
	widget: stubWidget
});
const replace = (path: number[], start: number, end: number): Decoration => ({
	type: 'replace',
	path,
	start,
	end
});

function makeEngine(onSourceError?: (name: string, error: unknown) => void) {
	return createDecorationEngine({ getDoc: () => doc, onSourceError });
}

describe('createDecorationEngine', () => {
	it('runs provide on addSource and fills the buckets', () => {
		const engine = makeEngine();
		engine.addSource({ name: 'a', provide: () => [mark([0]), mark([1])] });
		expect(engine.marksForPath([0])).toHaveLength(1);
		expect(engine.marksForPath([1])).toHaveLength(1);
		expect(engine.sourceCount).toBe(1);
	});

	it('throws on a duplicate source name', () => {
		const engine = makeEngine();
		engine.addSource({ name: 'dup', provide: () => [] });
		expect(() => engine.addSource({ name: 'dup', provide: () => [] })).toThrow(/dup/);
	});

	it('invalidate re-runs only that source, synchronously, without bumping the epoch', () => {
		const engine = makeEngine();
		const own: number[] = [];
		const other: number[] = [];
		let runs = 0;
		const handle = engine.addSource({
			name: 's',
			provide: (_doc, ctx) => {
				own.push(ctx.editEpoch);
				return runs++ === 0 ? [mark([0])] : [mark([0]), mark([0])];
			}
		});
		engine.addSource({
			name: 'o',
			provide: (_doc, ctx) => {
				other.push(ctx.editEpoch);
				return [];
			}
		});
		engine.notifyEdit();
		handle.invalidate();
		expect(engine.marksForPath([0])).toHaveLength(2); // reflected before invalidate returned
		expect(own).toEqual([0, 1, 1]); // add@0, notifyEdit@1, invalidate reuses 1 (no bump)
		expect(other).toEqual([0, 1]); // invalidate never touched the sibling
	});

	it('notifyEdit bumps the epoch once per call and every provide receives it', () => {
		const engine = makeEngine();
		const a: number[] = [];
		const b: number[] = [];
		engine.addSource({ name: 'a', provide: (_d, ctx) => (a.push(ctx.editEpoch), []) });
		engine.addSource({ name: 'b', provide: (_d, ctx) => (b.push(ctx.editEpoch), []) });
		engine.notifyEdit();
		engine.notifyEdit();
		expect(a).toEqual([0, 1, 2]);
		expect(b).toEqual([0, 1, 2]);
	});

	// "Republish" is a reactive-graph event, so only a subscribed consumer can observe
	// it — a standalone bucket read recomputes regardless and can't see the skip.
	it('an empty→empty re-run skips the reactive republish; a real change still fires it', () => {
		const engine = makeEngine();
		const aHandle = engine.addSource({ name: 'a', provide: () => [mark([0])] });
		const idle = engine.addSource({ name: 'idle', provide: () => [] });
		let runs = 0;
		const cleanup = $effect.root(() => {
			$effect(() => {
				engine.marksForPath([0]); // subscribes transitively to results
				runs++;
			});
		});
		flushSync();
		const baseline = runs;
		idle.invalidate(); // empty → empty: results untouched, no consumer wakes
		flushSync();
		expect(runs).toBe(baseline);
		aHandle.invalidate(); // nonempty → nonempty: results reassigned, consumer wakes
		flushSync();
		expect(runs).toBe(baseline + 1);
		cleanup();
	});

	it('dispose empties the source and frees its name for re-registration', () => {
		const engine = makeEngine();
		const handle = engine.addSource({ name: 'd', provide: () => [mark([0])] });
		expect(engine.marksForPath([0])).toHaveLength(1);
		handle.dispose();
		expect(engine.marksForPath([0])).toHaveLength(0);
		expect(engine.sourceCount).toBe(0);
		expect(() => engine.addSource({ name: 'd', provide: () => [] })).not.toThrow();
	});

	it('contains a throwing source and preserves siblings', () => {
		const errors: string[] = [];
		const engine = createDecorationEngine({
			getDoc: () => doc,
			onSourceError: (n) => errors.push(n)
		});
		engine.addSource({ name: 'ok', provide: () => [mark([0])] });
		const bad = engine.addSource({
			name: 'bad',
			provide: () => {
				throw new Error('boom');
			}
		});
		expect(errors).toEqual(['bad']);
		expect(engine.marksForPath([0])).toHaveLength(1);
		bad.invalidate();
		expect(errors).toEqual(['bad', 'bad']);
	});

	it('keeps a source’s prior decorations when a later provide throws', () => {
		const errors: string[] = [];
		const engine = makeEngine((n) => errors.push(n));
		let boom = false;
		const handle = engine.addSource({
			name: 's',
			provide: () => {
				if (boom) throw new Error('x');
				return [mark([1])];
			}
		});
		expect(engine.marksForPath([1])).toHaveLength(1);
		boom = true;
		handle.invalidate();
		expect(errors).toEqual(['s']);
		expect(engine.marksForPath([1])).toHaveLength(1); // prior result retained
	});

	it('islandsForPath returns widgets and replaces sorted by raw position, marks excluded', () => {
		const engine = makeEngine();
		engine.addSource({
			name: 'isl',
			provide: () => [widget([0], 5), replace([0], 2, 3), widget([0], 0), mark([0])]
		});
		const islands = engine.islandsForPath([0]);
		const positions = islands.map((i) => (i.dec.type === 'widget' ? i.dec.offset : i.dec.start));
		expect(positions).toEqual([0, 2, 5]);
	});

	it('marksForDescendants reads the ancestor bucket; blockDecorationsForPath returns block decorations', () => {
		const engine = makeEngine();
		engine.addSource({
			name: 'x',
			provide: () => [mark([1, 0]), { type: 'block', path: [2], class: 'b' }]
		});
		expect(engine.marksForDescendants([1])).toHaveLength(1);
		expect(engine.blockDecorationsForPath([2]).map((d) => d.class)).toEqual(['b']);
	});

	// A whole-document replacement arrives as the same notifyEdit a keystroke sends, so
	// nothing from the old document may survive in the buckets afterwards.
	it('a document replacement re-provides every source against the new doc and replaces its bucket', () => {
		let current = parse('one\n\ntwo\n');
		const engine = createDecorationEngine({ getDoc: () => current });
		engine.addSource({ name: 'tail', provide: (d) => [mark([d.children.length - 1])] });
		// Emits only while the document has a second block, so the swap below drives a
		// non-empty → empty run: its bucket must be cleared, not left standing.
		engine.addSource({ name: 'pair', provide: (d) => (d.children.length > 1 ? [mark([1])] : []) });
		expect(engine.marksForPath([1])).toHaveLength(2);

		current = parse('only\n');
		engine.notifyEdit();
		expect(engine.marksForPath([0])).toHaveLength(1); // 'tail' re-aimed at the new last block
		expect(engine.marksForPath([1])).toHaveLength(0); // no mark survives at a path the new doc lacks
	});

	it('sourceCount tracks add and dispose', () => {
		const engine = makeEngine();
		expect(engine.sourceCount).toBe(0);
		const a = engine.addSource({ name: 'a', provide: () => [] });
		engine.addSource({ name: 'b', provide: () => [] });
		expect(engine.sourceCount).toBe(2);
		a.dispose();
		expect(engine.sourceCount).toBe(1);
	});
});

// [1] thematicBreak and [2] fencedCode render no inline pass, so an island targeting
// them never appears — the engine flags that at the source seam rather than silently.
const mixedDoc = parse('para\n\n---\n\n```\ncode\n```\n');

describe('non-prose island dev-warn', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false }); // let devWarn reach console
	});
	afterEach(() => {
		warnSpy.mockRestore();
		resetEditorEnv();
	});

	function makeMixedEngine() {
		return createDecorationEngine({ getDoc: () => mixedDoc });
	}

	it('warns naming the source, kind, and path when a widget island targets a non-prose block', () => {
		makeMixedEngine().addSource({ name: 'w', provide: () => [widget([1], 0)] });
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"source 'w' places a widget island on a non-prose thematicBreak block"
			),
			{ path: [1] }
		);
	});

	it('warns for a replace island on a fenced code block', () => {
		makeMixedEngine().addSource({ name: 'r', provide: () => [replace([2], 0, 1)] });
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('places a replace island on a non-prose fencedCode block'),
			{ path: [2] }
		);
	});

	it('stays silent for an island on a table cell — the cell surface applies islands', () => {
		const tableDoc = parse('| a | b |\n| --- | --- |\n| c | d |\n');
		const engine = createDecorationEngine({ getDoc: () => tableDoc });
		engine.addSource({ name: 'cell', provide: () => [replace([0, 0, 0], 0, 1)] });
		expect(warnSpy).not.toHaveBeenCalled();
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
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('warns once per source+kind, not per island or per re-run', () => {
		const engine = makeMixedEngine();
		const handle = engine.addSource({
			name: 'w',
			provide: () => [widget([1], 0), replace([1], 0, 1)] // two islands, same non-prose kind
		});
		expect(warnSpy).toHaveBeenCalledTimes(1);
		handle.invalidate();
		engine.notifyEdit();
		expect(warnSpy).toHaveBeenCalledTimes(1); // subsequent runs stay quiet
	});
});
