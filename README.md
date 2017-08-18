# MongoDB plugin for Haraka

This plugin will store incoming emails in MongoDB and store all attachments on the disk. This plugin has been tested with over 40,000 incoming emails a day.

Additionally, you can also store all results for outgoing emails.

# Installation

Easiest is to install this via npm on your Haraka server:

```
npm install haraka-plugin-mongodb
```

Alternatively you can also do a git clone into the Haraka node_modules directory. The installation directory depends if you installed Haraka globally or not.

# Configuration

Edit the mongodb.ini in the config directory to your requirement:

## Section: MongoDB

Provide your credentials to connect to your MongoDB instance.

## Section: Collections

The collection to use for the queue (incoming) and delivery results (outgoing).

## Section: Attachments

Provide the absolute path to store attachments.

## Section: Enable

Enable the "queue" to enable this plugin to store incoming emails into the MongoDB database. Enable the "delivery" to store results for outgoing emails.

# Issues

If you run into any issue, please report them on the [plugins issue page](https://github.com/Helpmonks/haraka-plugin-mongodb/issues)

# Developers / Pull requests

Pull-requests are welcomed! Development takes place in the "develop" branch. Hence please create any pull-requests against the "develop" branch.

