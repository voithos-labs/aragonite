import { describe, it, expect } from 'vitest';
import type { AnyBlockKind } from '../../core/nodes';
import {
	checkContentStartBackspace,
	type ContentStartBackspaceEntry
} from '../../invariants/registry';

const kind = (name: string) => name as AnyBlockKind;

const row = (over: Partial<ContentStartBackspaceEntry> = {}): ContentStartBackspaceEntry => ({
	kind: kind('heading'),
	demotesFirst: true,
	declaresContentRange: true,
	...over
});

describe('checkContentStartBackspace (G1.32)', () => {
	// Without the hook the content range IS the whole display, so the demote arm never fires and
	// the declaration reads as behavior the kind does not have.
	it('fires when a demote-first kind declares no content range', () => {
		const violation = checkContentStartBackspace([row({ declaresContentRange: false })]);
		expect(violation?.code).toBe('content-start-backspace');
		expect(violation?.detail).toMatchObject({ kind: 'heading' });
	});

	it('accepts a demote-first kind that declares one', () => {
		expect(checkContentStartBackspace([row()])).toBeNull();
	});

	it('ignores a kind that declares neither', () => {
		expect(
			checkContentStartBackspace([
				row({ kind: kind('paragraph'), demotesFirst: false, declaresContentRange: false })
			])
		).toBeNull();
	});
});
