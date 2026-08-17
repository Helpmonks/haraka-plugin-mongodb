const assert = require('assert');
const { Splitter } = require('@zone-eu/mailsplit');
const detectCharacterEncoding = require('detect-character-encoding');
const Iconv = require('iconv').Iconv;
const Redis = require('ioredis');
const mime = require('mime-types');
const { MongoClient, ObjectId } = require('mongodb');
const nodemailer = require('nodemailer');

describe('dependency compatibility', function () {
	it('loads every runtime entry point from CommonJS', function () {
		assert.equal(typeof require('../index').register, 'function');
		assert.equal(typeof require('../dkim_sign').register, 'function');
		assert.equal(typeof require('../email_body_utility').getHtmlAndTextBody, 'function');
	});

	it('converts links and handles with the current linkify API', function () {
		var html = require('../email_body_utility').convertPlainTextToHtml('Visit example.com and @helpmonks');
		assert.match(html, /href="http:\/\/example\.com"/);
		assert.match(html, /href="https:\/\/twitter\.com\/helpmonks"/);
	});

	it('detects and decodes non-UTF-8 text', function () {
		var source = Buffer.from([0x48, 0xe9]);
		var detected = detectCharacterEncoding(source);
		var converter = new Iconv('ISO-8859-1', 'UTF-8');
		assert.equal(typeof detected.encoding, 'string');
		assert.equal(converter.convert(source).toString('utf8'), 'Hé');
	});

	it('exposes the renamed mail splitter and current MIME lookup', function () {
		var splitter = new Splitter();
		assert.equal(typeof splitter.write, 'function');
		assert.equal(mime.extension('message/rfc822'), 'eml');
		splitter.destroy();
	});

	it('exposes the promise-based MongoDB driver API', async function () {
		var client = new MongoClient('mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10');
		var connection = client.connect();
		assert.equal(typeof connection.then, 'function');
		assert.equal(new ObjectId().toHexString().length, 24);
		await assert.rejects(connection);
		await client.close();
	});

	it('keeps ioredis usable from CommonJS with the RESP2 compatibility mode', function () {
		var client = new Redis({ lazyConnect: true, protocol: 2 });
		assert.equal(client.options.protocol, 2);
		client.disconnect();
	});

	it('sends through Nodemailer callback and promise-compatible transports', async function () {
		var transport = nodemailer.createTransport({ jsonTransport: true });
		var result = await transport.sendMail({ from: 'from@example.com', to: 'to@example.com', subject: 'Compatibility', text: 'OK' });
		assert.match(result.message, /Compatibility/);
		transport.close();
	});
});
