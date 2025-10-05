import { Scene } from 'phaser';

export class Boot extends Scene {
	constructor() {
		super('Boot');
	}

	preload() {
		this.load.image('background', 'assets/sky.webp');
		this.load.image('wordmark', 'assets/wordmark.webp');
		this.load.image('cloud', 'assets/cloud.webp');
		this.load.image('sword', 'assets/sword.webp');
		this.load.image('bow', 'assets/bow.webp');
		this.load.image('dash', 'assets/dash.webp');
		this.load.image('flight', 'assets/flight.webp');
		this.load.image('jump', 'assets/jump.webp');
		this.load.image('vision', 'assets/eyes.webp');
		this.load.image('left', 'assets/left.webp');
		this.load.spritesheet('icarus', 'assets/icarus.webp', {
			frameWidth: 256,
			frameHeight: 276,
		});
		this.load.spritesheet('ground', 'assets/ground.webp', {
			frameWidth: 448,
			frameHeight: 162,
		});
		this.load.spritesheet('lava', 'assets/lava.webp', {
			frameWidth: 832,
			frameHeight: 192,
		});
		this.load.spritesheet('spikes', 'assets/spikes.webp', {
			frameWidth: 402,
			frameHeight: 129,
		});
		this.load.spritesheet('enemy', 'assets/enemy.webp', {
			frameWidth: 336,
			frameHeight: 498,
		});
		this.load.spritesheet('portal', 'assets/portal.webp', {
			frameWidth: 192,
			frameHeight: 256,
		});
		this.load.spritesheet('fireball', 'assets/fireball.webp', {
			frameWidth: 192,
			frameHeight: 194,
		});
		this.load.spritesheet('arrow', 'assets/arrow.webp', {
			frameWidth: 224,
			frameHeight: 114,
		});
	}

	create() {
		if (!this.anims.exists('player-fly')) {
			this.anims.create({
				key: 'player-fly',
				frames: this.anims.generateFrameNumbers('icarus', {
					start: 0,
					end: 15,
				}),
				frameRate: 12,
				repeat: -1,
			});
		}

		this.scene.switch('Home');
	}
}
