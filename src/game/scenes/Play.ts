import { Scene } from 'phaser';
import { BackgroundManager } from '../Background';
import LevelManager from '../levels/LevelManager';
import { Player } from '../Player';

export class Play extends Scene {
  backgroundManager: BackgroundManager;
  levelManager: LevelManager;
  player: Player | undefined;
  infoText: Phaser.GameObjects.Text | undefined;
  infoBackground: Phaser.GameObjects.Rectangle | undefined;
  deathCount = 0;
  deathText: Phaser.GameObjects.Text | undefined;
  isResetting = false;
  winText: Phaser.GameObjects.Text | undefined;
  winBackground: Phaser.GameObjects.Rectangle | undefined;

  constructor() {
    super('Play');
  }

  create() {
    this.backgroundManager = new BackgroundManager(this, { icarus: false });

    // Reset death counter
    this.deathCount = 0;
    this.isResetting = false;

    // create level manager and render first level
    this.levelManager = new LevelManager(this);
    this.levelManager.goto(0);

    // Create player at the level's start position
    const startPos = this.levelManager.current.start;
    this.player = new Player(this, startPos.x, startPos.y);

    // Setup collisions between player and platforms
    this.setupCollisions();

    // Death counter display
    this.deathText = this.add
      .text(this.cameras.main.width - 16, 70, `💀 Deaths: ${this.deathCount}`, {
        fontFamily: 'Pixelify Sans',
        fontSize: '20px',
        color: '#ff4444',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(1, 0)
      .setDepth(12);

    // info background panel (semi-transparent dark background)
    this.infoBackground = this.add
      .rectangle(0, this.cameras.main.height, 450, 140, 0x000000, 0.75)
      .setOrigin(0, 1)
      .setDepth(11);

    // info text: abilities placeholder and controls
    this.infoText = this.add
      .text(16, this.cameras.main.height - 130, '', {
        fontFamily: 'Pixelify Sans',
        fontSize: '16px',
        color: '#ffffff',
        lineSpacing: 4,
      })
      .setDepth(12);

    this.updateInfoText();

    // keyboard controls to navigate levels for now
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => {
      switch (ev.key.toLowerCase()) {
        case 'n': // skip level (cheat)
          if (!this.isResetting) {
            const hasNext = this.levelManager.next();
            if (!hasNext) {
              this.showWinScreen();
            } else {
              this.updateInfoText();
              this.resetPlayer();
            }
          }
          break;
        case 'escape': // return to menu
          this.scene.start('Menu');
          break;
      }
    });
  }

  update() {
    // Update player
    this.player?.update();

    // Check for hazard collisions
    this.checkHazardCollisions();

    // Check for goal completion
    this.checkGoalReached();

    // Check if player fell off the world
    if (this.player && this.player.sprite.y > this.cameras.main.height + 100) {
      this.killPlayer();
    }
  }

  checkHazardCollisions() {
    if (!this.player || this.player.isDead || this.isResetting) return;

    const playerBounds = this.player.sprite.getBounds();

    this.levelManager.hazards.getChildren().forEach((hazard) => {
      const hazardObj = hazard as Phaser.GameObjects.Rectangle | Phaser.GameObjects.Triangle;
      const hazardBounds = hazardObj.getBounds();

      if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, hazardBounds)) {
        this.killPlayer();
      }
    });
  }

  checkGoalReached() {
    if (!this.player || this.player.isDead || this.isResetting || !this.levelManager.portal) return;

    const playerBounds = this.player.sprite.getBounds();
    const portalBounds = this.levelManager.portal.getBounds();

    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, portalBounds)) {
      this.completeLevel();
    }
  }

  killPlayer() {
    if (!this.player || this.player.isDead || this.isResetting) return;

    this.player.die();
    this.deathCount++;
    this.isResetting = true;

    // Update death counter
    if (this.deathText) {
      this.deathText.setText(`💀 Deaths: ${this.deathCount}`);
    }

    // Flash screen red
    this.cameras.main.flash(300, 255, 0, 0);

    // Reset to level 0 after delay
    this.time.delayedCall(1500, () => {
      // Go back to level 0 on death
      this.levelManager.goto(0);
      this.updateInfoText();
      this.resetPlayer();
      this.isResetting = false;

      // Show message about reset
      const resetMsg = this.add
        .text(
          this.cameras.main.width / 2,
          this.cameras.main.height / 2,
          '💀 YOU DIED! 💀\nRestarting from Level 1...',
          {
            fontFamily: 'Pixelify Sans',
            fontSize: '40px',
            color: '#ff4444',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
          }
        )
        .setOrigin(0.5)
        .setDepth(15);

      // Fade out message
      this.tweens.add({
        targets: resetMsg,
        alpha: 0,
        duration: 1500,
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
        this.updateInfoText();
        this.resetPlayer();
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
        0.9
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
          `Total Deaths: ${this.deathCount}`,
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
        }
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
    const spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    const escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

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
    const platforms = this.levelManager.platforms;
    if (platforms) {
      this.physics.add.collider(this.player.sprite, platforms);
    }
  }

  resetPlayer() {
    if (!this.player) return;
    const startPos = this.levelManager.current.start;
    this.player.revive(startPos.x, startPos.y);
    this.setupCollisions();
  }

  updateInfoText() {
    if (!this.infoText) return;
    const lvl = this.levelManager.current;
    this.infoText.setText([
      `📍 Level ${lvl.id}/15: ${lvl.name}`,
      `   ${lvl.description ?? 'Reach the green zone to complete!'}`,
      '',
      '🎮 Arrow Keys/WASD: Move • Space/W/↑: Jump (2x)',
      '   [N] Skip Level • [ESC] Menu',
      '',
    ]);
  }
}

export default Play;
