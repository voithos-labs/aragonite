// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
	focusMovedOutsideReplacement,
	previewContentReparse
} from '$lib/editor-actions/replacement-focus';
import { parse } from '$lib/core/parser';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { declaredPluginKind } from '$lib/schema/plugin-kind';

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
	// afterTick — outside the ceremony's catch, so a throw is an unhandled rejection.
	it('restores without throwing when data-block-path is non-JSON', () => {
		focusHostWithRawPath('plugin-owned-token');
		expect(() => focusMovedOutsideReplacement([], 1, 2)).not.toThrow();
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(false);
	});
});

// The preview picks between the structural commit and the routine typing path and
// nothing re-decides it, so it must answer about the bytes the write actually lands —
// which a container that rewrites its body's bytes makes differ.
describe('previewContentReparse reads the owning container', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerDetailsKind();
	});

	const bodyParagraph = () => parse('body\n').children[0];

	it('reports a kind change for a bare terminator with no owner to escape it', () => {
		expect(previewContentReparse(bodyParagraph(), '</details>\n', undefined).op).not.toBe('noop');
	});

	it('reports a same-kind edit once the details owner escapes the same text', () => {
		const owner = declaredPluginKind(DETAILS);
		expect(previewContentReparse(bodyParagraph(), '</details>\n', undefined, owner).op).toBe(
			'noop'
		);
	});
});
