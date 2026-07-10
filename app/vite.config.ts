import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

// Dev: proxy API calls to the Bun server on :3000.
// Prod: the Bun server serves the built app on its own origin, so relative
// fetches to /resolve just work (no proxy needed).
const API_TARGET = "http://localhost:3000";

export default defineConfig({
  plugins: [
    solid(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "Meijer Aisle Finder",
        short_name: "Aisles",
        description: "Sort a Meijer shopping list by in-store aisle & section.",
        theme_color: "#0c60a5",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/resolve": API_TARGET,
      "/health": API_TARGET,
    },
  },
});
