# MongoDB plugin for Haraka

This plugin will store incoming emails (including bounces, etc.) in MongoDB and store all attachments on the disk. Additionally, it can also be used to store all results for outgoing emails.

As of version 1.6.5, we've added the option to limit incoming emails, also. There are many other options. Please make sure to read this README.

This plugin has been tested with over 500,000 incoming and outgoing emails a day.

# Installation

Depending on your operating system, you might first have to install python, make, and compiler, e.g.:

```
apt install python2 make cmake g++ build-essentials
```

In order to store winmail.dat files (yes some people are still using those) you need to also install tnef with:

```
apt install tnef
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

As of version 1.6.2 you can also define a mongodb connection string directly using the "string" value. This has to be a valid [mongodb connection string](https://docs.mongodb.com/manual/reference/connection-string). If you define a connection string, only the connection string will be used for the connection. 

Please note that the mongodb connection is used for both the delivery and the queue. If you want to store the queue in another database you should use a separate queue and a delivery instance. 

## Section: Collections

The collection to use for the queue (incoming) and delivery results (outgoing).

## Section: Attachments

### Attachment path
Provide the absolute path to store attachments.

### Attachment path check (new as of 1.5.5)
This plugin comes now with a built-in check to make sure your attachment path is always available. To do so, set the "path_check" variable. This is useful if you mount your attachments over Ceph, Gluster, etc. Due to network issues the directory could become unavailable. When this happens, the plugin will tell Haraka to stop.
**Important**: Do NOT use your attachment directory or else it will scan each attachment. Instead use it's parent folder. The plugin will create a "check" directory with a hidden file in it.

### Attachment reject (new as of 1.6.1)
Enter the attachments content type that should be rejected. The default ones are the most common file types that should never be accepted by any file system. Feel free to adjust. It's an array with content type strings.

### Extend content types (new as of 1.6.2)
As of 1.6.1 we test each attachment for the proper content type and get the correct extension. Sometimes you might want to extend that with your own content types. With the new "custom_content_type" setting you can do that now. Within the mongodb.ini simply extend the map with your own custom types. The format is, 'content/type' : ['extension'] and you comma separate each content type.

### Convert inline images (new as of 1.4.0)
You can set if you want to convert inline images or not. Following options are available:
- cid = leave value as cid:(number) - this is useful if you want to process the images later on
- base64 = convert inline images to base64 - will convert inline images to base64 and remove it from the attachment array
- path = convert the cid:(number) value to the path given, the filename will be appended to your path, e.g., "(path)/image.png". Do NOT append a "/" at the end of your path!

## Section: Enable

Enable the "queue" to enable this plugin to store incoming emails into the MongoDB database. Enable the "delivery" to store results for outgoing emails.

## Section: Message (new as of 1.6.2)

The limit option is set to 16777216 by default as MongoDB does not support documents that are larger than 16 MB. Set this to no value if you have an alternative in place

## Section: SMTP (new as of 1.6.2)

Enter your SMTP server values and FROM, CC, and BCC for sending an alert email to the sender if an error occurs. Furthermore, set your message text for each message type.

## Section: LIMITS (new as of 1.6.5)

Enabling the limits for incoming emails will check the FROM and the TO email-address of incoming email and send back a "softdeny" if found. The time amount is set in the "timeout_seconds" setting. By default this is set to 10 seconds. In our experience, we've seen that this will throttle most automated systems, while emails from users are coming in without delays.

Use the "exclude" (empty array) settings to never throttle emails from a certain domain.

As of 1.7.0 you can also use the "include" (empty array) setting to only include certain domains in the check. An empty array means to check for all incoming emails, one or many values mean to only check for those domains.

### Compatibility

This plugin has been tested with Nodejs v12 and MongoDB 4.4.x (it worked in the past with Nodejs v8.x and MongoDB 3.x)

# Installation issues with iconv and node-gyp

You might run into issues with iconv and node-gyp installation. Our suggested workaround is to use:

```
npm -g config set user root
```

and then install node-gyp globally and reinstall Haraka. Hope this helps.

# Issues

If you run into any issue, please report them on the [plugins issue page](https://github.com/Helpmonks/haraka-plugin-mongodb/issues)

# Developers / Pull requests

Pull-requests are welcomed! Development takes place in the "develop" branch. Hence please create any pull-requests against the "develop" branch.

# Version History

A version history with all changes [is also available](https://github.com/Helpmonks/haraka-plugin-mongodb/blob/master/Changes.md)

