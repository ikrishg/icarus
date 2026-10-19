import type { Scene } from 'phaser';
import { HEIGHT, WIDTH } from './constants';

const MIN_TOUCH_CSS_PX = 44;
const BASE_MARGIN_GAME_PX = 24;

/** HUD band under the level title where Pause lives (left side). */
const CHROME_ROW_Y = 108;

export type TouchChromeMetrics = {
	margin: number;
	chromeW: number;
	chromeH: number;
	chromeGap: number;
	pauseCenterX: number;
	pauseCenterY: number;
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
	const chromeW = Math.max(96, Math.ceil(88 / displayScale));
	const chromeGap = Math.max(12, Math.ceil(8 / displayScale));
	const pauseCenterX = margin + chromeW / 2;
	const pauseCenterY = CHROME_ROW_Y;
	return {
		margin,
		chromeW,
		chromeH,
		chromeGap,
		pauseCenterX,
		pauseCenterY,
		rightReserve: margin + chromeW + 12,
	};
}
