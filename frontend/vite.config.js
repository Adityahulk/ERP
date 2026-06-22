import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        host: true,
        port: 3000,
        // Vite runs hostCheck *before* the proxy. Non-localhost Host (tunnels, *.local,
        // host.docker.internal, preview URLs) gets 403 and the API is never reached.
        allowedHosts: true,
        proxy: {
            '/api': {
                // Prefer IPv4 loopback so the proxy always reaches the API if it binds on 127.0.0.1.
                target: 'http://127.0.0.1:5001',
                changeOrigin: true,
            },
            '/uploads': {
                target: 'http://127.0.0.1:5001',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
