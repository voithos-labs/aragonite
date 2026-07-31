// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createWidgetPool, type WidgetPoolAdapter } from '$lib/components/blocks/widget-portal';
import type { AnyInlineKind, InlineNode } from '$lib/core/nodes';
import {
	enableInteractionTrace,
	disableInteractionTrace,
	resetInteractionTrace,
	interactionTraceSnapshot
} from '$lib/debug/interaction-trace';

// The pool churn-proofs component widgets under the editor's rebuild-everything-per-keystroke
// render: a pass re-acquires by `${kind} ${source}` key, reusing the live instance unchanged.

const KIND = 'math' as AnyInlineKind;
const at = (start: number, end: number): InlineNode => ({ kind: KIND, start, end }) as InlineNode;

interface FakeHandle {
	id: number;
	el: HTMLSpanElement;
	source: string;
	destroyed: boolean;
}

/** A DOM-backed fake adapter: real spans so offset re-stamping is observable, an id per
 *  instance so adoption is distinguishable from a remount. `failCreate` models a mount-throw. */
function fakeAdapter(failCreate = false): {
	adapter: WidgetPoolAdapter<FakeHandle>;
	created: FakeHandle[];
	destroyed: FakeHandle[];
} {
	let nextId = 0;
	const created: FakeHandle[] = [];
	const destroyed: FakeHandle[] = [];
	const adapter: WidgetPoolAdapter<FakeHandle> = {
		create(_kind, inline, source) {
			if (failCreate) return null;
			const el = document.createElement('span');
			el.dataset.sourceStart = String(inline.start);
			el.dataset.sourceEnd = String(inline.end);
			const handle = { id: nextId++, el, source, destroyed: false };
			created.push(handle);
			return handle;
		},
		destroy(handle) {
			handle.destroyed = true;
			destroyed.push(handle);
		},
		element(handle) {
			return handle.el;
		}
	};
	return { adapter, created, destroyed };
}

describe('createWidgetPool — adoption by key', () => {
	it('reuses the live instance for an unchanged widget across a rebuild pass', () => {
		const { adapter, created } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		const first = pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		pool.beginPass();
		const second = pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		expect(created).toHaveLength(1);
		expect(second).toBe(first);
	});

	it('remounts when the source changes (distinct key)', () => {
		const { adapter, created, destroyed } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		pool.beginPass();
		pool.acquire(KIND, at(0, 6), '$xy$');
		pool.sweep();

		expect(created).toHaveLength(2);
		// The old instance was not adopted this pass, so the sweep destroyed it.
		expect(destroyed.map((h) => h.source)).toEqual(['$x$']);
	});
});

describe('createWidgetPool — multiset', () => {
	it('two identical sources in one pass adopt distinct instances', () => {
		const { adapter, created } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		const a = pool.acquire(KIND, at(0, 5), '$x$');
		const b = pool.acquire(KIND, at(6, 11), '$x$');
		pool.sweep();

		expect(created).toHaveLength(2);
		expect(a).not.toBe(b);
	});

	it('adopts the oldest un-adopted instance first', () => {
		const { adapter } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		const older = pool.acquire(KIND, at(0, 5), '$x$');
		const newer = pool.acquire(KIND, at(6, 11), '$x$');
		pool.sweep();

		// Next pass acquires one instance of the key: it must reuse the older one.
		pool.beginPass();
		const reused = pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		expect(reused).toBe(older);
		expect(reused).not.toBe(newer);
	});
});

describe('createWidgetPool — sweep', () => {
	it('destroys every instance not adopted in the pass, keeps survivors for the next', () => {
		const { adapter, created, destroyed } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		const keep = pool.acquire(KIND, at(0, 5), '$keep$');
		pool.acquire(KIND, at(6, 12), '$drop$');
		pool.sweep();

		pool.beginPass();
		const stillKeep = pool.acquire(KIND, at(0, 5), '$keep$');
		pool.sweep();

		expect(destroyed.map((h) => h.source)).toEqual(['$drop$']);
		expect(stillKeep).toBe(keep);
		expect(created).toHaveLength(2);
	});
});

describe('createWidgetPool — dispose', () => {
	it('destroys every live instance', () => {
		const { adapter, created, destroyed } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$a$');
		pool.acquire(KIND, at(6, 11), '$b$');
		pool.sweep();

		pool.dispose();

		expect(destroyed).toHaveLength(created.length);
		expect(created.every((h) => h.destroyed)).toBe(true);
	});
});

describe('createWidgetPool — adoption re-stamps offsets', () => {
	it('re-stamps data-source-start/-end to the new offsets on reuse', () => {
		const { adapter, created } = fakeAdapter();
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		// Text inserted before the widget shifts its offsets; source is unchanged, so
		// the instance is reused but its wrapper offsets must track the new position.
		pool.beginPass();
		const reused = pool.acquire(KIND, at(3, 8), '$x$');
		pool.sweep();

		expect(created).toHaveLength(1);
		expect(reused!.dataset.sourceStart).toBe('3');
		expect(reused!.dataset.sourceEnd).toBe('8');
	});
});

describe('createWidgetPool — empty pass sweeps survivors', () => {
	it('a pass that acquires nothing destroys the prior survivor (prose→non-prose cleanup)', () => {
		const { adapter, destroyed } = fakeAdapter();
		const pool = createWidgetPool(adapter);
		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		// The block turned non-prose: a bracketed pass acquires nothing, so the survivor
		// is swept instead of lingering until dispose.
		pool.beginPass();
		pool.sweep();
		expect(destroyed).toHaveLength(1);
	});
});

describe('createWidgetPool — create failure', () => {
	it('returns null and tracks nothing when the adapter cannot build the widget', () => {
		const { adapter, created } = fakeAdapter(true);
		const pool = createWidgetPool(adapter);

		pool.beginPass();
		const el = pool.acquire(KIND, at(0, 5), '$x$');
		pool.sweep();

		expect(el).toBeNull();
		expect(created).toHaveLength(0);
		// A later pass re-attempts rather than serving a phantom cached failure.
		pool.beginPass();
		expect(pool.acquire(KIND, at(0, 5), '$x$')).toBeNull();
		pool.sweep();
	});
});

describe('createWidgetPool — interaction-trace pass record', () => {
	afterEach(() => {
		disableInteractionTrace();
		resetInteractionTrace();
	});

	it('records one pass entry per sweep carrying adopt/build/destroy counts', () => {
		const { adapter } = fakeAdapter();
		const pool = createWidgetPool(adapter);
		resetInteractionTrace();
		enableInteractionTrace();

		// Pass 1: two fresh builds, nothing adopted or destroyed.
		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$a$');
		pool.acquire(KIND, at(6, 11), '$b$');
		pool.sweep();

		// Pass 2: adopt $a$, let $b$ fall out (destroyed).
		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$a$');
		pool.sweep();

		const passes = interactionTraceSnapshot().filter((e) => e.site === 'widget-pool');
		expect(passes.map((e) => e.detail)).toEqual([
			{ adopt: 0, build: 2, destroyed: 0 },
			{ adopt: 1, build: 0, destroyed: 1 }
		]);
	});

	it('records nothing while the trace is disabled', () => {
		const { adapter } = fakeAdapter();
		const pool = createWidgetPool(adapter);
		resetInteractionTrace();
		pool.beginPass();
		pool.acquire(KIND, at(0, 5), '$a$');
		pool.sweep();
		expect(interactionTraceSnapshot()).toHaveLength(0);
	});
});
