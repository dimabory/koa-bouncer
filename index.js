'use strict';

// Node
const util = require('util');
// 3rd party
const _ = require('lodash');
const debug = require('debug')('koa-bouncer');
const v = require('validator');
const assert = require('better-assert');

// Number -> Bool
// ES6 introduces {MIN,MAX}_SAFE_INTEGER
//
// Exported only for testing
const isSafeInteger = exports.isSafeInteger = function(n) {
  return Number.MIN_SAFE_INTEGER <= n && n <= Number.MAX_SAFE_INTEGER;
};

function ValidationError(key, message) {
  this.name = 'ValidationError';
  this.message = message;
  this.bouncer = {
    key: key,
    message: message
  };
}
ValidationError.prototype = _.create(Error.prototype);

function Validator(props) {
  this.ctx = props.ctx;  // Koa context
  this.key = props.key;
  this.vals = props.vals;
  this.type = props.type;
  this.throwError = function(tip) {
    throw new ValidationError(this.key, tip || 'Invalid value for ' + this.key);
  };
  // get current contained value
  this.val = () => {
    return this.vals[this.key];
  };

  this._isOptional = false;
  this.isOptional = () => {
    if (this._isOptional && !_.isUndefined(this.val())) {
      this._isOptional = false;
    }
    return this._isOptional;
  };

  // set props.val to define an initial val when instantiating a validator
  //
  // Populate vals on init
  // Ex: this.validateBody('foo') will populate this.vals.foo
  //     with this.request.body.foo (even if undefined)
  this.vals[this.key] = props.val;
}

////////////////////////////////////////////////////////////

// wrap prototype functions with this if they should noop
// if the Validator is in optional state
function optionalFn(fn) {
  return function() {
    if (this.isOptional()) {
      return this;
    }

    var args = Array.prototype.slice.call(arguments);
    return fn.apply(this, args);
  };
}

// add prototype methods to the Validator function with this
// if you want the method to noop when Validator is in optional state
Validator.addMethod = function(name, fn) {
  Validator.prototype[name] = optionalFn(fn);
};

////////////////////////////////////////////////////////////
// Built-in methods
////////////////////////////////////////////////////////////

// cannot be undefined
Validator.prototype.required = function(tip) {
  if (_.isUndefined(this.val()))
    this.throwError(tip || this.key + ' must not be empty');

  return this;
};

Validator.prototype.optional = function() {
  if (_.isUndefined(this.val())) {
    this._isOptional = true;
  }
  return this;
};

Validator.addMethod('isIn', function(arr, tip) {
  assert(_.isArray(arr));
  if (!_.contains(arr, this.val()))
    this.throwError(tip || 'Invalid ' + this.key);
  return this;
});

// Ensures value is not in given array
Validator.addMethod('isNotIn', function(arr, tip) {
  assert(_.isArray(arr));
  if (_.contains(arr, this.val()))
    this.throwError(tip || 'Invalid ' + this.key);
  return this;
});

// Ensures value is an array
Validator.addMethod('isArray', function(tip) {
  if (!_.isArray(this.val()))
    this.throwError(tip || util.format('%s must be an array', this.key));
  return this;
});

// Ensures value is === equivalent to given value
Validator.addMethod('eq', function(otherValue, tip) {
  if (this.val() !== otherValue)
    this.throwError(tip || 'Invalid ' + this.key);
  return this;
});

// Ensures value > given value
Validator.addMethod('gt', function(otherValue, tip) {
  assert(_.isNumber(this.val()));
  assert(_.isNumber(otherValue));

  if (this.val() <= otherValue)
    this.throwError(tip || 'Invalid ' + this.key);

  return this;
});

// Ensures value >= given value
Validator.addMethod('gte', function(otherValue, tip) {
  assert(_.isNumber(this.val()));
  assert(_.isNumber(otherValue));

  if (this.val() < otherValue)
    this.throwError(tip || 'Invalid ' + this.key);

  return this;
});

// Ensures value < given value
Validator.addMethod('lt', function(otherValue, tip) {
  assert(_.isNumber(this.val()));
  assert(_.isNumber(otherValue));

  if (this.val() >= otherValue)
    this.throwError(tip || 'Invalid ' + this.key);

  return this;
});

// Ensures value <= given value
Validator.addMethod('lte', function(otherValue, tip) {
  assert(_.isNumber(this.val()));
  assert(_.isNumber(otherValue));

  if (this.val() > otherValue)
    this.throwError(tip || 'Invalid ' + this.key);

  return this;
});

// Ensures value's length is [min, max] inclusive
//
// Note: You must ensure this.val has a `.length` property before calling
// this method.
Validator.addMethod('isLength', function(min, max, tip) {
  assert(!_.isUndefined(this.val().length));
  assert(Number.isInteger(min));
  assert(Number.isInteger(max));
  assert(min <= max);

  if (this.val().length < min || this.val().length > max) {
    this.throwError(
      tip || util.format('%s must be %s-%s characters long', this.key, min, max)
    );
  }

  return this;
});

// If value is undefined, set it to given value or to the value
// returned by a function.
Validator.addMethod('defaultTo', function(valueOrFunction) {
  var val = this.val();
  if (_.isUndefined(this.val())) {
    if (_.isFunction(valueOrFunction)) {
      // Run fn with `this` bound to Koa context
      val = valueOrFunction.call(this.ctx);
    } else {
      val = valueOrFunction;
    }
  }

  this.vals[this.key] = val;
  return this;
});

Validator.addMethod('isString', function(tip) {
  if (!_.isString(this.val())) {
    this.throwError(tip || util.format('%s must be a string', this.key));
  }

  return this;
});

// Checks if is already an integer (and type number), throws if its not
Validator.addMethod('isInt', function(tip) {
  if (!Number.isInteger(this.val())) {
    this.throwError(tip || util.format('%s must be an integer', this.key));
  }

  if (!isSafeInteger(this.val())) {
    this.throwError(tip || util.format('%s is out of integer range', this.key));
  }

  return this;
});


// Converts value to integer, throwing if it fails
Validator.addMethod('toInt', function(tip) {
  if (!v.isInt(this.val())) {
    this.throwError(tip || util.format('%s must be an integer', this.key));
  }

  var num = Number.parseInt(this.val(), 10);

  if (!isSafeInteger(num)) {
    this.throwError(tip || util.format('%s is out of integer range', this.key));
  }

  this.vals[this.key] = num;
  return this;
});

// general isNumber check
//
// Note that there are difference betweent he global `isFinite` fn
// and the new ES6 `Number.isFinite` fn.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isFinite
Validator.addMethod('isFiniteNumber', function(tip) {
  if (!Number.isFinite(this.val()))
    this.throwError(tip || util.format('%s must be a number', this.key));

  return this;
});

// If value is not already an array, puts it in a singleton array
Validator.addMethod('toArray', function() {
  let val = this.val();
  val = _.isUndefined(val) ? [] : val;
  val = (_.isArray(val) ? val : [val]);
  this.vals[this.key] = val;
  return this;
});

// Converts value to array if it's not already an array,
// and then converts every item in the array to an integer
// throwing if any of them fail conversion
//
// '5abc' will cause ValidationError even though parseInt would
// parse it into 5. this is because you err on the side of being
// less lenient with user input.
Validator.addMethod('toInts', function(tip) {
  assert(_.isArray(this.val()));

  if (!_.every(this.val(), v.isInt)) {
    this.throwError(tip || this.key + ' must be an array of integers');
  }

  var results = this.val().map(function(v) {
    return parseInt(v, 10);
  });

  if (!_.every(results, isSafeInteger)) {
    this.throwError(tip || this.key + ' must not contain numbers out of integer range');
  }

  this.vals[this.key] = results;
  return this;
});

// Converts value to array if necessary, then de-dupes it
Validator.addMethod('uniq', function() {
  assert(_.isArray(this.val()));
  this.vals[this.key] = _.uniq(this.val());
  return this;
});

// Converts value to boolean
// Always succeeds
Validator.addMethod('toBoolean', function() {
  this.vals[this.key] = !!this.val();
  return this;
});

// Converts value to float, throwing if it fails
Validator.addMethod('toFloat', function(tip) {
  if (!v.isFloat(this.val()))
    this.throwError(tip || this.key + ' must be a float');
  var result = parseFloat(this.val());
  this.vals[this.key] = result;
  return this;
});

// Converts value to string
// Undefined value converts to empty string
// Always succeeds
Validator.addMethod('toString', function() {
  this.vals[this.key] = (this.val() && this.val().toString() || '');
  return this;
});

// Converts value into a trimmed string
// Always succeeds
// TODO: Maybe write a collapseWhitespace() function that collapses
// consecutive newlines/spaces spam
Validator.addMethod('trim', function() {
  assert(_.isString(this.val()));
  this.vals[this.key] = this.val().trim();
  return this;
});

// Assert that a string does match the supplied regular expression.
Validator.addMethod('match', function(regexp, tip) {
  assert(_.isString(this.val()));
  assert(_.isRegExp(regexp));

  if (!regexp.test(this.val()))
    this.throwError(tip || 'Invalid ' + this.key);

  return this;
});

// Assert that value does not match the supplied regular expression.
Validator.addMethod('notMatch', function(regexp, tip) {
  assert(_.isString(this.val()));
  assert(_.isRegExp(regexp));

  if (regexp.test(this.val()))
    this.throwError(tip || 'Invalid ' + this.key);

  return this;
});

Validator.addMethod('check', function(result, tip) {
  if (!result)
    this.throwError(tip);

  return this;
});

Validator.addMethod('checkNot', function(result, tip) {
  if (result)
    this.throwError(tip);

  return this;
});

Validator.addMethod('fromJson', function(tip) {
  var parsedObj;
  try {
    parsedObj = JSON.parse(this.val());
  } catch(ex) {
    this.throwError(tip || 'Invalid JSON for ' + this.key);
  }

  this.vals[this.key] = parsedObj;
  return this;
});

// Arbitrarily transform the current value inside a validator.
//
// f is a function that takes one argument: the current value in the validator.
// Whatever value f returns becomes the new value.
Validator.addMethod('tap', function(f) {
  assert(_.isFunction(f));

  var result;
  try {
    result = f.bind(this.ctx)(this.val());
  } catch(ex) {
    if (ex instanceof ValidationError)
      this.throwError(); // why is this empty
    throw ex;
  }

  this.vals[this.key] = result;
  return this;
});

// Pipes val through predicate function that must return truthy
Validator.addMethod('checkPred', function(pred, tip) {
  assert(_.isFunction(pred));

  if (!pred.call(this.ctx, this.val()))
    this.throwError(tip);

  return this;
});

Validator.addMethod('checkNotPred', function(pred, tip) {
  assert(_.isFunction(pred));

  if (pred.call(this.ctx, this.val()))
    this.throwError(tip);

  return this;
});

////////////////////////////////////////////////////////////
// More specific validator methods
////////////////////////////////////////////////////////////

Validator.addMethod('isAlpha', function(tip) {
  const re = /^[a-z]*$/i;
  tip = tip || this.key + ' must only contain chars a-z';
  this.isString(tip);
  if (!re.test(this.val()))
    this.throwError(tip);
  return this;
});

Validator.addMethod('isAlphanumeric', function(tip) {
  const re = /^[a-z0-9]*$/i;
  tip = tip || this.key + ' must must be alphanumeric (a-z, 0-9)';
  this.isString(this);
  if (!re.test(this.val()))
    this.throwError(tip);
  return this;
});

Validator.addMethod('isNumeric', function(tip) {
  const re = /^[0-9]*$/;
  tip = tip || this.key + ' must must only contain numbers';
  this.isString(tip);
  if (!re.test(this.val()))
    this.throwError(tip);
  return this;
});

Validator.addMethod('isAscii', function(tip) {
  const re = /^[\x00-\x7F]*$/;
  tip = tip || this.key + ' must contain only ASCII chars';
  if (!re.test(this.val()))
    this.throwError(tip);
  return this;
});

Validator.addMethod('isBase64', function(tip) {
  tip = tip || this.key + ' must be base64 encoded';
  this.isString(tip);
  if (this.val().length === 0)
    return this;
  if (!v.isBase64(this.val()))
    this.throwError(tip);
  return this;
});

// TODO: Add support to validator's `options` into isEmail
Validator.addMethod('isEmail', function(tip) {
  tip = tip || this.key + ' must be a valid email address';
  this.isString(tip);
  if (!v.isEmail(this.val()))
    this.throwError(tip);
  return this;
});

Validator.addMethod('isHexColor', function(tip) {
  tip = tip || this.key + ' must be a hex color';
  this.isString(tip);
  if (!v.isHexColor(this.val()))
    this.throwError(tip);
  return this;
});

//.isUuid('v4', 'must be uuid');
//.isUuid('must be uuid');
//.isUuid('v4');
//.isUuid();
Validator.addMethod('isUuid', function(version, tip) {
  if (_.isString(version) && _.isUndefined(tip)) {
    // Handle .isUuid('must be uuid') and .isUuid('v4')
    if (!_.contains(['v3', 'v4', 'v5', 'all'], version)) {
      // Handle: .isUuid('must be uuid')
      tip = version;
      version = 'all';
    }
  } else if (_.isUndefined(version) && _.isUndefined(tip)) {
    // Handle: .isUuid()
    version = 'all';
  }

  tip = tip || (this.key + ' must be a UUID' + (version !== 'all' ? version : ''));

  const re = {
    'v3': /^[0-9A-F]{8}-[0-9A-F]{4}-3[0-9A-F]{3}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
    'v4': /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
    'v5': /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
    all: /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i
  };

  if (!re[version].test(this.val()))
    this.throwError(tip);

  return this;
});

Validator.addMethod('isJson', function(tip) {
  tip = tip || this.key + ' must be JSON';
  this.isString(tip);
  try {
    JSON.parse(this.val());
  } catch(err) {
    this.throwError(tip);
  }
  return this;
});

////////////////////////////////////////////////////////////
// API
////////////////////////////////////////////////////////////

exports.ValidationError = ValidationError;

exports.Validator = Validator;

exports.middleware = function middleware(opts) {
  opts = opts || {};

  // default ctx getters that user can override
  // they should take the Koa context and return an object
  opts.getParams = opts.getParams || function(ctx) { return ctx.params; };
  opts.getQuery = opts.getQuery || function(ctx) { return ctx.query; };
  opts.getBody = opts.getBody || function(ctx) { return ctx.request.body; };

  return function*(next) {
    debug('Initializing koa-bouncer');
    var self = this;
    this.vals = {};

    // we save initialized validators so that multiple calls to, example,
    // this.validateBody('foo') will return the same validator
    const validators = new Map();

    this.validateParam = function(key) {
      return validators.get(key) || validators.set(key,
        new Validator({
          ctx: self,
          key: key,
          val: self.vals[key] === undefined ? opts.getParams(self)[key] : self.vals[key],
          vals: self.vals
        })
      ).get(key);
    };
    this.validateQuery = function(key) {
      return validators.get(key) || validators.set(key,
        new Validator({
          ctx: self,
          key: key,
          val: self.vals[key] === undefined ? opts.getQuery(self)[key] : self.vals[key],
          vals: self.vals
        })
      ).get(key);
    };
    this.validateBody = function(key) {
      return validators.get(key) || validators.set(key,
        new Validator({
          ctx: self,
          key: key,
          val: self.vals[key] === undefined ? opts.getBody(self)[key] : self.vals[key],
          vals: self.vals,
          type: 'body'
        })
      ).get(key);
    };
    this.validate = this.check = function(result, tip) {
      if (!result)
        throw new ValidationError(null, tip);
    };
    this.validateNot = this.checkNot = function(result, tip) {
      if (result)
        throw new ValidationError(null, tip);
    };
    yield next;
  };
};
