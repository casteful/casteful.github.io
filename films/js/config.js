// ============================================================
// Конфігурація Фільмотеки
// ============================================================

// Firebase (Realtime Database)
export const firebaseConfig = {
  apiKey: "AIzaSyD96Qven6wN8Kit_KE0kF8-lYAu4HOAIlA",
  authDomain: "films-9deb2.firebaseapp.com",
  databaseURL: "https://films-9deb2-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "films-9deb2",
  storageBucket: "films-9deb2.firebasestorage.app",
  messagingSenderId: "684499330373",
  appId: "1:684499330373:web:64183e6c061ebe71298a2c"
};

// Учасники кіноклубу.
// Щоб додати або прибрати друга — просто відредагуйте цей список.
// "color" — колір аватарки (будь-який CSS-колір).
export const USERS = [
  { id: "surguy",    name: "surguy",    color: "#d99a2b" },
  { id: "q1oob",     name: "q1oob",     color: "#8b7cf6" },
  { id: "dimyeah",   name: "dimyeah",   color: "#2fbf9b" },
  { id: "burlaka21", name: "burlaka21", color: "#ef6a8b" },
  { id: "oddfriend", name: "oddfriend", color: "#4aa3e8" }
];

// OMDb API (необов'язкове джерело постерів).
// Отримайте безкоштовний ключ на https://www.omdbapi.com/apikey.aspx
// і вставте його сюди. Порожній рядок = OMDb не використовується
// (додаток тоді шукає постери через IMDb / Wikidata / TVMaze / Вікіпедію).
export const OMDB_API_KEY = "";
