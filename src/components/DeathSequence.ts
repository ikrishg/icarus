import type { Scene } from 'phaser';
import type { Player } from './Player';
import { PALETTE, PALETTE_HEX } from '../util/palette';
import { sanitizePixelFont } from '../util/text';

export type DeathCause = 'fall' | 'fire' | 'spikes' | 'enemy';

const CAUSE_LINES: Record<DeathCause, string> = {
	fall: 'The wax gave way.',
	fire: 'The fire took you.',
	spikes: 'Spikes.',
	enemy: 'The fire took you.',
};

const JUMP_KEY_CODES = new Set(['Space', 'ArrowUp', 'KeyW']);

export type DeathSequenceOptions = {
	fast: boolean;
	onRebuild: () => void;
	onComplete: () => void;
};

export class DeathSequence {
	private scene: Scene;
	private player: Player;
	private overlay?: Phaser.GameObjects.Rectangle;
	private causeText?: Phaser.GameObjects.Text;
	private splash?: Phaser.GameObjects.Image;
	private particles?: Phaser.GameObjects.Particles.ParticleEmitter;
	private jumpBuffer = false;
	private escBlocked = false;
	private jumpKeyHandler?: (event: KeyboardEvent) => void;
	private active = false;

	constructor(scene: Scene, player: Player) {
		this.scene = scene;
		this.player = player;
	}

	run(cause: DeathCause, options: DeathSequenceOptions): void {
		const { fast, onComplete } = options;
		const totalMs = fast ? 700 : 1600;
		const sprite = this.player.sprite;
		const body = sprite.body as Phaser.Physics.Arcade.Body;

		this.active = true;
		this.escBlocked = true;
		this.jumpBuffer = false;

		body.enable = false;
		const startedOnGround = body.touching.down;
		this.player.isDead = true;
		sprite.clearTint();
		sprite.stop();
		sprite.setTexture('icarus', 0);
		sprite.setRotation(0);
		sprite.setAngularVelocity(0);

		this.scene.physics.pause();
		this.scene.time.delayedCall(fast ? 60 : 90, () => {
			this.scene.physics.resume();
		});

		this.scene.time.delayedCall(30, () => {
			sprite.setTintFill(PALETTE.cloudWhite);
		});
		this.scene.time.delayedCall(90, () => {
			sprite.clearTint();
		});

		this.scene.cameras.main.shake(fast ? 80 : 120, fast ? 0.004 : 0.006);

		const battleKeys = ['battle-beats', 'battle-climax'] as const;
		for (const key of battleKeys) {
			const s = this.scene.sound.get(key);
			if (s?.isPlaying) {
				this.scene.tweens.add({
					targets: s,
					volume: 0.12,
					duration: 200,
				});
			}
		}

		if (!fast) {
			this.scene.time.delayedCall(90, () => {
				if (this.scene.anims.exists('icarus-melt')) {
					sprite.play('icarus-melt');
				}
				this.spawnParticles();
			});
			this.scene.time.delayedCall(510, () => {
				if (this.scene.anims.exists('icarus-fall')) {
					sprite.play('icarus-fall');
				}
				if (!startedOnGround) {
					const fallStartY = sprite.y;
					this.scene.tweens.add({
						targets: sprite,
						y: fallStartY + 115,
						duration: 390,
						ease: 'Sine.easeIn',
					});
				}
				this.scene.tweens.add({
					targets: sprite,
					angle: 20,
					duration: 390,
					ease: 'Sine.easeOut',
				});
			});
		} else {
			this.scene.time.delayedCall(90, () => {
				if (this.scene.anims.exists('icarus-fall')) {
					sprite.play('icarus-fall');
				}
				sprite.setVelocity(0, -120);
				body.enable = true;
			});
		}

		const fadeStart = fast ? 300 : 900;
		const fadeDuration = fast ? 150 : 300;
		this.scene.time.delayedCall(fadeStart, () => {
			this.overlay = this.scene.add
				.rectangle(
					0,
					0,
					this.scene.cameras.main.width,
					this.scene.cameras.main.height,
					PALETTE.deep,
					1,
				)
				.setOrigin(0, 0)
				.setDepth(200)
				.setAlpha(0);
			this.scene.tweens.add({
				targets: this.overlay,
				alpha: 1,
				duration: fadeDuration,
			});

			if (!fast) {
				this.causeText = this.scene.add
					.text(
						this.scene.cameras.main.width / 2,
						this.scene.cameras.main.height / 2,
						sanitizePixelFont(CAUSE_LINES[cause]),
						{
							fontFamily: 'Pixelify Sans',
							fontSize: '56px',
							color: PALETTE_HEX.cloudWhite,
							stroke: PALETTE_HEX.deep,
							strokeThickness: 4,
						},
					)
					.setOrigin(0.5)
					.setDepth(201)
					.setAlpha(0);
				this.scene.tweens.add({
					targets: this.causeText,
					alpha: 1,
					duration: 200,
				});

				if (this.scene.textures.exists('sea-splash')) {
					this.splash = this.scene.add
						.image(
							this.scene.cameras.main.width / 2,
							this.scene.cameras.main.height / 2 - 80,
							'sea-splash',
						)
						.setScale(3)
						.setDepth(201)
						.setAlpha(0.85);
				}
			}
		});

		const rebuildAt = fast ? 450 : 1200;
		this.scene.time.delayedCall(rebuildAt, () => {
			body.enable = false;
			sprite.setVelocity(0, 0);
			sprite.setAngle(0);
			options.onRebuild();
			this.player.isDead = true;
			this.player.controlsEnabled = false;
		});

		const fadeInAt = fast ? 450 : 1350;
		this.scene.time.delayedCall(fadeInAt, () => {
			if (this.overlay) {
				this.scene.tweens.add({
					targets: this.overlay,
					alpha: 0,
					duration: fast ? 250 : 250,
					onComplete: () => {
						this.overlay?.destroy();
						this.overlay = undefined;
					},
				});
			}
			this.causeText?.destroy();
			this.splash?.destroy();
			this.particles?.destroy();
		});

		this.scene.time.delayedCall(fadeInAt, () => {
			if (this.scene.anims.exists('icarus-rise')) {
				sprite.play('icarus-rise');
			}
			this.jumpKeyHandler = (event: KeyboardEvent) => {
				if (JUMP_KEY_CODES.has(event.code)) {
					this.jumpBuffer = true;
				}
			};
			this.scene.input.keyboard?.on('keydown', this.jumpKeyHandler);
		});

		this.scene.time.delayedCall(totalMs, () => {
			this.clearJumpListener();
			this.escBlocked = false;
			this.active = false;
			sprite.clearTint();
			sprite.play('player-idle');
			sprite.setRotation(0);
			body.enable = true;
			body.setAllowGravity(true);
			this.player.isDead = false;
			this.player.controlsEnabled = true;
			for (const key of battleKeys) {
				const s = this.scene.sound.get(key);
				if (s) {
					this.scene.tweens.add({ targets: s, volume: 0.4, duration: 150 });
				}
			}
			onComplete();
		});
	}

	consumeJumpBuffer(): boolean {
		if (!this.jumpBuffer) return false;
		this.jumpBuffer = false;
		return true;
	}

	isEscBlocked(): boolean {
		return this.active && this.escBlocked;
	}

	private clearJumpListener(): void {
		if (this.jumpKeyHandler) {
			this.scene.input.keyboard?.off('keydown', this.jumpKeyHandler);
			this.jumpKeyHandler = undefined;
		}
	}

	private spawnParticles(): void {
		if (!this.scene.textures.exists('death-fx')) return;
		try {
			this.particles = this.scene.add.particles(
				this.player.sprite.x,
				this.player.sprite.y - 20,
				'death-fx',
				{
					speed: { min: 40, max: 120 },
					angle: { min: 200, max: 340 },
					lifespan: 900,
					quantity: 8,
					scale: { start: 1, end: 0 },
					gravityY: -30,
				},
			);
			this.particles.setDepth(11);
		} catch {
			// particles optional
		}
	}
}
