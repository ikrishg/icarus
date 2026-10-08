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
	clouds: GameObjects.Sprite[] = [];
	icarus?: GameObjects.Sprite;
	icaruses: GameObjects.Sprite[] = [];
	options: BackgroundOptions;

	static readonly ICARUS_FRAME_WIDTH = 52;
	static readonly ICARUS_FRAME_HEIGHT = 56;

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
		const edgeMargin = Math.max(16, Math.floor(Math.min(WIDTH, HEIGHT) * 0.02));

		for (let i = 0; i < cloudCount; i++) {
			const cy = Phaser.Math.Between(20, Math.max(20, Math.floor(HEIGHT - 20)));
			const startX = Phaser.Math.Between(
				-Math.floor(WIDTH - edgeMargin),
				Math.floor(WIDTH - edgeMargin),
			);
			const cloud = this.scene.add
				.sprite(startX, cy, 'cloud', Phaser.Math.Between(0, 2))
				.setAlpha(0.9)
				.setScale(6)
				.setDepth(0.2);

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
					cloud.setFrame(Phaser.Math.Between(0, 2));
				},
			});

			this.clouds.push(cloud);
		}
	}

	createIcarus() {
		if (!this.scene.anims.exists('icarus-fly')) {
			this.scene.anims.create({
				key: 'icarus-fly',
				frames: this.scene.anims.generateFrameNumbers('icarus', {
					start: 10,
					end: 13,
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

			sprite.setScale(1).setAlpha(0.6);
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
