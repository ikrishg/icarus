import { Scene } from 'phaser';

export class Boot extends Scene {
	constructor() {
		super('Boot');
	}

	preload() {
		this.load.image('background', 'assets/sky.webp');
		this.load.image('wordmark', 'assets/wordmark.webp');
		this.load.image('cloud', 'assets/cloud.webp');
		this.load.image('arrow', 'assets/sword.webp');
		this.load.spritesheet('icarus', 'assets/icarus.webp', {
			frameWidth: 256,
			frameHeight: 276,
		});
	}

	create() {
		this.scene.switch('Home');
	}
}
