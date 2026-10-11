import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';
import { PALETTE, PALETTE_HEX } from '../util/palette';
import { sanitizePixelFont } from '../util/text';

export class Dead extends Scene {
	backgroundManager: BackgroundManager;
	deadHeadline!: GameObjects.Text;
	deadBody!: GameObjects.Text;
	backdrop!: GameObjects.Rectangle;
	keyHints!: GameObjects.Text;

	constructor() {
		super('Dead');
	}

	create() {
		this.sound.stopAll();

		this.backgroundManager = new BackgroundManager(this);

		this.backdrop = this.add
			.rectangle(0, 0, WIDTH, HEIGHT, PALETTE.deep, 0.92)
			.setOrigin(0, 0)
			.setDepth(3);

		const headlineFontSize = 112;
		const bodyFontSize = 52;
		const hintFontSize = 42;

		const headlineY = HEIGHT / 3;
		const bodyY = headlineY + headlineFontSize + 120;
		const hintsY = HEIGHT - 100;

		this.deadHeadline = this.add
			.text(WIDTH / 2, headlineY, 'THE WAX GAVE WAY', {
				font: `${headlineFontSize}px Pixelify Sans`,
				color: PALETTE_HEX.fire,
				stroke: PALETTE_HEX.deep,
				strokeThickness: 4,
				align: 'center',
			})
			.setOrigin(0.5)
			.setDepth(4);

		this.deadBody = this.add
			.text(
				WIDTH / 2,
				bodyY,
				sanitizePixelFont('Icarus fell. Try again.'),
				{
					font: `${bodyFontSize}px Pixelify Sans`,
					color: '#fdfdfe',
					align: 'center',
					lineSpacing: 12,
					wordWrap: { useAdvancedWrap: true, width: WIDTH - 200 },
				},
			)
			.setOrigin(0.5)
			.setDepth(4);

		this.keyHints = this.add
			.text(WIDTH / 2, hintsY, 'Press any key to return', {
				font: `${hintFontSize}px Pixelify Sans`,
				color: '#cccccc',
				align: 'center',
				lineSpacing: 8,
			})
			.setOrigin(0.5)
			.setAlpha(0.95)
			.setDepth(4);

		this.input.keyboard?.once('keydown', () => {
			this.scene.start('Menu');
		});

		this.input.once('pointerdown', () => {
			this.scene.start('Menu');
		});
	}
}
