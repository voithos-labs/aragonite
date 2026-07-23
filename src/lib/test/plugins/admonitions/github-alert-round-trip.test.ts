import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { rebuildGithubAlertRaw } from '$lib/plugins/admonitions/github-alert-kind';
import { roundTripCases } from '$lib/test/support/round-trip';

// Load is byte-exact off the stored raw; a post-edit rebuild re-emits the marker
// (casing preserved from metadata) + `> `-prefixed body, CRLF threaded, and reparses
// to the same kind — the strip-container contract with a first-line marker.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('github alert — byte round-trip on load', () => {
	roundTripCases([
		'> [!NOTE]\n> Body.\n',
		'> [!TIP]\n> One.\n>\n> Two.\n',
		'> [!Warning]\n> mixed-case marker bytes survive.\n',
		'> [!IMPORTANT]\n',
		'# Heading\n\n> [!CAUTION]\n> Careful.\n\nAfter.\n',
		{ name: 'CRLF', source: '> [!NOTE]\r\n> Body.\r\n' },
		{ name: 'no trailing newline', source: 'Intro\n\n> [!TIP]\n> Last line, no newline' }
	]);
});

describe('github alert — rebuild after an inner edit', () => {
	const edit = (source: string, newBody: string) => {
		const node = parse(source).children[0];
		node.children![0].raw = newBody;
		rebuildGithubAlertRaw(node);
		return node;
	};

	it('re-emits the marker + > -prefixed body and stays a githubAlert', () => {
		const node = edit('> [!NOTE]\n> old body\n', 'new body\n');
		expect(node.raw).toBe('> [!NOTE]\n> new body\n');
		expect(parse(node.raw).children[0].kind).toBe('githubAlert');
	});

	it('preserves the typed marker casing through a rebuild', () => {
		expect(edit('> [!Tip]\n> old\n', 'edited\n').raw).toBe('> [!Tip]\n> edited\n');
	});

	it('threads CRLF through a rebuild', () => {
		expect(edit('> [!WARNING]\r\n> old\r\n', 'new\r\n').raw).toBe('> [!WARNING]\r\n> new\r\n');
	});
});
