// haraka-plugin-mongodb

// Made by Helpmonks - http://helpmonks.com

/* jshint esversion: 6 */

'use strict';

// Require
const mongoc = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;
const async = require('async');
const uuid = require('uuid');
const moment = require('moment');
const fs = require('fs-extra');
const path = require('path');
const S = require('string');
const linkify = require('linkify-it')();
const Iconv = require('iconv').Iconv;
const simpleParser = require('mailparser').simpleParser
const exec = require('child_process').exec;

/// init linkify ///

linkify.tlds(require('tlds'))
	.tlds('onion', true) // Add unofficial `.onion` domain
	.add('ftp:', null) // Disable `ftp:` ptotocol
	.add('git:', 'http:') // Add `git:` ptotocol as "alias"
	.set({ fuzzyIP: true, fuzzyLink: true, fuzzyEmail: true });

// convert twitter handles
linkify.add('@', {
	validate: function (text, pos, self) {
		var tail = text.slice(pos);

		if (!self.re.twitter) {
			self.re.twitter =  new RegExp('^([a-zA-Z0-9_]){1,15}(?!_)(?=$|' + self.re.src_ZPCc + ')');
		}

		if (self.re.twitter.test(tail)) {
			// Linkifier allows punctuation chars before prefix,
			// but we additionally disable `@` ("@@mention" is invalid)
			if (pos >= 2 && tail[pos - 2] === '@') { return false; }
			return tail.match(self.re.twitter)[0].length;
		}

		return 0;
	},
	normalize: function (match) {
		match.url = 'https://twitter.com/' + match.url.replace(/^@/, '');
	}
});


exports.register = function () {
	var plugin = this;
	plugin.load_mongodb_ini();

	// some other plugin doing: inherits('haraka-plugin-mongodb')
	if (plugin.name !== 'mongodb') return;

	// Load on startup
	plugin.register_hook('init_master', 'initialize_mongodb');
	plugin.register_hook('init_child', 'initialize_mongodb');

	// Enable for queue
	if (plugin.cfg.enable.queue) {
		plugin.register_hook('data', 'enable_transaction_body_parse');
		plugin.register_hook('queue', 'queue_to_mongodb');
	}
	// Enable for delivery results
	if (plugin.cfg.enable.delivery) {
		plugin.register_hook('data_post', 'data_post_email');
		plugin.register_hook('send_email', 'sending_email');
		plugin.register_hook('get_mx', 'getting_mx');
		plugin.register_hook('deferred', 'deferred_email');
		plugin.register_hook('bounce', 'bounced_email');
		plugin.register_hook('delivered', 'save_results_to_mongodb');
	}
}

exports.load_mongodb_ini = function () {
	var plugin = this;

	plugin.cfg = plugin.config.get('mongodb.ini', {
		booleans: [
			'+enable.queue.yes',
			'+enable.delivery.yes'
		]
	},
	function () {
		plugin.load_mongodb_ini();
	});
}

exports.initialize_mongodb = function (next, server) {
	var plugin = this;
	var connectionString;

	// Only connect if there is no server.notes.mongodb already
	if ( ! server.notes.mongodb ) {
		connectionString = 'mongodb://';
		if (plugin.cfg.mongodb.user && plugin.cfg.mongodb.pass) {
			connectionString += `${encodeURIComponent(plugin.cfg.mongodb.user)}:${encodeURIComponent(plugin.cfg.mongodb.pass)}@`;
		}
		connectionString += `${plugin.cfg.mongodb.host}:${plugin.cfg.mongodb.port}/${plugin.cfg.mongodb.db}`;

		mongoc.connect(connectionString, { 'useNewUrlParser' : true }, function(err, client) {
			if (err) {
				plugin.logerror('ERROR connecting to MongoDB !!!');
				plugin.logerror(err);
				throw err;
			}
			server.notes.mongodb = client.db(plugin.cfg.mongodb.db);
			// plugin.lognotice('-------------------------------------- ');
			// plugin.lognotice('server.notes.mongodb : ', server.notes.mongodb);
			plugin.lognotice('-------------------------------------- ');
			plugin.lognotice(' Successfully connected to MongoDB !!! ');
			plugin.lognotice('-------------------------------------- ');
			plugin.lognotice('   Waiting for emails to arrive !!!    ');
			plugin.lognotice('-------------------------------------- ');
			next();
		});
	}
	else {
		plugin.loginfo('There is already a MongoDB connection in the server.notes !!!');
		next();
	}
};

// ------------------
// QUEUE
// ------------------


// Hook for data
exports.enable_transaction_body_parse = function(next, connection) {
	connection.transaction.parse_body = true;
	next();
};

// Hook for queue-ing
exports.queue_to_mongodb = function(next, connection) {

	var plugin = this;
	var body = connection.transaction.body;

	async.waterfall([
		function (waterfall_callback) {
			_mp(plugin, connection, function(email) {
				return waterfall_callback(null, email);
			})
		},
		function (email, waterfall_callback) {
			// Get proper body
			return waterfall_callback(null, _getHtmlAndTextBody(email, body), email);
		},
		function (body_info, email, waterfall_callback) {
			// Put values into object
			email.extracted_html_from = body_info.html_source;
			email.extracted_text_from = body_info.text_source;
			// Add html into email
			email.html = body_info.html;
			email.text = body_info.text;
			// Check for inline images
			_checkInlineImages(plugin, email, function(error, email) {
				// Return
				return waterfall_callback(null, email);
			})
		}
	],
	function (error, email_object) {

		// Mail object
		var _email = {
			'haraka_body': body ? body : null,
			'raw': email_object,
			'from': email_object.headers.get('from') ? email_object.headers.get('from').value : null,
			'to': email_object.headers.get('to') ? email_object.headers.get('to').value : null,
			'cc': email_object.headers.get('cc') ? email_object.headers.get('cc').value : null,
			'bcc': email_object.headers.get('bcc') ? email_object.headers.get('bcc').value : null,
			'subject': email_object.subject,
			'date': email_object.date,
			'received_date': email_object.headers.get('date') ? email_object.headers.get('date') : null,
			'message_id': email_object.messageId ? email_object.messageId.replace(/<|>/gm, '') : new ObjectID() + '@haraka-helpmonks.com',
			'attachments': email_object.attachments || [],
			'headers': email_object.headers,
			'html': email_object.html,
			'text': email_object.text ? email_object.text : null,
			'timestamp': new Date(),
			'status': 'unprocessed',
			'source': 'haraka',
			'in_reply_to' : email_object.inReplyTo,
			'reply_to' : email_object.headers.get('reply-to') ? email_object.headers.get('reply-to').value : null,
			'references' : email_object.references,
			'pickup_date' : new Date(),
			'mail_from' : connection.transaction.mail_from,
			'rcpt_to' : connection.transaction.rcpt_to,
			'size' : connection.transaction.data_bytes,
			'transferred' : false,
			'processed' : false,
			'extracted_html_from': email_object.extracted_html_from,
			'extracted_text_from': email_object.extracted_text_from
		};

		// plugin.lognotice('--------------------------------------');
		// plugin.lognotice(' Server notes !!! ');
		// plugin.lognotice(' server.notes : ', server.notes);
		// plugin.lognotice(' server.notes.mongodb : ', server.notes.mongodb);
		// plugin.lognotice('--------------------------------------');

		server.notes.mongodb.collection(plugin.cfg.collections.queue).insert(_email, function(err) {
			if (err) {
				plugin.logerror('--------------------------------------');
				plugin.logerror(`Error on insert of the email with the message_id: ${_email.message_id} Error: `, err);
				plugin.logerror('--------------------------------------');
				next(DENY, "storage error");
			} else {
				plugin.lognotice('--------------------------------------');
				plugin.lognotice(` Successfully stored the email with the message_id: ${_email.message_id} !!! `);
				plugin.lognotice('--------------------------------------');
				next(OK);
			}
		});

	});

	// _mp(plugin, connection, function(email_object) {

	// 	// plugin.lognotice('--------------------------------------');
	// 	// plugin.lognotice(' email_object.html ', email_object.html);
	// 	// plugin.lognotice(' email_object.text ', email_object.text);
	// 	// plugin.lognotice('--------------------------------------');

	// 	// Get proper body
	// 	var _body_html = _extractHtmlBody(email_object, body);

	// 	// Mail object
	// 	var _email = {
	// 		'haraka_body': body ? body : null,
	// 		'raw': email_object,
	// 		'from': email_object.headers.get('from') ? email_object.headers.get('from').value : null,
	// 		'to': email_object.headers.get('to') ? email_object.headers.get('to').value : null,
	// 		'cc': email_object.headers.get('cc') ? email_object.headers.get('cc').value : null,
	// 		'bcc': email_object.headers.get('bcc') ? email_object.headers.get('bcc').value : null,
	// 		'subject': email_object.subject,
	// 		'date': email_object.date,
	// 		'received_date': email_object.headers.get('date') ? email_object.headers.get('date') : null,
	// 		'message_id': email_object.messageId ? email_object.messageId.replace(/<|>/gm, '') : new ObjectID() + '@haraka-helpmonks.com',
	// 		'attachments': email_object.attachments || [],
	// 		'headers': email_object.headers,
	// 		'html': _body_html.result,
	// 		'text': email_object.text ? email_object.text : null,
	// 		'timestamp': new Date(),
	// 		'status': 'unprocessed',
	// 		'source': 'haraka',
	// 		'in_reply_to' : email_object.inReplyTo,
	// 		'reply_to' : email_object.headers.get('reply-to') ? email_object.headers.get('reply-to').value : null,
	// 		'references' : email_object.references,
	// 		'pickup_date' : new Date(),
	// 		'mail_from' : connection.transaction.mail_from,
	// 		'rcpt_to' : connection.transaction.rcpt_to,
	// 		'size' : connection.transaction.data_bytes,
	// 		'transferred' : false,
	// 		'processed' : false,
	// 		'extracted_from': _body_html.source
	// 	};

	// 	// plugin.lognotice('--------------------------------------');
	// 	// plugin.lognotice(' Server notes !!! ');
	// 	// plugin.lognotice(' server.notes : ', server.notes);
	// 	// plugin.lognotice(' server.notes.mongodb : ', server.notes.mongodb);
	// 	// plugin.lognotice('--------------------------------------');

	// 	server.notes.mongodb.collection(plugin.cfg.collections.queue).insert(_email, function(err) {
	// 		if (err) {
	// 			plugin.logerror('--------------------------------------');
	// 			plugin.logerror(`Error on insert of the email with the message_id: ${_email.message_id} Error: `, err);
	// 			plugin.logerror('--------------------------------------');
	// 			next(DENY, "storage error");
	// 		} else {
	// 			plugin.lognotice('--------------------------------------');
	// 			plugin.lognotice(` Successfully stored the email with the message_id: ${_email.message_id} !!! `);
	// 			plugin.lognotice('--------------------------------------');
	// 			next(OK);
	// 		}
	// 	});

	// });

};


// ------------------
// RESULTS
// ------------------

// SEND EMAIL
exports.data_post_email = function(next, connection) {
	var plugin = this;
	// plugin.lognotice('--------------------------------------');
	// plugin.lognotice(' DATA POST EMAIL !!! ');
	// Get Haraka UUID
	connection.transaction.notes.haraka_uuid = connection.transaction.uuid;
	// Get messageid
	var _mid = connection.transaction.header.headers_decoded && connection.transaction.header.headers_decoded['message-id'] ? connection.transaction.header.headers_decoded['message-id'][0] : new ObjectID() + '@haraka-helpmonks.com';
	_mid = _mid.replace(/<|>/g, '');
	connection.transaction.notes.message_id = _mid;
	next();
}

// SEND EMAIL
exports.sending_email = function(next, hmail) {
	// Make sure we have a message_id. If not do not send anything
	if ( ! hmail.todo.notes.message_id ) return next();
	var plugin = this;
	// plugin.lognotice('--------------------------------------');
	// plugin.lognotice(' SENDING EMAIL !!! ');
	// Object
	var _data = {
		'message_id' : hmail.todo.notes.message_id,
		'haraka_uuid' : hmail.todo.notes.haraka_uuid,
		'stage' : 'Sending email',
		'timestamp' : new Date(),
		'hook' : 'send_email'
	}
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
}

// GET MX
exports.getting_mx = function(next, hmail, domain) {
	// Make sure we have a message_id. If not do not send anything
	if ( ! hmail.todo.notes.message_id ) return next();
	var plugin = this;
	// plugin.lognotice('--------------------------------------');
	// plugin.lognotice(' GETTING MX !!! ', hmail);
	// plugin.lognotice(' DOMAIN !!! ', domain);
	// Object
	var _data = {
		'message_id' : hmail.todo.notes.message_id,
		'haraka_uuid' : hmail.todo.notes.haraka_uuid,
		'stage' : 'Get MX',
		'timestamp' : new Date(),
		'hook' : 'get_mx',
		'domain' : domain
	}
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
}

// DEFERRED
exports.deferred_email = function(next, hmail, deferred_object) {
	// Make sure we have a message_id. If not do not send anything
	if ( ! hmail.todo.notes.message_id ) return next();
	var plugin = this;
	// plugin.lognotice('--------------------------------------');
	// plugin.lognotice(' DEFERRED !!! ', hmail);
	// plugin.lognotice(' DEFERRED_OBJECT DELAY !!! ', deferred_object.delay);
	// plugin.lognotice(' DEFERRED_OBJECT ERROR !!! ', deferred_object.err);
	// Object
	var _data = {
		'message_id' : hmail.todo.notes.message_id,
		'haraka_uuid' : hmail.todo.notes.haraka_uuid,
		'stage' : 'Deferred',
		'timestamp' : new Date(),
		'hook' : 'deferred',
		'deferred_object' : {
			'delay' : deferred_object.delay,
			'error' : deferred_object.err
		}
	}
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
}

// BOUNCE
exports.bounced_email = function(next, hmail, error) {
	// Make sure we have a message_id. If not do not send anything
	if ( ! hmail.todo.notes.message_id ) return next();
	// Vars
	var plugin = this;
	var _rcpt = hmail.todo.rcpt_to[0];
	var _rcpt_to = _rcpt.original.slice(1, -1);
	var _date = moment().subtract(1, 'h').toISOString();
	var _query = { 'rcpt_to' : _rcpt_to, 'timestamp' : { '$gt' : new Date(_date) } };
	// Query if there is already a record for this user
	server.notes.mongodb.collection(plugin.cfg.collections.delivery).find(_query).toArray(function(error, record) {
		// We store the bounce message in MongoDB no matter what
		var _data = {
			'message_id' : hmail.todo.notes.message_id,
			'haraka_uuid' : hmail.todo.notes.haraka_uuid,
			'stage' : 'Bounced',
			'timestamp' : new Date(),
			'hook' : 'bounce',
			'bounce_error' : error ? error : null,
			'rcpt_to' : _rcpt_to,
			'rcpt_obj' : _rcpt
		}
		// Save
		_saveDeliveryResults(_data, server.notes.mongodb, plugin);
		// Send bounce message or not
		if ( record && record.length ) {
			return next(OK);
		}
		else {
			return next();
		}
	})
}


// DELIVERED
// params = host, ip, response, delay, port, mode, ok_recips, secured, authenticated
exports.save_results_to_mongodb = function(next, hmail, params) {
	// Make sure we have a message_id. If not do not send anything
	if ( ! hmail.todo.notes.message_id ) return next();
	var plugin = this;
	// plugin.lognotice('--------------------------------------');
	// plugin.lognotice(' DELIVERED !!! ', hmail);
	// plugin.lognotice(' HOST !!! ', params[0]);
	// plugin.lognotice(' IP !!! ', params[1]);
	// plugin.lognotice(' RESPONSE !!! ', params[2]);
	// plugin.lognotice(' DELAY !!! ', params[3]);
	// plugin.lognotice(' PORT !!! ', params[4]);
	// plugin.lognotice(' MODE !!! ', params[5]);
	// plugin.lognotice(' OK_RECIPS !!! ', params[6]);
	// plugin.lognotice(' SECURED !!! ', params[7]);
	// plugin.lognotice(' AUTH !!! ', params[8]);
	// plugin.lognotice('--------------------------------------');
	// Object
	var _data = {
		'message_id' : hmail.todo.notes.message_id,
		'haraka_uuid' : hmail.todo.notes.haraka_uuid,
		'stage' : 'Delivered',
		'timestamp' : new Date(),
		'hook' : 'delivered',
		'result' : {
			'host' : params[0],
			'ip' : params[1],
			'response' : params[2],
			'delay' : params[3],
			'port' : params[4],
			'mode' : params[5],
			'ok_recips' : params[6],
			'secured' : params[7],
			'authentication' : params[8]
		}
	};
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
};


exports.shutdown = function() {
	var plugin = this;
	server.notes.mongodb.close();
};

// ------------------
// INTERNAL FUNCTIONS
// ------------------

// Extract proper body
// function _extractHtmlBody(email_obj, body) {

// 	var use_childs_html = email_obj.html && ! email_obj.html.toLowerCase().includes('html') && email_obj.html.includes('�') && email_obj.raw && email_obj.raw.headers && email_obj.raw.headers['content-transfer-encoding'] === 'base64';

// 	if (email_obj.html && ! use_childs_html) { return email_obj.html; }
// 	if (email_obj.textAsHtml && ! use_childs_html) { return email_obj.textAsHtml; }

// 	var html = getBodyTextFromChildren(body);
// 	var result = html || getBodyTextFromChildren(body, 'text/plain;');

// 	return result;

// 	function getBodyTextFromChildren(haraka_obj, type = 'text/html;') {

// 		var is_requested_type = haraka_obj.ct && haraka_obj.ct.includes(type);

// 		if (haraka_obj.bodytext && is_requested_type) { return haraka_obj.bodytext; }
// 		if (! haraka_obj.children) { return ''; }

// 		var childs_body_text = null;
// 		var i = 0;
// 		// take the text from the first child that has it
// 		while (! childs_body_text && i < haraka_obj.children.length) {
// 			childs_body_text = getBodyTextFromChildren(haraka_obj.children[i++], type);
// 		}
// 		return childs_body_text || '';
// 	}

// };

// function _extractHtmlBody(email_obj, body) {

// 	// source can be bodytext_html, bodytext_plain, mailparser_html, mailparser_text_as_html, mail_parser_text
// 	var source = null;
// 	var result = null;

// 	if (! result) {
// 		result = email_obj.html && email_obj.html !== '' && !email_obj.html.includes('�') ? email_obj.html : null;
// 		source = !! result ? 'mailparser_html' : null;
// 	}

// 	if (! result) {
// 		result = getBodyTextFromChildren(body);
// 		source = !! result ? 'bodytext_html' : null;
// 	};

// 	if (! result) {
// 		result = getBodyTextFromChildren(body, 'text/plain;');
// 		source = !! result ? 'bodytext_plain' : null;
// 	};

// 	if (! result) {
// 		result = email_obj.text && email_obj.text !== '' && !email_obj.text.includes('�') ? email_obj.text : null;
// 		source = !! result ? 'mailparser_text' : null;
// 	};

// 	if (! result) {
// 		result = email_obj.textAsHtml && email_obj.textAsHtml !== '' && !email_obj.textAsHtml.includes('�') ? email_obj.textAsHtml : null;
// 		source = !! result ? 'mailparser_text_as_html' : null;
// 	};

// 	return { result, source };


// 	function getBodyTextFromChildren(haraka_obj, type = 'text/html;') {

// 		var is_requested_type = haraka_obj.ct && haraka_obj.ct.includes(type);

// 		if (haraka_obj.bodytext && haraka_obj.bodytext !== '' && !haraka_obj.bodytext.includes('�') && is_requested_type) { return haraka_obj.bodytext; }
// 		// if (haraka_obj.bodytext && haraka_obj.bodytext !== '' && !haraka_obj.bodytext.includes('�')) { return haraka_obj.bodytext; }
// 		if (! haraka_obj.children) { return ''; }

// 		var childs_body_text = null;
// 		var i = 0;
// 		// take the text from the first child that has it
// 		while (! childs_body_text && i < haraka_obj.children.length) {
// 			childs_body_text = getBodyTextFromChildren(haraka_obj.children[i++], type);
// 		}

// 		return childs_body_text || '';
// 	}
// };

function _getHtmlAndTextBody(email_obj, body) {

	var html_info = _extractBody(email_obj, body)
	var text_info = _extractBody(email_obj, body, _default_text_field_order);

	// override any html mailparser result we have if there's text result
	if (! html_info.result || (text_info.result && html_info.source.includes('mailparser'))) {
		html_info.result = _convertPlainTextToHtml(text_info.result);
		html_info.source = text_info.source;
	}

	return {
		'html' : html_info.result,
		'text' : text_info.result,
		'html_source' : html_info.source,
		'text_source' :text_info.source
	};
}

const _default_html_field_order = 'bodytext_html mailparser_html mailparser_text_as_html'.split(' ');
const _default_text_field_order = 'bodytext_plain mailparser_text'.split(' ');

function _extractBody(email_obj, body, field_order = _default_html_field_order) {

	// source can be bodytext_html, bodytext_plain, mailparser_html, mailparser_text_as_html, mail_parser_text
	var source = 'none';
	var result = '';

	var i = 0;
	while (! result && i < field_order.length) {
		var field = field_order[i++];
		result = getBodyByField(email_obj, body, field);
		// if we have a result then set the source
		source = result ? field : source;
	}

	return { result, source };

	///////////////////////////////////////////////

	function getBodyTextFromChildren(haraka_obj, type = 'text/html', depth = 0, index = 0) {

		const _log_func = false;

		_log_func && console.log(`${'\t'.repeat(depth)} [${index}] looking for type '${type}', current node is '${haraka_obj.ct}' at depth '${depth}'`);
		const is_requested_type = haraka_obj.ct && haraka_obj.ct.includes(type);

		if (haraka_obj.bodytext && is_requested_type) {
			_log_func && console.log(`${'\t'.repeat(depth)} [${index}] found bodytype of length '${haraka_obj.bodytext.length}' for type '${type}'`);
			return haraka_obj.bodytext;
		}

		if (! haraka_obj.children || ! haraka_obj.children.length) {
			_log_func && console.log(`${'\t'.repeat(depth)} [${index}] no children at current node of depth '${depth}', sending back an empty string`);
			return '';
		}

		const num_children = haraka_obj.children.length;

		_log_func && console.log(`${'\t'.repeat(depth)} [${index}] node has ${num_children} children to be checked until a result of type '${type}' is found`);

		var childs_body_text = null;
		var i = 0;
		// take the text from the first child that has it
		while (! childs_body_text && i < num_children) {
			childs_body_text = getBodyTextFromChildren(haraka_obj.children[i++], type, depth + 1, ++index);
		}

		return childs_body_text.trim() || '';
	}

	function getBodyByField(email_obj, body, field) {

		switch (field) {

			case 'bodytext_html':
				return getBodyTextFromChildren(body);

			case 'bodytext_plain':
				return getBodyTextFromChildren(body, 'text/plain');

			case 'mailparser_html':
				return email_obj.html || '';

			case 'mailparser_text_as_html':
				return email_obj.textAsHtml || '';

			case 'mailparser_text' :
				return email_obj.text || '';

			default:
				console.log(`unknown field type requested for body field: '${field}'`);
				return '';
		}
	}
}

function _convertPlainTextToHtml(text) {

	if (! text) { return text; }

	// use linkify to convert any links to <a>
	var words = text.split(' ');

	words = words.map((w) => {
		// if there're no links return w as is
		if (! linkify.test(w)) { return w; }

		var matches = linkify.match(w);

		// loop through the matches backwards so that the matches' indexes remain unchanged throughout the changes
		for (var i = matches.length -1; i >= 0; i--) {
			var m = matches[i];
			w = `${w.substring(0, m.index)}<a href="${m.url}" target="_blank">${m.text}</a>${w.substring(m.lastIndex)}`;
		}

		return w.trim();
	});

	var text_as_html = `<p>${words.join(' ')}</p>`;

	text_as_html = text_as_html.replace(/\r?\n/g, '\n');
	text_as_html = text_as_html.replace(/[ \t]+$/gm, '');
	text_as_html = text_as_html.replace(/\n\n+/gm, '</p><p>');
	text_as_html = text_as_html.replace(/\n/g, '<br/>').trim();

	// remove any starting and trailing empty paragraphs
	while (! text_as_html.indexOf('<p></p>')) {
		text_as_html = text_as_html.substring('<p></p>'.length).trim();
	}

	while (text_as_html.substring(text_as_html.length - '<p></p>'.length) === '<p></p>') {
		text_as_html = text_as_html.substring(0, text_as_html.length - '<p></p>'.length).trim();
	}

	return text_as_html;
}


// Add to delivery log
function _saveDeliveryResults(data_object, conn, plugin_object, callback) {
	// Catch if something is not defined
	// if (!plugin_object || !plugin_object.cfc || plugin_object.cfg.collections) return callback && callback(null);
	// if (!conn || !conn.collection) return callback && callback(null);
	// Save
	conn.collection(plugin_object.cfg.collections.delivery).insert(data_object, function(err) {
		if (err) {
			plugin_object.logerror('--------------------------------------');
			plugin_object.logerror('ERROR ON INSERT INTO DELIVERY : ', err);
			plugin_object.logerror('--------------------------------------');
			return callback && callback(err);
		} else {
			plugin_object.lognotice('--------------------------------------');
			plugin_object.lognotice(`Successfully stored the delivery log for message_id : ${data_object.message_id} !!! `);
			plugin_object.lognotice('--------------------------------------');
			return callback && callback(null);
		}
	});
}

function extractChildren(children) {
	return children.map(function(child) {
		var data = {
			bodytext: child.bodytext,
			headers: child.header.headers_decoded
		};
		if (child.children.length > 0) data.children = extractChildren(child.children);
		return data;
	});
}

// Parse the address - Useful for checking usernames in rcpt_to
function parseSubaddress(user) {
	var parsed = {
		username: user
	};
	if (user.indexOf('+')) {
		parsed.username = user.split('+')[0];
		parsed.subaddress = user.split('+')[1];
	}
	return parsed;
}

function _mp(plugin, connection, cb) {
	simpleParser(connection.transaction.message_stream, { Iconv, 'skipImageLinks' : true }, (error, mail) => {
		if ( mail.attachments ) {
			_storeAttachments(connection, plugin, mail.attachments, mail, function(error, mail_object) {
				return cb(mail_object);
			});
		}
		else {
			return cb(mail);
		}
	});
}

// function _mp2(plugin, connection, cb) {
// 	var mailparser = new MailParser({
// 		'streamAttachments': false
// 	});
// 	mailparser.on("end", function(mail) {
// 		// connection.loginfo('MAILPARSER', plugin.cfg);
// 		// connection.loginfo('MAILPARSER ATTACHMENTS', mail.attachments);
// 		// Check if there are attachments. If so store them to disk
// 		if ( mail.attachments ) {
// 			_storeAttachments(connection, plugin, mail.attachments, mail, function(error, mail_object) {
// 				return cb(mail_object);
// 			});
// 		}
// 		else {
// 			return cb(mail);
// 		}
// 	});
// 	connection.transaction.message_stream.pipe(mailparser, {});
// }

// Attachment code
function _storeAttachments(connection, plugin, attachments, mail_object, cb) {

	var _attachments = [];

	// loop through each attachment and attempt to store it locally
	var is_tnef_attachment = false;

	async.each(attachments, function (attachment, each_callback) {

		// if attachment type is inline we don't need to store it anymore as the inline images are replaced with base64 encoded data URIs in mp2
		// if ( attachment && attachment.related ) {
		// 	// Filter
		// 	_attachments = _attachments.filter(a => a.checksum !== attachment.checksum);
		// 	return each_callback();
		// }

		plugin.loginfo('--------------------------------------');
		plugin.loginfo('Begin storing attachment');
		// plugin.loginfo('Headers : ', attachment.headers);
		// plugin.loginfo('filename : ', attachment.filename);
		// plugin.loginfo('contentType : ', attachment.contentType);
		// plugin.loginfo('contentDisposition : ', attachment.contentDisposition);
		// plugin.loginfo('checksum : ', attachment.checksum);
		// plugin.loginfo('size : ', attachment.size);
		// plugin.loginfo('contentId : ', attachment.contentId);
		// plugin.loginfo('cid : ', attachment.cid);
		// plugin.loginfo('related : ', attachment.related);
		plugin.loginfo('--------------------------------------');

		// Path to attachments dir
		var attachments_folder_path = plugin.cfg.attachments.path;
		// plugin.loginfo('attachments_folder_path : ', attachments_folder_path);

		// if there's no checksum for the attachment then generate our own uuid
		// attachment.checksum = attachment.checksum || uuid.v4();
		var attachment_checksum = attachment.checksum || uuid.v4();
		// plugin.loginfo('Begin storing attachment : ', attachment.checksum, attachment_checksum);

		// Size is in another field in 2.x
		attachment.length = attachment.size || attachment.length;
		// No more generatedFilename in 2.x
		attachment.fileName = attachment.filename || attachment.fileName || 'attachment.txt';
		attachment.generatedFileName = attachment.generatedFileName || attachment.fileName;

		// If filename is attachment.txt
		if (attachment.fileName === 'attachment.txt') {
			// Get ext from contenttype
			var _ext = attachment.contentType ? attachment.contentType.split('/')[1] : 'txt';
			var _ext_len = _ext.length;
			if (_ext_len <= 4) {
				attachment.fileName = `attachment.${_ext}`;
				attachment.generatedFileName = attachment.fileName;
			}
		}

		// For calendar events
		if ( attachment.contentType === 'text/calendar' ) {
			attachment.fileName = 'invite.ics';
			attachment.generatedFileName = 'invite.ics';
		}

		// Clean up filename that could potentially cause an issue
		attachment.fileName = attachment.fileName.replace(/[^A-Za-z0-9\-\.]/g, '');
		attachment.generatedFileName = attachment.generatedFileName.replace(/[^A-Za-z0-9\-\.]/g, '');

		// if generatedFileName is longer than 200
		if (attachment.generatedFileName && attachment.generatedFileName.length > 200) {
			// Split up filename
			let _filename_new = attachment.generatedFileName.split('.');
			// Get extension
			let _fileExt = _filename_new.pop();
			// Get filename
			let _filename_pop = _filename_new.pop();
			// Just in case filename is longer than 200 chars we make sure to take from the left
			let _filename_200 = S(_filename_pop).left(200).s;
			// Add it together
			let _final = _filename_200 + '.' + _fileExt;
			// Create attachment object
			attachment.fileName = _final;
			attachment.generatedFileName = _final;
		}

		// plugin.loginfo('attachment FINAL ! : ', attachment);

		var attachment_directory = path.join(attachments_folder_path, attachment_checksum);
		// plugin.loginfo('attachment_directory ! : ', attachment_directory);

		fs.mkdirp(attachment_directory, function (error, result) {
			// if we have an error, and it's not a directory already exists error then record it
			if (error && error.errno != -17) {
				plugin.logerror('Could not create a directory for storing the attachment !!!');
				return each_callback;
			}

			// Complete local path with the filename
			var attachment_full_path = path.join(attachment_directory, attachment.generatedFileName);
			// Log
			plugin.loginfo(`Storing ${attachment.generatedFileName} locally at ${attachment_full_path}`);
			// Write attachment to disk
			fs.writeFile(attachment_full_path, attachment.content, function (error) {
				// Log
				if (error) plugin.logerror(`Error saving attachment locally to path ${attachment_full_path}, error :`, error);

				// If we can store
				plugin.lognotice(`Attachment ${attachment.generatedFileName} successfully stored locally (${attachment.length} bytes)`);

				// if we have an attachment in tnef, unzip it and store the results
				if (attachment.generatedFileName.toLowerCase() === 'winmail.dat') {

					// set to true so later the emails[0].attachments gets updated
					is_tnef_attachment = true;

					// use tnef to extract the file into the same directory
					var exec_command = `tnef ${attachment_full_path} -C ${attachment_directory}`;

					plugin.lognotice('converting winmail.dat by calling :', exec_command);

					// execute the tnef process to extract the real attachment
					var tnef_process = exec(exec_command, function (error, stdout, stderr) {
						var general_error = stderr || error;

						// get the contents of the directory as all fo the attachments
						fs.readdir(attachment_directory, function (error, contents) {

							// loop over each file in the direoctory that is not winmail.dat and add it as an attachment
							async.eachLimit(contents.filter((fn) => fn !== 'winmail.dat'), 3, function (file_name, each_callback) {
								// get the size of the file from the stats
								var attachment_file_path = path.join(attachment_directory, file_name);
								fs.stat(attachment_file_path, function (error, stats) {

									if (error) plugin.logerror('errror getting stats, error :', error);

									var attachment = {
										'length' : stats ? +stats.size : 0,
										'fileName' : file_name,
										'generatedFileName' : file_name,
										'checksum' : attachment_checksum
									};

									// plugin.lognotice('tnef extracted attachment : ', attachment);

									_attachments.push(attachment);

									return each_callback();
								});
							},
							each_callback);
						});
					});

					// if the above can't capture large files, try working with this
					tnef_process.on('exit', (code) => {
						plugin.logwarn('tnef_process exit called');
					});

				} else {
					delete attachment.content;
					_attachments.push(attachment);
					return each_callback(null);
				}

			});
		});
	},
	function (error) {
		// Add attachment back to mail object
		mail_object.attachments = _attachments;
		// Log
		plugin.loginfo( `finished uploading all ${_attachments.length} attachments` );
		// Callback
		return cb(null, mail_object);
	});

}

// Check inline images and replace
function _checkInlineImages(plugin, email, callback) {
	// No need if there are no attachments
	if ( email.attachments && !email.attachments.length ) return callback(null, email);
	// Clean up any text inline image tags
	email.text = email.text.replace(/\[data:image(.*?)\]/g, '');
	email.html = email.html.replace(/\[data:image(.*?)\]/g, '');
	email.text = email.text.replace(/\[cid:(.*?)\]/g, '');
	email.html = email.html.replace(/\[cid:(.*?)\]/g, '');
	// Path to attachments dir
	var _attachments_folder_path = plugin.cfg.attachments.path;
	// Get cid settings
	var _cid = plugin.cfg.attachments.cid || 'cid';

	// plugin.loginfo('--------------------------------------');
	// plugin.loginfo('checkInlineImages');
	// plugin.loginfo('email.attachments : ', email.attachments);
	// plugin.loginfo('CID setting : ', _cid);
	// plugin.loginfo('--------------------------------------');

	// if we should leave inline images as cid values
	if ( _cid === 'cid' ) {
		// Return
		return callback(null, email);
	}

	// Loop over attachments
	email.attachments.forEach(function(attachment) {
		// Set attachment path
		var _attachment_directory = path.join(_attachments_folder_path, attachment.checksum);
		// Complete local path with the filename
		var _attachment_full_path = path.join(_attachment_directory, attachment.generatedFileName);
		var _contentid = attachment.cid ? attachment.cid : attachment.contentId ? attachment.contentId.replace(/<|>/g, '') : '';
		// Look for the cid in the html
		var _match = email.html.match(`cid:${_contentid}`);
		if (_match) {
			var _data_string;
			// Read file as base64
			if ( _cid === 'base64' ) {
				var _imageAsBase64 = fs.readFileSync(_attachment_full_path, 'base64');
				// Replace
				_data_string = `data:${attachment.contentType};base64,${_imageAsBase64}`;
			}
			else if ( _cid === 'path' ) {
				_data_string = `${_cid}/${attachment.generatedFileName}`;
			}
			// Loop over matches
			_match.forEach(function(cid) {
				// Replace images
				email.html = S(email.html).replaceAll('cid:' + _contentid, _data_string).s;
				email.html = S(email.html).replaceAll(_attachment_full_path, _data_string).s;
				// Remove attachment from attachment array
				if ( _cid === 'base64' ) {
					email.attachments = email.attachments.filter(a => a.checksum !== attachment.checksum);
				}
			})
		}
	})
	// Return
	return callback(null, email);
}
