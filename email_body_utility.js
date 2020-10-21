const EmailBodyUtility = function() {
	const stream = require('stream');

	const async = require('async');
	const linkify = require('linkify-it')();
	// const ced = require('ced');
	const Splitter = require('mailsplit').Splitter;
	const detectCharacterEncoding = require('detect-character-encoding');

	const quotedPrintable = require('quoted-printable');
 
	const _default_html_field_order = 'bodytext_html mailparser_html mailparser_text_as_html'.split(' ');
	const _default_text_field_order = 'bodytext_plain mailparser_text'.split(' ');

	const _haraka_bodytext_variations = 'haraka_bodytext haraka_body_text_encoded'.split(' ');

	const _linkify_text_size_threshold = 4915200;


	const _iso_8859_charset_regex = /text\/html; charset=iso-8859-\d/img;
	const _windows_charset_regex = /text\/html;\s*charset=Windows-125(2|7)/img;
	
	const _uses_windows_1257_charset = /charset=Windows-1257/im;
	const _contains_html_invalid_unicode = /\x82/;
	const _contains_replacement_char_unicode = /\uFFFD/; // i.e �


	var _log_module = false;
	var _log_all_fields = false && _log_module;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	// initialize linkify when this module is first required
	_initLinkify();


	////////////////// Exposed Functions ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	const getHtmlAndTextBody = function(email_obj, body, options, callback = options) {
		options = options && typeof options === 'object' ? options : {};
		callback = typeof callback === 'function' ? callback : null;

		var _specified_options = Object.keys(options);
		if (_specified_options.includes('log_module')) { _log_module = !! options.log_module; }
		if (_specified_options.includes('log_all_fields')) { _log_module = _log_all_fields && !! options.log_all_fields; }

		var has_rfc_822_message = false;
		var uses_windows_1257_charset = false;

		async.waterfall([
			/* get basic html and text bodies */
			function (waterfall_callback) {

				has_rfc_822_message = _getDistinctFieldValues(body, 'ct').includes('message/rfc822');
				_log_module && has_rfc_822_message && console.log(`\ngetHtmlAndTextBody(), has RFC-822 message, using mailparser result`);

				uses_windows_1257_charset = _uses_windows_1257_charset.test(email_obj.html);

				var prefer_mailparser =  has_rfc_822_message || uses_windows_1257_charset;

				// continue to use mailparser result if rfc_822 message is present
				var html_field_order = prefer_mailparser ? 'mailparser_html mailparser_text_as_html'.split(' ') : _default_html_field_order;
				var text_field_order = prefer_mailparser ? 'mailparser_text bodytext_plain'.split(' ') : _default_text_field_order;

				_log_module && console.log(`\ngetHtmlAndTextBody(), extracting 'html'...`);
				var html_info = ! options.ignore_html_result ? _extractBody(email_obj, body, html_field_order, options) : { result : '' };
				_log_module && ! has_rfc_822_message && console.log(`\ngetHtmlAndTextBody(), html result came from '${html_info.source}' and has a length of '${html_info.result.length}'`);

				_log_module && console.log(`\ngetHtmlAndTextBody(), extracting 'text'...`);
				var text_info = ! options.ignore_text_result ? _extractBody(email_obj, body, text_field_order, options) : { result : '' };

				_log_module && ! has_rfc_822_message && console.log(`\ngetHtmlAndTextBody(), text result came from '${text_info.source}' and has a length of '${text_info.result.length}'`);
				return waterfall_callback(null, html_info, text_info);
			},
			/* extract and append rfc822 info if present
				-- USING MAILPARSER RESULTS FOR RFC822 containing messages until _getRfc822HtmlAndTextBody() is complete --
			*/
			function (html_info, text_info, waterfall_callback) {

				var has_rfc_822_message = _getDistinctFieldValues(body, 'ct').includes('message/rfc822');

				if (! has_rfc_822_message) { return waterfall_callback(null, html_info, text_info); }

				_getRfc822HtmlAndTextBody(body, function (error, rfc_822_bodies) {
					if (error) { return waterfall_callback(error); }

					html_info.result += rfc_822_bodies.html;
					// html_info.source = 'rfc_822_result';
					text_info.result += rfc_822_bodies.text;
					// text_info.source = 'rfc_822_result';

					return waterfall_callback(null, html_info, text_info);
				});
			},
			/* analyse results and overwrite html if text is better parsed */
			function (html_info, text_info, waterfall_callback) {

				var use_text_for_html = ! html_info.result // if we have no html result
					|| (text_info.result && html_info.source.includes('mailparser') && ! text_info.source.includes('mailparser')) // if we have a text result, and the html result was from mailparser
					|| (! html_info.has_valid_encoding && text_info.has_valid_encoding); // or we could not properly decode the content for the html but we could for the text

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
			if (error) { return callback && callback(error); }

			var extracted_bodies = {
				'html' : html_info.result,
				'text' : text_info.result,
				'meta' : {
					has_rfc_822_message,
					'is_html_from_text' : use_text_for_html,
					'html_source' : html_info.source,
					'html_has_valid_encoding' : html_info.has_valid_encoding,
					'text_source' : text_info.source,
					'text_has_valid_encoding' : text_info.has_valid_encoding,
					'does_bodytext_contain_invalid_html' : html_info.does_bodytext_contain_html_invalid_unicode,
					'does_body_text_encoded_contain_invalid_html' : html_info.does_body_text_encoded_contain_html_invalid_unicode,
					'does_bodytext_contain_replacement_char_unicode' : html_info.does_bodytext_contain_replacement_char_unicode,
					'does_body_text_encoded_contain_replacement_char_unicode' : html_info.does_body_text_encoded_contain_replacement_char_unicode
				}
			};

			// if alternates were requested add them to the final result
			if (options.store_alternates) {
				extracted_bodies.meta.alternate_bodies = {
					'html' : html_info.alternate_bodies || [],
					'text' : text_info.alternate_bodies || []
				}
			}

			return callback && callback(null, extracted_bodies);
		});
	};

	const convertPlainTextToHtml = function(text) {

		if (! text) { return ''; }

		if (typeof text !== 'string' || text.length > _linkify_text_size_threshold) { return text; } 

		// use linkify to convert any links to <a>
		var words = text.split(' ');

		words = words.map((w) => {
			// if there're no links return w as is
			if (! linkify.test(w)) { return w; }

			var matches = linkify.match(w);

			// loop through the matches backwards so that the matches' indexes remain unchanged throughout the changes
			for (var i = matches.length -1; i >= 0; i--) {
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
		while (! text_as_html.indexOf('<p></p>')) {
			text_as_html = text_as_html.substring('<p></p>'.length).trim();
		}

		while (text_as_html.substring(text_as_html.length - '<p></p>'.length) === '<p></p>') {
			text_as_html = text_as_html.substring(0, text_as_html.length - '<p></p>'.length).trim();
		}

		return text_as_html;
	};


	////////////////// Internal Functions ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

	const _no_body_result = {
		'body' : '',
		'source' : 'none',
	};

	const _extractBody = function(email_obj, body, field_order = _default_html_field_order, options = {}) {

		// source can be bodytext_html, bodytext_plain, mailparser_html, mailparser_text_as_html, mail_parser_text
		var field_value = '';
		var has_valid_encoding = false;
		var has_broken_encoding = false;
		var source = null;
		var does_bodytext_contain_html_invalid_unicode = null;
		var does_body_text_encoded_contain_html_invalid_unicode = null;
		var does_bodytext_contain_replacement_char_unicode = null;
		var does_body_text_encoded_contain_replacement_char_unicode = null;

		_log_module && console.log(`_extractBody is using the following ${field_order.length} fields in the given order:`, field_order);

		var alternate_bodies = {};

		var i = 0;
		// if we're storing alternate bodies then loop over every field
		while ((! field_value || options.store_alternates) && i < field_order.length) {
			var field = field_order[i++];
			var result = getBodyByField(email_obj, body, field);

			// if it's the first match, then it's the result
			var is_result = ! field_value && !! result.body;

			// don't overwrite the value if we have one
			field_value = is_result ? result.body : field_value;
			source = is_result ? result.source : source;

			if ((is_result && (! Array.isArray(result.alternate_bodies)) || ! options.store_alternates)) {
				// don't store the final result with the alternates
				options.store_alternates && result.alternate_bodies && delete alternate_bodies[field];
				continue;
			}

			// if we have multiple bodies tack each on separately
			if (result.alternate_bodies && Array.isArray(result.alternate_bodies)) {

				result.alternate_bodies.forEach(variation_info => {
					alternate_bodies[variation_info.source] = variation_info;
				});

			} else {
				// store the alternates to send back
				alternate_bodies[field] = result.alternate_bodies || {
					'body' : result.body,
					'source' : result.source
				};
			}
		}

		// if the source is null set it to none
		source = source || 'none';

		return {
			'result' : field_value,
			source,
			has_valid_encoding,
			alternate_bodies,
			does_body_text_encoded_contain_html_invalid_unicode,
			does_body_text_encoded_contain_replacement_char_unicode,
			does_bodytext_contain_replacement_char_unicode,
			does_bodytext_contain_html_invalid_unicode
		};

		/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

		function getBodyByField(email_obj, body, field) {

			switch (field) {

				case 'bodytext_html':
					return getBodyOfTypeFromChildren(body);

				case 'bodytext_plain':
					return getBodyOfTypeFromChildren(body, 'text/plain');

				case 'mailparser_html':

					var body = _cleanCharsetsFromHTML(email_obj.html || '');

					return {
						body,
						'source' : 'mailparser_html'
					};

				case 'mailparser_text_as_html':
					return {
						'body' : email_obj.textAsHtml || '',
						'source' : 'mailparser_text_as_html'
					};

				case 'mailparser_text' :
					return {
						'body' : email_obj.text || '',
						'source' : 'mailparser_text'
					};

				default:
					console.log(`unknown field type requested for body field: '${field}'`);
					return {
						'body' : '',
						'source' : 'none'
					};
			}
		}

		function getBodyOfTypeFromChildren(haraka_obj, type = 'text/html', depth = 0, index = 0) {

			_log_module && console.log(`${'\t'.repeat(depth)} [${index}] current node is '${haraka_obj.ct}' - looking for type '${type}' at depth '${depth}'`);

			const is_requested_type = haraka_obj.ct && haraka_obj.ct.toLowerCase().includes(type);

			var is_matching_node = is_requested_type && (haraka_obj.bodytext || haraka_obj.body_text_encoded)
			_log_module && ! is_matching_node && console.log(`${'\t'.repeat(depth)} [${index}] not a matching node for type '${type}'`);

			if (is_matching_node) {
				_log_module && console.log(`${'\t'.repeat(depth)} [${index}] found a matching bodytype of length '${haraka_obj.bodytext.length || haraka_obj.body_text_encoded.length}' for type '${type}'`);

				// grab each of the available values
				var bodytext = haraka_obj.bodytext;
				var haraka_body_text_encoded = _formatQuotedPrintableBody(haraka_obj.body_text_encoded);

				// set has_valid_encoding
				has_valid_encoding = !! haraka_obj.body_encoding && ! haraka_obj.body_encoding.includes('broken') && !! haraka_obj.bodytext;
				has_broken_encoding = !! haraka_obj.body_encoding && haraka_obj.body_encoding.includes('broken') && !! haraka_obj.bodytext;

				var bodytext_specified_encoding = haraka_obj.body_encoding ? haraka_obj.body_encoding.trim().toLowerCase() : null;
				
				// bodytext encoding
				var bodytext_encoding = detectCharacterEncoding(Buffer.from(haraka_obj.bodytext));
				// var bodytext_encoding = ced(Buffer.from(haraka_obj.bodytext));
				var bodytext_encoding_normalized = bodytext_encoding.encoding ? bodytext_encoding.encoding.trim().toLowerCase() : null;
				var does_specified_encoding_match_bodytext_encoding = bodytext_specified_encoding && bodytext_specified_encoding === bodytext_encoding_normalized;
				
				// body_text_encoded encoding
				var body_text_encoded_encoding = detectCharacterEncoding(Buffer.from(haraka_obj.body_text_encoded));
				// var body_text_encoded_encoding = ced(Buffer.from(haraka_obj.body_text_encoded));
				var body_text_encoded_encoding_normalized = body_text_encoded_encoding.encoding ? body_text_encoded_encoding.encoding.trim().toLowerCase() : null;
				var does_specified_encoding_match_body_text_encoded_encoding = bodytext_specified_encoding === body_text_encoded_encoding_normalized;

				does_bodytext_contain_html_invalid_unicode = _contains_html_invalid_unicode.test(bodytext);
				does_body_text_encoded_contain_html_invalid_unicode = _contains_html_invalid_unicode.test(haraka_body_text_encoded);
				does_bodytext_contain_replacement_char_unicode = _contains_replacement_char_unicode.test(bodytext);
				does_body_text_encoded_contain_replacement_char_unicode = _contains_replacement_char_unicode.test(haraka_body_text_encoded);

				var has_higher_bodytext_encoding_confidence = (bodytext_encoding.confidence >= body_text_encoded_encoding.confidence && body_text_encoded_encoding.confidence < 100)
					|| (does_body_text_encoded_contain_html_invalid_unicode && ! does_bodytext_contain_html_invalid_unicode)
					|| (does_body_text_encoded_contain_replacement_char_unicode && ! does_bodytext_contain_replacement_char_unicode);

				var does_specified_encoding_match_neither_guessed_encoding = ! does_specified_encoding_match_body_text_encoded_encoding && ! does_specified_encoding_match_bodytext_encoding;

				var prefer_bodytext_for_ascii = has_broken_encoding && bodytext_specified_encoding.includes('us-asci');

				var prefer_bodytext_for_encoding_confidence = ! has_broken_encoding && has_higher_bodytext_encoding_confidence 
					&& (! does_bodytext_contain_replacement_char_unicode || does_body_text_encoded_contain_replacement_char_unicode || body_text_encoded_encoding.confidence < 20)

				var prefer_bodytext_for_8859_values = bodytext_encoding_normalized !== 'iso-8859-1' && body_text_encoded_encoding_normalized === 'iso-8859-1' && bodytext_encoding.confidence <= 50;
				var prefer_bodytext_for_8859_values = body_text_encoded_encoding_normalized === 'iso-8859-1' && bodytext_encoding.confidence <= 50;

				var prefer_bodytext = prefer_bodytext_for_ascii || prefer_bodytext_for_encoding_confidence || prefer_bodytext_for_8859_values;

				var use_bodytext = prefer_bodytext;

				var body = use_bodytext ? bodytext : haraka_body_text_encoded;
				var source = use_bodytext ? 'haraka_bodytext' : `haraka_body_text_encoded`;

				var header_content_type = Array.isArray(haraka_obj.header.headers['content-type']) ? haraka_obj.header.headers['content-type'].join(' ') : haraka_obj.header.headers['content-type'] || '';

				// if we're working with html then clean up the embedded charsets
				if (type === 'text/html') { body = _cleanCharsetsFromHTML(body); }

				_printParseInfo();

				var result = { body, source };

				if (! options.store_alternates) { return result; }

				// put together the alternate_body info to send back
				var alternate_bodies = _haraka_bodytext_variations.filter(v => v !== source && source !== 'none').map((variation) => {
					var body = variation === 'haraka_bodytext' ? bodytext : haraka_body_text_encoded;
				
					return { body, 'source' : variation };
				});

				// add the variations to the result
				result.alternate_bodies = alternate_bodies;

				return result;
			}

			// if there's no children then there's nohing further to check along this path
			if (! haraka_obj.children || ! haraka_obj.children.length) {
				_log_module && console.log(`${'\t'.repeat(depth)} [${index}] no children at current node of depth '${depth}', sending back an empty string (type:'${type}')`);
				return _no_body_result;
			}

			const num_children = haraka_obj.children.length;

			_log_module && console.log(`${'\t'.repeat(depth)} [${index}] node has ${num_children} children to be checked until a result of type '${type}' is found`);

			var child_result = null;
			var has_valid_child_body = false;
			var i = 0;
			// take the text from the first child that has it
			while (! has_valid_child_body && i < num_children) {
				var child_result = getBodyOfTypeFromChildren(haraka_obj.children[i++], type, depth+1, ++index);
				child_result.body = child_result.body.trim();
				has_valid_child_body = !! child_result.body;
			}

			var child_result = has_valid_child_body ? child_result : _no_body_result

			return child_result;

			//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

			function _printParseInfo() {
				if (! _log_module) { return; }

				console.log(`\n\n[START :${type}] ${'^'.repeat(180)}\n`)
				console.log(`[${type}] charset:${haraka_obj.ct}`)

				console.log(`[${type}] bodytext_specified_encoding: "${bodytext_specified_encoding}"`);
				console.log('');
				console.log(`[${type}] bodytext_encoding:\t\t\t`, bodytext_encoding);
				console.log(`[${type}] does_specified_encoding_match_bodytext_encoding:`, does_specified_encoding_match_bodytext_encoding);
				console.log(`[${type}] does_bodytext_contain_html_invalid_unicode:`, does_bodytext_contain_html_invalid_unicode);
				console.log(`[${type}] does_bodytext_contain_replacement_char_unicode:`, does_bodytext_contain_replacement_char_unicode);
				console.log('');
				console.log(`[${type}] body_text_encoded_encoding:\t`, body_text_encoded_encoding);
				console.log(`[${type}] does_specified_encoding_match_body_text_encoded_encoding:`, does_specified_encoding_match_body_text_encoded_encoding);
				console.log(`[${type}] does_body_text_encoded_contain_html_invalid_unicode:`, does_body_text_encoded_contain_html_invalid_unicode);
				console.log(`[${type}] does_body_text_encoded_contain_replacement_char_unicode:`, does_body_text_encoded_contain_replacement_char_unicode);
				console.log('');
				console.log(`[${type}] headers['content-type']:`, haraka_obj.header.headers['content-type']);
				console.log(`[${type}] has_valid_encoding:`, has_valid_encoding);
				console.log(`[${type}] has_broken_encoding:`, has_broken_encoding);
				console.log(`[${type}] encoding, '${haraka_obj.body_encoding}', is ${has_valid_encoding ? 'valid' : 'INVALID'}\n`);
				console.log('');
				use_bodytext && console.log(`[${type}] using 'haraka_bodytext'`);
				! use_bodytext && console.log(`[${type}] using 'haraka_bodytext_encoded'`);

				console.log(`\n\n${'-'.repeat(180)}\n`);

				if (! _log_all_fields) {
					console.log('\nSOURCE: ' + source + '\n\n');
					console.log(_shortenText(body));
				} else {

					console.log('\nSOURCE: haraka_bodytext\n\n');
					console.log(haraka_obj.bodytext);

					console.log('\n\nSOURCE: haraka_body_text_encoded\n\n');
					console.log(haraka_obj.body_text_encoded);
				}

				console.log(`\n[END :${type}]${'*'.repeat(180)}\n\n`);
			}
		}
	};

	const _cleanCharsetsFromHTML = function(body) {

		// ISO-8859
		if (_iso_8859_charset_regex.test(body)) {
			_log_module && console.log(`replacing iso-8859 charset directives, which are present in the html`);
			body = body.replace(_iso_8859_charset_regex, 'text/html;');
		}

		// Windows-1252 or 1257 can appear in the html when the charset is ISO-8859-1 				
		if (_windows_charset_regex.test(body)) {
			_log_module && console.log(`replacing Windows-1252 or -1257 charset directives, which are present in the html`);
			body = body.replace(_windows_charset_regex, 'text/html;');
		}

		// return body.trim();
		return body;
	};

	const _getDistinctFieldValues = function(haraka_obj, field, depth = 0, index = 0) {

		var values = haraka_obj[field] ? [haraka_obj[field]] : [];

		// if there's no children then there's nohing further to check along this path
		if (! haraka_obj.children || ! haraka_obj.children.length) {
			_log_module && console.log(`${'\t'.repeat(depth)} [${index}] _getDistinctFieldValues(), for field '${field}', no children at current node of depth '${depth}'`);
			return values;
		}

		var i = 0;
		// take the text from the first child that has it
		while (i < haraka_obj.children.length) {
			values = values.concat(_getDistinctFieldValues(haraka_obj.children[i++], field, depth+1, ++index))
		}

		return Array.from(new Set(values));
	};

	const _getFirstNodeOfType = function(haraka_obj, type = 'text/html', depth = 0, index = 0) {

		if (haraka_obj.ct && haraka_obj.ct.includes(type)) { return haraka_obj; }

		const num_children = haraka_obj.children.length;

		var matching_child_node = null;
		var i = 0;
		// take first node that matches the requested message-type
		while (! matching_child_node && i < num_children) {
			matching_child_node = _getFirstNodeOfType(haraka_obj.children[i++], type, depth+1, ++index);
		}

		return matching_child_node || null;
	};

	const _formatQuotedPrintableBody = function(body_text_encoded) {

		// _log_module && console.log(`_formatQuotedPrintableBody() has body_text_encoded of length:`, body_text_encoded.length);
		// _log_all_fields && console.log(`_formatQuotedPrintableBody() body_text_encoded:`, body_text_encoded);

		if (!body_text_encoded) return null;

		const _regex = /=\n/gm;

		var fixed_body = body_text_encoded ? body_text_encoded.replace(/=\n/gm, '') : '';

		var formatted_body = null;
		try {
			formatted_body = quotedPrintable.decode(fixed_body).toString('utf8');
		} catch (ex) {
			console.log('Error extracting quoted printable body, error:', ex);
			formatted_body = null;
		}

		return formatted_body;
	};

	const _shortenText = function(text, max_print = 300) {

		// if we're given no text or, it's not a string return as is
		if (! text || (typeof text !== 'string' && typeof text !== 'object')) { return text; }

		text = typeof text === 'string' ? text : JSON.stringify(text);

		if (text.length <= max_print) { return `'${text}'`; }

		max_print = max_print - 7; // for '... ...'.length

		// if we have an odd number add the extra char to the front
		var start_length = Math.round(max_print/2);
		var end_length = Math.floor(max_print/2);

		if (text.length > max_print + 7) { return `'${text.substring(0, start_length)}... ...${text.substring(text.length - end_length)}'`; }
		if (text.length > max_print + 6) { return `'${text.substring(0, start_length)}...${text.substring(text.length - (end_length-1))}'`; }
		if (text.length > max_print + 5) { return `'${text.substring(0, start_length+1)}...${text.substring(text.length - (end_length-1))}'`; }
		if (text.length > max_print + 4) { return `'${text.substring(0, start_length+2)}...${text.substring(text.length - (end_length-1))}'`; }
		if (text.length > max_print + 3) { return `'${text.substring(0, start_length+2)}...${text.substring(text.length - (end_length-2))}'`; }
		if (text.length > max_print + 2) { return `'${text.substring(0, start_length+4)}|${text.substring(text.length - (end_length-3))}'`; }
		if (text.length > max_print + 1) { return `'${text.substring(0, start_length+4)}|${text.substring(text.length - (end_length-3))}'`; }
		// if we're just a character over
		return `'${text.substring(0, start_length+4)}|${text.substring(text.length - (end_length-3))}'`;
	}

	function _initLinkify() {
		/// init linkify ///
		linkify.tlds(require('tlds'))
			.add('ftp:', null) // Disable `ftp:` ptotocol
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
	}


	// UNDER CONSTRUCTION ////////////////////////////////////////////////////////////////////////////////

	const _getRfc822HtmlAndTextBody = function(body, callback) {

		var rfc_body_info = { 'html' : '', 'text' : '' };

		var rfc_822_node = _getFirstNodeOfType(body, 'message/rfc822');

		let splitter = new Splitter();

		// handle parsed data
		splitter.on('data', data => {
			switch (data.type) {
				case 'node':
					var headers = data.getHeaders().toString('utf8').split(' ');

					var content_type_index = headers.indexOf('Content-Type:');

					// if we have a content_type, then the next index is the value
					var content_type = content_type_index > -1 ? headers[content_type_index+1] : null;

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

					if (collect_html) { rfc_body_info.html += data.value.toString('utf8'); }
					if (collect_text) { rfc_body_info.text += data.value.toString('utf8'); }
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
