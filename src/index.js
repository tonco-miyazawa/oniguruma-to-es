import {transform} from './transform.js';
import {generate} from './generate.js';
import {Accuracy, getOptions, Target} from './options.js';
import {EmulatedRegExp} from './subclass.js';
import {JsUnicodePropertyMap} from './unicode.js';
import {parse} from 'oniguruma-parser/parser';
import {atomic, possessive} from 'regex/internals';
import {recursion} from 'regex-recursion';
/**
@import {EmulatedRegExpOptions} from './subclass.js';
*/

// The validation and transformation for Oniguruma's unique syntax and behavior differences
// compared to native JS RegExp is layered into all steps of the compilation process:
// 1. Parser: Uses `oniguruma-parser` to build an Oniguruma AST, which accounts for many
//    differences between Oniguruma and JS.
// 2. Transformer: Converts the Oniguruma AST to a Regex+ AST that preserves all Oniguruma
//    behavior. This is true even in cases of non-native-JS features that are supported by both
//    Regex+ and Oniguruma but with subtly different behavior in each (subroutines, flag x).
// 3. Generator: Converts the Regex+ AST to a Regex+ pattern, flags, and options.
// 4. Postprocessing: Regex+ internals and plugins are used to transpile several remaining features
//    (atomic groups, possessive quantifiers, recursion). Regex+ uses a strict superset of JS
//    RegExp syntax, so using it allows this library to benefit from not reinventing the wheel for
//    complex features that Regex+ already knows how to transpile to JS.

/**
@typedef {{
  accuracy?: keyof Accuracy;
  avoidSubclass?: boolean;
  flags?: string;
  global?: boolean;
  hasIndices?: boolean;
  lazyCompileLength?: number;
  rules?: {
    allowOrphanBackrefs?: boolean;
    asciiWordBoundaries?: boolean;
    captureGroup?: boolean;
    recursionLimit?: number;
    singleline?: boolean;
  };
  target?: keyof Target;
  verbose?: boolean;
}} ToRegExpOptions
*/

/**
Accepts an Oniguruma pattern and returns an equivalent JavaScript `RegExp`.
@param {string} pattern Oniguruma regex pattern.
@param {ToRegExpOptions} [options]
@returns {RegExp | EmulatedRegExp}
*/
function toRegExp(pattern, options) {
  const d = toRegExpDetails(pattern, options);
  if (d.options) {
    return new EmulatedRegExp(d.pattern, d.flags, d.options);
  }
  return new RegExp(d.pattern, d.flags);
}

/**
Accepts an Oniguruma pattern and returns the details for an equivalent JavaScript `RegExp`.
@param {string} pattern Oniguruma regex pattern.
@param {ToRegExpOptions} [options]
@returns {{
  pattern: string;
  flags: string;
  options?: EmulatedRegExpOptions;
}}
*/
function toRegExpDetails(pattern, options) {
  const opts = getOptions(options);
  const onigurumaAst = parse(pattern, {
    flags: opts.flags,
    normalizeUnknownPropertyNames: true,
    rules: {
      captureGroup: opts.rules.captureGroup,
      singleline: opts.rules.singleline,
    },
    skipBackrefValidation: opts.rules.allowOrphanBackrefs,
    unicodePropertyMap: JsUnicodePropertyMap,
  });
  const regexPlusAst = transform(onigurumaAst, {
    accuracy: opts.accuracy,
    asciiWordBoundaries: opts.rules.asciiWordBoundaries,
    avoidSubclass: opts.avoidSubclass,
    bestEffortTarget: opts.target,
  });
  const generated = generate(regexPlusAst, opts);
  const recursionResult = recursion(generated.pattern, {
    captureTransfers: generated._captureTransfers,
    hiddenCaptures: generated._hiddenCaptures,
    mode: 'external',
  });
  const possessiveResult = possessive(recursionResult.pattern);
  const atomicResult = atomic(possessiveResult.pattern, {
    captureTransfers: recursionResult.captureTransfers,
    hiddenCaptures: recursionResult.hiddenCaptures,
  });
  const details = {
    pattern: atomicResult.pattern,
    flags: `${opts.hasIndices ? 'd' : ''}${opts.global ? 'g' : ''}${generated.flags}${generated.options.disable.v ? 'u' : 'v'}`,
  };
  if (opts.avoidSubclass) {
    if (opts.lazyCompileLength !== Infinity) {
      throw new Error('Lazy compilation requires subclass');
    }
  } else {
    // Sort isn't required; only for readability when serialized
    const hiddenCaptures = atomicResult.hiddenCaptures.sort((a, b) => a - b);
    // Change the map to the `EmulatedRegExp` format, serializable as JSON
    const transfers = Array.from(atomicResult.captureTransfers);
    const strategy = regexPlusAst._strategy;
    const lazyCompile = details.pattern.length >= opts.lazyCompileLength;
    if (hiddenCaptures.length || transfers.length || strategy || lazyCompile) {
      details.options = {
        ...(hiddenCaptures.length && {hiddenCaptures}),
        ...(transfers.length && {transfers}),
        ...(strategy && {strategy}),
        ...(lazyCompile && {lazyCompile}),
      };
    }
  }
  return details;
}

// function toOnigurumaAst(pattern, options) {
//   return parse(pattern, {
//     flags: options?.flags ?? '',
//     normalizeUnknownPropertyNames: true,
//     rules: options?.rules ?? {},
//     unicodePropertyMap: JsUnicodePropertyMap,
//   });
// }

// function toRegexPlusAst(pattern, options) {
//   return transform(toOnigurumaAst(pattern, options));
// }

export {
  EmulatedRegExp,
  toRegExp,
  toRegExpDetails,
  // toOnigurumaAst,
  // toRegexPlusAst,
};
