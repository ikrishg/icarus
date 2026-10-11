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

const BTN = {
	size: 88,
	margin: 24,
	alpha: 0.45,
	fill: 0xffffff,
	stroke: 0x1b1b1c,
};

export class TouchControls {
	private scene: Scene;
	private root: Phaser.GameObjects.Container;
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

	constructor(scene: Scene) {
		this.scene = scene;
		this.root = scene.add.container(0, 0).setDepth(200).setScrollFactor(0);
		if (!isTouchDevice(scene)) {
			this.root.setVisible(false);
			return;
		}
		this.visible = true;
		this.build();
	}

	private makeButton(
		x: number,
		y: number,
		label: string,
		onDown: () => void,
		onUp: () => void,
	): Phaser.GameObjects.Container {
		const container = this.scene.add.container(x, y);
		const bg = this.scene.add
			.rectangle(0, 0, BTN.size, BTN.size, BTN.fill, BTN.alpha)
			.setStrokeStyle(4, BTN.stroke, 0.9)
			.setInteractive({ useHandCursor: false });
		const text = this.scene.add
			.text(0, 0, label, {
				fontFamily: 'Pixelify Sans',
				fontSize: '28px',
				color: '#1b1b1c',
				align: 'center',
			})
			.setOrigin(0.5);

		bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			pointer.event?.preventDefault();
			onDown();
		});
		bg.on('pointerup', onUp);
		bg.on('pointerout', onUp);

		container.add([bg, text]);
		return container;
	}

	private build() {
		const baseY = HEIGHT - BTN.margin - BTN.size / 2;
		const leftX = BTN.margin + BTN.size / 2;
		const midX = leftX + BTN.size + 16;
		const rightX = midX + BTN.size + 16;

		const leftBtn = this.makeButton(
			leftX,
			baseY,
			'◀',
			() => {
				this.state.left = true;
			},
			() => {
				this.state.left = false;
			},
		);

		const rightBtn = this.makeButton(
			rightX,
			baseY,
			'▶',
			() => {
				this.state.right = true;
			},
			() => {
				this.state.right = false;
			},
		);

		const jumpY = baseY - BTN.size - 20;
		const jumpBtn = this.makeButton(
			rightX + BTN.size + 40,
			jumpY,
			'↑',
			() => {
				this.state.jump = true;
			},
			() => {
				this.state.jump = false;
			},
		);

		const shootBtn = this.makeButton(
			WIDTH - BTN.margin - BTN.size / 2,
			baseY,
			'E',
			() => {
				this.state.shoot = true;
			},
			() => {
				this.state.shoot = false;
			},
		);

		const dashBtn = this.makeButton(
			WIDTH - BTN.margin - BTN.size / 2,
			jumpY,
			'Q',
			() => {
				this.state.dash = true;
			},
			() => {
				this.state.dash = false;
			},
		);

		this.root.add([leftBtn, rightBtn, jumpBtn, shootBtn, dashBtn]);
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

	setGameplayVisible(visible: boolean) {
		if (!this.visible) return;
		this.root.setVisible(visible);
	}

	destroy() {
		this.root.destroy();
	}
}
