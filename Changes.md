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
