# MongoDB plugin for Haraka

This plugin will store incoming emails in MongoDB and store all attachments on the disk. This plugin has been tested with over 20,000 incoming emails a day.

## Requirements

Following modules need to be installed:

Mailparser, fs-extra and mongodb

```
npm install mailparser -g
npm install fs-extra -g
npm install mongodb -g
```

## Installation

* Place the "queue_mongodb.ini" file into your Haraka config directory and edit the values accordingly.
* Place the "queue_mongodb.js" file into your Haraka plugin directory.
