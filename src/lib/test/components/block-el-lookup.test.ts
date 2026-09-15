// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { blockContentElAt } from '$lib/components/block-el-lookup';
import { mountTableGrid } from '../selection/table-grid';

// Miss-analysis: the cell descent (a deep path through a wrapper-less cell grid) had no test of
// its own; every consumer test mounted a table and read the answer back through a caret.

function hostAt(path: number[]): { host: HTMLElement; content: HTMLElement } {
	const host = document.createElement('div');
	host.setAttribute('data-block-path', JSON.stringify(path));
	const overlay = document.createElement('div');
	overlay.className = 'selection-overlay';
	const content = document.createElement('div');
	content.setAttribute('contenteditable', 'true');
	host.append(overlay, content);
	return { host, content };
}

describe('blockContentElAt', () => {
	it('resolves a hosted path to its content element, past the chrome in front of it', () => {
		const root = document.createElement('div');
		const { host, content } = hostAt([0]);
		root.append(host);
		expect(blockContentElAt(root, [0])).toBe(content);
		expect(blockContentElAt(root, [1])).toBeNull();
	});

	it('walks a wrapper-less cell path into the table grid', () => {
		const root = document.createElement('div');
		const grid = mountTableGrid({ path: [2], rows: 2, cols: 2 });
		root.append(grid.host);
		expect(blockContentElAt(root, [2, 1, 0])).toBe(grid.cells[1][0]);
		expect(blockContentElAt(root, [2, 2, 0])).toBeNull();
		expect(blockContentElAt(root, [2, 0, 5])).toBeNull();
	});

	it('declines a short unhosted path rather than guessing a table', () => {
		const root = document.createElement('div');
		root.append(mountTableGrid({ path: [0], rows: 1, cols: 1 }).host);
		expect(blockContentElAt(root, [0, 0])).toBeNull();
	});
});
