# MongoDB plugin for Haraka

This plugin will store incoming emails in MongoDB and store all attachments on the disk. This plugin has been tested with over 40,000 incoming emails a day.

Additionally, you can also store all results for outgoing emails.

# Installation

Please install node-gyp locally first:

```
npm install -g node-gyp
```

Depending on your operating system, you might first have to install python, make, and compiler, e.g.:

```
apt install python2 make cmake g++
```

After you have created the Haraka configuration directory you can cd into the haraka directory and do...

```
npm install haraka-plugin-mongodb
```

This will install everything that is needed for you to store incoming emails to MongoDB and also store results from outgoing emails.

Alternatively you can also do a git clone into the Haraka node_modules directory. The installation directory depends if you installed Haraka globally or not.

# Configuration

Copy the mongodb.ini from the config directory (haraka-plugin-mongodb/config) to your Haraka config folder and edit accordingly.

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

