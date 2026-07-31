import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { findMergeTarget } from '../../schema/merge-rules';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import type { CstNode } from '../../core/nodes';

// The Backspace merge walker must not descend past a collapsed container's chrome: the
// clamped-out body is invisible, so a merge writing there loses text from view.

const OPEN_DETAILS = '<details open>\n<summary>Sum</summary>\n\nBody\n\n</details>\n';
const CLOSED_DETAILS = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const OPEN_WITH_NESTED_CLOSED =
	'<details open>\n<summary>Outer</summary>\n\n' + CLOSED_DETAILS + '\n</details>\n';
const CALLOUT = ':::note Title\nBody\n:::\n';

function parseBlock(src: string): CstNode {
	return parse(src).children[0];
}

function resetAndRegister(): void {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
	registerCalloutKind();
}

describe('isCollapsedContainer', () => {
	beforeEach(resetAndRegister);

	it('reads a closed details as collapsed and an open one as not', () => {
		expect(isCollapsedContainer(parseBlock(CLOSED_DETAILS))).toBe(true);
		expect(isCollapsedContainer(parseBlock(OPEN_DETAILS))).toBe(false);
	});

	it('is false for a chrome container that declares no probe (callout)', () => {
		expect(isCollapsedContainer(parseBlock(CALLOUT))).toBe(false);
	});

	it('is false for a kind without reserved chrome (paragraph)', () => {
		expect(isCollapsedContainer(parseBlock('hello\n'))).toBe(false);
	});
});

describe('findMergeTarget under the collapse probe', () => {
	beforeEach(resetAndRegister);

	it('open details: descends to the last body paragraph', () => {
		const result = findMergeTarget(parseBlock(OPEN_DETAILS));
		expect(result).not.toBeNull();
		expect(result!.target.kind).toBe('paragraph');
		expect((result!.target.raw ?? '').trim()).toBe('Body');
		expect(result!.path).toEqual([1]);
	});

	it('closed details: stops at the not-mergeable summary chrome, returns null', () => {
		expect(findMergeTarget(parseBlock(CLOSED_DETAILS))).toBeNull();
	});

	it('open details whose last body child is a closed details: returns null', () => {
		const outer = parseBlock(OPEN_WITH_NESTED_CLOSED);
		expect(outer.children?.[1]?.kind).toBe('details');
		expect(findMergeTarget(outer)).toBeNull();
	});

	it('callout (no probe): descent unchanged, last body paragraph', () => {
		const result = findMergeTarget(parseBlock(CALLOUT));
		expect(result).not.toBeNull();
		expect((result!.target.raw ?? '').trim()).toBe('Body');
		expect(result!.path).toEqual([1]);
	});
});
