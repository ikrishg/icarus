import { chromium, devices } from 'playwright';
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

async function main() {
	await mkdir(outDir, { recursive: true });
	const { server, baseUrl } = await startStaticServer();

	const browser = await chromium.launch();
	const mobile = await browser.newContext({
		...devices['iPhone 12'],
		hasTouch: true,
		viewport: { width: 390, height: 844 },
	});
	const mpage = await mobile.newPage();
	await mpage.goto(baseUrl);
	await mpage.waitForTimeout(3000);
	await mpage.keyboard.press('Enter');
	await mpage.waitForTimeout(500);
	await mpage.keyboard.press('Enter');
	await mpage.waitForTimeout(2000);
	await mpage.screenshot({
		path: path.join(outDir, 'after-mobile-390x844-play.png'),
		fullPage: true,
	});

	const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await desktop.goto(baseUrl);
	await desktop.waitForTimeout(2500);
	await desktop.keyboard.press('Enter');
	await desktop.waitForTimeout(500);
	await desktop.keyboard.press('ArrowDown');
	await desktop.keyboard.press('Enter');
	await desktop.waitForTimeout(1500);
	await desktop.screenshot({
		path: path.join(outDir, 'after-about-fl-text.png'),
		fullPage: true,
	});

	await browser.close();
	server.close();
}

main();
