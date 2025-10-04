import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';

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
	arrow: GameObjects.Image;
	menuBackdrop?: GameObjects.Graphics;
	backgroundManager: BackgroundManager;

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
		this.backgroundManager = new BackgroundManager(this);

		this.wordmark = this.add
			.image(WIDTH / 2, HEIGHT / 4, 'wordmark')
			.setDepth(3);

		const startY = HEIGHT / 2;
		const lineHeight = 96;

		const wordmarkBounds = this.wordmark.getBounds();
		this.menuLeft = wordmarkBounds.left;

		this.arrow = this.add
			.image(this.menuLeft, startY, 'arrow')
			.setOrigin(0, 0.5)
			.setDepth(7);

		this.arrow.setDisplaySize(this.selectedSize, this.selectedSize);

		const arrowPadding = 16;

		const menuStartX =
			this.menuLeft +
			(this.arrow.displayWidth ?? this.arrow.width) +
			arrowPadding;

		this.navigation.forEach((item, i) => {
			const menuText = this.add
				.text(menuStartX, startY + i * lineHeight, item.key, {
					fontFamily: 'Pixelify Sans',
					fontSize: `${this.unselectedSize}px`,
					color: '#1b1b1c',
				})
				.setOrigin(0, 0.5)
				.setInteractive({ useHandCursor: true })
				.setDepth(6);

			menuText.on('pointerdown', () => this.activateIndex(i));
			menuText.on('pointerover', () => this.setSelected(i));

			this.menu.push(menuText);
		});

		this.menuBackdrop = this.add.graphics();
		this.menuBackdrop.setDepth(4);

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
			t.setStyle({ color: '#ffffff' });

			if (i === this.selectedIndex) {
				t.setFontSize(this.selectedSize);
			} else {
				t.setFontSize(this.unselectedSize);
			}
		});

		const selected = this.menu[this.selectedIndex];
		if (this.arrow && selected) {
			this.arrow.setPosition(this.menuLeft, selected.y);
			this.arrow.setDisplaySize(this.selectedSize, this.selectedSize);
			this.arrow.setVisible(true);
		}

		this.updateMenuBackdrop();
	}

	updateMenuBackdrop() {
		if (!this.menuBackdrop) return;

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		this.menu.forEach((t) => {
			const b = t.getBounds();
			minX = Math.min(minX, b.left);
			minY = Math.min(minY, b.top);
			maxX = Math.max(maxX, b.right);
			maxY = Math.max(maxY, b.bottom);
		});

		if (this.arrow) {
			const ab = this.arrow.getBounds();
			minX = Math.min(minX, ab.left);
			minY = Math.min(minY, ab.top);
			maxX = Math.max(maxX, ab.right);
			maxY = Math.max(maxY, ab.bottom);
		}

		const paddingX = Math.max(24, Math.floor(this.selectedSize * 0.6));
		const paddingY = Math.max(12, Math.floor(this.selectedSize * 0.35));

		const rectX = Math.max(8, minX - paddingX);
		const rectY = Math.max(8, minY - paddingY);
		const rectW = Math.min(WIDTH - 16, maxX - minX + paddingX * 2);
		const rectH = Math.min(HEIGHT - 16, maxY - minY + paddingY * 2);

		this.menuBackdrop.clear();
		const backdropColor = 0x000000;
		const backdropAlpha = 0.75;
		this.menuBackdrop.fillStyle(backdropColor, backdropAlpha);
		this.menuBackdrop.fillRoundedRect(rectX, rectY, rectW, rectH, 12);
	}

	moveSelection(delta: number) {
		const next =
			(this.selectedIndex + delta + this.menu.length) % this.menu.length;
		this.setSelected(next);
	}

	activateIndex(i: number) {
		const scene = this.navigation[i].scene;

		if (scene) this.scene.switch(scene);
	}
}
