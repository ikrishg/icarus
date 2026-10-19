import type { Game } from 'phaser';
import StartGame from './main';
import { attachScaleRefresh } from './util/attachScaleRefresh';

declare global {
	interface Window {
		__icarusGame?: Game;
		__icarusGetColliders?: () => number;
		__icarusGetLives?: () => number;
	}
}

document.addEventListener('DOMContentLoaded', () => {
	const game = StartGame('icarus-window');
	window.__icarusGame = game;
	attachScaleRefresh(game);
});
