// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
	focusMovedOutsideReplacement,
	previewContentReparse
} from '$lib/editor-actions/replacement-focus';
import { parse } from '$lib/core/parser';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { defaultGrammarView } from '$lib/schema/block-openers';

function focusBlockAt(path: number[]): void {
	focusHostWithRawPath(JSON.stringify(path));
}

function focusHostWithRawPath(raw: string): void {
	const host = document.createElement('div');
	host.setAttribute('data-block-path', raw);
	const editable = document.createElement('div');
	editable.tabIndex = 0;
	host.appendChild(editable);
	document.body.appendChild(host);
	editable.focus();
}

describe('focusMovedOutsideReplacement', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('restores when focus fell to body (kind-change remount ate the element)', () => {
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(false);
	});

	it('restores when focus still sits inside the replaced window', () => {
		focusBlockAt([1]);
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(false);
	});

	it('skips when focus moved to a block outside the window (blur commit)', () => {
		focusBlockAt([0]);
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(true);
	});

	it('skips when focus moved to a different container subtree', () => {
		focusBlockAt([3, 0]);
		expect(focusMovedOutsideReplacement([2], 0, 1)).toBe(true);
	});

	it('restores for a nested window still holding focus', () => {
		focusBlockAt([2, 1]);
		expect(focusMovedOutsideReplacement([2], 1, 2)).toBe(false);
	});

	// A plugin may own data-block-path with a non-JSON value, and the parse runs inside
	// afterTick, outside the commit's catch, so a throw is an unhandled rejection.
	it('restores without throwing when data-block-path is non-JSON', () => {
		focusHostWithRawPath('plugin-owned-token');
		expect(() => focusMovedOutsideReplacement([], 1, 2)).not.toThrow();
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(false);
	});
});

// The trial reparse picks between the structural commit and the routine typing path and
// nothing re-decides it, so it must answer about the bytes the write actually stores, which
// a container that rewrites its body's bytes makes differ.
describe('previewContentReparse reads the owning container', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerDetailsKind();
	});

	const bodyParagraph = () => parse('body\n').children[0];

	it('reports a kind change for a bare terminator with no owner to escape it', () => {
		expect(
			previewContentReparse(bodyParagraph(), '</details>\n', defaultGrammarView, undefined, '').op
		).not.toBe('noop');
	});

	it('reports a same-kind edit once the details owner escapes the same text', () => {
		const owner = declaredPluginKind(DETAILS);
		expect(
			previewContentReparse(bodyParagraph(), '</details>\n', defaultGrammarView, owner, '').op
		).toBe('noop');
	});
});

// Miss-analysis: the trial always read a body leaf standalone, so `# ` typed into a to-do looked
// like a kind change and sent every later keystroke through its own structural commit.
describe('previewContentReparse reads a task paragraph as the commit does', () => {
	const todo = () => parse('- [ ] beta\n').children[0].children![0];

	it('reports a same-kind edit for `# ` typed after the task marker', () => {
		const item = todo();
		const text = '# beta\n';
		expect(
			previewContentReparse(item.children![0], text, defaultGrammarView, 'listItem', '', item).op
		).toBe('noop');
	});

	it('reports the kind change for the same text in a plain item', () => {
		const item = parse('- beta\n').children[0].children![0];
		expect(
			previewContentReparse(item.children![0], '# beta\n', defaultGrammarView, 'listItem', '').op
		).not.toBe('noop');
	});
});
