
// node.js built-in modules
var assert   = require('assert');

// npm modules
var fixtures = require('haraka-test-fixtures');

// start of tests
//    assert: https://nodejs.org/api/assert.html
//    mocha: http://mochajs.org

beforeEach(function (done) {
    this.plugin = new fixtures.plugin('template');
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

describe('uses text fixtures', function () {
  it('sets up a connection', function (done) {
    this.connection = fixtures.connection.createConnection({})
    assert.ok(this.connection.server)
    done()
  })

  it('sets up a transaction', function (done) {
    this.connection = fixtures.connection.createConnection({})
    this.connection.transaction = fixtures.transaction.createTransaction({})
    // console.log(this.connection.transaction)
    assert.ok(this.connection.transaction.header)
    done()
  })
})
