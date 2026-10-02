// Where the Flaner backend lives. The Mini App is a static site, so the backend is a separate origin in production
// (set VITE_API_BASE_URL at build time, e.g. https://flaner.onrender.com). Left empty it means "same origin",
// which is what the Vite dev proxy uses.
const configured = (import.meta.env.VITE_API_BASE_URL ?? '') as string;

export const API_BASE_URL = configured.trim().replace(/\/+$/, '');

export const apiUrl = (path: string): string => `${API_BASE_URL}${path}`;
