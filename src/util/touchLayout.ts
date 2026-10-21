import type { Scene } from 'phaser';
import { HEIGHT, WIDTH } from './constants';

const MIN_TOUCH_CSS_PX = 44;
const BASE_MARGIN_GAME_PX = 24;

/** HUD band: Pause sits above Lives on the left. */
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
	const pauseCenterY = CHROME_ROW_Y + chromeH / 2;
	const livesTextX = margin + chromeW + 16;
	const livesTextY = pauseCenterY + chromeH / 2 + chromeGap;
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
	};
}
