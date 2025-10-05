import { Scene } from 'phaser';
import { AbilityManager } from '../components/AbilityManager';
import { BackgroundManager } from '../components/Background';
import { LevelManager } from '../components/LevelManager';
import { Player } from '../components/Player';
import type { PlayerAbilities } from '../util/types';

export class Play extends Scene {
	backgroundManager: BackgroundManager;
	levelManager: LevelManager;
	player: Player;
	abilityManager: AbilityManager;
	isResetting = false;
	visionOverlay: Phaser.GameObjects.Rectangle;

	constructor() {
		super('Play');
	}

	create() {
		this.backgroundManager = new BackgroundManager(this, { icarus: false });

		this.abilityManager = new AbilityManager();

		this.levelManager = new LevelManager(this);
		this.levelManager.goto(0);

		this.player = new Player(
			this,
			this.levelManager.current.start.x,
			this.levelManager.current.start.y,
			this.abilityManager,
		);

		// Create vision overlay
		this.visionOverlay = this.add
			.rectangle(
				0,
				0,
				this.cameras.main.width,
				this.cameras.main.height,
				0x000000,
			)
			.setOrigin(0, 0)
			.setDepth(100)
			.setAlpha(this.abilityManager.getVisionAlpha());

		this.setupCollisions();
		this.showLevelInstruction();

		this.input.keyboard?.on('keydown-ESC', () => {
			this.scene.switch('Menu');
		});

		// Add skip level key (semicolon)
		this.input.keyboard?.on('keydown-SEMICOLON', () => {
			if (!this.isResetting) {
				this.completeLevel();
			}
		});

		// Add restart key (SHIFT+R)
		this.input.keyboard?.on('keydown-R', (event: KeyboardEvent) => {
			if (event.shiftKey && !this.isResetting) {
				this.isResetting = true;
				this.abilityManager.reset();
				this.levelManager.goto(0);
				this.resetPlayer();
				this.showLevelInstruction();
				this.isResetting = false;
			}
		});
	}

	update() {
		this.player.update();

		// Update vision overlay
		if (this.visionOverlay) {
			this.visionOverlay.setAlpha(this.abilityManager.getVisionAlpha());
		}

		// Check collision with dynamically spawned fireballs
		this.levelManager.fireballs.forEach((fireball) => {
			if (fireball.sprite?.active) {
				this.physics.overlap(
					this.player.sprite,
					fireball.sprite,
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

		if (this.player?.sprite.y > this.cameras.main.height + 100) {
			this.killPlayer();
		}
	}

	killPlayer() {
		if (!this.player || this.player.isDead || this.isResetting) return;

		this.player.die();
		this.isResetting = true;

		this.cameras.main.flash(300, 255, 0, 0);

		this.time.delayedCall(1500, () => {
			this.scene.start('Dead');
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

		// Wait a moment then check for ability changes
		this.time.delayedCall(500, () => {
			const currentLevel = this.levelManager.current;

			// Check if this is an ability choice level
			if (currentLevel.isLoseLevel) {
				this.showAbilityChoiceScreen();
				return;
			}

			// Check if this is an ability gain level
			if (currentLevel.isGainLevel) {
				this.showAbilityGainScreen();
				return;
			}

			// Advance to next level
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
		this.levelManager.goto(0);
		this.resetPlayer();
		this.scene.switch('Win', { totalLevels: this.levelManager.levels.length });
	}

	setupCollisions() {
		if (!this.player) return;

		// Enable collision with platforms
		this.physics.add.collider(this.player.sprite, this.levelManager.platforms);

		// Set up overlap detection for hazards (spikes, lava, lasers, enemies, fireballs)
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

		// Set up collision for arrows with enemies
		this.time.addEvent({
			delay: 100,
			callback: () => {
				this.player.arrows.forEach((arrow) => {
					if (!arrow.sprite?.active) return;

					hazards.forEach((hazard) => {
						const sprite = hazard as Phaser.Physics.Arcade.Sprite;
						if (
							sprite?.body &&
							sprite.getData('hazard') &&
							sprite.texture?.key === 'enemy'
						) {
							this.physics.add.overlap(
								arrow.sprite,
								sprite,
								() => {
									// Destroy enemy and arrow
									arrow.destroy();
									sprite.destroy();
									// Remove from hazards group
									this.levelManager.hazards.remove(sprite, true, true);
								},
								undefined,
								this,
							);
						}
					});
				});
			},
			loop: true,
		});
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

	showAbilityChoiceScreen() {
		// Disable player controls during choice
		this.player.controlsEnabled = false;

		// Create choice screen
		const bg = this.add
			.rectangle(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2,
				this.cameras.main.width,
				this.cameras.main.height,
				0x000000,
				0.9,
			)
			.setDepth(20)
			.setInteractive();

		const title = this.add
			.text(this.cameras.main.width / 2, 80, 'Choose an ability to lose:', {
				fontFamily: 'Pixelify Sans',
				fontSize: '64px',
				color: '#ff4444',
				stroke: '#000000',
				strokeThickness: 8,
				align: 'center',
			})
			.setOrigin(0.5)
			.setDepth(21);

		// Map abilities to their visual icons and effect descriptions
		const abilityData: Array<{
			key: keyof PlayerAbilities;
			icon: string;
			effect: string;
		}> = [
			{ key: 'jumpLevel', icon: 'flight', effect: 'Reduced jump height/count' },
			{ key: 'visionLevel', icon: 'vision', effect: 'Screen becomes darker' },
			{ key: 'dashLevel', icon: 'dash', effect: 'Slower movement speed' },
			{ key: 'canMoveLeft', icon: 'left', effect: 'Cannot move left anymore' },
			{ key: 'canShootArrows', icon: 'bow', effect: 'Cannot shoot arrows' },
		];

		const startX = 240;
		const startY = 320;
		const boxSize = 280;
		const spacing = 40;
		const cols = 3;

		let buttonIndex = 0;
		const buttons: Phaser.GameObjects.Rectangle[] = [];
		let selectedIndex = 0;

		abilityData.forEach((data) => {
			const currentValue = this.abilityManager.abilities[data.key];

			// Only show abilities that can be downgraded
			let canDowngrade = false;
			if (typeof currentValue === 'number' && currentValue > 0) {
				canDowngrade = true;
			} else if (typeof currentValue === 'boolean' && currentValue) {
				canDowngrade = true;
			}

			if (!canDowngrade) return;

			const col = buttonIndex % cols;
			const row = Math.floor(buttonIndex / cols);
			const x = startX + col * (boxSize + spacing);
			const y = startY + row * (boxSize + spacing);

			// Create button background
			const button = this.add
				.rectangle(x, y, boxSize, boxSize, 0x333333)
				.setDepth(21)
				.setInteractive()
				.setData('abilityKey', data.key)
				.on('pointerover', () => {
					selectedIndex = buttons.indexOf(button);
					updateSelection();
				})
				.on('pointerdown', () => {
					selectAbility();
				});

			buttons.push(button);

			// Add icon
			this.add
				.image(x, y - 40, data.icon)
				.setDisplaySize(120, 120)
				.setDepth(22);

			// Add ability name
			this.add
				.text(x, y + 60, this.abilityManager.getAbilityDescription(data.key), {
					fontFamily: 'Pixelify Sans',
					fontSize: '28px',
					color: '#ffffff',
					align: 'center',
					wordWrap: { width: boxSize - 20 },
				})
				.setOrigin(0.5)
				.setDepth(22);

			// Add effect description
			this.add
				.text(x, y + 110, data.effect, {
					fontFamily: 'Pixelify Sans',
					fontSize: '20px',
					color: '#ff8888',
					align: 'center',
					wordWrap: { width: boxSize - 20 },
				})
				.setOrigin(0.5)
				.setDepth(22);

			buttonIndex++;
		});

		// Function to update visual selection
		const updateSelection = () => {
			buttons.forEach((btn, i) => {
				if (i === selectedIndex) {
					btn.setFillStyle(0x555555);
				} else {
					btn.setFillStyle(0x333333);
				}
			});
		};

		// Function to select current ability
		const selectAbility = () => {
			const button = buttons[selectedIndex];
			const abilityKey = button.getData('abilityKey') as keyof PlayerAbilities;
			// Get current value dynamically to handle upgrades
			const currentValue = this.abilityManager.abilities[abilityKey];

			// Downgrade the ability
			if (typeof currentValue === 'number') {
				this.abilityManager.abilities[abilityKey] = (currentValue - 1) as never;
			} else {
				this.abilityManager.abilities[abilityKey] = false as never;
			}

			// Re-enable player controls
			this.player.controlsEnabled = true;

			// Clean up keyboard listener
			this.input.keyboard?.off('keydown', keyHandler);

			// Clean up choice screen
			bg.destroy();
			title.destroy();
			this.children.list
				.filter((child) => {
					const depth = (
						child as Phaser.GameObjects.GameObject & { depth: number }
					).depth;
					return depth === 21 || depth === 22;
				})
				.forEach((child) => {
					child.destroy();
				});

			// Continue to next level
			const hasNext = this.levelManager.next();
			if (!hasNext) {
				this.showWinScreen();
			} else {
				this.resetPlayer();
				this.showLevelInstruction();
				this.isResetting = false;
			}
		};

		// Set up keyboard navigation
		const keyHandler = (event: KeyboardEvent) => {
			if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
				selectedIndex = Math.max(0, selectedIndex - 1);
				updateSelection();
			} else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
				selectedIndex = Math.min(buttons.length - 1, selectedIndex + 1);
				updateSelection();
			} else if (event.code === 'ArrowUp' || event.code === 'KeyW') {
				selectedIndex = Math.max(0, selectedIndex - cols);
				updateSelection();
			} else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
				selectedIndex = Math.min(buttons.length - 1, selectedIndex + cols);
				updateSelection();
			} else if (event.code === 'Enter' || event.code === 'Space') {
				selectAbility();
			}
		};

		this.input.keyboard?.on('keydown', keyHandler);
		updateSelection();
	}
	showAbilityGainScreen() {
		// Disable player controls during choice
		this.player.controlsEnabled = false;

		// Create gain screen
		const bg = this.add
			.rectangle(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2,
				this.cameras.main.width,
				this.cameras.main.height,
				0x000000,
				0.9,
			)
			.setDepth(20)
			.setInteractive();

		// Map abilities to their visual icons
		const abilityData: Array<{
			key: keyof PlayerAbilities;
			icon: string;
		}> = [
			{ key: 'jumpLevel', icon: 'flight' },
			{ key: 'visionLevel', icon: 'vision' },
			{ key: 'dashLevel', icon: 'dash' },
			{ key: 'canMoveLeft', icon: 'left' },
			{ key: 'canShootArrows', icon: 'bow' },
		];

		// Count how many abilities can actually be upgraded
		const upgradeableAbilities = abilityData.filter((data) => {
			const currentValue = this.abilityManager.abilities[data.key];
			if (
				typeof currentValue === 'number' &&
				((data.key === 'jumpLevel' && currentValue < 3) ||
					(data.key !== 'jumpLevel' && currentValue < 2))
			) {
				return true;
			} else if (typeof currentValue === 'boolean' && !currentValue) {
				return true;
			}
			return false;
		});

		// Set maxSelections to the minimum of 3 or available upgrades
		const maxSelections = Math.min(3, upgradeableAbilities.length);

		// If no abilities can be upgraded, just continue
		if (maxSelections === 0) {
			bg.destroy();
			this.player.controlsEnabled = true;
			const hasNext = this.levelManager.next();
			if (!hasNext) {
				this.showWinScreen();
			} else {
				this.resetPlayer();
				this.showLevelInstruction();
				this.isResetting = false;
			}
			return;
		}

		const titleText =
			maxSelections === 1
				? 'Choose 1 ability to regain:'
				: `Choose ${maxSelections} abilities to regain:`;

		const title = this.add
			.text(this.cameras.main.width / 2, 80, titleText, {
				fontFamily: 'Pixelify Sans',
				fontSize: '64px',
				color: '#44ff44',
				stroke: '#000000',
				strokeThickness: 8,
				align: 'center',
			})
			.setOrigin(0.5)
			.setDepth(21);

		const startX = 240;
		const startY = 320;
		const boxSize = 280;
		const spacing = 40;
		const cols = 3;

		let selectedAbilities = 0;
		let buttonIndex = 0;
		const buttons: Phaser.GameObjects.Rectangle[] = [];
		let selectedIndex = 0;

		upgradeableAbilities.forEach((data) => {
			const currentValue = this.abilityManager.abilities[data.key];

			const col = buttonIndex % cols;
			const row = Math.floor(buttonIndex / cols);
			const x = startX + col * (boxSize + spacing);
			const y = startY + row * (boxSize + spacing);

			// Create button background
			const button = this.add
				.rectangle(x, y, boxSize, boxSize, 0x224422)
				.setDepth(21)
				.setInteractive()
				.setData('abilityKey', data.key)
				.setData('currentValue', currentValue)
				.on('pointerover', () => {
					if (button.getData('selected')) return;
					selectedIndex = buttons.indexOf(button);
					updateSelection();
				})
				.on('pointerdown', () => {
					if (button.getData('selected')) return;
					if (selectedAbilities >= maxSelections) return;
					selectAbility();
				});

			buttons.push(button);

			// Add icon
			this.add
				.image(x, y - 40, data.icon)
				.setDisplaySize(120, 120)
				.setDepth(22);

			// Add ability name
			this.add
				.text(x, y + 80, this.abilityManager.getAbilityDescription(data.key), {
					fontFamily: 'Pixelify Sans',
					fontSize: '28px',
					color: '#ffffff',
					align: 'center',
					wordWrap: { width: boxSize - 20 },
				})
				.setOrigin(0.5)
				.setDepth(22);

			buttonIndex++;
		});

		// Function to update visual selection
		const updateSelection = () => {
			buttons.forEach((btn, i) => {
				if (btn.getData('selected')) return; // Don't change already selected
				if (i === selectedIndex) {
					btn.setFillStyle(0x336633);
				} else {
					btn.setFillStyle(0x224422);
				}
			});
		};

		// Function to select current ability
		const selectAbility = () => {
			const button = buttons[selectedIndex];
			if (button.getData('selected')) return;
			if (selectedAbilities >= maxSelections) return;

			const abilityKey = button.getData('abilityKey') as keyof PlayerAbilities;
			const currentValue = button.getData('currentValue');

			// Upgrade the ability
			if (typeof currentValue === 'number') {
				this.abilityManager.abilities[abilityKey] = (currentValue + 1) as never;
			} else {
				this.abilityManager.abilities[abilityKey] = true as never;
			}

			button.setFillStyle(0x44ff44);
			button.setData('selected', true);
			selectedAbilities++;

			if (selectedAbilities >= maxSelections) {
				// Wait a moment then continue
				this.time.delayedCall(1000, () => {
					// Re-enable player controls
					this.player.controlsEnabled = true;

					// Clean up keyboard listener
					this.input.keyboard?.off('keydown', keyHandler);

					// Clean up gain screen
					bg.destroy();
					title.destroy();
					this.children.list
						.filter((child) => {
							const depth = (
								child as Phaser.GameObjects.GameObject & { depth: number }
							).depth;
							return depth === 21 || depth === 22;
						})
						.forEach((child) => {
							child.destroy();
						});

					// Continue to next level
					const hasNext = this.levelManager.next();
					if (!hasNext) {
						this.showWinScreen();
					} else {
						this.resetPlayer();
						this.showLevelInstruction();
						this.isResetting = false;
					}
				});
			}
		};

		// Set up keyboard navigation
		const keyHandler = (event: KeyboardEvent) => {
			if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
				selectedIndex = Math.max(0, selectedIndex - 1);
				updateSelection();
			} else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
				selectedIndex = Math.min(buttons.length - 1, selectedIndex + 1);
				updateSelection();
			} else if (event.code === 'ArrowUp' || event.code === 'KeyW') {
				selectedIndex = Math.max(0, selectedIndex - cols);
				updateSelection();
			} else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
				selectedIndex = Math.min(buttons.length - 1, selectedIndex + cols);
				updateSelection();
			} else if (event.code === 'Enter' || event.code === 'Space') {
				selectAbility();
			}
		};

		this.input.keyboard?.on('keydown', keyHandler);
		updateSelection();
	}
}
