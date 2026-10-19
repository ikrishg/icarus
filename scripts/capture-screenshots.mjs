import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const OUT = '/opt/cursor/artifacts/screenshots';
const ALL_VIEWPORTS = [
	{ tag: '1280x800', width: 1280, height: 800 },
	{ tag: '390x844', width: 390, height: 844 },
];
const VIEWPORTS = process.argv[2]
	? ALL_VIEWPORTS.filter((v) => v.tag === process.argv[2])
	: ALL_VIEWPORTS;

async function gotoGame(page, baseUrl, search = '') {
	const q = search ? (search.startsWith('?') ? search : `?${search}`) : '';
	await page.goto(`${baseUrl}${q}`);
	await page.waitForFunction(() => window.__icarusGame?.scene != null);
	await page.waitForTimeout(1200);
}

async function bootToMenu(page) {
	await page.keyboard.press('Enter');
	await page.waitForFunction(
		() => window.__icarusGame?.scene.isActive('Menu') === true,
		undefined,
		{ timeout: 15000 },
	);
	await page.waitForTimeout(400);
}

async function bootToPlay(page) {
	await bootToMenu(page);
	await page.keyboard.press('Enter');
	await page.waitForFunction(
		() => window.__icarusGame?.scene.isActive('Play') === true,
		undefined,
		{ timeout: 20000 },
	);
	await page.waitForTimeout(500);
}

async function bootToScene(page, baseUrl, scene, search = '') {
	await gotoGame(page, baseUrl, search);
	if (scene === 'Home') {
		return;
	}
	if (scene === 'Menu') {
		await bootToMenu(page);
		return;
	}
	if (scene === 'Play') {
		await bootToPlay(page);
		return;
	}
	await bootToMenu(page);
	await page.evaluate((s) => {
		const game = window.__icarusGame;
		const menu = game?.scene.getScene('Menu');
		menu?.scene.start(s);
	}, scene);
	await page.waitForFunction(
		(s) => window.__icarusGame?.scene.isActive(s) === true,
		scene,
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
}

async function shot(page, dir, name) {
	await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
}

async function getLevelIndex(page) {
	return page.evaluate(
		() =>
			window.__icarusGame?.scene.getScene('Play')?.levelManager?.currentIndex ??
			-1,
	);
}

async function waitPlayReady(page) {
	await page.waitForFunction(
		() => {
			const game = window.__icarusGame;
			if (game?.scene.isActive('Win')) return true;
			const play = game?.scene.getScene('Play');
			return play && !play.isResetting;
		},
		undefined,
		{ timeout: 30000 },
	);
}

async function dismissModals(page, startIndex) {
	for (let i = 0; i < 16; i++) {
		const idx = await getLevelIndex(page);
		if (idx > startIndex) return true;
		const won = await page.evaluate(() =>
			window.__icarusGame?.scene.isActive('Win'),
		);
		if (won) return true;
		const hasModal = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return play?.children.list.some(
				(c) =>
					c.type === 'Text' &&
					c.depth === 21 &&
					typeof c.text === 'string' &&
					(c.text.includes('Choose') ||
						c.text.includes('sun takes') ||
						c.text.includes('take back') ||
						c.text.includes('mends')),
			);
		});
		if (!hasModal) {
			await page.waitForTimeout(400);
			continue;
		}
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);
	}
	return (await getLevelIndex(page)) > startIndex;
}

async function advanceOneLevel(page) {
	const start = await getLevelIndex(page);
	if (start < 0) return false;
	await page.locator('canvas').click({ position: { x: 64, y: 64 } });
	await page.keyboard.press('Semicolon');
	await page.waitForTimeout(1600);
	await page.waitForFunction(
		(idx) => {
			const game = window.__icarusGame;
			if (game?.scene.isActive('Win')) return true;
			const play = game?.scene.getScene('Play');
			if (!play) return false;
			if ((play.levelManager?.currentIndex ?? 0) > idx) return true;
			return play.children.list.some(
				(c) =>
					c.type === 'Text' &&
					c.depth === 21 &&
					typeof c.text === 'string' &&
					(c.text.includes('Choose') ||
						c.text.includes('sun takes') ||
						c.text.includes('take back') ||
						c.text.includes('mends')),
			);
		},
		start,
		{ timeout: 30000 },
	);
	await dismissModals(page, start);
	await waitPlayReady(page);
	return (await getLevelIndex(page)) > start || (await page.evaluate(() =>
		window.__icarusGame?.scene.isActive('Win'),
	));
}

async function captureViewport(browser, baseUrl, vp) {
	const dir = join(OUT, vp.tag);
	mkdirSync(dir, { recursive: true });
	const page = await browser.newPage({
		viewport: { width: vp.width, height: vp.height },
	});
	const debug = '?debug=1';

	await bootToScene(page, baseUrl, 'Home');
	await shot(page, dir, 'home');

	await bootToScene(page, baseUrl, 'Menu');
	await shot(page, dir, 'menu');

	await bootToScene(page, baseUrl, 'About');
	await shot(page, dir, 'about');

	await bootToScene(page, baseUrl, 'Credits');
	await shot(page, dir, 'credits');

	await bootToScene(page, baseUrl, 'Play', debug);
	await page.evaluate(() => {
		window.__icarusHoldAbilityCards = true;
	});
	await waitPlayReady(page);

	for (let level = 1; level <= 15; level++) {
		await shot(page, dir, `level-${String(level).padStart(2, '0')}-start`);
		if (level < 15) {
			const before = await getLevelIndex(page);
			await page.locator('canvas').click({ position: { x: 64, y: 64 } });
			await page.keyboard.press('Semicolon');
			await page.waitForTimeout(900);
			const hasModal = await page.evaluate(() => {
				const play = window.__icarusGame?.scene.getScene('Play');
				return play?.children.list.some(
					(c) =>
						c.type === 'Text' &&
						c.depth === 21 &&
						typeof c.text === 'string' &&
						(c.text.includes('sun takes') ||
							c.text.includes('take back') ||
							c.text.includes('mends') ||
							c.text.includes('Choose')),
				);
			});
			if (hasModal) {
				const name = await page.evaluate(() => {
					const play = window.__icarusGame?.scene.getScene('Play');
					const texts = play?.children.list.filter(
						(c) =>
							c.type === 'Text' &&
							c.depth === 21 &&
							typeof c.text === 'string',
					);
					const joined = texts?.map((t) => t.text).join(' ') ?? '';
					if (
						joined.includes('take back') ||
						joined.includes('mends') ||
						joined.includes('cloud') ||
						joined.includes('Sea Wind')
					) {
						return 'regain-card';
					}
					return 'loss-card';
				});
				await shot(
					page,
					dir,
					`level-${String(before + 1).padStart(2, '0')}-${name}`,
				);
			}
			await dismissModals(page, before);
			await waitPlayReady(page);
		}
	}

	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
	});
	await page.waitForTimeout(900);
	await shot(page, dir, 'death-mid');
	await page.waitForTimeout(900);
	await waitPlayReady(page);

	await bootToScene(page, baseUrl, 'Play');
	await page.locator('canvas').click({ position: { x: 64, y: 64 } });
	for (let i = 0; i < 3; i++) {
		await waitPlayReady(page);
		await page.evaluate(() => {
			window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
		});
		if (i < 2) {
			await page.waitForTimeout(1900);
			await waitPlayReady(page);
		}
	}
	await page.waitForFunction(
		() => window.__icarusGame?.scene.isActive('Dead'),
		undefined,
		{ timeout: 30000 },
	);
	await shot(page, dir, 'game-over');

	await bootToScene(page, baseUrl, 'Play', debug);
	await waitPlayReady(page);
	for (let i = 0; i < 15; i++) {
		const won = await page.evaluate(() =>
			window.__icarusGame?.scene.isActive('Win'),
		);
		if (won) break;
		await advanceOneLevel(page);
	}
	await page.waitForFunction(() =>
		window.__icarusGame?.scene.isActive('Win'),
	);
	await shot(page, dir, 'win');

	await page.close();
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	const { server, baseUrl } = await startStaticServer();
	const browser = await chromium.launch();
	for (const vp of VIEWPORTS) {
		await captureViewport(browser, baseUrl, vp);
	}
	await browser.close();
	server.close();
	const manifest = VIEWPORTS.map((vp) => ({
		viewport: vp.tag,
		dir: join(OUT, vp.tag),
	}));
	writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
	console.log('Screenshots written to', OUT);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
