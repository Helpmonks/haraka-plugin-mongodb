// haraka-plugin-mongodb

// Made by Helpmonks - http://helpmonks.com

// Require
const mongoc = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;
const async = require('async');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const fs = require('fs-extra');
const path = require('path');
const S = require('string');
const watch = require('watch');
const mime = require('mime');
const linkify = require('linkify-it')();
const Iconv = require('iconv').Iconv;
const simpleParser = require('mailparser').simpleParser;
const exec = require('child_process').exec;
const nodemailer = require('nodemailer');
const redis = require('ioredis');

const EmailBodyUtility = require('./email_body_utility');

/////////////////////////////////////////////////////////////////////////////////////////////////////////

exports.register = function () {
	var plugin = this;
	plugin.load_mongodb_ini();

	// some other plugin doing: inherits('haraka-plugin-mongodb')
	if (plugin.name !== 'mongodb') return;

	// Load on startup
	plugin.register_hook('init_master', 'initialize_mongodb');
	plugin.register_hook('init_child', 'initialize_mongodb');
	plugin.register_hook('init_master', 'initialize_redis');
	plugin.register_hook('init_child', 'initialize_redis');

	// Enable for queue
	if (plugin.cfg.enable.queue === 'yes') {
		plugin.register_hook('data', 'enable_transaction_body_parse');
		plugin.register_hook('queue', 'queue_to_mongodb');
		// Define mime type
		try {
			if (plugin.cfc.attachments.custom_content_type) {
				mime.define(plugin.cfc.attachments.custom_content_type)
				plugin.lognotice('------------------------------------------------- ');
				plugin.lognotice(' Successfully loaded the custom content types !!! ');
				plugin.lognotice('------------------------------------------------- ');
			}
		}
		catch(e) {

		}
	}
	// Enable for delivery results
	if (plugin.cfg.enable.delivery === 'yes') {
		plugin.register_hook('data_post', 'data_post_email');
		plugin.register_hook('send_email', 'sending_email');
		plugin.register_hook('get_mx', 'getting_mx');
		plugin.register_hook('deferred', 'deferred_email');
		plugin.register_hook('bounce', 'bounced_email');
		plugin.register_hook('delivered', 'save_results_to_mongodb');
	}
};

exports.load_mongodb_ini = function () {
	var plugin = this;

	plugin.cfg = plugin.config.get('mongodb.ini', {
		booleans: [
			'+enable.queue.yes',
			'+enable.delivery.yes',
			'+limits.incoming.no'
		]
	},
	function () {
		plugin.load_mongodb_ini();
	});

	plugin.cfg.limits.db = plugin.cfg.limits.db || 'mongodb';

};

exports.initialize_mongodb = function (next, server) {
	var plugin = this;
	var connectionString;

	// Only connect if there is no server.notes.mongodb already
	if ( ! server.notes.mongodb ) {

		if (plugin.cfg.mongodb.string) {
			connectionString = plugin.cfg.mongodb.string;
		}
		else {
			connectionString = 'mongodb://';
			if (plugin.cfg.mongodb.user && plugin.cfg.mongodb.pass) {
				connectionString += `${encodeURIComponent(plugin.cfg.mongodb.user)}:${encodeURIComponent(plugin.cfg.mongodb.pass)}@`;
			}
			connectionString += `${plugin.cfg.mongodb.host}:${plugin.cfg.mongodb.port}/${plugin.cfg.mongodb.db}`;
		}

		mongoc.connect(connectionString, { 'useNewUrlParser': true, 'keepAlive': true, 'connectTimeoutMS': 0, 'socketTimeoutMS': 0 }, function(err, client) {
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
			plugin.lognotice(` with: ${connectionString} `);
			plugin.lognotice('-------------------------------------- ');

			if (plugin.cfg.enable.queue === 'yes') {
				plugin.lognotice('-------------------------------------- ');
				plugin.lognotice('   Waiting for emails to arrive !!!    ');
				plugin.lognotice('-------------------------------------- ');
			}
			if (plugin.cfg.enable.delivery === 'yes') {
				plugin.lognotice('-------------------------------------- ');
				plugin.lognotice('   Waiting for emails to be sent !!!    ');
				plugin.lognotice('-------------------------------------- ');
			}
			// Initiate a watch on the attachment path
			_checkAttachmentPaths(plugin);
			// Create Indexes
			server.notes.mongodb.collection(plugin.cfg.collections.queue).createIndex([
				{
					'key' : { 'received_date' : 1 },
					'background' : true
				},
				{
					'key' : { 'received_date' : -1 },
					'background' : true
				},
				{
					'key' : { 'message_id' : 1 },
					'background' : true
				},
				{
					'key' : { 'transferred' : 1, 'status' : 1, 'received_date' : 1 },
					'background' : true
				},
				{
					'key' : { 'transferred' : 1, 'status' : 1, 'timestamp' : 1 },
					'background' : true
				},
				{
					'key' : { 'transferred' : 1, 'status' : 1, 'processed' : 1, 'timestamp' : 1 },
					'background' : true
				},
			]);
			// Limits
			if ( plugin.cfg.limits.incoming === 'yes' && plugin.cfg.limits.db === 'mongodb' ) {
				server.notes.mongodb.collection(plugin.cfg.limits.incoming_collection).createIndex([
					{
						'key' : { 'from' : 1, 'to' : 1 },
						'background' : true
					},
					{
						'key' : { 'timestamp' : 1 },
						'background' : true,
						'expireAfterSeconds' : parseInt(plugin.cfg.limits.incoming_seconds)
					}
				]);
			}
			next();
		});
	}
	else {
		plugin.loginfo('There is already a MongoDB connection in the server.notes !!!');
		next();
	}
};

exports.initialize_redis = function(next, server) {

	var plugin = this;

	// No redis
	if ( plugin.cfg.limits.db !== 'redis' ) return next();

	// If there is already a connection
	if ( server.notes.redis ) {
		plugin.loginfo('There is already a Redis connection in the server.notes !!!');
		return next();
	}

	// Client options
	var _client_options = plugin.cfg.redis.string ? plugin.cfg.redis.string : {
		port: plugin.cfg.redis.port,
		host: plugin.cfg.redis.host,
		dropBufferSupport : true,
		enableOfflineQueue : true,
		showFriendlyErrorStack : false,
		keepAlive : 0,
		connectTimeout : 30000
	};

	// Connect to redis
	var _client = plugin.cfg.redis.string ? new redis(_client_options, { keepAlive: 0, dropBufferSupport: true, enableOfflineQueue : true, connectTimeout: 30000, showFriendlyErrorStack : false }) : new redis(_client_options);

	_client.on('ready', function () {
		plugin.loginfo('-----------------------------------------------------');
		plugin.loginfo(`Successfully connected to Redis!`);
		plugin.loginfo(`Host: ${plugin.cfg.redis.host} Port: ${plugin.cfg.redis.port}`);
		plugin.loginfo('-----------------------------------------------------');
		server.notes.redis = _client;
	});

	_client.on('error', function (error) {
		plugin.loginfo(`REDIS: client on error: `, error);
	});

	next();

}

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

	var _stream = connection && connection.transaction && connection.transaction.message_stream ? true : false;
	if (!_stream) return next();

	var plugin = this;
	var body = connection.transaction.body;

	var _size = connection && connection.transaction ? connection.transaction.data_bytes : null;
	var _header = connection && connection.transaction && connection.transaction.header ? connection.transaction.header : null;

	var _body_html;
	var _body_text;

	async.waterfall([
		function (waterfall_callback) {
			// Check limit
			_limitIncoming(plugin, _header, function(error, status) {
				// plugin.lognotice('limits cb: ', status)
				return waterfall_callback( status ? 'limit' : null );
			});
		},
		function (waterfall_callback) {
			_mp(plugin, connection, function(error, email) {
				if (error) {
					plugin.logerror('--------------------------------------');
					plugin.logerror(' Error from _mp !!! ', error.message);
					plugin.logerror('--------------------------------------');
					return waterfall_callback(error, email);
				}
				_body_html = email.html || null;
				_body_text = email.text || null;
				return waterfall_callback(null, email);
			});
		},
		function (email, waterfall_callback) {
			// Get proper body
			EmailBodyUtility.getHtmlAndTextBody(email, body, function (error, html_and_text_body_info) {
				if (error || ! html_and_text_body_info) {
					return waterfall_callback(error || `unable to extract any email body data from email id:'${email._id}'`);
				}

				return waterfall_callback(null, html_and_text_body_info, email);
			});
		},
		function (body_info, email, waterfall_callback) {
			plugin.lognotice(' body_info.meta !!! ', body_info.meta);
			// Put values into object
			email.extracted_html_from = body_info.meta.html_source;
			email.extracted_text_from = body_info.meta.text_source;
			// Add html into email
			email.html = body_info.html;
			email.text = body_info.text;
			// Check for inline images
			_checkInlineImages(plugin, email, function(error, email) {
				// Return
				return waterfall_callback(null, email);
			});
		}
	],
	function (error, email_object) {

		// For limit
		if (error === 'limit') {
			// plugin.lognotice('--------------------------------------');
			// plugin.lognotice(`Too many emails from this sender at the same time !!!`);
			// plugin.lognotice('--------------------------------------');
			return next(DENYSOFT, "Too many emails from this sender at the same time");
		}

		if (error) {
			plugin.logerror('--------------------------------------');
			plugin.logerror(`Error parsing email: `, error.message);
			plugin.logerror('--------------------------------------');
			_sendMessageBack('parsing', plugin, _header, error);
			return next(DENYDISCONNECT, "storage error");
		}

		// By default we do not store the haraka body and the whole email object
		var _store_raw = plugin.cfg.message && plugin.cfg.message.store_raw === 'yes' ? true : false;

		// If we have a size limit
		if (_size && plugin.cfg.message && plugin.cfg.message.limit) {
			// If message is bigger than limit
			if ( _size > parseInt(plugin.cfg.message.limit) ) {
				_store_raw = false;
			}
		}

		var _now = new Date();

		// Mail object
		var _email = {
			'haraka_body': _store_raw && body ? body : {},
			'raw_html': _body_html,
			'raw_text': _body_text,
			'raw': _store_raw ? email_object : {},
			'from': email_object.headers.get('from') ? email_object.headers.get('from').value : null,
			'to': email_object.headers.get('to') ? email_object.headers.get('to').value : null,
			'cc': email_object.headers.get('cc') ? email_object.headers.get('cc').value : null,
			'bcc': email_object.headers.get('bcc') ? email_object.headers.get('bcc').value : null,
			'subject': email_object.subject,
			'date': email_object.date || email_object.headers.get('date'),
			'received_date': _now,
			'message_id': email_object.messageId ? email_object.messageId.replace(/<|>/gm, '') : new ObjectID() + '@haraka-helpmonks.com',
			'attachments': email_object.attachments || [],
			'headers': email_object.headers,
			'html': email_object.html,
			'text': email_object.text ? email_object.text : null,
			'timestamp': _now,
			'status': 'unprocessed',
			'source': 'haraka',
			'in_reply_to' : email_object.inReplyTo,
			'reply_to' : email_object.headers.get('reply-to') ? email_object.headers.get('reply-to').value : null,
			'references' : email_object.references,
			'pickup_date' : _now,
			'mail_from' : connection && connection.transaction ? connection.transaction.mail_from : null,
			'rcpt_to' : connection && connection.transaction ? connection.transaction.rcpt_to : null,
			'size' : connection && connection.transaction ? connection.transaction.data_bytes : null,
			'transferred' : false,
			'processed' : false,
			'extracted_html_from': email_object.extracted_html_from,
			'extracted_text_from': email_object.extracted_text_from
		};

		// If we have a size limit
		if (plugin.cfg.message && plugin.cfg.message.limit) {
			// Get size of email object
			var _size_email_obj = JSON.stringify(_email).length;
			// If message is bigger than limit
			if ( _size_email_obj > parseInt(plugin.cfg.message.limit) ) {
				plugin.logerror('--------------------------------------');
				plugin.logerror(' Message size is too large. Sending back an error. Size is: ', _size);
				plugin.logerror('--------------------------------------');
				_sendMessageBack('limit', plugin, _header);
				return next(DENYDISCONNECT, "storage error");
			}
		}

		// Add to db
		server.notes.mongodb.collection(plugin.cfg.collections.queue).insertOne(_email, { checkKeys : false }, function(err) {
			if (err) {
				// Remove the large fields and try again
				delete _email.haraka_body;
				delete _email.raw;
				// Let's try again
				server.notes.mongodb.collection(plugin.cfg.collections.queue).insertOne(_email, { checkKeys : false }, function(err) {
					if (err) {
						plugin.logerror('--------------------------------------');
						plugin.logerror(`Error on insert of the email with the message_id: ${_email.message_id} Error: `, err.message);
						plugin.logerror('--------------------------------------');
						// Send error
						// _sendMessageBack('insert', plugin, _header, err);
						// Return
						return next(DENYSOFT, "storage error");
					}
					else {
						plugin.lognotice('--------------------------------------');
						plugin.lognotice(` Successfully stored the email with the message_id: ${_email.message_id} !!! `);
						plugin.lognotice('--------------------------------------');
						return next(OK);
					}
				})
			}
			else {
				plugin.lognotice('--------------------------------------');
				plugin.lognotice(` Successfully stored the email with the message_id: ${_email.message_id} !!! `);
				plugin.lognotice('--------------------------------------');
				return next(OK);
			}
		});

	});
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
};

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
	};
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
};

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
	};
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
};

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
	};
	// Save
	_saveDeliveryResults(_data, server.notes.mongodb, plugin);
	next();
};

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
	server.notes.mongodb.collection(plugin.cfg.collections.delivery).find(_query).toArray(function(err, record) {
		if (err) {
			plugin.lognotice('--------------------------------------');
			plugin.lognotice('Error on find for bounced email : ', err);
			plugin.lognotice('--------------------------------------');
			return next();
		}
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
		};
		// Save
		_saveDeliveryResults(_data, server.notes.mongodb, plugin);
		// Send bounce message or not
		if ( record && record.length ) {
			return next(OK);
		}
		else {
			return next();
		}
	});
};


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

function _sendMessageBack(msg_type, plugin, email_headers, error_object) {
	// plugin.lognotice(`Email msg_type: ${msg_type}`)
	// plugin.lognotice(`Email email_headers: ${email_headers}`)
	// plugin.lognotice(`Email plugin: ${plugin.cfg}`)
	// plugin.lognotice(`Email plugin smtp: ${plugin.cfg.smtp}`)
	// Check for host
	if (plugin.cfg.smtp && !plugin.cfg.smtp.host) return;
	if (!email_headers) return;
	// Error object
	error_object = error_object || null;
	// Get SMTP object
	var _smtp_options = _createSmtpObject(plugin);
	var _smtpTransport = nodemailer.createTransport(_smtp_options);
	// Get reply address
	var _to = email_headers.headers_decoded['reply-to'] || email_headers.headers_decoded.from || email_headers.headers.mail_from && email_headers.headers.mail_from.original || null;
	// if to is null abort
	if (!_to) return;
	// Text
	var _text;
	// Text depending on msg_type
	switch(msg_type) {
		case 'limit':
			_text = plugin.cfg.smtp.msg_limit;
			break;
		case 'insert':
			_text = plugin.cfg.smtp.msg_error_insert;
			break;
		case 'parsing':
			_text = plugin.cfg.smtp.msg_error_parsing;
			break;
	}
	// Error text
	var _text_error = error_object ? '\n\n' + error_object : '';
	// Message-ID
	var _message_id = email_headers.headers_decoded && email_headers.headers_decoded['message-id'] || email_headers['message-id'] || email_headers['Message-ID'] || null;
	// FROM
	var _from = plugin.cfg.smtp.from;
	var _from_split = _from.split('@');
	// Do not send a message to any root or java or other names
	if (_message_id) {
		var _message_id_lc = _message_id.toLowerCase();
		if ( _message_id_lc.includes('postmaster') || _message_id_lc.includes('root') || _message_id_lc.includes('javamail') || _message_id_lc.includes('daemon') || _message_id_lc.includes('server') || _message_id_lc.includes('notreply') || _message_id_lc.includes('not-reply') || _message_id_lc.includes('not_reply') || _message_id_lc.includes('no-reply') || _message_id_lc.includes('noreply') || _message_id_lc.includes('no_reply') || _message_id_lc.includes(_from_split[1]) ) {
			return;
		}
	}
	// Do not set to certain email addresses
	if ( _to.includes('postmaster') || _to.includes('root') || _to.includes('javamail') || _to.includes('daemon') || _to.includes('server') || _to.includes('notreply') || _to.includes('noreply') || _to.includes('not-reply') || _to.includes('not_reply') || _to.includes('no_reply') || _to.includes('no-reply') || _to.includes(_from_split[1]) ) {
		return;
	}
	// Subject
	var _subject = email_headers.headers_decoded && email_headers.headers_decoded['subject'] || email_headers.subject || email_headers.Subject || null;
	// CC / BCC
	var _cc = plugin.cfg.smtp.cc ? plugin.cfg.smtp.cc.split(',') : [];
	var _bcc = plugin.cfg.smtp.bcc ? plugin.cfg.smtp.bcc.split(',') : [];
	// Mailbox
	var _sent_from = email_headers.headers_decoded.to || email_headers.headers.to || null;
	if (_sent_from) _cc.push(_sent_from);
	// Mail options
	var _mail_options = {
		'from' : _from,
		'to' : _to,
		'cc' : _cc,
		'bcc' : _bcc,
		'subject' : 'Message with subject: "' + _subject + '" not delivered. ID: ' + _message_id,
		'text' : `${moment().format('dddd, MMMM Do YYYY, h:mm:ss a Z')}\n\n${_text}${_text_error}\n\nBelow is the raw header for your investigation:\n\n${email_headers}`
	}
	// Send message
	_smtpTransport.sendMail(_mail_options, function (error, response) {
		plugin.lognotice("error", error);
		plugin.lognotice("response", response);
		smtpTransport.close();
	});
}

// Limits
function _limitIncoming(plugin, email_headers, cb) {
	// No limits check
	if (plugin.cfg.limits.incoming === 'no') {
		return cb(null, null);
	}
	// Header not valid
	if (!email_headers) {
		return cb(null, null);
	}
	// FROM
	var _from = email_headers.headers_decoded['reply-to'] || email_headers.headers_decoded.from || email_headers.headers.mail_from && email_headers.headers.mail_from.original || null;
	// TO
	var _to = email_headers.headers_decoded.to || email_headers.headers.to || null;
	// if to or from are null abort
	if (!_from || !_to) {
		return cb(null, null);
	};
	// Make sure we got the email address
	_from = _from.map(t => t.address || t)[0];
	// Clean from
	_from = _from.replace(/<|>/gm, '');
	// TO
	_to = _to.map(t => t.address || t);
	// Check excludes
	var _from_split = _from.split('@');
	// plugin.lognotice("_from_split", _from_split);
	if ( plugin.cfg.limits.exclude.includes(_from_split[1]) ) {
		// plugin.lognotice("Exclude: ", _from);
		return cb(null, null);
	}
	// Check include
	var _check = true;
	var _limit_include = plugin.cfg.limits.include || [];
	_limit_include = JSON.parse(_limit_include);
	// Include has values
	if ( _limit_include.length && _limit_include.includes(_from_split[1]) ) {
		_check = true;
	}
	else {
		_check = false;
	}
	// Include is empty
	if ( !_limit_include.length ) {
		_check = true;
	}
	// Return depending on check
	if (!_check) {
		return cb(null, null);
	}
	// Which db
	var _is_mongodb = plugin.cfg.limits.db === 'mongodb' ? true : false;
	// Loop
	async.eachSeries(_to, function(t, each_callback) {
		if (_is_mongodb) {
			// Object for query and insert
			var _obj = { 'from' : _from, 'to' : t };
			// Check
			async.waterfall([
				// Check
				function (waterfall_callback) {
					server.notes.mongodb.collection(plugin.cfg.limits.incoming_collection).findOne(_obj, function(err, record) {
						// plugin.lognotice("record", record);
						// If found
						if (record && record.from) {
							plugin.lognotice('--------------------------------------');
							plugin.lognotice(`Too many emails within ${plugin.cfg.limits.incoming_seconds} seconds`);
							plugin.lognotice(`from ${_from} !!!`);
							plugin.lognotice('--------------------------------------');
							return waterfall_callback(true);
						}
						return waterfall_callback(null);
					});
				},
				// Insert
				function (waterfall_callback) {
					waterfall_callback(null);
					_obj.timestamp = new Date();
					server.notes.mongodb.collection(plugin.cfg.limits.incoming_collection).insertOne(_obj, { checkKeys : false }, function(err) {

					});
				}
			],
			function (error) {
				return each_callback(error);
			});
		}
		else {
			// Key
			var _key = `${_from}_${_to}`.replace(/[^A-Za-z0-9]/g,'');
			// Check for key
			server.notes.redis.get(_key, function(error, data) {
				// If here
				if (data) {
					plugin.lognotice('--------------------------------------');
					plugin.lognotice(`Too many emails within ${plugin.cfg.limits.incoming_seconds} seconds`);
					plugin.lognotice(`from ${_from} !!!`);
					plugin.lognotice('--------------------------------------');
					return each_callback(true);
				}
				// Else add key
				server.notes.redis.set(_key, true, "EX", parseInt(plugin.cfg.limits.incoming_seconds));
				// Return
				each_callback(null);
			});
		}
	},
	function(error) {
		return cb(null, error || null);
	});
}

// Create SMTP object for sending
function _createSmtpObject(plugin) {
	var _smtp = {
		'host' : plugin.cfg.smtp.host,
		'secure' : plugin.cfg.smtp.ssl === 'yes' ? true : false,
		'port' : plugin.cfg.smtp.port,
		'auth' : {
			'user' : plugin.cfg.smtp.user,
			'pass' : plugin.cfg.smtp.pass
		},
		'pool' : true,
		'maxMessages' : 'Infinity',
		'maxConnections' : 5,
		'connectionTimeout' : 60000,
		'greetingTimeout' : 60000,
		'tls' : plugin.cfg.smtp.tls === 'yes' ? {
			ciphers : 'SSLv3',
			rejectUnauthorized: false
		} : { rejectUnauthorized: false }
	};
	return _smtp;
};


// Add to delivery log
function _saveDeliveryResults(data_object, conn, plugin_object, callback) {
	// Catch if something is not defined
	// if (!plugin_object || !plugin_object.cfc || plugin_object.cfg.collections) return callback && callback(null);
	// if (!conn || !conn.collection) return callback && callback(null);
	// Save
	conn.collection(plugin_object.cfg.collections.delivery).insertOne(data_object, { checkKeys : false }, function(err) {
		if (err) {
			plugin_object.logerror('--------------------------------------');
			plugin_object.logerror('Error on insert into delivery : ', err);
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
	// Options
	var _options = { Iconv, 'skipImageLinks' : true };
	if (plugin.cfg.message && plugin.cfg.message.limit) _options.maxHtmlLengthToParse = plugin.cfg.message.limit;
	// Parse
	simpleParser(connection.transaction.message_stream, _options, (error, mail) => {
		if ( mail && mail.attachments ) {
			_storeAttachments(connection, plugin, mail.attachments, mail, function(error, mail_object) {
				return cb(error, mail_object);
			});
		}
		else {
			return cb(error, mail);
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

	// Filter attachments starting with ~
	attachments = attachments.filter(a => a.filename && a.filename.startsWith('~') ? false : true);

	// If no attachment anymore
	if (!attachments.length) return cb(null, mail_object);

	async.eachSeries(attachments, function(attachment, each_callback) {

		// if attachment type is inline we don't need to store it anymore as the inline images are replaced with base64 encoded data URIs in mp2
		// if ( attachment && attachment.related ) {
		// 	// Filter
		// 	_attachments = _attachments.filter(a => a.checksum !== attachment.checksum);
		// 	return each_callback();
		// }

		plugin.loginfo('--------------------------------------');
		plugin.loginfo('Begin storing attachment');
		plugin.loginfo('filename : ', attachment.filename);
		// plugin.loginfo('Headers : ', attachment.headers);
		// plugin.loginfo('contentType : ', attachment.contentType);
		// plugin.loginfo('contentDisposition : ', attachment.contentDisposition);
		// plugin.loginfo('checksum : ', attachment.checksum);
		// plugin.loginfo('size : ', attachment.size);
		// plugin.loginfo('contentId : ', attachment.contentId);
		// plugin.loginfo('cid : ', attachment.cid);
		// plugin.loginfo('related : ', attachment.related);
		plugin.loginfo('--------------------------------------');

		try {

			// Remove headers
			delete attachment.headers;

			// Check contentype and check blocked attachments
			if (attachment.contentType) {
				// Filter out if type is on the reject list
				if ( plugin.cfg.attachments.reject && plugin.cfg.attachments.reject.length && plugin.cfg.attachments.reject.includes(attachment.contentType) ) {
					plugin.loginfo('--------------------------------------');
					plugin.loginfo('Following attachment is blocked:');
					plugin.loginfo('filename : ', attachment.filename);
					plugin.loginfo('contentType : ', attachment.contentType);
					plugin.loginfo('--------------------------------------');
					_attachments = _attachments.filter(a => a.checksum !== attachment.checksum);
					return each_callback();
				}
			}

			// Path to attachments dir
			var attachments_folder_path = plugin.cfg.attachments.path;
			// plugin.loginfo('attachments_folder_path : ', attachments_folder_path);

			// if there's no checksum for the attachment then generate our own uuid
			// attachment.checksum = attachment.checksum || uuid.v4();
			var attachment_checksum = attachment.checksum || uuidv4();
			// plugin.loginfo('Begin storing attachment : ', attachment.checksum, attachment_checksum);

			// Size is in another field in 2.x
			attachment.length = attachment.size || attachment.length;
			// No more generatedFilename in 2.x
			attachment.fileName = attachment.filename || attachment.fileName || 'attachment.txt';
			attachment.generatedFileName = attachment.generatedFileName || attachment.fileName;

			// If not CID exists
			attachment.cid = attachment.cid ? attachment.cid : attachment_checksum;

			// if attachment.contentDisposition doesn't exits
			if ( !attachment.contentDisposition ) {
				attachment.contentDisposition = attachment.type || 'attachment';
			}

			// For calendar events
			if ( attachment.contentType && attachment.contentType === 'text/calendar' ) {
				attachment.fileName = 'invite.ics';
				attachment.generatedFileName = 'invite.ics';
			}

			// For delivery messages
			if ( attachment.contentType && attachment.contentType === 'message/delivery-status' ) {
				attachment.fileName = 'delivery_status.txt';
				attachment.generatedFileName = 'delivery_status.txt';
			}

			// If filename is attachment.txt
			if (attachment.fileName === 'attachment.txt' && attachment.contentType && attachment.contentType.includes('/') ) {
				// Get ext from contenttype
				try {
					var _ext = attachment.contentType.indexOf('rfc822') === -1 ? mime.getExtension(attachment.contentType) : 'eml';
					if (_ext) {
						attachment.fileName = `attachment.${_ext}`;
						attachment.generatedFileName = attachment.fileName;
					}
				} catch(e) {
					plugin.loginfo('Not able to parse extension from contenttype')
				}
			}

			// Filename cleanup
			if (attachment.fileName !== 'attachment.txt' && attachment.fileName !== 'invite.ics') {
				var _file_names = _cleanFileName(attachment.fileName, attachment.generatedFileName);
				attachment.fileName = _file_names.file_name;
				attachment.generatedFileName = _file_names.generated_file_name;
			}

			// Split up filename
			var _fn_split = attachment.fileName.split('.');
			var _is_invalid = _fn_split && _fn_split[1] === 'undefined' || _fn_split.length === 1 ? true : false;

			// Set extension based on content type
			if (attachment.contentType && _is_invalid) {
				// Get extension
				var _fn_ext = mime.getExtension(attachment.contentType);
				// Add it together
				var _fn_final = _fn_split[0] + '.' + _fn_ext;
				// Create attachment object
				attachment.fileName = _fn_final;
				attachment.generatedFileName = _fn_final;
			}

			// if generatedFileName is longer than 200
			if (attachment.generatedFileName && attachment.generatedFileName.length > 200) {
				// Split up filename
				var _filename_new = attachment.generatedFileName.split('.');
				// Get extension
				var _fileExt = _filename_new.pop();
				// Get filename
				var _filename_pop = _filename_new[0];
				// Just in case filename is longer than 200 chars we make sure to take from the left
				var _filename_200 = S(_filename_pop).left(200).s;
				// Add it together
				var _final = _filename_200 + '.' + _fileExt;
				// Create attachment object
				attachment.fileName = _final;
				attachment.generatedFileName = _final;
			}

			var attachment_directory = path.join(attachments_folder_path, attachment_checksum);
			// plugin.loginfo('attachment_directory ! : ', attachment_directory);

			fs.mkdirp(attachment_directory, function (error, result) {
				// if we have an error, and it's not a directory already exists error then record it
				if (error && error.errno != -17) {
					plugin.logerror('Could not create a directory for storing the attachment !!!');
					return each_callback();
				}

				// Complete local path with the filename
				var attachment_full_path = path.join(attachment_directory, attachment.generatedFileName);
				// Log
				plugin.loginfo(`Storing ${attachment.generatedFileName} at ${attachment_full_path}`);
				// Write attachment to disk
				fs.writeFile(attachment_full_path, attachment.content, function (error) {
					// Log
					if (error) {
						plugin.logerror(`Error saving attachment locally to path ${attachment_full_path}, error :`, error);
						return each_callback();
					}

					// If we can store
					plugin.lognotice(`Attachment ${attachment.generatedFileName} (${attachment.length} bytes) successfully stored`);

					// if we have an attachment in tnef, unzip it and store the results
					if (attachment.generatedFileName.toLowerCase() === 'winmail.dat') {

						// set to true so later the emails[0].attachments gets updated
						is_tnef_attachment = true;

						// use tnef to extract the file into the same directory
						var exec_command = `tnef ${attachment_full_path} -C ${attachment_directory}`;

						plugin.lognotice('WINMAIL: Converting :', exec_command);

						// execute the tnef process to extract the real attachment
						var tnef_process = exec(exec_command, function (error, stdout, stderr) {
							var general_error = stderr || error;

							// get the contents of the directory as all for the attachments
							fs.readdir(attachment_directory, function (error, contents) {

								// loop over each file in the directory that is not winmail.dat and add it as an attachment
								async.eachLimit(contents.filter((fn) => fn !== 'winmail.dat'), 3, function (file_name, each_callback) {

									// Path to original file
									var _path_org = path.join(attachment_directory, file_name);
									// plugin.loginfo(`WINMAIL.DAT: PATH ORG: ${_path_org}`);

									// Convert filename
									var _file_names = _cleanFileName(file_name, file_name);
									var _file_name_new = _file_names.file_name;
									// plugin.loginfo(`WINMAIL.DAT: NEW NAME: ${_file_name_new}`);

									// Path to new file
									var _path_new = path.join(attachment_directory, _file_name_new);
									// plugin.loginfo(`WINMAIL.DAT: NEW PATH: ${_file_name_new}`);

									// Convert the name on disk
									try {
										fs.moveSync(_path_org, _path_new, { overwrite: true });
									}
									catch(e) {
										plugin.logerror('error converting the name on disl, error :', e);
										return each_callback();
									}

									// get the size of the file from the stats
									fs.stat(_path_new, function (error, stats) {

										if (error) {
											plugin.logerror('error getting stats, error :', error);
											return each_callback();
										}

										var attachment = {
											'length' : stats ? +stats.size : 0,
											'fileName' : _file_name_new,
											'generatedFileName' : _file_name_new,
											'checksum' : attachment_checksum
										};
										// plugin.loginfo(`WINMAIL.DAT: ATTACHMENT OBJECT: ${_file_name_new}`);
										// If we can store
										plugin.loginfo(`WINMAIL: Attachment ${_file_name_new} successfully stored locally`);

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

		}
		catch(e) {
			plugin.loginfo('---------------------------- Error in attachments !!', e);
			return each_callback(null);
		}

	},
	function (error) {
		// If error
		if (error) {
			plugin.loginfo('Error in attachments', error, _attachments);
			return cb(null, mail_object);
		}
		// Add attachment back to mail object
		mail_object.attachments = _attachments;
		// Log
		if (_attachments.length) {
			plugin.loginfo('--------------------------------------');
			plugin.loginfo( `Finished processing of ${_attachments.length} attachments` );
			plugin.loginfo('--------------------------------------');
		}
		// Callback
		return cb(null, mail_object);
	});

}

// Check inline images and replace
function _checkInlineImages(plugin, email, callback) {

	// No need if there are no attachments
	if ( email.attachments && !email.attachments.length ) return callback(null, email);

	// Clean up any text inline image tags
	// email.text = email.text.replace(/(\[data:image(.*?)\]|\[cid:(.*?)\])/g, '');
	// email.html = email.html.replace(/(\[data:image(.*?)\]|\[cid:(.*?)\])/g, '');

	// Get cid settings
	var _cid = plugin.cfg.attachments.cid || 'cid';

	// if we should leave inline images as cid values
	if ( _cid === 'cid' ) {
		// Return
		return callback(null, email);
	}

	// Path to attachments dir
	var _attachments_folder_path = plugin.cfg.attachments.path;

	// plugin.loginfo('--------------------------------------');
	// plugin.loginfo('checkInlineImages');
	// plugin.loginfo('--------------------------------------');

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
			});
		}
	});
	// Return
	return callback(null, email);
}

// Cleanup filename of attachment
function _cleanFileName(file_name, generated_file_name) {

	// Split filename by last dot
	var _fN = file_name.split(/\.(?=[^\.]+$)/);
	// Clean up filename that could potentially cause an issue
	var _fN_clean = _fN[0].replace(/[^A-Za-z0-9]/g, '_');

	// Split generated filename by last dot
	var _fNG = generated_file_name.split(/\.(?=[^\.]+$)/);
	// Clean up filename that could potentially cause an issue
	var _fNG_clean = _fNG[0].replace(/[^A-Za-z0-9]/g, '_');

	// Return
	return {
		'file_name' : `${_fN_clean}.${_fN[1]}`,
		'generated_file_name' : `${_fNG_clean}.${_fNG[1]}`
	};

}

// Check attachment paths and that we have access
function _checkAttachmentPaths(plugin) {

	// Only for incoming
	if (plugin.cfg.enable.delivery === 'yes') return;

	// Get paths
	var _attachment_path = plugin.cfg.attachments.path_check;

	// if not defined
	if (!_attachment_path) return;

	var _pathtowatch = _attachment_path;
	var _watch_options = {
		'ignoreDotFiles' : false,
		'interval' : 1,
		'ignoreUnreadableDir' : false,
		'ignoreNotPermitted' : false,
		'ignoreDirectoryPattern' : false
	};

	_pathtowatch = `${_pathtowatch}check/`.replace('//','/');

	plugin.lognotice( `---------------------------------------------------------------` );
	plugin.lognotice( `Starting directory watch on:` );
	plugin.lognotice( `${_pathtowatch}` );
	plugin.lognotice( `---------------------------------------------------------------` );

	var _the_file = `${_pathtowatch}.helpmonks_watch`

	// Create a file in the attachment dir
	fs.ensureFileSync(_the_file);

	watch.createMonitor(_pathtowatch, function (monitor) {
		monitor.files[_the_file];
		// Handle new files
		monitor.on("created", function (f, stat) {
		})
		// Handle file changes
		monitor.on("changed", function (f, curr, prev) {
		})
		// Handle removed files
		monitor.on("removed", function (f, stat) {
			// Only exit if the path contains our watch file
			if ( !f.includes('.helpmonks_watch') ) return;
			plugin.logerror( `---------------------------------------------------------------` );
			plugin.logerror( 'Attachment directory is not accessible anymore!!!')
			plugin.logerror( `---------------------------------------------------------------` );
			// Exit out with an error
			throw 'Attachment directory is not available'
		})
	});
}

