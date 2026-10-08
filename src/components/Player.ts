import type { Scene } from 'phaser';
import type { AbilityManager } from './AbilityManager';
import { Arrow } from './Arrow';

export class Player {
	scene: Scene;
	sprite: Phaser.Physics.Arcade.Sprite;
	cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
	wasd:
		| {
				up: Phaser.Input.Keyboard.Key;
				left: Phaser.Input.Keyboard.Key;
				down: Phaser.Input.Keyboard.Key;
				right: Phaser.Input.Keyboard.Key;
		  }
		| undefined;
	qKey: Phaser.Input.Keyboard.Key | undefined;
	eKey: Phaser.Input.Keyboard.Key | undefined;
	spaceKey: Phaser.Input.Keyboard.Key | undefined;

	// Movement constants
	readonly JUMP_VELOCITY = -550;
	readonly DASH_SPEED = 1200;
	readonly DASH_DURATION = 400;

	jumpCount = 0;
	isDead = false;
	abilityManager: AbilityManager;
	arrows: Arrow[] = [];
	lastArrowTime = 0;
	readonly ARROW_COOLDOWN = 500; // ms between arrows
	isDashing = false;
	dashDirection = 0;
	lastDashTime = 0;
	readonly DASH_COOLDOWN = 1000; // ms between dashes
	controlsEnabled = true; // Can be disabled during ability choice screens

	constructor(
		scene: Scene,
		x: number,
		y: number,
		abilityManager: AbilityManager,
	) {
		this.scene = scene;
		this.abilityManager = abilityManager;

		this.sprite = this.scene.physics.add
			.sprite(x, y, 'icarus')
			.setScale(3)
			.setDepth(10);

		this.sprite.play('player-idle');

		// Set collision properties
		this.sprite.setBounce(0.1);
		this.sprite.setCollideWorldBounds(true);

		const body = this.sprite.body as Phaser.Physics.Arcade.Body;
		body.setSize(24, 44);
		body.setOffset(15, 12);

		// Setup keyboard controls
		this.cursors = this.scene.input.keyboard?.createCursorKeys();

		if (this.scene.input.keyboard) {
			this.wasd = {
				up: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
				left: this.scene.input.keyboard.addKey(
					Phaser.Input.Keyboard.KeyCodes.A,
				),
				down: this.scene.input.keyboard.addKey(
					Phaser.Input.Keyboard.KeyCodes.S,
				),
				right: this.scene.input.keyboard.addKey(
					Phaser.Input.Keyboard.KeyCodes.D,
				),
			};
			this.qKey = this.scene.input.keyboard.addKey(
				Phaser.Input.Keyboard.KeyCodes.Q,
			);
			this.eKey = this.scene.input.keyboard.addKey(
				Phaser.Input.Keyboard.KeyCodes.E,
			);
			this.spaceKey = this.scene.input.keyboard.addKey(
				Phaser.Input.Keyboard.KeyCodes.SPACE,
			);
		}
	}

	update() {
		if (!this.sprite.body || this.isDead || !this.controlsEnabled) return;

		const body = this.sprite.body as Phaser.Physics.Arcade.Body;

		// Reset jump count when touching ground
		if (body.touching.down) {
			this.jumpCount = 0;
			this.isDashing = false;
		}

		// Check for dash input BEFORE movement
		if (
			this.abilityManager.canDash() &&
			Phaser.Input.Keyboard.JustDown(this.qKey as Phaser.Input.Keyboard.Key)
		) {
			const now = Date.now();
			if (now - this.lastDashTime > this.DASH_COOLDOWN) {
				this.performDash();
				this.lastDashTime = now;
			}
		}

		// Handle dash
		const moveSpeed = this.abilityManager.getMoveSpeed();
		const canMoveLeft = this.abilityManager.abilities.canMoveLeft;

		if (this.isDashing) {
			this.sprite.setVelocityX(this.DASH_SPEED * this.dashDirection);
			this.updatePlayerAnimation(body, canMoveLeft);
			return; // Skip normal movement during dash
		}

		// Horizontal movement
		if ((this.cursors?.left.isDown || this.wasd?.left.isDown) && canMoveLeft) {
			this.sprite.setVelocityX(-moveSpeed);
			this.sprite.setFlipX(true); // Flip sprite to face left
		} else if (this.cursors?.right.isDown || this.wasd?.right.isDown) {
			this.sprite.setVelocityX(moveSpeed);
			this.sprite.setFlipX(false); // Face right
		} else {
			this.sprite.setVelocityX(0);
		}

		// Jumping (with ability-based max jumps)
		const maxJumps = this.abilityManager.getMaxJumps();
		if (
			Phaser.Input.Keyboard.JustDown(
				this.cursors?.up as Phaser.Input.Keyboard.Key,
			) ||
			Phaser.Input.Keyboard.JustDown(
				this.wasd?.up as Phaser.Input.Keyboard.Key,
			) ||
			Phaser.Input.Keyboard.JustDown(
				this.cursors?.space as Phaser.Input.Keyboard.Key,
			)
		) {
			if (this.jumpCount < maxJumps) {
				this.sprite.setVelocityY(this.JUMP_VELOCITY);
				this.jumpCount++;
			}
		}

		// Shoot arrow (E key)
		if (
			this.abilityManager.abilities.canShootArrows &&
			Phaser.Input.Keyboard.JustDown(this.eKey as Phaser.Input.Keyboard.Key)
		) {
			const now = Date.now();
			if (now - this.lastArrowTime > this.ARROW_COOLDOWN) {
				this.shootArrow();
				this.lastArrowTime = now;
			}
		}

		this.updatePlayerAnimation(body, canMoveLeft);

		// Slight rotation based on vertical velocity for better feel
		const rotation = Phaser.Math.Clamp(body.velocity.y * 0.0003, -0.2, 0.2);
		this.sprite.setRotation(rotation);
	}

	private updatePlayerAnimation(
		body: Phaser.Physics.Arcade.Body,
		canMoveLeft: boolean,
	) {
		const movingHorizontally =
			this.cursors?.right.isDown ||
			this.wasd?.right.isDown ||
			((this.cursors?.left.isDown || this.wasd?.left.isDown) && canMoveLeft);

		if (!body.touching.down) {
			this.sprite.anims.play('player-flap', true);
		} else if (movingHorizontally) {
			this.sprite.anims.play('player-run', true);
		} else {
			this.sprite.anims.play('player-idle', true);
		}
	}

	performDash() {
		// Play shoot sound for dash
		this.scene.sound.play('shoot', { volume: 0.4 });

		this.isDashing = true;
		// Dash in the direction player is facing
		this.dashDirection = this.sprite.flipX ? -1 : 1;

		// End dash after duration
		this.scene.time.delayedCall(this.DASH_DURATION, () => {
			this.isDashing = false;
		});
	}

	shootArrow() {
		// Play shoot sound
		this.scene.sound.play('shoot', { volume: 0.4 });

		const direction = this.sprite.flipX ? -1 : 1;
		const offsetX = direction * 60; // Spawn arrow in front of player
		const arrow = new Arrow(
			this.scene,
			this.sprite.x + offsetX,
			this.sprite.y,
			direction,
		);
		this.arrows.push(arrow);

		// Clean up destroyed arrows
		this.arrows = this.arrows.filter((a) => a.sprite?.active);
	}

	die() {
		if (this.isDead) return;

		this.isDead = true;
		this.sprite.setTint(0xff0000); // Red tint on death
		this.sprite.setVelocity(0, -300); // Pop up slightly
		this.sprite.setAngularVelocity(500); // Spin

		// Stop animation
		this.sprite.stop();
	}

	revive(x: number, y: number) {
		this.isDead = false;
		this.sprite.clearTint();
		this.sprite.setRotation(0);
		this.sprite.setAngularVelocity(0);
		this.sprite.play('player-idle');
		this.setPosition(x, y);
	}

	setPosition(x: number, y: number) {
		this.sprite.setPosition(x, y);
		this.sprite.setVelocity(0, 0);
		this.jumpCount = 0;
	}

	destroy() {
		this.sprite.destroy();
	}
}
