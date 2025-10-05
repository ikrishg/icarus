import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';

export class Win extends Scene {
  backgroundManager: BackgroundManager;
  winHeadline!: GameObjects.Text;
  winBody!: GameObjects.Text;
  backdrop!: GameObjects.Rectangle;
  keyHints!: GameObjects.Text;
  totalLevels = 0;

  constructor() {
    super('Win');
  }

  init(data: { totalLevels: number }) {
    this.totalLevels = data.totalLevels || 0;
  }

  create() {
    this.backgroundManager = new BackgroundManager(this);

    this.backdrop = this.add
      .rectangle(0, 0, WIDTH, HEIGHT, 0x000000)
      .setOrigin(0, 0)
      .setAlpha(0.85)
      .setDepth(3);

    const headlineFontSize = 128;
    const bodyFontSize = 56;
    const hintFontSize = 42;

    const headlineY = HEIGHT / 3;
    const bodyY = headlineY + headlineFontSize + 120;
    const hintsY = HEIGHT - 100;

    this.winHeadline = this.add
      .text(WIDTH / 2, headlineY, '🎉 VICTORY! 🎉', {
        font: `${headlineFontSize}px Pixelify Sans`,
        color: '#ffdd00',
        align: 'center',
      })
      .setOrigin(0.5)
      .setShadow(6, 6, '#000000', 8)
      .setDepth(4);

    // Add pulsing animation
    this.tweens.add({
      targets: this.winHeadline,
      scale: { from: 0.95, to: 1.05 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.winBody = this.add
      .text(
        WIDTH / 2,
        bodyY,
        `You completed all ${this.totalLevels} levels!\n\nYou have proven yourself worthy of the skies. But did you truly? Because for you flew too close to the sun...`,
        {
          font: `${bodyFontSize}px Pixelify Sans`,
          color: '#ffffff',
          align: 'center',
          lineSpacing: 8,
          wordWrap: { useAdvancedWrap: true, width: WIDTH - 200 },
        },
      )
      .setOrigin(0.5)
      .setDepth(4);

    this.keyHints = this.add
      .text(
        WIDTH / 2,
        hintsY,
        'Press SPACE to play again\nPress ESC to return to menu',
        {
          font: `${hintFontSize}px Pixelify Sans`,
          color: '#cccccc',
          align: 'center',
          lineSpacing: 8,
        },
      )
      .setOrigin(0.5)
      .setAlpha(0.95)
      .setDepth(4);

    // Add blinking animation to hints
    this.tweens.add({
      targets: this.keyHints,
      alpha: { from: 0.6, to: 1 },
      duration: 1000,
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
      spaceKey.on('down', () => {
        this.scene.start('Play');
      });
    }

    if (escKey) {
      escKey.on('down', () => {
        this.scene.start('Menu');
      });
    }

    // Also allow mouse click to go to menu
    this.input.on('pointerdown', () => {
      this.scene.start('Menu');
    });
  }
}
