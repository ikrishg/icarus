import { Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { LevelManager } from '../components/LevelManager';
import { Player } from '../components/Player';

export class Play extends Scene {
	backgroundManager: BackgroundManager;
	levelManager: LevelManager;
	player: Player;
	isResetting = false;
	winText: Phaser.GameObjects.Text;
	winBackground: Phaser.GameObjects.Rectangle;

	constructor() {
		super('Play');
	}

	create() {
		this.backgroundManager = new BackgroundManager(this, { icarus: false });

		this.levelManager = new LevelManager(this);
		this.levelManager.goto(0);

		this.player = new Player(
			this,
			this.levelManager.current.start.x,
			this.levelManager.current.start.y,
		);

		this.setupCollisions();
		this.showLevelInstruction();

		this.input.keyboard?.on('keydown-ESC', () => {
			this.scene.switch('Menu');
		});
	}

	update() {
		this.player.update();

		if (this.player && this.player.sprite.y > this.cameras.main.height + 100) {
			this.killPlayer();
		}
	}

	killPlayer() {
		if (!this.player || this.player.isDead || this.isResetting) return;

		this.player.die();
		this.isResetting = true;

		this.cameras.main.flash(300, 255, 0, 0);

		this.time.delayedCall(1500, () => {
			this.levelManager.goto(0);
			this.resetPlayer();
			this.showLevelInstruction();
			this.isResetting = false;

			const resetMsg = this.add
				.text(
					this.cameras.main.width / 2,
					this.cameras.main.height / 4,
					"💀 Icarus has fallen once again! 💀\nBut it's a game so you respawn! from level one though...",
					{
						fontFamily: 'Pixelify Sans',
						fontSize: '80px',
						color: '#ff4444',
						stroke: '#000000',
						strokeThickness: 12,
						align: 'center',
						wordWrap: {
							useAdvancedWrap: true,
							width: this.cameras.main.width - 100,
						},
					},
				)
				.setOrigin(0.5)
				.setDepth(15);

			this.tweens.add({
				targets: resetMsg,
				alpha: 0,
				duration: 3000,
				delay: 1000,
				onComplete: () => resetMsg.destroy(),
			});
		});
	}

	completeLevel() {
		if (this.isResetting) return;
		this.isResetting = true;

		// Flash the portal
		if (this.levelManager.portal) {
			this.tweens.add({
				targets: this.levelManager.portal,
				alpha: 0,
				scale: 2,
				duration: 300,
				ease: 'Power2',
			});
		}

		// Wait a moment then advance to next level
		this.time.delayedCall(500, () => {
			const hasNext = this.levelManager.next();

			if (!hasNext) {
				// Player beat all levels!
				this.showWinScreen();
			} else {
				this.resetPlayer();
				this.showLevelInstruction();
				this.isResetting = false;
			}
		});
	}

	showWinScreen() {
		// Create win screen
		this.winBackground = this.add
			.rectangle(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2,
				this.cameras.main.width,
				this.cameras.main.height,
				0x000000,
				0.9,
			)
			.setDepth(20);

		this.winText = this.add
			.text(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2,
				[
					'🎉 CONGRATULATIONS! 🎉',
					'',
					`You completed all 15 levels!`,
					'',
					'Press SPACE to play again',
					'Press ESC to return to menu',
				],
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '32px',
					color: '#ffdd00',
					stroke: '#000000',
					strokeThickness: 4,
					align: 'center',
					lineSpacing: 10,
				},
			)
			.setOrigin(0.5)
			.setDepth(21);

		// Add pulsing animation
		this.tweens.add({
			targets: this.winText,
			scale: { from: 0.95, to: 1.05 },
			duration: 1500,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut',
		});

		// Handle input
		const spaceKey = this.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.SPACE,
		);
		const escKey = this.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.ESC,
		);

		if (spaceKey) {
			spaceKey.once('down', () => {
				this.scene.restart();
			});
		}

		if (escKey) {
			escKey.once('down', () => {
				this.scene.start('Menu');
			});
		}
	}

	setupCollisions() {
		if (!this.player) return;

		// Enable collision with platforms
		this.physics.add.collider(this.player.sprite, this.levelManager.platforms);

		// Set up overlap detection for hazards (spikes, lava, lasers, enemies)
		const hazards =
			this.levelManager.hazards.getChildren() as Phaser.GameObjects.GameObject[];
		hazards.forEach((hazard) => {
			// Check if hazard has a physics body
			const physicsObj = hazard as
				| Phaser.Physics.Arcade.Sprite
				| Phaser.GameObjects.Rectangle;
			if (physicsObj) {
				this.physics.add.overlap(
					this.player.sprite,
					physicsObj,
					() => {
						if (!this.player.isDead && !this.isResetting) {
							this.killPlayer();
						}
					},
					undefined,
					this,
				);
			}
		});

		// Set up overlap detection for portal
		if (this.levelManager.portal) {
			// Get the portal sprite from the container
			const portalChildren =
				this.levelManager.portal.getAll() as Phaser.Physics.Arcade.Sprite[];
			const portalSprite = portalChildren.find(
				(child) => child.texture?.key === 'portal',
			);

			if (portalSprite) {
				this.physics.add.overlap(
					this.player.sprite,
					portalSprite,
					() => {
						if (!this.player.isDead && !this.isResetting) {
							this.completeLevel();
						}
					},
					undefined,
					this,
				);
			}
		}
	}

	resetPlayer() {
		if (!this.player) return;
		const startPos = this.levelManager.current.start;
		this.player.revive(startPos.x, startPos.y);
		this.setupCollisions();
	}

	showLevelInstruction() {
		const lvl = this.levelManager.current;
		const instruction = lvl.instruction ?? 'Reach the portal to complete!';

		const instructionMsg = this.add
			.text(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2 - 50,
				instruction,
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '64px',
					color: '#ffffff',
					stroke: '#1b1b1c',
					strokeThickness: 12,
					align: 'center',
					lineSpacing: 8,
				},
			)
			.setOrigin(0.5)
			.setDepth(15);

		// Fade out instruction message
		this.tweens.add({
			targets: instructionMsg,
			alpha: 0,
			duration: 1500,
			delay: 2000,
			onComplete: () => instructionMsg.destroy(),
		});
	}
}
