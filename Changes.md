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
