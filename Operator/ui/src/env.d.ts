/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** The signed-in administrator and their scope, set by src/middleware.ts. */
    admin?: {
      id: string;
      email: string;
      scope: { level: 'platform' | 'operator' | 'business'; operatorId: string | null; businessId: string | null };
      scopeName: string | null;
    };
  }
}
