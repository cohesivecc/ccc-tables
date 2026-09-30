// Stylesheet contract checks. DOM/layout behavior is verified in a browser
// (demo/ + the template's staging site); these pin the rules that encode
// release decisions so a later edit can't silently revert them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ccc-tables.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // comments out — they mention old values

/* Declarations of every unindented (top-level) rule whose selector list is exactly `sel`. */
function declsFor(sel) {
  const re = new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'gm');
  return [...css.matchAll(re)].map(m => m[1]);
}

// ---------- v0.6.2: natural height by default ----------

test('css: .ccc-table_scroll has no internal vertical scroll by default', () => {
  const decls = declsFor('.ccc-table_scroll').join(';');
  assert.match(decls, /overflow-x:\s*auto/, 'horizontal scroll for wide tables stays');
  assert.doesNotMatch(decls, /max-height/);
  assert.doesNotMatch(decls, /overflow-y/);
});

test('css: config.maxHeight opt-in is screen-only and reads --ccc-scroll-max', () => {
  const block = css.match(/@media screen\s*\{([\s\S]*?\})\s*\}/);
  assert.ok(block, 'a bare @media screen block exists');
  assert.match(block[1], /\[ccc-scroll-y\]\s+\.ccc-table_scroll\s*\{[^}]*max-height:\s*var\(--ccc-scroll-max/);
  assert.match(block[1], /\[ccc-scroll-y\]\s+\.ccc-table_scroll\s*\{[^}]*overflow-y:\s*auto/);
});

// ---------- v0.6.2: the phone switcher never matches paper ----------

test('css: mobile switcher media query is screen-only', () => {
  assert.match(css, /@media screen and \(max-width:\s*767px\)\s*\{[\s\S]*\[ccc-mobile-switcher\] \.ccc-table_toolbar/);
  assert.doesNotMatch(css, /@media\s*\(max-width/, 'no unqualified width query left');
});

// ---------- v0.6.2: a centred/right col 0 under the first-column cap ----------

test('css: centred col 0 centres its capped .ccc-table_rh box', () => {
  assert.match(css, /\[ccc-clamp-first\] \[data-ccc-align="center"\] > \.ccc-table_rh\s*\{[^}]*margin-inline:\s*auto/);
});

test('css: right-aligned col 0 pushes its capped box to the end', () => {
  assert.match(css, /\[ccc-clamp-first\] \[data-ccc-align="right"\] > \.ccc-table_rh\s*\{[^}]*margin-inline-start:\s*auto/);
});

test('css: the stacked mobile layout resets the col-0 box margins (left-aligned stack)', () => {
  const mobile = css.slice(css.indexOf('@media screen and (max-width: 767px)'));
  assert.match(mobile, /\[ccc-mobile-switcher\] \[data-ccc-align\] > \.ccc-table_rh\s*\{[^}]*margin-inline:\s*0/);
});
