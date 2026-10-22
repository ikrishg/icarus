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

async function bootToPlay(page, baseUrl, search = '?debug=1') {
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
	let maxPlayerX = (await getPlayerPos(page)).x;
	for (let i = 0; i < 55; i++) {
		await page.waitForTimeout(100);
		maxPlayerX = Math.max(maxPlayerX, (await getPlayerPos(page)).x);
	}
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
		maxPlayerXDuringHold: maxPlayerX,
		cheatSkipped,
		portalAdvanceDesktop,
		portalLevelsPassed: portalAdvanceDesktop.every(Boolean),
		colliders,
		stuckOnGround: maxPlayerX < 250,
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
	await applyCpuThrottleIfRequested(page);
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play?.pausePanel) play.closePause();
		play.isPaused = false;
		play.physics.resume();
		if (play?.abilityManager?.abilities) {
			play.abilityManager.abilities.dashLevel = 2;
		}
		play?.player?.sprite?.setFlipX(false);
	});

	const dashMeta = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		return {
			duration: p?.DASH_DURATION ?? 400,
		};
	});
	const expectedMin = 408;

	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		if (!p) return;
		const y = play.levelManager.current.start.y;
		// Open ground lane on L1: dashing from 520 runs into spikes past ~1100.
		p.revive(480, y);
		p.sprite.setFlipX(false);
		p.lastDashTime = 0;
	});
	await page.waitForTimeout(200);
	const dashStartX = await page.evaluate(() => {
		const p = window.__icarusGame?.scene.getScene('Play')?.player;
		return p?.sprite?.x ?? 0;
	});
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		if (!play || !p) return;
		const probe = { sum: 0, lastX: p.sprite.x, onStep: null };
		probe.onStep = () => {
			if (p.isDashing) {
				probe.sum += Math.abs(p.sprite.x - probe.lastX);
			}
			probe.lastX = p.sprite.x;
		};
		play.physics.world.on('poststep', probe.onStep);
		window.__icarusDashProbe = probe;
	});
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
	const dashDistance = await page.evaluate((startX) => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const probe = window.__icarusDashProbe;
		if (play && probe?.onStep) {
			play.physics.world.off('poststep', probe.onStep);
		}
		const p = play?.player;
		const endDelta = Math.abs((p?.sprite?.x ?? startX) - startX);
		const sum = probe?.sum ?? 0;
		delete window.__icarusDashProbe;
		return Math.max(endDelta, sum);
	}, dashStartX);

	await browser.close();
	return {
		expectedMin,
		delta: dashDistance,
		groundDashOk: dashDistance >= expectedMin,
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
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
	});
	await page.waitForTimeout(150);
	const before = await getPlayerPos(page);
	await holdTouchRight(page, 2200);
	const after = await getPlayerPos(page);
	return {
		ok: after.x > before.x + 15,
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
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
	});
	await page.waitForTimeout(200);
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
	await page.waitForTimeout(2600);
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
		deathPortraitMid &&
		(!deathPortraitAfter.alive || deathPortraitAfter.paused);
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

function touchHudChromeRectsOk(pause, lives, panel) {
	if (!pause || !lives || !panel) return false;
	if (rectsOverlap(pause, panel)) return false;
	if (rectsOverlap(lives, panel)) return false;
	if (rectsOverlap(pause, lives)) return false;
	return true;
}

function playerOverlapsButtons(playerRect, buttons) {
	return buttons.some(
		(b) =>
			playerRect.left < b.right - 0.5 &&
			playerRect.right > b.left + 0.5 &&
			playerRect.top < b.bottom &&
			playerRect.bottom > b.top,
	);
}

function minSpawnCenterFromLeftButtons(leftButtons, pad, spriteHalfW) {
	if (!leftButtons?.length) return 0;
	const clusterRight = Math.max(...leftButtons.map((b) => b.right));
	return clusterRight + pad + spriteHalfW;
}

function expectedFireballFirstSpawnMs(delay, interval) {
	const startAt = Math.max(0, interval - delay);
	return interval - startAt;
}

function runTouchLayoutMutationGuards() {
	const failures = [];
	const l6Delay = 1000;
	const l6Interval = 1800;
	if (expectedFireballFirstSpawnMs(l6Delay, l6Interval) !== 1000) {
		failures.push('fireball-startAt-formula');
	}
	const panel = { left: 100, right: 500, top: 190, bottom: 310 };
	const pauseGood = { left: 24, right: 120, top: 52, bottom: 108 };
	const livesGood = { left: 140, right: 320, top: 120, bottom: 164 };
	const livesBug = { left: 140, right: 320, top: 197, bottom: 260 };
	if (!touchHudChromeRectsOk(pauseGood, livesGood, panel)) {
		failures.push('hud-good');
	}
	if (touchHudChromeRectsOk(pauseGood, livesBug, panel)) {
		failures.push('hud-lives-panel-mutation');
	}
	const pauseBug = { left: 24, right: 120, top: 52, bottom: 220 };
	if (touchHudChromeRectsOk(pauseBug, livesGood, panel)) {
		failures.push('hud-pause-panel-mutation');
	}
	const body = { left: 291, right: 363, top: 900, bottom: 980 };
	const btn = { left: 216, right: 348, top: 880, bottom: 1010 };
	if (!playerOverlapsButtons(body, [btn])) {
		failures.push('spawn-overlap-good');
	}
	const bodyClear = { left: 380, right: 452, top: 900, bottom: 980 };
	if (playerOverlapsButtons(bodyClear, [btn])) {
		failures.push('spawn-overlap-clear');
	}
	const boundsMin = minSpawnCenterFromLeftButtons([btn], 12, 36);
	const fakeCapMin = 40 + 36;
	if (boundsMin <= fakeCapMin + 8) {
		failures.push('spawn-bounds-min-sanity');
	}
	if (fakeCapMin >= boundsMin - 2) {
		failures.push('spawn-cap40-would-pass');
	}
	return { touchLayoutMutationOk: failures.length === 0, failures };
}

const TOUCH_HUD_VIEWPORTS = [
	{ width: 568, height: 320 },
	{ width: 568, height: 270 },
	{ width: 640, height: 360 },
	{ width: 640, height: 310 },
	{ width: 844, height: 390 },
	{ width: 844, height: 340 },
	{ width: 932, height: 430 },
];

const TOUCH_SPAWN_VIEWPORTS = [
	{ width: 568, height: 320 },
	{ width: 568, height: 270 },
	{ width: 640, height: 360 },
	{ width: 640, height: 310 },
	{ width: 844, height: 340 },
	{ width: 844, height: 390 },
	{ width: 932, height: 430 },
];

const TOUCH_SPAWN_PAD = 12;
const TOUCH_HAZARD_MARGIN_PX = 96;
const FIREBALL_HAZARD_HALF_W = 27;
const SPIKE_FRAME_W = 402;

function hazardIntervalsForLevel(level, spawnY) {
	const intervals = [];
	for (const o of level.obstacles ?? []) {
		if (o.type === 'spikes') {
			const scale = o.size / 129;
			const w = SPIKE_FRAME_W * scale;
			for (let i = 0; i < o.count; i++) {
				const left = o.x + i * w;
				intervals.push({ left, right: left + w });
			}
		}
		if (o.type === 'fireball' && spawnY <= o.y + 120) {
			intervals.push({
				left: o.x - FIREBALL_HAZARD_HALF_W,
				right: o.x + FIREBALL_HAZARD_HALF_W,
			});
		}
	}
	return intervals;
}

function clearanceToHazards(bounds, hazards) {
	let best = Infinity;
	for (const h of hazards) {
		if (bounds.right <= h.left) {
			best = Math.min(best, h.left - bounds.right);
		} else if (bounds.left >= h.right) {
			best = Math.min(best, bounds.left - h.right);
		} else {
			return 0;
		}
	}
	return best === Infinity ? Infinity : best;
}

function touchSpawnHazardMarginOk(spriteBounds, level, spawnY) {
	const hazards = hazardIntervalsForLevel(level, spawnY);
	const gap = clearanceToHazards(
		{
			left: spriteBounds.left,
			right: spriteBounds.right,
		},
		hazards,
	);
	return gap >= TOUCH_HAZARD_MARGIN_PX;
}

const URL_BAR_SHRINK_CASES = [
	{ start: { width: 568, height: 320 }, shrink: { width: 568, height: 270 } },
	{ start: { width: 640, height: 360 }, shrink: { width: 640, height: 310 } },
	{ start: { width: 844, height: 390 }, shrink: { width: 844, height: 340 } },
];

async function collectTouchHudOverlap(page) {
	return page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play?.touchControls?.visible) return { ok: true, skip: true };
		const chrome = play.touchControls.getChromeBounds?.() ?? [];
		const pause = chrome[0];
		const lives = play.livesText?.getBounds?.();
		let panel = null;
		if (play.instructionPanel?.active) {
			const ib = play.instructionPanel.getBounds();
			panel = {
				left: ib.left,
				right: ib.right,
				top: ib.top,
				bottom: ib.bottom,
			};
		}
		const pauseLivesOverlap =
			pause &&
			lives &&
			pause.left < lives.right &&
			pause.right > lives.left &&
			pause.top < lives.bottom &&
			pause.bottom > lives.top;
		const panelOverlap =
			panel &&
			((pause &&
				pause.left < panel.right &&
				pause.right > panel.left &&
				pause.top < panel.bottom &&
				pause.bottom > panel.top) ||
				(lives &&
					lives.left < panel.right &&
					lives.right > panel.left &&
					lives.top < panel.bottom &&
					lives.bottom > panel.top));
		const ok =
			pause && lives && !pauseLivesOverlap && !panelOverlap;
		return { ok: Boolean(ok), pause, lives, panel };
	});
}

async function runTouchHudChromeOverlapMatrix(baseUrl) {
	const failures = [];
	const browser = await chromium.launch();
	for (const vp of TOUCH_HUD_VIEWPORTS) {
		const page = await browser.newPage({
			viewport: vp,
			isMobile: true,
			hasTouch: true,
		});
		await bootToPlay(page, baseUrl);
		for (let level = 0; level < 15; level++) {
			for (const phase of ['entry']) {
				const result = await page.evaluate(
					async ({ idx, phase }) => {
						const play = window.__icarusGame?.scene.getScene('Play');
						if (!play?.touchControls?.visible) return { ok: true };
						window.__icarusPrepareLevel?.(idx);
						play.handleDisplayResize?.();
						play.setGameplayHudVisible(true);
						play.showLevelInstruction();
						await new Promise((r) =>
							requestAnimationFrame(() => requestAnimationFrame(r)),
						);
						const chrome = play.touchControls.getChromeBounds?.() ?? [];
						const pause = chrome[0];
						const lives = play.livesText?.getBounds?.();
						const panel = play.instructionPanel?.active
							? play.instructionPanel.getBounds()
							: null;
						const rect = (b) =>
							b
								? {
										left: b.left,
										right: b.right,
										top: b.top,
										bottom: b.bottom,
									}
								: null;
						const p = rect(pause);
						const l = rect(lives);
						const pan = rect(panel);
						const overlap = (a, b) =>
							a &&
							b &&
							a.left < b.right &&
							a.right > b.left &&
							a.top < b.bottom &&
							a.bottom > b.top;
						const ok =
							p &&
							l &&
							!overlap(p, l) &&
							(!pan || (!overlap(p, pan) && !overlap(l, pan)));
						return { ok: Boolean(ok), pause: p, lives: l, panel: pan };
					},
					{ idx: level, phase },
				);
				if (!result.ok) {
					failures.push({ viewport: vp, level: level + 1, phase, ...result });
				}
			}
		}
		await page.close();
	}
	await browser.close();
	return { touchHudChromeOverlapOk: failures.length === 0, failures };
}

async function collectTouchButtonOverlap(page) {
	return page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play?.touchControls?.visible) return { ok: true, skip: true };
		const sprite = play.player.sprite;
		if (!sprite) return { ok: false, reason: 'no-sprite' };
		const sprB = sprite.getBounds();
		const playerRect = {
			left: sprB.left,
			right: sprB.right,
			top: sprB.top,
			bottom: sprB.bottom,
		};
		const buttons = [
			...(play.touchControls.getLeftMovementButtonBounds?.() ?? []),
			...(play.touchControls.getGameplayButtonBounds?.() ?? []),
		];
		const overlap = buttons.some(
			(b) =>
				playerRect.left < b.right - 0.5 &&
				playerRect.right > b.left + 0.5 &&
				playerRect.top < b.bottom &&
				playerRect.bottom > b.top,
		);
		return { ok: !overlap, spawnX: play.player.sprite.x, buttons };
	});
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
	const viewports = TOUCH_SPAWN_VIEWPORTS;
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
			await page.evaluate((idx) => {
				window.__icarusPrepareLevel?.(idx);
				window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
			}, level);
			for (const phase of ['spawn-check', 'death-respawn']) {
			const result = await page.evaluate(async ({ idx, phase, vpWidth, spawnPad }) => {
				const spriteOverlapsButtons = (playerRect, buttons) =>
					buttons.some(
						(b) =>
							playerRect.left < b.right - 0.5 &&
							playerRect.right > b.left + 0.5 &&
							playerRect.top < b.bottom &&
							playerRect.bottom > b.top,
					);
				const play = window.__icarusGame?.scene.getScene('Play');
				if (!play?.touchControls?.visible) return { ok: true };
				const playScene = window.__icarusGame?.scene.getScene('Play');
				if (phase === 'death-respawn') {
					playScene?.killPlayer?.('fall', { fast: true, spendLife: false });
					for (let t = 0; t < 120; t++) {
						await new Promise((r) => setTimeout(r, 50));
						if (
							playScene &&
							!playScene.isResetting &&
							!playScene.player?.isDead
						) {
							break;
						}
					}
				}
				await new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				);
				const levelDef = play.levelManager.current;
				const startX = levelDef.start.x;
				const spawnX = play.player.sprite.x;
				const want = play.touchSpawnPosition();
				const delta = spawnX - startX;
				const body = play.player.sprite.body;
				const sprite = play.player.sprite;
				const sprB = sprite.getBounds();
				const spriteHalfW = (sprB.right - sprB.left) / 2;
				const leftButtons =
					play.touchControls.getLeftMovementButtonBounds?.() ?? [];
				const clusterRight = leftButtons.length
					? Math.max(...leftButtons.map((b) => b.right))
					: 0;
				const boundsMin = clusterRight
					? clusterRight + spawnPad + spriteHalfW
					: 0;
				const clusterMin = play.touchControls.getMinSpawnX(spriteHalfW);
				const maxDelta = Math.max(
					72,
					clusterMin - startX,
					clusterMin + 72 - startX,
				);
				const maxX = Math.max(startX + maxDelta, clusterMin + 72);
				const windowPx = (body?.halfWidth ?? 36) * 2 + 100;
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
				const desktopParityPx = 250;
				const startHits = touchHazards(
					startX + 1,
					startX + desktopParityPx,
				);
				const touchOnly = touchHazards(
					spawnX + 1,
					spawnX + windowPx,
				).filter((hx) => !startHits.includes(hx));
				const playerRect = {
					left: sprB.left,
					right: sprB.right,
					top: sprB.top,
					bottom: sprB.bottom,
				};
				const allButtons = [
					...leftButtons,
					...(play.touchControls.getGameplayButtonBounds?.() ?? []),
				];
				const overlapsButtons = spriteOverlapsButtons(
					playerRect,
					allButtons,
				);
				let feasible = false;
				const overlapsAt = (tx) => {
					const prevX = sprite.x;
					const prevY = sprite.y;
					sprite.setPosition(tx, play.levelManager.current.start.y);
					const b = sprite.getBounds();
					sprite.setPosition(prevX, prevY);
					return spriteOverlapsButtons(
						{
							left: b.left,
							right: b.right,
							top: b.top,
							bottom: b.bottom,
						},
						allButtons,
					);
				};
				for (let tx = startX; tx <= maxX; tx += 8) {
					const touchOnlyAt = touchHazards(
						tx + 1,
						tx + windowPx,
					).filter((hx) => !startHits.includes(hx));
					const overlaps = overlapsAt(tx);
					if (
						tx - startX >= 0 &&
						tx - startX <= maxDelta + 2 &&
						touchOnlyAt.length === 0 &&
						!overlaps
					) {
						feasible = true;
						break;
					}
				}
				const spawnTol = vpWidth <= 640 ? 8 : 4;
				const hazardMarginPx = (() => {
					const hazards = [];
					for (const o of levelDef.obstacles ?? []) {
						if (o.type === 'spikes') {
							const scale = o.size / 129;
							const w = 402 * scale;
							for (let i = 0; i < o.count; i++) {
								const left = o.x + i * w;
								hazards.push({ left, right: left + w });
							}
						}
						if (o.type === 'fireball' && levelDef.start.y <= o.y + 120) {
							hazards.push({
								left: o.x - 27,
								right: o.x + 27,
							});
						}
					}
					let best = Infinity;
					const b = { left: sprB.left, right: sprB.right };
					for (const h of hazards) {
						if (b.right <= h.left) best = Math.min(best, h.left - b.right);
						else if (b.left >= h.right) best = Math.min(best, b.left - h.right);
						else return 0;
					}
					return best === Infinity ? Infinity : best;
				})();
				const hazardMarginOk = hazardMarginPx >= 96;
				return {
					ok:
						Math.abs(spawnX - want.x) <= spawnTol &&
						hazardMarginOk &&
						!overlapsButtons &&
						spawnX >= boundsMin - 4 &&
						spawnX >= clusterMin - 4,
					spawnX,
					startX,
					delta,
					touchOnlyHazards: touchOnly,
					hazardMarginPx,
					overlapsButtons,
					feasible,
					phase,
				};
			}, { idx: level, phase, vpWidth: vp.width, spawnPad: TOUCH_SPAWN_PAD });
			if (!result.ok) failures.push({ viewport: vp, level: level + 1, ...result });
			}
		}
		await page.close();
	}
	await browser.close();
	return { touchSpawnOk: failures.length === 0, failures };
}

async function evaluateTouchSpawnClearance(page, levelIdx) {
	return page.evaluate((idx) => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play?.touchControls?.visible) return { ok: true, skip: true };
		window.__icarusPrepareLevel?.(idx);
		play.resetPlayer?.();
		return new Promise((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const sprite = play.player?.sprite;
					if (!sprite) {
						resolve({ ok: false, reason: 'no-sprite' });
						return;
					}
					const sprB = sprite.getBounds();
					const spriteHalfW = (sprB.right - sprB.left) / 2;
					const leftButtons =
						play.touchControls.getLeftMovementButtonBounds?.() ?? [];
					const boundsMin = Math.max(
						...leftButtons.map((b) => b.right),
						0,
					)
						? Math.max(...leftButtons.map((b) => b.right)) +
							12 +
							spriteHalfW
						: 0;
					const clusterMin = play.touchControls.getMinSpawnX(spriteHalfW);
					const playerRect = {
						left: sprB.left,
						right: sprB.right,
						top: sprB.top,
						bottom: sprB.bottom,
					};
					const allButtons = [
						...leftButtons,
						...(play.touchControls.getGameplayButtonBounds?.() ?? []),
					];
					const overlapsButtons = allButtons.some(
						(b) =>
							playerRect.left < b.right - 0.5 &&
							playerRect.right > b.left + 0.5 &&
							playerRect.top < b.bottom &&
							playerRect.bottom > b.top,
					);
					resolve({
						ok:
							!overlapsButtons &&
							play.player.sprite.x >= boundsMin - 2 &&
							play.player.sprite.x >= clusterMin - 2 &&
							clusterMin >= boundsMin - 2,
						overlapsButtons,
						spawnX: play.player.sprite.x,
						boundsMin,
						clusterMin,
					});
				});
			});
		});
	}, levelIdx);
}

async function evaluateTouchHudAtBoot(page) {
	return collectTouchHudOverlap(page);
}

async function runTouchDisplayResizeMutationProofs(baseUrl) {
	const failures = [];
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play) return;
		window.__icarusOrigDisplayResize = play.handleDisplayResize?.bind(play);
		window.__icarusOrigTouchRelayout =
			play.touchControls?.relayout?.bind(play.touchControls);
		play.handleDisplayResize = () => {};
		if (play.touchControls) {
			play.touchControls.relayout = () => {};
		}
	});
	await page.setViewportSize({ width: 844, height: 340 });
	await page.waitForTimeout(500);
	const hudStale = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const expected = window.__icarusTouchChromeMetrics?.();
		const livesY = play?.livesText?.y;
		if (!expected || livesY == null) return { stale: false };
		return {
			stale: Math.abs(livesY - expected.livesTextY) > 6,
			livesY,
			expectedY: expected.livesTextY,
		};
	});
	if (!hudStale.stale) {
		failures.push('hud-should-stale-with-noop-display-resize');
	}
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play && window.__icarusOrigDisplayResize) {
			play.handleDisplayResize = window.__icarusOrigDisplayResize;
			if (play.touchControls && window.__icarusOrigTouchRelayout) {
				play.touchControls.relayout = window.__icarusOrigTouchRelayout;
			}
			play.handleDisplayResize();
		}
	});
	const spawnWithResize = await evaluateTouchSpawnClearance(page, 7);
	if (!spawnWithResize.ok && !spawnWithResize.skip) {
		failures.push('spawn-should-pass-after-display-resize');
	}
	const fakeCap = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play?.touchControls) return { ok: false };
		window.__icarusPrepareLevel?.(7);
		play.resetPlayer?.();
		const sprite = play.player.sprite;
		const sprB = sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const leftButtons =
			play.touchControls.getLeftMovementButtonBounds?.() ?? [];
		const boundsMin = play.touchControls.getMinSpawnX(spriteHalfW);
		const fakeMin = 40 + spriteHalfW;
		const capGapOk = boundsMin > fakeMin + 40;
		return { capGapOk, boundsMin, fakeMin, spawnX: play.player.sprite.x };
	});
	if (!fakeCap.capGapOk) {
		failures.push('spawn-cap40-mutation-not-detected');
	}
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (!play) return;
		window.__icarusOrigDisplayResize = play.handleDisplayResize?.bind(play);
		window.__icarusOrigTouchRelayout =
			play.touchControls?.relayout?.bind(play.touchControls);
		play.handleDisplayResize = () => {};
		if (play.touchControls) {
			play.touchControls.relayout = () => {};
		}
	});
	await page.setViewportSize({ width: 640, height: 360 });
	await page.waitForTimeout(400);
	const hudNoResize = await evaluateTouchHudAtBoot(page);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		if (play && window.__icarusOrigDisplayResize) {
			play.handleDisplayResize = window.__icarusOrigDisplayResize;
			if (play.touchControls && window.__icarusOrigTouchRelayout) {
				play.touchControls.relayout = window.__icarusOrigTouchRelayout;
			}
			play.handleDisplayResize();
		}
	});
	if (hudNoResize.ok && !hudNoResize.skip) {
		failures.push('hud-should-fail-with-noop-display-resize');
	}
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play?.setGameplayHudVisible?.(true);
		play?.showLevelInstruction?.();
	});
	const hudWithResize = await evaluateTouchHudAtBoot(page);
	if (!hudWithResize.ok && !hudWithResize.skip) {
		failures.push('hud-should-pass-after-display-resize');
	}
	await browser.close();
	return {
		touchDisplayResizeMutationOk: failures.length === 0,
		failures,
		hudStale,
		spawnWithResize,
		fakeCap,
		hudNoResize,
		hudWithResize,
	};
}

async function runJumpButtonLegibility(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 340 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
	});
	const measure = await page.evaluate(() => {
		const game = window.__icarusGame;
		const play = game?.scene.getScene('Play');
		const scale = Math.min(
			game.scale.displaySize.width / 1920,
			game.scale.displaySize.height / 1080,
		);
		let jumpText = null;
		for (const node of play?.children?.list ?? []) {
			if (node.type !== 'Text' || node.depth !== 202) continue;
			const label = String(node.text ?? '');
			if (label.includes('↑') || label.includes('▲') || label.includes('^')) {
				jumpText = node;
				break;
			}
		}
		if (!jumpText) {
			const jumpBtn = play?.touchControls?.getGameplayButtonBounds?.()?.[0];
			if (jumpBtn) {
				const cx = (jumpBtn.left + jumpBtn.right) / 2;
				const cy = (jumpBtn.top + jumpBtn.bottom) / 2;
				for (const node of play?.children?.list ?? []) {
					if (node.type !== 'Text' || node.depth !== 202) continue;
					const b = node.getBounds?.();
					if (
						b &&
						Math.abs((b.left + b.right) / 2 - cx) < 40 &&
						Math.abs((b.top + b.bottom) / 2 - cy) < 40
					) {
						jumpText = node;
						break;
					}
				}
			}
		}
		if (!jumpText?.getBounds) return { ok: false, reason: 'no-jump-text' };
		const tb = jumpText.getBounds();
		const raw = jumpText.style?.fontSize ?? jumpText.fontSize;
		const gamePx =
			typeof raw === 'number' ? raw : parseFloat(String(raw || '0'));
		const screenFontPx = gamePx * scale;
		const screenHeightPx = (tb.bottom - tb.top) * scale;
		return {
			ok: screenFontPx >= 19 && screenHeightPx >= 18,
			screenFontPx,
			screenHeightPx,
			gamePx,
			scale,
		};
	});
	await browser.close();
	return { jumpButtonLegibilityOk: measure.ok, ...measure };
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
		body.setAllowGravity(true);
		const y = plat.top - body.halfHeight - 6;
		const x = plat.left - body.halfWidth - 6;
		player.sprite.setPosition(x, y);
		body.updateFromGameObject();
		player.sprite.setVelocity(0, 0);
		return {
			ok: true,
			platLeft: plat.left,
			platRight: plat.right,
			platTop: plat.top,
			platBottom: plat.bottom,
		};
	});
	if (!setup?.ok) {
		return { ok: false, reason: setup?.reason ?? 'setup' };
	}
	await page.waitForTimeout(80);
	await page.keyboard.down('ArrowRight');
	const frames = [];
	for (let i = 0; i < 60; i++) {
		frames.push(
			await page.evaluate(() => {
				const body =
					window.__icarusGame?.scene.getScene('Play')?.player?.sprite?.body;
				if (!body) return null;
				return {
					left: body.left,
					right: body.right,
					top: body.top,
					bottom: body.bottom,
				};
			}),
		);
		await page.waitForTimeout(16);
	}
	await page.keyboard.up('ArrowRight');
	const valid = frames.filter(Boolean);
	const penetrated = valid.some(
		(f) =>
			f.right > setup.platLeft + 0.5 &&
			f.bottom > setup.platTop &&
			f.top < setup.platBottom,
	);
	return {
		ok: valid.length === 60 && !penetrated,
		penetrated,
		platLeft: setup.platLeft,
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
			const game = window.__icarusGame;
			const scale = Math.min(
				game.scale.displaySize.width / 1920,
				game.scale.displaySize.height / 1080,
			);
			const cssTitleResume = gapTitleResume * scale;
			const cssResumeRestart = gapResumeRestart * scale;
			const cssRestartQuit = gapRestartQuit * scale;
			const gapsOk = mobile
				? cssTitleResume >= 10 &&
					cssResumeRestart >= 10 &&
					cssRestartQuit >= 10
				: gapTitleResume >= 16 && gapRestartQuit >= 16;
			return {
				ok: gapsOk,
				gapTitleResume,
				gapResumeRestart,
				gapRestartQuit,
				cssTitleResume,
				cssResumeRestart,
				cssRestartQuit,
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

async function waitForPlayReady(page, timeoutMs = 15000) {
	try {
		await page.waitForFunction(
			() => {
				const play = window.__icarusGame?.scene.getScene('Play');
				return (
					play &&
					!play.isResetting &&
					!play.player?.isDead &&
					!play.pausePanel &&
					!play.isPaused &&
					!play.physics?.world?.isPaused
				);
			},
			undefined,
			{ timeout: timeoutMs },
		);
		return true;
	} catch {
		return false;
	}
}

async function runTouchRelayoutPreservesHold(baseUrl) {
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
	const beforeResize = await getPlayerPos(page);
	await page.setViewportSize({ width: 844, height: 340 });
	await page.waitForTimeout(500);
	const rightPoint2 = await touchPointForTarget(page, 'right');
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [{ ...point, x: rightPoint2.x, y: rightPoint2.y }],
	});
	await page.waitForTimeout(600);
	const mid = await getPlayerPos(page);
	await page.waitForTimeout(600);
	const afterHold = await getPlayerPos(page);
	const touchState = await page.evaluate(() => {
		const input = window.__icarusGame?.scene
			.getScene('Play')
			?.touchControls?.getInput?.();
		return { right: Boolean(input?.right) };
	});
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	});
	await browser.close();
	const movedWhileHeld =
		touchState.right && afterHold.x - beforeResize.x > 40;
	return {
		touchRelayoutPreservesHoldOk:
			touchState.right && movedWhileHeld && afterHold.x > mid.x - 5,
		beforeResizeX: beforeResize.x,
		afterHoldX: afterHold.x,
		touchState,
	};
}

async function runJumpInPlaceStable(baseUrl) {
	const failures = [];
	const browser = await chromium.launch();
	for (const mobile of [false, true]) {
		const page = await browser.newPage(
			mobile
				? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }
				: { viewport: { width: 1280, height: 720 } },
		);
		await bootToPlay(page, baseUrl);
		await page.locator('canvas').click();
		for (let level = 0; level < 15; level++) {
			await page.evaluate((idx) => window.__icarusPrepareLevel?.(idx), level);
			await page.waitForTimeout(150);
			const startX = (await getPlayerPos(page)).x;
			for (let i = 0; i < 6; i++) {
				await page.keyboard.press('Space');
				await page.waitForTimeout(140);
			}
			await page.waitForTimeout(350);
			const endX = (await getPlayerPos(page)).x;
			if (Math.abs(endX - startX) > 2) {
				failures.push({ mobile, level: level + 1, startX, endX });
			}
		}
		await page.close();
	}
	await browser.close();
	return { jumpInPlaceOk: failures.length === 0, failures };
}

async function runPlatformSideJump(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	await page.evaluate(() => {
		window.__icarusPrepareLevel?.(0);
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		const body = p?.sprite?.body;
		if (!p || !body) return;
		p.revive(300, 800);
		body.updateFromGameObject();
	});
	await page.keyboard.down('ArrowRight');
	await page.keyboard.down('Space');
	const result = await page.evaluate(async () => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		const body = p?.sprite?.body;
		if (!play || !p || !body) return { ok: false };
		let plat = null;
		for (const child of play.levelManager.platforms.getChildren()) {
			const pb = child.body;
			if (!pb || pb.width >= 1800) continue;
			if (pb.left >= 340 && pb.left <= 360) plat = pb;
		}
		if (!plat) return { ok: false, reason: 'no-plat' };
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => requestAnimationFrame(r));
			const overlap =
				body.left + 4 < plat.right - 4 &&
				body.right > plat.left + 8 &&
				body.bottom > plat.top + 6 &&
				body.top < plat.bottom - 6;
			if (overlap) return { ok: false, overlap: true, frame: i };
		}
		return { ok: true };
	});
	await page.keyboard.up('Space');
	await page.keyboard.up('ArrowRight');
	await browser.close();
	return { platformSideJumpOk: Boolean(result?.ok), ...result };
}

async function runStaleDashQueue(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.abilityManager.abilities.dashLevel = 1;
		play.isResetting = true;
		play.showAbilityGainScreen();
	});
	await page.keyboard.press('KeyQ');
	await page.waitForTimeout(200);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.isResetting = false;
		play.abilityManager.abilities.dashLevel = 2;
		play.player.lastDashTime = 0;
	});
	await page.locator('canvas').click();
	const dashed = await Promise.all([
		page.evaluate(async () => {
			const play = window.__icarusGame?.scene.getScene('Play');
			const p = play?.player;
			if (!p) return true;
			let armed = false;
			for (let i = 0; i < 90; i++) {
				await new Promise((r) => requestAnimationFrame(r));
				if (p.controlsEnabled && !play.isResetting) armed = true;
				if (armed && p.isDashing) return true;
			}
			return false;
		}),
		(async () => {
			await page.waitForTimeout(40);
			await page.keyboard.press('Enter');
		})(),
	]).then(([saw]) => saw);
	await browser.close();
	return { staleDashQueueOk: !dashed };
}

async function runFireballPauseStack(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		window.__icarusPrepareLevel?.(5);
	});
	await page.waitForTimeout(80);
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.requestPause();
	});
	await page.waitForTimeout(8000);
	const pausedCount = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const active =
			play?.levelManager?.fireballs?.filter((f) => f.sprite?.active).length ??
			0;
		const timersPaused = (play?.levelManager?.fireballTimers ?? []).every(
			(t) => t.paused,
		);
		const clockPaused = Boolean(play?.time?.paused);
		return { active, timersPaused, clockPaused };
	});
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.closePause();
	});
	await page.waitForTimeout(1200);
	const afterResume = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const active =
			play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
				.length ?? 0;
		const timersPaused = (play?.levelManager?.fireballTimers ?? []).some(
			(t) => t.paused,
		);
		return { active, timersPaused, clockPaused: Boolean(play?.time?.paused) };
	});
	const spawnedAfterResume = await page.evaluate(async () => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const start =
			play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
				.length ?? 0;
		for (let i = 0; i < 100; i++) {
			await new Promise((r) => setTimeout(r, 25));
			const n =
				play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
					.length ?? 0;
			if (n > start) {
				return { ok: true, start, after: n };
			}
		}
		return { ok: false, start };
	});
	await browser.close();
	return {
		fireballPauseStackOk:
			pausedCount.active <= 1 &&
			pausedCount.timersPaused &&
			pausedCount.clockPaused &&
			!afterResume.timersPaused &&
			!afterResume.clockPaused &&
			spawnedAfterResume.ok,
		spawnedAfterResume,
		activeFireballs: afterResume.active,
		pausedCount,
		afterResume,
	};
}

async function sampleWallDashBounds(page, { side, disableWorldClamp }) {
	await page.evaluate(
		({ side, disableWorldClamp }) => {
			window.__icarusPrepareLevel?.(0);
			const play = window.__icarusGame?.scene.getScene('Play');
			if (!play?.player) return;
			play.closePause?.();
			play.isPaused = false;
			play.isResetting = false;
			play.physics.resume();
			play.time.paused = false;
			play.time.timeScale = 1;
			const p = play.player;
			const y = play.levelManager.current.start.y;
			const startX = side === 'right' ? 1650 : 270;
			p.revive(startX, y);
			p.sprite.setFlipX(side === 'left');
			p.lastDashTime = 0;
			p.controlsEnabled = true;
			play.abilityManager.abilities.dashLevel = 2;
			play.abilityManager.abilities.canMoveLeft = true;
			if (disableWorldClamp) {
				const body = p.sprite.body;
				if (body) {
					body.setCollideWorldBounds(false);
				}
				p.sprite.setCollideWorldBounds(false);
				p.clampHorizontalWorldBounds = () => {};
			}
			window.__icarusWallDashProbe = { ok: true };
			window.__icarusWallDashProbe.frames = 0;
			const check = () => {
				const b = p.sprite?.body;
				if (!b) return;
				window.__icarusWallDashProbe.frames += 1;
				if (b.left < -0.5 || b.right > 1920.5) {
					window.__icarusWallDashProbe.ok = false;
				}
			};
			play.physics.world.on('poststep', check);
			window.__icarusWallDashProbe.off = () => {
				play.physics.world.off('poststep', check);
			};
		},
		{ side, disableWorldClamp },
	);
	const moveKey = side === 'right' ? 'KeyD' : 'KeyA';
	await page.keyboard.down(moveKey);
	await page.keyboard.down('KeyQ');
	let ok = true;
	let frames = 0;
	let poststepFrames = 0;
	for (let i = 0; i < 35; i++) {
		const sample = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			const probe = window.__icarusWallDashProbe;
			const b = play?.player?.sprite?.body;
			if (!b) return { inBounds: false, postFrames: probe?.frames ?? 0 };
			if (probe) {
				probe.frames += 1;
				if (b.left < -0.5 || b.right > 1920.5) probe.ok = false;
			}
			return {
				inBounds: b.left >= -0.5 && b.right <= 1920.5,
				postFrames: probe?.frames ?? 0,
			};
		});
		frames += 1;
		poststepFrames = sample.postFrames;
		if (!sample.inBounds) ok = false;
		await page.waitForTimeout(16);
	}
	await page.keyboard.up('KeyQ');
	await page.keyboard.up(moveKey);
	const probeOk = await page.evaluate(() => {
		const probe = window.__icarusWallDashProbe;
		probe?.off?.();
		const result = probe?.ok === true;
		delete window.__icarusWallDashProbe;
		return result;
	});
	return {
		ok: ok && probeOk,
		frames: Math.max(frames, poststepFrames),
	};
}

async function runWallDashBoundsCheck(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	const right = await sampleWallDashBounds(page, {
		side: 'right',
		disableWorldClamp: false,
	});
	const left = await sampleWallDashBounds(page, {
		side: 'left',
		disableWorldClamp: false,
	});
	const mutatedRight = await sampleWallDashBounds(page, {
		side: 'right',
		disableWorldClamp: true,
	});
	await browser.close();
	const wallDashBoundsOk =
		right.ok &&
		left.ok &&
		right.frames > 10 &&
		left.frames > 10 &&
		mutatedRight.ok === false;
	return {
		wallDashBoundsOk,
		right,
		left,
		mutatedRight,
		wallClampMutationOk: wallDashBoundsOk,
	};
}

async function runWallDashBoundsThrottled(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await applyCpuThrottleIfRequested(page);
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	const right = await sampleWallDashBounds(page, {
		side: 'right',
		disableWorldClamp: false,
	});
	const left = await sampleWallDashBounds(page, {
		side: 'left',
		disableWorldClamp: false,
	});
	await browser.close();
	return {
		wallDashBoundsThrottledOk: right.ok && left.ok,
		right,
		left,
	};
}

async function runResizeProgressHold(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	const levels = [3, 9];
	const failures = [];
	for (const idx of levels) {
		await page.evaluate((levelIdx) => {
			window.__icarusPrepareLevel?.(levelIdx);
			const play = window.__icarusGame?.scene.getScene('Play');
			play?.clearLevelInstruction?.();
			const p = play?.player;
			if (p) {
				p.revive(1250, play.levelManager.current.start.y);
				p.controlsEnabled = true;
			}
		}, idx);
		const before = (await getPlayerPos(page)).x;
		const sequence = [
			{ width: 844, height: 390 },
			{ width: 844, height: 340 },
			{ width: 844, height: 390 },
			{ width: 390, height: 844 },
			{ width: 844, height: 390 },
		];
		for (const size of sequence) {
			await page.setViewportSize(size);
			await page.waitForTimeout(500);
			await page.evaluate(() => {
				window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
			});
		}
		const after = (await getPlayerPos(page)).x;
		if (before < 1200 || after < 1200 || Math.abs(after - before) > 2) {
			failures.push({ level: idx + 1, before, after });
		}
	}
	await browser.close();
	return { resizeProgressHoldOk: failures.length === 0, failures };
}

async function runTouchChromeLivesGap(baseUrl) {
	const cases = [
		{ width: 844, height: 390 },
		{ width: 844, height: 340 },
		{ width: 932, height: 430 },
		{ width: 932, height: 380 },
		{ width: 640, height: 360 },
		{ width: 640, height: 310 },
	];
	const failures = [];
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	for (const vp of cases) {
		await page.setViewportSize(vp);
		await page.waitForTimeout(400);
		await page.evaluate(() => {
			window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
		});
			const gap = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			const chrome = play?.touchControls?.getChromeBounds?.() ?? [];
			const pause = chrome[0];
			const lives = play?.livesText?.getBounds?.();
			if (!pause || !lives) return { ok: false, reason: 'missing' };
			const horizGap = lives.left - pause.right;
			const rowAligned =
				lives.top >= pause.top - 6 && lives.bottom <= pause.bottom + 6;
			const stackBelow = lives.top >= pause.bottom - 4;
			return {
				ok: stackBelow || (horizGap >= 8 && rowAligned),
				horizGap,
				rowAligned,
				pauseRight: pause.right,
				livesLeft: lives.left,
			};
		});
		if (!gap.ok) failures.push({ viewport: vp, ...gap });
	}
	await browser.close();
	return { touchChromeLivesGapOk: failures.length === 0, failures };
}

async function runPortraitDeathLandscapeSpawnMatrix(baseUrl) {
	const failures = [];
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	for (let level = 0; level < 15; level++) {
		await page.setViewportSize({ width: 844, height: 390 });
		await page.waitForTimeout(300);
		await page.evaluate((idx) => {
			window.__icarusPrepareLevel?.(idx);
			window.__icarusGame?.scene.getScene('Play')?.handleDisplayResize?.();
		}, level);
		await waitForPlayReady(page, 20000);
		await page.evaluate(() => {
			window.__icarusGame?.scene
				.getScene('Play')
				?.killPlayer('fall', { fast: true, spendLife: false });
		});
		await page.waitForTimeout(200);
		await portraitRoundTrip(page);
		await waitForPlayReady(page, 25000);
		await page.waitForTimeout(400);
		const detail = await page.evaluate(() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			if (!play?.player?.sprite?.body) {
				return { ok: false, reason: 'no-body' };
			}
			const want = play.touchSpawnPosition();
			const spawnX = play.player.sprite.x;
			return {
				spawnX,
				wantX: want.x,
				ok: Math.abs(spawnX - want.x) <= 8,
			};
		});
		if (!detail.ok) failures.push({ level: level + 1, ...detail });
	}
	await browser.close();
	return {
		portraitDeathLandscapeSpawnOk: failures.length === 0,
		failures,
	};
}

async function runTouchArrowSlide(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	const left = await touchPointForTarget(page, 'left');
	const right = await touchPointForTarget(page, 'right');
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 1,
	});
	const mk = (p) => ({
		x: p.x,
		y: p.y,
		radiusX: 1,
		radiusY: 1,
		force: 1,
		id: 0,
	});
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [mk(left)],
	});
	await page.waitForTimeout(120);
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [mk(right)],
	});
	await page.waitForTimeout(200);
	const leftToRight = await page.evaluate(() => {
		const input = window.__icarusGame?.scene
			.getScene('Play')
			?.touchControls?.getInput?.();
		return { left: Boolean(input?.left), right: Boolean(input?.right) };
	});
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [mk({ x: right.x - 80, y: right.y - 80 })],
	});
	await page.waitForTimeout(120);
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [mk(right)],
	});
	await page.waitForTimeout(200);
	const backOnRight = await page.evaluate(() => {
		const input = window.__icarusGame?.scene
			.getScene('Play')
			?.touchControls?.getInput?.();
		return { right: Boolean(input?.right) };
	});
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	});
	await browser.close();
	return {
		touchArrowSlideOk:
			!leftToRight.left &&
			leftToRight.right &&
			backOnRight.right,
		leftToRight,
		backOnRight,
	};
}

async function runFireballFirstSpawnTiming(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	const firstEntry = await page.evaluate(async () => {
		window.__icarusPrepareLevel?.(5);
		await new Promise((r) => setTimeout(r, 80));
		window.__icarusPrepareLevel?.(5);
		const play = window.__icarusGame?.scene.getScene('Play');
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		);
		const t0 = play?.levelManager?.levelStartedAt ?? play?.time?.now ?? 0;
		let ms = null;
		for (let i = 0; i < 100; i++) {
			await new Promise((r) => setTimeout(r, 25));
			const n =
				play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
					.length ?? 0;
			if (n > 0) {
				ms = (play?.time?.now ?? 0) - t0;
				break;
			}
		}
		return ms;
	});
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall', {
			fast: true,
			spendLife: false,
		});
	});
	await page.waitForTimeout(500);
	await waitForPlayReady(page, 25000);
	const afterRespawn = await page.evaluate(async () => {
		const play = window.__icarusGame?.scene.getScene('Play');
		for (let i = 0; i < 160; i++) {
			await new Promise((r) => setTimeout(r, 25));
			const active =
				play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
					.length ?? 0;
			if (!play?.isResetting && active === 0) break;
		}
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		);
		const t0 = play?.levelManager?.levelStartedAt ?? play?.time?.now ?? 0;
		let ms = null;
		for (let i = 0; i < 100; i++) {
			await new Promise((r) => setTimeout(r, 25));
			const n =
				play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
					.length ?? 0;
			if (n > 0) {
				ms = (play?.time?.now ?? 0) - t0;
				break;
			}
		}
		return ms;
	});
	await browser.close();
	const target = expectedFireballFirstSpawnMs(1000, 1800);
	const near = (ms) => ms != null && ms >= target - 100 && ms <= target + 100;
	return {
		fireballFirstSpawnTimingOk: near(firstEntry) && near(afterRespawn),
		expectedFirstSpawnMs: target,
		firstEntryMs: firstEntry,
		afterRespawnMs: afterRespawn,
	};
}

async function runTouchResizeButtonClearance(baseUrl) {
	const cases = [
		{
			start: { width: 844, height: 390 },
			shrink: { width: 844, height: 340 },
		},
		{
			start: { width: 640, height: 360 },
			shrink: { width: 640, height: 310 },
		},
		{
			start: { width: 568, height: 320 },
			shrink: { width: 568, height: 270 },
		},
		{
			start: { width: 640, height: 844 },
			shrink: { width: 640, height: 360 },
			portraitStart: true,
		},
	];
	const failures = [];
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	for (const caseDef of cases) {
		await page.setViewportSize(caseDef.start);
		await page.waitForTimeout(400);
		await page.evaluate(() => {
			window.__icarusPrepareLevel?.(0);
		});
		await page.setViewportSize(caseDef.shrink);
		await page.waitForTimeout(600);
		const overlap = await collectTouchButtonOverlap(page);
		if (!overlap.ok) failures.push({ case: caseDef, ...overlap });
	}
	await browser.close();
	return { touchResizeButtonClearanceOk: failures.length === 0, failures };
}

async function runL15RealKeys(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	let won = false;
	for (let attempt = 0; attempt < 8 && !won; attempt++) {
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		play.lives = 30;
		play.updateLivesHud?.();
		play.abilityManager.abilities.jumpLevel = 3;
		play.abilityManager.abilities.dashLevel = 2;
		play.abilityManager.abilities.canMoveLeft = true;
		play.abilityManager.abilities.canShootArrows = true;
		play.abilityManager.abilities.visionLevel = 2;
		window.__icarusPrepareLevel?.(14);
		play.resetPlayer?.();
		play.closePause?.();
		play.clearLevelInstruction?.();
		play.isPaused = false;
		play.physics?.resume?.();
		if (play.time) {
			play.time.paused = false;
			play.time.timeScale = 1;
		}
	});
	await page.waitForTimeout(400);
	await page.locator('canvas').click();
	await page.keyboard.down('ArrowRight');
	await page.keyboard.down('ArrowUp');
	await page.keyboard.down('KeyD');
	const deadline = Date.now() + 120000;
	let lastX = (await getPlayerPos(page)).x;
	let stuckTicks = 0;
	while (Date.now() < deadline) {
		won = await page.evaluate(() =>
			window.__icarusGame?.scene.isActive('Win'),
		);
		if (won) break;
		const x = (await getPlayerPos(page)).x;
		if (x > lastX + 2) {
			stuckTicks = 0;
			lastX = x;
		} else {
			stuckTicks += 1;
		}
		if (stuckTicks >= 6) {
			await page.keyboard.press('KeyQ');
			await page.keyboard.press('KeyE');
			stuckTicks = 0;
		}
		const onGround = await page.evaluate(() => {
			const body =
				window.__icarusGame?.scene.getScene('Play')?.player?.sprite?.body;
			return Boolean(body?.touching?.down);
		});
		if (onGround) {
			await page.keyboard.press('Space');
			await page.waitForTimeout(120);
			await page.keyboard.press('Space');
		} else {
			await page.keyboard.press('Space');
		}
		await page.waitForTimeout(280);
	}
	await page.keyboard.up('ArrowRight');
	await page.keyboard.up('ArrowUp');
	await page.keyboard.up('KeyD');
	if (won) break;
	}
	await browser.close();
	return { l15RealKeysOk: won };
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
	await waitForPlayReady(page, 20000);
	await page.waitForTimeout(800);
	await page.locator('canvas').click();
	const deathCase = await assertUnfrozenAndMoving(page);

	// Loss card via real portal on a lose level
	await resetPlayLevel(page, 4);
	await page.locator('canvas').click();
	await teleportToGoal(page);
	await waitForPortalAdvance(page, 4);
	await portraitRoundTrip(page);
	await dismissAbilityModals(page, 4);
	await waitForPlayReady(page, 12000);
	await page.locator('canvas').click();
	const lossCase = await assertUnfrozenAndMoving(page);

	// Gain card via real portal on gain level
	await resetPlayLevel(page, 3);
	await page.locator('canvas').click();
	await teleportToGoal(page);
	await waitForPortalAdvance(page, 3);
	await portraitRoundTrip(page);
	await dismissAbilityModals(page, 3);
	await waitForPlayReady(page, 12000);
	await page.waitForTimeout(1600);
	await page.locator('canvas').click();
	const gainCase = await assertUnfrozenAndMoving(page);

	// Level: portrait during normal play (no manual state repair)
	await resetPlayLevel(page, 0);
	await portraitRoundTrip(page);
	await waitForPlayReady(page, 8000);
	await page.waitForTimeout(1600);
	await page.locator('canvas').click();
	const levelCase = await assertUnfrozenAndMoving(page);

	// Portal transition: rotate during the 500ms level-complete delay
	await resetPlayLevel(page, 0);
	await page.locator('canvas').click();
	await teleportToGoal(page);
	await page.waitForTimeout(80);
	await portraitRoundTrip(page);
	await waitForPlayReady(page, 25000);
	await dismissAbilityModals(page, 0);
	await page.locator('canvas').click();
	const portalTransitionCase = await assertUnfrozenAndMoving(page);

	// Death in portrait, then rotate back to landscape
	await resetPlayLevel(page, 0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(500);
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall', {
			fast: true,
			spendLife: false,
		});
	});
	await page.waitForFunction(
		() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return play && !play.isResetting && !play.player?.isDead;
		},
		undefined,
		{ timeout: 20000 },
	);
	await page.setViewportSize({ width: 844, height: 390 });
	await page.evaluate(() => {
		window.dispatchEvent(new Event('resize'));
		window.visualViewport?.dispatchEvent(new Event('resize'));
	});
	await page.waitForTimeout(1200);
	await page.waitForFunction(
		() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return (
				play &&
				!play.isResetting &&
				!play.player?.isDead &&
				!play.isPaused
			);
		},
		undefined,
		{ timeout: 45000 },
	);
	await page.waitForFunction(
		() => {
			const play = window.__icarusGame?.scene.getScene('Play');
			return play && !play.physics?.world?.isPaused;
		},
		undefined,
		{ timeout: 15000 },
	);
	await page.locator('canvas').click();
	const portraitKillRotateCase = await assertUnfrozenAndMoving(page);

	await browser.close();
	return {
		portraitUnfreezeOk:
			deathCase.ok &&
			lossCase.ok &&
			gainCase.ok &&
			levelCase.ok &&
			portalTransitionCase.ok &&
			portraitKillRotateCase.ok,
		deathCase,
		lossCase,
		gainCase,
		levelCase,
		portalTransitionCase,
		portraitKillRotateCase,
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
	await applyCpuThrottleIfRequested(page);
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

	const minMove = 40;
	const holdMs = 2800;
	await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const p = play?.player;
		const start = play?.levelManager?.current?.start;
		if (p && start) {
			p.revive(start.x, start.y);
			p.controlsEnabled = true;
		}
	});
	await page.waitForTimeout(200);
	const beforeMove = await getPlayerPos(page);
	await holdTouchRight(page, holdMs);
	let afterMove = await getPlayerPos(page);
	let touchMoveWorked = afterMove.x > beforeMove.x + minMove;
	for (let retry = 0; !touchMoveWorked && retry < 2; retry++) {
		await holdTouchRight(page, holdMs);
		afterMove = await getPlayerPos(page);
		touchMoveWorked = afterMove.x > beforeMove.x + minMove;
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
	try {
		await page.waitForFunction(
			() => {
				const play = window.__icarusGame?.scene.getScene('Play');
				const body = play?.player?.sprite?.body;
				return body?.touching?.down === true;
			},
			undefined,
			{ timeout: 12000 },
		);
	} catch {
		// continue — jump probe may still register air time
	}
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

async function applyCpuThrottleIfRequested(page) {
	if (process.env.QA_CPU_THROTTLE !== '1') return;
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

async function runTouchUrlBarShrinkAsserts(baseUrl) {
	const failures = [];
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	for (const caseDef of URL_BAR_SHRINK_CASES) {
		await page.setViewportSize(caseDef.start);
		await page.waitForTimeout(400);
		await page.evaluate((idx) => window.__icarusPrepareLevel?.(7), 7);
		await page.setViewportSize(caseDef.shrink);
		await page.waitForTimeout(650);
		const hud = await collectTouchHudOverlap(page);
		const buttons = await collectTouchButtonOverlap(page);
		const spawn = await evaluateTouchSpawnClearance(page, 7);
		if (!hud.ok && !hud.skip) {
			failures.push({ case: caseDef, kind: 'chrome', ...hud });
		}
		if (!buttons.ok && !buttons.skip) {
			failures.push({ case: caseDef, kind: 'buttons', ...buttons });
		}
		if (!spawn.ok && !spawn.skip) {
			failures.push({ case: caseDef, kind: 'spawn', ...spawn });
		}
	}
	await browser.close();
	return { touchUrlBarShrinkOk: failures.length === 0, failures };
}

async function runTouchDeathPhysicsPaused(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => window.__icarusPrepareLevel?.(5));
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall', {
			fast: true,
			spendLife: false,
		});
	});
	const sample = await page.evaluate(async () => {
		const play = window.__icarusGame?.scene.getScene('Play');
		let maxFireballs = 0;
		let timersUnpaused = false;
		let physicsRunning = false;
		for (let i = 0; i < 80; i++) {
			await new Promise((r) => setTimeout(r, 25));
			if (!play?.isResetting) break;
			const n =
				play?.levelManager?.fireballs?.filter((f) => f.sprite?.active)
					.length ?? 0;
			maxFireballs = Math.max(maxFireballs, n);
			if (
				(play?.levelManager?.fireballTimers ?? []).some((t) => !t.paused)
			) {
				timersUnpaused = true;
			}
			if (play?.physics?.world?.isPaused === false) {
				physicsRunning = true;
			}
		}
		return { maxFireballs, timersUnpaused, physicsRunning };
	});
	await browser.close();
	return {
		touchDeathPhysicsPausedOk:
			sample.maxFireballs === 0 && !sample.timersUnpaused,
		...sample,
	};
}

async function runTouchDeathHudResize(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.evaluate(() => window.__icarusPrepareLevel?.(0));
	await page.evaluate(() => {
		window.__icarusGame?.scene.getScene('Play')?.killPlayer('fall', {
			fast: true,
			spendLife: false,
		});
	});
	await page.waitForTimeout(200);
	await page.setViewportSize({ width: 568, height: 320 });
	await page.waitForTimeout(650);
	const gap = await page.evaluate(() => {
		const play = window.__icarusGame?.scene.getScene('Play');
		const chrome = play?.touchControls?.getChromeBounds?.() ?? [];
		const pause = chrome[0];
		const lives = play?.livesText?.getBounds?.();
		if (!pause || !lives) return { ok: false, reason: 'missing' };
		const overlap =
			pause.left < lives.right &&
			pause.right > lives.left &&
			pause.top < lives.bottom &&
			pause.bottom > lives.top;
		return { ok: !overlap, pause, lives };
	});
	await browser.close();
	return { touchDeathHudResizeOk: gap.ok, ...gap };
}

async function runTouchDualFingerSameButton(baseUrl) {
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	await bootToPlay(page, baseUrl);
	await page.locator('canvas').click();
	const right = await touchPointForTarget(page, 'right');
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 2,
	});
	const mk = (id, p) => ({
		id,
		x: p.x,
		y: p.y,
		radiusX: 1,
		radiusY: 1,
		force: 1,
	});
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [mk(0, right)],
	});
	await page.waitForTimeout(120);
	const heldA = await page.evaluate(
		() =>
			window.__icarusGame?.scene.getScene('Play')?.touchControls?.getInput()
				?.right === true,
	);
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [mk(0, right), mk(1, right)],
	});
	await page.waitForTimeout(80);
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [mk(1, right)],
	});
	await page.waitForTimeout(80);
	const heldAfterBLift = await page.evaluate(
		() =>
			window.__icarusGame?.scene.getScene('Play')?.touchControls?.getInput()
				?.right === true,
	);
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	});
	await page.waitForTimeout(80);
	const heldAfterALift = await page.evaluate(
		() =>
			window.__icarusGame?.scene.getScene('Play')?.touchControls?.getInput()
				?.right === true,
	);
	await browser.close();
	return {
		touchDualFingerSameButtonOk:
			heldA && heldAfterBLift && !heldAfterALift,
		heldA,
		heldAfterBLift,
		heldAfterALift,
	};
}

async function runProdBundleDebugGlobals(baseUrl) {
	const { execSync } = await import('node:child_process');
	execSync('npx vite build --config vite/config.prod.mjs', {
		cwd: process.cwd(),
		stdio: 'pipe',
	});
	const { readFileSync, readdirSync } = await import('node:fs');
	const { join } = await import('node:path');
	const distDir = join(process.cwd(), 'dist');
	const files = readdirSync(distDir).filter((f) => f.endsWith('.js'));
	let leaked = [];
	for (const file of files) {
		const text = readFileSync(join(distDir, file), 'utf8');
		if (text.includes('__icarusPrepareLevel')) leaked.push(file);
		if (text.includes('__icarusTouchChromeMetrics')) leaked.push(`${file}:metrics`);
	}
	return {
		prodBundleDebugGlobalsOk: leaked.length === 0,
		leaked,
	};
}

async function main() {
	const { execSync } = await import('node:child_process');
	execSync('npx vite build --config vite/config.qa.mjs', {
		cwd: process.cwd(),
		stdio: 'inherit',
	});
	const touchLayoutMutation = runTouchLayoutMutationGuards();
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
	const touchHudChromeOverlap = await runTouchHudChromeOverlapMatrix(baseUrl);
	const touchSpawn = await runTouchSpawnSafety(baseUrl);
	const touchDisplayResizeMutation =
		await runTouchDisplayResizeMutationProofs(baseUrl);
	const jumpButtonLegibility = await runJumpButtonLegibility(baseUrl);
	const wallJitterHold = await runWallJitterHold(baseUrl);
	const pausePanelLayout = await runPausePanelLayout(baseUrl);
	const touchButtonPlatform = await runTouchButtonPlatformClearance(baseUrl);
	const touchRelayoutHold = await runTouchRelayoutClearsHold(baseUrl);
	const touchRelayoutPreserve = await runTouchRelayoutPreservesHold(baseUrl);
	const jumpInPlace = await runJumpInPlaceStable(baseUrl);
	const platformSideJump = await runPlatformSideJump(baseUrl);
	const staleDashQueue = await runStaleDashQueue(baseUrl);
	const fireballPauseStack = await runFireballPauseStack(baseUrl);
	const wallDashBounds = await runWallDashBoundsCheck(baseUrl);
	let wallDashThrottled = { wallDashBoundsThrottledOk: true };
	if (process.env.QA_CPU_THROTTLE === '1') {
		wallDashThrottled = await runWallDashBoundsThrottled(baseUrl);
	}
	const resizeProgressHold = await runResizeProgressHold(baseUrl);
	const touchChromeLivesGap = await runTouchChromeLivesGap(baseUrl);
	const portraitDeathLandscapeSpawn =
		await runPortraitDeathLandscapeSpawnMatrix(baseUrl);
	const touchArrowSlide = await runTouchArrowSlide(baseUrl);
	const fireballFirstSpawnTiming = await runFireballFirstSpawnTiming(baseUrl);
	const touchResizeButtonClearance =
		await runTouchResizeButtonClearance(baseUrl);
	const touchUrlBarShrink = await runTouchUrlBarShrinkAsserts(baseUrl);
	const touchDeathPhysicsPaused = await runTouchDeathPhysicsPaused(baseUrl);
	const touchDeathHudResize = await runTouchDeathHudResize(baseUrl);
	const touchDualFingerSameButton = await runTouchDualFingerSameButton(baseUrl);
	const prodBundleDebugGlobals = await runProdBundleDebugGlobals(baseUrl);
	const l15RealKeys = await runL15RealKeys(baseUrl);
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
		touchLayoutMutation.touchLayoutMutationOk &&
		touchTitleChrome.touchTitleChromeOk &&
		touchHudChromeOverlap.touchHudChromeOverlapOk &&
		touchSpawn.touchSpawnOk &&
		touchDisplayResizeMutation.touchDisplayResizeMutationOk &&
		jumpButtonLegibility.jumpButtonLegibilityOk &&
		wallJitterHold.wallJitterHoldOk &&
		pausePanelLayout.pausePanelLayoutOk &&
		touchButtonPlatform.touchButtonPlatformOk &&
		touchRelayoutHold.touchRelayoutClearsHoldOk &&
		touchRelayoutPreserve.touchRelayoutPreservesHoldOk &&
		jumpInPlace.jumpInPlaceOk &&
		platformSideJump.platformSideJumpOk &&
		staleDashQueue.staleDashQueueOk &&
		fireballPauseStack.fireballPauseStackOk &&
		wallDashBounds.wallDashBoundsOk &&
		wallDashThrottled.wallDashBoundsThrottledOk &&
		resizeProgressHold.resizeProgressHoldOk &&
		touchChromeLivesGap.touchChromeLivesGapOk &&
		portraitDeathLandscapeSpawn.portraitDeathLandscapeSpawnOk &&
		touchArrowSlide.touchArrowSlideOk &&
		fireballFirstSpawnTiming.fireballFirstSpawnTimingOk &&
		touchResizeButtonClearance.touchResizeButtonClearanceOk &&
		touchUrlBarShrink.touchUrlBarShrinkOk &&
		touchDeathPhysicsPaused.touchDeathPhysicsPausedOk &&
		touchDeathHudResize.touchDeathHudResizeOk &&
		touchDualFingerSameButton.touchDualFingerSameButtonOk &&
		prodBundleDebugGlobals.prodBundleDebugGlobalsOk &&
		l15RealKeys.l15RealKeysOk &&
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
				touchLayoutMutation,
				touchTitleChrome,
				touchHudChromeOverlap,
				touchSpawn,
				touchDisplayResizeMutation,
				jumpButtonLegibility,
				wallJitterHold,
				pausePanelLayout,
				touchButtonPlatform,
				touchRelayoutHold,
				touchRelayoutPreserve,
				jumpInPlace,
				platformSideJump,
				staleDashQueue,
				fireballPauseStack,
				wallDashBounds,
				wallDashThrottled,
				resizeProgressHold,
				touchChromeLivesGap,
				portraitDeathLandscapeSpawn,
				touchArrowSlide,
				fireballFirstSpawnTiming,
				touchResizeButtonClearance,
				touchUrlBarShrink,
				touchDeathPhysicsPaused,
				touchDeathHudResize,
				touchDualFingerSameButton,
				prodBundleDebugGlobals,
				l15RealKeys,
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
	console.log(JSON.stringify({ pass: false, fatal: String(err) }, null, 2));
	process.exit(1);
});
