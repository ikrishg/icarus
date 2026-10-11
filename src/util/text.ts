/** Break common ligatures (e.g. Pixelify Sans "fl" → wrong glyph) for canvas text. */
export function sanitizePixelFont(text: string): string {
	return text.replace(/fl/gi, (match) =>
		match[0] === 'F' ? 'F\u200Cl' : 'f\u200Cl',
	);
}

export const PIXEL_FONT_FAMILY = 'Pixelify Sans';

export const pixelTextStyle = (
	overrides: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.Types.GameObjects.Text.TextStyle => ({
	fontFamily: PIXEL_FONT_FAMILY,
	...overrides,
});
