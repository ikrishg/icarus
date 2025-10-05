import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';

export class Dead extends Scene {
	backgroundManager: BackgroundManager;
	deadHeadline!: GameObjects.Text;
	deadBody!: GameObjects.Text;
	backdrop!: GameObjects.Rectangle;
	keyHints!: GameObjects.Text;

	constructor() {
		super('Dead');
	}

	create() {
		this.backgroundManager = new BackgroundManager(this);

		this.backdrop = this.add
			.rectangle(0, 0, WIDTH, HEIGHT, 0x000000)
			.setOrigin(0, 0)
			.setAlpha(0.9)
			.setDepth(3);

		const headlineFontSize = 112;
		const bodyFontSize = 52;
		const hintFontSize = 42;

		const headlineY = HEIGHT / 3;
		const bodyY = headlineY + headlineFontSize + 120;
		const hintsY = HEIGHT - 100;

		this.deadHeadline = this.add
			.text(WIDTH / 2, headlineY, '💀 ICARUS HAS FALLEN 💀', {
				font: `${headlineFontSize}px Pixelify Sans`,
				color: '#ff4444',
				align: 'center',
			})
			.setOrigin(0.5)
			.setShadow(6, 6, '#000000', 8)
			.setDepth(4);

		// Add shake animation
		this.tweens.add({
			targets: this.deadHeadline,
			x: { from: WIDTH / 2 - 5, to: WIDTH / 2 + 5 },
			duration: 100,
			yoyo: true,
			repeat: 3,
			ease: 'Linear',
		});

		this.deadBody = this.add
			.text(
				WIDTH / 2,
				bodyY,
				`The sun has claimed another victim.\n\nYou flew too close, and the wax melted.\n\nBut legends are made through perseverance...`,
				{
					font: `${bodyFontSize}px Pixelify Sans`,
					color: '#ffcccc',
					align: 'center',
					lineSpacing: 12,
					wordWrap: { useAdvancedWrap: true, width: WIDTH - 200 },
				},
			)
			.setOrigin(0.5)
			.setDepth(4);

		this.keyHints = this.add
			.text(WIDTH / 2, hintsY, 'Press any key to reload', {
				font: `${hintFontSize}px Pixelify Sans`,
				color: '#cccccc',
				align: 'center',
				lineSpacing: 8,
			})
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

		// Reload browser on any key press or click
		this.input.keyboard?.once('keydown', () => {
			window.location.reload();
		});

		this.input.once('pointerdown', () => {
			window.location.reload();
		});
	}
}
