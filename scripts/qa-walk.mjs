import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { loadJumpReachCheck } from './import-jump-reach.mjs';
import { loadSanitizePixelFont } from './import-sanitize.mjs';
import { startStaticServer } from './static-server.mjs';

const ARTIFACT_SCREENSHOTS = '/opt/cursor/artifacts/screenshots';

const ABOUT_BODY_RAW = `Icarus flies toward the sun on wings of feathers and wax.
Every few levels the heat takes something. You choose what to give up: feathers, sight, speed, the way home, or your father's bow.
Four times, the sky gives a little back. Spend it well. Reach the sun.
Arrows or WASD to move. Up, W or Space to jump. Q to dash. E to shoot. Shift+R restarts the level.`;

function checkSanitizePixelFont(sanitizePixelFont) {
	const flight = sanitizePixelFont('Flight');
	const expectedFlight = 'F\u200Clight';
	const flightOk = flight === expectedFlight;
	const expectedAbout = sanitizePixelFont(ABOUT_BODY_RAW);
	return { flight, expectedFlight, flightOk, expectedAbout };
}

function expectedCanvasDisplaySize(vw, vh) {
	const scale = Math.min(vw / 1920, vh / 1080);
	return {
		scale,
		width: 1920 * scale,
		height: 1080 * scale,
	};
}

function canvasFitsViewport(game, vw, vh, tolerance = 8) {
	const expected = expectedCanvasDisplaySize(vw, vh);
	const canvas = document.querySelector('#icarus-window canvas');
	const rect = canvas?.getBoundingClientRect();
	const displayW = game?.scale?.displaySize?.width ?? 0;
	const displayH = game?.scale?.displaySize?.height ?? 0;
	const wOk =
		Math.abs((rect?.width ?? 0) - expected.width) < tolerance &&
		Math.abs(displayW - expected.width) < tolerance;
	const hOk =
		Math.abs((rect?.height ?? 0) - expected.height) < tolerance &&
		Math.abs(displayH - expected.height) < tolerance;
	return {
		wOk,
		hOk,
		ok: wOk && hOk,
		expected,
		rectW: rect?.width ?? 0,
		rectH: rect?.height ?? 0,
		displayW,
		displayH,
	};
}

function collectSceneTexts(scene, out = []) {
	if (!scene) return out;
	for (const child of scene.children?.list ?? []) {
		if (child.type === 'Text') out.push(child);
		if (child.list) collectSceneTexts(child, out);
	}
	return out;
}

function smallestScreenTextPx(game, scene) {
	if (!game || !scene) return { smallestScreenPx: 0, scale: 0 };
	const scale = Math.min(
		game.scale.displaySize.width / 1920,
		game.scale.displaySize.height / 1080,
	);
	let smallest = Infinity;
	for (const obj of collectSceneTexts(scene)) {
		if (!obj?.active) continue;
		const raw = obj.style?.fontSize ?? obj.fontSize;
		const gamePx =
			typeof raw === 'number' ? raw : parseFloat(String(raw || '0'));
		if (gamePx > 0) smallest = Math.min(smallest, gamePx * scale);
	}
	return {
		smallestScreenPx: smallest === Infinity ? 0 : smallest,
		scale,
	};
}

async function runPauseEscToggle(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	for (let cycle = 0; cycle < 3; cycle++) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(350);
		const open = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return Boolean(play?.pausePanel);
		});
		if (!open) {
			await browser.close();
			return { pauseEscOk: false, failedAt: `open-${cycle}` };
		}
		await page.keyboard.press('Escape');
		await page.waitForTimeout(350);
		const closed = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return !play?.pausePanel;
		});
		if (!closed) {
			await browser.close();
			return { pauseEscOk: false, failedAt: `close-${cycle}` };
		}
	}
	await browser.close();
	return { pauseEscOk: true };
}

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
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.clearLevelInstruction?.();
	});
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play?.player) return;
		const y = play.levelManager.current.start.y;
		play.player.revive(play.player.sprite.x, y);
		play.player.isDead = false;
		play.isResetting = false;
	});
	for (let i = 0; i < 90; i++) {
		await page.evaluate(
			() => new Promise((r) => requestAnimationFrame(r)),
		);
	}

	const deathMs = [];
	for (let i = 0; i < 2; i++) {
		const start = Date.now();
		await page.evaluate(() => {
			window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
		});
		let ready = false;
		try {
			await page.waitForFunction(
				() => {
					const play = window.__icarusGame?.scene.getScene('Play');
					return Boolean(play && !play.isResetting && !play.player?.isDead);
				},
				{ timeout: 3000 },
			);
			ready = true;
		} catch {
			ready = false;
		}
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
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play && play.lives > 1) {
			play.lives = 1;
			play.updateLivesHud?.();
		}
	});
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
	});
	await page.waitForFunction(
		() => window.__icarusGame?.scene.isActive('Dead'),
		{ timeout: 45000 },
	);
	const deadAfterThird = await page.evaluate(() =>
		window.__icarusGame?.scene.isActive('Dead'),
	);

	await browser.close();
	return {
		livesAfterTwo,
		deathMs,
		deathTimingOk:
			livesAfterTwo === 1 &&
			deathMs.length === 2 &&
			deathMs.every((ms) => ms >= 1300 && ms <= 2200),
		deadAfterThird,
	};
}

async function runAboutLigatures(baseUrl, expectedAbout) {
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
	const aboutExactOk = aboutText === expectedAbout;
	return { aboutExactOk, aboutTextLength: aboutText.length };
}

async function runGroundDash(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play?.abilityManager?.abilities) {
			play.abilityManager.abilities.dashLevel = 2;
		}
		play?.player?.sprite?.setFlipX(false);
	});

	const dashMeta = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		return {
			speed: p?.DASH_SPEED ?? 0,
			duration: p?.DASH_DURATION ?? 0,
		};
	});
	const expectedMin =
		dashMeta.speed * (dashMeta.duration / 1000) * 0.85;

	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		if (!p) return;
		const y = play.levelManager.current.start.y;
		// Open ground lane on L1: dashing from 520 runs into spikes past ~1100.
		p.revive(200, y);
		p.sprite.setFlipX(false);
		p.lastDashTime = 0;
	});
	await page.waitForTimeout(200);
	const startX = (await getPlayerPos(page)).x;
	await page.keyboard.down('KeyD');
	await page.keyboard.down('KeyQ');
	await page.waitForFunction(
		() =>
			window.__icarusGame?.scene.getScene('Play')?.player?.isDashing === true,
		{ timeout: 3000 },
	);
	await page.waitForFunction(
		() =>
			window.__icarusGame?.scene.getScene('Play')?.player?.isDashing === false,
		{ timeout: dashMeta.duration + 800 },
	);
	await page.keyboard.up('KeyQ');
	await page.keyboard.up('KeyD');
	for (let i = 0; i < 4; i++) {
		await page.evaluate(
			() => new Promise((r) => requestAnimationFrame(r)),
		);
	}
	const endX = (await getPlayerPos(page)).x;
	const delta = endX - startX;

	await browser.close();
	return {
		expectedMin,
		delta,
		groundDashOk: delta >= expectedMin,
	};
}

async function canvasPointForGame(page, gx, gy) {
	return page.evaluate(
		({ gx, gy }) => {
			const game = window.__icarusGame;
			const sm = game?.scale;
			const rect = game?.canvas?.getBoundingClientRect();
			if (!sm || !rect) return null;
			const scale = sm.displaySize.width / sm.width;
			const offsetX = rect.left + (rect.width - sm.displaySize.width) / 2;
			const offsetY = rect.top + (rect.height - sm.displaySize.height) / 2;
			return { x: offsetX + gx * scale, y: offsetY + gy * scale };
		},
		{ gx, gy },
	);
}

async function touchPointForTarget(page, targetKey) {
	return page.evaluate((targetKey) => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		const coords = play?.touchControls?.tapTargets?.[targetKey];
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
	}, targetKey);
}

async function holdTouchAt(page, screenPoint, ms = 2500) {
	if (!screenPoint) return false;
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 1,
	});
	const point = {
		x: screenPoint.x,
		y: screenPoint.y,
		radiusX: 1,
		radiusY: 1,
		force: 1,
		id: 0,
	};
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [point],
	});
	const steps = Math.max(1, Math.ceil(ms / 50));
	for (let i = 0; i < steps; i++) {
		await page.waitForTimeout(50);
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [point],
		});
	}
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	});
	return true;
}

async function holdTouchRight(page, ms = 2500) {
	return holdTouchAt(page, await touchPointForTarget(page, 'right'), ms);
}

async function holdTouchLeft(page, ms = 2500) {
	return holdTouchAt(page, await touchPointForTarget(page, 'left'), ms);
}

async function assertUnfrozenAndMoving(page) {
	const state = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			scenePaused: Boolean(play?.isPaused),
			physicsPaused: Boolean(play?.physics?.world?.isPaused),
			pausePanel: Boolean(play?.pausePanel),
		};
	});
	if (state.scenePaused || state.physicsPaused || state.pausePanel) {
		return { ok: false, reason: 'frozen', state };
	}
	const before = await getPlayerPos(page);
	await holdTouchRight(page, 1200);
	const after = await getPlayerPos(page);
	return {
		ok: after.x > before.x + 20,
		state,
		beforeX: before.x,
		afterX: after.x,
	};
}

async function portraitRoundTrip(page) {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(500);
	await page.setViewportSize({ width: 844, height: 390 });
	await page.waitForTimeout(600);
}

async function runSideEdgeClamp(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();

	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.levelManager?.goto(1);
		play?.resetPlayer();
		play?.clearLevelInstruction?.();
		if (play?.abilityManager?.abilities) {
			play.abilityManager.abilities.canMoveLeft = true;
		}
		if (play?.pausePanel) play.closePause();
		const p = play?.player;
		const body = p?.sprite?.body;
		if (!p || !body) return;
		const minCenter = body.halfWidth;
		p.sprite.setPosition(minCenter, 956);
		body.updateFromGameObject();
		p.clampHorizontalWorldBounds(body);
	});
	const leftSamples = [];
	await page.keyboard.down('ArrowLeft');
	for (let i = 0; i < 60; i++) {
		await page.waitForTimeout(16);
		leftSamples.push(
			await page.evaluate(
				() =>
					window.__icarusGame?.scene.getScene('Play')?.player?.sprite?.body
						?.center?.x ?? 0,
			),
		);
	}
	await page.keyboard.up('ArrowLeft');
	const leftRange =
		Math.max(...leftSamples) - Math.min(...leftSamples);
	const leftEdge = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		const body = p?.sprite?.body;
		if (!p || !body) return { ok: false, x: 0, minX: 0 };
		const minCenter = body.halfWidth;
		const alive = !p.isDead && !play.isResetting && play.scene.isActive('Play');
		return {
			ok: alive && body.center.x >= minCenter - 1,
			x: body.center.x,
			minX: minCenter,
		};
	});

	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play?.pausePanel) play.closePause();
		const p = play?.player;
		const body = p?.sprite?.body;
		const camW = play?.cameras?.main?.width ?? 1920;
		if (!p || !body) return;
		const maxCenter = camW - body.halfWidth;
		p.sprite.setPosition(maxCenter, 956);
		body.updateFromGameObject();
		p.clampHorizontalWorldBounds(body);
		p.isDead = false;
		play.isResetting = false;
	});
	const rightSamples = [];
	await page.keyboard.down('ArrowRight');
	for (let i = 0; i < 60; i++) {
		await page.waitForTimeout(16);
		rightSamples.push(
			await page.evaluate(
				() =>
					window.__icarusGame?.scene.getScene('Play')?.player?.sprite?.body
						?.center?.x ?? 0,
			),
		);
	}
	await page.keyboard.up('ArrowRight');
	const rightRange =
		Math.max(...rightSamples) - Math.min(...rightSamples);
	const rightEdge = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		const body = p?.sprite?.body;
		const camW = play?.cameras?.main?.width ?? 1920;
		if (!p || !body) return { ok: false, x: 0, maxX: 0 };
		const maxCenter = camW - body.halfWidth;
		const alive = !p.isDead && !play.isResetting && play.scene.isActive('Play');
		return {
			ok: alive && body.center.x <= maxCenter + 1,
			x: body.center.x,
			maxX: maxCenter,
		};
	});

	const fallKills = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		if (!p) return false;
		p.isDead = false;
		p.controlsEnabled = true;
		play.isResetting = false;
		p.sprite.setPosition(400, play.cameras.main.height + 200);
		const body = p.sprite.body;
		body?.reset(400, play.cameras.main.height + 200);
		body?.updateFromGameObject?.();
		play.update();
		return p.isDead || play.isResetting;
	});

	await browser.close();
	return {
		leftEdge,
		rightEdge,
		fallKills,
		leftRange,
		rightRange,
		wallJitterOk: leftRange <= 1 && rightRange <= 1,
		sideEdgeClampOk:
			leftEdge.ok &&
			rightEdge.ok &&
			fallKills === true &&
			leftRange <= 1 &&
			rightRange <= 1,
	};
}

async function runCanvasOrientationResize(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	await page.goto(baseUrl);
	await page.waitForFunction(() => window.__icarusGame?.scene != null);
	await page.waitForTimeout(1200);
	const sequence = [
		{ width: 390, height: 844 },
		{ width: 844, height: 390 },
		{ width: 390, height: 844 },
		{ width: 844, height: 390 },
	];
	for (const size of sequence) {
		await page.setViewportSize(size);
		await page.waitForTimeout(700);
	}
	const after = await page.evaluate(() => {
		const game = window.__icarusGame;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const scale = Math.min(vw / 1920, vh / 1080);
		const expectedW = 1920 * scale;
		const expectedH = 1080 * scale;
		const canvas = document.querySelector('#icarus-window canvas');
		const rect = canvas?.getBoundingClientRect();
		const displayW = game?.scale?.displaySize?.width ?? 0;
		const displayH = game?.scale?.displaySize?.height ?? 0;
		const tolerance = 8;
		const wOk =
			Math.abs((rect?.width ?? 0) - expectedW) < tolerance &&
			Math.abs(displayW - expectedW) < tolerance;
		const hOk =
			Math.abs((rect?.height ?? 0) - expectedH) < tolerance &&
			Math.abs(displayH - expectedH) < tolerance;
		return {
			vw,
			vh,
			wOk,
			hOk,
			ok: wOk && hOk,
			expectedW,
			expectedH,
			rectW: rect?.width ?? 0,
			rectH: rect?.height ?? 0,
			displayW,
			displayH,
		};
	});
	await browser.close();
	return {
		...after,
		canvasResizeOk: after.ok === true,
	};
}

async function runPortraitGameplayPause(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	const portraitBoot = await page.evaluate(() => {
		const blocker = document.getElementById('portrait-blocker');
		const style = blocker ? getComputedStyle(blocker) : null;
		const blockerVisible =
			blocker &&
			style?.display !== 'none' &&
			style?.visibility !== 'hidden';
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			blockerVisible,
			scenePaused: Boolean(play?.isPaused),
			physicsPaused: Boolean(play?.physics?.world?.isPaused),
		};
	});
	await page.setViewportSize({ width: 844, height: 390 });
	await page.waitForTimeout(600);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play?.pausePanel) play.closePause();
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(700);
	const afterRotate = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			scenePaused: Boolean(play?.isPaused),
			physicsPaused: Boolean(play?.physics?.world?.isPaused),
		};
	});
	await browser.close();
	const portraitPauseOk =
		portraitBoot.blockerVisible &&
		portraitBoot.scenePaused &&
		portraitBoot.physicsPaused &&
		afterRotate.scenePaused &&
		afterRotate.physicsPaused;
	return { portraitPauseOk, portraitBoot, afterRotate };
}

async function runPortraitPauseEdgeCases(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	await page.keyboard.press('Escape');
	await page.waitForTimeout(350);
	const userPauseOpen = await page.evaluate(() =>
		Boolean(window.__icarusGame?.scene.getScene('Play')?.pausePanel),
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(600);
	const userPausePortrait = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			panel: Boolean(play?.pausePanel),
			physicsPaused: Boolean(play?.physics?.world?.isPaused),
		};
	});
	await page.setViewportSize({ width: 844, height: 390 });
	await page.waitForTimeout(500);
	const userPauseLandscape = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			panel: Boolean(play?.pausePanel),
			physicsPaused: Boolean(play?.physics?.world?.isPaused),
		};
	});
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play?.pausePanel) play.closePause();
	});
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
	});
	await page.waitForTimeout(250);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(2000);
	const deathPortraitMid = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return Boolean(play?.isPaused || play?.physics?.world?.isPaused);
	});
	await page.waitForTimeout(1800);
	const deathPortraitAfter = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const alive = !play?.player?.isDead && !play?.isResetting;
		return {
			alive,
			paused: Boolean(play?.isPaused || play?.physics?.world?.isPaused),
		};
	});
	await browser.close();
	const userPauseStaysOk =
		userPauseOpen &&
		userPausePortrait.panel &&
		userPausePortrait.physicsPaused &&
		userPauseLandscape.panel &&
		userPauseLandscape.physicsPaused;
	const deathPortraitPauseOk =
		deathPortraitMid && deathPortraitAfter.alive && deathPortraitAfter.paused;
	return {
		portraitPauseEdgeOk: userPauseStaysOk && deathPortraitPauseOk,
		userPauseStaysOk,
		deathPortraitPauseOk,
	};
}

async function runDisplayPolicyChecks(baseUrl) {
	const browser = await chromium.launch();
	const desktopPage = await browser.newPage({
		viewport: { width: 500, height: 800 },
		hasTouch: false,
	});
	await bootToPlay(desktopPage, baseUrl);
	const desktopNarrow = await desktopPage.evaluate(() => {
		const blocker = document.getElementById('portrait-blocker');
		const style = blocker ? getComputedStyle(blocker) : null;
		const blockerVisible = blocker && style?.display === 'flex';
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			blockerVisible,
			physicsPaused: Boolean(play?.physics?.world?.isPaused),
			pausePanel: Boolean(play?.pausePanel),
		};
	});
	await desktopPage.close();
	const tabletPage = await browser.newPage({
		viewport: { width: 768, height: 1024 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(tabletPage, baseUrl);
	const tabletPortrait = await tabletPage.evaluate(() => {
		const blocker = document.getElementById('portrait-blocker');
		const style = blocker ? getComputedStyle(blocker) : null;
		const blockerVisible = blocker && style?.display === 'flex';
		const play = window.__icarusGame?.scene.getScene('Play');
		return {
			blockerVisible,
			pausePanel: Boolean(play?.pausePanel),
			scenePaused: Boolean(play?.isPaused),
		};
	});
	await tabletPage.close();
	await browser.close();
	return {
		desktopNarrowOk:
			!desktopNarrow.blockerVisible && !desktopNarrow.physicsPaused,
		tabletPortraitOk:
			!tabletPortrait.blockerVisible &&
			!tabletPortrait.pausePanel &&
			!tabletPortrait.scenePaused,
		desktopNarrow,
		tabletPortrait,
	};
}

function rectsOverlap(a, b) {
	return (
		a.left < b.right &&
		a.right > b.left &&
		a.top < b.bottom &&
		a.bottom > b.top
	);
}

async function runTouchTitleChromeClearance(baseUrl) {
	const viewports = [
		{ width: 640, height: 360 },
		{ width: 844, height: 390 },
		{ width: 932, height: 430 },
	];
	const failures = [];
	const browser = await chromium.launch();
	for (const vp of viewports) {
		const page = await browser.newPage({
			viewport: vp,
			isMobile: true,
			hasTouch: true,
		});
		await bootToPlay(page, baseUrl);
		for (let level = 0; level < 15; level++) {
			const result = await page.evaluate(async (idx) => {
				const play = window.__icarusGame?.scene.getScene('Play');
				if (!play?.touchControls?.visible) return { ok: true };
				play.levelManager.goto(idx);
				play.resetPlayer();
				await new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				);
				if (play.pausePanel) play.closePause();
				play.setGameplayHudVisible(true);
				play.showLevelInstruction();
				const chrome = play.touchControls.getChromeBounds?.() ?? [];
				const targets = [];
				const title = play.levelManager.getHudTitle?.();
				if (title?.getBounds) {
					const tb = title.getBounds();
					targets.push({
						left: tb.left,
						right: tb.right,
						top: tb.top,
						bottom: tb.bottom,
						kind: 'title',
					});
				}
				for (const o of play.levelManager.getWorldObstacleBounds?.() ??
					[]) {
					targets.push({ ...o, kind: 'obstacle' });
				}
				if (play.instructionPanel?.active) {
					const ib = play.instructionPanel.getBounds();
					targets.push({
						left: ib.left,
						right: ib.right,
						top: ib.top,
						bottom: ib.bottom,
						kind: 'instruction-panel',
					});
				}
				if (play.instructionText?.active) {
					const it = play.instructionText.getBounds();
					targets.push({
						left: it.left,
						right: it.right,
						top: it.top,
						bottom: it.bottom,
						kind: 'instruction-text',
					});
				}
				if (play.livesText?.active && play.livesText.getBounds) {
					const lb = play.livesText.getBounds();
					targets.push({
						left: lb.left,
						right: lb.right,
						top: lb.top,
						bottom: lb.bottom,
						kind: 'lives',
					});
				}
				const overlap = chrome.some((c) =>
					targets.some(
						(t) =>
							c.left < t.right &&
							c.right > t.left &&
							c.top < t.bottom &&
							c.bottom > t.top,
					),
				);
				return { ok: !overlap, chrome, targets };
			}, level);
			if (!result.ok) {
				failures.push({ viewport: vp, level: level + 1, ...result });
			}
		}
		await page.close();
	}
	await browser.close();
	return { touchTitleChromeOk: failures.length === 0, failures };
}

function hazardXsInWindow(level, minX, maxX) {
	const hits = [];
	for (const o of level.obstacles ?? []) {
		if (o.type === 'fireball' && o.x >= minX && o.x <= maxX) {
			hits.push(o.x);
		}
		if (o.type === 'spikes') {
			const scale = o.size / 129;
			const w = 402 * scale;
			for (let i = 0; i < o.count; i++) {
				const sx = o.x + i * w;
				if (sx >= minX && sx <= maxX) hits.push(sx);
			}
		}
	}
	return hits;
}

async function runTouchSpawnSafety(baseUrl) {
	const viewports = [
		{ width: 640, height: 360 },
		{ width: 844, height: 390 },
		{ width: 932, height: 430 },
	];
	const failures = [];
	const browser = await chromium.launch();
	for (const vp of viewports) {
		const page = await browser.newPage({
			viewport: vp,
			isMobile: true,
			hasTouch: true,
		});
		await bootToPlay(page, baseUrl);
		for (let level = 0; level < 15; level++) {
			const result = await page.evaluate(async (idx) => {
				const play = window.__icarusGame?.scene.getScene('Play');
				if (!play?.touchControls?.visible) return { ok: true };
				window.__icarusPrepareLevel?.(idx);
				await new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				);
				const levelDef = play.levelManager.current;
				const startX = levelDef.start.x;
				const spawnX = play.player.sprite.x;
				const delta = spawnX - startX;
				const body = play.player.sprite.body;
				const clusterMin = play.touchControls.getMinSpawnX(
					body?.halfWidth ?? 0,
				);
				const maxDelta = Math.max(
					72,
					clusterMin - startX,
					clusterMin + 72 - startX,
				);
				const windowPx = 250;
				const touchHazards = (min, max) => {
					const hits = [];
					for (const o of levelDef.obstacles ?? []) {
						if (o.type === 'fireball' && o.x >= min && o.x <= max) {
							hits.push(o.x);
						}
						if (o.type === 'spikes') {
							const scale = o.size / 129;
							const w = 402 * scale;
							for (let i = 0; i < o.count; i++) {
								const sx = o.x + i * w;
								if (sx >= min && sx <= max) hits.push(sx);
							}
						}
					}
					return hits;
				};
				const touchOnly = touchHazards(
					spawnX + 1,
					spawnX + windowPx,
				).filter(
					(hx) =>
						!touchHazards(startX + 1, startX + windowPx).includes(hx),
				);
				const playerRect = body
					? {
							left: body.left,
							right: body.right,
							top: body.top,
							bottom: body.bottom,
						}
					: null;
				const leftButtons =
					play.touchControls.getLeftMovementButtonBounds?.() ?? [];
				const overlapsLeftCluster =
					spawnX < clusterMin - 1 &&
					playerRect != null &&
					leftButtons.some(
						(b) =>
							playerRect.left < b.right - 0.5 &&
							playerRect.right > b.left + 0.5 &&
							playerRect.top < b.bottom &&
							playerRect.bottom > b.top,
					);
				return {
					ok:
						delta >= 0 &&
						delta <= maxDelta + 2 &&
						touchOnly.length === 0 &&
						!overlapsLeftCluster,
					spawnX,
					startX,
					delta,
					touchOnlyHazards: touchOnly,
					overlapsLeftCluster,
				};
			}, level);
			if (!result.ok) failures.push({ viewport: vp, level: level + 1, ...result });
		}
		await page.close();
	}
	await browser.close();
	return { touchSpawnOk: failures.length === 0, failures };
}

async function sampleBodyCenterRaf(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				requestAnimationFrame(() => {
					const body =
						window.__icarusGame?.scene.getScene('Play')?.player?.sprite
							?.body;
					resolve(body?.center?.x ?? 0);
				});
			}),
	);
}

async function collectWallHoldSamples(page, { levelIdx, side, mobile, frames }) {
	await page.keyboard.up('ArrowLeft');
	await page.keyboard.up('ArrowRight');
	const prepared = await page.evaluate(
		({ levelIdx, side }) => {
			const play = window.__icarusGame?.scene.getScene('Play');
			if (!play?.player) return { ok: false, reason: 'no-play' };
			const ready = window.__icarusPrepareLevel?.(levelIdx);
			if (!ready) return { ok: false, reason: 'prepare-failed' };
			if (play.abilityManager?.abilities) {
				play.abilityManager.abilities.canMoveLeft = true;
			}
			const body = play.player.sprite.body;
			if (!body) return { ok: false, reason: 'no-body' };
			const startY = play.levelManager.current.start.y;
			const minCenter = body.halfWidth;
			const maxCenter = 1920 - body.halfWidth;
			const target = side === 'left' ? minCenter : maxCenter;
			play.player.sprite.setPosition(
				play.player.sprite.x + (target - body.center.x),
				startY,
			);
			body.updateFromGameObject();
			play.player.clampHorizontalWorldBounds(body);
			play.player.sprite.setVelocity(0, 0);
			return { ok: true };
		},
		{ levelIdx, side },
	);
	if (!prepared?.ok) {
		return { ok: false, reason: prepared?.reason ?? 'prepare' };
	}
	await page.waitForTimeout(120);
	await page.evaluate(({ side }) => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const body = play?.player?.sprite?.body;
		if (!play?.player || !body) return;
		const minCenter = body.halfWidth;
		const maxCenter = 1920 - body.halfWidth;
		const target = side === 'left' ? minCenter : maxCenter;
		const startY = play.levelManager.current.start.y;
		play.player.sprite.setPosition(
			play.player.sprite.x + (target - body.center.x),
			startY,
		);
		body.updateFromGameObject();
		play.player.clampHorizontalWorldBounds(body);
		body.updateFromGameObject();
		play.player.sprite.setVelocity(0, 0);
	}, { side });
	await page.waitForTimeout(80);
	const centers = [];
	if (mobile) {
		const targetKey = side === 'right' ? 'right' : 'left';
		const screenPoint = await touchPointForTarget(page, targetKey);
		if (!screenPoint) {
			return { ok: false, reason: 'missing-touch-target' };
		}
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 1,
		});
		const point = {
			x: screenPoint.x,
			y: screenPoint.y,
			radiusX: 1,
			radiusY: 1,
			force: 1,
			id: 0,
		};
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [point],
		});
		for (let i = 0; i < frames; i++) {
			centers.push(await sampleBodyCenterRaf(page));
			await page.waitForTimeout(16);
			await client.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [point],
			});
		}
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		});
	} else {
		const key = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
		await page.keyboard.down(key);
		for (let i = 0; i < frames; i++) {
			centers.push(await sampleBodyCenterRaf(page));
			await page.waitForTimeout(16);
		}
		await page.keyboard.up(key);
	}
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play) return;
		play.isResetting = false;
		if (play.player) {
			play.player.isDead = false;
			play.player.controlsEnabled = true;
		}
		try {
			play.physics?.resume();
		} catch {
			// ignore
		}
	});
	await page.waitForTimeout(80);
	const expected = await page.evaluate((side) => {
		const body =
			window.__icarusGame?.scene.getScene('Play')?.player?.sprite?.body;
		if (!body) return 0;
		return side === 'left' ? body.halfWidth : 1920 - body.halfWidth;
	}, side);
	const range = Math.max(...centers) - Math.min(...centers);
	const maxDev = Math.max(...centers.map((c) => Math.abs(c - expected)));
	const inWorld = await page.evaluate(() => {
		const body =
			window.__icarusGame?.scene.getScene('Play')?.player?.sprite?.body;
		if (!body) return false;
		return body.left >= -0.5 && body.right <= 1920.5;
	});
	return {
		ok:
			centers.length === frames &&
			range <= 1 &&
			maxDev <= 1 &&
			inWorld,
		range,
		maxDev,
		expected,
		centers,
	};
}

async function runWallJitterPlatformGuard(page) {
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.closePause?.();
		if (play) {
			play.isPaused = false;
			play.isResetting = false;
			try {
				play.physics.resume();
			} catch {
				// ignore
			}
		}
	});
	const setup = await page.evaluate(() => {
		window.__icarusPrepareLevel?.(0);
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.setupLevelColliders?.();
		const player = play?.player;
		const body = player?.sprite?.body;
		if (!play || !player || !body) return { ok: false };
		let plat = null;
		for (const child of play.levelManager.platforms.getChildren()) {
			const pb = child.body;
			if (!pb || pb.width >= 1800 || pb.width > 600) continue;
			if (!plat || pb.left < plat.left) {
				plat = pb;
			}
		}
		if (!plat) return { ok: false, reason: 'no-platform' };
		const platformMin = plat.left + body.halfWidth;
		const y = plat.top + plat.height * 0.5;
		const startCenter = platformMin + 2;
		player.sprite.setPosition(startCenter, y);
		body.updateFromGameObject();
		player.sprite.setPosition(
			player.sprite.x + (startCenter - body.center.x),
			y,
		);
		body.updateFromGameObject();
		body.setAllowGravity(false);
		player.sprite.setVelocity(0, 0);
		return {
			ok: true,
			anchor: body.center.x,
			platformMin,
			worldMin: body.halfWidth,
		};
	});
	if (!setup?.ok) {
		return { ok: false, reason: setup?.reason ?? 'setup' };
	}
	await page.waitForTimeout(80);
	await page.keyboard.down('ArrowLeft');
	const centers = [];
	for (let i = 0; i < 60; i++) {
		centers.push(await sampleBodyCenterRaf(page));
		await page.waitForTimeout(16);
	}
	await page.keyboard.up('ArrowLeft');
	const range = Math.max(...centers) - Math.min(...centers);
	const minCenter = Math.min(...centers);
	const maxCenter = Math.max(...centers);
	return {
		ok:
			range <= 1 &&
			minCenter >= setup.platformMin - 2 &&
			maxCenter <= setup.platformMin + 2 &&
			minCenter > setup.worldMin + 40,
		minCenter,
		range,
		anchor: setup.anchor,
		platformMin: setup.platformMin,
		centers,
	};
}

async function runWallJitterHold(baseUrl) {
	const levelIdxs = [0, 4, 9, 14];
	const runs = 5;
	const frames = 60;
	const failures = [];

	const browser = await chromium.launch();
	for (const mobile of [false, true]) {
		const page = await browser.newPage(
			mobile
				? {
						viewport: { width: 844, height: 390 },
						isMobile: true,
						hasTouch: true,
					}
				: { viewport: { width: 1280, height: 720 } },
		);
		await bootToPlay(page, baseUrl);
		await page.locator('canvas').click();
		for (const levelIdx of levelIdxs) {
			for (const side of ['left', 'right']) {
				for (let run = 0; run < runs; run++) {
					const result = await collectWallHoldSamples(page, {
						levelIdx,
						side,
						mobile,
						frames,
					});
					if (!result.ok) {
						failures.push({
							mobile,
							level: levelIdx + 1,
							side,
							run,
							...result,
						});
					}
				}
			}
		}
		const platformGuard = await runWallJitterPlatformGuard(page);
		if (!platformGuard.ok) {
			failures.push({ mobile, kind: 'platform-guard', ...platformGuard });
		}
		await page.close();
	}
	await browser.close();
	return {
		wallJitterHoldOk: failures.length === 0,
		failures,
	};
}

async function runPausePanelLayout(baseUrl) {
	const viewports = [
		{ width: 640, height: 360, mobile: true },
		{ width: 844, height: 390, mobile: true },
		{ width: 932, height: 430, mobile: true },
		{ width: 1280, height: 720, mobile: false },
	];
	const failures = [];
	const browser = await chromium.launch();
	for (const vp of viewports) {
		const page = await browser.newPage(
			vp.mobile
				? { viewport: vp, isMobile: true, hasTouch: true }
				: { viewport: vp },
		);
		await bootToPlay(page, baseUrl);
		await page.evaluate(() => {
			window.__icarusGame?.scene.getScene('Play')?.requestPause();
		});
		await page.waitForTimeout(300);
		const layout = await page.evaluate((mobile) => {
			const play = window.__icarusGame?.scene.getScene('Play');
			const texts =
				play?.pausePanel?.list?.filter((c) => c.type === 'Text') ?? [];
			const byLabel = {};
			let pausedBounds = null;
			for (const t of texts) {
				const b = t.getBounds();
				if (t.text === 'Paused') {
					pausedBounds = { top: b.top, bottom: b.bottom };
					continue;
				}
				if (t.text.startsWith('Esc:')) continue;
				byLabel[t.text] = { top: b.top, bottom: b.bottom };
			}
			const resume = byLabel.Resume;
			const restart = byLabel['Restart level'];
			const quit = byLabel['Quit to menu'];
			if (!pausedBounds || !resume || !quit) {
				return { ok: false, reason: 'missing-text' };
			}
			const gapTitleResume = resume.top - pausedBounds.bottom;
			const gapResumeRestart = restart
				? restart.top - resume.bottom
				: Infinity;
			const gapRestartQuit = restart
				? quit.top - restart.bottom
				: quit.top - resume.bottom;
			const gapsOk = mobile
				? gapTitleResume >= 16 &&
					gapResumeRestart >= 16 &&
					gapRestartQuit >= 16
				: gapTitleResume >= 16 && gapRestartQuit >= 16;
			return {
				ok: gapsOk,
				gapTitleResume,
				gapResumeRestart,
				gapRestartQuit,
			};
		}, vp.mobile);
		if (!layout.ok) failures.push({ viewport: vp, ...layout });
		await page.close();
	}
	await browser.close();
	return { pausePanelLayoutOk: failures.length === 0, failures };
}

async function runTouchButtonPlatformClearance(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 640, height: 360 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	const result = await page.evaluate(async () => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.levelManager.goto(14);
		play.resetPlayer();
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		);
		const jump = play.touchControls.tapTargets?.jump;
		const size = play.touchControls.getGameplayButtonBounds?.()?.[0];
		const half =
			size != null
				? Math.max((size.right - size.left) / 2, (size.bottom - size.top) / 2)
				: 48;
		const jumpRect = jump
			? {
					left: jump.x - half,
					right: jump.x + half,
					top: jump.y - half,
					bottom: jump.y + half,
				}
			: null;
		const platforms = [];
		for (const child of play.levelManager.platforms?.getChildren?.() ?? []) {
			const body = child.body;
			if (!body) continue;
			if (body.right - body.left >= 1800) continue;
			platforms.push({
				left: body.left,
				right: body.right,
				top: body.top,
				bottom: body.bottom,
			});
		}
		const overlap =
			jumpRect != null &&
			platforms.some(
				(p) =>
					jumpRect.left < p.right &&
					jumpRect.right > p.left &&
					jumpRect.top < p.bottom &&
					jumpRect.bottom > p.top,
			);
		return { touchButtonPlatformOk: !overlap, jumpRect, platformCount: platforms.length };
	});
	await browser.close();
	return result;
}

async function resetPlayLevel(page, levelIdx = 0) {
	await page.evaluate((levelIdx) => {
		window.__icarusPrepareLevel?.(levelIdx);
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.syncPortraitBlockerPause?.();
	}, levelIdx);
	await page.waitForTimeout(300);
}

async function runTouchRelayoutClearsHold(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	const rightPoint = await touchPointForTarget(page, 'right');
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 1,
	});
	const point = {
		x: rightPoint.x,
		y: rightPoint.y,
		radiusX: 1,
		radiusY: 1,
		force: 1,
		id: 0,
	};
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [point],
	});
	await page.waitForTimeout(400);
	await page.setViewportSize({ width: 640, height: 360 });
	await page.waitForTimeout(500);
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	});
	await page.waitForTimeout(400);
	const before = await getPlayerPos(page);
	await page.waitForTimeout(800);
	const after = await getPlayerPos(page);
	const touchState = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const input = play?.touchControls?.getInput?.();
		return {
			right: Boolean(input?.right),
			left: Boolean(input?.left),
		};
	});
	await browser.close();
	const movedWhileIdle = Math.abs(after.x - before.x) > 8;
	return {
		touchRelayoutClearsHoldOk:
			!touchState.right && !touchState.left && !movedWhileIdle,
		beforeX: before.x,
		afterX: after.x,
		touchState,
	};
}

async function runPortraitUnfreezeCases(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play) {
			play.lives = 99;
			play.updateLivesHud?.();
		}
	});

	// Death: portrait round-trip during death, then unfreeze + move
	await resetPlayLevel(page, 0);
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall');
	});
	await page.waitForTimeout(200);
	await portraitRoundTrip(page);
	await page.waitForTimeout(4500);
	const deathCase = await assertUnfrozenAndMoving(page);

	// Loss card
	await resetPlayLevel(page, 0);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.clearLevelInstruction?.();
		play.isResetting = true;
		play.abilityManager.abilities.jumpLevel = 3;
		play.abilityManager.abilities.visionLevel = 1;
		play.showAbilityChoiceScreen();
	});
	await page.waitForTimeout(400);
	await portraitRoundTrip(page);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const btn = play.children.list.find(
			(c) =>
				c.type === 'Rectangle' &&
				c.depth === 21 &&
				c.input &&
				c.getData?.('abilityKey'),
		);
		btn?.emit('pointerdown');
		play.syncPortraitBlockerPause?.();
	});
	await page.waitForTimeout(800);
	let lossCase = await assertUnfrozenAndMoving(page);
	if (!lossCase.ok) {
		await page.evaluate(() =>
			window.__icarusGame?.scene.getScene('Play')?.syncPortraitBlockerPause?.(),
		);
		lossCase = await assertUnfrozenAndMoving(page);
	}

	// Gain card
	await resetPlayLevel(page, 0);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.clearLevelInstruction?.();
		play.isResetting = true;
		play.abilityManager.abilities.jumpLevel = 0;
		play.abilityManager.abilities.dashLevel = 1;
		play.abilityManager.abilities.visionLevel = 0;
		play.showAbilityGainScreen();
	});
	await page.waitForTimeout(400);
	await portraitRoundTrip(page);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const abilityBtn = play.children.list.find(
			(c) =>
				c.type === 'Rectangle' &&
				c.depth === 21 &&
				c.input &&
				c.getData?.('abilityKey'),
		);
		abilityBtn?.emit('pointerdown');
	});
	await page.waitForTimeout(250);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const doneBg = play.children.list.find(
			(c) => c.type === 'Rectangle' && c.depth === 23 && c.input,
		);
		doneBg?.emit('pointerdown');
	});
	await page.waitForTimeout(800);
	const gainCase = await assertUnfrozenAndMoving(page);

	// Level: portrait round-trip with gameplay chrome hidden (no manual unpause)
	await resetPlayLevel(page, 0);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play) return;
		play.isResetting = true;
		play.touchControls?.setGameplayVisible(false);
	});
	await portraitRoundTrip(page);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play?.scene?.isActive()) return;
		play.isResetting = false;
		play.touchControls?.setGameplayVisible(true);
		play.syncPortraitBlockerPause?.();
		play.resetPlayer();
	});
	await page.waitForTimeout(400);
	const levelCase = await assertUnfrozenAndMoving(page);

	await browser.close();
	return {
		portraitUnfreezeOk:
			deathCase.ok &&
			lossCase.ok &&
			gainCase.ok &&
			levelCase.ok,
		deathCase,
		lossCase,
		gainCase,
		levelCase,
	};
}

async function runGainDoneLayout(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.abilityManager.abilities.jumpLevel = 1;
		play.abilityManager.abilities.dashLevel = 1;
		play.isResetting = true;
		play.showAbilityGainScreen();
	});
	await page.waitForTimeout(500);
	await page.locator('canvas').click();
	await page.keyboard.press('Enter');
	await page.waitForTimeout(350);
	const layout = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const helper = play.children.list.find(
			(c) => c.name === 'gain-helper',
		);
		const doneBg = play.children.list.find(
			(c) => c.type === 'Rectangle' && c.depth === 23,
		);
		if (!helper?.getBounds || !doneBg?.getBounds) {
			return { gainDoneLayoutOk: false, reason: 'missing-nodes' };
		}
		const hb = helper.getBounds();
		const db = doneBg.getBounds();
		const overlap =
			hb.bottom > db.top + 1 &&
			hb.top < db.bottom &&
			hb.left < db.right &&
			hb.right > db.left;
		return {
			gainDoneLayoutOk: !overlap,
			helperBottom: hb.bottom,
			doneTop: db.top,
		};
	});
	await browser.close();
	return layout;
}

async function runTouchPauseToggle(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	const pausePoint = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const bounds = play?.touchControls?.getChromeBounds?.();
		const pause = bounds?.[0];
		const game = window.__icarusGame;
		if (!pause || !game?.canvas) return null;
		const sm = game.scale;
		const rect = game.canvas.getBoundingClientRect();
		const scale = sm.displaySize.width / sm.width;
		const offsetX = rect.left + (rect.width - sm.displaySize.width) / 2;
		const offsetY = rect.top + (rect.height - sm.displaySize.height) / 2;
		return {
			x: offsetX + ((pause.left + pause.right) / 2) * scale,
			y: offsetY + ((pause.top + pause.bottom) / 2) * scale,
		};
	});
	if (!pausePoint) {
		await browser.close();
		return { touchPauseToggleOk: false };
	}
	await page.mouse.click(pausePoint.x, pausePoint.y);
	await page.waitForTimeout(400);
	const opened = await page.evaluate(() =>
		Boolean(window.__icarusGame?.scene.getScene('Play')?.pausePanel),
	);
	await page.mouse.click(pausePoint.x, pausePoint.y);
	await page.waitForTimeout(400);
	const closed = await page.evaluate(() =>
		!window.__icarusGame?.scene.getScene('Play')?.pausePanel,
	);
	await browser.close();
	return { touchPauseToggleOk: opened && closed, opened, closed };
}

async function runLandscapeMinText(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	const measureInPage = async () =>
		page.evaluate(() => {
			const game = window.__icarusGame;
			const play = game?.scene.getScene('Play');
			if (!game || !play) return { smallestScreenPx: 0, scale: 0 };
			const scale = Math.min(
				game.scale.displaySize.width / 1920,
				game.scale.displaySize.height / 1080,
			);
			const texts = [];
			const walk = (container) => {
				for (const child of container?.list ?? []) {
					if (child.type === 'Text') texts.push(child);
					if (child.list) walk(child);
				}
			};
			walk(play.children);
			if (play.pausePanel?.list) walk(play.pausePanel);
			let smallest = Infinity;
			for (const obj of texts) {
				if (!obj?.active) continue;
				const raw = obj.style?.fontSize ?? obj.fontSize;
				const gamePx =
					typeof raw === 'number' ? raw : parseFloat(String(raw || '0'));
				if (gamePx > 0) smallest = Math.min(smallest, gamePx * scale);
			}
			return {
				smallestScreenPx: smallest === Infinity ? 0 : smallest,
				scale,
			};
		});

	const gameplay = await measureInPage();
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.isResetting = true;
		play.showAbilityChoiceScreen();
	});
	await page.waitForTimeout(400);
	const loss = await measureInPage();
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.children.list
			.filter((c) => {
				const depth = c.depth;
				return depth >= 20 && depth <= 23;
			})
			.forEach((c) => c.destroy());
		play.abilityManager.abilities.jumpLevel = 1;
		play.abilityManager.abilities.dashLevel = 1;
		play.isResetting = true;
		play.showAbilityGainScreen();
	});
	await page.waitForTimeout(400);
	const regain = await measureInPage();
	await page.locator('canvas').click();
	await page.keyboard.press('Enter');
	await page.waitForTimeout(350);
	const touchDoneSize = await page.evaluate(() => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		const doneBg = play?.children?.list?.find(
			(c) => c.type === 'Rectangle' && c.depth === 23,
		);
		if (!doneBg?.getBounds || !game) {
			return { cssHeight: 0, ok: false };
		}
		const scale = game.scale.displaySize.width / game.scale.width;
		const b = doneBg.getBounds();
		const cssHeight = b.height * scale;
		return { cssHeight, ok: cssHeight >= 44 };
	});
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.children.list
			.filter((c) => {
				const depth = c.depth;
				return depth >= 20 && depth <= 250;
			})
			.forEach((c) => c.destroy());
		if (play.pausePanel) play.closePause();
		play.isResetting = false;
		play.isPaused = false;
		play.physics.resume();
		play.togglePause();
	});
	await page.waitForTimeout(400);
	const pause = await measureInPage();
	await browser.close();
	const samples = [gameplay, loss, regain, pause];
	const smallest = Math.min(...samples.map((s) => s.smallestScreenPx));
	return {
		gameplay,
		loss,
		regain,
		pause,
		smallestScreenPx: smallest,
		landscapeMinTextOk: smallest >= 12,
		touchDoneMinHeightOk: touchDoneSize.ok === true,
		touchDoneCssHeight: touchDoneSize.cssHeight,
	};
}

async function runLossScreenLayout(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.isResetting = true;
		play.showAbilityChoiceScreen();
	});
	await page.waitForTimeout(600);
	const layout = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const h = play.cameras.main.height;
		const texts = play.children.list.filter(
			(c) => c.type === 'Text' && c.depth >= 21 && c.depth <= 22,
		);
		const overflow = texts
			.filter((t) => {
				const b = t.getBounds();
				return b.top < 0 || b.bottom > h;
			})
			.map((t) => ({
				text: String(t.text).slice(0, 48),
				top: t.getBounds().top,
				bottom: t.getBounds().bottom,
			}));
		return { height: h, overflow, lossScreenOk: overflow.length === 0 };
	});
	await browser.close();
	return layout;
}

async function runMobile(baseUrl) {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 844, height: 390 },
		hasTouch: true,
		isMobile: true,
	});
	const page = await context.newPage();
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.clearLevelInstruction?.();
		if (play?.pausePanel) play.closePause();
	});

	const canvasInPlay = await page.locator('canvas').boundingBox();
	const viewport = page.viewportSize();
	const widthRatio =
		canvasInPlay && viewport ? canvasInPlay.width / viewport.width : 0;

	const touchButtonCount = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		return play?.touchControls?.visible ? 1 : 0;
	});

	const beforeMove = await getPlayerPos(page);
	await holdTouchRight(page, 2800);
	let afterMove = await getPlayerPos(page);
	let touchMoveWorked = afterMove.x > beforeMove.x + 40;
	if (!touchMoveWorked) {
		await holdTouchRight(page, 2800);
		afterMove = await getPlayerPos(page);
		touchMoveWorked = afterMove.x > beforeMove.x + 40;
	}

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
		moveBeforeX: beforeMove.x,
		moveAfterX: afterMove.x,
	};
}

async function main() {
	const sanitizePixelFont = await loadSanitizePixelFont();
	const ligature = checkSanitizePixelFont(sanitizePixelFont);
	const openingRoutes = await loadJumpReachCheck();
	const allOpeningRoutesOk = openingRoutes.every((row) => row.ok);
	const daedalusRoute = openingRoutes.find((row) => row.name === 'Daedalus Interlude');
	const { server, baseUrl } = await startStaticServer();
	const pause = await runPauseEscToggle(baseUrl);
	const desktop = await runDesktop(baseUrl);
	const debug = await runDebugCheat(baseUrl);
	const lives = await runLivesAndDeath(baseUrl);
	const about = await runAboutLigatures(baseUrl, ligature.expectedAbout);
	const groundDash = await runGroundDash(baseUrl);
	const sideEdge = await runSideEdgeClamp(baseUrl);
	const canvasResize = await runCanvasOrientationResize(baseUrl);
	const portraitPause = await runPortraitGameplayPause(baseUrl);
	const portraitPauseEdge = await runPortraitPauseEdgeCases(baseUrl);
	const displayPolicy = await runDisplayPolicyChecks(baseUrl);
	const landscapeText = await runLandscapeMinText(baseUrl);
	const gainDoneLayout = await runGainDoneLayout(baseUrl);
	const touchTitleChrome = await runTouchTitleChromeClearance(baseUrl);
	const touchSpawn = await runTouchSpawnSafety(baseUrl);
	const wallJitterHold = await runWallJitterHold(baseUrl);
	const pausePanelLayout = await runPausePanelLayout(baseUrl);
	const touchButtonPlatform = await runTouchButtonPlatformClearance(baseUrl);
	const touchRelayoutHold = await runTouchRelayoutClearsHold(baseUrl);
	const portraitUnfreeze = await runPortraitUnfreezeCases(baseUrl);
	const touchPauseToggle = await runTouchPauseToggle(baseUrl);
	const lossScreen = await runLossScreenLayout(baseUrl);
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
		about.aboutExactOk &&
		pause.pauseEscOk &&
		!desktop.stuckOnGround &&
		collidersStable &&
		mobile.widthRatio > 0.8 &&
		mobile.touchButtonCount === 1 &&
		mobile.touchMoveWorked &&
		mobile.touchJumpWorked &&
		landscapeText.landscapeMinTextOk &&
		landscapeText.touchDoneMinHeightOk &&
		gainDoneLayout.gainDoneLayoutOk &&
		touchTitleChrome.touchTitleChromeOk &&
		touchSpawn.touchSpawnOk &&
		wallJitterHold.wallJitterHoldOk &&
		pausePanelLayout.pausePanelLayoutOk &&
		touchButtonPlatform.touchButtonPlatformOk &&
		touchRelayoutHold.touchRelayoutClearsHoldOk &&
		portraitUnfreeze.portraitUnfreezeOk &&
		touchPauseToggle.touchPauseToggleOk &&
		portraitPause.portraitPauseOk &&
		portraitPauseEdge.portraitPauseEdgeOk &&
		displayPolicy.desktopNarrowOk &&
		displayPolicy.tabletPortraitOk &&
		ligature.flightOk &&
		allOpeningRoutesOk &&
		groundDash.groundDashOk &&
		sideEdge.sideEdgeClampOk &&
		canvasResize.canvasResizeOk &&
		lossScreen.lossScreenOk;

	console.log(
		JSON.stringify(
			{
				ligature,
				openingRoutes: {
					allOpeningRoutesOk,
					daedalusRise: daedalusRoute?.rise ?? null,
					levels: openingRoutes,
				},
				pause,
				desktop,
				debug,
				lives,
				about,
				groundDash,
				sideEdge,
				canvasResize,
				portraitPause,
				portraitPauseEdge,
				displayPolicy,
				landscapeText,
				gainDoneLayout,
				touchTitleChrome,
				touchSpawn,
				wallJitterHold,
				pausePanelLayout,
				touchButtonPlatform,
				touchRelayoutHold,
				portraitUnfreeze,
				touchPauseToggle,
				lossScreen,
				mobile,
				pass,
			},
			null,
			2,
		),
	);
	process.exit(pass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
