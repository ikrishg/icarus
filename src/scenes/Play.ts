import { Scene } from 'phaser';
import { AbilityManager } from '../components/AbilityManager';
import { BackgroundManager } from '../components/Background';
import { LevelManager } from '../components/LevelManager';
import { Player } from '../components/Player';
import { isTouchDevice, TouchControls } from '../components/TouchControls';
import type { PlayerAbilities } from '../util/types';
import {
	DEPTH_PLAY_HUD_TEXT,
	HEIGHT,
	PLAY_HUD_CLEARANCE_Y,
	WIDTH,
} from '../util/constants';
import { DeathSequence, type DeathCause } from '../components/DeathSequence';
import {
	ABILITY_LOSS_LINE,
	ABILITY_MYTH_NAME,
	abilityStateLine,
	regainLevelTitle,
} from '../util/abilityCopy';
import { PALETTE, PALETTE_HEX } from '../util/palette';
import { touchFontSizeStyle } from '../util/responsiveText';
import {
	isPortraitBlockerActive,
	PORTRAIT_BLOCKER_MEDIA,
} from '../util/portraitBlocker';
import {
	touchChromeMetrics,
	touchInstructionPanelCenterY,
} from '../util/touchLayout';
import {
	clearanceToHazards,
	hazardIntervalsForLevel,
	spriteOverlapsButtons,
	TOUCH_HAZARD_MARGIN_PX,
	type ButtonRect,
} from '../util/touchSafeX';

import { isDebugPlayEnabled } from '../util/debug';

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
	rowHeight: number = boxSize,
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
		y: startY + row * (rowHeight + spacing),
	};
}

function addAbilityIcon(
	scene: Scene,
	x: number,
	cardTop: number,
	cardHeight: number,
	textureKey: string,
): Phaser.GameObjects.Image {
	const frame = scene.textures.get(textureKey).get();
	const iconArea = Math.min(ABILITY_ICON_MAX, Math.max(48, cardHeight * 0.2));
	const scale = Math.min(
		iconArea / frame.width,
		iconArea / frame.height,
	);
	const scaledH = frame.height * scale;
	const padTop = 12;
	const centerY = cardTop + padTop + scaledH / 2;
	return scene.add.image(x, centerY, textureKey).setScale(scale).setDepth(22);
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
	private portraitBlockerPauseActive = false;
	private pendingTouchLandscapeSpawn = false;
	/** Set when death revive finishes; cleared after portrait→landscape touch spawn sync. */
	private recentDeathNeedsLandscapeSpawnSync = false;
	private runEndedOnDeath = false;
	private resizePushGeneration = 0;
	private resizePushTimer?: Phaser.Time.TimerEvent;

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
		this.touchControls.setTopBarHandlers(
			() => this.requestPause(),
			() => {
				if (!this.isResetting && !this.isPaused) {
					this.killPlayer('fall', { fast: true, spendLife: false });
				}
			},
		);
		this.physics.world.setBounds(0, 0, WIDTH, HEIGHT);
		this.physics.world.setBoundsCollision(true, true, false, true);
		this.physics.world.on('poststep', this.clampPlayerToWorldSides, this);

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
			.setDepth(19)
			.setAlpha(this.abilityManager.getVisionAlpha());

		this.setupLevelColliders();
		const spawn = this.resolveTouchSpawnPlacement();
		this.player.setPosition(spawn.x, spawn.y);
		this.deathSequence = new DeathSequence(this, this.player);
		this.createLivesHud();
		window.__icarusGetColliders = () => this.colliders.length;
		window.__icarusGetLives = () => this.lives;
		if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_HOOKS === 'true') {
			window.__icarusTouchChromeMetrics = () => touchChromeMetrics(this);
			window.__icarusPrepareLevel = (levelIndex: number) => {
				try {
					if (!this.scene?.isActive() || !this.player || !this.physics?.world) {
						return false;
					}
					const world = this.physics.world;
					const wasPaused = world.isPaused;
					try {
						this.clearLevelInstruction();
						this.clearColliders();
						this.isResetting = false;
						this.pendingTouchLandscapeSpawn = false;
						this.player.isDead = false;
						this.player.controlsEnabled = true;
						this.levelManager.goto(levelIndex);
						this.refreshTouchSpawnLayout();
						world.resume();
						const spawn = this.resolveTouchSpawnPlacement();
						this.player.revive(spawn.x, spawn.y);
						this.setupLevelColliders();
						this.levelManager.syncFireballSpawnClock();
						if (this.touchControls?.visible) {
							this.repositionTouchSpawnIfOverlappingButtons();
						}
						return true;
					} finally {
						if (wasPaused) {
							world.pause();
						}
					}
				} catch {
					return false;
				}
			};
		}
		this.playBattleMusic();
		this.showLevelInstruction();

		this.time.addEvent({
			delay: 100,
			callback: () => this.checkArrowEnemyHits(),
			loop: true,
		});

		this.escKeyHandler = () => {
			this.requestPause();
		};
		this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

		if (isTouchDevice(this) && typeof window !== 'undefined') {
			const blockerMq = window.matchMedia(PORTRAIT_BLOCKER_MEDIA);
			const onBlockerChange = () => this.syncPortraitBlockerPause();
			if (typeof blockerMq.addEventListener === 'function') {
				blockerMq.addEventListener('change', onBlockerChange);
			} else if (typeof blockerMq.addListener === 'function') {
				blockerMq.addListener(onBlockerChange);
			}
			this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
				if (typeof blockerMq.removeEventListener === 'function') {
					blockerMq.removeEventListener('change', onBlockerChange);
				} else if (typeof blockerMq.removeListener === 'function') {
					blockerMq.removeListener(onBlockerChange);
				}
			});
			this.syncPortraitBlockerPause();
		}

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
		this.physics.world.off('poststep', this.clampPlayerToWorldSides, this);
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
		delete window.__icarusPrepareLevel;
		delete window.__icarusTouchChromeMetrics;
	}

	update() {
		if (isTouchDevice(this)) {
			if (
				isPortraitBlockerActive() &&
				!this.pausePanel &&
				!this.isResetting &&
				!this.deathSequence?.isEscBlocked()
			) {
				if (!this.portraitBlockerPauseActive) {
					this.portraitBlockerPauseActive = true;
				}
				this.isPaused = true;
				if (!this.physics.world.isPaused) {
					this.physics.pause();
				}
				this.setGameplayClockPaused(true);
			} else if (
				this.portraitBlockerPauseActive ||
				(this.isPaused &&
					!this.pausePanel &&
					!isPortraitBlockerActive())
			) {
				this.syncPortraitBlockerPause();
			}
		}
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
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body | null;
		if (!body) return;

		const fast = options.fast === true;
		const spendLife = options.spendLife !== false;

		this.clearLevelInstruction();
		this.setGameplayHudVisible(false);
		this.isResetting = true;
		this.levelManager.setFireballTimersPaused(true);
		this.time.paused = false;
		this.time.timeScale = this.gameplayTimeScale || 1;
		this.sound.play('death', { volume: 0.6 });

		this.runEndedOnDeath = false;
		const finishDeath = () => {
			this.relayoutTouchChromeHud();
			this.setGameplayHudVisible(true);
			this.endLevelTransitionReset();
			if (isPortraitBlockerActive()) {
				this.portraitBlockerPauseActive = true;
				this.isPaused = true;
				if (!this.physics.world.isPaused) {
					this.physics.pause();
				}
				this.setGameplayClockPaused(true);
			} else if (!this.pausePanel) {
				this.isPaused = false;
				this.physics.resume();
				this.setGameplayClockPaused(false);
			}
			this.syncPortraitBlockerPause();
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
				if (this.player) {
					this.player.controlsEnabled = true;
				}
				if (this.touchControls?.visible) {
					this.recentDeathNeedsLandscapeSpawnSync = true;
				}
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
		this.refreshTouchSpawnLayout();
		const spawnPos = this.resolveTouchSpawnPlacement();
		this.player.revive(spawnPos.x, spawnPos.y);
		this.setupLevelColliders();
		this.relayoutTouchChromeHud();
		this.showLevelInstruction();
		this.playBattleMusic();
		this.syncTouchLandscapeSpawnIfNeeded();
		if (this.isResetting) {
			this.levelManager.setFireballTimersPaused(true);
		}
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

	/** Clears portal/ability reset gate and resumes deferred fireball schedule. */
	private endLevelTransitionReset(): void {
		this.isResetting = false;
		if (this.levelManager.deferLevelClockReset) {
			this.levelManager.applyDeferredLevelStartClock();
		}
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
				this.endLevelTransitionReset();
				this.syncPortraitBlockerPause();
			}
		});
	}

	showWinScreen() {
		this.endLevelTransitionReset();
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

	private touchGameplayButtons(): ButtonRect[] {
		return [
			...(this.touchControls?.getLeftMovementButtonBounds?.() ?? []),
			...(this.touchControls?.getGameplayButtonBounds?.() ?? []),
		];
	}

	private touchSpawnHazardMarginAt(centerX: number, spawnY: number): number {
		const sprite = this.player.sprite;
		const prevX = sprite.x;
		const prevY = sprite.y;
		sprite.setPosition(centerX, spawnY);
		const body = sprite.body as Phaser.Physics.Arcade.Body | null;
		body?.updateFromGameObject();
		const b = sprite.getBounds();
		sprite.setPosition(prevX, prevY);
		body?.updateFromGameObject();
		const hazards = hazardIntervalsForLevel(
			this.levelManager.current,
			spawnY,
		);
		return clearanceToHazards(
			{ left: b.left, right: b.right },
			hazards,
		);
	}

	private touchSpawnOverlapsButtonsAt(
		centerX: number,
		spawnY: number,
		buttons: ButtonRect[],
	): boolean {
		const sprite = this.player.sprite;
		const prevX = sprite.x;
		const prevY = sprite.y;
		sprite.setPosition(centerX, spawnY);
		const body = sprite.body as Phaser.Physics.Arcade.Body | null;
		body?.updateFromGameObject();
		const b = sprite.getBounds();
		sprite.setPosition(prevX, prevY);
		body?.updateFromGameObject();
		const playerRect = {
			left: b.left,
			right: b.right,
			top: b.top,
			bottom: b.bottom,
		};
		return buttons.some(
			(btn) =>
				playerRect.left < btn.right - 0.5 &&
				playerRect.right > btn.left + 0.5 &&
				playerRect.top < btn.bottom &&
				playerRect.bottom > btn.top,
		);
	}

	private touchSpawnBlockedAt(x: number, y: number): boolean {
		const prevX = this.player.sprite.x;
		const prevY = this.player.sprite.y;
		this.player.sprite.setPosition(x, y);
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
		body.updateFromGameObject();
		let blocked = false;
		const playerBounds = this.player.sprite.getBounds();
		const footTop = playerBounds.bottom - Math.min(32, playerBounds.height * 0.35);
		for (const child of this.levelManager.platforms.getChildren()) {
			const platBody = (child as Phaser.GameObjects.GameObject).body as
				| Phaser.Physics.Arcade.StaticBody
				| undefined;
			if (!platBody || platBody.width >= 1800) continue;
			if (
				playerBounds.right > platBody.left &&
				playerBounds.left < platBody.right &&
				playerBounds.bottom > platBody.top &&
				footTop < platBody.bottom
			) {
				blocked = true;
				break;
			}
		}
		this.player.sprite.setPosition(prevX, prevY);
		body.updateFromGameObject();
		return blocked;
	}

	refreshTouchSpawnLayout(): void {
		if (!this.touchControls?.visible) return;
		this.touchControls.resetLayoutScale();
		this.touchControls.relayout();
	}

	private touchSpawnSearchMaxX(spriteHalfW: number): number {
		const start = this.levelManager.current.start;
		const clusterMin = this.touchControls!.getMinSpawnX(spriteHalfW);
		const maxDelta = Math.max(
			72,
			clusterMin - start.x,
			clusterMin + 72 - start.x,
		);
		const boundMax = Math.min(
			WIDTH - spriteHalfW,
			Math.max(start.x + maxDelta, clusterMin + 72),
		);
		return Math.min(boundMax, this.touchSpawnHazardMaxCenterX(spriteHalfW, start.y));
	}

	private touchSpawnHazardMaxCenterX(
		spriteHalfW: number,
		spawnY: number,
	): number {
		let maxX = WIDTH - spriteHalfW;
		for (const h of hazardIntervalsForLevel(
			this.levelManager.current,
			spawnY,
		)) {
			const capped = h.left - TOUCH_HAZARD_MARGIN_PX - spriteHalfW;
			maxX = Math.min(maxX, capped);
		}
		return maxX;
	}

	/** Match QA spawn hazard readout (getBounds + floor ≥ 96px). */
	private touchSpawnMeetsQaHazardMargin(centerX: number, spawnY: number): boolean {
		return (
			Math.floor(this.touchSpawnHazardMarginAt(centerX, spawnY)) >=
			TOUCH_HAZARD_MARGIN_PX
		);
	}

	private snapTouchSpawnForQaHazardMargin(
		pos: { x: number; y: number },
		clusterMin: number,
	): { x: number; y: number } {
		const start = this.levelManager.current.start;
		for (let tx = Math.round(pos.x); tx >= clusterMin; tx -= 2) {
			if (this.touchSpawnMeetsQaHazardMargin(tx, start.y)) {
				return { x: tx, y: start.y };
			}
		}
		return pos;
	}

	private pickTouchSpawnAtCurrentLayout(): { x: number; y: number } | null {
		const start = this.levelManager.current.start;
		if (!this.touchControls?.visible || !this.player?.sprite?.body) {
			return null;
		}
		const ledgeBlocked = (tx: number) =>
			this.touchSpawnBlockedAt(tx, start.y);
		const sprB = this.player.sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const clusterMin = this.touchControls.getMinSpawnX(spriteHalfW);
		const maxX = this.touchSpawnSearchMaxX(spriteHalfW);
		if (maxX < clusterMin) {
			return null;
		}
		const buttons = this.touchGameplayButtons();
		for (let tx = clusterMin; tx <= maxX; tx += 2) {
			if (ledgeBlocked(tx)) continue;
			if (!this.touchSpawnMeetsQaHazardMargin(tx, start.y)) continue;
			if (this.touchSpawnOverlapsButtonsAt(tx, start.y, buttons)) {
				continue;
			}
			return this.snapTouchSpawnForQaHazardMargin(
				{ x: Math.round(tx), y: start.y },
				clusterMin,
			);
		}
		return null;
	}

	private touchSpawnFallbackPosition(): { x: number; y: number } {
		const start = this.levelManager.current.start;
		const sprB = this.player.sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const clusterMin = this.touchControls!.getMinSpawnX(spriteHalfW);
		const maxX = this.touchSpawnSearchMaxX(spriteHalfW);
		const ledgeBlocked = (tx: number) =>
			this.touchSpawnBlockedAt(tx, start.y);
		const buttons = this.touchGameplayButtons();
		if (maxX < clusterMin) {
			if (
				!ledgeBlocked(maxX) &&
				this.touchSpawnMeetsQaHazardMargin(maxX, start.y) &&
				!this.touchSpawnOverlapsButtonsAt(maxX, start.y, buttons)
			) {
				return { x: Math.round(maxX), y: start.y };
			}
			return { x: start.x, y: start.y };
		}
		for (let tx = clusterMin; tx <= maxX; tx += 2) {
			if (ledgeBlocked(tx)) continue;
			if (!this.touchSpawnMeetsQaHazardMargin(tx, start.y)) continue;
			if (this.touchSpawnOverlapsButtonsAt(tx, start.y, buttons)) {
				continue;
			}
			return this.snapTouchSpawnForQaHazardMargin(
				{ x: Math.round(tx), y: start.y },
				clusterMin,
			);
		}
		return { x: start.x, y: start.y };
	}

	resolveTouchSpawnPlacement(): { x: number; y: number } {
		const start = this.levelManager.current.start;
		if (!this.touchControls?.visible) {
			return { x: start.x, y: start.y };
		}
		if (!this.player?.sprite?.body) {
			return { x: start.x, y: start.y };
		}
		this.refreshTouchSpawnLayout();
		for (let attempt = 0; attempt < 36; attempt++) {
			const pos = this.pickTouchSpawnAtCurrentLayout();
			if (pos) {
				return this.finalizeTouchSpawnPlacement(pos);
			}
			if (!this.touchControls.shrinkLayoutStep()) {
				break;
			}
			this.touchControls.relayout();
		}
		const pos = this.pickTouchSpawnAtCurrentLayout();
		if (pos) {
			return this.finalizeTouchSpawnPlacement(pos);
		}
		return this.finalizeTouchSpawnPlacement(this.touchSpawnFallbackPosition());
	}

	private finalizeTouchSpawnPlacement(pos: { x: number; y: number }): {
		x: number;
		y: number;
	} {
		const start = this.levelManager.current.start;
		const sprB = this.player.sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const clusterMin = this.touchControls!.getMinSpawnX(spriteHalfW);
		const snapped = this.snapTouchSpawnForQaHazardMargin(pos, clusterMin);
		this.player.sprite.setPosition(snapped.x, snapped.y);
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
		body.updateFromGameObject();
		let out = snapped;
		for (let pass = 0; pass < 8; pass++) {
			if (this.touchSpawnMeetsQaHazardMargin(out.x, start.y)) {
				return out;
			}
			const nextX = out.x - 2;
			if (nextX < clusterMin) {
				break;
			}
			out = { x: nextX, y: start.y };
			this.player.sprite.setPosition(out.x, out.y);
			body.updateFromGameObject();
		}
		if (!this.touchSpawnMeetsQaHazardMargin(out.x, start.y)) {
			return { x: start.x, y: start.y };
		}
		return out;
	}

	/** Read-only: expected spawn at the current touch layout (no shrink / relayout). */
	touchSpawnPosition(): { x: number; y: number } {
		const start = this.levelManager.current.start;
		if (!this.player?.sprite?.body || !this.touchControls) {
			return { x: start.x, y: start.y };
		}
		if (!isTouchDevice(this)) {
			return { x: start.x, y: start.y };
		}
		if (!this.touchControls.visible) {
			return (
				this.pickTouchSpawnAtCurrentLayout() ??
				this.touchSpawnFallbackPosition()
			);
		}
		return (
			this.pickTouchSpawnAtCurrentLayout() ??
			this.touchSpawnFallbackPosition()
		);
	}

	resetPlayer() {
		if (!this.player) return;
		this.clearLevelInstruction();
		this.clearColliders();
		const spawnPos = this.resolveTouchSpawnPlacement();
		this.player.revive(spawnPos.x, spawnPos.y);
		this.setupLevelColliders();
		this.syncPortraitBlockerPause();
	}

	private touchLivesFontSize(): string {
		if (!isTouchDevice(this)) return '40px';
		if (this.scale.displaySize.width <= 568) {
			return touchFontSizeStyle(this, 24);
		}
		return '40px';
	}

	createLivesHud() {
		this.livesText?.destroy();
		const chrome = isTouchDevice(this) ? touchChromeMetrics(this) : null;
		const livesX = chrome ? chrome.livesTextX : 24;
		const livesY = chrome ? chrome.livesTextY : 58;
		this.livesText = this.add
			.text(livesX, livesY, this.livesLabel(), {
				fontFamily: 'Pixelify Sans',
				fontSize: this.touchLivesFontSize(),
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

	setGameplayHudVisible(visible: boolean) {
		this.levelManager.setHudVisible(visible);
		this.livesText?.setVisible(visible);
	}

	private clampPlayerToWorldSides = () => {
		if (!this.player?.sprite?.body || this.player.isDead || this.isPaused) {
			return;
		}
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
		this.player.clampHorizontalWorldBounds(body);
	};

	handleDisplayResize(): void {
		const portraitBlockerWasActive = this.portraitBlockerPauseActive;
		this.touchControls?.relayout();
		this.relayoutTouchChromeHud();
		this.relayoutLevelInstructionIfVisible();
		const leavingPortrait =
			this.touchControls?.visible &&
			portraitBlockerWasActive &&
			!isPortraitBlockerActive();
		if (leavingPortrait) {
			this.pendingTouchLandscapeSpawn = true;
		}
		this.syncPortraitBlockerPause();
		if (
			leavingPortrait &&
			this.recentDeathNeedsLandscapeSpawnSync &&
			!this.touchResizePreservesPlayerProgress()
		) {
			this.recentDeathNeedsLandscapeSpawnSync = false;
			this.requestTouchSpawnLandscapeSync();
		} else {
			this.syncTouchLandscapeSpawnIfNeeded();
		}
		if (!this.isResetting && !this.player?.isDead) {
			this.repositionTouchSpawnIfOverlappingButtons();
			this.schedulePushClearOfTouchButtons();
		}
	}

	private touchResizePreservesPlayerProgress(): boolean {
		const start = this.levelManager.current.start;
		const px = this.player?.sprite?.x ?? start.x;
		return px > start.x + 500 && px > 800;
	}

	private playerOverlapsTouchGameplayButtons(): boolean {
		if (!this.touchControls?.visible || !this.player?.sprite?.body) {
			return false;
		}
		const buttons = this.touchGameplayButtons();
		if (buttons.length === 0) return false;
		const sprite = this.player.sprite;
		const sprB = sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const spriteHalfH = (sprB.bottom - sprB.top) / 2;
		return spriteOverlapsButtons(
			sprite.x,
			sprite.y,
			spriteHalfW,
			spriteHalfH,
			buttons,
		);
	}

	private repositionTouchSpawnIfOverlappingButtons(): void {
		if (!this.touchControls?.visible || !this.player?.sprite?.body) return;
		if (this.touchResizePreservesPlayerProgress()) return;
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
		const buttons = this.touchGameplayButtons();
		if (buttons.length === 0) return;
		const sprite = this.player.sprite;
		const sprB = sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const spriteHalfH = (sprB.bottom - sprB.top) / 2;
		const playerY = sprite.y;
		if (
			!spriteOverlapsButtons(
				sprite.x,
				playerY,
				spriteHalfW,
				spriteHalfH,
				buttons,
			)
		) {
			return;
		}
		const pos = this.resolveTouchSpawnPlacement();
		this.player.sprite.setPosition(pos.x, pos.y);
		body.updateFromGameObject();
	}

	private schedulePushClearOfTouchButtons(): void {
		const generation = ++this.resizePushGeneration;
		this.resizePushTimer?.remove(false);
		this.resizePushTimer = this.time.delayedCall(280, () => {
			if (generation !== this.resizePushGeneration) return;
			this.pushPlayerClearOfTouchButtons();
		});
	}

	private pushPlayerClearOfTouchButtons(): void {
		if (!this.touchControls?.visible || !this.player?.sprite?.body) return;
		if (this.player.isDead || this.isResetting) return;
		if (this.touchResizePreservesPlayerProgress()) return;
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
		const buttons = this.touchGameplayButtons();
		if (buttons.length === 0) return;

		const sprite = this.player.sprite;
		const sprB = sprite.getBounds();
		const spriteHalfW = (sprB.right - sprB.left) / 2;
		const spriteHalfH = (sprB.bottom - sprB.top) / 2;
		const playerY = sprite.y;
		const startX = sprite.x;

		if (
			!spriteOverlapsButtons(
				startX,
				playerY,
				spriteHalfW,
				spriteHalfH,
				buttons,
			)
		) {
			return;
		}

		const pos = this.resolveTouchSpawnPlacement();
		this.player.sprite.setPosition(pos.x, pos.y);
		body.updateFromGameObject();
	}

	private relayoutLevelInstructionIfVisible(): void {
		if (!this.instructionPanel?.active || !this.instructionText?.active) {
			return;
		}
		const panelY = isTouchDevice(this)
			? touchInstructionPanelCenterY(this)
			: PLAY_HUD_CLEARANCE_Y + 110;
		const panelW = this.cameras.main.width - 120;
		this.instructionPanel.setPosition(
			this.cameras.main.width / 2,
			panelY,
		);
		this.instructionPanel.width = panelW;
		this.instructionText.setPosition(
			this.cameras.main.width / 2,
			panelY,
		);
		this.instructionText.setWordWrapWidth(this.cameras.main.width - 200);
	}

	private relayoutTouchChromeHud(): void {
		if (!isTouchDevice(this)) return;
		const chrome = touchChromeMetrics(this);
		if (this.livesText?.active) {
			this.livesText.setPosition(chrome.livesTextX, chrome.livesTextY);
			this.livesText.setFontSize(this.touchLivesFontSize());
		}
		this.levelManager.relayoutTouchHudTitle(chrome);
	}

	private gameplayTimeScale = 1;

	private setGameplayClockPaused(paused: boolean): void {
		if (paused) {
			if (this.time.timeScale > 0) {
				this.gameplayTimeScale = this.time.timeScale;
			}
			this.time.timeScale = 0;
			this.time.paused = true;
			this.tweens.pauseAll();
			this.levelManager.setFireballTimersPaused(true);
			return;
		}
		this.time.paused = false;
		this.time.timeScale = this.gameplayTimeScale;
		this.tweens.resumeAll();
		if (!this.isResetting) {
			this.levelManager.setFireballTimersPaused(false);
		}
	}

	syncPortraitBlockerPause(): void {
		if (!isTouchDevice(this)) return;
		const world = this.physics?.world;
		if (!world) return;
		if (isPortraitBlockerActive()) {
			if (this.pausePanel) return;
			if (this.isResetting || this.deathSequence?.isEscBlocked()) {
				return;
			}
			this.portraitBlockerPauseActive = true;
			this.isPaused = true;
			if (!world.isPaused) {
				this.physics.pause();
			}
			this.setGameplayClockPaused(true);
			return;
		}
		if (this.pausePanel) {
			return;
		}
		const wasPortraitPause = this.portraitBlockerPauseActive;
		this.portraitBlockerPauseActive = false;
		const deathOrReset =
			this.isResetting ||
			this.player?.isDead ||
			this.deathSequence?.isEscBlocked();
		const canResumeGameplay =
			!this.pausePanel && !deathOrReset;
		if (
			canResumeGameplay &&
			(wasPortraitPause || this.isPaused || world.isPaused)
		) {
			this.isPaused = false;
			if (world.isPaused) {
				this.physics.resume();
			}
			if (this.time.paused || this.time.timeScale === 0) {
				this.setGameplayClockPaused(false);
			}
			if (this.player && !this.player.isDead) {
				this.player.controlsEnabled = true;
			}
		}
		this.syncTouchLandscapeSpawnIfNeeded();
	}

	/** QA / portrait return: snap player to touch spawn when layout changed. */
	requestTouchSpawnLandscapeSync(): void {
		this.pendingTouchLandscapeSpawn = true;
		this.syncTouchLandscapeSpawnIfNeeded(true);
	}

	private syncTouchLandscapeSpawnIfNeeded(forceSpawn = false): void {
		if (!this.pendingTouchLandscapeSpawn || !this.player?.sprite?.body) {
			return;
		}
		if (this.player.isDead || isPortraitBlockerActive()) {
			return;
		}
		this.pendingTouchLandscapeSpawn = false;
		this.touchControls?.relayout();
		if (this.touchResizePreservesPlayerProgress()) {
			return;
		}
		if (!forceSpawn && !this.playerOverlapsTouchGameplayButtons()) {
			return;
		}
		const spawn = this.resolveTouchSpawnPlacement();
		this.player.setPosition(spawn.x, spawn.y);
		const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
		body.updateFromGameObject();
	}

	requestPause() {
		if (this.pausePanel) {
			this.closePause();
			return;
		}
		if (this.deathSequence?.isEscBlocked()) return;
		if (this.isResetting) return;
		if (this.player?.isDead) return;
		this.togglePause();
	}

	private stackPauseMenuButton(
		cx: number,
		belowBottom: number,
		label: string,
		gap: number,
		onTap: () => void,
	): { btn: Phaser.GameObjects.Text; bottom: number } {
		const btn = this.add
			.text(cx, belowBottom + gap, label, {
				fontFamily: 'Pixelify Sans',
				fontSize: '44px',
				color: PALETTE_HEX.cloudWhite,
				backgroundColor: PALETTE_HEX.deep,
				padding: { x: 28, y: 14 },
			})
			.setOrigin(0.5, 0)
			.setInteractive({ useHandCursor: true });
		btn.on('pointerdown', onTap);
		const b = btn.getBounds();
		return { btn, bottom: b.bottom };
	}

	togglePause() {
		this.portraitBlockerPauseActive = false;
		this.isPaused = true;
		this.physics.pause();
		this.setGameplayClockPaused(true);
		this.pausePanel = this.add.container(0, 0).setDepth(250);
		const cx = this.cameras.main.width / 2;
		const cy = this.cameras.main.height / 2;
		const displayScale = Math.min(
			this.scale.displaySize.width / 1920,
			this.scale.displaySize.height / 1080,
		);
		const gap = Math.max(16, Math.ceil(10 / displayScale));
		const bg = this.add
			.rectangle(
				cx,
				cy,
				this.cameras.main.width,
				this.cameras.main.height,
				0x0b1a2e,
				0.75,
			)
			.setInteractive();
		const title = this.add
			.text(cx, cy - 200, 'Paused', {
				fontFamily: 'Pixelify Sans',
				fontSize: '72px',
				color: '#ffdd00',
			})
			.setOrigin(0.5, 0);
		let cursorBottom = title.getBounds().bottom;
		const resume = this.stackPauseMenuButton(cx, cursorBottom, 'Resume', gap, () =>
			this.closePause(),
		);
		cursorBottom = resume.bottom;
		const pauseChildren: Phaser.GameObjects.GameObject[] = [
			bg,
			title,
			resume.btn,
		];
		if (isTouchDevice(this)) {
			const restart = this.stackPauseMenuButton(
				cx,
				cursorBottom,
				'Restart level',
				gap,
				() => {
					this.closePause();
					if (!this.isResetting) {
						this.killPlayer('fall', { fast: true, spendLife: false });
					}
				},
			);
			cursorBottom = restart.bottom;
			pauseChildren.push(restart.btn);
		}
		const quit = this.stackPauseMenuButton(cx, cursorBottom, 'Quit to menu', gap, () => {
			this.closePause();
			this.sound.stopAll();
			this.scene.start('Menu');
		});
		cursorBottom = quit.bottom;
		pauseChildren.push(quit.btn);
		if (!isTouchDevice(this)) {
			const hint = this.add
				.text(cx, cursorBottom + gap, 'Esc: Resume   |   Q: Quit to menu', {
					fontFamily: 'Pixelify Sans',
					fontSize: '32px',
					color: '#fdfdfe',
				})
				.setOrigin(0.5, 0);
			pauseChildren.push(hint);
		}
		this.pausePanel.add(pauseChildren);
		this.pauseQuitKey = this.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.Q,
		);
		this.pauseQuitKey?.once('down', () => {
			if (!this.isPaused) return;
			this.closePause();
			this.sound.stopAll();
			this.scene.start('Menu');
		});
	}

	closePause() {
		this.pauseQuitKey?.removeAllListeners();
		this.pauseQuitKey = undefined;
		this.pausePanel?.destroy();
		this.pausePanel = undefined;
		this.isPaused = false;
		this.physics.resume();
		this.setGameplayClockPaused(false);
		this.syncPortraitBlockerPause();
	}

	showLevelInstruction() {
		this.clearLevelInstruction();
		const lvl = this.levelManager.current;
		const instruction = sanitizePixelFont(
			lvl.instruction ?? 'Reach the portal.',
		);

		const panelY = isTouchDevice(this)
			? touchInstructionPanelCenterY(this)
			: PLAY_HUD_CLEARANCE_Y + 110;
		this.instructionPanel = this.add
			.rectangle(
				this.cameras.main.width / 2,
				panelY,
				this.cameras.main.width - 120,
				120,
				0x0b1a2e,
				0.75,
			)
			.setDepth(30);

		this.instructionText = this.add
			.text(this.cameras.main.width / 2, panelY, instruction, {
				fontFamily: 'Pixelify Sans',
				fontSize: touchFontSizeStyle(this, 48),
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
			.setDepth(31);

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
		this.setGameplayHudVisible(false);
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

		const boxSize = 280;
		const spacing = 40;
		const cols = 3;
		const downgradeable = abilityData.filter((data) => {
			const currentValue = this.abilityManager.abilities[data.key];
			if (
				data.key === 'jumpLevel' &&
				typeof currentValue === 'number' &&
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
			this.setGameplayHudVisible(true);
			const hasNext = this.levelManager.next();
			if (!hasNext) {
				this.showWinScreen();
			} else {
				this.resetPlayer();
				this.playBattleMusic();
				this.showLevelInstruction();
				this.endLevelTransitionReset();
				this.syncPortraitBlockerPause();
			}
			return;
		}

		const rows = Math.ceil(downgradeable.length / cols);
		const canvasH = this.cameras.main.height;
		const titleBottom = 130;
		const helperBand = 56;
		const maxGridBottom = canvasH - helperBand;
		let rowHeight = 360;
		let gridH = rows * rowHeight + (rows - 1) * spacing;
		const available = maxGridBottom - titleBottom;
		if (gridH > available) {
			rowHeight = Math.max(
				boxSize,
				Math.floor((available - (rows - 1) * spacing) / rows),
			);
			gridH = rows * rowHeight + (rows - 1) * spacing;
		}
		const startY = titleBottom + rowHeight / 2;
		const lastRowCenterY = startY + (rows - 1) * (rowHeight + spacing);
		const helperY = lastRowCenterY + rowHeight / 2 + 32;

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
				rowHeight,
			);

			const cardW = boxSize;
			const textW = cardW - 24;
			const myth = ABILITY_MYTH_NAME[data.key];
			const stateLine = sanitizePixelFont(
				abilityStateLine(data.key, this.abilityManager.abilities),
			);
			const lossLine = sanitizePixelFont(ABILITY_LOSS_LINE[data.key]);

			const mythText = this.add
				.text(0, 0, sanitizePixelFont(myth), {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 36),
					color: ABILITY_CARD_INK_HEX,
					align: 'center',
					wordWrap: { width: textW },
				})
				.setVisible(false);
			const stateText = this.add
				.text(0, 0, stateLine, {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 30),
					color: ABILITY_CARD_INK_HEX,
					align: 'center',
					wordWrap: { width: textW },
				})
				.setVisible(false);
			const lossText = this.add
				.text(0, 0, lossLine, {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 30),
					color: ABILITY_LOSS_EFFECT_HEX,
					align: 'center',
					wordWrap: { width: textW },
				})
				.setVisible(false);

			const iconSpace = 88;
			const lineGap = 10;
			const padBottom = 16;
			const mythH = mythText.height;
			const stateH = stateText.height;
			const contentH =
				iconSpace +
				mythH +
				lineGap +
				stateH +
				lineGap +
				lossText.height +
				padBottom;
			const cardH = Math.min(rowHeight, Math.max(boxSize, contentH));
			const cardTop = y - cardH / 2;

			mythText.destroy();
			stateText.destroy();
			lossText.destroy();

			const button = this.add
				.rectangle(x, y, cardW, cardH, ABILITY_CARD_FILL)
				.setDepth(21)
				.setInteractive()
				.setData('abilityKey', data.key)
				.on('pointerover', () => {
					selectedIndex = buttons.indexOf(button);
					updateSelection();
				})
				.on('pointerdown', () => {
					selectedIndex = buttons.indexOf(button);
					selectAbility();
				});

			styleAbilityCard(button, false);
			buttons.push(button);

			addAbilityIcon(this, x, cardTop, cardH, data.icon);

			let textY = cardTop + iconSpace;
			this.add
				.text(x, textY, sanitizePixelFont(myth), {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 36),
					color: ABILITY_CARD_INK_HEX,
					align: 'center',
					wordWrap: { width: textW },
				})
				.setOrigin(0.5, 0)
				.setDepth(22);
			textY += mythH + lineGap;
			const stateRendered = this.add
				.text(x, textY, stateLine, {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 30),
					color: ABILITY_CARD_INK_HEX,
					align: 'center',
					wordWrap: { width: textW },
				})
				.setOrigin(0.5, 0)
				.setDepth(22);
			textY += stateRendered.height + lineGap;
			this.add
				.text(x, textY, lossLine, {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 30),
					color: ABILITY_LOSS_EFFECT_HEX,
					align: 'center',
					wordWrap: { width: textW },
				})
				.setOrigin(0.5, 0)
				.setDepth(22);
		});

		this.add
			.text(
				this.cameras.main.width / 2,
				helperY,
				sanitizePixelFont(
					'Choose what you give up. Arrow keys and Enter, or tap.',
				),
				{
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 32),
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
				let next = currentValue - 1;
				if (abilityKey === 'jumpLevel') {
					next = Math.max(2, next);
				}
				this.abilityManager.abilities[abilityKey] = next as never;
			} else {
				this.abilityManager.abilities[abilityKey] = false as never;
			}
			this.giftsLost += 1;

			this.player.controlsEnabled = true;
			this.touchControls?.setGameplayVisible(true);
			this.setGameplayHudVisible(true);
			this.touchControls?.relayout();
			this.relayoutTouchChromeHud();

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
				this.endLevelTransitionReset();
				this.syncPortraitBlockerPause();
				this.handleDisplayResize();
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

		if (
			isDebugPlayEnabled() &&
			!window.__icarusHoldAbilityCards &&
			buttons.length > 0
		) {
			this.time.delayedCall(80, () => selectAbility());
		}
	}
	showAbilityGainScreen() {
		this.clearLevelInstruction();
		this.setGameplayHudVisible(false);
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
				this.endLevelTransitionReset();
				this.syncPortraitBlockerPause();
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

		let boxSize = 280;
		const spacing = 40;
		const cols = Math.min(3, upgradeableAbilities.length);
		const rows = Math.ceil(upgradeableAbilities.length / cols);
		const chromeMetrics = touchChromeMetrics(this);
		const footerReserve = chromeMetrics.chromeH + 150;
		const titleBottom = 130;
		const maxGridBottom = this.cameras.main.height - footerReserve;
		let gridH = rows * boxSize + (rows - 1) * spacing;
		const available = maxGridBottom - titleBottom;
		if (gridH > available) {
			boxSize = Math.max(
				200,
				Math.floor((available - (rows - 1) * spacing) / rows),
			);
			gridH = rows * boxSize + (rows - 1) * spacing;
		}
		const startY = titleBottom + boxSize / 2;

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
					selectedIndex = buttons.indexOf(button);
					if (button.getData('selected')) return;
					if (selectedAbilities >= maxSelections) return;
					selectAbility();
				});

			styleAbilityCard(button, false);
			buttons.push(button);

			addAbilityIcon(this, x, y - boxSize / 2, boxSize, data.icon);

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
						fontSize: touchFontSizeStyle(this, 28),
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

		const gainPickLine =
			maxSelections === 1
				? 'Choose 1 to take back.'
				: `Choose up to ${maxSelections} to take back.`;
		let gainHelperText = `${gainPickLine} Tap a card, or use the arrows and Enter.`;
		if (!isTouchDevice(this)) {
			gainHelperText += ' Shift+Enter when done.';
		}

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
			if (selectedAbilities >= 1) {
				showDoneButton();
			}

			const cardTop = button.y - boxSize / 2;
			const iconArea = Math.min(
				ABILITY_ICON_MAX,
				Math.max(48, boxSize * 0.2),
			);
			const returnedY = cardTop + 12 + iconArea + 24;
			this.add
				.text(button.x, returnedY, 'Returned', {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 28),
					color: ABILITY_CARD_INK_HEX,
				})
				.setOrigin(0.5, 0)
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
			this.setGameplayHudVisible(true);
			this.input.keyboard?.off('keydown', keyHandler);
			bg.destroy();
			title.destroy();
			this.children.list
				.filter((child) => {
					const depth = (
						child as Phaser.GameObjects.GameObject & { depth: number }
					).depth;
					return depth >= 21 && depth <= 24;
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
				this.endLevelTransitionReset();
				this.syncPortraitBlockerPause();
			}
		};

		const lastRowCenterY = startY + (rows - 1) * (boxSize + spacing);
		const helperY = lastRowCenterY + boxSize / 2 + 32;
		const helperTextObj = this.add
			.text(
				this.cameras.main.width / 2,
				helperY,
				sanitizePixelFont(gainHelperText),
				{
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 32),
					color: PALETTE_HEX.cardHelper,
					align: 'center',
					wordWrap: { width: this.cameras.main.width - 120 },
				},
			)
			.setOrigin(0.5)
			.setDepth(21)
			.setName('gain-helper');

		let doneButtonBg: Phaser.GameObjects.Rectangle | undefined;
		let doneButtonLabel: Phaser.GameObjects.Text | undefined;
		const showDoneButton = () => {
			if (doneButtonBg?.active) return;
			const helperBottom = helperTextObj.y + helperTextObj.displayHeight / 2;
			const chrome = touchChromeMetrics(this);
			const doneH = chrome.chromeH;
			const doneW = Math.max(chrome.chromeW, 160);
			const doneY = helperBottom + 28 + doneH / 2;
			const cx = this.cameras.main.width / 2;
			const onDone = () => {
				if (selectedAbilities >= 1) {
					finishGain();
				}
			};
			doneButtonBg = this.add
				.rectangle(cx, doneY, doneW, doneH, PALETTE.deep, 0.95)
				.setStrokeStyle(2, PALETTE.cloudWhite, 0.35)
				.setDepth(23)
				.setInteractive({ useHandCursor: true });
			doneButtonLabel = this.add
				.text(cx, doneY, 'Done', {
					fontFamily: 'Pixelify Sans',
					fontSize: touchFontSizeStyle(this, 40),
					color: PALETTE_HEX.cloudWhite,
					align: 'center',
				})
				.setOrigin(0.5)
				.setDepth(24);
			doneButtonBg.on('pointerdown', onDone);
			doneButtonLabel.setInteractive({ useHandCursor: true });
			doneButtonLabel.on('pointerdown', onDone);
		};

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

		if (
			isDebugPlayEnabled() &&
			!window.__icarusHoldAbilityCards &&
			buttons.length > 0
		) {
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
