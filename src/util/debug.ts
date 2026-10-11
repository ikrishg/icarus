/** Dev always; production only when `?debug=1` is in the URL. */
export function isDebugPlayEnabled(): boolean {
	if (import.meta.env.DEV) {
		return true;
	}
	if (typeof window === 'undefined') {
		return false;
	}
	return new URLSearchParams(window.location.search).get('debug') === '1';
}
