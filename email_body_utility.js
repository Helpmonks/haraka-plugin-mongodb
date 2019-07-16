const EmailBodyUtility = function () {
	const stream = require('stream');

	const async = require('async');
	const linkify = require('linkify-it')();
	const decode = require('decode-html');
	const detectCharacterEncoding = require('detect-character-encoding');
	const Splitter = require('mailsplit').Splitter;

	const _default_html_field_order = 'bodytext_html mailparser_html mailparser_text_as_html'.split(' ');
	const _default_text_field_order = 'bodytext_plain mailparser_text'.split(' ');

	const _log_module = false;
	const _log_all_fields = false && _log_module;

	const _iso_8859_charset_regex = /text\/html; charset=iso-8859-\d/gim;
	const _windows_1252_charset_regex = /text\/html; charset=Windows-1252/gim;

	// initialize linkify when this module is first required
	_initLinkify();


	////////////////// Exposed Functions ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	const getHtmlAndTextBody = function (email_obj, body, callback) {

		var has_rfc_822_message = false;

		async.waterfall([
				/* get basic html and text bodies */
				function (waterfall_callback) {

					has_rfc_822_message = _getDistinctFieldValues(body, 'ct').includes('message/rfc822');
					_log_module && has_rfc_822_message && console.log(`\ngetHtmlAndTextBody(), has RFC-822 message, using mailparser result`);

					// continue to use mailparser result if rfc_822 message is present
					var html_field_order = has_rfc_822_message ? 'mailparser_html mailparser_text_as_html'.split(' ') : _default_html_field_order;
					var text_field_order = has_rfc_822_message ? 'mailparser_text bodytext_plain'.split(' ') : _default_text_field_order;

					_log_module && console.log(`\ngetHtmlAndTextBody(), extracting 'html'...`);
					var html_info = _extractBody(email_obj, body, html_field_order);

					_log_module && !has_rfc_822_message && console.log(`\ngetHtmlAndTextBody(), html result came from '${html_info.source}' and has a length of '${html_info.result.length}'`);

					_log_module && console.log(`\ngetHtmlAndTextBody(), extracting 'text'...`);
					var text_info = _extractBody(email_obj, body, text_field_order);

					_log_module && !has_rfc_822_message && console.log(`\ngetHtmlAndTextBody(), text result came from '${text_info.source}' and has a length of '${text_info.result.length}'`);
					return waterfall_callback(null, html_info, text_info);
				},
				/* extract and append rfc822 info if present
					-- USING MAILPARSER RESULTS FOR RFC822 containing messages until _getRfc822HtmlAndTextBody() is complete --
				*/
				function (html_info, text_info, waterfall_callback) {

					var has_rfc_822_message = _getDistinctFieldValues(body, 'ct').includes('message/rfc822');

					if (!has_rfc_822_message) {
						return waterfall_callback(null, html_info, text_info);
					}

					_getRfc822HtmlAndTextBody(body, function (error, rfc_822_bodies) {
						if (error) {
							return waterfall_callback(error);
						}

						html_info.result += rfc_822_bodies.html;
						// html_info.source = 'rfc_822_result';
						text_info.result += rfc_822_bodies.text;
						// text_info.source = 'rfc_822_result';

						return waterfall_callback(null, html_info, text_info);
					});
				},
				/* analyse results and overwrite html if text is better parsed */
				function (html_info, text_info, waterfall_callback) {

					var use_text_for_html = !html_info.result // if we have no html result
						||
						(text_info.result && html_info.source.includes('mailparser')) // if we have a text result, and the html result was from mailparser
						||
						(!html_info.has_valid_encoding && text_info.has_valid_encoding); // or we could not properly decode the content for the html but we could for the text

					// override any html mailparser result we have if there's a valid text result
					if (use_text_for_html) {
						_log_module && console.log(`\ngetHtmlAndTextBody(), have no html or an invalid html result, converting text result to html`);

						// copy over the html result, using the text as the body
						html_info.result = convertPlainTextToHtml(text_info.result);
						html_info.source = text_info.source;
					}

					return waterfall_callback(null, html_info, text_info, use_text_for_html);
				}
			],
			function (error, html_info, text_info, use_text_for_html) {
				if (error) {
					return callback && callback(error);
				}

				var extracted_bodies = {
					'html': html_info.result,
					'text': text_info.result,
					'meta': {
						'is_html_from_text': use_text_for_html,
						'html_source': html_info.source,
						'html_has_valid_encoding': html_info.has_valid_encoding,
						'text_source': text_info.source,
						'text_has_valid_encoding': text_info.has_valid_encoding,
						has_rfc_822_message,
					}
				};

				return callback && callback(null, extracted_bodies);
			});
	};

	const convertPlainTextToHtml = function (text) {

		if (!text) {
			return '';
		}

		// use linkify to convert any links to <a>
		var words = text.split(' ');

		words = words.map((w) => {
			// if there're no links return w as is
			if (!linkify.test(w)) {
				return w;
			}

			var matches = linkify.match(w);

			// loop through the matches backwards so that the matches' indexes remain unchanged throughout the changes
			for (var i = matches.length - 1; i >= 0; i--) {
				var m = matches[i];
				w = `${w.substring(0, m.index)}<a href="${m.url}">${m.text}</a>${w.substring(m.lastIndex)}`;
			}

			return w.trim();
		});

		var text_as_html = `<p>${words.join(' ')}</p>`;

		text_as_html = text_as_html.replace(/\r?\n/g, '\n');
		text_as_html = text_as_html.replace(/[ \t]+$/gm, '');
		text_as_html = text_as_html.replace(/\n\n+/gm, '</p><p>');
		text_as_html = text_as_html.replace(/\n/g, '<br/>').trim();

		// remove any starting and trailing empty paragraphs
		while (!text_as_html.indexOf('<p></p>')) {
			text_as_html = text_as_html.substring('<p></p>'.length).trim();
		}

		while (text_as_html.substring(text_as_html.length - '<p></p>'.length) === '<p></p>') {
			text_as_html = text_as_html.substring(0, text_as_html.length - '<p></p>'.length).trim();
		}

		return text_as_html;
	};


	////////////////// Internal Functions ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	const _extractBody = function (email_obj, body, field_order = _default_html_field_order) {

		// source can be bodytext_html, bodytext_plain, mailparser_html, mailparser_text_as_html, mail_parser_text
		// var source = 'none';
		var field_value = '';
		var has_valid_encoding = false;

		_log_module && console.log(`_extractBody is using field order:`, field_order);

		var i = 0;
		while (!field_value && i < field_order.length) {
			var field = field_order[i++];
			var result = getBodyByField(email_obj, body, field);

			field_value = result.body;
			source = result.source;
		}

		return {
			'result': field_value,
			source,
			has_valid_encoding
		};

		/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

		function getBodyByField(email_obj, body, field) {

			switch (field) {

				case 'bodytext_html':
					return getBodyOfTypeFromChildren(body);

				case 'bodytext_plain':
					return getBodyOfTypeFromChildren(body, 'text/plain');

				case 'mailparser_html':
					return {
						'body': email_obj.html || '',
							'source': 'mailparser_html'
					};

				case 'mailparser_text_as_html':
					return {
						'body': email_obj.textAsHtml || '',
							'source': 'mailparser_text_as_html'
					};

				case 'mailparser_text':
					return {
						'body': email_obj.text || '',
							'source': 'mailparser_text'
					};

				default:
					console.log(`unknown field type requested for body field: '${field}'`);
					return {
						'body': '',
						'source': 'none'
					};
			}
		}

		function getBodyOfTypeFromChildren(haraka_obj, type = 'text/html', depth = 0, index = 0) {

			_log_module && console.log(`${'\t'.repeat(depth)} [${index}] current node is '${haraka_obj.ct}' - looking for type '${type}' at depth '${depth}'`);

			const is_requested_type = haraka_obj.ct && haraka_obj.ct.toLowerCase().includes(type);

			// recognize if the content is marked as format flowed and appears to be format flowed
			const is_format_flowed = haraka_obj.ct && haraka_obj.ct.toLowerCase().includes('format=flowed') && haraka_obj.bodytext.includes('=20');

			if (is_requested_type && (haraka_obj.bodytext || haraka_obj.body_text_encoded)) {
				_log_module && console.log(`${'\t'.repeat(depth)} [${index}] found a matching bodytype of length '${haraka_obj.bodytext.length || haraka_obj.body_text_encoded.length}' for type '${type}'`);

				// set has_valid_encoding
				has_valid_encoding = haraka_obj.body_encoding && !haraka_obj.body_encoding.includes('broken') && haraka_obj.bodytext;

				var is_quoted_printable = haraka_obj.header && haraka_obj.header.headers_decoded && haraka_obj.header.headers_decoded['content-transfer-encoding'] && (Array.isArray(haraka_obj.header.headers_decoded['content-transfer-encoding']) ?
					haraka_obj.header.headers_decoded['content-transfer-encoding'].includes('quoted-printable') : haraka_obj.header.headers_decoded['content-transfer-encoding'] === 'quoted-printable');

				var is_to_be_decoded = type === 'text/html';
				var bodytext_encoding = detectCharacterEncoding(Buffer.from(haraka_obj.bodytext));

				var body_text_encoded_encoding = detectCharacterEncoding(Buffer.from(haraka_obj.body_text_encoded));
				var prefer_bodytext = bodytext_encoding.confidence > body_text_encoded_encoding.confidence ||
					(bodytext_encoding.encoding === 'ISO-8859-1' && body_text_encoded_encoding.encoding === 'ISO-8859-1');

				var use_bodytext = is_quoted_printable || prefer_bodytext;

				_printParseInfo();

				if (use_bodytext) {

					var bodytext = haraka_obj.bodytext;

					// replace the html's designated chartype
					if (body_text_encoded_encoding.encoding === 'ISO-8859-1' && type === 'text/html' && _iso_8859_charset_regex.test(bodytext)) {
						_log_module && console.log(`replacing iso-8859 charset directive in the html`);
						bodytext = bodytext.replace(_iso_8859_charset_regex, 'text/html;');
					}

					// Windows-1252 can appear in the html when the chaset is ISO-8859-1 				
					if (body_text_encoded_encoding.encoding === 'ISO-8859-1' && type === 'text/html' && _windows_1252_charset_regex.test(bodytext)) {
						_log_module && console.log(`replacing Windows-1252 charset directive in the html`);
						bodytext = bodytext.replace(_windows_1252_charset_regex, 'text/html;');
					}

					return {
						'body': bodytext,
						'source': 'haraka_bodytext'
					};
				}

				// if we're looking for html, then decode the values before sending it back
				return {
					'body': is_to_be_decoded ? decode(haraka_obj.body_text_encoded) : haraka_obj.body_text_encoded,
					'source': `haraka_body_text_encoded${is_to_be_decoded ? '_then_decoded' : ''}`
				};
			}

			// if there's no children then there's nohing further to check along this path
			if (!haraka_obj.children || !haraka_obj.children.length) {
				_log_module && console.log(`${'\t'.repeat(depth)} [${index}] no children at current node of depth '${depth}', sending back an empty string (type:'${type}')`);
				return {
					'body': '',
					'source': `none`
				};
			}

			const num_children = haraka_obj.children.length;

			_log_module && console.log(`${'\t'.repeat(depth)} [${index}] node has ${num_children} children to be checked until a result of type '${type}' is found`);

			var child_result = null;
			var childs_body_text = '';
			var i = 0;
			// take the text from the first child that has it
			while (!childs_body_text && i < num_children) {
				var child_result = getBodyOfTypeFromChildren(haraka_obj.children[i++], type, depth + 1, ++index);
				child_result.body = child_result.body.trim();
				childs_body_text = child_result.body;
			}

			return child_result.body ? child_result : {
				'body': '',
				'source': 'none'
			};

			//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

			function _printParseInfo() {
				if (!_log_module) {
					return;
				}

				console.log(`\n\n[START :${type}] ${'!!!!'.repeat(45)}\n${haraka_obj.body_encoding}\n${haraka_obj.ct}\n`)
				is_quoted_printable && console.log(`[${type}] is_quoted_printable !!!!!!!!!!!!`);
				!is_quoted_printable && console.log(`[${type}] is NOT quoted_printable !!!!!!!!!!!!`);

				is_format_flowed && console.log(`[${type}] is_format_flowed !!!!!!!!!!!!`);
				!is_format_flowed && console.log(`[${type}] is NOT format_flowed !!!!!!!!!!!!`);

				is_to_be_decoded && console.log(`[${type}] is_to_be_decoded !!!!!!!!!!!!`);
				!is_to_be_decoded && console.log(`[${type}] is NOT to_be_decoded !!!!!!!!!!!!`);

				console.log(`[${type}] bodytext_encoding:`);
				console.log(`\t`, bodytext_encoding);
				console.log(`[${type}] body_text_encoded_encoding:`);
				console.log(`\t`, body_text_encoded_encoding);

				prefer_bodytext && console.log(`[${type}] ----------------- BODYTEXT PREFERRED!!!!!!!!!!!!`);
				!prefer_bodytext && console.log(`[${type}] ----------------- BODYTEXT NOT preferred !!!!!!!!!!!!`);

				console.log(`[${type}] Encoding is ${has_valid_encoding ? 'valid' : 'INVALID'}\n\n${'*****'.repeat(45)}\n\n`);

				if (!_log_all_fields) {
					var text_to_show = use_bodytext ? haraka_obj.bodytext : is_to_be_decoded ? haraka_obj.body_text_encoded : decode(haraka_obj.body_text_encoded);
					var source_name = use_bodytext ? 'haraka_bodytext' : is_to_be_decoded ? 'haraka_body_text_encoded_then_decoded' : 'haraka_body_text_encoded';
					console.log('\nSOURCE: ' + source_name + '\n\n');
					console.log(text_to_show);
				} else {

					console.log('\nSOURCE: haraka_bodytext\n\n');
					console.log(haraka_obj.bodytext);

					console.log('\n\nSOURCE: haraka_body_text_encoded\n\n');

					console.log(haraka_obj.body_text_encoded);
					console.log('\n\nSOURCE: haraka_body_text_encoded_then_decoded\n\n');
					console.log(decode(haraka_obj.body_text_encoded));

				}

				!use_bodytext && is_to_be_decoded && console.log(`body_text_encoded is to be decoded before using`);
				!use_bodytext && !is_to_be_decoded && console.log(`body_text_encoded will not be decoded before using`);

				console.log(`[END :${type}]${'****'.repeat(45)}`);
			}
		}
	};

	const _getDistinctFieldValues = function (haraka_obj, field, depth = 0, index = 0) {

		var values = haraka_obj[field] ? [haraka_obj[field]] : [];

		// if there's no children then there's nohing further to check along this path
		if (!haraka_obj.children || !haraka_obj.children.length) {
			_log_module && console.log(`${'\t'.repeat(depth)} [${index}] _getDistinctFieldValues(), for field '${field}', no children at current node of depth '${depth}'`);
			return values;
		}

		var i = 0;
		// take the text from the first child that has it
		while (i < haraka_obj.children.length) {
			values = values.concat(_getDistinctFieldValues(haraka_obj.children[i++], field, depth + 1, ++index))
		}

		return Array.from(new Set(values));
	};

	const _getFirstNodeOfType = function (haraka_obj, type = 'text/html', depth = 0, index = 0) {

		if (haraka_obj.ct && haraka_obj.ct.includes(type)) {
			return haraka_obj;
		}

		const num_children = haraka_obj.children.length;

		var matching_child_node = null;
		var i = 0;
		// take first node that matches the requested message-type
		while (!matching_child_node && i < num_children) {
			matching_child_node = _getFirstNodeOfType(haraka_obj.children[i++], type, depth + 1, ++index);
		}

		return matching_child_node || null;
	};

	function _initLinkify() {
		/// init linkify ///
		linkify.tlds(require('tlds'))
			.add('ftp:', null) // Disable `ftp:` ptotocol
			.set({
				fuzzyIP: true,
				fuzzyLink: true,
				fuzzyEmail: true
			});

		// convert twitter handles
		linkify.add('@', {
			validate: function (text, pos, self) {
				var tail = text.slice(pos);

				if (!self.re.twitter) {
					self.re.twitter = new RegExp('^([a-zA-Z0-9_]){1,15}(?!_)(?=$|' + self.re.src_ZPCc + ')');
				}

				if (self.re.twitter.test(tail)) {
					// Linkifier allows punctuation chars before prefix,
					// but we additionally disable `@` ("@@mention" is invalid)
					if (pos >= 2 && tail[pos - 2] === '@') {
						return false;
					}
					return tail.match(self.re.twitter)[0].length;
				}

				return 0;
			},
			normalize: function (match) {
				match.url = 'https://twitter.com/' + match.url.replace(/^@/, '');
			}
		});
	}


	// UNDER CONSTRUCTION ////////////////////////////////////////////////////////////////////////////////

	const _getRfc822HtmlAndTextBody = function (body, callback) {

		var rfc_body_info = {
			'html': '',
			'text': ''
		};

		var rfc_822_node = _getFirstNodeOfType(body, 'message/rfc822');

		let splitter = new Splitter();

		// handle parsed data
		splitter.on('data', data => {
			switch (data.type) {
				case 'node':
					var headers = data.getHeaders().toString('utf8').split(' ');

					var content_type_index = headers.indexOf('Content-Type:');

					// if we have a content_type, then the next index is the value
					var content_type = content_type_index > -1 ? headers[content_type_index + 1] : null;

					// if we've encountered either content type, set it to collect the result
					collect_html = content_type === 'text/html;'
					collect_text = content_type === 'text/plain;'

					break;

				case 'data':
					// multipart message structure
					// this is not related to any specific 'node' block as it includes
					// everything between the end of some node body and between the next header
					break;

				case 'body':

					if (collect_html) {
						rfc_body_info.html += data.value.toString('utf8');
					}
					if (collect_text) {
						rfc_body_info.text += data.value.toString('utf8');
					}
					// Leaf element body. Includes the body for the last 'node' block. You might
					// have several 'body' calls for a single 'node' block
					break;
			}
		});

		// callback when splitter's finish event is reached
		splitter.on('finish', function () {
			return callback && callback(null, rfc_body_info);
		});

		// send data to the parser
		const bodytext_stream = new stream.Readable();

		bodytext_stream._read = () => {};
		bodytext_stream.push(rfc_822_node.bodytext);
		bodytext_stream.push(null);
		bodytext_stream.pipe(splitter);
	};


	// exposed members
	return {
		getHtmlAndTextBody, // (email_obj, body, callback)
		convertPlainTextToHtml // (text)
	};
}();
module.exports = EmailBodyUtility;