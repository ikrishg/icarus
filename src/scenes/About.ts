import { type GameObjects, Scene } from 'phaser';
import { BackgroundManager } from '../components/Background';
import { HEIGHT, WIDTH } from '../util/constants';

export class About extends Scene {
	backgroundManager: BackgroundManager;
	creditsHeadline!: GameObjects.Text;
	creditsBody!: GameObjects.Text;
	backdrop!: GameObjects.Rectangle;
	clickHint!: GameObjects.Text;

	constructor() {
		super('About');
	}

	create() {
		this.backgroundManager = new BackgroundManager(this);

		this.backdrop = this.add
			.rectangle(0, 0, WIDTH, HEIGHT, 0x000000)
			.setOrigin(0, 0)
			.setAlpha(0.8)
			.setDepth(3);

		const leftPadding = 64;
		const headlineFontSize = 112;
		const bodyFontSize = 48;
		const gapAfterHeadline = 40;

		const headlineY = HEIGHT / 4 - headlineFontSize / 2 - gapAfterHeadline / 2;
		const bodyY = headlineY + headlineFontSize + gapAfterHeadline;

		this.creditsHeadline = this.add
			.text(leftPadding, headlineY, 'ABOUT', {
				font: `${headlineFontSize}px Pixelify Sans`,
				color: '#ffffff',
				align: 'left',
			})
			.setOrigin(0, 0)
			.setShadow(4, 4, '#000000', 4)
			.setDepth(4);

		this.creditsBody = this.add
			.text(
				leftPadding,
				bodyY,
				`The fall of Icarus, the legendary Icarus who dared to fly too close to the sun with wings made of feathers and wax, is a timeless tale of ambition, hubris, and the consequences of overreaching one's limits. Crafted in the spirit of classic arcade games, this project is a tribute to the enduring allure of myth and the thrill of adventure. This game is one where you go through a platformer but have to lose one ability each level. Every 5 levels you gain 3 abilities back. Choose carefully, or you might have to restart from the beginning!`,
				{
					font: `${bodyFontSize}px Pixelify Sans`,
					color: '#ffffff',
					align: 'left',
					wordWrap: { useAdvancedWrap: true, width: WIDTH - leftPadding * 2 },
					lineSpacing: 20,
				},
			)
			.setOrigin(0, 0)
			.setDepth(4);

		const hintFontSize = 40;

		this.clickHint = this.add
			.text(
				WIDTH - 24,
				HEIGHT - 18,
				'click anywhere or press any key to go back',
				{
					font: `${hintFontSize}px Pixelify Sans`,
					color: '#ffffff',
					align: 'right',
				},
			)
			.setOrigin(1, 1)
			.setAlpha(0.95)
			.setDepth(4);

		this.input.on('pointerdown', () => {
			this.scene.switch('Menu');
		});

		this.input.keyboard?.on('keydown', () => {
			this.scene.switch('Menu');
		});
	}
}
