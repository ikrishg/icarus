import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

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

async function bootToPlay(page, baseUrl) {
	await page.goto(baseUrl);
	await page.waitForTimeout(3000);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(700);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(2000);
}

async function getLevelTitle(page) {
	return page.evaluate(() => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		if (!play) return '';
		const idx = play.levelManager?.currentIndex ?? 0;
		const name = play.levelManager?.current?.name ?? '';
		return `Level ${idx + 1}: ${name}`;
	});
}

async function getColliderCount(page) {
	return page.evaluate(() => window.__icarusGetColliders?.() ?? -1);
}

async function runDesktop(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);

	const level1Title = await getLevelTitle(page);
	const colliderAtL1 = await getColliderCount(page);

	await page.locator('canvas').click();
	await page.keyboard.down('ArrowRight');
	await page.waitForTimeout(4500);
	await page.keyboard.up('ArrowRight');
	const playerXAfterWalk = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return play?.player?.sprite?.x ?? 0;
	});

	await page.keyboard.press('Semicolon');
	await page.waitForTimeout(800);
	const levelAfterCheat = await getLevelTitle(page);
	const cheatSkipped = levelAfterCheat !== level1Title;

	const colliders = [colliderAtL1];
	for (let i = 0; i < 5; i++) {
		await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			play?.resetPlayer?.();
		});
		colliders.push(await getColliderCount(page));
	}

	await browser.close();
	return {
		level1Title,
		colliderAtL1,
		playerXAfterWalk,
		cheatSkipped,
		colliders,
		stuckOnGround: playerXAfterWalk < 380,
	};
}

async function runMobile(baseUrl) {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		...devices['iPhone 12'],
		hasTouch: true,
	});
	const page = await context.newPage();
	await bootToPlay(page, baseUrl);

	const canvasBeforeMenu = await page.locator('canvas').boundingBox();
	const viewport = page.viewportSize();

	const canvasInPlay = await page.locator('canvas').boundingBox();
	const widthRatio =
		canvasInPlay && viewport ? canvasInPlay.width / viewport.width : 0;

	const touchButtonCount = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return play?.touchControls?.visible ? 1 : 0;
	});

	await browser.close();
	return { widthRatio, touchButtonCount, canvasInPlay, viewport };
}

async function main() {
	const { server, baseUrl } = await startStaticServer();
	const desktop = await runDesktop(baseUrl);
	const mobile = await runMobile(baseUrl);
	server.close();

	const collidersStable = desktop.colliders.every(
		(c) => c === desktop.colliderAtL1 && c > 0,
	);
	const pass =
		!desktop.cheatSkipped &&
		!desktop.stuckOnGround &&
		collidersStable &&
		mobile.widthRatio > 0.85 &&
		mobile.touchButtonCount === 1;

	console.log(
		JSON.stringify({ desktop, mobile, pass }, null, 2),
	);
	process.exit(pass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
