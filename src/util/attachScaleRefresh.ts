import type { Game } from 'phaser';

/** Keep Phaser FIT scale in sync when the viewport or orientation changes. */
export function attachScaleRefresh(game: Game): void {
	if (typeof window === 'undefined') return;

	const refresh = () => {
		game.scale.refresh();
	};

	window.addEventListener('resize', refresh);
	window.addEventListener('orientationchange', () => {
		window.setTimeout(refresh, 50);
		window.setTimeout(refresh, 250);
	});

	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', refresh);
	}
}
