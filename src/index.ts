import type { Game } from 'phaser';
import StartGame from './main';

declare global {
	interface Window {
		__icarusGame?: Game;
		__icarusGetColliders?: () => number;
		__icarusGetLives?: () => number;
	}
}

document.addEventListener('DOMContentLoaded', () => {
	window.__icarusGame = StartGame('icarus-window');
});
