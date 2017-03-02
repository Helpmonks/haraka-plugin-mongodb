// queue_mongodb

// documentation via: haraka -c /etc/haraka -h plugins/queue_mongodb

// Put your plugin code here
// type: `haraka -h Plugins` for documentation on how to create a plugin

/* jshint esversion: 6 */

'use strict';

// Require
var mongoc = require('mongodb').MongoClient;
var async = require('async');
var uuid = require('uuid');
var fs = require('fs-extra');
var path = require('path');
var MailParser = require("mailparser").MailParser;


exports.register = function () {
	var plugin = this;
	plugin.load_mongodb_ini();

	// some other plugin doing: inherits('haraka-plugin-mongodb')
    if (plugin.name !== 'mongodb') return;

    // Load on startup
	plugin.register_hook('init_master', 'initialize_mongodb');
	plugin.register_hook('init_child', 'initialize_mongodb');

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

	// Only connect if there is no server.notes.mongodb already
	if ( ! server.notes.mongodb ) {
		mongoc.connect(`mongodb://${plugin.cfg.mongodb.user}:${plugin.cfg.mongodb.pass}@${plugin.cfg.mongodb.host}:${plugin.cfg.mongodb.port}/${plugin.cfg.mongodb.db}`, function(err, database) {
			if (err) {
				plugin.logerror('ERROR connecting to MongoDB !!!');
				plugin.logerror(err);
				throw err;
			}
			server.notes.mongodb = database;
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

// Hook for data
exports.hook_data = function(next, connection) {
	connection.transaction.parse_body = true;
	next();
};

// Hook for queue-ing
exports.hook_queue = function(next, connection) {
	var plugin = this;
	var body = connection.transaction.body;

	_mp(connection, function(email_object) {

		var _email = {
			'raw': email_object,
			'from': email_object.from,
			'to': email_object.to,
			'cc': email_object.cc,
			'bcc': email_object.bcc,
			'subject': email_object.subject,
			'date': email_object.date,
			'received_date': email_object.receivedDate,
			'message_id': email_object.messageId,
			'attachments': email_object.attachments,
			'headers': email_object.headers,
			'html': email_object.html || email_object.text,
			'text': email_object.text,
			'timestamp': new Date(),
			'status': 'unprocessed',
			'source': 'haraka',
			'in_reply_to' : email_object.inReplyTo,
			'reply_to' : email_object.replyTo,
			'references' : email_object.references
		};

		server.notes.mongodb.collection(plugin.cfg.mongodb.col).insert(_email, function(err) {
			if (err) {
				plugin.logerror('--------------------------------------');
				plugin.logerror('ERROR ON INSERT : ', err);
				plugin.logerror('--------------------------------------');
				next(DENY, "storage error");
			} else {
				plugin.lognotice('--------------------------------------');
				plugin.lognotice(' Successfully stored the email !!! ');
				plugin.lognotice('--------------------------------------');
				next(OK);
			}
		});

	});

};

exports.shutdown = function() {
	var plugin = this;
	server.notes.mongodb.close();
};

// ------------------
// INTERNAL FUNCTIONS
// ------------------

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

function _mp(connection, cb) {
	var mailparser = new MailParser({
		'streamAttachments': false
	});

	mailparser.on("end", function(mail) {
		// connection.loginfo('MAILPARSER', plugin.cfg);
		// connection.loginfo('MAILPARSER ATTACHMENTS', mail.attachments);
		// Check if there are attachments. If so store them to disk
		if ( mail.attachments ) {
			_storeAttachments(mail.attachments, mail, function(error, mail_object) {
				return cb(mail_object);
			});
		}
		else {
			return cb(mail);
		}
	});
	connection.transaction.message_stream.pipe(mailparser, {});
}

// Attachment code
function _storeAttachments(attachments, mail_object, cb) {

	var _attachments = [];

	// loop through each attachment and attempt to store it locally
	var is_tnef_attachment = false;

	async.each(attachments, function (attachment, each_callback) {

		plugin.loginfo('Begin storing attachment : ', attachment);

		// Path to attachments dir
		var attachments_folder_path = plugin.cfg.attachments.path;

		// if there's no checksum for the attachment then generate our own uuid
		attachment.checksum = attachment.checksum || uuid.v4();
		var attachment_checksum = attachment.checksum;

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
			attachment = {
				contentType : attachment.contentType || '',
				fileName : _final,
				generatedFileName : _final,
				transferEncoding : attachment.transferEncoding || '',
				contentId : attachment.contentId || '',
				contentDisposition : attachment.contentDisposition || '',
				checksum : attachment_checksum,
				length : attachment.length || '',
				content : attachment.content || ''
			};
			// set to true so later the emails[0].attachments gets updated
			is_tnef_attachment = true;
		}

		var attachment_directory = path.join(attachments_folder_path, attachment_checksum);

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

									plugin.lognotice('tnef extracted attachment : ', attachment);

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
