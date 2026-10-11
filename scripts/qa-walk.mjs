import { chromium, devices } from 'playwright';
import { startStaticServer } from './static-server.mjs';

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

async function getPlayerPos(page) {
	return page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			x: play?.player?.sprite?.x ?? 0,
			y: play?.player?.sprite?.y ?? 0,
		};
	});
}

async function tapTouchTarget(page, target) {
	const point = await page.evaluate((t) => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		const coords = play?.touchControls?.tapTargets?.[t];
		if (!coords || !game?.canvas) return null;
		const sm = game.scale;
		const rect = game.canvas.getBoundingClientRect();
		const scale = sm.displaySize.width / sm.width;
		const offsetX = rect.left + (rect.width - sm.displaySize.width) / 2;
		const offsetY = rect.top + (rect.height - sm.displaySize.height) / 2;
		return {
			x: offsetX + coords.x * scale,
			y: offsetY + coords.y * scale,
		};
	}, target);
	if (!point) return false;
	await page.touchscreen.tap(point.x, point.y);
	return true;
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
	const playerXAfterWalk = (await getPlayerPos(page)).x;

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

	const canvasInPlay = await page.locator('canvas').boundingBox();
	const viewport = page.viewportSize();
	const widthRatio =
		canvasInPlay && viewport ? canvasInPlay.width / viewport.width : 0;

	const touchButtonCount = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return play?.touchControls?.visible ? 1 : 0;
	});

	const beforeMove = await getPlayerPos(page);
	const rightPoint = await page.evaluate(() => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		const coords = play?.touchControls?.tapTargets?.right;
		if (!coords || !game?.canvas) return null;
		const sm = game.scale;
		const rect = game.canvas.getBoundingClientRect();
		const scale = sm.displaySize.width / sm.width;
		const offsetX = rect.left + (rect.width - sm.displaySize.width) / 2;
		const offsetY = rect.top + (rect.height - sm.displaySize.height) / 2;
		return {
			x: offsetX + coords.x * scale,
			y: offsetY + coords.y * scale,
		};
	});
	if (rightPoint) {
		await page.mouse.move(rightPoint.x, rightPoint.y);
		await page.mouse.down();
		await page.waitForTimeout(2500);
		await page.mouse.up();
	}
	const afterMove = await getPlayerPos(page);
	const touchMoveWorked = afterMove.x > beforeMove.x + 40;

	const jumpPoint = await page.evaluate(() => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		const coords = play?.touchControls?.tapTargets?.jump;
		if (!coords || !game?.canvas) return null;
		const sm = game.scale;
		const rect = game.canvas.getBoundingClientRect();
		const scale = sm.displaySize.width / sm.width;
		const offsetX = rect.left + (rect.width - sm.displaySize.width) / 2;
		const offsetY = rect.top + (rect.height - sm.displaySize.height) / 2;
		return {
			x: offsetX + coords.x * scale,
			y: offsetY + coords.y * scale,
		};
	});
	await page.waitForTimeout(600);
	await page.waitForFunction(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const body = play?.player?.sprite?.body;
		return body?.touching?.down === true;
	});
	let touchJumpWorked = false;
	if (jumpPoint) {
		await page.mouse.move(jumpPoint.x, jumpPoint.y);
		await page.mouse.down();
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(50);
			touchJumpWorked = await page.evaluate(() => {
				const play = window.__icarusGame?.scene.getScene('Play');
				const body = play?.player?.sprite?.body;
				return (
					(play?.player?.jumpCount ?? 0) > 0 ||
					(body?.velocity?.y ?? 0) < -80
				);
			});
			if (touchJumpWorked) break;
		}
		await page.mouse.up();
	}

	await browser.close();
	return {
		widthRatio,
		touchButtonCount,
		touchMoveWorked,
		touchJumpWorked,
		canvasInPlay,
		viewport,
	};
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
		mobile.touchButtonCount === 1 &&
		mobile.touchMoveWorked &&
		mobile.touchJumpWorked;

	console.log(JSON.stringify({ desktop, mobile, pass }, null, 2));
	process.exit(pass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
