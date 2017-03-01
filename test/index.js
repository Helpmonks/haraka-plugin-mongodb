
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

describe('load_template_ini', function () {
    it('loads template.ini from config/template.ini', function (done) {
        this.plugin.load_template_ini();
        assert.ok(this.plugin.cfg);
        done();
    });

    it('initializes enabled boolean', function (done) {
        this.plugin.load_template_ini();
        assert.equal(this.plugin.cfg.main.enabled, true, this.plugin.cfg);
        done();
    });
});