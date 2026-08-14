const querystring = require('querystring');

/**
 * Query Parameter Name Normalizer
 *
 * Installed as the Express `query parser` (see src/index.js), NOT as a
 * middleware — in Express 5 `req.query` is a read-only getter, so the parser is
 * the only place where the shape can still be influenced.
 *
 * Parameter NAMES are case-insensitive on both sides:
 *
 *   - The own keys are lowercased. That is the canonical spelling: everything
 *     that spreads or enumerates `req.query` (validators, the request logger,
 *     the query controller) keeps seeing exactly one spelling per parameter.
 *   - A Proxy resolves reads in ANY casing on top. `req.query.objectType` and
 *     `req.query.objecttype` return the same value, whichever spelling the
 *     client sent.
 *
 * The Proxy is what makes the contract two-sided. With lowercasing alone a
 * camelCase read yields `undefined` — silently, because an absent optional
 * query parameter is legitimate. A filter built on it then degrades into a
 * no-op instead of raising: that is how the `objectType`/`testType` filters of
 * `GET /api/tests` came to return every test for every object type.
 *
 * Parameter VALUES are untouched — only names are case-folded.
 */
function createQueryParser() {
  return (queryString) => {
    const normalized = {};
    for (const [key, value] of Object.entries(querystring.parse(queryString))) {
      normalized[key.toLowerCase()] = value;
    }
    return new Proxy(normalized, {
      get(target, prop, receiver) {
        // Symbols and anything already resolvable (own keys, plus inherited
        // members like toString that consumers may legitimately touch) behave
        // normally; only an unknown string key retries lowercased.
        if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop, receiver);
        return target[prop.toLowerCase()];
      },
      has(target, prop) {
        if (typeof prop !== 'string') return Reflect.has(target, prop);
        return prop in target || prop.toLowerCase() in target;
      },
    });
  };
}

module.exports = createQueryParser;
module.exports.createQueryParser = createQueryParser;
