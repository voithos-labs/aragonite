import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseDoc } from '#lib';

import { roundTripCases } from '#lib/test/harness/round-trip.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { ALERT, admonitionsGrammar } from '#lib/test/support/admonitions-grammar.js';

// Load is byte-exact off the stored raw; a post-edit rebuild re-emits the marker
// (casing preserved from metadata) + `> `-prefixed body, CRLF threaded, and reparses
// to the same kind: the strip-container contract with a first-line marker.

let grammar: ReturnType<typeof admonitionsGrammar>;
const parse = (source: string) => parseDoc(source, { grammar });

beforeEach(() => {
	grammar = admonitionsGrammar();
});

describe('github alert: byte round-trip on load', () => {
	roundTripCases(
		[
			'> [!NOTE]\n> Body.\n',
			'> [!TIP]\n> One.\n>\n> Two.\n',
			'> [!Warning]\n> mixed-case marker bytes survive.\n',
			'> [!IMPORTANT]\n',
			'# Heading\n\n> [!CAUTION]\n> Careful.\n\nAfter.\n',
			{ name: 'CRLF', source: '> [!NOTE]\r\n> Body.\r\n' },
			{ name: 'no trailing newline', source: 'Intro\n\n> [!TIP]\n> Last line, no newline' }
		],
		() => grammar
	);
});

describe('github alert: rebuild after an inner edit', () => {
	const edit = (source: string, newBody: string) => {
		const node = parse(source).children[0];
		node.children![0].raw = newBody;
		writeContainerRaw(node, grammar);
		return node;
	};

	it('re-emits the marker + > -prefixed body and stays a githubAlert', () => {
		const node = edit('> [!NOTE]\n> old body\n', 'new body\n');
		expect(node.raw).toBe('> [!NOTE]\n> new body\n');
		expect(parse(node.raw).children[0].kind).toBe(ALERT);
	});

	it('preserves the typed marker casing through a rebuild', () => {
		expect(edit('> [!Tip]\n> old\n', 'edited\n').raw).toBe('> [!Tip]\n> edited\n');
	});

	it('threads CRLF through a rebuild', () => {
		expect(edit('> [!WARNING]\r\n> old\r\n', 'new\r\n').raw).toBe('> [!WARNING]\r\n> new\r\n');
	});
});
