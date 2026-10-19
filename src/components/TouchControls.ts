import type { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../util/constants';
import { PALETTE_HEX } from '../util/palette';

export type TouchInputState = {
	left: boolean;
	right: boolean;
	jump: boolean;
	shoot: boolean;
	dash: boolean;
	jumpJustDown: boolean;
	shootJustDown: boolean;
	dashJustDown: boolean;
};

export function isTouchDevice(scene?: Scene): boolean {
	if (scene?.sys.game.device.input.touch) {
		return true;
	}
	if (typeof window === 'undefined') return false;
	return (
		'ontouchstart' in window ||
		navigator.maxTouchPoints > 0 ||
		window.matchMedia('(pointer: coarse)').matches
	);
}

const MIN_TOUCH_CSS_PX = 44;
const BASE_BTN_GAME_PX = 88;
const BASE_MARGIN_GAME_PX = 24;
const PLAYER_SPAWN_PAD = 40;

export class TouchControls {
	private scene: Scene;
	private gameplayNodes: Phaser.GameObjects.GameObject[] = [];
	private chromeNodes: Phaser.GameObjects.GameObject[] = [];
	private state: TouchInputState = {
		left: false,
		right: false,
		jump: false,
		shoot: false,
		dash: false,
		jumpJustDown: false,
		shootJustDown: false,
		dashJustDown: false,
	};
	private prevJump = false;
	private prevShoot = false;
	private prevDash = false;
	visible = false;
	readonly tapTargets: {
		right?: { x: number; y: number };
		jump?: { x: number; y: number };
	} = {};
	private onPause?: () => void;
	private onRestart?: () => void;

	constructor(scene: Scene) {
		this.scene = scene;
		if (!isTouchDevice(scene)) {
			return;
		}
		this.visible = true;
		this.build();
	}

	setTopBarHandlers(onPause: () => void, onRestart: () => void): void {
		this.onPause = onPause;
		this.onRestart = onRestart;
	}

	/** Minimum player center X so the sprite clears the left/right touch cluster. */
	getMinSpawnX(): number {
		if (!this.visible) return 0;
		const { size, margin, gap } = this.layoutMetrics();
		const leftX = margin + size / 2;
		const rightX = leftX + size + gap;
		const clusterRight = rightX + size / 2;
		return clusterRight + PLAYER_SPAWN_PAD;
	}

	private layoutMetrics() {
		const displayScale = Math.max(
			this.scene.scale.displaySize.width / WIDTH,
			this.scene.scale.displaySize.height / HEIGHT,
		);
		const size = Math.max(
			BASE_BTN_GAME_PX,
			Math.ceil(MIN_TOUCH_CSS_PX / displayScale),
		);
		const margin = Math.max(
			BASE_MARGIN_GAME_PX,
			Math.ceil(16 / displayScale),
		);
		const gap = Math.max(16, Math.ceil(12 / displayScale));
		return { size, margin, gap };
	}

	private makeButton(
		x: number,
		y: number,
		size: number,
		label: string,
		onDown: () => void,
		onUp: () => void,
		chrome = false,
	): void {
		const bg = this.scene.add
			.rectangle(x, y, size, size, 0xffffff, 0.45)
			.setStrokeStyle(4, 0x1b1b1c, 0.9)
			.setScrollFactor(0)
			.setDepth(201)
			.setInteractive({ useHandCursor: false });
		const fontSize = Math.max(24, Math.floor(size * 0.32));
		const text = this.scene.add
			.text(x, y, label, {
				fontFamily: 'Pixelify Sans',
				fontSize: `${fontSize}px`,
				color: '#1b1b1c',
				align: 'center',
			})
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(202);

		bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			pointer.event?.preventDefault();
			onDown();
		});
		bg.on('pointerup', onUp);
		bg.on('pointerout', onUp);

		const bucket = chrome ? this.chromeNodes : this.gameplayNodes;
		bucket.push(bg, text);
	}

	private makeChromeButton(
		x: number,
		y: number,
		label: string,
		onTap: () => void,
	): void {
		const text = this.scene.add
			.text(x, y, label, {
				fontFamily: 'Pixelify Sans',
				fontSize: '32px',
				color: PALETTE_HEX.cloudWhite,
				backgroundColor: PALETTE_HEX.deep,
				padding: { x: 14, y: 8 },
			})
			.setOrigin(1, 0)
			.setScrollFactor(0)
			.setDepth(202)
			.setInteractive({ useHandCursor: true });
		text.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			pointer.event?.preventDefault();
			onTap();
		});
		this.chromeNodes.push(text);
	}

	private build() {
		const { size, margin, gap } = this.layoutMetrics();
		const baseY = HEIGHT - margin - size / 2;
		const leftX = margin + size / 2;
		const rightX = leftX + size + gap;

		this.makeButton(
			leftX,
			baseY,
			size,
			'◀',
			() => {
				this.state.left = true;
			},
			() => {
				this.state.left = false;
			},
		);

		this.tapTargets.right = { x: rightX, y: baseY };
		this.makeButton(
			rightX,
			baseY,
			size,
			'▶',
			() => {
				this.state.right = true;
			},
			() => {
				this.state.right = false;
			},
		);

		const jumpX = WIDTH - margin - size / 2;
		const jumpY = baseY - size * 2 - gap * 2;
		this.tapTargets.jump = { x: jumpX, y: jumpY };
		this.makeButton(
			jumpX,
			jumpY,
			size,
			'↑',
			() => {
				this.state.jump = true;
			},
			() => {
				this.state.jump = false;
			},
		);

		this.makeButton(
			WIDTH - margin - size / 2,
			baseY,
			size,
			'E',
			() => {
				this.state.shoot = true;
			},
			() => {
				this.state.shoot = false;
			},
		);

		this.makeButton(
			WIDTH - margin - size / 2,
			baseY - size - gap,
			size,
			'Q',
			() => {
				this.state.dash = true;
			},
			() => {
				this.state.dash = false;
			},
		);

		const topY = 50;
		this.makeChromeButton(WIDTH - margin, topY, 'Pause', () => {
			this.onPause?.();
		});
		this.makeChromeButton(WIDTH - margin, topY + 48, 'Restart', () => {
			this.onRestart?.();
		});
	}

	beginFrame() {
		this.state.jumpJustDown = this.state.jump && !this.prevJump;
		this.state.shootJustDown = this.state.shoot && !this.prevShoot;
		this.state.dashJustDown = this.state.dash && !this.prevDash;
		this.prevJump = this.state.jump;
		this.prevShoot = this.state.shoot;
		this.prevDash = this.state.dash;
	}

	getInput(): TouchInputState {
		return this.state;
	}

	setTouchState(
		partial: Partial<
			Pick<TouchInputState, 'left' | 'right' | 'jump' | 'shoot' | 'dash'>
		>,
	) {
		Object.assign(this.state, partial);
	}

	setGameplayVisible(visible: boolean) {
		if (!this.visible) return;
		for (const node of this.gameplayNodes) {
			if ('setVisible' in node && typeof node.setVisible === 'function') {
				node.setVisible(visible);
			}
		}
	}

	destroy() {
		for (const node of [...this.gameplayNodes, ...this.chromeNodes]) {
			node.destroy();
		}
		this.gameplayNodes = [];
		this.chromeNodes = [];
	}
}
