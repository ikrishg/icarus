/** Matches public/style.css portrait blocker visibility. */
export const PORTRAIT_BLOCKER_MEDIA =
	'(orientation: portrait) and (max-width: 600px) and (pointer: coarse)';

export function isPortraitBlockerActive(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(PORTRAIT_BLOCKER_MEDIA).matches;
}
