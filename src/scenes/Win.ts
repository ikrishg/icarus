import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';
import { PALETTE, PALETTE_HEX } from '../util/palette';
import { sanitizePixelFont } from '../util/text';

export class Win extends Scene {
	backgroundManager: BackgroundManager;
	winHeadline!: GameObjects.Text;
	winBody!: GameObjects.Text;
	backdrop!: GameObjects.Rectangle;
	keyHints!: GameObjects.Text;
	giftsLost = 0;

	constructor() {
		super('Win');
	}

	init(data: { giftsLost?: number }) {
		this.giftsLost = data.giftsLost ?? 0;
	}

	create() {
		this.sound.stopAll();

		this.backgroundManager = new BackgroundManager(this);

		this.backdrop = this.add
			.rectangle(0, 0, WIDTH, HEIGHT, PALETTE.deep, 0.92)
			.setOrigin(0, 0)
			.setDepth(3);

		const headlineFontSize = 128;
		const bodyFontSize = 56;
		const hintFontSize = 42;

		const headlineY = HEIGHT / 3;
		const bodyY = headlineY + headlineFontSize + 120;
		const hintsY = HEIGHT - 100;

		this.winHeadline = this.add
			.text(WIDTH / 2, headlineY, 'YOU REACHED THE SUN', {
				font: `${headlineFontSize}px Pixelify Sans`,
				color: PALETTE_HEX.sunGold,
				stroke: PALETTE_HEX.deep,
				strokeThickness: 6,
				align: 'center',
			})
			.setOrigin(0.5)
			.setDepth(4);

		this.winBody = this.add
			.text(
				WIDTH / 2,
				bodyY,
				sanitizePixelFont(
					`You lost ${this.giftsLost} gifts on the way up. The wax held long enough.`,
				),
				{
					font: `${bodyFontSize}px Pixelify Sans`,
					color: '#fdfdfe',
					align: 'center',
					lineSpacing: 8,
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

		this.tweens.add({
			targets: this.keyHints,
			alpha: { from: 0.6, to: 1 },
			duration: 1000,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut',
		});

		this.input.keyboard?.once('keydown', () => {
			this.scene.start('Menu');
		});

		this.input.once('pointerdown', () => {
			this.scene.start('Menu');
		});
	}
}
