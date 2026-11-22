// Enter in a long ordered list renumbers every item below it, and Shift+Tab hands a lifted item
// every sibling after it; both write each item before the tree holds it: the page's tree is a
// `$state` proxy, where each read or write is a trap, and such a move pays every trap once per item.
// Miss-analysis: the perf counters count rebuilds, parses and lines, never reads through the tree's
// proxy, so a renumber that spread each item's metadata through it read the same on every counter.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '#lib/test/harness/editor-actions.js';

/* ---- A tree read through a counting proxy ---- */

const RAW = Symbol('raw');

/** Stands in for the page's `$state` tree: reads come back wrapped, and every trap is counted
 *  under its kind and property, an array index as `[i]`. */
function countingTree() {
	const counts = new Map<string, number>();
	const wrapped = new WeakMap<object, object>();
	const bump = (trap: string, prop: PropertyKey, array: boolean) => {
		const name = typeof prop === 'string' && array && /^\d+$/.test(prop) ? '[i]' : String(prop);
		const key = `${trap} ${name}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	};
	const unwrap = (value: unknown) => (value as { [RAW]?: unknown } | null)?.[RAW] ?? value;
	function wrap<T>(value: T): T {
		if (value === null || typeof value !== 'object' || (value as { [RAW]?: unknown })[RAW]) {
			return value;
		}
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== Array.prototype) return value;
		const known = wrapped.get(value);
		if (known) return known as T;
		const array = Array.isArray(value);
		const proxy = new Proxy(value, {
			get(target, prop, receiver) {
				if (prop === RAW) return target;
				bump('get', prop, array);
				return wrap(Reflect.get(target, prop, receiver));
			},
			set(target, prop, next) {
				bump('set', prop, array);
				return Reflect.set(target, prop, unwrap(next));
			},
			has(target, prop) {
				bump('has', prop, array);
				return Reflect.has(target, prop);
			},
			ownKeys(target) {
				bump('ownKeys', '', array);
				return Reflect.ownKeys(target);
			},
			getOwnPropertyDescriptor(target, prop) {
				bump('descriptor', prop, array);
				return Reflect.getOwnPropertyDescriptor(target, prop);
			}
		});
		wrapped.set(value, proxy);
		return proxy as T;
	}
	/** The document's children read through the proxy, whatever array a write puts there. */
	function hold(doc: { children: unknown }): void {
		let children = doc.children;
		Object.defineProperty(doc, 'children', {
			get: () => wrap(children),
			set: (next) => (children = unwrap(next)),
			enumerable: true,
			configurable: true
		});
	}
	const total = () => [...counts.values()].reduce((sum, n) => sum + n, 0);
	return { counts, hold, total };
}

/* ---- The rows ---- */

const ITEM = 6;

function orderedList(items: number): string {
	return Array.from({ length: items }, (_, i) => `${i + 1}. alpha beta gamma ${i}\n`).join('');
}

/** The traps one Enter at the end of item `ITEM` makes on the tree. */
async function enterTraps(items: number) {
	const tree = countingTree();
	const { deps } = makeEditorActionsDeps(parse(orderedList(items)));
	tree.hold(deps.doc);
	const { listContext } = makeListContextAt(deps, 0);
	tree.counts.clear();
	expect(await listContext.insertItemAfter(ITEM)).toBe(true);
	return tree;
}

afterEach(() => resetEditorEnv());

describe('renumber: what each renumbered item costs through the tree', () => {
	it("writes no renumbered item's marker or bytes through the tree", async () => {
		// Off, so a dev check's own reads of the tree aren't counted as the renumber's.
		configureEditorEnv({ isDev: false });
		const [short, long] = [await enterTraps(400), await enterTraps(800)];
		const grew = (key: string) => (long.counts.get(key) ?? 0) - (short.counts.get(key) ?? 0);
		expect({ marker: grew('set marker'), raw: grew('set raw') }).toEqual({ marker: 0, raw: 0 });
		// 113 is a renumbered item's cost through the tree when its writer reads metadata by name.
		expect((long.total() - short.total()) / 400).toBeLessThanOrEqual(113);
	});
});

/** A lifted item `x` whose own sublist starts `head`, with `later` siblings after it in `marker`'s
 *  list, which Shift+Tab hands to that sublist, or to a new one where `x` holds none. */
const ADOPTIONS = [
	{ shape: 'a new sublist', head: null, marker: (n: number) => `${n}. ` },
	{ shape: 'an ordered sublist', head: '1. q', marker: (n: number) => `${n}. ` },
	{ shape: 'one of another delimiter', head: '1) q', marker: (n: number) => `${n}. ` },
	{ shape: 'a bullet sublist of another glyph', head: '* q', marker: () => '- ' }
];

function liftSource(head: string | null, marker: (n: number) => string, later: number): string {
	const items = Array.from({ length: later }, (_, i) => `   ${marker(i + 2)}y${i}`);
	const own = head === null ? [] : [`      ${head}`];
	return ['1. a', `   ${marker(1)}x`, ...own, ...items, ''].join('\n');
}

/** The traps Shift+Tab on `x` makes on the tree, with the item and its sublist mounted. */
async function liftTraps({ head, marker }: (typeof ADOPTIONS)[number], later: number) {
	const tree = countingTree();
	const { deps } = makeEditorActionsDeps(parse(liftSource(head, marker, later)));
	tree.hold(deps.doc);
	const item = () => deps.doc.children[0].children![0];
	const sublist = () => item().children![1];
	registerBlockListState(item(), makeBlockListState(item));
	registerBlockListState(sublist(), makeBlockListState(sublist));
	const { listContext } = makeListContextAt(deps, 0);
	tree.counts.clear();
	expect(await listContext.promoteNestedItem(0, sublist(), 0)).toBe(true);
	return tree;
}

// Miss-analysis: the row above drove Enter alone, and an outdent styled each sibling it handed on
// through the tree, then numbered it through the tree again.
describe('outdent: what each sibling the lifted item takes costs through the tree', () => {
	it.each(ADOPTIONS)(
		"writes no taken sibling's marker or bytes through the tree, into $shape",
		async (adoption) => {
			configureEditorEnv({ isDev: false });
			const [short, long] = [await liftTraps(adoption, 400), await liftTraps(adoption, 800)];
			const grew = (key: string) => (long.counts.get(key) ?? 0) - (short.counts.get(key) ?? 0);
			expect({ marker: grew('set marker'), raw: grew('set raw') }).toEqual({ marker: 0, raw: 0 });
		}
	);
});
