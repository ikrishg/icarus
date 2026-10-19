import type { Game } from 'phaser';

/** Keep Phaser FIT scale in sync when the viewport or orientation changes. */
export function attachScaleRefresh(
	game: Game,
	afterRefresh?: () => void,
): void {
	if (typeof window === 'undefined') return;

	const refresh = () => {
		game.scale.refresh();
		afterRefresh?.();
	};

	window.addEventListener('resize', refresh);
	window.addEventListener('orientationchange', () => {
		window.setTimeout(refresh, 50);
		window.setTimeout(refresh, 250);
	});

	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', refresh);
	}

	if (typeof window.matchMedia === 'function') {
		const portrait = window.matchMedia('(orientation: portrait)');
		const onOrientationMedia = () => {
			window.setTimeout(refresh, 0);
			window.setTimeout(refresh, 100);
		};
		if (typeof portrait.addEventListener === 'function') {
			portrait.addEventListener('change', onOrientationMedia);
		} else if (typeof portrait.addListener === 'function') {
			portrait.addListener(onOrientationMedia);
		}
	}
}
