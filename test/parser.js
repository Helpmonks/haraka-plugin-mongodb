const simpleParser = require('mailparser').simpleParser;
const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');

describe('mailparser compatibility', function () {
	this.timeout(10000);

	it('parses the full email fixture', async function () {
		var source = await fs.readFile(path.join(__dirname, 'test_data', 'test.eml'));
		var parsed = await simpleParser(source);
		assert.ok(parsed);
		assert.ok(parsed.headers instanceof Map);
		assert.ok(Array.isArray(parsed.attachments));
	});
});
