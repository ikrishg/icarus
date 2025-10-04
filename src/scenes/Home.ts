import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';

export class Home extends Scene {
	backgroundManager: BackgroundManager;
	wordmark: GameObjects.Image;
	instruction: GameObjects.Text;

	constructor() {
		super('Home');
	}

	create() {
		this.backgroundManager = new BackgroundManager(this);

		this.wordmark = this.add
			.image(WIDTH / 2, HEIGHT / 2, 'wordmark')
			.setDepth(5);

		this.instruction = this.add
			.text(WIDTH / 2, HEIGHT - 150, 'CLICK OR PRESS ANY KEY TO START', {
				font: '48px Pixelify Sans',
				fontStyle: '700',
				color: '#1b1b1c',
			})
			.setOrigin(0.5)
			.setShadow(2, 2, '#ffffff', 0.5, false, true)
			.setDepth(5);

		this.input.once('pointerdown', () => {
			this.startGame();
		});

		this.input.keyboard?.once('keydown', () => {
			this.startGame();
		});
	}

	startGame() {
		this.scene.switch('Menu');
	}
}
