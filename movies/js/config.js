// ============================================================
// Конфігурація Фільмотеки
// ============================================================

// Firebase (Realtime Database)
export const firebaseConfig = {
  apiKey: "AIzaSyAQj1HGWtXMnAywpOlIybuz72zwzYkQdjs",
  authDomain: "movieboys-e98ad.firebaseapp.com",
  databaseURL: "https://movieboys-e98ad-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "movieboys-e98ad",
  storageBucket: "movieboys-e98ad.firebasestorage.app",
  messagingSenderId: "585437567360",
  appId: "1:585437567360:web:e662957128b27352134965"
};

// Учасники кіноклубу.
// Щоб додати або прибрати друга — просто відредагуйте цей список.
// "id" має збігатися з ключами оцінок у базі (films/*/ratings/<id>).
// "color" — колір аватарки (будь-який CSS-колір).
export const USERS = [
  { id: "dima", name: "Діма",  color: "#2fbf9b" },
  { id: "deni", name: "Денис", color: "#8b7cf6" },
  { id: "ihor", name: "Ігор",  color: "#4aa3e8" },
  { id: "yura", name: "Юра",   color: "#ef6a8b" }
];

// OMDb API (необов'язкове джерело постерів).
// Отримайте безкоштовний ключ на https://www.omdbapi.com/apikey.aspx
// і вставте його сюди. Порожній рядок = OMDb не використовується
// (додаток тоді шукає постери через IMDb / Wikidata / TVMaze / Вікіпедію).
export const OMDB_API_KEY = "";
