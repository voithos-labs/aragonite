// A commit's announcement reaches the live region after its caret lands, and only when bytes
// landed: a refused or discarded commit says nothing, at the document root and in a container.
// Miss-analysis: each announcer checked for itself, so a no-op or refused move could still speak.
import { describe, expect, it } from 'vitest';
import type { StructuralChange } from '$lib/tree-operations/structural-change';
import type { PresentationMode } from '$lib/presentation-mode';
import { asDocPath } from '$lib/selection/path-math';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { makeNestedHarness, makeTopHarness } from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { takeDevWarns } from '../../support/warn-gate';

type Writes = 'writes' | 'changes nothing';

const deleteSecond = (children: unknown[]): StructuralChange => {
	children.splice(1, 1);
	return { op: 'delete', at: 1, count: 1 };
};

/** Runs one commit at the chosen scope and returns what happened, in order. */
async function commitAt(scope: 'document' | 'container', writes: Writes, mode: PresentationMode) {
	const log: string[] = [];
	const mutate = writes === 'writes' ? deleteSecond : (): StructuralChange => ({ op: 'noop' });
	const common = {
		snapshot: { path: asDocPath(scope === 'document' ? [0] : [0, 0]), offset: 0 },
		discardIfNoop: true,
		afterTick: () => void log.push('caret'),
		announce: () => 'Moved'
	};
	if (scope === 'document') {
		const h = makeTopHarness('a\n\nb\n', {
			reading: fixtureReading({}, mode),
			announceEdit: (message) => log.push(`said ${message}`)
		});
		const wrote = await h.controller.commitStructural({ ...common, mutate });
		return { wrote, log };
	}
	const h = makeNestedHarness('> a\n>\n> b\n', { index: 0, presentationMode: mode });
	h.deps.announceEdit = (message) => log.push(`said ${message}`);
	const wrote = await h.containerEdit.commitContainer({
		...common,
		containerNode: h.getNode(),
		path: [0],
		state: h.state,
		mutate: (view) => mutate(view.children)
	});
	return { wrote, log };
}

describe.each(['document', 'container'] as const)('a %s commit’s announcement', (scope) => {
	it('is said once the caret has landed, when the commit wrote', async () => {
		expect(await commitAt(scope, 'writes', 'source')).toEqual({
			wrote: true,
			log: ['caret', 'said Moved']
		});
	});

	it('is not said when a commit that may do nothing changed nothing', async () => {
		expect(await commitAt(scope, 'changes nothing', 'source')).toEqual({
			wrote: false,
			log: ['caret']
		});
	});

	it('is not said when reading mode refuses the commit', async () => {
		expect(await commitAt(scope, 'writes', 'reading')).toEqual({ wrote: false, log: [] });
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});
