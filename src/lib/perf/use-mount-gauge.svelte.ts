/**
 * Count the calling component in the dev-mode mount gauge. Rows and list items are not
 * BlockHosts, so without this a huge windowed container would read as almost nothing mounted.
 */
import { perfEnabled, incMountedBlocks, decMountedBlocks } from './instruments';

export function useMountGauge(): void {
	$effect(() => {
		// Decided once per mount: the gauge counts up and down, so re-reading the flag at
		// teardown would let turning it on or off in between leave the count unbalanced.
		if (!perfEnabled()) return;
		incMountedBlocks();
		return decMountedBlocks;
	});
}
