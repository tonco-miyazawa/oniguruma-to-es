const ui = {
  autoTargetOption: document.getElementById('auto-target-option'),
  input: document.getElementById('input'),
  output: document.getElementById('output'),
  subclassInfo: document.getElementById('subclass-info'),
  comparisonInfo: document.getElementById('comparison-info'),
  runtime: document.getElementById('runtime'),
  bench: document.getElementById('bench'),
};
const state = {
  flags: {
    i: getValue('flag-i'),
    m: getValue('flag-m'),
    x: getValue('flag-x'),
    D: getValue('flag-D'),
    S: getValue('flag-S'),
    W: getValue('flag-W'),
  },
  opts: {
    accuracy: getValue('option-accuracy'),
    avoidSubclass: getValue('option-avoidSubclass'),
    global: getValue('option-global'),
    hasIndices: getValue('option-hasIndices'),
    lazyCompileLength: getValue('option-lazyCompileLength'),
    rules: {
      allowOrphanBackrefs: getValue('option-allowOrphanBackrefs'),
      asciiWordBoundaries: getValue('option-asciiWordBoundaries'),
      captureGroup: getValue('option-captureGroup'),
      recursionLimit: getValue('option-recursionLimit'),
      singleline: getValue('option-singleline'),
    },
    target: getValue('option-target'),
    verbose: getValue('option-verbose'),
  },
  comparison: getValue('comparison'),
  bench: !!(new URL(location).searchParams.get('bench')),
};

const envFlags = {
  flagGroups: (() => {
    try {
      new RegExp('(?i:)');
    } catch {
      return false;
    }
    return true;
  })(),
  unicodeSets: (() => {
    try {
      new RegExp('', 'v');
    } catch {
      return false;
    }
    return true;
  })(),
};
// Logic from `src/options.js`
const autoTarget = envFlags.flagGroups ? 'ES2025' : (envFlags.unicodeSets ? 'ES2024' : 'ES2018');

ui.autoTargetOption.innerHTML += ` [${autoTarget}]`;
autoGrow();
showTranspiled();

if (state.bench) {
  ui.bench.classList.remove('hidden');
}

function autoGrow() {
  ui.input.style.height = '0';
  ui.input.style.height = (ui.input.scrollHeight + 5) + 'px';
}

function showTranspiled() {
  ui.output.classList.remove('error', 'subclass');
  ui.subclassInfo.classList.add('hidden');
  const options = {
    ...state.opts,
    flags: `${
      state.flags.i ? 'i' : ''
    }${
      state.flags.m ? 'm' : ''
    }${
      state.flags.x ? 'x' : ''
    }${
      state.flags.D ? 'D' : ''
    }${
      state.flags.S ? 'S' : ''
    }${
      state.flags.W ? 'W' : ''
    }`,
    target: state.opts.target === 'auto' ? autoTarget : state.opts.target,
  };
  const errorObj = {error: true};
  let details;
  let result = '';
  let runtime = 0;
  try {
    // Use `toRegExpDetails` but display as if `toRegExp` was called. This avoids erroring when the
    // selected `target` includes features that don't work in the user's browser
    const startTime = performance.now();
    details = OnigurumaToEs.toRegExpDetails(ui.input.value, options);
    const endTime = performance.now();
    runtime = endTime - startTime;
    if (details.options) {
      result = getFormattedSubclass(details.pattern, details.flags, details.options);
      ui.subclassInfo.classList.remove('hidden');
      ui.output.classList.add('subclass');
    } else {
      result = `/${getRegExpLiteralPattern(details.pattern)}/${details.flags}`;
    }
  } catch (err) {
    details = errorObj;
    runtime = NaN;
    result = `Error: ${err.message}`;
    ui.output.classList.add('error');
  }
  ui.output.innerHTML = escapeHtml(result);
  if (state.bench) {
    ui.runtime.innerHTML = Number.isNaN(runtime) ? '' : `${Math.round((runtime + Number.EPSILON) * 10) / 10}ms`;
  }

  // ## Compare to all other accuracy/target combinations
  if (!state.comparison) {
    ui.comparisonInfo.classList.add('hidden');
    return;
  }
  ui.comparisonInfo.classList.remove('hidden');
  const otherTargetAccuracyCombinations = ['ES2018', 'ES2024', 'ES2025'].flatMap(
    t => ['default', 'strict'].map(a => ({target: t, accuracy: a}))
  ).filter(c => c.target !== options.target || c.accuracy !== options.accuracy);
  const differents = [];
  // Collect the different results, including differences in error status
  for (const other of otherTargetAccuracyCombinations) {
    let otherDetails;
    try {
      otherDetails = OnigurumaToEs.toRegExpDetails(ui.input.value, {...options, ...other});
    } catch {
      otherDetails = errorObj;
    } finally {
      if (!areDetailsEqual(details, otherDetails)) {
        differents.push({
          ...other,
          error: !!otherDetails.error,
        });
      }
    }
  }
  // Compose and display message about differences or lack thereof
  let str = 'Compared all 6 <code>target</code>/<code>accuracy</code> combinations.';
  if (differents.length) {
    const withError = [];
    const withDiff = [];
    differents.forEach(d => (d.error ? withError : withDiff).push(d));
    if (withError.length) {
      str += ` <b>Can't emulate</b> for ${listDifferents(withError)}.`;
    }
    if (withDiff.length) {
      str += ` Emulation <b>${details.error ? 'is possible' : 'used different details'}</b> for ${listDifferents(withDiff)}.`;
    }
    ui.comparisonInfo.innerHTML = `<p>🔀 ${str}</p>`;
  } else {
    ui.comparisonInfo.innerHTML = `<p>🟰 ${str} Results were the same${
      details.error ? '' : `, except <code>ES2018</code> used flag <code>u</code>`
    }.</p>`;
  }
}

function areDetailsEqual(a, b) {
  if (a.error && b.error) {
    return true;
  }
  if (a.error !== b.error) {
    return false;
  }
  return (
    a.pattern === b.pattern &&
    a.flags.replace(/[uv]/, '') === b.flags.replace(/[uv]/, '') &&
    JSON.stringify(a.options?.hiddenCaptures) === JSON.stringify(b.options?.hiddenCaptures) &&
    JSON.stringify(a.options?.transfers) === JSON.stringify(b.options?.transfers) &&
    a.options?.strategy === b.options?.strategy &&
    a.options?.lazyCompile === b.options?.lazyCompile
  );
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function getFormattedSubclass(pattern, flags, {hiddenCaptures, transfers, strategy, lazyCompile}) {
  const escStr = str => str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const optionStrs = [];
  hiddenCaptures && optionStrs.push(`hiddenCaptures: [${hiddenCaptures.join(',')}]`);
  transfers && optionStrs.push(`transfers: ${JSON.stringify(transfers).replace(/"/g, "'")}`);
  strategy && optionStrs.push(`strategy: '${strategy}'`);
  lazyCompile && optionStrs.push(`lazyCompile: ${lazyCompile}`);
  return `new EmulatedRegExp('${escStr(pattern)}', '${flags}', {\n  ${optionStrs.join(',\n  ')},\n})`;
}

function getRegExpLiteralPattern(str) {
  // Escape any unescaped forward slashes
  return str ? str.replace(/\\([\\\/])|(\/)/g, '\\$1$2') : '(?:)';
}

function getValue(id) {
  const el = document.getElementById(id);
  if (el.type === 'number') {
    return +el.value;
  }
  if (el.type === 'checkbox') {
    return el.checked;
  }
  if (id === 'option-lazyCompileLength') {
    // Turn dropdown values into numbers
    return el.value === 'Infinity' ? Infinity : parseInt(el.value, 10);
  }
  return el.value;
}

function listDifferents(arr) {
  const target = {};
  for (const a of arr) {
    target[a.target] ?? (target[a.target] = []);
    target[a.target].push(a.accuracy);
  }
  return Object.keys(target).map(t => {
    return `target <code>${t}</code> with ${
      target[t].length > 1 ? 'accuracies' : 'accuracy'
    } <code>${target[t].join('</code>/<code>')}</code>`;
  }).join(', ');
}

function setComparison(value) {
  state.comparison = value;
  showTranspiled();
}

function setFlag(flag, value) {
  state.flags[flag] = value;
  showTranspiled();
}

function setOption(option, value) {
  state.opts[option] = value;
  showTranspiled();
}

function setRule(rule, value) {
  state.opts.rules[rule] = value;
  showTranspiled();
}
