import { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../../util/constants';

export class Play extends Scene {
	constructor() {
		super('Play');
	}

	create() {
		this.add
			.text(WIDTH / 2, HEIGHT / 2, 'PLAY SCENE (placeholder)', {
				font: '48px Pixelify Sans',
				color: '#ffffff',
			})
			.setOrigin(0.5);

		// Return to menu on any key or click
		this.input.keyboard?.on('keydown', () => this.scene.switch('Menu'));
		this.input.on('pointerdown', () => this.scene.switch('Menu'));
	}
}
