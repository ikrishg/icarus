import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const ARTIFACT_SCREENSHOTS = '/opt/cursor/artifacts/screenshots';

async function bootToPlay(page, baseUrl, search = '') {
	const url = search ? `${baseUrl}${search.startsWith('?') ? search : `?${search}`}` : baseUrl;
	await page.goto(url);
	await page.waitForTimeout(3000);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(700);
	await page.keyboard.press('Enter');
	await page.waitForFunction(
		() => window.__icarusGame?.scene.isActive('Play') === true,
		undefined,
		{ timeout: 20000 },
	);
	await page.waitForTimeout(500);
}

async function bootToAbout(page, baseUrl) {
	await page.goto(baseUrl);
	await page.waitForFunction(() => window.__icarusGame?.scene != null);
	await page.waitForTimeout(1500);
	await page.evaluate(() => {
		const game = window.__icarusGame;
		game?.scene.start('About');
	});
	await page.waitForFunction(() => window.__icarusGame?.scene.isActive('About') === true);
	await page.waitForTimeout(500);
	try {
		mkdirSync(ARTIFACT_SCREENSHOTS, { recursive: true });
		await page.screenshot({
			path: join(ARTIFACT_SCREENSHOTS, 'about-ligatures-prod.png'),
			fullPage: true,
		});
	} catch {
		// optional in local runs
	}
}

async function getLevelIndex(page) {
	return page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return play?.levelManager?.currentIndex ?? -1;
	});
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

async function teleportToGoal(page) {
	return page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const goal = play?.levelManager?.current?.goal;
		const sprite = play?.player?.sprite;
		if (!play || !goal || !sprite?.body) return false;
		const x = goal.x;
		const y = goal.y - 24;
		sprite.setPosition(x, y);
		sprite.body.reset(x, y);
		sprite.body.updateFromGameObject();
		return true;
	});
}

async function waitForPortalAdvance(page, startIndex, timeoutMs = 10000) {
	try {
		await page.waitForFunction(
			(idx) => {
				const play = window.__icarusGame?.scene.getScene('Play');
				if (!play) return false;
				if ((play.levelManager?.currentIndex ?? 0) > idx) return true;
				return play.children.list.some(
					(c) =>
						c.type === 'Text' &&
						c.depth === 21 &&
						typeof c.text === 'string' &&
						(c.text.includes('Choose') ||
							c.text.includes('sun takes') ||
							c.text.includes('take back')),
				);
			},
			startIndex,
			{ timeout: timeoutMs },
		);
	} catch {
		return false;
	}
	return true;
}

async function dismissAbilityModals(page, startIndex) {
	for (let i = 0; i < 12; i++) {
		const idx = await getLevelIndex(page);
		if (idx > startIndex) return true;

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
						c.text.includes('Daedalus') ||
						c.text.includes('Cloud Pass') ||
						c.text.includes('returns')),
			);
		});
		if (!hasModal) {
			await page.waitForTimeout(300);
			continue;
		}
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);
	}
	return (await getLevelIndex(page)) > startIndex;
}

async function advanceLevelsViaDebugSkip(page, count) {
	const results = [];
	for (let step = 0; step < count; step++) {
		const startIndex = await getLevelIndex(page);
		if (startIndex < 0) {
			results.push(false);
			break;
		}
		const won = await page.evaluate(() =>
			window.__icarusGame?.scene.isActive('Win'),
		);
		if (won) {
			results.push(true);
			break;
		}
		await page.waitForFunction(
			() => {
				const game = window.__icarusGame;
				if (game?.scene.isActive('Win')) return true;
				const play = game?.scene.getScene('Play');
				return play && !play.isResetting;
			},
			undefined,
			{ timeout: 25000 },
		);
		await page.locator('canvas').click();
		await page.keyboard.press('Semicolon');
		await page.waitForTimeout(1400);
		const sawAdvance = await waitForPortalAdvance(page, startIndex, 20000);
		if (!sawAdvance) {
			const wonAfter = await page.evaluate(() =>
				window.__icarusGame?.scene.isActive('Win'),
			);
			results.push(wonAfter);
			break;
		}
		const cleared = await dismissAbilityModals(page, startIndex);
		await page.waitForTimeout(700);
		const endIndex = await getLevelIndex(page);
		results.push(cleared && endIndex === startIndex + 1);
	}
	return results;
}

async function advanceLevelsViaPortal(page, count) {
	const advanced = [];
	for (let step = 0; step < count; step++) {
		const startIndex = await getLevelIndex(page);
		if (startIndex < 0) {
			advanced.push(false);
			break;
		}
		await page.locator('canvas').click();
		const teleported = await teleportToGoal(page);
		if (!teleported) {
			advanced.push(false);
			break;
		}
		for (let frame = 0; frame < 8; frame++) {
			await page.waitForTimeout(50);
		}
		const sawAdvance = await waitForPortalAdvance(page, startIndex);
		if (!sawAdvance) {
			advanced.push(false);
			break;
		}
		const cleared = await dismissAbilityModals(page, startIndex);
		const endIndex = await getLevelIndex(page);
		advanced.push(cleared && endIndex === startIndex + 1);
	}
	return advanced;
}

async function runDesktop(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);

	const level1Title = await getLevelTitle(page);
	const colliderAtL1 = await getColliderCount(page);

	await page.locator('canvas').click();
	await page.keyboard.down('ArrowRight');
	await page.waitForTimeout(5500);
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

	const portalAdvanceDesktop = await advanceLevelsViaPortal(page, 1);

	await browser.close();
	return {
		level1Title,
		colliderAtL1,
		playerXAfterWalk,
		cheatSkipped,
		portalAdvanceDesktop,
		portalLevelsPassed: portalAdvanceDesktop.every(Boolean),
		colliders,
		stuckOnGround: playerXAfterWalk < 250,
	};
}

async function runDebugCheat(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl, '?debug=1');
	const level1Title = await getLevelTitle(page);
	await page.locator('canvas').click();
	await page.keyboard.press('Semicolon');
	await page.waitForTimeout(500);
	await dismissAbilityModals(page, 0);
	const levelAfterCheat = await getLevelTitle(page);
	const allLevels = await advanceLevelsViaDebugSkip(page, 14);
	const won = await page.evaluate(() =>
		window.__icarusGame?.scene.isActive('Win'),
	);
	await browser.close();
	return {
		debugCheatSkipped: levelAfterCheat !== level1Title,
		level1Title,
		levelAfterCheat,
		allLevelsDebug: allLevels,
		allFifteenReachable: allLevels.every(Boolean) && won,
	};
}

async function runLivesAndDeath(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();

	const deathMs = [];
	for (let i = 0; i < 2; i++) {
		const start = Date.now();
		await page.evaluate(() => {
			window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
		});
		await page.waitForTimeout(1750);
		const ready = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return Boolean(play && !play.isResetting && !play.player?.isDead);
		});
		if (!ready) {
			deathMs.push(-1);
		} else {
			deathMs.push(Date.now() - start);
		}
		await page.waitForTimeout(200);
	}

	const livesAfterTwo = await page.evaluate(
		() => window.__icarusGetLives?.() ?? -1,
	);
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
	});
	await page.waitForFunction(() =>
		window.__icarusGame?.scene.isActive('Dead'),
	);
	const deadAfterThird = await page.evaluate(() =>
		window.__icarusGame?.scene.isActive('Dead'),
	);

	await browser.close();
	return {
		livesAfterTwo,
		deathMs,
		deathTimingOk:
			deathMs.length === 2 &&
			deathMs.every((ms) => ms >= 1300 && ms <= 2200),
		deadAfterThird,
	};
}

async function runAboutLigatures(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToAbout(page, baseUrl);
	const aboutText = await page.evaluate(() => {
		const about = window.__icarusGame?.scene.getScene('About');
		const body = about?.creditsBody;
		if (body?.text) return body.text;
		const list = about?.children?.list ?? [];
		for (const child of list) {
			if (child.type === 'Text' && typeof child.text === 'string' && child.text.includes('Icarus')) {
				return child.text;
			}
		}
		return '';
	});
	await browser.close();
	const hasLigatureFix =
		aboutText.includes('\u200C') ||
		aboutText.toLowerCase().includes('father');
	return { hasLigatureFix, aboutTextLength: aboutText.length };
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

	const startIndex = await getLevelIndex(page);
	await page.locator('canvas').click({ force: true });
	const teleported = await teleportToGoal(page);
	for (let frame = 0; frame < 8; frame++) {
		await page.waitForTimeout(50);
	}
	const sawAdvance = await waitForPortalAdvance(page, startIndex);
	let portalMobileLevel2 = false;
	if (teleported && sawAdvance) {
		portalMobileLevel2 = await dismissAbilityModals(page, startIndex);
		portalMobileLevel2 =
			portalMobileLevel2 && (await getLevelIndex(page)) === startIndex + 1;
	}

	await browser.close();
	return {
		widthRatio,
		touchButtonCount,
		touchMoveWorked,
		touchJumpWorked,
		portalMobileLevel2,
		canvasInPlay,
		viewport,
	};
}

async function main() {
	const { server, baseUrl } = await startStaticServer();
	const desktop = await runDesktop(baseUrl);
	const debug = await runDebugCheat(baseUrl);
	const lives = await runLivesAndDeath(baseUrl);
	const about = await runAboutLigatures(baseUrl);
	const mobile = await runMobile(baseUrl);
	server.close();

	const collidersStable = desktop.colliders.every(
		(c) => c === desktop.colliderAtL1 && c > 0,
	);
	const pass =
		!desktop.cheatSkipped &&
		debug.debugCheatSkipped &&
		debug.allFifteenReachable &&
		lives.livesAfterTwo === 1 &&
		lives.deathTimingOk &&
		lives.deadAfterThird &&
		desktop.portalLevelsPassed &&
		mobile.portalMobileLevel2 &&
		about.hasLigatureFix &&
		!desktop.stuckOnGround &&
		collidersStable &&
		mobile.widthRatio > 0.85 &&
		mobile.touchButtonCount === 1 &&
		mobile.touchMoveWorked &&
		mobile.touchJumpWorked;

	console.log(
		JSON.stringify({ desktop, debug, lives, about, mobile, pass }, null, 2),
	);
	process.exit(pass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
