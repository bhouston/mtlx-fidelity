import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin';

import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

/** Injected into the client bundle; override via env at build time (see Dockerfile `ARG` / `ENV`). */
const DEFAULT_SITE_NAME = 'MTLX Fidelity';
const DEFAULT_SITE_DESCRIPTION =
  'Browse MaterialX sample materials and compare renderer reference output side-by-side to spot visual differences and inspect render logs.';
const DEFAULT_SITE_IMAGE = '/Preview.webp';
/** Default `twitter:site` handle; override with `TWITTER_SITE` when building. */
const DEFAULT_TWITTER_SITE = '@BenHouston3D';
const DEFAULT_BASE_URL = 'https://material-fidelity.ben3d.ca';

const env = process.env;

function envValue(name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  define: {
    /** Public origin (`https://…`) for canonical URLs and absolute OG/Twitter images. Set `BASE_URL` when building. */
    'import.meta.env.VITE_BASE_URL': JSON.stringify(envValue('BASE_URL', DEFAULT_BASE_URL)),
    'import.meta.env.VITE_SITE_NAME': JSON.stringify(envValue('SITE_NAME', DEFAULT_SITE_NAME)),
    'import.meta.env.VITE_SITE_DESCRIPTION': JSON.stringify(envValue('SITE_DESCRIPTION', DEFAULT_SITE_DESCRIPTION)),
    'import.meta.env.VITE_DEFAULT_SITE_IMAGE': JSON.stringify(envValue('DEFAULT_SITE_IMAGE', DEFAULT_SITE_IMAGE)),
    /** Twitter/X handle for `twitter:site`; defaults to @BenHouston3D unless `TWITTER_SITE` is set when building. */
    'import.meta.env.VITE_TWITTER_SITE': JSON.stringify(envValue('TWITTER_SITE', DEFAULT_TWITTER_SITE)),
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    nitroV2Plugin({
      preset: 'node-server',
      compatibilityDate: '2025-11-07',
      compressPublicAssets: {
        gzip: true,
        brotli: false,
      },
      routeRules: {
        '/assets/**': {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
          },
        },
      },
    }),
  ],
});

export default config;
