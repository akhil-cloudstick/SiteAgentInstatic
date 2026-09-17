/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** The signed-in administrator, set by src/middleware.ts. */
    admin?: { id: string; email: string };
  }
}
