import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { checkOpaqueRebuildDeterminism, checkOpaqueStaleRaw } from '$lib/invariants/node-shape';
import { admonitionsPlugin, convertGithubAlerts } from '$lib/plugins/admonitions';
import { convertGithubAlertsInDocument } from '$lib/plugins/admonitions/convert-document';

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

/**
 * Rebuild an admonition whose body child holds `bodyRaw`, mimicking the commit
 * ceremony's rebuild of an enclosing container after a content edit.
 */
function rebuiltWithBody(source: string, bodyRaw: string) {
	const node = parse(source).children[0];
	node.children![1].raw = bodyRaw;
	getBlockKindDescriptor(node.kind).rebuildRaw!(node);
	return node;
}

describe('admonition fence escalation past body colon runs', () => {
	it('keeps the body inside the container when a body line is a bare closer', () => {
		const node = rebuiltWithBody(':::note T\n\nbody\n\n:::\n', 'before\n:::\nafter\n');
		const reparsed = parse(node.raw);
		expect(reparsed.children.length).toBe(1);
		expect(reparsed.children[0].kind).toBe('admonition');
		expect(reparsed.children[0].children?.[1].raw).toBe('before\n:::\nafter\n');
	});

	it('escalates past a body colon run longer than the opener', () => {
		const node = rebuiltWithBody(':::note T\n\nbody\n\n:::\n', '::::::\n');
		const reparsed = parse(node.raw);
		expect(reparsed.children.length).toBe(1);
		expect(reparsed.children[0].kind).toBe('admonition');
		expect(reparsed.children[0].children?.[1].raw).toBe('::::::\n');
	});

	it('leaves G1.12 clean after a colliding body edit', () => {
		const node = rebuiltWithBody(':::note T\n\nbody\n\n:::\n', 'before\n:::\nafter\n');
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	// The escalated length is re-derived from the body on every emit rather than
	// latched into metadata, so two rebuilds over identical state must still agree.
	it('stays deterministic across repeated rebuilds (G1.13)', () => {
		const node = rebuiltWithBody(':::note T\n\nbody\n\n:::\n', 'before\n:::\nafter\n');
		expect(checkOpaqueRebuildDeterminism(node)).toBeNull();

		const once = node.raw;
		getBlockKindDescriptor(node.kind).rebuildRaw!(node);
		expect(node.raw).toBe(once);
	});

	it('escalates CRLF bodies on the \\r-trimmed line text', () => {
		const node = rebuiltWithBody(
			':::note T\r\n\r\nbody\r\n\r\n:::\r\n',
			'before\r\n:::\r\nafter\r\n'
		);
		const reparsed = parse(node.raw);
		expect(reparsed.children.length).toBe(1);
		expect(reparsed.children[0].children?.[1].raw).toBe('before\r\n:::\r\nafter\r\n');
	});

	it('leaves a collision-free rebuild byte-identical', () => {
		const source = ':::note T\n\nbody\n\n:::\n';
		const node = rebuiltWithBody(source, 'body\n');
		expect(node.raw).toBe(source);
	});

	it('does not escalate past an indented or trailing-content colon run', () => {
		// Neither ` :::` nor `::: x` is a closer (`isDirectiveCloser` demands a
		// whole-line colon run), so escalating past them would be gratuitous churn.
		expect(rebuiltWithBody(':::note T\n\nbody\n\n:::\n', '    :::\n').raw).toBe(
			':::note T\n\n    :::\n\n:::\n'
		);
		expect(rebuiltWithBody(':::note T\n\nbody\n\n:::\n', '::: x\n').raw).toBe(
			':::note T\n\n::: x\n\n:::\n'
		);
	});
});

describe('GitHub-alert conversion escalates past colon runs in the alert body', () => {
	it('keeps a bare-closer body line inside the converted container', () => {
		const { converted } = convertGithubAlertsInDocument('> [!NOTE]\n> :::\n> more\n');
		const doc = parse(converted);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('admonition');
	});

	it('escalates the naive full-text converter identically', () => {
		const { converted } = convertGithubAlerts('> [!NOTE]\n> ::::\n> more\n');
		const doc = parse(converted + '\n');
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('admonition');
	});

	it('leaves a collision-free conversion on the canonical 3-colon fence', () => {
		const { converted } = convertGithubAlertsInDocument('> [!NOTE]\n> plain\n');
		expect(converted).toBe(':::note\nplain\n:::\n');
	});
});
