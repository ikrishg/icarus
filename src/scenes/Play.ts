import { Scene } from 'phaser';
import { AbilityManager } from '../components/AbilityManager';
import { BackgroundManager } from '../components/Background';
import { LevelManager } from '../components/LevelManager';
import { Player } from '../components/Player';
import { TouchControls } from '../components/TouchControls';
import type { PlayerAbilities } from '../util/types';
import {
	DEPTH_PLAY_HUD_BAR,
	DEPTH_PLAY_HUD_TEXT,
	PLAY_HUD_CLEARANCE_Y,
} from '../util/constants';
import { sanitizePixelFont } from '../util/text';

const ABILITY_CARD_FILL = 0xd6c9b6;
const ABILITY_CARD_INK = 0x442d32;
const ABILITY_CARD_INK_HEX = `#${ABILITY_CARD_INK.toString(16).padStart(6, '0')}`;
const ABILITY_LOSS_EFFECT_HEX = '#8b3333';
const ABILITY_CARD_GOLD = 0xffdd00;
const ABILITY_ICON_MAX = 120;

function abilityGridStartX(
	canvasWidth: number,
	boxSize: number,
	spacing: number,
	itemsInRow: number,
): number {
	const gridWidth = itemsInRow * boxSize + (itemsInRow - 1) * spacing;
	return (canvasWidth - gridWidth) / 2 + boxSize / 2;
}

function abilityCardPosition(
	canvasWidth: number,
	index: number,
	totalItems: number,
	cols: number,
	startY: number,
	boxSize: number,
	spacing: number,
): { x: number; y: number } {
	const col = index % cols;
	const row = Math.floor(index / cols);
	const rowStart = row * cols;
	const itemsInRow = Math.min(cols, totalItems - rowStart);
	const startX = abilityGridStartX(
		canvasWidth,
		boxSize,
		spacing,
		itemsInRow,
	);
	return {
		x: startX + col * (boxSize + spacing),
		y: startY + row * (boxSize + spacing),
	};
}

function addAbilityIcon(
	scene: Scene,
	x: number,
	y: number,
	textureKey: string,
): Phaser.GameObjects.Image {
	const frame = scene.textures.get(textureKey).get();
	const scale = Math.min(
		ABILITY_ICON_MAX / frame.width,
		ABILITY_ICON_MAX / frame.height,
	);
	return scene.add.image(x, y - 40, textureKey).setScale(scale).setDepth(22);
}

function styleAbilityCard(
	button: Phaser.GameObjects.Rectangle,
	selected: boolean,
): void {
	button.setFillStyle(ABILITY_CARD_FILL);
	button.setStrokeStyle(
		selected ? 6 : 3,
		selected ? ABILITY_CARD_GOLD : ABILITY_CARD_INK,
		1,
	);
}

export class Play extends Scene {
	backgroundManager: BackgroundManager;
	levelManager: LevelManager;
	player: Player;
	abilityManager: AbilityManager;
	isResetting = false;
	visionOverlay: Phaser.GameObjects.Rectangle;
	touchControls: TouchControls;
	instructionText?: Phaser.GameObjects.Text;
	private colliders: Phaser.Physics.Arcade.Collider[] = [];
	private escKeyHandler?: () => void;
	private restartKeyHandler?: (event: KeyboardEvent) => void;
	private skipKeyHandler?: () => void;

	constructor() {
		super('Play');
	}

	init() {
		this.resetRunState();
	}

	create() {
		this.resetRunState();

		// Stop all music and play battle music
		this.sound.stopAll();

		this.backgroundManager = new BackgroundManager(this, {
			icarus: false,
			hudClearance: PLAY_HUD_CLEARANCE_Y,
		});

		this.abilityManager = new AbilityManager();
		this.levelManager = new LevelManager(this);
		this.levelManager.goto(0);

		this.player = new Player(
			this,
			this.levelManager.current.start.x,
			this.levelManager.current.start.y,
			this.abilityManager,
		);

		this.touchControls = new TouchControls(this);
		this.player.touchControls = this.touchControls;

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

		this.setupLevelColliders();
		window.__icarusGetColliders = () => this.colliders.length;
		this.playBattleMusic();
		this.showLevelInstruction();

		this.time.addEvent({
			delay: 100,
			callback: () => this.checkArrowEnemyHits(),
			loop: true,
		});

		this.escKeyHandler = () => {
			this.sound.stopAll();
			this.scene.start('Menu');
		};
		this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

		if (import.meta.env.DEV) {
			this.skipKeyHandler = () => {
				if (!this.isResetting) {
					this.completeLevel();
				}
			};
			this.input.keyboard?.on('keydown-SEMICOLON', this.skipKeyHandler);
		}

		this.restartKeyHandler = (event: KeyboardEvent) => {
			if (event.shiftKey && !this.isResetting) {
				this.killPlayer();
			}
		};
		this.input.keyboard?.on('keydown-R', this.restartKeyHandler);
	}

	resetRunState() {
		this.isResetting = false;
	}

	shutdown() {
		this.resetRunState();
		this.clearLevelInstruction();
		this.clearColliders();
		this.touchControls?.destroy();
		if (this.escKeyHandler) {
			this.input.keyboard?.off('keydown-ESC', this.escKeyHandler);
		}
		if (this.restartKeyHandler) {
			this.input.keyboard?.off('keydown-R', this.restartKeyHandler);
		}
		if (this.skipKeyHandler) {
			this.input.keyboard?.off('keydown-SEMICOLON', this.skipKeyHandler);
		}
		delete window.__icarusGetColliders;
	}

	update() {
		this.player.update();

		// Update vision overlay
		if (this.visionOverlay) {
			this.visionOverlay.setAlpha(this.abilityManager.getVisionAlpha());
		}

		for (const fireball of this.levelManager.fireballs) {
			if (
				fireball.sprite?.active &&
				this.physics.overlap(this.player.sprite, fireball.sprite)
			) {
				if (!this.player.isDead && !this.isResetting) {
					this.killPlayer();
				}
				break;
			}
		}

		if (this.player?.sprite.y > this.cameras.main.height + 100) {
			this.killPlayer();
		}
	}

	playBattleMusic() {
		// Cycle through the two battle music tracks based on level progression
		// Levels 0-13: battle-beats (early/mid game)
		// Levels 14+: battle-climax (late game, maximum tension)
		const levelIndex = this.levelManager.currentIndex;
		let musicKey: string;

		if (levelIndex < 14) {
			musicKey = 'battle-beats';
		} else {
			musicKey = 'battle-climax';
		}

		// Only change music if it's not already playing the correct track
		const currentMusic = this.sound.get(musicKey);
		if (!currentMusic?.isPlaying) {
			// Stop all battle music
			this.sound.get('battle-beats')?.stop();
			this.sound.get('battle-climax')?.stop();

			// Play the appropriate track
			const music = this.sound.add(musicKey, { loop: true, volume: 0.4 });
			music.play();
		}
	}

	killPlayer() {
		if (!this.player || this.player.isDead || this.isResetting) return;

		this.player.die();
		this.isResetting = true;

		// Play death sound
		this.sound.play('death', { volume: 0.6 });

		this.cameras.main.flash(300, 255, 0, 0);

		this.time.delayedCall(1500, () => {
			this.restartCurrentLevel();
		});
	}

	restartCurrentLevel() {
		if (!this.player) return;

		const levelIndex = this.levelManager.currentIndex;
		this.clearLevelInstruction();
		this.clearColliders();
		this.levelManager.goto(levelIndex);
		this.player.revive(
			this.levelManager.current.start.x,
			this.levelManager.current.start.y,
		);
		this.setupLevelColliders();
		this.showLevelInstruction();
		this.isResetting = false;
		this.playBattleMusic();
	}

	clearLevelInstruction() {
		if (this.instructionText?.active) {
			this.tweens.killTweensOf(this.instructionText);
			this.instructionText.destroy();
			this.instructionText = undefined;
		}
	}

	clearColliders() {
		for (const collider of this.colliders) {
			collider.destroy();
		}
		this.colliders = [];
	}

	completeLevel() {
		if (this.isResetting) return;
		this.isResetting = true;

		// Play success sound
		this.sound.play('success', { volume: 0.6 });

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
				this.playBattleMusic();
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

	setupLevelColliders() {
		if (!this.player) return;

		this.colliders.push(
			this.physics.add.collider(this.player.sprite, this.levelManager.platforms),
		);

		const hazards =
			this.levelManager.hazards.getChildren() as Phaser.GameObjects.GameObject[];
		for (const hazard of hazards) {
			const physicsObj = hazard as
				| Phaser.Physics.Arcade.Sprite
				| Phaser.GameObjects.Rectangle;
			if (physicsObj) {
				this.colliders.push(
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
					),
				);
			}
		}

		if (this.levelManager.portal) {
			const portalChildren =
				this.levelManager.portal.getAll() as Phaser.Physics.Arcade.Sprite[];
			const portalSprite = portalChildren.find(
				(child) => child.texture?.key === 'portal',
			);

			if (portalSprite) {
				this.colliders.push(
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
					),
				);
			}
		}
	}

	checkArrowEnemyHits() {
		if (!this.player) return;

		const hazards =
			this.levelManager.hazards.getChildren() as Phaser.Physics.Arcade.Sprite[];

		for (const arrow of this.player.arrows) {
			if (!arrow.sprite?.active) continue;

			for (const hazard of hazards) {
				const sprite = hazard;
				if (
					!sprite?.body ||
					!sprite.getData('hazard') ||
					sprite.texture?.key !== 'enemy' ||
					!sprite.active
				) {
					continue;
				}

				if (this.physics.overlap(arrow.sprite, sprite)) {
					this.sound.play('shot', { volume: 0.5 });
					arrow.destroy();
					sprite.destroy();
					this.levelManager.hazards.remove(sprite, true, true);
					break;
				}
			}
		}
	}

	resetPlayer() {
		if (!this.player) return;
		this.clearLevelInstruction();
		this.clearColliders();
		const startPos = this.levelManager.current.start;
		this.player.revive(startPos.x, startPos.y);
		this.setupLevelColliders();
	}

	showLevelInstruction() {
		this.clearLevelInstruction();
		const lvl = this.levelManager.current;
		const instruction = sanitizePixelFont(
			lvl.instruction ?? 'Reach the portal to complete!',
		);

		this.instructionText = this.add
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
					wordWrap: {
						useAdvancedWrap: true,
						width: this.cameras.main.width - 200,
					},
				},
			)
			.setOrigin(0.5)
			.setDepth(15);

		// Fade out instruction message
		this.tweens.add({
			targets: this.instructionText,
			alpha: 0,
			duration: 1500,
			delay: 2000,
			onComplete: () => {
				this.instructionText?.destroy();
				this.instructionText = undefined;
			},
		});
	}

	showAbilityChoiceScreen() {
		this.touchControls?.setGameplayVisible(false);
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
				color: '#e9591c',
				stroke: '#000000',
				strokeThickness: 8,
				align: 'center',
			})
			.setOrigin(0.5)
			.setDepth(21);

		this.add
			.text(
				this.cameras.main.width / 2,
				160,
				'Tap a card or use arrow keys + Enter to choose',
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '32px',
					color: '#ffffff',
					align: 'center',
				},
			)
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

		const startY = 320;
		const boxSize = 280;
		const spacing = 40;
		const cols = 3;
		const downgradeable = abilityData.filter((data) => {
			const currentValue = this.abilityManager.abilities[data.key];
			if (typeof currentValue === 'number' && currentValue > 0) return true;
			if (typeof currentValue === 'boolean' && currentValue) return true;
			return false;
		});

		const buttons: Phaser.GameObjects.Rectangle[] = [];
		let selectedIndex = 0;

		downgradeable.forEach((data, buttonIndex) => {
			const { x, y } = abilityCardPosition(
				this.cameras.main.width,
				buttonIndex,
				downgradeable.length,
				cols,
				startY,
				boxSize,
				spacing,
			);

			const button = this.add
				.rectangle(x, y, boxSize, boxSize, ABILITY_CARD_FILL)
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

			styleAbilityCard(button, false);
			buttons.push(button);

			addAbilityIcon(this, x, y, data.icon);

			// Add ability name
			this.add
				.text(x, y + 60, this.abilityManager.getAbilityDescription(data.key), {
					fontFamily: 'Pixelify Sans',
					fontSize: '28px',
					color: ABILITY_CARD_INK_HEX,
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
					color: ABILITY_LOSS_EFFECT_HEX,
					align: 'center',
					wordWrap: { width: boxSize - 20 },
				})
				.setOrigin(0.5)
				.setDepth(22);

		});

		// Function to update visual selection
		const updateSelection = () => {
			buttons.forEach((btn, i) => {
				styleAbilityCard(btn, i === selectedIndex);
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
			this.touchControls?.setGameplayVisible(true);

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
				this.playBattleMusic();
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
		this.touchControls?.setGameplayVisible(false);
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
			this.touchControls?.setGameplayVisible(true);
			const hasNext = this.levelManager.next();
			if (!hasNext) {
				this.showWinScreen();
			} else {
				this.resetPlayer();
				this.playBattleMusic();
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
				color: '#afa843',
				stroke: '#000000',
				strokeThickness: 8,
				align: 'center',
			})
			.setOrigin(0.5)
			.setDepth(21);

		this.add
			.text(
				this.cameras.main.width / 2,
				160,
				'Tap cards or use arrow keys + Enter — pick each regain in turn',
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '32px',
					color: '#ffffff',
					align: 'center',
					wordWrap: { width: this.cameras.main.width - 120 },
				},
			)
			.setOrigin(0.5)
			.setDepth(21);

		const startY = 320;
		const boxSize = 280;
		const spacing = 40;
		const cols = Math.min(3, upgradeableAbilities.length);

		let selectedAbilities = 0;
		const buttons: Phaser.GameObjects.Rectangle[] = [];
		let selectedIndex = 0;

		upgradeableAbilities.forEach((data, buttonIndex) => {
			const currentValue = this.abilityManager.abilities[data.key];

			const { x, y } = abilityCardPosition(
				this.cameras.main.width,
				buttonIndex,
				upgradeableAbilities.length,
				cols,
				startY,
				boxSize,
				spacing,
			);

			const button = this.add
				.rectangle(x, y, boxSize, boxSize, ABILITY_CARD_FILL)
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

			styleAbilityCard(button, false);
			buttons.push(button);

			addAbilityIcon(this, x, y, data.icon);

			// Add regain label (what you get back)
			this.add
				.text(
					x,
					y + 80,
					sanitizePixelFont(
						this.abilityManager.getAbilityRegainLabel(data.key),
					),
					{
						fontFamily: 'Pixelify Sans',
						fontSize: '28px',
						color: ABILITY_CARD_INK_HEX,
						align: 'center',
						wordWrap: { width: boxSize - 20 },
					},
				)
				.setOrigin(0.5)
				.setDepth(22);
		});

		// Function to update visual selection
		const updateSelection = () => {
			buttons.forEach((btn, i) => {
				if (btn.getData('selected')) return;
				styleAbilityCard(btn, i === selectedIndex);
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

			button.setFillStyle(0xafa843);
			button.setStrokeStyle(3, ABILITY_CARD_INK, 1);
			button.setData('selected', true);
			selectedAbilities++;

			if (selectedAbilities >= maxSelections) {
				// Wait a moment then continue
				this.time.delayedCall(1000, () => {
					// Re-enable player controls
					this.player.controlsEnabled = true;
					this.touchControls?.setGameplayVisible(true);

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
						this.playBattleMusic();
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
