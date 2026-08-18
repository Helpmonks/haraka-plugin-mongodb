
// node.js built-in modules
var assert   = require('assert');
var path     = require('path');

// npm modules
var config   = require('haraka-config');
var fixtures = require('haraka-test-fixtures');

// plugin
var plugin = require('../index');

// start of tests
//    assert: https://nodejs.org/api/assert.html
//    mocha: http://mochajs.org

beforeEach(function (done) {
    this.plugin = Object.assign({ config: config.module_config(path.resolve(__dirname, '..')) }, plugin);
    done();  // if a test hangs, assure you called done()
});

describe('template', function () {
    it('loads', function (done) {
        assert.ok(this.plugin);
        done();
    });
});

describe('load_mongodb_ini', function () {
    it('loads mongodb.ini from config/mongodb.ini', function (done) {
        this.plugin.load_mongodb_ini();
        assert.ok(this.plugin.cfg);
        done();
    });

    it('initializes queue enabled boolean', function (done) {
        this.plugin.load_mongodb_ini();
        assert.equal(this.plugin.cfg.enable.queue, 'yes', this.plugin.cfg);
        done();
    });

    it('initializes delivery enabled boolean', function (done) {
        this.plugin.load_mongodb_ini();
        assert.equal(this.plugin.cfg.enable.delivery, 'yes', this.plugin.cfg);
        done();
    });

});

describe('register', function () {
    it('loads custom MIME extensions from mongodb.ini', function () {
        this.plugin.name = 'mongodb';
        this.plugin.logerror = function () {};
        this.plugin.lognotice = function () {};
        this.plugin.register_hook = function () {};
        this.plugin.register();
        assert.equal(this.plugin.custom_mime_extensions.get('application/imed'), 'imed');
    });
});

describe('uses text fixtures', function () {
  it('sets up a connection', function (done) {
    this.connection = fixtures.makeConnection()
    assert.ok(this.connection.server)
    done()
  })

  it('sets up a transaction', function (done) {
    this.connection = fixtures.makeConnection({ withTxn: true })
    // console.log(this.connection.transaction)
    assert.ok(this.connection.transaction.header)
    done()
  })
})
