import { type GameObjects, Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../../util/constants';

export class Menu extends Scene {
  background: GameObjects.Image;
  wordmark: GameObjects.Image;
  instruction: GameObjects.Text;
  navigation: Array<{
    key: string;
    scene: string;
  }>;
  menu: GameObjects.Text[] = [];
  selectedIndex = 0;
  arrow: GameObjects.Text;
  // visual sizes and layout
  unselectedSize = 64;
  selectedSize = 80;
  arrowOffset = 0;
  menuLeft = 0;

  constructor() {
    super('Menu');

    this.navigation = [
      { key: 'START GAME', scene: 'Play' },
      { key: 'ABOUT', scene: 'About' },
      { key: 'CREDITS', scene: 'Credits' },
    ];
  }

  create() {
    this.background = this.add
      .image(0, 0, 'background')
      .setOrigin(0)
      .setDisplaySize(WIDTH, HEIGHT);

    this.wordmark = this.add
      .image(WIDTH / 2, HEIGHT / 4, 'wordmark');

    // Layout: left-align the menu text and compute positions from the wordmark bounds
    const startY = HEIGHT / 2;
    const lineHeight = 96;

    // compute the left edge of the wordmark image so arrow's left aligns with it
    const wordmarkBounds = this.wordmark.getBounds();
    this.menuLeft = wordmarkBounds.left;

    // create a persistent arrow indicator whose left edge is exactly the wordmark left
    this.arrow = this.add
      .text(this.menuLeft, startY, '▶', {
        fontFamily: 'Pixelify Sans',
        fontSize: `${this.selectedSize}px`,
        color: '#ffffff',
      })
      // set origin so x is the left edge of the glyph
      .setOrigin(0, 0.5)
      .setDepth(10);

    // measure arrow width and set menu start x accordingly
    const arrowPadding = 16;
    const menuStartX = this.menuLeft + this.arrow.width + arrowPadding;

    this.navigation.forEach((item, i) => {
      const menuText = this.add
        .text(menuStartX, startY + i * lineHeight, item.key, {
          fontFamily: 'Pixelify Sans',
          fontSize: `${this.unselectedSize}px`,
          color: '#1b1b1c',
        })
        // left align each line and vertically center
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true });

      menuText.on('pointerdown', () => this.activateIndex(i));
      menuText.on('pointerover', () => this.setSelected(i));

      this.menu.push(menuText);
    });

    this.setSelected(0);

    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.moveSelection(-1);
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.moveSelection(1);
          break;
        case 'Enter':
        case 'Space':
          this.activateIndex(this.selectedIndex);
          break;
      }
    });
  }


  setSelected(index: number) {
    this.selectedIndex = Phaser.Math.Clamp(index, 0, this.menu.length - 1);
    this.menu.forEach((t, i) => {
      if (i === this.selectedIndex) {
        t.setStyle({ color: '#ffffff' });
        t.setFontSize(this.selectedSize);
      } else {
        t.setStyle({ color: '#1b1b1c' });
        t.setFontSize(this.unselectedSize);
      }
    });

    // position the arrow to the left of the selected item
    const selected = this.menu[this.selectedIndex];
    if (this.arrow && selected) {
      // keep the arrow's left edge aligned with the wordmark left
      this.arrow.setPosition(this.menuLeft, selected.y);
      this.arrow.setFontSize(this.selectedSize);
      this.arrow.setVisible(true);
    }
  }

  moveSelection(delta: number) {
    const next = (this.selectedIndex + delta + this.menu.length) % this.menu.length;
    this.setSelected(next);
  }

  activateIndex(i: number) {
    const scene = this.navigation[i].scene;

    if (scene) this.scene.start(scene);
  }
}
