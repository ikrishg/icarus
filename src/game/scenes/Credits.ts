import { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../../util/constants';

export class Credits extends Scene {
  constructor() {
    super('Credits');
  }

  create() {
    this.add
      .text(
        WIDTH / 2,
        HEIGHT / 2,
        'CREDITS\nMade by Krish Gupta\nAssets: Public Domain',
        {
          font: '36px Pixelify Sans',
          color: '#ffffff',
          align: 'center',
        }
      )
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ESC', () => this.scene.start('Menu'));
    this.input.once('pointerdown', () => this.scene.start('Menu'));
  }
}
