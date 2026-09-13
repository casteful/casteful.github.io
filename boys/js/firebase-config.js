// ============================================================
// Firebase — SINGLE SOURCE OF TRUTH for all movie club data
// Realtime Database (europe-west1): movies-93171
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getDatabase, ref, onValue, get, update, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBK0qldiTkHjz6d8piyyo6m1lga8gQiNqQ",
  authDomain: "movies-93171.firebaseapp.com",
  databaseURL: "https://movies-93171-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "movies-93171",
  storageBucket: "movies-93171.firebasestorage.app",
  messagingSenderId: "510149400763",
  appId: "1:510149400763:web:485fc82054574f875df19e",
  measurementId: "G-0LK3ZDJ2S6"
};

const app = initializeApp(firebaseConfig);

let analytics = null;
try {
  // Analytics works on https:// and localhost; fails silently elsewhere (e.g. file://)
  analytics = getAnalytics(app);
} catch (e) {
  console.warn("Analytics not available:", e?.message);
}

const db = getDatabase(app);

export { app, analytics, db, ref, onValue, get, update, remove };
