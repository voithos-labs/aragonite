import { describe, it, expect } from 'vitest';
import { joinMermaidBody } from '$lib/plugins/mermaid/mermaid-kind';

// The edit textarea LF-normalizes its value, so a commit appending a bare `\n` flips a
// CRLF diagram's body to LF while its chrome keeps `\r\n` — one edit, mixed-EOL block.
// The opener's ending, threaded through metadata, is the single authored ending.

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
