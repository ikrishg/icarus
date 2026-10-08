import type { GameObjects, Scene } from 'phaser';
import { LEVELS } from '../data/levels';
import type { LevelDefinition, ObstacleDef, Point } from '../util/types';
import { Fireball } from './Fireball';

export type { Point, ObstacleDef, LevelDefinition };

export class LevelManager {
	scene: Scene;
	levels: LevelDefinition[];
	currentIndex: number = 0;

	visuals: GameObjects.Group;
	platforms: Phaser.Physics.Arcade.StaticGroup;
	hazards: GameObjects.Group;
	portal: Phaser.GameObjects.Container;
	fireballs: Fireball[] = [];
	fireballTimers: Phaser.Time.TimerEvent[] = [];
	lavaTimers: Phaser.Time.TimerEvent[] = [];

	constructor(scene: Scene, levels: LevelDefinition[] = LEVELS) {
		this.scene = scene;
		this.levels = levels;
		this.visuals = this.scene.add.group();
		this.hazards = this.scene.add.group();
		this.platforms = this.scene.physics.add.staticGroup();
	}

	get current(): LevelDefinition {
		return this.levels[this.currentIndex];
	}

	goto(index: number) {
		const clamped = Math.max(0, Math.min(index, this.levels.length - 1));
		this.currentIndex = clamped;
		this.renderCurrent();
	}

	next() {
		if (this.currentIndex < this.levels.length - 1) {
			this.currentIndex += 1;
			this.renderCurrent();
			return true;
		}
		return false;
	}

	restart() {
		this.currentIndex = 0;
		this.renderCurrent();
	}

	renderCurrent() {
		this.visuals.clear(true, true);
		this.hazards.clear(true, true);
		this.platforms.clear(true, true);
		this.platforms = this.scene.physics.add.staticGroup();

		// Clear fireballs and timers
		this.fireballs.forEach((fb) => {
			fb.destroy();
		});
		this.fireballs = [];
		this.fireballTimers.forEach((timer) => {
			timer.remove();
		});
		this.fireballTimers = [];
		this.lavaTimers.forEach((timer) => {
			timer.remove();
		});
		this.lavaTimers = [];

		const level = this.current;

		const title = this.scene.add
			.text(
				this.scene.cameras.main.width / 2,
				50,
				`Level ${this.currentIndex + 1}: ${level.name}`,
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '80px',
					color: '#ffffff',
					stroke: '#1b1b1c',
					strokeThickness: 4,
				},
			)
			.setOrigin(0.5, 0.5)
			.setDepth(10);

		this.visuals.add(title);

		// Add restart shortcut indicator in top right
		const restartHint = this.scene.add
			.text(this.scene.cameras.main.width - 20, 50, 'SHIFT + R to restart', {
				fontFamily: 'Pixelify Sans',
				fontSize: '40px',
				color: '#ffffff',
				stroke: '#1b1b1c',
				strokeThickness: 2,
			})
			.setOrigin(1, 0.5)
			.setDepth(10);

		this.visuals.add(restartHint);

		const titleBg = this.scene.add
			.rectangle(
				0,
				0,
				this.scene.cameras.main.width,
				title.getBounds().height + 20,
				0x000000,
				0.8,
			)
			.setOrigin(0, 0)
			.setDepth(9);

		this.visuals.add(titleBg);

		const groundY = this.scene.cameras.main.height - 40;
		const groundWidth = this.scene.cameras.main.width;
		const groundHeight = 80;

		// Tile ground sprites across the bottom
		const groundFrameWidth = 448;
		const numGroundTiles = Math.ceil(groundWidth / groundFrameWidth) + 1;

		for (let i = 0; i < numGroundTiles; i++) {
			const groundSprite = this.scene.add.sprite(
				i * groundFrameWidth,
				groundY,
				'ground',
				0,
			);
			groundSprite.setOrigin(0, 0);
			groundSprite.setDepth(5);
			this.visuals.add(groundSprite);
			this.platforms.add(groundSprite);

			const body = groundSprite.body as Phaser.Physics.Arcade.StaticBody;
			body.setSize(groundFrameWidth, groundHeight);
			body.setOffset(0, 0);
			body.updateFromGameObject();
		}

		// Create portal at goal position
		this.createPortal(level.goal.x, level.goal.y);

		// draw obstacles with improved styling
		level.obstacles.forEach((o) => {
			if (o.type === 'platform') {
				// Create physics-enabled platform using ground sprites (tiled)
				const platformFrameWidth = 448;
				const numPlatformTiles = Math.ceil(o.w / platformFrameWidth);

				// Create individual sprites for the platform
				for (let i = 0; i < numPlatformTiles; i++) {
					const tileX = o.x + i * platformFrameWidth;
					const platformSprite = this.scene.add.sprite(tileX, o.y, 'ground', 0);
					platformSprite.setOrigin(0, 0);
					platformSprite.setDisplaySize(
						Math.min(platformFrameWidth, o.w - i * platformFrameWidth),
						o.h,
					);
					platformSprite.setDepth(5);
					this.visuals.add(platformSprite);
					this.platforms.add(platformSprite);

					const body = platformSprite.body as Phaser.Physics.Arcade.StaticBody;
					body.setSize(
						Math.min(platformFrameWidth, o.w - i * platformFrameWidth),
						o.h,
					);
					body.setOffset(0, 0);
					body.updateFromGameObject();
				}
			} else if (o.type === 'spikes') {
				// Use spike sprites with proper sizing and spacing
				const spikeOriginalWidth = 402; // from Boot.ts frameWidth
				const spikeOriginalHeight = 129; // from Boot.ts frameHeight

				// Scale spikes to fit o.size height
				const scale = o.size / spikeOriginalHeight;
				const scaledWidth = spikeOriginalWidth * scale;

				for (let i = 0; i < o.count; i++) {
					// Space spikes using their actual scaled width to prevent overlap
					const sx = o.x + i * scaledWidth;
					const spike = this.scene.physics.add.sprite(sx, o.y, 'spikes', 0);
					spike.setOrigin(0, 1); // Bottom-left origin for proper positioning
					spike.setScale(scale);
					spike.setDepth(6);
					spike.setData('hazard', true);

					// Trim hitbox to visible spike tips (lower 70%, inner 80% of frame)
					const hitW = spikeOriginalWidth * 0.8;
					const hitH = spikeOriginalHeight * 0.7;
					const hitOffsetX = spikeOriginalWidth * 0.1;
					const hitOffsetY = spikeOriginalHeight * 0.3;
					const body = spike.body as Phaser.Physics.Arcade.Body;
					body.setSize(hitW, hitH);
					body.setOffset(hitOffsetX, hitOffsetY);
					body.setAllowGravity(false);
					body.setImmovable(true);

					this.visuals.add(spike);
					this.hazards.add(spike);
				}
			} else if (o.type === 'lava') {
				const lava = this.scene.add
					.tileSprite(o.x, o.y, o.w, o.h, 'lava', 0)
					.setOrigin(0)
					.setTileScale(3);
				lava.setDepth(6);
				lava.setData('hazard', true);

				this.scene.physics.add.existing(lava, true);
				const lavaBody = lava.body as Phaser.Physics.Arcade.StaticBody;
				lavaBody.setSize(o.w, o.h);
				lavaBody.updateFromGameObject();

				let frame = 0;
				const lavaTimer = this.scene.time.addEvent({
					delay: 125,
					callback: () => {
						if (!lava.active) return;
						frame = (frame + 1) % 4;
						lava.setFrame(frame);
					},
					loop: true,
				});
				this.lavaTimers.push(lavaTimer);

				this.visuals.add(lava);
				this.hazards.add(lava);
			} else if (o.type === 'movingEnemy') {
				const enemy = this.scene.physics.add.sprite(o.x, o.y, 'enemy', 0);
				enemy.setOrigin(0.5, 0.5);
				enemy.setScale(3);
				enemy.setDepth(8);
				enemy.setData('hazard', true);

				const body = enemy.body as Phaser.Physics.Arcade.Body;
				body.setSize(36, 58);
				body.setOffset(2, 1);
				body.setAllowGravity(false);
				body.setImmovable(true);

				this.visuals.add(enemy);
				this.hazards.add(enemy);

				// Create enemy animation if it doesn't exist
				if (!this.scene.anims.exists('enemy-move')) {
					this.scene.anims.create({
						key: 'enemy-move',
						frames: this.scene.anims.generateFrameNumbers('enemy', {
							start: 0,
							end: 5,
						}),
						frameRate: 10,
						repeat: -1,
					});
				}

				// Play enemy animation
				enemy.play('enemy-move');

				// simple horizontal patrol tween
				this.scene.tweens.add({
					targets: enemy,
					x: { from: o.x - o.range / 2, to: o.x + o.range / 2 },
					duration: Math.max(200, Math.floor((o.range / o.speed) * 1000)),
					ease: 'Sine.easeInOut',
					yoyo: true,
					repeat: -1,
					onYoyo: () => {
						enemy.setFlipX(!enemy.flipX); // Flip sprite direction
					},
					onRepeat: () => {
						enemy.setFlipX(!enemy.flipX); // Flip sprite direction
					},
				});
			} else if (o.type === 'fireball') {
				// Spawn fireballs at intervals
				const delay = o.delay || 0;
				const interval = o.interval || 2000;

				const spawnFireball = () => {
					const fireball = new Fireball(this.scene, o.x, o.y);
					this.fireballs.push(fireball);
					this.hazards.add(fireball.sprite);

					// Clean up destroyed fireballs
					this.fireballs = this.fireballs.filter((fb) => fb.sprite?.active);
				};

				// Initial spawn after delay
				this.scene.time.delayedCall(delay, spawnFireball);

				// Repeat spawning
				const timer = this.scene.time.addEvent({
					delay: interval,
					callback: spawnFireball,
					loop: true,
					startAt: delay,
				});

				this.fireballTimers.push(timer);
			}
		});
	}

	createPortal(x: number, y: number) {
		const portalScale = 3;

		this.portal = this.scene.add.container(x, y).setDepth(9);

		const glow = this.scene.add
			.image(0, 0, 'portal')
			.setOrigin(0.5, 1)
			.setScale(portalScale)
			.setTint(0xffdd00)
			.setAlpha(0.15)
			.setBlendMode(Phaser.BlendModes.ADD);

		const portalSprite = this.scene.physics.add.sprite(0, 0, 'portal');
		portalSprite.setScale(portalScale);
		portalSprite.setOrigin(0.5, 1);

		const body = portalSprite.body as Phaser.Physics.Arcade.Body;
		body.setSize(30, 44);
		body.setOffset(1, 0);
		body.setAllowGravity(false);
		body.setImmovable(true);

		this.portal.add(glow);
		this.portal.add(portalSprite);
		this.visuals.add(this.portal);

		this.scene.tweens.add({
			targets: glow,
			alpha: { from: 0.15, to: 0.4 },
			duration: 600,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut',
		});

		this.scene.tweens.add({
			targets: portalSprite,
			scale: { from: portalScale, to: 3.18 },
			duration: 600,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut',
		});
	}
}
