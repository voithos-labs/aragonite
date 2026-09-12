/**
 * The TODO file `scripts/finn-todo.mjs` renders and reads back. The verbs talk to `gh`; these
 * are the two pure halves either side of it, so a round trip is provable without the network.
 */

import { describe, it, expect } from 'vitest';
import { renderTodo, readTodoLines, numberTodoLines } from '../../../../../scripts/finn-todo.mjs';

const ISSUES = [
	{ number: 311, title: 'drag handles for more blocks', labels: [{ name: 'area: presentation' }] },
	{ number: 310, title: 'image editing', labels: [{ name: 'area: core-editing' }] },
	{ number: 99, title: 'nobody labelled this one', labels: [] },
	{
		number: 312,
		title: 'the Ctrl+F menu wants a reskin',
		labels: [{ name: 'severity: nit' }, { name: 'area: presentation' }]
	}
];

describe('the TODO file the issues render into', () => {
	const rendered = renderTodo(ISSUES);

	it('says where the file came from and what to run', () => {
		expect(rendered).toContain('node scripts/finn-todo.mjs push');
	});

	it('groups by area, with the unlabelled issues last', () => {
		expect(rendered.match(/^## .*$/gm)).toEqual([
			'## core-editing',
			'## presentation',
			'## no area'
		]);
	});

	it('renders one unchecked line per issue, numbered and in issue order', () => {
		expect(rendered.split('\n').filter((line) => line.startsWith('- '))).toEqual([
			'- [ ] #310 image editing',
			'- [ ] #311 drag handles for more blocks',
			'- [ ] #312 the Ctrl+F menu wants a reskin',
			'- [ ] #99 nobody labelled this one'
		]);
	});

	it('reads back every issue it rendered', () => {
		const read = readTodoLines(rendered);
		expect(read.every((line) => !line.checked)).toBe(true);
		expect(read.map((line) => line.number).sort()).toEqual(
			ISSUES.map((issue) => issue.number).sort()
		);
	});
});

describe('what a hand-edited file says back', () => {
	const EDITED = [
		'<!-- generated -->',
		'',
		'## core-editing',
		'',
		'- [x] #310 image editing',
		'- [ ] #311 drag handles for more blocks',
		'- [X] a done thing nobody filed',
		'- [ ] a new thing to file',
		'',
		'a loose note, which is not a checklist line',
		'- not a checkbox either'
	].join('\n');

	it('reads the check state, the number, and the title', () => {
		expect(readTodoLines(EDITED)).toEqual([
			{ checked: true, number: 310, title: 'image editing' },
			{ checked: false, number: 311, title: 'drag handles for more blocks' },
			{ checked: true, number: null, title: 'a done thing nobody filed' },
			{ checked: false, number: null, title: 'a new thing to file' }
		]);
	});

	it('ignores everything that is not a checklist line', () => {
		expect(readTodoLines(EDITED).map((line) => line.title)).not.toContain(
			'a loose note, which is not a checklist line'
		);
	});

	it('writes a new number into its own line and leaves the rest alone', () => {
		const filed = new Map([['a new thing to file', 420]]);
		const written = numberTodoLines(EDITED, filed);
		expect(written).toContain('- [ ] #420 a new thing to file');
		expect(written).toContain('- [x] #310 image editing');
		expect(written).toContain('- [X] a done thing nobody filed');
	});

	it('keeps the check state of the line it numbers', () => {
		const written = numberTodoLines(EDITED, new Map([['a done thing nobody filed', 421]]));
		expect(written).toContain('- [X] #421 a done thing nobody filed');
	});
});
