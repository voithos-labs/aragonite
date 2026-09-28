// @vitest-environment jsdom
// Miss-analysis: who owns the scroll position was four predicates in four files, each tested on
// its own, so no test asked every writer the same three questions and a new writer answered none.
//
// Every scroll write, driven through the route that makes it, under each owner of the position.
// The expected values are what each route did before it went through the owner.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { installHeaderSlotCompensation } from '../../components/editor-root-geometry';
import { createEditorRects } from '../../editor-rects';
import type { ScrollOwner } from '../../cursor/scroll-owner';
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
}

function fixture(column: Column, opts: { nested?: boolean; scrollTop?: number } = {}): Fixture {
	const live = liveChildren(
		[0, 1, 2, 3, 4, 5].map((i) => makePara(`p${i}\n`)),
		['b0', 'b1', 'b2', 'b3', 'b4', 'b5']
	);
	const scrolled: string[] = [];
	const scope = mountListWindowing({
		oracle: heightsOracle(HEIGHTS, ESTIMATE),
		children: live.children,
		ids: live.ids,
		listHeight: 210,
		source: opts.nested ? 'nested-list' : 'root-list',
		ownerDeps: {
			editorCorrects: () => column !== 'host anchoring holds',
			getBlockElByPath: (path) => {
				const el = document.createElement('div');
				el.scrollIntoView = (o) => scrolled.push(`${JSON.stringify(path)} ${JSON.stringify(o)}`);
				return el;
			}
		}
	});
	scope.port.setScrollTop(opts.scrollTop ?? START);
	if (column === 'a held placement is live') {
		scope.owner.place([HELD], { block: 'nearest', hold: true });
	}
	return { ...scope, live, scrolled };
}

/** b2 measures 30px taller than the table had it, above the block at the viewport's top. */
function measureB2Taller(f: Fixture): void {
	f.windowing.registerChild('b2', {
		readHeight: () => HEIGHTS.b2 + GROWTH,
		applyHeight: (h) => f.windowing.recordMeasuredChild(2, 'b2', h)
	});
	f.windowing.measureChildNow('b2');
}

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

// ── The table ────────────────────────────────────────────────────────────────

interface Row {
	name: string;
	nested?: boolean;
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
		}
	],
	place: [
		{
			name: 'scrollTo on a mounted block',
			run: scrollToB4,
			expect: {
				'host anchoring holds': placedOnB4,
				// The newer placement takes the slot and writes.
				'a held placement is live': placedOnB4,
				free: placedOnB4
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
					expect(f.owner.heldTarget()?.path).toEqual([HELD]);
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
			run: (f) => f.owner.showNearest([2]),
			expect: {
				'host anchoring holds': nearestOnB2,
				'a held placement is live': (f) => {
					nearestOnB2(f);
					// Claims nothing: the held target stays as it was.
					expect(f.owner.heldTarget()?.path).toEqual([HELD]);
				},
				free: nearestOnB2
			}
		}
	]
};

function placedOnB4(f: Fixture): void {
	expect(f.scrolled).toEqual(['[4] {"block":"nearest"}']);
	expect(f.owner.heldTarget()).toEqual({ path: [4], block: 'nearest' });
}

function nearestOnB2(f: Fixture): void {
	expect(f.scrolled).toEqual(['[2] {"block":"nearest","inline":"nearest"}']);
	expect(f.port.scrollTop()).toBe(START);
}

// ── The census ───────────────────────────────────────────────────────────────

/** The owner's members that write no scroll position. */
const NON_WRITES = ['port', 'isInView', 'heldTarget', 'release', 'resolveTargetsWith'] as const;
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
					const f = fixture(column, { nested: row.nested });
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

	it('the header slot stands down while the held block already sits on its target', () => {
		const f = fixture('a held placement is live', { scrollTop: HELD_TOP });
		growHeader(f);
		expect(f.port.scrollTop()).toBe(HELD_TOP);
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
