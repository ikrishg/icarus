import type { Scene } from 'phaser';
import type { AbilityManager } from './AbilityManager';
import { Arrow } from './Arrow';
import type { TouchControls } from './TouchControls';
import { WIDTH } from '../util/constants';

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
	private dashStartedInAir = false;
	private prevBodyCenterX: number | null = null;
	dashDirection = 0;
	lastDashTime = 0;
	readonly DASH_COOLDOWN = 1000; // ms between dashes
	controlsEnabled = true; // Can be disabled during ability choice screens
	touchControls: TouchControls | null = null;
	private keyboardDashQueued = false;

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
		body.setCollideWorldBounds(true);

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
			this.wasd.right.on('down', () => {
				this.sprite.setFlipX(false);
				if (this.qKey?.isDown) {
					this.keyboardDashQueued = true;
				}
			});
			this.wasd.left.on('down', () => {
				if (this.abilityManager.abilities.canMoveLeft) {
					this.sprite.setFlipX(true);
					if (this.qKey?.isDown) {
						this.keyboardDashQueued = true;
					}
				}
			});
			this.qKey.on('down', () => {
				this.keyboardDashQueued = true;
			});
		}
	}

	update() {
		if (!this.sprite.body || this.isDead || !this.controlsEnabled) return;

		this.touchControls?.beginFrame();
		const touch = this.touchControls?.getInput();

		const body = this.sprite.body as Phaser.Physics.Arcade.Body;

		// Reset jump count when touching ground
		if (body.touching.down) {
			this.jumpCount = 0;
			if (this.isDashing && this.dashStartedInAir) {
				this.isDashing = false;
			}
		}

		const moveSpeed = this.abilityManager.getMoveSpeed();
		const canMoveLeft = this.abilityManager.abilities.canMoveLeft;

		const leftDown =
			this.cursors?.left.isDown || this.wasd?.left.isDown || touch?.left;
		const rightDown =
			this.cursors?.right.isDown || this.wasd?.right.isDown || touch?.right;

		// Dash before movement; keyboard queue handles Q/D same-frame presses
		if (this.abilityManager.canDash()) {
			const dashPressed = this.keyboardDashQueued || touch?.dashJustDown;
			this.keyboardDashQueued = false;
			if (dashPressed) {
				const now = Date.now();
				if (now - this.lastDashTime > this.DASH_COOLDOWN) {
					if (rightDown) {
						this.sprite.setFlipX(false);
					} else if (leftDown && canMoveLeft) {
						this.sprite.setFlipX(true);
					}
					this.performDash();
					this.lastDashTime = now;
				}
			}
		}

		const minCenter = body.halfWidth;
		const maxCenter = WIDTH - body.halfWidth;

		if (this.isDashing) {
			this.sprite.setVelocityX(this.DASH_SPEED * this.dashDirection);
			this.updatePlayerAnimation(body, canMoveLeft);
			return; // Skip normal movement during dash
		}

		// Horizontal movement (do not set velocity into a wall; poststep fixes true overshoot)
		if (
			leftDown &&
			canMoveLeft &&
			body.center.x > minCenter &&
			!body.blocked.left
		) {
			this.sprite.setVelocityX(-moveSpeed);
			this.sprite.setFlipX(true);
		} else if (rightDown && body.center.x < maxCenter && !body.blocked.right) {
			this.sprite.setVelocityX(moveSpeed);
			this.sprite.setFlipX(false);
		} else {
			this.sprite.setVelocityX(0);
		}
		if (leftDown && body.blocked.left) {
			body.velocity.x = 0;
		}
		if (rightDown && body.blocked.right) {
			body.velocity.x = 0;
		}
		if (body.center.x <= minCenter && body.velocity.x < 0) {
			body.velocity.x = 0;
		}
		if (body.center.x >= maxCenter && body.velocity.x > 0) {
			body.velocity.x = 0;
		}

		// Jumping (with ability-based max jumps)
		const maxJumps = this.abilityManager.getMaxJumps();
		const jumpPressed =
			Phaser.Input.Keyboard.JustDown(
				this.cursors?.up as Phaser.Input.Keyboard.Key,
			) ||
			Phaser.Input.Keyboard.JustDown(
				this.wasd?.up as Phaser.Input.Keyboard.Key,
			) ||
			Phaser.Input.Keyboard.JustDown(
				this.cursors?.space as Phaser.Input.Keyboard.Key,
			) ||
			touch?.jumpJustDown;
		if (jumpPressed) {
			if (this.jumpCount < maxJumps) {
				this.sprite.setVelocityY(this.JUMP_VELOCITY);
				this.jumpCount++;
			}
		}

		// Shoot arrow (E key)
		const shootPressed =
			Phaser.Input.Keyboard.JustDown(this.eKey as Phaser.Input.Keyboard.Key) ||
			touch?.shootJustDown;
		if (this.abilityManager.abilities.canShootArrows && shootPressed) {
			const now = Date.now();
			if (now - this.lastArrowTime > this.ARROW_COOLDOWN) {
				this.shootArrow();
				this.lastArrowTime = now;
			}
		}

		this.updatePlayerAnimation(body, canMoveLeft);
		this.clampBesidePlatforms(body);

		// Slight rotation based on vertical velocity for better feel
		const rotation = Phaser.Math.Clamp(body.velocity.y * 0.0003, -0.2, 0.2);
		this.sprite.setRotation(rotation);
	}

	clampBesidePlatforms(body: Phaser.Physics.Arcade.Body): void {
		const lm = (this.scene as { levelManager?: { platforms: Phaser.Physics.Arcade.StaticGroup } })
			.levelManager;
		if (!lm) return;
		for (const child of lm.platforms.getChildren()) {
			const plat = (child as Phaser.GameObjects.GameObject).body as
				| Phaser.Physics.Arcade.StaticBody
				| undefined;
			if (!plat || plat.width >= 1800) continue;
			const platMinCenter = plat.left + body.halfWidth;
			const inPlatY =
				body.center.y >= plat.top - 12 && body.center.y <= plat.bottom + 12;
			if (!inPlatY || body.center.x > plat.right + body.halfWidth + 8) {
				continue;
			}
			if (body.center.x < platMinCenter) {
				this.sprite.x += platMinCenter - body.center.x;
				body.updateFromGameObject();
				body.velocity.x = 0;
			} else if (body.center.x <= platMinCenter + 4 && body.velocity.x < 0) {
				body.velocity.x = 0;
			}
		}
	}

	/** Post-step only: correct when the body center is past the world edge (dash / knockback). */
	clampHorizontalWorldBounds(body: Phaser.Physics.Arcade.Body): void {
		const minCenter = body.halfWidth;
		const maxCenter = WIDTH - body.halfWidth;
		const centerX = body.center.x;
		if (
			this.prevBodyCenterX != null &&
			body.blocked.left &&
			centerX < this.prevBodyCenterX &&
			centerX > minCenter + 8
		) {
			this.sprite.x += this.prevBodyCenterX - centerX;
			body.updateFromGameObject();
			body.velocity.x = 0;
		}
		this.prevBodyCenterX = body.center.x;
		if (centerX < minCenter) {
			if (body.velocity.x < 0) {
				body.velocity.x = 0;
			}
			this.sprite.x += minCenter - centerX;
			body.updateFromGameObject();
			return;
		}
		if (
			body.touching.down &&
			centerX > minCenter &&
			centerX <= minCenter + 3
		) {
			if (body.velocity.x < 0) {
				body.velocity.x = 0;
			}
			this.sprite.x += minCenter - centerX;
			body.updateFromGameObject();
			return;
		}
		if (centerX > maxCenter) {
			if (body.velocity.x > 0) {
				body.velocity.x = 0;
			}
			this.sprite.x += maxCenter - centerX;
			body.updateFromGameObject();
			return;
		}
		if (
			body.touching.down &&
			centerX < maxCenter &&
			centerX >= maxCenter - 3
		) {
			if (body.velocity.x > 0) {
				body.velocity.x = 0;
			}
			this.sprite.x += maxCenter - centerX;
			body.updateFromGameObject();
		}
	}

	private updatePlayerAnimation(
		body: Phaser.Physics.Arcade.Body,
		canMoveLeft: boolean,
	) {
		const touch = this.touchControls?.getInput();
		const movingHorizontally =
			this.cursors?.right.isDown ||
			this.wasd?.right.isDown ||
			touch?.right ||
			((this.cursors?.left.isDown || this.wasd?.left.isDown || touch?.left) &&
				canMoveLeft);

		if (!body.touching.down) {
			this.sprite.anims.play('player-flap', true);
		} else if (movingHorizontally) {
			this.sprite.anims.play('player-run', true);
		} else {
			this.sprite.anims.play('player-idle', true);
		}
	}

	private dashDirectionFromInput(): number {
		const touch = this.touchControls?.getInput();
		const canMoveLeft = this.abilityManager.abilities.canMoveLeft;
		const rightDown =
			this.cursors?.right.isDown ||
			this.wasd?.right.isDown ||
			Boolean(touch?.right);
		const leftDown =
			this.cursors?.left.isDown ||
			this.wasd?.left.isDown ||
			Boolean(touch?.left);
		if (rightDown) {
			this.sprite.setFlipX(false);
			return 1;
		}
		if (leftDown && canMoveLeft) {
			this.sprite.setFlipX(true);
			return -1;
		}
		return this.sprite.flipX ? -1 : 1;
	}

	performDash() {
		// Play shoot sound for dash
		this.scene.sound.play('shoot', { volume: 0.4 });

		const body = this.sprite.body as Phaser.Physics.Arcade.Body;
		this.dashStartedInAir = !body.touching.down;
		this.isDashing = true;
		this.dashDirection = this.dashDirectionFromInput();

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
		this.prevBodyCenterX = null;
	}

	destroy() {
		this.sprite.destroy();
	}
}
