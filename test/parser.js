const simpleParser = require('mailparser').simpleParser;
const fs = require('fs-extra');


const source_haraka = fs.readFileSync('./test_data/test_haraka_body.json');
const source_file = fs.readFileSync('./test_data/test.eml');

simpleParser(source_file, {}, (err, parsed) => {
	console.log("err", err);
	console.log("parsed", parsed);
});