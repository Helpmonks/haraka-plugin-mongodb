// haraka-plugin-mongodb

// Made by Helpmonks - http://helpmonks.com

/* jshint esversion: 6 */

'use strict';

// Require
var mongoc = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var async = require('async');
var uuid = require('uuid');
var moment = require('moment');
var fs = require('fs-extra');
var path = require('path');
// var MailParser = require("mailparser-mit").MailParser;
// var MailParser2 = require("mailparser").MailParser;
var simpleParser = require('mailparser').simpleParser
var exec = require('child_process').exec;

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

	_mp(plugin, connection, function(email_object) {

		// plugin.lognotice('--------------------------------------');
		// plugin.lognotice(' email_object.html ', email_object.html);
		// plugin.lognotice(' email_object.text ', email_object.text);
		// plugin.lognotice('--------------------------------------');

		// simpleParser(connection.transaction.message_stream, (error, mail) => {

		// 	plugin.lognotice('--------------------------------------');
		// 	plugin.lognotice(' PARSER2 ', mail.html);
		// 	plugin.lognotice('--------------------------------------');

			// Object.keys(email_object).forEach(function(key) {
			// 	var _val = email_object[key];
			// 	if (typeof _val === 'object') {
			// 		Object.keys(_val).forEach(function(_val_key) {
			// 			var _vall = _val[_val_key];
			// 			plugin.lognotice(`${_val_key} : ${_vall}`);
			// 		})
			// 	}
			// 	plugin.lognotice(`${key} : ${_val}`);
			// });

			// var _email = {
			// 	'raw': email_object,
			// 	'from': email_object.from,
			// 	'to': email_object.to,
			// 	'cc': email_object.cc,
			// 	'bcc': email_object.bcc,
			// 	'subject': email_object.subject,
			// 	'date': email_object.date,
			// 	'received_date': email_object.receivedDate,
			// 	'message_id': email_object.messageId || new ObjectID() + '@haraka',
			// 	'attachments': email_object.attachments || [],
			// 	'headers': email_object.headers,
			// 	'html': email_object.html,
			// 	'text': email_object.text,
			// 	'timestamp': new Date(),
			// 	'status': 'unprocessed',
			// 	'source': 'haraka',
			// 	'in_reply_to' : email_object.inReplyTo,
			// 	'reply_to' : email_object.replyTo,
			// 	'references' : email_object.references,
			// 	'pickup_date' : new Date(),
			// 	'mail_from' : connection.transaction.mail_from,
			// 	'rcpt_to' : connection.transaction.rcpt_to,
			// 	'size' : connection.transaction.data_bytes,
			// 	'transferred' : false
			// };

			// References
			// var _references = [];
			// if (email_object.references) {
			// 	if ( Array.isArray(email_object.references) ) {
			// 		_references = email_object.references.map(r => r.replace(/<|>/gm, ''));
			// 	}
			// 	_references = email_object.references.replace(/<|>/gm, '').split('');
			// }

			// MP 2.2 code
			var _email = {
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
				'html': email_object.attachments && email_object.attachments.length && email_object.attachments[0].contentType === 'text/calendar' ? 'This is a calendar invitation. Please see the attached file.' : email_object.html ? email_object.html : email_object.textAsHtml ? email_object.textAsHtml : null,
				'text': email_object.attachments && email_object.attachments.length && email_object.attachments[0].contentType === 'text/calendar' ? 'This is a calendar invitation. Please see the attached file.' : email_object.text ? email_object.text : null,
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
				'transferred' : false
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

		// })

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
	// var mailparser = new MailParser({
	// 	'streamAttachments': false
	// });
	// var parser = new MailParser2();
	// mailparser.on("end", function(mail) {
	// 	// connection.loginfo('MAILPARSER', plugin.cfg);
	// 	// connection.loginfo('MAILPARSER ATTACHMENTS', mail.attachments);
	// 	// Check if there are attachments. If so store them to disk
	// 	if ( mail.attachments ) {
	// 		_storeAttachments(connection, plugin, mail.attachments, mail, function(error, mail_object) {
	// 			return cb(mail_object);
	// 		});
	// 	}
	// 	else {
	// 		return cb(mail);
	// 	}
	// 	// parser.on('data', data => {
	// 	// 	connection.loginfo('--------------------------------------');
	// 	// 	connection.loginfo('PARSED 2 :', data);
	// 	// 	connection.loginfo('--------------------------------------');
	// 	// })
	// 	// parser.on('end', mail => {
	// 	// 	connection.loginfo('--------------------------------------');
	// 	// 	connection.loginfo('PARSED 2 END :', mail);
	// 	// 	connection.loginfo('--------------------------------------');
	// 	// 	return cb(mail);
	// 	// })
	// 	// connection.transaction.message_stream.pipe(parser, {});
	// });
	

	// connection.transaction.message_stream.pipe(mailparser, {});

	// MP 2
	simpleParser(connection.transaction.message_stream, (error, mail) => {
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

// Attachment code
function _storeAttachments(connection, plugin, attachments, mail_object, cb) {

	var _attachments = [];

	// loop through each attachment and attempt to store it locally
	var is_tnef_attachment = false;

	async.each(attachments, function (attachment, each_callback) {

		// if attachment type is inline we don't need to store it anymore as the inline images are replaced with base64 encoded data URIs in mp2
		if ( attachment && attachment.related ) {
			// Filter
			_attachments = _attachments.filter(a => a.checksum !== attachment.checksum);
			return each_callback();
		}

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
		attachment.length = attachment.size;
		// No more generatedFilename in 2.x
		attachment.fileName = attachment.filename || 'attachment.txt';
		attachment.generatedFileName = attachment.fileName;

		// For calendar events
		if ( attachment.contentType === 'text/calendar' ) {
			attachment.fileName = 'invite.ics';
			attachment.generatedFileName = 'invite.ics';
		}

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
