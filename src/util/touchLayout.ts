import type { Scene } from 'phaser';
import { HEIGHT, PLAY_HUD_CLEARANCE_Y, WIDTH } from './constants';

const MIN_TOUCH_CSS_PX = 44;
const BASE_MARGIN_GAME_PX = 24;
const LIVES_LABEL_HEIGHT_GAME_PX = 44;

/** HUD band: Pause with Lives stacked below on the left. */
const CHROME_ROW_Y = 52;
export type TouchChromeMetrics = {
	margin: number;
	chromeW: number;
	chromeH: number;
	chromeGap: number;
	pauseCenterX: number;
	pauseCenterY: number;
	livesTextX: number;
	livesTextY: number;
	rightReserve: number;
	/** Bottom of the Pause + Lives stack in game space. */
	hudStackBottom: number;
};

export function touchChromeMetrics(scene: Scene): TouchChromeMetrics {
	const displayScale = Math.max(
		scene.scale.displaySize.width / WIDTH,
		scene.scale.displaySize.height / HEIGHT,
	);
	const margin = Math.max(
		BASE_MARGIN_GAME_PX,
		Math.min(48, Math.ceil(BASE_MARGIN_GAME_PX / displayScale)),
	);
	const chromeH = Math.min(
		52,
		Math.max(44, Math.ceil(MIN_TOUCH_CSS_PX / displayScale)),
	);
	const chromeW = Math.min(
		112,
		Math.max(88, Math.ceil(88 / displayScale)),
	);
	const chromeGap = Math.max(16, Math.ceil(12 / displayScale));
	const rowTop = CHROME_ROW_Y;
	const pauseCenterX = margin + chromeW / 2;
	const pauseCenterY = rowTop + chromeH / 2;
	const pauseRight = margin + chromeW;
	const livesTextX = pauseRight + chromeGap;
	const livesTextY = rowTop + (chromeH - LIVES_LABEL_HEIGHT_GAME_PX) / 2;
	const hudStackBottom = Math.max(
		pauseCenterY + chromeH / 2,
		livesTextY + LIVES_LABEL_HEIGHT_GAME_PX,
	);
	return {
		margin,
		chromeW,
		chromeH,
		chromeGap,
		pauseCenterX,
		pauseCenterY,
		livesTextX,
		livesTextY,
		rightReserve: livesTextX + 140,
		hudStackBottom,
	};
}

/** Center Y for the level instruction panel on touch (clears HUD chrome). */
export function touchInstructionPanelCenterY(scene: Scene): number {
	const chrome = touchChromeMetrics(scene);
	const panelHalfH = 60;
	const gapBelowHud = 16;
	const minCenter = chrome.hudStackBottom + gapBelowHud + panelHalfH;
	return Math.max(PLAY_HUD_CLEARANCE_Y + 110, minCenter);
}
