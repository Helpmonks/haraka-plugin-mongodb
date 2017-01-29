// queue_mongodb

// documentation via: haraka -c /etc/haraka -h plugins/queue_mongodb

// Put your plugin code here
// type: `haraka -h Plugins` for documentation on how to create a plugin

/* jshint esversion: 6 */

// Initialize connection once
var mongoc = require('mongodb').MongoClient;
var async = require('async');
var uuid = require('uuid');
var fs = require('fs-extra');
var path = require('path');
var MailParser = require("mailparser").MailParser;

var db_connection = null;
var settings = null;
var plugin = null;

// EXPORTS

exports.register = function() {

	plugin = this;

	settings = this.config.get('queue_mongodb.ini').main || {
        host: '107.170.85.161',
        port: '27017',
        name: '',
		pass: '',
		db: 'test',
		path: '/tmp',
		col: 'emails'
    };

    mongoc.connect(`mongodb://${settings.user}:${settings.pass}@${settings.host}:${settings.port}/${settings.db}`, function(err, database) {
        if (err) throw err;
        db_connection = database;
		plugin.lognotice('Successfully connected to MongoDB !!!');
		plugin.lognotice('--------------------------------------');
		plugin.lognotice('   Waiting for emails to arrive !!!   ');
		plugin.lognotice('--------------------------------------');
    });
};

// Hook for data
exports.hook_data = function(next, connection) {
    connection.transaction.parse_body = true;
    next();
};

// Hook for queue-ing
exports.hook_queue = function(next, connection) {
	plugin = this;
    var body = connection.transaction.body;

    _mp(connection, function(email_object) {

        var _email = {
            'raw': email_object,
            'from': email_object.from,
            'to': email_object.to,
            'subject': email_object.subject,
            'date': email_object.date,
            'received_date': email_object.receivedDate,
            'message_id': email_object.messageId,
            'attachments': email_object.attachments,
            'headers': email_object.headers,
            'html': email_object.html,
            'text': email_object.text,
            'timestamp': new Date(),
            'status': 'unprocessed',
            'source': 'haraka'
        };

        db_connection.collection(settings.col).insert(_email, function(err) {
            if (err) {
                next(DENY, "storage error");
            } else {
                next(OK);
            }
        });

    });

};

exports.shutdown = function() {
    db_connection.close();
};

// INTERNAL FUNCTIONS

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
        // connection.loginfo('MAILPARSER', settings);
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
		var attachments_folder_path = settings.path;

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
