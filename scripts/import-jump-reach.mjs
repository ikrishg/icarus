import esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let cached;

export async function loadJumpReachCheck() {
	if (cached) return cached;
	const { outputFiles } = esbuild.buildSync({
		entryPoints: [join(root, 'src/util/jumpReach.ts')],
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
	});
	const url = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
	const mod = await import(url);
	cached = mod.checkAllLevelsOpeningRoutes();
	return cached;
}
