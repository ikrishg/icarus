import { type GameObjects, Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../../util/constants';

export class Home extends Scene {
  background: GameObjects.Image;
  wordmark: GameObjects.Image;
  instruction: GameObjects.Text;

  constructor() {
    super('Home');
  }

  create() {
    this.background = this.add
      .image(0, 0, 'background')
      .setOrigin(0)
      .setDisplaySize(WIDTH, HEIGHT);

    this.wordmark = this.add
      .image(WIDTH / 2, HEIGHT / 2, 'wordmark')

    this.instruction = this.add
      .text(WIDTH / 2, HEIGHT - 150, 'CLICK OR PRESS ANY KEY TO START', {
        font: '48px Pixelify Sans',
        color: '#1b1b1c',
      })
      .setOrigin(0.5);

    this.input.once('pointerdown', () => {
      this.startGame();
    });

    this.input.keyboard?.once('keydown', () => {
      this.startGame();
    });
  }

  startGame() {
    this.scene.start('Menu');
  }
}
