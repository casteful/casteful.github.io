// ============================================================
// Конфігурація Фільмотеки
// ============================================================

// Firebase (Realtime Database)
export const firebaseConfig = {
  apiKey: "AIzaSyArJCpiFouIStnxZNaFMcFbM3K5Um9e13Q",
  authDomain: "ndmovies-a6065.firebaseapp.com",
  databaseURL: "https://ndmovies-a6065-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ndmovies-a6065",
  storageBucket: "ndmovies-a6065.firebasestorage.app",
  messagingSenderId: "283025297567",
  appId: "1:283025297567:web:9185355a5b3ba9b0ac92aa"
};

// Учасники кіноклубу.
// Щоб додати або прибрати друга — просто відредагуйте цей список.
// "color" — колір аватарки (будь-який CSS-колір).
export const USERS = [
  { id: "dima", name: "Дмитро",    color: "#2fbf9b" },
  { id: "anas", name: "Анастасія", color: "#ef6a8b" }
];

// OMDb API (необов'язкове джерело постерів).
// Отримайте безкоштовний ключ на https://www.omdbapi.com/apikey.aspx
// і вставте його сюди. Порожній рядок = OMDb не використовується
// (додаток тоді шукає постери через IMDb / Wikidata / TVMaze / Вікіпедію).
export const OMDB_API_KEY = "";
