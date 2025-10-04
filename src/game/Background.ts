import type { GameObjects, Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../util/constants';

export interface BackgroundOptions {
	icarus: boolean;
}

interface IcarusSprite extends GameObjects.Sprite {
	_baseY?: number;
	_amplitude?: number;
	_freq?: number;
	_phase?: number;
}

export class BackgroundManager {
	scene: Scene;
	clouds: GameObjects.Image[] = [];
	icarus?: GameObjects.Sprite;
	icaruses: GameObjects.Sprite[] = [];
	options: BackgroundOptions;

	static readonly ICARUS_FRAME_WIDTH = 64;
	static readonly ICARUS_FRAME_HEIGHT = 69;

	constructor(scene: Scene, options: BackgroundOptions = { icarus: true }) {
		this.scene = scene;
		this.options = Object.assign(
			{
				icarus: true,
			},
			options,
		);

		this.createBackground();
		this.createClouds();

		if (this.options.icarus) this.createIcarus();
	}

	createBackground() {
		this.scene.add
			.image(0, 0, 'background')
			.setOrigin(0)
			.setDisplaySize(WIDTH, HEIGHT);
	}

	createClouds() {
		const cloudCount = 6;
		const cloudMinScale = 0.2;
		const cloudMaxScale = 0.65;
		const edgeMargin = Math.max(16, Math.floor(Math.min(WIDTH, HEIGHT) * 0.02));

		for (let i = 0; i < cloudCount; i++) {
			const cy = Phaser.Math.Between(20, Math.max(20, Math.floor(HEIGHT - 20)));
			const scale = Phaser.Math.FloatBetween(cloudMinScale, cloudMaxScale);
			const startX = Phaser.Math.Between(
				-Math.floor(WIDTH - edgeMargin),
				Math.floor(WIDTH - edgeMargin),
			);
			const cloud = this.scene.add
				.image(startX, cy, 'cloud')
				.setAlpha(0.9)
				.setScale(scale)
				.setDepth(0);

			const duration = Phaser.Math.Between(25000, 55000);

			cloud.x = Phaser.Math.Between(
				edgeMargin,
				Math.max(edgeMargin, WIDTH * 2 - edgeMargin),
			);

			this.scene.tweens.add({
				targets: cloud,
				x: -cloud.displayWidth,
				duration,
				ease: 'Linear',
				repeat: -1,
				onRepeat: () => {
					cloud.x = WIDTH + cloud.displayWidth + edgeMargin;
					cloud.y = Phaser.Math.Between(
						edgeMargin,
						Math.max(edgeMargin, Math.floor(HEIGHT - edgeMargin)),
					);
					cloud.setScale(
						Phaser.Math.FloatBetween(cloudMinScale, cloudMaxScale),
					);
				},
			});

			this.clouds.push(cloud);
		}
	}

	createIcarus() {
		const icarusFrameStart = 0;
		const icarusFrameEnd = 15;
		const icarusDisplayHeight = 24;

		if (!this.scene.anims.exists('icarus-fly')) {
			this.scene.anims.create({
				key: 'icarus-fly',
				frames: this.scene.anims.generateFrameNumbers('icarus', {
					start: icarusFrameStart,
					end: icarusFrameEnd,
				}),
				frameRate: 8,
				repeat: -1,
			});
		}

		const count = 3;

		for (let i = 0; i < count; i++) {
			const startX = -50 - Phaser.Math.Between(0, Math.floor(WIDTH * 0.25));
			// spread icarus vertically across the screen
			const baseY = Phaser.Math.Between(
				Math.floor(HEIGHT * 0.08),
				Math.floor(HEIGHT * 0.92),
			);

			const sprite = this.scene.add
				.sprite(startX, baseY, 'icarus')
				.setDepth(0.1 + i * 0.01) as IcarusSprite;

			const scale = icarusDisplayHeight / BackgroundManager.ICARUS_FRAME_HEIGHT;
			sprite.setScale(scale);
			sprite.play('icarus-fly');

			// store in arrays; keep first sprite in `icarus` for compatibility
			this.icaruses.push(sprite);
			if (!this.icarus) this.icarus = sprite;

			// randomize movement parameters so each has a distinct pattern
			const duration = Phaser.Math.Between(5000, 10000);
			const delay = i * 600 + Phaser.Math.Between(0, 800);
			// amplitude should scale with screen height so high/low flyers move naturally
			const amplitude = Phaser.Math.Between(
				Math.max(8, Math.floor(HEIGHT * 0.02)),
				Math.max(20, Math.floor(HEIGHT * 0.12)),
			);
			const freq = Phaser.Math.FloatBetween(0.5, 1.8); // how many oscillations per crossing
			const phase = Phaser.Math.FloatBetween(0, Math.PI * 2);

			// tween horizontal travel; onUpdate we'll compute a sine-based y offset for a wavy path
			this.scene.tweens.add({
				targets: sprite,
				x: WIDTH + 50,
				duration,
				ease: 'Linear',
				repeat: -1,
				delay,
				onRepeat: () => {
					sprite.x = -50 - Phaser.Math.Between(0, Math.floor(WIDTH * 0.25));

					sprite._baseY = Phaser.Math.Between(
						Math.floor(HEIGHT * 0.08),
						Math.floor(HEIGHT * 0.92),
					);

					sprite._amplitude = Phaser.Math.Between(
						Math.max(8, Math.floor(HEIGHT * 0.02)),
						Math.max(20, Math.floor(HEIGHT * 0.12)),
					);
					sprite._freq = Phaser.Math.FloatBetween(0.5, 1.8);
					sprite._phase = Phaser.Math.FloatBetween(0, Math.PI * 2);
				},
				onUpdate: (tween: Phaser.Tweens.Tween) => {
					const t = tween.progress as number;
					const bY = sprite._baseY ?? baseY;
					const a = sprite._amplitude ?? amplitude;
					const f = sprite._freq ?? freq;
					const p = sprite._phase ?? phase;

					sprite.y = Math.floor(bY + Math.sin(t * Math.PI * 2 * f + p) * a);

					sprite.rotation = Math.sin(t * Math.PI * 2 * f + p) * 0.08;
				},
			});
		}
	}
}
