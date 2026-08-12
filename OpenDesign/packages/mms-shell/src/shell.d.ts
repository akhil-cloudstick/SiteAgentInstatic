/**
 * Asset + CSS-Module typings for consumers whose own `vite-env.d.ts` /
 * `next-env.d.ts` does not reach outside their app root.
 *
 * Both bundlers already understand these imports at build time; this file
 * only teaches `tsc` about them so the package typechecks standalone and
 * inside either app.
 */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.css' {
  const content: string
  export default content
}
