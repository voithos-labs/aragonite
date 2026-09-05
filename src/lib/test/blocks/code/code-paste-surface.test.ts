import { describe, it, expect } from 'vitest';
import { codePasteSurface } from '$lib/components/blocks/code/code-paste-surface';
import { fencedCode } from './fenced-code-fixture';

describe('code-paste-surface', () => {
	it('is registered for kind fencedCode', () => {
		expect(codePasteSurface.kind).toBe('fencedCode');
	});

	it('omits both structural hooks — code always treats paste as literal text', () => {
		expect(codePasteSurface.onStructuralPaste).toBeUndefined();
		expect(codePasteSurface.onScopedStructuralPaste).toBeUndefined();
	});

	it('onInlinePaste splices text without fence bump when paste contains no fence run', () => {
		const node = fencedCode('```\nhello\n```\n');
		const result = codePasteSurface.onInlinePaste!(node, 4, ' XYZ');
		expect(result.newRaw).toContain('XYZ');
		expect(result.caretOffset).toBe(4 + ' XYZ'.length);
	});

	it('onInlinePaste bumps the fence when paste contains a run ≥ fenceLength', () => {
		const node = fencedCode('```\nbody\n```\n');
		const result = codePasteSurface.onInlinePaste!(node, 0, '```\ninner\n```');
		expect(result.newRaw).toMatch(/^````/);
	});

	it('onInlinePaste with preDelete replaces the specified range', () => {
		const node = fencedCode('```\nfoo bar\n```\n');
		const fooBarStart = '```\nfoo '.length;
		const fooBarEnd = fooBarStart + 'bar'.length;
		const result = codePasteSurface.onInlinePaste!(node, fooBarStart, 'BAZ', {
			start: fooBarStart,
			end: fooBarEnd
		});
		expect(result.newRaw).toContain('foo BAZ');
		expect(result.newRaw).not.toContain('foo bar');
	});
});
