/**
 * Count the calling component in the dev mount gauge. Rows and list items aren't
 * BlockHosts, so without this a windowed giant container would read as ~0 mounted blocks.
 */
import { perfEnabled, incMountedBlocks, decMountedBlocks } from './instruments';

export function useMountGauge(): void {
	$effect(() => {
		// One decision per mount: the gauge is a net balance, so re-reading the flag at
		// teardown would let an arm/disarm flip unbalance it.
		if (!perfEnabled()) return;
		incMountedBlocks();
		return decMountedBlocks;
	});
}
