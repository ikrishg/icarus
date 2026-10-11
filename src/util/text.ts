const breakLigature = (pair: string, text: string): string => {
	const re = new RegExp(pair, 'gi');
	return text.replace(re, (match) => {
		const first = match[0];
		const second = match[1];
		const upper = first === first.toUpperCase();
		return `${upper ? first.toUpperCase() : first}\u200C${upper ? second.toUpperCase() : second}`;
	});
};

/** Break common Pixelify Sans ligatures (e.g. "fl"/"fi" → wrong "A" glyph). */
export function sanitizePixelFont(text: string): string {
	let out = text;
	out = breakLigature('fl', out);
	out = breakLigature('fi', out);
	out = breakLigature('ff', out);
	return out;
}

export const PIXEL_FONT_FAMILY = 'Pixelify Sans';

export const pixelTextStyle = (
	overrides: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.Types.GameObjects.Text.TextStyle => ({
	fontFamily: PIXEL_FONT_FAMILY,
	...overrides,
});
