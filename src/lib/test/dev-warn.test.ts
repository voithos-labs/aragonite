import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { devWarn } from '../dev-warn';
import { configureEditorEnv, resetEditorEnv } from '../env';

describe('devWarn', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		resetEditorEnv();
	});

	it('stays silent outside dev mode', () => {
		configureEditorEnv({ isDev: false, isTest: false });
		devWarn('tag', 'message');
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('stays silent under test, even in dev mode', () => {
		configureEditorEnv({ isDev: true, isTest: true });
		devWarn('tag', 'message');
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('warns once with the [tag] message shape in dev outside test', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		devWarn('parser', 'unexpected node');
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith('[parser] unexpected node');
	});

	it('forwards details as the second console.warn argument', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		const details = { offset: 3 };
		devWarn('cursor', 'bad offset', details);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith('[cursor] bad offset', details);
	});

	it('omits the second argument when details is undefined', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		devWarn('cursor', 'no details');
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0]).toHaveLength(1);
	});
});
