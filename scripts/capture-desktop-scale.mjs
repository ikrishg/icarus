import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const outDir = '/opt/cursor/artifacts/screenshots';

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

function startStaticServer() {
	return new Promise((resolve) => {
		const server = createServer(async (req, res) => {
			const urlPath = decodeURIComponent(req.url?.split('?')[0] ?? '/');
			const filePath = path.join(
				distDir,
				urlPath === '/' ? 'index.html' : urlPath,
			);
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

async function captureViewport(page, baseUrl, width, height, filename) {
	await page.setViewportSize({ width, height });
	await page.goto(baseUrl);
	await page.waitForTimeout(3000);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(500);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(2000);

	const metrics = await page.evaluate(() => {
		const canvas = document.querySelector('canvas');
		const rect = canvas?.getBoundingClientRect();
		return {
			viewportW: window.innerWidth,
			viewportH: window.innerHeight,
			canvasW: rect?.width ?? 0,
			canvasH: rect?.height ?? 0,
			canvasLeft: rect?.left ?? 0,
			canvasTop: rect?.top ?? 0,
		};
	});

	await page.screenshot({
		path: path.join(outDir, filename),
		fullPage: false,
	});

	return metrics;
}

async function main() {
	await mkdir(outDir, { recursive: true });
	const { server, baseUrl } = await startStaticServer();
	const browser = await chromium.launch();
	const page = await browser.newPage();

	const m1280 = await captureViewport(
		page,
		baseUrl,
		1280,
		800,
		'after-desktop-1280x800-play.png',
	);
	const m1440 = await captureViewport(
		page,
		baseUrl,
		1440,
		900,
		'after-desktop-1440x900-play.png',
	);

	await browser.close();
	server.close();

	console.log(JSON.stringify({ m1280, m1440 }, null, 2));
}

main();
