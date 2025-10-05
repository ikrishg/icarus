import { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../util/constants';

export class Preloader extends Scene {
	constructor() {
		super('Preloader');
	}

	preload() {
		// Create loading bar background
		const barWidth = 600;
		const barHeight = 40;
		const barX = WIDTH / 2 - barWidth / 2;
		const barY = HEIGHT / 2;

		// Background color
		this.cameras.main.setBackgroundColor('#1b1b1c');

		// Loading text
		const loadingText = this.add
			.text(WIDTH / 2, barY - 80, 'LOADING...', {
				fontFamily: 'Pixelify Sans',
				fontSize: '48px',
				color: '#ffffff',
			})
			.setOrigin(0.5);

		// Progress bar background
		const progressBox = this.add.graphics();
		progressBox.fillStyle(0x000000, 0.8);
		progressBox.fillRect(barX, barY, barWidth, barHeight);

		// Progress bar fill
		const progressBar = this.add.graphics();

		// Percentage text
		const percentText = this.add
			.text(WIDTH / 2, barY + barHeight / 2, '0%', {
				fontFamily: 'Pixelify Sans',
				fontSize: '24px',
				color: '#ffffff',
			})
			.setOrigin(0.5);

		// Asset loading text
		const assetText = this.add
			.text(WIDTH / 2, barY + 80, '', {
				fontFamily: 'Pixelify Sans',
				fontSize: '20px',
				color: '#ffffff',
			})
			.setOrigin(0.5);

		// Update progress bar
		this.load.on('progress', (value: number) => {
			progressBar.clear();
			progressBar.fillStyle(0xffffff, 1);
			progressBar.fillRect(
				barX + 4,
				barY + 4,
				(barWidth - 8) * value,
				barHeight - 8,
			);
			percentText.setText(`${Math.floor(value * 100)}%`);
		});

		// Update asset text
		this.load.on('fileprogress', (file: { key: string }) => {
			assetText.setText(`Loading: ${file.key}`);
		});

		// Complete
		this.load.on('complete', () => {
			progressBar.destroy();
			progressBox.destroy();
			loadingText.destroy();
			percentText.destroy();
			assetText.destroy();
		});

		// Load all game assets
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

		// Load audio files
		this.load.audio('instruments', 'assets/instruments.ogg');
		this.load.audio('battle-beats', 'assets/battle-beats.ogg');
		this.load.audio('battle-climax', 'assets/battle-climax.mp3');

		this.load.audio('success', 'assets/success.wav');
		this.load.audio('death', 'assets/death.ogg');
		this.load.audio('shoot', 'assets/shoot.wav');
		this.load.audio('shot', 'assets/shot.wav');
	}

	create() {
		// Create animations
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

		// Go to Home scene
		this.scene.start('Home');
	}
}
