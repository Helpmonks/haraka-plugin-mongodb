# 1.6.3 - 2020-09-21

- Enhanced attachment parsing for checking the proper extension
- EML messages with different content type are getting the extension EML properly
- Delivery reports are automatically being renamed so they show up properly

# 1.6.2 - 2020-09-14

- You can now use a mongodb:// connection string with the new string value
- There is now a new "limit" option as you cannot insert more that 16 MB documents into MongoDB
- You can now send back emails to the sender on limits, parsing, and insert errors 
- Improved performance for parsing inline images
- Added custom content type to extend what attachments Haraka should accept as valid files. Otherwise the attachment is renamed to (filename).txt
- Removed some content types from the default reject string
- The log shows you now the connection to the MongoDB instance and depending on what you use a different wording for the connection
- Emails with headers that contain "." are now inserted (previously those emails failed)
- Updated libraries


# 1.6.1 - 2020-08-27

- We now block harmful attachments by default (you can adjust which files should be rejected in the config)
- We now check the content Type of the file and change the extension if it differs
- Updated libraries

# 1.5.8 && 1.5.9 && 1.6.0 - 2020-06-26

- Fixed an issue with inline images which were not parsed properly anymore as of 1.5.7
- Enhanced performance for inline images
- Made some other improvements to the attachment parsing

# 1.5.7 - 2020-06-24

- Added check that we have a proper path for path_check
- Fixed an issue with leftover code that potentially could spike the CPU to 100%
- All dates are now properly recorded
- Some errors were not being printed in the log

# 1.5.5. && 1.5.6 - 2020-06-16

- Fixed an issue where all hooks were loaded independent of the mechanism, i.e., queue or delivery.
- Updated README with the new path_check setting

# 1.5.4 - 2020-06-16

- Added the option to check for an attachment path. When the attachment path disappears (think Ceph, Gluster, etc.) then the Haraka process is being stopped as well
- Added "path_check" as new setting (by default it is empty)
- Updated libraries
- NOTE: Do NOT point "path_check" to the attachment directory itself but to its parent. The script will create a directory called "check" there. Otherwise, it will scan your whole attachment directory!

# 1.5.3 - 2020-05-31

- Prevented and fixed a crash when one of the email bodies is empty (thanks manalejandro - https://github.com/Helpmonks/haraka-plugin-mongodb/issues/9)

# 1.5.2 - 2020-05-28

- Upon a storage error we return now a DENYSOFT (previously it was a DENY)
- Library updates

# 1.5.1 - 2020-02-27

- Node 12 compatibility
- Library updates

# 1.5.0 - 2020-01-31

- Further enhancements for emails with different charset
- New and updated libraries

# 1.4.9 - 2020-01-20

- Fix for emails with different charset
- Updated libraries

# 1.4.8 - 2019-12-05

- The filename of files within a winmail.dat are now cleaned up as well (surprisingly a lot of people are still sending those) 

# 1.4.7 - 2019-12-04

- Limiting parsing and converting from text to html to 4MB (we saw larger emails to hold up processing significantly)
- Returning on error for some functions
- Fixed some issues with returning from errors
- Updated libraries

# 1.4.6 - 2019-11-21

- Enhanced attachment filename clean up (all foreign chars are now converted to underscore)
- Updated libraries

# 1.4.5 - 2019-08-24

- Attachments that don't have a CID but are still inline images but with a different contentdisposition get now a unique ID so they can be identified later on
- This will add attachments if the object has a type "attachment" but contentDisposition is "inline"
- Updated libraries

# 1.4.4 - 2019-08-17

- Further improvements to the parser

# 1.4.3 - 2019-07-23

- Further improvements to the parser
- Allow attachments with "_" in the filename
- Updated libraries

# 1.4.2 - 2019-06-25

- Small improvement to the parser

# 1.4.1 - 2019-06-10

- Improved the parsing of emails even further as there were still 1% of emails that weren't parsed properly
- Removed logging statements which caused a crash (sorry)
- Added new library

# 1.4.0 - 2019-06-06

- Re-factored how emails are being parsed (Thanks to Denise McCort)
- Defaulting to the body that Haraka passes instead of replying on the mailparser result only. More or less removed our dependency on mailparser
- There is now a new option how to handle inline images (see readme)
- Attachment file names are now cleaned before saving, too
- Creating links for plain text emails
- Added, updated and/or removed dependencies
- Important: Iconv is now required!

# 1.3.3 - 2019-05-27

- Happy Memorial Day
- Just some further enhancements to messages that could not be extracted properly

# 1.3.2 - 2019-05-24

- Messages in Base64 encoding were not read every time. This fix should detect those emails better and read them properly.

# 1.3.1 - 2019-05-22

- Added a method to extract body from the parsed Haraka body if mailparser fails (Thank you Denise McCort)
- Explicitly added Iconv to the mailparser options
- Updated MongoDB library

# 1.3.0 - 2019-05-16

- Changed to mailparser
- Updated to MongoDB v3
- Updated all dependent libraries, too
- Inline images are no longer stored as attachments as they are replaced in the HTML as Base64 now
- The updated libraries also solve an issue where the HTML body under rare circumstances could not be read
- Tested and working with Node v10.15.x

# 1.2.2 - 2018-11-29

- Added new "transferred" column

# 1.2.1 - 2018-09-11

- Catching now when collection is not defined, todo items are not defined, and some headers are not defined

# 1.2.0 - 2018-07-10

- Small bugfix for attachment names

# 1.1.9 - 2018-07-10

- We had to revert back to the "old" mailparser, i.e. 0.6.2 version. We are now using the mailparser-mit library. The present mailparser project is a) not maintained anymore and b) showed weird issues with attachments, inline images and just behaved wrong
- All the updates from previous versions have been merged into this one

# 1.1.8 - 2018-07-07

- Fixed an issue with plain-text emails (was not available in the Mailparser object)

# 1.1.7 - 2018-07-05

- Fixed a small issue with HTML and references

# 1.1.6 - 2018-07-05

- Fixed a small issue when certain header values are not defined

# 1.1.5 - 2018-07-05

- This plugin now also takes care of sending a bounce message or not
- Checking if the last bounce message to user has been over an hour ago. If so, a new bounce will be sent
- Storing more bounce information in collection

# 1.1.4 - 2018-07-04

- Fixed an issue when there is no attachment.filename defined

# 1.1.3 - 2018-07-04

- Fixed new fileName param

# 1.1.2 - 2018-07-04

- Updated to latest mailparser and re-factored parsing

# 1.1.1 - 2018-07-04

- Will store .ics attachments properly

# 1.1.0 - 2018-05-28

- Commented log entries which caused the attachment content to print to log

# 1.0.9 - 2018-03-13

- Bug fix for winmail.dat files

# 1.0.8 - 2018-01-31

- Fixed with installlation

# 1.0.7 - 2017-08-29

- Some message don't have a message-id, thus creating a random 'objectId@haraka' for message-d header now

# 1.0.6 - 2017-08-29

- HTML field will not longer be populated with the text field if not available

# 1.0.5 - 2017-08-20

- If there are no attachments in the email we just store an empty array in the field

# 1.0.4 - 2017-08-18

- Storing size, mail_from and rcpt_to as separate fields in collection now

# 1.0.3 - 2017-08-18

- Using mailparser-mit now
- Added node-gyp and iconv as dependencies

# 1.0.2 - 2017-08-17

- Added field to incoming collection
- Fixed and issue with attachments and the "plugin" variable
- Passing the "connection" to mailparser function

# 1.0.1 - 2017-08-17

- Pull-request for mongodb without username and password

# 1.0.0 - 2017-03-03

- Release to store results for outgoing emails

# 0.5.1 - 2017-03-01

- Storing emails works now again (was broken in previous commit)
- Some bug fixes
- Added more logging
- Changed configuration to have sections (enabled section does nothing right now)

# 0.5.0 - 2017-03-01

- Complete refactor for new haraka plugin architecture
