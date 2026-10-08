// @vitest-environment jsdom
// Miss-analysis: each child kind wired its own measuring, and no test ran every kind through every
// trigger, so a table row with no resize trigger (and a list item with only a report) went unseen.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	destroyMountedEditors,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { CstNode } from '#lib/core/nodes.js';
import { getStateForNode } from '#lib/block-lists/state-registry.js';
import { collectEditorSources } from '../invariants/lint/scan-source';

interface Seam {
	getBlockIds(): readonly string[];
	getDocument(): { children: CstNode[] };
}

// Every height the editor's estimator records, from the mount's own first pass on.
const records = vi.hoisted((): [string, number][] => []);
vi.mock('#lib/windowing/height-estimator.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/windowing/height-estimator.js')>();
	return {
		...original,
		createHeightOracle: (...args: Parameters<typeof original.createHeightOracle>) => {
			const oracle = original.createHeightOracle(...args);
			const record = oracle.recordMeasured;
			oracle.recordMeasured = (id, height) => {
				records.push([id, height]);
				record(id, height);
			};
			return oracle;
		}
	};
});

// ── Geometry: every box is 20px unless a row below names it, and resizes fire by hand ──────────

const DEFAULT_HEIGHT = 20;
let heightOf: (el: Element) => number = () => DEFAULT_HEIGHT;
const observed = new Map<Element, ResizeObserverCallback>();
let frames: FrameRequestCallback[] = [];

class ManualResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(el: Element): void {
		observed.set(el, this.callback);
	}
	unobserve(el: Element): void {
		observed.delete(el);
	}
	disconnect(): void {
		for (const [el, callback] of observed) if (callback === this.callback) observed.delete(el);
	}
}

function fireResize(el: Element, height: number): void {
	const entry = { target: el, borderBoxSize: [{ blockSize: height, inlineSize: 500 }] };
	observed.get(el)?.([entry as unknown as ResizeObserverEntry], {} as ResizeObserver);
}

function runFrames(): void {
	const due = frames;
	frames = [];
	for (const frame of due) frame(0);
}

beforeAll(installLayoutStubs);
beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ManualResizeObserver);
	vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
	vi.stubGlobal('cancelAnimationFrame', () => {});
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		return new DOMRect(0, 0, 500, heightOf(this));
	});
});
afterEach(async () => {
	await destroyMountedEditors();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	observed.clear();
	frames = [];
	heightOf = () => DEFAULT_HEIGHT;
});

// ── The kinds that measure into their own list ─────────────────────────────────────────────────

interface Kind {
	name: string;
	/** The component that measures this kind, which must call `useMeasuredChild`. */
	component: string;
	source: string;
	/** Whether `el` is the element whose height the list records for this child. */
	isMeasured(el: Element): boolean;
	childId(mounted: MountedEditor<Seam>): string;
	/** The editable element an edit of this child types into, and what it types. */
	typeInto(mounted: MountedEditor<Seam>): HTMLElement;
	typed: string;
}

const host = (m: MountedEditor, path: number[]) =>
	m.target.querySelector<HTMLElement>(`[data-block-path="${JSON.stringify(path)}"]`)!;
const innerIdOf = (m: MountedEditor<Seam>, topIndex: number, at: number) =>
	getStateForNode(m.instance.__test.getDocument().children[topIndex])!.innerBlockIds[at];

const KINDS: Kind[] = [
	{
		name: 'a block host',
		component: 'src/lib/components/BlockHost.svelte',
		source: 'one\n\ntwo\n',
		isMeasured: (el) => el.getAttribute('data-block-path') === '[1]',
		childId: (m) => m.instance.__test.getBlockIds()[1],
		typeInto: (m) => host(m, [1]).querySelector('.text-editable-block')!,
		typed: 'two!'
	},
	{
		name: 'a list item',
		component: 'src/lib/components/blocks/list/ListItemBlock.svelte',
		source: '- a\n- b\n',
		isMeasured: (el) =>
			el.classList.contains('list-item-block') && !!el.querySelector('[data-block-path="[0,1,0]"]'),
		childId: (m) => innerIdOf(m, 0, 1),
		typeInto: (m) => host(m, [0, 1, 0]).querySelector('.text-editable-block')!,
		typed: 'b!'
	},
	{
		name: 'a table row',
		component: 'src/lib/components/blocks/table/TableRowBlock.svelte',
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
		isMeasured: (el) =>
			el.parentElement?.getAttribute('data-table-row-idx') === '1' &&
			el === el.parentElement.querySelector(':scope > .table-cell'),
		childId: (m) => innerIdOf(m, 0, 1),
		typeInto: (m) =>
			host(m, [0]).querySelector<HTMLElement>('[data-table-row-idx="1"] > .table-cell')!,
		typed: '1!'
	},
	{
		name: "a plugin container's child",
		component: 'src/lib/components/BlockHost.svelte',
		source: '> one\n>\n> two\n',
		isMeasured: (el) => el.getAttribute('data-block-path') === '[0,1]',
		childId: (m) => innerIdOf(m, 0, 1),
		typeInto: (m) => host(m, [0, 1]).querySelector('.text-editable-block')!,
		typed: 'two!'
	}
];

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────

/** Mounts `kind` with its measured element at `height`, and settles its first measure. */
async function mountKind(kind: Kind, height: number, scrollMode: ScrollMode) {
	let current = height;
	heightOf = (el) => (kind.isMeasured(el) ? current : DEFAULT_HEIGHT);
	records.length = 0;
	const mounted = mountEditor<Seam>({ source: kind.source, scrollMode });
	await mounted.settle();
	runFrames();
	return {
		mounted,
		id: kind.childId(mounted),
		/** What was recorded at `current` since the last call, and for whom. */
		take(): [string, number][] {
			const taken = records.filter(([, h]) => h === current);
			records.length = 0;
			return taken;
		},
		resizeTo(next: number): void {
			current = next;
		},
		get measuredEl(): Element {
			return [...mounted.target.querySelectorAll('*')].find(kind.isMeasured)!;
		}
	};
}

const MOUNTED = 137;
const EDITED = 151;
const RESIZED = 163;

type ScrollMode = 'self' | 'host';

describe('every windowed child measures into its own list, under its id, once per trigger', () => {
	for (const [kind, scrollMode] of KINDS.flatMap((k) =>
		(['self', 'host'] as const).map((mode) => [k, mode] as const)
	)) {
		describe(`${kind.name}, scrollMode="${scrollMode}"`, () => {
			it('the batched pass at mount', async () => {
				const child = await mountKind(kind, MOUNTED, scrollMode);
				expect(child.take()).toEqual([[child.id, MOUNTED]]);
			});

			it('an edit that changes its height', async () => {
				const child = await mountKind(kind, MOUNTED, scrollMode);
				child.take();
				child.resizeTo(EDITED);
				const el = kind.typeInto(child.mounted);
				el.textContent = kind.typed;
				el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
				flushSync();
				await child.mounted.settle();
				expect(child.take()).toEqual([[child.id, EDITED]]);
			});

			it('a resize with no edit', async () => {
				const child = await mountKind(kind, MOUNTED, scrollMode);
				child.take();
				child.resizeTo(RESIZED);
				fireResize(child.measuredEl, RESIZED);
				await child.mounted.settle();
				expect(child.take()).toEqual([[child.id, RESIZED]]);
			});
		});
	}

	// Walked at collection, which no test timeout bounds: the source walk is slow on a busy machine.
	const callers = collectEditorSources()
		.filter((file) => /(?<![\w$]|function\s)useMeasuredChild\s*\(/.test(file.code))
		.map((file) => file.relPath);

	it('every component that measures a child has a row', () => {
		expect(callers.sort()).toEqual([...new Set(KINDS.map((kind) => kind.component))].sort());
	});
});
