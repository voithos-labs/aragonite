// @vitest-environment jsdom
// Miss-analysis: who owns the scroll position was four predicates in four files, each tested on
// its own, so no test asked every writer the same three questions and a new writer answered none.
//
// Every scroll write, driven through the route that makes it, under each owner of the position.
// The expected values are what each route did before it went through the owner.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { installHeaderSlotCompensation } from '../../components/editor-root-geometry';
import { parse } from '../../core/parser';
import { createCaretMemory } from '../../cursor/caret-memory';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { createEditorRects } from '../../editor-rects';
import type { EditorDoc, EditorServices } from '../../editor-keys';
import type { ScrollOwner } from '../../cursor/scroll-owner';
import { refSlotsOver } from '../../reactivity/publish-ref.svelte';
import { createCaretLanding, type RevealPolicy } from '../../selection/caret-landing';
import { scrollFocusBlockIntoView } from '../../selection/keyboard-extend';
import { createSelectionState, type SelectionState } from '../../selection/selection-state.svelte';
import { stubBlockComponent } from '../../testing/headless-actions';
import {
	heightsOracle,
	liveChildren,
	makePara,
	mountListWindowing,
	type MountedListWindowing
} from '../harness/list-windowing.svelte';
import { stubScrollOwner, stubScrollport } from '../harness/stub-scrollport';

const COLUMNS = ['host anchoring holds', 'a held placement is live', 'free'] as const;
type Column = (typeof COLUMNS)[number];

// Offsets b0@0 b1@10 b2@30 b3@60 b4@100 b5@150; b3 sits at the top of the viewport.
const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40, b4: 50, b5: 60 };
const OFFSETS = [0, 10, 30, 60, 100, 150];
const START = 60;
// A block the table has no measurement for takes the estimate.
const ESTIMATE = 10;
const GROWTH = 30;
// The held column holds b5, off the top of the viewport, so a re-place is told apart from a delta.
const HELD = 5;
const HELD_TOP = 150;
// Where a view swap's short layout left the scroll container.
const CLAMPED = 25;

interface Fixture extends MountedListWindowing {
	live: { children: ReturnType<typeof makePara>[]; ids: string[] };
	/** What each `scrollIntoView` was asked, by path. */
	scrolled: string[];
	blockEl: (path: number[]) => HTMLElement;
}

function fixture(column: Column, opts: { nested?: boolean; scrollTop?: number } = {}): Fixture {
	const live = liveChildren(
		[0, 1, 2, 3, 4, 5].map((i) => makePara(`p${i}\n`)),
		['b0', 'b1', 'b2', 'b3', 'b4', 'b5']
	);
	const scrolled: string[] = [];
	const box: { port?: MountedListWindowing['port'] } = {};
	const blockEl = (path: number[]) => {
		const el = document.createElement('div');
		// Where the block sits on screen now, so a placement records a real landing.
		const top = () => (OFFSETS[path[0]] ?? 0) - (box.port?.scrollTop() ?? 0);
		el.getBoundingClientRect = () => ({ top: top(), bottom: top() + 10 }) as DOMRect;
		el.scrollIntoView = (o) => scrolled.push(`${JSON.stringify(path)} ${JSON.stringify(o)}`);
		return el;
	};
	const scope = mountListWindowing({
		oracle: heightsOracle(HEIGHTS, ESTIMATE),
		children: live.children,
		ids: live.ids,
		listHeight: 210,
		source: opts.nested ? 'nested-list' : 'root-list',
		ownerDeps: {
			editorCorrects: () => column !== 'host anchoring holds',
			getBlockElByPath: blockEl
		}
	});
	box.port = scope.port;
	scope.port.setScrollTop(opts.scrollTop ?? START);
	if (column === 'a held placement is live') {
		scope.owner.place([HELD], { block: 'nearest', hold: true });
	}
	return { ...scope, live, scrolled, blockEl };
}

/** Block `index` measures 30px taller than the table had it. */
function measureTaller(f: Fixture, index: number): void {
	const id = `b${index}`;
	f.windowing.registerChild(id, {
		readHeight: () => HEIGHTS[id] + GROWTH,
		applyHeight: (h) => f.windowing.recordMeasuredChild(index, id, h)
	});
	f.windowing.measureChildNow(id);
}

/** b2 grows, above the block at the viewport's top. */
const measureB2Taller = (f: Fixture) => measureTaller(f, 2);

/** The held block at the viewport's top grows, so holding it writes nothing, while a placed target
 *  below it moves by the growth. */
const measureTopBlockTaller = (f: Fixture) => measureTaller(f, 3);

// ── Routes that only a browser drives ────────────────────────────────────────

class FakeResizeObserver {
	static last: FakeResizeObserver | null = null;
	constructor(private callback: ResizeObserverCallback) {
		FakeResizeObserver.last = this;
	}
	observe(): void {}
	disconnect(): void {}
	grow(to: number): void {
		const entries = [{ borderBoxSize: [{ blockSize: to, inlineSize: 0 }] }];
		this.callback(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
	}
}

beforeEach(() => {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
	delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

function growHeader(f: Fixture): void {
	const el = document.createElement('div');
	el.getBoundingClientRect = () => ({ height: 40 }) as DOMRect;
	const uninstall = installHeaderSlotCompensation({ el, scroll: f.owner });
	FakeResizeObserver.last!.grow(40 + GROWTH);
	uninstall();
}

/** A cross-block range whose moving end sits at the start of `path`. */
const focusOn = (path: number[]) => ({ focus: { path, offset: 0 } }) as unknown as SelectionState;

function scrollToB4(f: Fixture): Promise<boolean> {
	const rects = createEditorRects({
		getBlockElByPath: () => null,
		getBlockComponent: () => null,
		revealPath: async () => {},
		getEditorRoot: () => null,
		scroll: f.owner,
		isCrossBlock: () => false,
		isHostChrome: () => false,
		landCaretAt: async () => true
	});
	return rects.scrollTo([4]);
}

/** The caret landing on b4 through its own reveal policy, over mounted headless blocks. */
async function landOnB4(f: Fixture, reveal: RevealPolicy): Promise<void> {
	const doc = parse(f.live.children.map((c) => c.raw).join('\n'));
	const refs = f.live.children.map(() => stubBlockComponent());
	const landing = createCaretLanding({
		getDoc: () => doc,
		root: {
			count: () => refs.length,
			refs: refSlotsOver(refs),
			windowing: { revealChild: async () => {}, isInWindow: () => true }
		},
		selectionState: createSelectionState({ getDoc: () => doc }),
		caretMemory: createCaretMemory(),
		getBlockElByPath: f.blockEl,
		getEditorRoot: () => null,
		scroll: f.owner
	});
	await landing.land({ path: docPathFrom([4]), offset: 0 }, { reveal });
}

/** The block the owner keeps still on the next change, read by growing the block at the
 *  viewport's top: a placement still aimed at b5, with no landing recorded, sends it to b5's top. */
function stillHoldsB5(f: Fixture): void {
	measureTopBlockTaller(f);
	expect(f.port.scrollTop()).toBe(HELD_TOP + GROWTH);
}

// ── The table ────────────────────────────────────────────────────────────────

interface Row {
	name: string;
	nested?: boolean;
	/** Where the scroll starts, when not at b3's top. */
	scrollTop?: number;
	run(f: Fixture): Promise<unknown> | void;
	expect: Record<Column, (f: Fixture) => void>;
}

const scrollTopIs = (top: number) => (f: Fixture) => expect(f.port.scrollTop()).toBe(top);

const ROWS: Record<keyof ScrollWrites, Row[]> = {
	compensate: [
		{
			name: 'a root list measuring a block above the viewport',
			run: measureB2Taller,
			expect: {
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': scrollTopIs(HELD_TOP + GROWTH),
				free: scrollTopIs(START + GROWTH)
			}
		},
		{
			name: 'a nested list measuring a block above the viewport',
			nested: true,
			run: measureB2Taller,
			expect: {
				'host anchoring holds': scrollTopIs(START),
				// The root list re-places once the nested list's new height reaches it.
				'a held placement is live': scrollTopIs(START + GROWTH),
				free: scrollTopIs(START + GROWTH)
			}
		},
		{
			name: 'a root list rebuild adding a block above the viewport',
			run: (f) => {
				f.live.children.splice(2, 0, makePara('new\n'));
				f.live.ids.splice(2, 0, 'bx');
				flushSync();
			},
			expect: {
				'host anchoring holds': scrollTopIs(START),
				// A placement holds a path, so [5] now names b4, pushed down to 110.
				'a held placement is live': scrollTopIs(
					HEIGHTS.b0 + HEIGHTS.b1 + ESTIMATE + HEIGHTS.b2 + HEIGHTS.b3
				),
				free: scrollTopIs(START + ESTIMATE)
			}
		},
		{
			name: 'a subtotal a nested list reports to the root list',
			run: (f) => f.windowing.setChildSubtotal(2, HEIGHTS.b2 + GROWTH),
			expect: {
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': scrollTopIs(HELD_TOP + GROWTH),
				free: scrollTopIs(START)
			}
		},
		{
			name: 'the header slot growing, the held block off its target',
			run: growHeader,
			expect: {
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': scrollTopIs(START + GROWTH),
				free: scrollTopIs(START + GROWTH)
			}
		},
		{
			name: 'the header slot growing, the held block on its target',
			scrollTop: HELD_TOP,
			run: growHeader,
			expect: {
				'host anchoring holds': scrollTopIs(HELD_TOP),
				'a held placement is live': scrollTopIs(HELD_TOP),
				free: scrollTopIs(HELD_TOP + GROWTH)
			}
		}
	],
	// Each placement below lands b4 40px under the viewport's top; b3 then grows, which a
	// placement holding b4 answers with the growth and the plain correction with nothing.
	place: [
		{
			name: 'scrollTo on a mounted block',
			run: async (f) => {
				await scrollToB4(f);
				measureTopBlockTaller(f);
			},
			expect: {
				'host anchoring holds': placedOnB4(START),
				// The newer placement takes the slot and writes.
				'a held placement is live': placedOnB4(START + GROWTH),
				free: placedOnB4(START + GROWTH)
			}
		},
		{
			name: 'a caret landing brought into view',
			run: async (f) => {
				await landOnB4(f, 'into-view');
				measureTopBlockTaller(f);
			},
			expect: {
				'host anchoring holds': placedOnB4(START),
				// Holds nothing once it lands, so the plain correction keeps b3 still.
				'a held placement is live': placedOnB4(START),
				free: placedOnB4(START)
			}
		},
		{
			name: 'a navigation landing, held where it landed',
			run: async (f) => {
				await landOnB4(f, 'into-view-held');
				measureTopBlockTaller(f);
			},
			expect: {
				'host anchoring holds': placedOnB4(START),
				'a held placement is live': placedOnB4(START + GROWTH),
				free: placedOnB4(START + GROWTH)
			}
		}
	],
	scrollToMount: [
		{
			name: 'a descent mounting b1',
			run: (f) => f.windowing.revealChild(1),
			expect: {
				'host anchoring holds': scrollTopIs(HEIGHTS.b0),
				'a held placement is live': (f) => {
					scrollTopIs(HEIGHTS.b0)(f);
					stillHoldsB5(f);
				},
				free: scrollTopIs(HEIGHTS.b0)
			}
		}
	],
	keep: [
		{
			name: 'a view swap the browser clamped',
			run: async (f) => {
				const restore = f.owner.keep();
				f.port.setScrollTop(CLAMPED);
				await restore();
			},
			expect: {
				// Native anchoring can't undo a max-scroll clamp.
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': scrollTopIs(CLAMPED),
				free: scrollTopIs(START)
			}
		}
	],
	showNearest: [
		{
			name: 'a keyboard extension reaching the next block',
			run: (f) => scrollFocusBlockIntoView(focusOn([2]), f.owner),
			expect: {
				'host anchoring holds': nearestOnB2,
				'a held placement is live': (f) => {
					nearestOnB2(f);
					// Claims nothing: the held target stays as it was.
					stillHoldsB5(f);
				},
				free: nearestOnB2
			}
		}
	]
};

function placedOnB4(top: number): (f: Fixture) => void {
	return (f) => {
		expect(f.scrolled).toEqual(['[4] {"block":"nearest"}']);
		expect(f.port.scrollTop()).toBe(top);
	};
}

function nearestOnB2(f: Fixture): void {
	expect(f.scrolled).toEqual(['[2] {"block":"nearest","inline":"nearest"}']);
	expect(f.port.scrollTop()).toBe(START);
}

// ── The census ───────────────────────────────────────────────────────────────

/** The owner's members that write no scroll position. */
const NON_WRITES = ['port', 'isInView', 'release', 'resolveTargetsWith'] as const;
type ScrollWrites = Omit<ScrollOwner, (typeof NON_WRITES)[number]>;

describe('scroll owner: every write has a row under every owner of the position', () => {
	it('each member is a write with rows or a declared read', () => {
		const f = fixture('free');
		const members = Object.keys(f.owner).sort();
		f.cleanup();
		expect(members).toEqual([...Object.keys(ROWS), ...NON_WRITES].sort());
		for (const rows of Object.values(ROWS)) expect(rows.length).toBeGreaterThan(0);
	});

	for (const [write, rows] of Object.entries(ROWS)) {
		for (const row of rows) {
			for (const column of COLUMNS) {
				it(`${write}: ${row.name} / ${column}`, async () => {
					const f = fixture(column, { nested: row.nested, scrollTop: row.scrollTop });
					await row.run(f);
					row.expect[column](f);
					f.cleanup();
				});
			}
		}
	}
});

// ── The edges a column hides ─────────────────────────────────────────────────

describe('scroll owner: the edges', () => {
	it('host anchoring wins over a held placement', () => {
		const f = fixture('host anchoring holds');
		f.owner.place([HELD], { block: 'nearest', hold: true });
		measureB2Taller(f);
		expect(f.port.scrollTop()).toBe(START);
		f.cleanup();
	});

	// Miss-analysis: every held-target test put its target at the viewport's top, where re-placing
	// at the top and keeping it where it landed agree, so a slash pick jumping the page passed them.
	it('a held target mid-viewport stays where it landed when a block below it measures', async () => {
		const f = fixture('free', { scrollTop: 40 });
		// b4's top is 100, so the scroll leaves it 60px below the viewport's top.
		await f.owner.place([4], { block: 'nearest', hold: true }).scroll();
		measureTaller(f, 5);
		expect(f.port.scrollTop()).toBe(40);
		f.cleanup();
	});

	it('a held target the root list cannot place falls through to the held block', () => {
		const f = fixture('free');
		f.owner.place([9], { block: 'nearest', hold: true });
		measureB2Taller(f);
		expect(f.port.scrollTop()).toBe(START + GROWTH);
		f.cleanup();
	});

	it('a re-place re-reads the root window and centres on the target’s own height', () => {
		const port = stubScrollport({ viewportHeight: 500 });
		const owner = stubScrollOwner(port);
		const syncScrollTop = vi.fn();
		owner.resolveTargetsWith({ resolve: () => ({ top: 300, height: 20 }), syncScrollTop });
		owner.place([4], { block: 'center', hold: true });
		owner.compensate(
			'root-list',
			() => {},
			() => 0
		);
		expect(port.scrollTop()).toBe(300 - (500 - 20) / 2);
		expect(syncScrollTop).toHaveBeenCalledOnce();
	});

	it('keep writes nothing when the swap moved nothing', async () => {
		const f = fixture('free');
		const write = vi.spyOn(f.port, 'setScrollTop');
		await f.owner.keep()();
		expect(write).not.toHaveBeenCalled();
		f.cleanup();
	});

	it('the port is opened once, and not before the root mounts', async () => {
		let host: HTMLElement | null = null;
		const owner = stubScrollOwner(stubScrollport({ viewportHeight: 500 }), {
			getScrollHost: () => host
		});
		expect(owner.port()).toBeNull();
		await expect(owner.keep()()).resolves.toBeUndefined();
		let ran = false;
		owner.compensate(
			'root-list',
			() => (ran = true),
			(run) => {
				run();
				return 10;
			}
		);
		expect(ran).toBe(true);
		host = document.createElement('div');
		expect(owner.port()).not.toBeNull();
		expect(owner.port()).toBe(owner.port());
	});
});

describe('scroll owner: the port every other module holds', () => {
	it('has no write method, so a write outside the owner fails to type-check', () => {
		const tryToWrite = (doc: EditorDoc, services: EditorServices) => {
			// @ts-expect-error `EditorDoc.scrollport` reads; widening it to the writer fails `npm run check`.
			doc.scrollport()?.setScrollTop(0);
			// @ts-expect-error the relative write is the owner's too.
			doc.scrollport()?.scrollBy(1);
			// @ts-expect-error the owner hands out the same read-only view.
			services.scrollOwner.port()?.setScrollTop(0);
		};
		expect(tryToWrite).toBeTypeOf('function');
	});
});
