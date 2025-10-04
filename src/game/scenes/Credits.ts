import { type GameObjects, Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../../util/constants';
import { BackgroundManager } from '../Background';

export class Credits extends Scene {
	backgroundManager: BackgroundManager;
	credits: GameObjects.Text;

	constructor() {
		super('Credits');
	}

	create() {
		this.backgroundManager = new BackgroundManager(this);

		this.credits = this.add
			.text(
				WIDTH / 2,
				HEIGHT / 2,
				'CREDITS\nMade by Krish Gupta\nAssets: Public Domain',
				{
					font: '36px Pixelify Sans',
					color: '#ffffff',
					align: 'center',
				},
			)
			.setOrigin(0.5);

		this.input.on('pointerdown', () => {
			this.scene.switch('Menu');
		});

		this.input.keyboard?.on('keydown', () => {
			this.scene.switch('Menu');
		});
	}
}
