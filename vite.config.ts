import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { generateApiPlugin } from "./vite-plugin-generate-api.ts";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Empty prefix: load OPENAI_API_KEY from .env / .env.local without exposing it to the client.
  const env = loadEnv(mode, process.cwd(), "");
  const getApiKey = () =>
    process.env.OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;

  return {
    plugins: [react(), generateApiPlugin(getApiKey)],
  };
});
