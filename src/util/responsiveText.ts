import type { Scene } from 'phaser';
import { HEIGHT, WIDTH } from './constants';

function sceneIsTouch(scene: Scene): boolean {
	if (scene.sys.game.device.input.touch) return true;
	if (typeof window === 'undefined') return false;
	return (
		'ontouchstart' in window ||
		navigator.maxTouchPoints > 0 ||
		window.matchMedia('(pointer: coarse)').matches
	);
}

/** Smallest on-screen text target for touch landscape (game px scaled to CSS). */
export const MIN_TOUCH_SCREEN_TEXT_PX = 12;

export function displayScaleFactor(scene: Scene): number {
	return Math.min(
		scene.scale.displaySize.width / WIDTH,
		scene.scale.displaySize.height / HEIGHT,
	);
}

export function gameFontForMinScreenPx(
	scene: Scene,
	minScreenPx: number,
): number {
	const scale = Math.max(displayScaleFactor(scene), 0.01);
	return Math.ceil(minScreenPx / scale);
}

/** On touch devices, bump game font size so CSS text stays at least minScreenPx. */
export function touchBodyFontPx(
	scene: Scene,
	baseGamePx: number,
	minScreenPx: number = MIN_TOUCH_SCREEN_TEXT_PX,
): number {
	if (!sceneIsTouch(scene)) return baseGamePx;
	return Math.max(baseGamePx, gameFontForMinScreenPx(scene, minScreenPx));
}

export function touchFontSizeStyle(
	scene: Scene,
	baseGamePx: number,
	minScreenPx: number = MIN_TOUCH_SCREEN_TEXT_PX,
): string {
	return `${touchBodyFontPx(scene, baseGamePx, minScreenPx)}px`;
}
