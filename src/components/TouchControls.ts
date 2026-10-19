import type { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../util/constants';

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

export class TouchControls {
	private scene: Scene;
	private nodes: Phaser.GameObjects.GameObject[] = [];
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

	constructor(scene: Scene) {
		this.scene = scene;
		if (!isTouchDevice(scene)) {
			return;
		}
		this.visible = true;
		this.build();
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
			.setDepth(200);

		bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			pointer.event?.preventDefault();
			onDown();
		});
		bg.on('pointerup', onUp);
		bg.on('pointerout', onUp);

		this.nodes.push(bg, text);
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

		const jumpY = baseY - size - gap;
		const jumpX = rightX + size + gap * 2;
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
			jumpY,
			size,
			'Q',
			() => {
				this.state.dash = true;
			},
			() => {
				this.state.dash = false;
			},
		);
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
		for (const node of this.nodes) {
			if ('setVisible' in node && typeof node.setVisible === 'function') {
				node.setVisible(visible);
			}
		}
	}

	destroy() {
		for (const node of this.nodes) {
			node.destroy();
		}
		this.nodes = [];
	}
}
