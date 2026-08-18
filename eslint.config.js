const eslint = require('@eslint/js');
const globals = require('globals');

module.exports = [
	{
		ignores: ['node_modules/**', 'test.js']
	},
	eslint.configs.recommended,
	{
		files: ['*.js', 'test/**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				...globals.node,
				CONT: 'readonly',
				DENY: 'readonly',
				DENYDISCONNECT: 'readonly',
				DENYSOFT: 'readonly',
				DENYSOFTDISCONNECT: 'readonly',
				OK: 'readonly',
				server: 'readonly'
			}
		},
		rules: {
			'no-empty': ['error', { allowEmptyCatch: true }],
			'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
		}
	},
	{
		files: ['test/**/*.js'],
		languageOptions: {
			globals: globals.mocha
		}
	}
];
