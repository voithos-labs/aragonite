import { describe, it, expect } from 'vitest';
import { joinMermaidBody } from '$lib/plugins/mermaid/mermaid-kind';

// The edit textarea LF-normalizes its value, so a commit that appended a bare
// `\n` (`value + '\n'`) flipped every body line of a CRLF-authored diagram to LF
// while the opener/closer chrome kept `\r\n` — one edit left the block mixed-EOL.
// `joinMermaidBody` rejoins the draft with the block's authored ending so a
// CRLF diagram stays CRLF end-to-end. The opener line ending is the single
// authored ending threaded through metadata.

describe('joinMermaidBody rejoins the draft with the authored line ending', () => {
	it('rejoins a multi-line CRLF draft, preserving every interior + trailing ending', () => {
		expect(joinMermaidBody('graph TD\n\tA --> B', '\r\n')).toBe('graph TD\r\n\tA --> B\r\n');
	});

	it('appends the authored ending to a single-line CRLF draft', () => {
		expect(joinMermaidBody('graph TD', '\r\n')).toBe('graph TD\r\n');
	});

	it('leaves an LF draft as `value + \\n` (unchanged behavior)', () => {
		expect(joinMermaidBody('graph TD\n\tA --> B', '\n')).toBe('graph TD\n\tA --> B\n');
	});

	it('commits an emptied body as the empty string (no stray line)', () => {
		expect(joinMermaidBody('', '\r\n')).toBe('');
	});
});
