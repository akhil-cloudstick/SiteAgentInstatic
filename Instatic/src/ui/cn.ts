/**
 * Class composition helper — now owned by `@mms/shell`.
 *
 * It moved there with the shared two-row shell: the shell's own CSS Modules
 * compose classes with it, and a second copy in this app would be a second
 * implementation of a one-line contract. Re-exported at the original specifier
 * so no call site had to change.
 */
export { cn } from '@mms/shell'
