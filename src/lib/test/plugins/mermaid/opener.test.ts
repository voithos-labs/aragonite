import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';

describe('mermaid opener claims and declines', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerMermaidKind();
	});

	it('claims a ```mermaid fence as a childless mermaid container', () => {
		const src = '```mermaid\ngraph TD\n\tA --> B\n```\n';
		const block = parse(src).children[0];
		expect(block.kind).toBe('mermaid');
		expect(block.children).toEqual([]);
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims a ~~~mermaid fence', () => {
		const src = '~~~mermaid\ngraph TD\n~~~\n';
		expect(parse(src).children[0].kind).toBe('mermaid');
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims when mermaid is the first word of a longer info string', () => {
		const src = '```mermaid theme=dark\ngraph TD\n```\n';
		expect(parse(src).children[0].kind).toBe('mermaid');
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims an opener indented up to three spaces', () => {
		const src = '   ```mermaid\ngraph TD\n```\n';
		expect(parse(src).children[0].kind).toBe('mermaid');
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims an unterminated fence to end of input (fencedCode parity)', () => {
		const src = '```mermaid\ngraph TD\nno closer';
		const doc = parse(src);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('mermaid');
		expect(serialize(doc)).toBe(src);
	});

	it('interrupts an open paragraph (fencedCode parity)', () => {
		const src = 'Above\n```mermaid\ngraph TD\n```\n';
		const doc = parse(src);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'mermaid']);
		expect(serialize(doc)).toBe(src);
	});

	const declined: Array<[label: string, src: string, expectedKind: string]> = [
		['a ```js fence', '```js\nconst x = 1;\n```\n', 'fencedCode'],
		['a bare ``` fence', '```\ncode\n```\n', 'fencedCode'],
		['a ```mermaidx info word', '```mermaidx\nx\n```\n', 'fencedCode'],
		['a capitalized ```Mermaid info word', '```Mermaid\nx\n```\n', 'fencedCode'],
		['a four-space-indented fence (not a fence opener)', '    ```mermaid\n', 'indentedCode']
	];
	for (const [label, src, expectedKind] of declined) {
		it(`declines ${label} back to ${expectedKind}`, () => {
			expect(parse(src).children[0].kind).toBe(expectedKind);
			expect(serialize(parse(src))).toBe(src);
		});
	}

	it('leaves a ```mermaid line inside a longer outer fence to fencedCode', () => {
		const src = '````\n```mermaid\ngraph TD\n```\n````\n';
		const doc = parse(src);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('fencedCode');
		expect(serialize(doc)).toBe(src);
	});
});

describe('mermaid fence with the plugin uninstalled', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('parses as plain fencedCode and serializes byte-identically', () => {
		const src = '```mermaid\ngraph TD\n\tA --> B\n```\n';
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('fencedCode');
		expect(serialize(doc)).toBe(src);
	});
});
