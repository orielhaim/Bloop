import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { version } from './package.json';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
  ],
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(version),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
});
