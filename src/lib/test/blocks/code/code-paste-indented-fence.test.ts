import { describe, it, expect } from 'vitest';
import { computeCodePaste } from '$lib/components/blocks/code/code-paste';

type PasteArgs = Parameters<typeof computeCodePaste>[0];

/** A closed 3-backtick fence; each case names only the fence facts it varies. */
const paste = (
	args: Omit<PasteArgs, 'fenceMarker' | 'fenceLength' | 'closed'> & Partial<PasteArgs>
) => computeCodePaste({ fenceMarker: '`', fenceLength: 3, closed: true, ...args });

describe('computeCodePaste — indented fence opener (J2)', () => {
	it('bumps an opener indented by 3 spaces and preserves the indent', () => {
		const result = paste({
			display: '   ```\n\n   ```',
			selection: { start: 7, end: 7 },
			pasted: '```'
		});
		expect(result.text).toBe('   ````\n```\n   ````');
	});

	it('bumps an opener indented by 1 space', () => {
		const result = paste({
			display: ' ```\n\n ```',
			selection: { start: 5, end: 5 },
			pasted: '```'
		});
		expect(result.text).toBe(' ````\n```\n ````');
	});

	// The paste lands on its own line, which is where a run threatens the fence — a run
	// appended to `foo` is not a closer and leaves the opener alone.
	it('bumps an indented unclosed opener and preserves the indent', () => {
		const result = paste({
			display: '  ```\nfoo\n',
			selection: { start: 10, end: 10 },
			pasted: '```',
			closed: false
		});
		expect(result.text).toBe('  ````\nfoo\n```');
	});

	it('supports indented tilde fences', () => {
		const result = paste({
			display: '  ~~~\n\n  ~~~',
			selection: { start: 6, end: 6 },
			pasted: '~~~',
			fenceMarker: '~'
		});
		expect(result.text).toBe('  ~~~~\n~~~\n  ~~~~');
	});
});
