// `containerPaste.matchesAncestor` is plugin code the paste gates run on a user gesture.
// On the cross-block route the covering range delete has ALREADY committed when the gate
// runs, so an escaping throw loses the selection with nothing pasted and nothing on the
// `error` channel. A throw must decline, exactly as a `false` return does.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { findContainerMatchingUnwrap } from '$lib/tree-operations/paste/container-match';
import { findListAbsorb } from '$lib/tree-operations/paste/list-absorb';
import { findListBreakOut } from '$lib/tree-operations/paste/list-break-out';
import { takeDevWarns } from '../../support/warn-gate';

const original = {
	blockquote: tryGetBlockKindDescriptor('blockquote')!.containerPaste,
	list: tryGetBlockKindDescriptor('list')!.containerPaste
};

afterEach(() => {
	augmentBuiltin('blockquote', { container: { containerPaste: original.blockquote } });
	augmentBuiltin('list', { container: { containerPaste: original.list } });
});

function throwOnMatch(kind: 'blockquote' | 'list', siblingAbsorb: boolean): void {
	augmentBuiltin(kind, {
		container: {
			containerPaste: {
				siblingAbsorb,
				matchesAncestor: () => {
					throw new Error('plugin predicate blew up');
				}
			}
		}
	});
}

describe('a throwing matchesAncestor is contained at every gate', () => {
	it('container-match declines instead of propagating', () => {
		throwOnMatch('blockquote', false);
		const doc = parse('> x\n');
		doc.children[0].children![0].raw = '\n';
		expect(findContainerMatchingUnwrap(doc, [0, 0], 0, parse('> pasted\n'), false)).toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['container-paste']);
	});

	it('list-absorb declines instead of propagating', () => {
		throwOnMatch('list', true);
		const doc = parse('- a\n- b\n');
		expect(findListAbsorb(doc, [0, 1, 0], parse('- x\n- y\n'), 0)).toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['container-paste']);
	});

	// Break-out's gate reads the predicate the other way round, so a broken predicate must
	// still behave as `() => false` there rather than as an abort.
	it('list-break-out treats the throw as a non-match and still applies', () => {
		throwOnMatch('list', true);
		const doc = parse('- a\n- b\n');
		expect(findListBreakOut(doc, [0, 1, 0], parse('- x\n- y\n'), 0)).not.toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['container-paste']);
	});
});
