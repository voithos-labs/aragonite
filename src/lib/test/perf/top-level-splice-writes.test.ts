// @vitest-environment jsdom
// Miss-analysis: only the perf gate timed an Enter at the top of a long document; no unit test
// counted what a document-scope commit writes through the tree's own array.
import { describe, expect, it } from 'vitest';
import type { CstNode, Document } from '$lib/core/nodes';
import type { EditorActionsDeps } from '$lib/editor-actions/deps';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { serialize } from '$lib/core/serializer';
import { makeEnv, makeHandlers } from '../selection/cross-block/typed-char-env';
import { press } from '../selection/cross-block/keydown-env';

const BLOCKS = 2000;

/** Wraps every array the document installs as its children, as the editor's `$state` proxy does,
 *  and counts the indexed writes that reach one: each is a tracked write in the editor. */
function countTreeArrayWrites(deps: EditorActionsDeps): () => number {
	let writes = 0;
	const isIndex = (key: string | symbol) => typeof key === 'string' && /^\d+$/.test(key);
	const track = (array: CstNode[]) =>
		new Proxy(array, {
			set(target, key, value, receiver) {
				if (isIndex(key)) writes++;
				return Reflect.set(target, key, value, receiver);
			},
			deleteProperty(target, key) {
				if (isIndex(key)) writes++;
				return Reflect.deleteProperty(target, key);
			}
		});
	const doc = deps.doc;
	doc.children = track(doc.children);
	const live = new Proxy(doc, {
		set(target, key, value, receiver) {
			return Reflect.set(target, key, key === 'children' ? track(value) : value, receiver);
		}
	}) as Document;
	Object.defineProperty(deps, 'doc', { get: () => live });
	return () => writes;
}

describe('a structural commit at the top of a long document', () => {
	it("splices a plain copy of the top level, never the tree's own array", async () => {
		const source = Array.from({ length: BLOCKS }, (_, i) => `p${i}\n`).join('\n');
		const { deps, actions } = makeTopHarness(source);
		const writes = countTreeArrayWrites(deps);

		await actions.splitBlock(0, 1);

		expect(deps.doc.children).toHaveLength(BLOCKS + 1);
		expect(writes()).toBeLessThan(10);
	});

	// Miss-analysis: the row above drove the document-only commit, never a multi-scope commit whose
	// only scope is the document.
	it('a range delete into an unmounted list item splices a plain copy too', async () => {
		const tail = Array.from({ length: BLOCKS }, (_, i) => `p${i}\n`).join('\n');
		const env = makeEnv(`head\n\n- item\n\n${tail}`);
		const writes = countTreeArrayWrites(env.deps);
		env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [1, 0, 0], offset: 2 });

		await makeHandlers(env, [0]).handleKeyDown(press('Backspace'));

		expect(serialize(env.deps.doc).startsWith('heem\n')).toBe(true);
		expect(writes()).toBeLessThan(10);
	});
});
