import { describe, it, expect } from 'vitest';
import { escapeHtml, safeUrl } from './html';

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('escapes both quote types so attribute breakout is impossible', () => {
    expect(escapeHtml('" onerror=alert(1) x="')).toBe(
      '&quot; onerror=alert(1) x=&quot;'
    );
    expect(escapeHtml("' onmouseover=alert(1) x='")).toBe(
      '&#39; onmouseover=alert(1) x=&#39;'
    );
  });

  it('escapes ampersand first (no double-encoding of entities)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Fix the login bug')).toBe('Fix the login bug');
  });
});

describe('safeUrl', () => {
  it('passes through http and https URLs', () => {
    expect(safeUrl('https://gitlab.com/g/p/-/issues/1')).toBe(
      'https://gitlab.com/g/p/-/issues/1'
    );
    expect(safeUrl('http://gitlab.example.com/x')).toBe('http://gitlab.example.com/x');
  });

  it('neutralizes javascript: scheme', () => {
    expect(safeUrl('javascript:alert(document.cookie)')).toBe('#');
  });

  it('neutralizes data: and other schemes', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('returns # for unparseable input', () => {
    expect(safeUrl('not a url')).toBe('#');
  });
});
