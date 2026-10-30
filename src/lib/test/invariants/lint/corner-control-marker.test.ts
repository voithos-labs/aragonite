/**
 * Every hover control pinned to a block's top-right corner carries `data-corner-control` (G4.180),
 * so the open find bar moves it when it covers it. The scan finds such a control by its style:
 * absolute, placed by `top` and `right` (or `inset`), and hidden at rest by opacity or visibility.
 * Miss-analysis: the bar's rule named the code block's controls, and the diagram and equation
 * controls in the same corner went under the bar unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';
import { CORNER_CONTROL_ATTR } from '#lib/components/corner-controls.js';

const RULE = /([^{}]+)\{([^{}]*)\}/g;
const HIDDEN = /(?:^|[;\s])(?:opacity:\s*0\s*(?:;|$)|visibility:\s*hidden\b)/;

/** Whether a rule body pins its element to the top-right corner of its positioned ancestor. */
function pinnedTopRight(body: string): boolean {
	if (!/(?:^|[;\s])position:\s*absolute\b/.test(body)) return false;
	if (/(?:^|[;\s])top:/.test(body) && /(?:^|[;\s])right:/.test(body)) return true;
	const inset = body
		.match(/(?:^|[;\s])inset:\s*([^;]+)/)?.[1]
		.trim()
		.split(/\s+/);
	if (!inset) return false;
	// The shorthand's sides, filled the way CSS fills a short list.
	const [top, right = top, bottom = top, left = right] = inset;
	return top !== 'auto' && right !== 'auto' && (bottom === 'auto' || left === 'auto');
}

/** The class each selector in a list styles: the last one it names. */
const styledClasses = (selectorList: string) =>
	selectorList.split(',').flatMap((selector) => selector.match(/\.([\w-]+)[^.]*$/)?.[1] ?? []);

/** The selectors of the rules in `css` that style a hidden-at-rest top-right corner control. The
 *  hiding may sit in the same rule or in another rule styling the same class. */
function cornerControlRules(css: string): string[] {
	const rules = [...css.matchAll(RULE)].map(([, selector, body]) => ({
		selector: selector.trim(),
		body
	}));
	const hidden = new Set(
		rules.filter((rule) => HIDDEN.test(rule.body)).flatMap((rule) => styledClasses(rule.selector))
	);
	return rules
		.filter(
			({ selector, body }) =>
				pinnedTopRight(body) &&
				(HIDDEN.test(body) || styledClasses(selector).some((name) => hidden.has(name)))
		)
		.map((rule) => rule.selector);
}

const HITS = [
	'.code-rail {\n\tposition: absolute;\n\ttop: 12px;\n\tright: 8px;\n\topacity: 0;\n}',
	'.toolbar { right: 6px; position: absolute; opacity: 0; top: 6px }',
	'.copy { position: absolute; top: 6px; right: 6px; }\n.host:not(:hover) .copy { opacity: 0; }',
	'.copy { position: absolute; inset: 6px 6px auto auto; visibility: hidden; }'
];

const MISSES = [
	// Shown at rest.
	'.badge { position: absolute; top: 0; right: 0; }',
	// Half-dimmed, not hidden.
	'.tag { position: absolute; top: 0; right: 0; opacity: 0.5; }',
	// The left corner.
	'.handle { position: absolute; top: 0; left: 0; opacity: 0; }',
	// Pinned to the bottom.
	'.zone { position: absolute; bottom: 0; right: 0; opacity: 0; }',
	// Covers the whole box.
	'.veil { position: absolute; inset: 0; opacity: 0; }',
	// A different control is the one hidden.
	'.copy { position: absolute; top: 6px; right: 6px; }\n.copy-open { opacity: 0; }',
	// A child of the control is the one hidden.
	'.copy { position: absolute; top: 6px; right: 6px; }\n.copy .icon { opacity: 0; }'
];

function styleOf(code: string): string {
	return [...code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

function markupOf(code: string): string {
	return code
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
}

describe('G4.180 every top-right hover control opts in to moving below the find bar', () => {
	it.each(HITS)('the matcher flags a corner control: %s', (css) => {
		expect(cornerControlRules(css)).toHaveLength(1);
	});

	it.each(MISSES)('the matcher spares a rule that is not one: %s', (css) => {
		expect(cornerControlRules(css)).toEqual([]);
	});

	const components = collectEditorSources().filter((f) => f.relPath.endsWith('.svelte'));
	const withControls = components
		.map((f) => ({ rel: f.relPath, code: f.code, rules: cornerControlRules(styleOf(f.code)) }))
		.filter((f) => f.rules.length > 0);

	it('finds the corner controls the editor and its bundled plugins ship', () => {
		expect(withControls.map((f) => f.rel).sort()).toEqual([
			'packages/latex/src/BlockMath.svelte',
			'packages/mermaid/src/MermaidBlock.svelte',
			'src/lib/components/blocks/code/CodeBlockRail.svelte'
		]);
	});

	it('marks each one in its markup', () => {
		const unmarked = withControls
			.filter((f) => !markupOf(f.code).includes(CORNER_CONTROL_ATTR))
			.map((f) => `${f.rel}: ${f.rules.join(', ')}`);
		expect(
			unmarked,
			`a control in a block's top-right corner needs \`${CORNER_CONTROL_ATTR}\` on its element, or the open find bar covers it`
		).toEqual([]);
	});
});
