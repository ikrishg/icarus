import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	define: {
		'import.meta.env.VITE_ENABLE_QA_HOOKS': JSON.stringify('true'),
		'import.meta.env.VITE_NOSNAP_PROOF': JSON.stringify(
			process.env.VITE_NOSNAP_PROOF === '1' ? 'true' : '',
		),
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					phaser: ['phaser'],
				},
			},
		},
	},
});
