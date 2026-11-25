// @vitest-environment jsdom
// A write over a diagram's bytes that never passes its box (a paste over the closer, a range cut)
// gets its closing fence back, so it cannot swallow the blocks below: 0.11.5's rows, through the
// diagram type's own write rule.
// Miss-analysis: every mermaid write test went through the code editor's metadata commit.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { grammar } from '#lib/plugin.js';
import { makingOf } from '#lib/schema/block-type.js';
import { installPluginList } from '#lib/schema/plugin-unit.js';
import { mermaid } from '#packages/mermaid/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(destroyMountedEditors);

/** The rule as a write path reaches it, over a diagram that held `source`. */
function write(source: string, raw: string): string {
	const [unit] = installPluginList([mermaid], ({ cause }) => {
		throw cause;
	});
	const rule = makingOf(unit.contribution.blocks![0])!.registration.rawWrite!;
	const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
	const node = { kind: 'mermaid/diagram', raw: source, leadingTrivia: '' };
	return rule.normalize(raw, { node, mode: 'literal', lineEnding } as never);
}

const kinds = (source: string) =>
	grammar([mermaid])
		.parse(source)
		.blocks.map((b) => b.type.name);

describe('a truncating write of a diagram gets its closing fence back', () => {
	it.each([
		[
			'a paste over the closer',
			'```mermaid\ngraph TD\n```\n',
			'```mermaid\nA\nB',
			'```mermaid\nA\nB\n```\n'
		],
		[
			'a body line that reads as the closer',
			'```mermaid\ngraph TD\n```\n',
			'```mermaid\n```\nA\n```\n',
			'````mermaid\n```\nA\n````\n'
		],
		[
			'a longer written opener run',
			'```mermaid\ngraph TD\n```\n',
			'````mermaid\nA\n',
			'````mermaid\nA\n````\n'
		],
		['a tilde fence', '~~~mermaid\ngraph TD\n~~~\n', '~~~mermaid\nA\n', '~~~mermaid\nA\n~~~\n'],
		[
			'an indented opener',
			'  ```mermaid\ngraph TD\n  ```\n',
			'  ```mermaid\nA\n',
			'  ```mermaid\nA\n  ```\n'
		],
		[
			'a CRLF block',
			'```mermaid\r\ngraph TD\r\n```\r\n',
			'```mermaid\r\nA\r\n',
			'```mermaid\r\nA\r\n```\r\n'
		],
		[
			'a write cut back to the opener',
			'```mermaid\ngraph TD\n```\n',
			'```mermaid\n',
			'```mermaid\n```\n'
		]
	])('%s', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
		expect(kinds(write(source, written) + '\nTail\n')).toEqual(['mermaid/diagram', 'paragraph']);
	});

	it('leaves a fence that still holds its closer alone', () => {
		expect(write('```mermaid\ngraph TD\n```\n', '```mermaid\nA\n```\n')).toBe(
			'```mermaid\nA\n```\n'
		);
	});

	it('keeps the closer a write stranded by taking the opener line', () => {
		expect(write('```mermaid\ngraph TD\n```\n', 'graph TD\n```\n')).toBe('graph TD\n```\n');
	});

	// A fence whose info string a write changed reads as code, so the code block's rule closes it, a
	// write past the block included.
	it('keeps a fence whose info string is no longer mermaid closed', async () => {
		const source = '```mermaid\ngraph TD\n```\n\ntail\n';
		const editor = mountEditor({ source, plugins: [mermaid] });
		await editor.settle();
		const to = source.indexOf('\n\ntail');
		expect(await editor.instance.edit().replace({ from: 0, to }, '```js\nA').commit()).toEqual({
			ok: true
		});
		await editor.settle();
		expect(editor.source()).toBe('```js\nA\n```\n\ntail\n');
	});

	// Applied twice by two write paths in one operation, the second pass must add nothing.
	it('is idempotent', () => {
		const once = write('```mermaid\ngraph TD\n```\n', '```mermaid\nA\n');
		expect(once).toBe('```mermaid\nA\n```\n');
		expect(write('```mermaid\ngraph TD\n```\n', once)).toBe(once);
	});
});

// Miss-analysis: every closer-restore fixture was LF, so none hit a CRLF last line with no ending.
describe('a closing fence restored into the unterminated last block of a CRLF document', () => {
	it('is CRLF', () => {
		expect(write('```mermaid\r\ngraph TD\r\n```', '```mermaid\r\nA')).toBe(
			'```mermaid\r\nA\r\n```'
		);
	});
});
