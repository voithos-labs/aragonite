// @vitest-environment jsdom
// `highlightJs(options)` as an editor asks it: a host's own grammars, a failed load, and one
// highlight.js instance per editor.
import { describe, expect, it, vi } from 'vitest';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import { highlightJs, type HighlightJsOptions } from '#packages/highlight/src/renderer.js';
import { createCodePainter } from '#lib/components/blocks/code/code-painter.js';
import { pickerAliases } from '#lib/components/blocks/code/code-languages.js';
import { activationWith } from '#lib/test/harness/code-highlighters.js';
import { microtaskCheckpoint } from '#lib/test/harness/microtask-settle.js';

function editorRunning(options: HighlightJsOptions) {
	const { activation, errors } = activationWith({
		name: 'highlight',
		code: highlightJs(options)()
	});
	const repaint = vi.fn();
	return { painter: createCodePainter(() => activation, repaint), activation, repaint, errors };
}

const tokens = (node: Node) => {
	const box = document.createElement('div');
	box.append(node);
	return [...box.querySelectorAll('span')].map((s) => `${s.className}:${s.textContent}`);
};

describe('highlightJs({ languages })', () => {
	it('asks a grammar of the host’s own by its name and its aliases, once it loads', async () => {
		const load = vi.fn(async () => ({ default: javascript }));
		const { painter, activation, repaint } = editorRunning({
			languages: { snakescript: { load, aliases: ['snk'] } }
		});
		expect(tokens(painter.code('const a', 'snk'))).toEqual([]);
		await vi.waitFor(() => expect(repaint).toHaveBeenCalledTimes(1));
		expect(tokens(painter.code('const a', 'snk'))).toEqual(['code-tok-keyword:const']);
		expect(tokens(painter.code('const b', 'snakescript'))).toEqual(['code-tok-keyword:const']);
		expect(load).toHaveBeenCalledTimes(1);
		expect(pickerAliases('snakescript', activation)).toEqual(['snk']);
	});

	// Miss-analysis: the arrival spec's failed chunk ran in Chromium only, with one fence asking.
	it('leaves a fence plain when its grammar fails to load, reporting it once', async () => {
		const failure = new Error('chunk 404');
		const { painter, repaint, errors } = editorRunning({
			languages: { broken: { load: () => Promise.reject(failure) } }
		});
		expect(tokens(painter.code('const a', 'broken'))).toEqual([]);
		expect(tokens(painter.code('const b', 'broken'))).toEqual([]);
		await microtaskCheckpoint();
		await microtaskCheckpoint();
		expect(repaint).not.toHaveBeenCalled();
		expect(errors).toEqual([{ plugin: 'highlight', doing: 'highlight', cause: failure }]);
	});

	it('lets the host’s own name win over a bundled grammar’s alias, with no owner warning', () => {
		const { painter } = editorRunning({ languages: { shell: python } });
		expect(tokens(painter.code('def f(): pass', 'shell'))).toContain('code-tok-keyword:def');
		expect(tokens(painter.code('echo hi', 'sh'))).toContain('code-tok-function:echo');
	});
});

// Miss-analysis: reset isolation was tested on the global language registry, which is gone.
describe('one highlight.js per editor', () => {
	it('paints each editor with its own grammar under one name', () => {
		const one = editorRunning({ languages: { probelang: javascript } });
		const two = editorRunning({ languages: { probelang: python } });
		const body = 'def f(): pass\nconst x = 1';
		expect(tokens(one.painter.code(body, 'probelang'))).toContain('code-tok-keyword:const');
		expect(tokens(two.painter.code(body, 'probelang'))).toContain('code-tok-keyword:def');
		expect(tokens(one.painter.code(`${body} `, 'probelang'))).not.toContain('code-tok-keyword:def');
	});
});
