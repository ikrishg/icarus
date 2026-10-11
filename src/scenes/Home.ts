import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';
import { PALETTE_HEX } from '../util/palette';
import { sanitizePixelFont } from '../util/text';

export class Home extends Scene {
	backgroundManager: BackgroundManager;
	wordmark: GameObjects.Image;
	instruction: GameObjects.Text;

	constructor() {
		super('Home');
	}

	create() {
		this.sound.stopAll();

		this.backgroundManager = new BackgroundManager(this);

		this.wordmark = this.add
			.image(WIDTH / 2, HEIGHT / 2, 'wordmark')
			.setDepth(5);

		this.instruction = this.add
			.text(
				WIDTH / 2,
				HEIGHT * 0.7,
				sanitizePixelFont('Press any key or tap'),
				{
					font: '48px Pixelify Sans',
					fontStyle: '700',
					color: PALETTE_HEX.deep,
				},
			)
			.setOrigin(0.5)
			.setDepth(5);

		this.tweens.add({
			targets: this.instruction,
			alpha: { from: 0.55, to: 1 },
			duration: 1000,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut',
		});

		this.input.once('pointerdown', () => {
			this.startGame();
		});

		this.input.keyboard?.once('keydown', () => {
			this.startGame();
		});
	}

	startGame() {
		this.sound.play('success', { volume: 0.6 });
		this.scene.switch('Menu');
	}
}
