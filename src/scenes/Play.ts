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
import { DeathSequence, type DeathCause } from '../components/DeathSequence';
import { isDebugPlayEnabled } from '../util/debug';
import {
	ABILITY_LOSS_LINE,
	ABILITY_MYTH_NAME,
	abilityStateLine,
	regainLevelTitle,
} from '../util/abilityCopy';
import { PALETTE_HEX } from '../util/palette';
import { sanitizePixelFont } from '../util/text';

const ABILITY_CARD_FILL = 0xd6c9b6;
const ABILITY_CARD_INK = 0x442d32;
const ABILITY_CARD_INK_HEX = `#${ABILITY_CARD_INK.toString(16).padStart(6, '0')}`;
const ABILITY_LOSS_EFFECT_HEX = PALETTE_HEX.lossEffect;
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
	instructionPanel?: Phaser.GameObjects.Rectangle;
	private pauseResumeKey?: Phaser.Input.Keyboard.Key;
	private pauseQuitKey?: Phaser.Input.Keyboard.Key;
	lives = 3;
	giftsLost = 0;
	livesText?: Phaser.GameObjects.Text;
	deathSequence?: DeathSequence;
	private colliders: Phaser.Physics.Arcade.Collider[] = [];
	private escKeyHandler?: () => void;
	private restartKeyHandler?: (event: KeyboardEvent) => void;
	private skipKeyHandler?: () => void;
	private pausePanel?: Phaser.GameObjects.Container;
	private isPaused = false;
	private runEndedOnDeath = false;

	constructor() {
		super('Play');
	}

	init() {
		this.lives = 3;
		this.giftsLost = 0;
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
		this.deathSequence = new DeathSequence(this, this.player);
		this.createLivesHud();
		window.__icarusGetColliders = () => this.colliders.length;
		window.__icarusGetLives = () => this.lives;
		this.playBattleMusic();
		this.showLevelInstruction();

		this.time.addEvent({
			delay: 100,
			callback: () => this.checkArrowEnemyHits(),
			loop: true,
		});

		this.escKeyHandler = () => {
			if (this.deathSequence?.isEscBlocked()) return;
			if (this.isResetting) return;
			this.togglePause();
		};
		this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

		if (isDebugPlayEnabled()) {
			this.skipKeyHandler = () => {
				if (this.scene.isActive('Win')) return;
				if (!this.isResetting) {
					this.completeLevel();
				}
			};
			this.input.keyboard?.on('keydown-SEMICOLON', this.skipKeyHandler);
		}

		this.restartKeyHandler = (event: KeyboardEvent) => {
			if (event.shiftKey && !this.isResetting && !this.isPaused) {
				this.killPlayer('fall', { fast: true, spendLife: false });
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
		delete window.__icarusGetLives;
	}

	update() {
		if (this.isPaused) return;
		if (this.deathSequence?.consumeJumpBuffer()) {
			const maxJumps = this.abilityManager.getMaxJumps();
			if (maxJumps > 0 && this.player.jumpCount < maxJumps) {
				this.player.sprite.setVelocityY(this.player.JUMP_VELOCITY);
				this.player.jumpCount++;
			}
		}
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
					this.killPlayer('fire');
				}
				break;
			}
		}

		if (this.player?.sprite.y > this.cameras.main.height + 100) {
			this.killPlayer('fall');
		}
	}

	playBattleMusic() {
		// Cycle through the two battle music tracks based on level progression
		// Levels 0-13: battle-beats (early/mid game)
		// Levels 14+: battle-climax (late game, maximum tension)
		const levelIndex = this.levelManager.currentIndex;
		let musicKey: string;

		if (levelIndex < 10) {
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

	killPlayer(
		cause: DeathCause = 'fall',
		options: { fast?: boolean; spendLife?: boolean } = {},
	) {
		if (!this.player || this.player.isDead || this.isResetting) return;
		if (!this.deathSequence) return;

		const fast = options.fast === true;
		const spendLife = options.spendLife !== false;

		this.clearLevelInstruction();
		this.levelManager.setHudVisible(false);
		this.isResetting = true;
		this.sound.play('death', { volume: 0.6 });

		this.runEndedOnDeath = false;
		const finishDeath = () => {
			this.levelManager.setHudVisible(true);
			this.isResetting = false;
			if (this.runEndedOnDeath) {
				this.scene.start('Dead');
			}
		};
		this.deathSequence.run(cause, {
			fast,
			onRebuild: () => {
				if (spendLife) {
					this.lives -= 1;
					this.updateLivesHud();
					if (this.lives <= 0) {
						this.runEndedOnDeath = true;
						this.abilityManager.reset();
						this.giftsLost = 0;
						this.lives = 3;
						this.updateLivesHud();
						this.levelManager.goto(0);
					}
				}
				this.restartCurrentLevel();
			},
			onComplete: () => {
				finishDeath();
			},
		});
		this.time.delayedCall(fast ? 800 : 1850, () => {
			if (this.isResetting) {
				finishDeath();
			}
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
		this.playBattleMusic();
	}

	clearLevelInstruction() {
		if (this.instructionPanel?.active) {
			this.tweens.killTweensOf(this.instructionPanel);
			this.instructionPanel.destroy();
			this.instructionPanel = undefined;
		}
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
		this.clearLevelInstruction();
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
		this.isResetting = false;
		this.levelManager.goto(0);
		this.resetPlayer();
		this.scene.switch('Win', { giftsLost: this.giftsLost });
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
								this.killPlayer('spikes');
							}
						},
						undefined,
						this,
					),
				);
			}
		}

		const portalTrigger = this.levelManager.portalTrigger;
		if (portalTrigger?.body) {
			this.colliders.push(
				this.physics.add.overlap(
					this.player.sprite,
					portalTrigger,
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

	createLivesHud() {
		this.livesText?.destroy();
		this.livesText = this.add
			.text(24, PLAY_HUD_CLEARANCE_Y + 8, this.livesLabel(), {
				fontFamily: 'Pixelify Sans',
				fontSize: '40px',
				color: '#fdfdfe',
				stroke: PALETTE_HEX.deep,
				strokeThickness: 3,
			})
			.setOrigin(0, 0)
			.setDepth(DEPTH_PLAY_HUD_TEXT);
	}

	livesLabel(): string {
		return `Lives: ${this.lives}`;
	}

	updateLivesHud() {
		this.livesText?.setText(this.livesLabel());
	}

	togglePause() {
		if (this.pausePanel) {
			this.closePause();
			return;
		}
		this.isPaused = true;
		this.physics.pause();
		this.pausePanel = this.add.container(0, 0).setDepth(250);
		const bg = this.add
			.rectangle(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2,
				this.cameras.main.width,
				this.cameras.main.height,
				0x0b1a2e,
				0.75,
			)
			.setInteractive();
		const title = this.add
			.text(this.cameras.main.width / 2, this.cameras.main.height / 2 - 40, 'Paused', {
				fontFamily: 'Pixelify Sans',
				fontSize: '72px',
				color: '#ffdd00',
			})
			.setOrigin(0.5);
		const hint = this.add
			.text(
				this.cameras.main.width / 2,
				this.cameras.main.height / 2 + 40,
				'Esc: Resume   |   Q: Quit to menu',
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '36px',
					color: '#fdfdfe',
				},
			)
			.setOrigin(0.5);
		this.pausePanel.add([bg, title, hint]);
		this.pauseResumeKey = this.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.ESC,
		);
		this.pauseQuitKey = this.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.Q,
		);
		this.pauseResumeKey?.once('down', () => this.closePause());
		this.pauseQuitKey?.once('down', () => {
			if (!this.isPaused) return;
			this.closePause();
			this.sound.stopAll();
			this.scene.start('Menu');
		});
	}

	closePause() {
		this.pauseResumeKey?.removeAllListeners();
		this.pauseQuitKey?.removeAllListeners();
		this.pauseResumeKey = undefined;
		this.pauseQuitKey = undefined;
		this.pausePanel?.destroy();
		this.pausePanel = undefined;
		this.isPaused = false;
		this.physics.resume();
	}

	showLevelInstruction() {
		this.clearLevelInstruction();
		const lvl = this.levelManager.current;
		const instruction = sanitizePixelFont(
			lvl.instruction ?? 'Reach the portal.',
		);

		const panelY = PLAY_HUD_CLEARANCE_Y + 72;
		this.instructionPanel = this.add
			.rectangle(
				this.cameras.main.width / 2,
				panelY,
				this.cameras.main.width - 120,
				120,
				0x0b1a2e,
				0.75,
			)
			.setDepth(14);

		this.instructionText = this.add
			.text(this.cameras.main.width / 2, panelY, instruction, {
				fontFamily: 'Pixelify Sans',
				fontSize: '48px',
				color: '#fdfdfe',
				stroke: PALETTE_HEX.deep,
				strokeThickness: 2,
				align: 'center',
				lineSpacing: 8,
				wordWrap: {
					useAdvancedWrap: true,
					width: this.cameras.main.width - 200,
				},
			})
			.setOrigin(0.5)
			.setDepth(15);

		// Fade out instruction message
		this.tweens.add({
			targets: [this.instructionPanel, this.instructionText],
			alpha: 0,
			duration: 1500,
			delay: 2000,
			onComplete: () => {
				this.instructionPanel?.destroy();
				this.instructionPanel = undefined;
				this.instructionText?.destroy();
				this.instructionText = undefined;
			},
		});
	}

	showAbilityChoiceScreen() {
		this.clearLevelInstruction();
		this.levelManager.setHudVisible(false);
		this.touchControls?.setGameplayVisible(false);
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
			.text(
				this.cameras.main.width / 2,
				80,
				sanitizePixelFont('The sun takes a gift.'),
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '64px',
					color: '#e9591c',
					stroke: PALETTE_HEX.deep,
					strokeThickness: 4,
					align: 'center',
				},
			)
			.setOrigin(0.5)
			.setDepth(21);

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

		const startY = 320;
		const boxSize = 280;
		const spacing = 40;
		const cols = 3;
		const downgradeable = abilityData.filter((data) => {
			const currentValue = this.abilityManager.abilities[data.key];
			if (
				data.key === 'jumpLevel' &&
				typeof currentValue === 'number' &&
				this.levelManager.currentIndex === 1 &&
				currentValue <= 2
			) {
				return false;
			}
			if (typeof currentValue === 'number' && currentValue > 0) return true;
			if (typeof currentValue === 'boolean' && currentValue) return true;
			return false;
		});

		if (downgradeable.length === 0) {
			this.player.controlsEnabled = true;
			this.touchControls?.setGameplayVisible(true);
			this.levelManager.setHudVisible(true);
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

			const myth = ABILITY_MYTH_NAME[data.key];
			this.add
				.text(x, y + 50, sanitizePixelFont(myth), {
					fontFamily: 'Pixelify Sans',
					fontSize: '28px',
					color: ABILITY_CARD_INK_HEX,
					align: 'center',
					wordWrap: { width: boxSize - 20 },
				})
				.setOrigin(0.5)
				.setDepth(22);

			this.add
				.text(
					x,
					y + 88,
					sanitizePixelFont(
						abilityStateLine(data.key, this.abilityManager.abilities),
					),
					{
						fontFamily: 'Pixelify Sans',
						fontSize: '22px',
						color: ABILITY_CARD_INK_HEX,
						align: 'center',
						wordWrap: { width: boxSize - 20 },
					},
				)
				.setOrigin(0.5)
				.setDepth(22);

			this.add
				.text(x, y + 128, sanitizePixelFont(ABILITY_LOSS_LINE[data.key]), {
					fontFamily: 'Pixelify Sans',
					fontSize: '22px',
					color: ABILITY_LOSS_EFFECT_HEX,
					align: 'center',
					wordWrap: { width: boxSize - 20 },
				})
				.setOrigin(0.5)
				.setDepth(22);
		});

		const helperY =
			startY +
			Math.ceil(downgradeable.length / cols) * (boxSize + spacing) +
			24;
		this.add
			.text(
				this.cameras.main.width / 2,
				helperY,
				sanitizePixelFont(
					'Choose what you give up. Arrow keys and Enter, or tap.',
				),
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '32px',
					color: PALETTE_HEX.cardHelper,
					align: 'center',
					wordWrap: { width: this.cameras.main.width - 120 },
				},
			)
			.setOrigin(0.5)
			.setDepth(21);

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
			this.giftsLost += 1;

			this.player.controlsEnabled = true;
			this.touchControls?.setGameplayVisible(true);
			this.levelManager.setHudVisible(true);

			this.input.keyboard?.off('keydown', keyHandler);

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

		if (isDebugPlayEnabled() && buttons.length > 0) {
			this.time.delayedCall(80, () => selectAbility());
		}
	}
	showAbilityGainScreen() {
		this.clearLevelInstruction();
		this.levelManager.setHudVisible(false);
		this.touchControls?.setGameplayVisible(false);
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

		const titleText = sanitizePixelFont(
			regainLevelTitle(this.levelManager.currentIndex),
		);

		const title = this.add
			.text(this.cameras.main.width / 2, 80, titleText, {
				fontFamily: 'Pixelify Sans',
				fontSize: '64px',
				color: '#afa843',
				stroke: PALETTE_HEX.deep,
				strokeThickness: 4,
				align: 'center',
			})
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

		let gainFinished = false;
		let gainCompleteTimer: Phaser.Time.TimerEvent | undefined;

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

			this.add
				.text(button.x, button.y - 100, 'Returned', {
					fontFamily: 'Pixelify Sans',
					fontSize: '24px',
					color: ABILITY_CARD_INK_HEX,
				})
				.setOrigin(0.5)
				.setDepth(23);

			if (selectedAbilities >= maxSelections) {
				gainCompleteTimer?.remove();
				gainCompleteTimer = this.time.delayedCall(600, () => finishGain());
			}
		};

		const finishGain = () => {
			if (gainFinished) return;
			gainFinished = true;
			gainCompleteTimer?.remove();
			gainCompleteTimer = undefined;
			this.player.controlsEnabled = true;
			this.touchControls?.setGameplayVisible(true);
			this.levelManager.setHudVisible(true);
			this.input.keyboard?.off('keydown', keyHandler);
			bg.destroy();
			title.destroy();
			this.children.list
				.filter((child) => {
					const depth = (
						child as Phaser.GameObjects.GameObject & { depth: number }
					).depth;
					return depth === 21 || depth === 22 || depth === 23;
				})
				.forEach((child) => {
					child.destroy();
				});
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

		const helperY =
			startY +
			Math.ceil(upgradeableAbilities.length / cols) * (boxSize + spacing) +
			16;
		this.add
			.text(
				this.cameras.main.width / 2,
				helperY,
				sanitizePixelFont(
					maxSelections === 1
						? 'Choose 1 to take back.'
						: `Choose ${maxSelections} to take back.`,
				),
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '32px',
					color: PALETTE_HEX.cardHelper,
					align: 'center',
				},
			)
			.setOrigin(0.5)
			.setDepth(21);
		this.add
			.text(
				this.cameras.main.width / 2,
				helperY + 44,
				sanitizePixelFont(
					'Pick one. Arrow keys and Enter, or tap. Shift+Enter when done.',
				),
				{
					fontFamily: 'Pixelify Sans',
					fontSize: '28px',
					color: '#fdfdfe',
					align: 'center',
					wordWrap: { width: this.cameras.main.width - 120 },
				},
			)
			.setOrigin(0.5)
			.setDepth(21);

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
			} else if (
				event.shiftKey &&
				(event.code === 'Enter' || event.code === 'Space') &&
				selectedAbilities >= 1
			) {
				finishGain();
			} else if (event.code === 'Enter' || event.code === 'Space') {
				selectAbility();
			}
		};

		this.input.keyboard?.on('keydown', keyHandler);
		updateSelection();

		if (isDebugPlayEnabled() && buttons.length > 0) {
			let autoPicks = 0;
			const autoPick = () => {
				if (autoPicks >= maxSelections) return;
				const nextIdx = buttons.findIndex((b) => !b.getData('selected'));
				if (nextIdx < 0) {
					finishGain();
					return;
				}
				selectedIndex = nextIdx;
				updateSelection();
				selectAbility();
				autoPicks += 1;
				if (
					autoPicks < maxSelections &&
					buttons.some((b) => !b.getData('selected'))
				) {
					this.time.delayedCall(120, autoPick);
				}
			};
			this.time.delayedCall(120, autoPick);
		}
	}
}
