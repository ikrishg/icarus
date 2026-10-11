import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const distDir = path.resolve(__dirname, '..', 'dist');

const mime = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.ogg': 'audio/ogg',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
};

/**
 * Resolve a request path to a file under distDir, or null if outside dist.
 */
export function resolveDistFile(urlPath) {
	const decoded = decodeURIComponent(urlPath?.split('?')[0] ?? '/');
	const relative =
		decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
	const resolved = path.resolve(distDir, relative);
	const distRoot = distDir.endsWith(path.sep) ? distDir : `${distDir}${path.sep}`;
	if (resolved !== distDir && !resolved.startsWith(distRoot)) {
		return null;
	}
	return resolved;
}

export function startStaticServer() {
	return new Promise((resolve) => {
		const server = createServer(async (req, res) => {
			const filePath = resolveDistFile(req.url ?? '/');
			if (!filePath) {
				res.writeHead(403);
				res.end('Forbidden');
				return;
			}
			try {
				const data = await readFile(filePath);
				const ext = path.extname(filePath);
				res.writeHead(200, {
					'Content-Type': mime[ext] ?? 'application/octet-stream',
				});
				res.end(data);
			} catch {
				res.writeHead(404);
				res.end('Not found');
			}
		});
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
		});
	});
}
