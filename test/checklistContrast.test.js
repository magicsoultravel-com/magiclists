// test/checklistContrast.test.js
// Regression guard for checklist group chevron contrast on custom-background
// notes. The chevron color used to be clobbered by a duplicate
// `.expanded-checklist .step-collapse-btn { color: var(--text-main) }` rule that
// tied on specificity with `.has-custom-bg .step-collapse-btn` but won on source
// order, forcing the global theme text color onto light/dark custom note
// backgrounds where it does not contrast. These assertions lock in the single
// source of truth so that tie cannot come back.
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_DIR = join(HERE, '..', 'css');

// Stylesheet load order (index.html / popout.html): later files win specificity
// ties, so the custom-bg override must live in cards.css, after shell-editor.css.
const CSS_LOAD_ORDER = ['shell-editor.css', 'cards.css'];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Rule blocks (top-level and nested) as { selector, body }; at-rules skipped. */
function extractRules(css) {
  const clean = stripComments(css);
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selector, body: match[2] });
  }
  return rules;
}

function selectorParts(selector) {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function declarations(body) {
  const out = {};
  for (const chunk of body.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx === -1) continue;
    const prop = chunk.slice(0, idx).trim().toLowerCase();
    const value = chunk.slice(idx + 1).trim();
    if (prop) out[prop] = value;
  }
  return out;
}

const stylesheets = CSS_LOAD_ORDER.map((name) => ({
  name,
  rules: extractRules(readFileSync(join(CSS_DIR, name), 'utf8'))
}));

/** Every rule in load order whose selector list contains `needle`. */
function rulesTargeting(needle) {
  const hits = [];
  for (const { name, rules } of stylesheets) {
    for (const rule of rules) {
      for (const selector of selectorParts(rule.selector)) {
        if (selector.includes(needle)) {
          hits.push({ file: name, selector, decls: declarations(rule.body) });
        }
      }
    }
  }
  return hits;
}

describe('checklist group chevron contrast (custom backgrounds)', () => {
  it('never re-declares a chevron color inside .expanded-checklist', () => {
    const offenders = rulesTargeting('.step-collapse-btn')
      .filter((hit) => hit.selector.includes('.expanded-checklist'))
      .filter((hit) => hit.decls.color)
      .map((hit) => `${hit.file}: ${hit.selector} { color: ${hit.decls.color} }`);
    assert.deepEqual(
      offenders,
      [],
      'the expanded-checklist chevron rule must not set color; the base rule and the .has-custom-bg override own it'
    );
  });

  it('keeps the base chevron color as the theme text token', () => {
    const base = rulesTargeting('.step-collapse-btn').filter(
      (hit) => hit.file === 'shell-editor.css' && hit.selector === '.step-collapse-btn'
    );
    assert.ok(base.length > 0, 'base .step-collapse-btn rule should exist');
    assert.ok(
      base.some((hit) => hit.decls.color === 'var(--text-main)'),
      'base .step-collapse-btn should use var(--text-main) for non-custom notes'
    );
  });

  it('maps a custom-background chevron to the per-card contrast token', () => {
    const override = rulesTargeting('.step-collapse-btn').find(
      (hit) => hit.file === 'cards.css' && hit.selector === '.has-custom-bg .step-collapse-btn'
    );
    assert.ok(override, '.has-custom-bg .step-collapse-btn override should exist in cards.css');
    assert.equal(override.decls.color, 'var(--card-fg)');
  });

  it('lets the custom-bg override win the cascade (last chevron color rule)', () => {
    const colorRules = rulesTargeting('.step-collapse-btn')
      .filter((hit) => hit.decls.color)
      .map((hit) => hit.selector);
    assert.deepEqual(
      colorRules,
      ['.step-collapse-btn', '.step-collapse-btn:hover', '.has-custom-bg .step-collapse-btn'],
      'chevron color rules must be exactly the base pair plus the custom-bg override, in load order'
    );
  });
});

describe('completed-items toggle contrast (custom backgrounds)', () => {
  it('keeps the base toggle on the theme muted token', () => {
    const base = rulesTargeting('.checklist-done-toggle').filter(
      (hit) => hit.file === 'cards.css' && hit.selector === '.checklist-done-toggle'
    );
    assert.ok(base.length > 0, 'base .checklist-done-toggle rule should exist in cards.css');
    assert.ok(base.some((hit) => hit.decls.color === 'var(--text-muted)'));
  });

  it('maps the toggle label and chevron to the per-card contrast tokens', () => {
    const hits = rulesTargeting('.checklist-done-toggle');
    const find = (selector) => hits.find(
      (hit) => hit.file === 'cards.css' && hit.selector === selector
    );
    assert.equal(find('.has-custom-bg .checklist-done-toggle')?.decls.color, 'var(--card-muted)');
    assert.equal(find('.has-custom-bg .checklist-done-toggle:hover')?.decls.color, 'var(--card-fg)');
    assert.equal(find('.has-custom-bg .checklist-done-toggle-icon')?.decls.color, 'var(--card-muted)');
  });
});
