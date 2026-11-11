/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    supabase: import('@supabase/supabase-js').SupabaseClient;
    user: import('@supabase/supabase-js').User | null;
    portalCuenta: {
      cliente: string;
      email: string;
      estado: string;
    } | null;
  }
}
