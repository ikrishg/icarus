import type { GameObjects, Scene } from 'phaser';
import { LEVELS } from '../data/levels';
import { isTouchDevice } from './TouchControls';
import { DEPTH_PLAY_HUD_BAR, DEPTH_PLAY_HUD_TEXT, WIDTH } from '../util/constants';
import { touchFontSizeStyle } from '../util/responsiveText';
import { touchChromeMetrics, type TouchChromeMetrics } from '../util/touchLayout';
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
	/** Physics body used for level completion (not the decorative glow). */
	portalTrigger: Phaser.Physics.Arcade.Sprite | null = null;
	fireballs: Fireball[] = [];
	fireballTimers: Phaser.Time.TimerEvent[] = [];
	lavaTimers: Phaser.Time.TimerEvent[] = [];
	levelStartedAt = 0;
	/** When true, Play resets levelStartedAt when death reset finishes. */
	deferLevelClockReset = false;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];

	getHudTitle(): Phaser.GameObjects.Text | undefined {
		const obj = this.hudObjects[0];
		return obj instanceof Phaser.GameObjects.Text ? obj : undefined;
	}

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

	setFireballTimersPaused(paused: boolean): void {
		for (const timer of this.fireballTimers) {
			timer.paused = paused;
		}
	}

	renderCurrent() {
		this.portalTrigger = null;
		try {
			this.visuals?.clear(true, true);
		} catch {
			this.visuals = this.scene.add.group();
		}
		try {
			this.hazards?.clear(true, true);
		} catch {
			this.hazards = this.scene.add.group();
		}
		if (!this.visuals?.active) {
			this.visuals = this.scene.add.group();
		}
		if (!this.hazards?.active) {
			this.hazards = this.scene.add.group();
		}
		try {
			this.platforms?.clear(true, true);
		} catch {
			// stale static group
		}
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
		const play = this.scene.scene.get('Play') as
			| { isResetting?: boolean }
			| undefined;
		if (play?.isResetting) {
			this.deferLevelClockReset = true;
		} else {
			this.levelStartedAt = this.scene.time.now;
			this.deferLevelClockReset = false;
		}

		const touch = isTouchDevice(this.scene);
		const chrome = touch ? touchChromeMetrics(this.scene) : null;
		const titleWrap = touch
			? WIDTH - chrome!.rightReserve - chrome!.margin * 2
			: this.scene.cameras.main.width - 80;
		const title = this.scene.add
			.text(
				this.scene.cameras.main.width / 2,
				50,
				`Level ${this.currentIndex + 1}: ${level.name}`,
				{
					fontFamily: 'Pixelify Sans',
					fontSize: touch ? touchFontSizeStyle(this.scene, 52) : '80px',
					color: '#ffffff',
					stroke: '#1b1b1c',
					strokeThickness: 4,
					align: 'center',
					wordWrap: touch ? { width: titleWrap } : undefined,
				},
			)
			.setOrigin(0.5, 0.5)
			.setDepth(DEPTH_PLAY_HUD_TEXT);

		this.visuals.add(title);
		this.hudObjects = [title];

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
			.setDepth(DEPTH_PLAY_HUD_BAR);

		this.visuals.add(titleBg);
		this.hudObjects.push(titleBg);

		if (!isTouchDevice(this.scene)) {
			const restartHint = this.scene.add
				.text(
					this.scene.cameras.main.width - 20,
					50,
					'Shift+R restart',
					{
						fontFamily: 'Pixelify Sans',
						fontSize: '40px',
						color: '#ffffff',
						stroke: '#0b1a2e',
						strokeThickness: 2,
					},
				)
				.setOrigin(1, 0.5)
				.setDepth(DEPTH_PLAY_HUD_TEXT);

			this.visuals.add(restartHint);
			this.hudObjects.push(restartHint);
		}

		const groundY = this.scene.cameras.main.height - 40;
		const groundWidth = this.scene.cameras.main.width;
		const groundHeight = 80;

		this.addTiledGroundVisual(0, groundY, groundWidth, groundHeight);
		this.addStaticPlatformCollider(0, groundY, groundWidth, groundHeight);

		// Create portal at goal position
		this.createPortal(level.goal.x, level.goal.y);

		// draw obstacles with improved styling
		level.obstacles.forEach((o) => {
			if (o.type === 'platform') {
				this.addTiledGroundVisual(o.x, o.y, o.w, o.h);
				this.addStaticPlatformCollider(o.x, o.y, o.w, o.h);
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

				const timer = this.scene.time.addEvent({
					delay: interval,
					callback: spawnFireball,
					loop: true,
					startAt: Math.max(0, interval - delay),
				});
				if (this.scene.time.paused) {
					timer.paused = true;
				}

				this.fireballTimers.push(timer);
			}
		});
	}

	private addTiledGroundVisual(
		x: number,
		y: number,
		width: number,
		height: number,
	) {
		const platformFrameWidth = 448;
		const numPlatformTiles = Math.ceil(width / platformFrameWidth);

		for (let i = 0; i < numPlatformTiles; i++) {
			const tileX = x + i * platformFrameWidth;
			const tileW = Math.min(platformFrameWidth, width - i * platformFrameWidth);
			const platformSprite = this.scene.add.sprite(tileX, y, 'ground', 0);
			platformSprite.setOrigin(0, 0);
			platformSprite.setDisplaySize(tileW, height);
			platformSprite.setDepth(5);
			this.visuals.add(platformSprite);
		}
	}

	private addStaticPlatformCollider(
		x: number,
		y: number,
		width: number,
		height: number,
	) {
		const collider = this.scene.add.rectangle(
			x + width / 2,
			y + height / 2,
			width,
			height,
			0x000000,
			0,
		);
		this.scene.physics.add.existing(collider, true);
		const body = collider.body as Phaser.Physics.Arcade.StaticBody;
		body.setSize(width, height);
		body.updateFromGameObject();
		this.platforms.add(collider);
		this.visuals.add(collider);
	}

	getWorldObstacleBounds(): Array<{
		left: number;
		right: number;
		top: number;
		bottom: number;
	}> {
		const rects: Array<{
			left: number;
			right: number;
			top: number;
			bottom: number;
		}> = [];
		for (const child of this.platforms.getChildren()) {
			const body = (child as Phaser.GameObjects.Rectangle).body as
				| Phaser.Physics.Arcade.StaticBody
				| undefined;
			if (!body) continue;
			rects.push({
				left: body.left,
				right: body.right,
				top: body.top,
				bottom: body.bottom,
			});
		}
		const portalBounds = this.getPortalBounds();
		if (portalBounds) {
			rects.push(portalBounds);
		}
		return rects;
	}

	getPortalBounds(): {
		left: number;
		right: number;
		top: number;
		bottom: number;
	} | null {
		if (!this.portal?.active || !('getBounds' in this.portal)) {
			return null;
		}
		const b = this.portal.getBounds();
		return {
			left: b.left,
			right: b.right,
			top: b.top,
			bottom: b.bottom,
		};
	}

	setHudVisible(visible: boolean): void {
		for (const obj of this.hudObjects) {
			if ('setVisible' in obj && typeof obj.setVisible === 'function') {
				obj.setVisible(visible);
			}
		}
	}

	relayoutTouchHudTitle(chrome: TouchChromeMetrics): void {
		if (!isTouchDevice(this.scene)) return;
		const title = this.hudObjects[0];
		if (
			!title ||
			!('active' in title) ||
			!(title as Phaser.GameObjects.GameObject).active ||
			!('setPosition' in title) ||
			!('setWordWrapWidth' in title)
		) {
			return;
		}
		const titleWrap = WIDTH - chrome.rightReserve - chrome.margin * 2;
		(
			title as Phaser.GameObjects.Text
		).setWordWrapWidth(titleWrap);
		(title as Phaser.GameObjects.Text).setPosition(WIDTH / 2, 50);
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
		portalSprite.setData('portalTrigger', true);

		const body = portalSprite.body as Phaser.Physics.Arcade.Body;
		body.setSize(30, 44);
		body.setOffset(1, 0);
		body.setAllowGravity(false);
		body.setImmovable(true);

		this.portalTrigger = portalSprite;

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
