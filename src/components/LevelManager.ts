import type { GameObjects, Scene } from 'phaser';
import { LEVELS } from '../data/levels';
import type { LevelDefinition, ObstacleDef, Point } from '../util/types';

export type { Point, ObstacleDef, LevelDefinition };

export class LevelManager {
	scene: Scene;
	levels: LevelDefinition[];
	currentIndex: number = 0;

	visuals: GameObjects.Group;
	platforms: Phaser.Physics.Arcade.StaticGroup;
	hazards: GameObjects.Group;
	portal: Phaser.GameObjects.Container;

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

					// Set up physics body to match full sprite size
					// Use original dimensions - Phaser applies scale automatically
					const body = spike.body as Phaser.Physics.Arcade.Body;
					body.setSize(spikeOriginalWidth, spikeOriginalHeight);
					body.setOffset(0, 0);
					body.setAllowGravity(false);
					body.setImmovable(true);

					this.visuals.add(spike);
					this.hazards.add(spike);
				}
			} else if (o.type === 'lava') {
				// Create lava animation if it doesn't exist
				if (!this.scene.anims.exists('lava-bubble')) {
					this.scene.anims.create({
						key: 'lava-bubble',
						frames: this.scene.anims.generateFrameNumbers('lava', {
							start: 0,
							end: 7,
						}),
						frameRate: 8,
						repeat: -1,
					});
				}

				// Use a single lava sprite stretched to fit the entire area
				const lavaOriginalWidth = 832; // from Boot.ts frameWidth
				const lavaOriginalHeight = 192; // from Boot.ts frameHeight

				const lava = this.scene.physics.add.sprite(o.x, o.y, 'lava', 0);
				lava.setOrigin(0, 0);
				lava.setDisplaySize(o.w, o.h);
				lava.setDepth(3); // Below platforms
				lava.setData('hazard', true);

				// Set up physics body using original dimensions
				// Phaser will automatically scale the body to match setDisplaySize
				const body = lava.body as Phaser.Physics.Arcade.Body;
				body.setSize(lavaOriginalWidth, lavaOriginalHeight);
				body.setOffset(0, 0);
				body.setAllowGravity(false);
				body.setImmovable(true);

				this.visuals.add(lava);
				this.hazards.add(lava);

				// Play lava animation
				lava.play('lava-bubble');
			} else if (o.type === 'movingEnemy') {
				// Use enemy sprite with physics
				const enemyOriginalWidth = 336; // from Boot.ts frameWidth
				const enemyOriginalHeight = 498; // from Boot.ts frameHeight

				const enemy = this.scene.physics.add.sprite(o.x, o.y, 'enemy', 0);
				enemy.setOrigin(0.5, 0.5);
				enemy.setDisplaySize(o.w, o.h);
				enemy.setDepth(8);
				enemy.setData('hazard', true);

				// Set up physics body using original dimensions
				const body = enemy.body as Phaser.Physics.Arcade.Body;
				body.setSize(enemyOriginalWidth, enemyOriginalHeight);
				body.setOffset(0, 0);
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
							end: 7,
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
			}
		});
	}

	createPortal(x: number, y: number) {
		// Create portal animation if it doesn't exist
		if (!this.scene.anims.exists('portal-spin')) {
			this.scene.anims.create({
				key: 'portal-spin',
				frames: this.scene.anims.generateFrameNumbers('portal', {
					start: 0,
					end: 7,
				}),
				frameRate: 12,
				repeat: -1,
			});
		}

		// Portal should be 80% of player height
		// Player visual height: 276px * 0.6 scale = 165.6px
		// Portal target height: 165.6px * 0.8 = 132.5px
		// Portal sprite original: 192x256
		const portalScale = (276 * 0.6 * 0.8) / 256; // ~0.517

		// Create portal sprite with physics - positioned to rest on platform
		const portalSprite = this.scene.physics.add.sprite(x, y, 'portal', 0);
		portalSprite.setScale(portalScale);
		portalSprite.setOrigin(0.5, 1); // Bottom-center origin
		portalSprite.setDepth(9);
		portalSprite.play('portal-spin');

		// Set up physics body to match full scaled sprite size
		// The body size should match the original sprite dimensions before scaling
		// Phaser will automatically apply the scale to the body
		const body = portalSprite.body as Phaser.Physics.Arcade.Body;
		body.setSize(192, 256); // Use original sprite dimensions
		// With origin (0.5, 1) and no offset, body is already centered and at bottom
		body.setOffset(0, 0);
		body.setAllowGravity(false);
		body.setImmovable(true);

		// Wrap in container for compatibility with existing code
		this.portal = this.scene.add.container(x, y).setDepth(9);
		// Adjust sprite position since container is already at x,y
		portalSprite.setPosition(x - x, y - y); // Reset to 0,0 relative
		this.portal.add(portalSprite);
		this.visuals.add(this.portal);
	}
}
