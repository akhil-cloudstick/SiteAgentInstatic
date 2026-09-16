/**
 * Classes that content HTML uses, and classes the site's own JavaScript
 * switches on, survive the style tree-shake.
 *
 * Both came from an imported site on staging: article bodies are HTML whose
 * `<blockquote class="article-quote">` no node references, and the reveal
 * animation's `.pillar.visible` matches nothing until its script has run — so
 * publishing dropped both sets of rules, leaving article text unstyled and the
 * scroll-reveal headings stuck dim.
 */

import { describe, it, expect } from 'bun:test'
import {
  collectClassCSS,
  collectContentClassNames,
  collectScriptClassNames,
  treeShakeStyleRules,
} from '@core/publisher'
import type { StyleRule } from '@core/page-tree'
import { makePage, makeSite } from './helpers'

function rule(id: string, kind: 'class' | 'ambient', selector: string): StyleRule {
  return {
    id,
    name: kind === 'class' ? id : selector,
    kind,
    selector,
    order: 0,
    styles: { color: 'red' },
    contextStyles: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

const RULES: Record<string, StyleRule> = {
  hero: rule('hero', 'class', '.hero'),
  'article-quote': rule('article-quote', 'class', '.article-quote'),
  'quote-cite': rule('quote-cite', 'ambient', '.article-quote cite'),
  'unused-card': rule('unused-card', 'class', '.unused-card'),
  'card-title': rule('card-title', 'ambient', '.unused-card h3'),
}

const REVEAL_RULES: Record<string, StyleRule> = {
  ...RULES,
  visible: rule('visible', 'class', '.visible'),
  'hero-visible': rule('hero-visible', 'ambient', '.hero.visible'),
}

const scriptFile = (content: string) => ({
  id: 'f1',
  path: 'src/scripts/reveal.ts',
  type: 'script' as const,
  content,
  createdAt: 0,
  updatedAt: 0,
})

describe('collectContentClassNames', () => {
  it('collects class tokens from HTML strings nested anywhere in cell values', () => {
    const names = collectContentClassNames([
      {
        body: '<p>x</p>\n<blockquote class="article-quote">q</blockquote><figure class=\'article-figure wide\'>',
        nested: [{ html: '<a class="btn  primary" href="#">go</a>' }],
        count: 3,
        flag: true,
        none: null,
      },
    ])
    expect([...names].sort()).toEqual(['article-figure', 'article-quote', 'btn', 'primary', 'wide'])
  })

  it('ignores attributes that only end in "class" and text that is not an attribute', () => {
    expect(collectContentClassNames(['<div data-class="nope">class="x"</div>']).size).toBe(0)
  })
})

describe('collectScriptClassNames', () => {
  it('collects the classes a script switches on, and nothing else in the file', () => {
    const names = collectScriptClassNames([
      scriptFile(`
        const obs = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.add('visible')))
        document.querySelectorAll('.ghost').forEach((el) => el.classList.toggle("revealed", true))
        card.className = 'case-card hidden'
        el.setAttribute('class', 'is-ok')
        const heading = 'this string is not a class'
      `),
      { id: 'f2', path: 'src/styles/site.css', type: 'style', content: '.never-used { color: red }' },
    ])
    expect([...names].sort()).toEqual(['case-card', 'hidden', 'is-ok', 'revealed', 'visible'])
  })

  it('reads nothing from a site with no scripts', () => {
    expect(collectScriptClassNames([]).size).toBe(0)
  })
})

describe('treeShakeStyleRules with content classes', () => {
  const usedIds = new Set(['hero'])

  it('without content classes, a class no node references is shaken out with its dependants', () => {
    expect(Object.keys(treeShakeStyleRules(RULES, usedIds)).sort()).toEqual(['hero'])
  })

  it('keeps a class content HTML uses, and the rules that depend on it, and nothing else', () => {
    const selected = treeShakeStyleRules(RULES, usedIds, new Set(['article-quote']))
    expect(Object.keys(selected).sort()).toEqual(['article-quote', 'hero', 'quote-cite'])
  })

  it('collectClassCSS emits the kept rules', () => {
    const site = makeSite({ styleRules: RULES })
    site.pages = [makePage({ root: { moduleId: 'base.text', props: { text: 'Hi' }, classIds: ['hero'] } })]
    const css = collectClassCSS(site, {}, new Set(['article-quote']))
    expect(css).toContain('.article-quote cite')
    expect(css).not.toContain('.unused-card')
  })
})

describe('collectClassCSS with a site script', () => {
  function revealSite(files: ReturnType<typeof scriptFile>[]) {
    const site = makeSite({ styleRules: REVEAL_RULES })
    site.pages = [makePage({ root: { moduleId: 'base.text', props: { text: 'Hi' }, classIds: ['hero'] } })]
    site.files = files
    return site
  }

  it('drops the animated state when no script switches the class on', () => {
    expect(collectClassCSS(revealSite([]))).not.toContain('.hero.visible')
  })

  it('keeps the animated state when a script adds the class at runtime', () => {
    const css = collectClassCSS(revealSite([scriptFile("el.classList.add('visible')")]))
    expect(css).toContain('.hero.visible')
  })

  it('still drops classes the scripts never mention', () => {
    const css = collectClassCSS(revealSite([scriptFile("el.classList.add('visible')")]))
    expect(css).not.toContain('.unused-card')
  })
})
