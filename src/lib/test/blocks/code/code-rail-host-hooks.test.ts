// @vitest-environment jsdom
//
// Miss-analysis: the rail's host hooks shipped pinned by the compiler alone, so a rail rendering
// the run affordance with no hook installed, or handing a hook the fence lines along with the
// body, would have passed every gate.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { CodeMenuItem, CodeRunRequest } from '$lib/editor-keys';
import { CODE_MENU_LABEL, CODE_RUN_LABEL } from '$lib/a11y-strings';
import { mountCode, type MountedCode } from './mount-code';

const FENCE = '```js {1}\nconst x = 1\n```\n';

let mounted: MountedCode | null = null;

afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

function railButton(label: string): HTMLButtonElement | null {
	return mounted!.target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function openMenu(): HTMLButtonElement {
	const menu = railButton(CODE_MENU_LABEL);
	expect(menu, 'the rail rendered no menu button').not.toBeNull();
	menu!.click();
	flushSync();
	return menu!;
}

describe('the code rail’s host hooks', () => {
	it('renders neither the run nor the menu affordance for a host that installed no hook', () => {
		mounted = mountCode(FENCE, { policies: { presentationMode: () => 'live' } });

		expect(railButton(CODE_RUN_LABEL)).toBeNull();
		expect(railButton(CODE_MENU_LABEL)).toBeNull();
	});

	it('hands onRunCode the fence body, the whole info string and the block path', () => {
		const onRunCode = vi.fn<(request: CodeRunRequest) => void>();
		mounted = mountCode(FENCE, { policies: { presentationMode: () => 'live', onRunCode } });

		railButton(CODE_RUN_LABEL)!.click();
		flushSync();

		expect(onRunCode).toHaveBeenCalledWith({ code: 'const x = 1\n', info: 'js {1}', path: [0] });
	});

	it('consults codeMenuItems on every open, so its items read live state', () => {
		const codeMenuItems = vi.fn(() => [{ id: 'a', label: 'Attach', run: () => {} }]);
		mounted = mountCode(FENCE, {
			policies: { presentationMode: () => 'live', codeMenuItems }
		});

		const menu = openMenu();
		expect(codeMenuItems).toHaveBeenCalledTimes(1);
		expect(mounted.target.querySelector('.code-rail-menu')).not.toBeNull();

		menu.click();
		flushSync();
		expect(mounted.target.querySelector('.code-rail-menu')).toBeNull();

		menu.click();
		flushSync();
		expect(codeMenuItems).toHaveBeenCalledTimes(2);
	});

	it('a disabled item renders disabled and refuses activation', () => {
		const run = vi.fn();
		const items: CodeMenuItem[] = [{ id: 'export', label: 'Export', run, disabled: true }];
		mounted = mountCode(FENCE, {
			policies: { presentationMode: () => 'live', codeMenuItems: () => items }
		});
		openMenu();

		const item = mounted.target.querySelector<HTMLButtonElement>('button[role="menuitem"]');
		expect(item?.disabled).toBe(true);
		item!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();

		expect(run).not.toHaveBeenCalled();
		expect(mounted.target.querySelector('.code-rail-menu')).not.toBeNull();
	});
});
