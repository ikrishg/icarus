import { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../../util/constants';

export class About extends Scene {
  constructor() {
    super('About');
  }

  create() {
    this.add
      .text(WIDTH / 2, HEIGHT / 2, 'ABOUT\nThis is Icarus — a small demo.', {
        font: '36px Pixelify Sans',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ESC', () => this.scene.start('Menu'));
    this.input.once('pointerdown', () => this.scene.start('Menu'));
  }
}
