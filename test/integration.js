const assert = require('assert');
const plugin = require('../index');

describe('database integration', function () {
	this.timeout(10000);

	it('connects, reads, writes, and shuts down with current MongoDB and ioredis clients', async function () {
		if (!process.env.MONGODB_URL || !process.env.REDIS_URL) this.skip();
		var serverState = { notes: {} };
		var pluginState = {
			cfg: {
				attachments: {},
				enable: { delivery: 'yes', queue: 'no' },
				limits: { db: 'redis' },
				mongodb: { db: 'haraka_plugin_test', string: process.env.MONGODB_URL },
				redis: { host: 'redis', port: 6379, string: process.env.REDIS_URL }
			},
			logerror: function () {},
			loginfo: function () {},
			lognotice: function () {}
		};
		var previousServer = global.server;
		global.server = serverState;

		try {
			await new Promise(function (resolve) {
				plugin.initialize_mongodb.call(pluginState, resolve, serverState);
			});
			await new Promise(function (resolve) {
				plugin.initialize_redis.call(pluginState, function () {}, serverState);
				if (serverState.notes.redis.status === 'ready') return resolve();
				serverState.notes.redis.once('ready', resolve);
			});

			var collection = serverState.notes.mongodb.collection('compatibility');
			await collection.insertOne({ status: 'ok' });
			assert.equal((await collection.findOne({ status: 'ok' })).status, 'ok');
			await serverState.notes.redis.set('compatibility', 'ok');
			assert.equal(await serverState.notes.redis.get('compatibility'), 'ok');
			assert.equal(serverState.notes.redis.options.protocol, 2);
		}
		finally {
			await plugin.shutdown.call(pluginState);
			global.server = previousServer;
		}
	});
});
