import { AUTO, Game, Scale } from 'phaser';
import packageData from '../package.json';
import { About } from './scenes/About';
import { Boot } from './scenes/Boot';
import { Credits } from './scenes/Credits';
import { Dead } from './scenes/Dead';
import { Home } from './scenes/Home';
import { Menu } from './scenes/Menu';
import { Play } from './scenes/Play';
import { Preloader } from './scenes/Preloader';
import { Win } from './scenes/Win';
import { HEIGHT, WIDTH } from './util/constants';

const config: Phaser.Types.Core.GameConfig = {
	type: AUTO,
	width: WIDTH,
	height: HEIGHT,
	title: 'Icarus',
	url: 'https://icarus.krishg.com',
	version: packageData.version,
	pixelArt: true,
	backgroundColor: '#1b1b1c',
	scene: [Boot, Preloader, Home, Menu, Play, About, Credits, Win, Dead],
	physics: {
		default: 'arcade',
		arcade: {
			gravity: { x: 0, y: 800 },
			debug: true,
			debugShowStaticBody: true,
			debugShowBody: true,
		},
	},
	scale: {
		mode: Scale.ScaleModes.FIT,
		autoCenter: Scale.Center.NO_CENTER,
		fullscreenTarget: 'icarus-window',
		max: { width: WIDTH, height: HEIGHT },
	},
};

const StartGame = (parent: string) => {
	return new Game({ ...config, parent });
};

export default StartGame;
