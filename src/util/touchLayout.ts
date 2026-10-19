import type { Scene } from 'phaser';
import { HEIGHT, PLAY_HUD_CLEARANCE_Y, WIDTH } from './constants';

const MIN_TOUCH_CSS_PX = 44;
const BASE_MARGIN_GAME_PX = 24;

export type TouchChromeMetrics = {
	margin: number;
	chromeW: number;
	chromeH: number;
	chromeGap: number;
	chromeCenterX: number;
	pauseCenterY: number;
	restartCenterY: number;
	rightReserve: number;
};

export function touchChromeMetrics(scene: Scene): TouchChromeMetrics {
	const displayScale = Math.max(
		scene.scale.displaySize.width / WIDTH,
		scene.scale.displaySize.height / HEIGHT,
	);
	const margin = Math.max(
		BASE_MARGIN_GAME_PX,
		Math.ceil(BASE_MARGIN_GAME_PX / displayScale),
	);
	const chromeH = Math.max(48, Math.ceil(MIN_TOUCH_CSS_PX / displayScale));
	const chromeW = Math.max(120, Math.ceil(100 / displayScale));
	const chromeGap = Math.max(12, Math.ceil(8 / displayScale));
	const chromeCenterX = WIDTH - margin - chromeW / 2;
	const pauseCenterY = PLAY_HUD_CLEARANCE_Y + 8 + chromeH / 2;
	const restartCenterY = pauseCenterY + chromeH + chromeGap;
	const rightReserve = margin + chromeW + 16;
	return {
		margin,
		chromeW,
		chromeH,
		chromeGap,
		chromeCenterX,
		pauseCenterY,
		restartCenterY,
		rightReserve,
	};
}
