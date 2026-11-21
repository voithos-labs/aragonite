// @vitest-environment jsdom
// The plugins' code highlighters as the editor asks them: list order, late answers, failures.
import { describe, expect, it, vi } from 'vitest';
import { definePlugin, type CodeHighlighter, type CodeToken } from '#lib/plugin.js';
import { installPluginList, type PluginError } from '#lib/schema/plugin-unit.js';
import { createEditorContributions } from '#lib/schema/editor-contributions.js';
import { createEditorActivation, everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { createCodePainter } from '#lib/components/blocks/code/code-painter.js';
import { highlighterLanguages, languageOwner } from '#lib/components/blocks/code/code-languages.js';
import { registerEditorBuiltIns } from '#lib/components/editor-built-ins.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import { microtaskCheckpoint } from '#lib/test/harness/microtask-settle.js';

function editorWith(...highlighters: { name: string; code: CodeHighlighter }[]) {
	const errors: PluginError[] = [];
	const contributions = createEditorContributions({
		editorFor: () => undefined,
		report: (error) => errors.push(error)
	});
	const plugins = highlighters.map(({ name, code }) =>
		definePlugin({ name, version: '1.0.0', editor: '*', contributes: () => ({ code }) })
	);
	const units = contributions.read(installPluginList(plugins, (error) => errors.push(error)));
	const activation = createEditorActivation(
		units.map((unit) => unit.name),
		contributions
	);
	const repaint = vi.fn();
	return { painter: createCodePainter(() => activation, repaint), activation, repaint, errors };
}

const keyword = (body: string): CodeToken[] => [{ from: 0, to: body.indexOf(' '), class: 'kw' }];
const html = (node: Node) => {
	const box = document.createElement('div');
	box.append(node);
	return box.innerHTML;
};
const settle = microtaskCheckpoint;

describe('createCodePainter', () => {
	it('draws a synchronous answer as nested spans, the body exact', () => {
		const tokens: CodeToken[] = [
			{ from: 0, to: 9, class: 'outer' },
			{ from: 0, to: 3, class: 'inner' }
		];
		const { painter } = editorWith({
			name: 'one',
			code: { languages: () => [{ name: 'x', aliases: [] }], highlight: () => tokens }
		});
		const node = painter.code('let a = 1;', 'x');
		expect(html(node)).toBe('<span class="outer"><span class="inner">let</span> a = 1</span>;');
	});

	it('nests two tokens over one range in the order given, the first outside', () => {
		const tokens: CodeToken[] = [
			{ from: 1, to: 5, class: 'outer' },
			{ from: 1, to: 5, class: 'inner' }
		];
		const { painter } = editorWith({
			name: 'one',
			code: { languages: () => [{ name: 'x', aliases: [] }], highlight: () => tokens }
		});
		expect(html(painter.code('[true]', 'x'))).toBe(
			'[<span class="outer"><span class="inner">true</span></span>]'
		);
	});

	it('paints an always-async answer plain, asks once per change, and draws it on arrival', async () => {
		const highlight = vi.fn(async (body: string) => keyword(body));
		const { painter, repaint } = editorWith({
			name: 'late',
			code: { languages: () => [{ name: 'x', aliases: [] }], highlight }
		});
		expect(html(painter.code('let a', 'x'))).toBe('let a');
		await settle();
		expect(repaint).toHaveBeenCalledTimes(1);
		expect(html(painter.code('let a', 'x'))).toBe('<span class="kw">let</span> a');
		expect(highlight).toHaveBeenCalledTimes(1);
	});

	it('drops an answer for a body the surface no longer shows', async () => {
		const { painter, repaint } = editorWith({
			name: 'late',
			code: {
				languages: () => [{ name: 'x', aliases: [] }],
				highlight: async (body) => keyword(body)
			}
		});
		painter.code('let a', 'x');
		painter.code('let ab', 'x');
		await settle();
		expect(repaint).toHaveBeenCalledTimes(1);
		expect(html(painter.code('let ab', 'x'))).toBe('<span class="kw">let</span> ab');
	});

	// Miss-analysis: the stale rows changed the body alone, so an answer for the language the fence
	// had before went unasked.
	it('drops an answer for a language the surface no longer shows, the body unchanged', async () => {
		const answers: ((tokens: CodeToken[]) => void)[] = [];
		const { painter, repaint } = editorWith({
			name: 'late',
			code: {
				languages: () => [
					{ name: 'x', aliases: [] },
					{ name: 'y', aliases: [] }
				],
				highlight: () => new Promise<CodeToken[]>((resolve) => answers.push(resolve))
			}
		});
		painter.code('let a', 'x');
		painter.code('let a', 'y');
		answers[0]([{ from: 0, to: 3, class: 'for-x' }]);
		await settle();
		expect(repaint).not.toHaveBeenCalled();
		expect(html(painter.code('let a', 'y'))).toBe('let a');
	});

	it('paints a rejected answer plain and reports one failure once', async () => {
		const failure = new Error('chunk 404');
		const { painter, repaint, errors } = editorWith({
			name: 'broken',
			code: {
				languages: () => [{ name: 'x', aliases: [] }],
				highlight: () => Promise.reject(failure)
			}
		});
		painter.code('let a', 'x');
		painter.code('let b', 'x');
		await settle();
		expect(repaint).not.toHaveBeenCalled();
		expect(errors).toEqual([{ plugin: 'broken', doing: 'highlight', cause: failure }]);
	});

	it('paints a throw plain and reports it', () => {
		const { painter, errors } = editorWith({
			name: 'throws',
			code: {
				languages: () => [{ name: 'x', aliases: [] }],
				highlight: () => {
					throw new Error('bad grammar');
				}
			}
		});
		expect(html(painter.code('let a', 'x'))).toBe('let a');
		expect(errors.map((error) => error.plugin)).toEqual(['throws']);
	});

	// The editor's own registrations run first, as a mount runs them.
	it('paints a language no highlighter lists plain, asking and reporting nothing', () => {
		registerEditorBuiltIns();
		const highlight = vi.fn(() => [{ from: 0, to: 3, class: 'kw' }]);
		const { painter, errors } = editorWith({
			name: 'one',
			code: { languages: () => [{ name: 'x', aliases: [] }], highlight }
		});
		expect(html(painter.code('def f(): pass', 'python'))).toBe('def f(): pass');
		expect(highlight).not.toHaveBeenCalled();
		expect(errors).toEqual([]);
	});

	it('paints plain in an editor that lists no highlighter', () => {
		registerEditorBuiltIns();
		const painter = createCodePainter(
			() => everyInstalledPlugin,
			() => {}
		);
		expect(html(painter.code('const x = 1;', 'javascript'))).toBe('const x = 1;');
	});

	it("finds a fence's owner by its first word, in any case", () => {
		const { activation } = editorWith({
			name: 'one',
			code: { languages: () => [{ name: 'javascript', aliases: ['js'] }], highlight: () => null }
		});
		expect(languageOwner('JS {1-3}', activation)?.name).toBe('javascript');
		expect(languageOwner('JavaScript title="a"', activation)?.name).toBe('javascript');
		expect(languageOwner('', activation)).toBeNull();
	});

	it('asks only the first plugin listing a spelling, and lists the union in list order', () => {
		const ones = [{ name: 'x', aliases: ['ex'] }];
		const twos = [
			{ name: 'y', aliases: ['ex'] },
			{ name: 'x', aliases: [] }
		];
		const first = vi.fn(() => [{ from: 0, to: 1, class: 'first' }]);
		const second = vi.fn(() => [{ from: 0, to: 1, class: 'second' }]);
		const { painter, activation } = editorWith(
			{ name: 'one', code: { languages: () => ones, highlight: first } },
			{ name: 'two', code: { languages: () => twos, highlight: second } }
		);
		expect(html(painter.code('a b', 'ex'))).toBe('<span class="first">a</span> b');
		expect(html(painter.code('a b', 'y'))).toBe('<span class="second">a</span> b');
		expect(highlighterLanguages(activation)).toEqual([
			{ name: 'x', aliases: ['ex'] },
			{ name: 'y', aliases: [] }
		]);
		expect(takeDevWarnsOf('code-language-owner').map((record) => record.message)).toEqual([
			'two lists ex, which an earlier plugin answers',
			'two lists x, which an earlier plugin answers'
		]);
	});
});
