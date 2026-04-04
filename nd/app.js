/* ============================================
   Movie Ratings App — Main Application Logic
   Uses GitHub API to store data in data.json
   ============================================ */

// ===== Global State =====
let appData = { movies: [], watchlist: [] };
let fileSha = null;         // SHA of data.json on GitHub (needed for updates)
let currentSort = { col: -1, asc: true };
let watchlistSort = { col: -1, asc: true };
let isSaving = false;

// ===== Configuration (hardcoded) =====
const CONFIG = {
    owner: 'casteful',
    repo: 'casteful.github.io',
    token: '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',
    branch: 'master'
};
const DATA_FILE = 'nd/data.json';
const API_BASE = 'https://api.github.com';

function getApiHeaders() {
    return {
        'Authorization': `token ${CONFIG.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };
}

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem('movieAppConfig');
    initApp();
});

// ===== App Initialization =====
async function initApp() {
    showLoading(true);

    try {
        await fetchData();
        document.getElementById('statusBar').classList.remove('d-none');
        document.querySelector('.status-dot').classList.remove('error');
    } catch (error) {
        console.error('Failed to initialize:', error);
        if (error.status === 404) {
            try {
                appData = { movies: [], watchlist: [] };
                await pushData('Initial commit — create data.json');
                document.getElementById('statusBar').classList.remove('d-none');
                document.querySelector('.status-dot').classList.remove('error');
            } catch (createErr) {
                console.error('Failed to create data.json:', createErr);
                document.getElementById('statusBar').classList.remove('d-none');
                document.querySelector('.status-dot').classList.add('error');
                document.querySelector('.status-text').innerHTML = '<span class="status-dot error"></span> Помилка підключення';
                showToast(`Помилка: ${createErr.message}`, 'error');
            }
        } else {
            document.getElementById('statusBar').classList.remove('d-none');
            document.querySelector('.status-dot').classList.add('error');
            document.querySelector('.status-text').innerHTML = '<span class="status-dot error"></span> Помилка підключення';
            showToast(`Помилка: ${error.message}`, 'error');
        }
    }

    showLoading(false);
    renderAll();
}

// ===== GitHub API — Read Data =====
async function fetchData() {
    const url = `${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${DATA_FILE}`;

    const response = await fetch(url, {
        headers: getApiHeaders()
    });

    if (!response.ok) {
        const err = new Error(`GitHub API error: ${response.status}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    fileSha = data.sha;

    try {
        appData = JSON.parse(atob(data.content));
    } catch (e) {
        appData = { movies: [], watchlist: [] };
    }

    // Ensure correct structure
    if (!Array.isArray(appData.movies)) appData.movies = [];
    if (!Array.isArray(appData.watchlist)) appData.watchlist = [];

    return appData;
}

// ===== GitHub API — Write Data =====
async function pushData(commitMessage) {
    if (isSaving) {
        throw new Error('Збереження вже триває...');
    }

    isSaving = true;
    showSavingIndicator(true);

    try {
        // Always fetch latest SHA before pushing to avoid conflicts
        const url = `${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${DATA_FILE}`;
        const headResponse = await fetch(url, {
            headers: getApiHeaders()
        });

        if (headResponse.ok) {
            const headData = await headResponse.json();
            fileSha = headData.sha;
        }

        const content = btoa(unescape(encodeURIComponent(JSON.stringify(appData, null, 2))));

        const body = {
            message: commitMessage || 'Update movie ratings',
            content: content,
            sha: fileSha,
            branch: CONFIG.branch
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: getApiHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || `GitHub API error: ${response.status}`);
        }

        const result = await response.json();
        fileSha = result.content.sha;

    } finally {
        isSaving = false;
        showSavingIndicator(false);
    }
}

// ===== Rendering =====
function renderAll() {
    renderMoviesTable();
    renderWatchlistTable();
    renderStats();
}

function renderMoviesTable() {
    const tbody = document.getElementById('moviesBody');
    const movies = [...appData.movies];

    // Apply sort
    if (currentSort.col >= 0) {
        const dir = currentSort.asc ? 1 : -1;
        movies.sort((a, b) => {
            let valA, valB;
            switch (currentSort.col) {
                case 2: valA = a.anas_rate; valB = b.anas_rate; break;
                case 3: valA = a.dima_rate; valB = b.dima_rate; break;
                case 4:
                    valA = (a.anas_rate + a.dima_rate) / 2;
                    valB = (b.anas_rate + b.dima_rate) / 2;
                    break;
                case 5: valA = a.anas_rate + a.dima_rate; valB = b.anas_rate + b.dima_rate; break;
                default: return 0;
            }
            return (valA - valB) * dir;
        });
    }

    if (movies.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <div class="empty-icon">&#127916;</div>
                        <p>Ще немає переглянутих фільмів. Додайте перший!</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = movies.map((movie, index) => {
        const avg = ((movie.anas_rate + movie.dima_rate) / 2).toFixed(1);
        const total = movie.anas_rate + movie.dima_rate;
        const id = movie.id;

        return `
        <tr>
            <td>${index + 1}</td>
            <td class="col-name-cell">${escapeHtml(movie.content)}</td>
            <td>${rateBadge(movie.anas_rate)}</td>
            <td>${rateBadge(movie.dima_rate)}</td>
            <td>${rateBadge(parseFloat(avg))}</td>
            <td><span class="font-weight-bold">${total}</span></td>
            <td>
                <button class="btn btn-edit btn-sm" onclick="openEditModal(${id})">Редагувати</button>
            </td>
        </tr>`;
    }).join('');
}

function renderWatchlistTable() {
    const tbody = document.getElementById('watchlistBody');
    const items = [...appData.watchlist];

    if (watchlistSort.col >= 0) {
        const dir = watchlistSort.asc ? 1 : -1;
        items.sort((a, b) => {
            return a.name.localeCompare(b.name) * dir;
        });
    }

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="2">
                    <div class="empty-state">
                        <div class="empty-icon">&#128203;</div>
                        <p>Список порожній. Додайте фільми для перегляду!</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = items.map((item, index) => `
        <tr>
            <td class="col-name-cell">${escapeHtml(item.name)}</td>
            <td>
                <button class="btn btn-move btn-sm mr-1" onclick="moveToWatched(${index})"
                        title="Перемістити до переглянутих">&#9654;</button>
                <button class="btn btn-delete btn-sm" onclick="confirmDeleteWatchlist(${index})">Видалити</button>
            </td>
        </tr>
    `).join('');
}

function renderStats() {
    const movies = appData.movies;
    const count = movies.length;

    if (count === 0) {
        document.getElementById('totalCount').textContent = '0';
        document.getElementById('totalAvg').textContent = '0.0';
        document.getElementById('totalCombined').textContent = '0.0';
        return;
    }

    const totalAvg = (movies.reduce((sum, m) => sum + (m.anas_rate + m.dima_rate) / 2, 0) / count).toFixed(1);
    const totalCombined = (movies.reduce((sum, m) => sum + m.anas_rate + m.dima_rate, 0) / count).toFixed(1);

    document.getElementById('totalCount').textContent = count;
    document.getElementById('totalAvg').textContent = totalAvg;
    document.getElementById('totalCombined').textContent = totalCombined;
}

// ===== Rate Badge Helper =====
function rateBadge(value) {
    const v = parseFloat(value);
    if (v === 0) return `<span class="rate-badge rate-zero">0</span>`;
    if (v <= 3) return `<span class="rate-badge rate-low">${v}</span>`;
    if (v <= 5) return `<span class="rate-badge rate-mid">${v}</span>`;
    if (v <= 7) return `<span class="rate-badge rate-high">${v}</span>`;
    return `<span class="rate-badge rate-top">${v}</span>`;
}

// ===== Add Movie =====
async function addMovie() {
    const name = document.getElementById('filmName').value.trim();
    const anasRate = parseInt(document.getElementById('anasRate').value) || 0;
    const dimaRate = parseInt(document.getElementById('dimaRate').value) || 0;

    if (!name) {
        showToast('Введіть назву фільму чи серіалу', 'warning');
        return;
    }

    if (anasRate < 0 || anasRate > 10 || dimaRate < 0 || dimaRate > 10) {
        showToast('Оцінка має бути від 0 до 10', 'warning');
        return;
    }

    // Generate new ID
    const maxId = appData.movies.reduce((max, m) => Math.max(max, m.id || 0), 0);
    const newMovie = {
        id: maxId + 1,
        content: name,
        anas_rate: clamp(anasRate, 0, 10),
        dima_rate: clamp(dimaRate, 0, 10)
    };

    appData.movies.push(newMovie);

    try {
        await pushData(`Додано: ${name}`);
        showToast(`"${name}" додано!`, 'success');

        // Clear form
        document.getElementById('filmName').value = '';
        document.getElementById('anasRate').value = '0';
        document.getElementById('dimaRate').value = '0';

        renderAll();
    } catch (error) {
        // Revert
        appData.movies.pop();
        showToast(`Помилка збереження: ${error.message}`, 'error');
    }
}

// ===== Edit Movie =====
function openEditModal(id) {
    const movie = appData.movies.find(m => m.id === id);
    if (!movie) return;

    document.getElementById('editId').value = id;
    document.getElementById('editName').value = movie.content;
    document.getElementById('editAnasRate').value = movie.anas_rate;
    document.getElementById('editDimaRate').value = movie.dima_rate;

    $('#editModal').modal('show');
}

async function saveEdit() {
    const id = parseInt(document.getElementById('editId').value);
    const name = document.getElementById('editName').value.trim();
    const anasRate = parseInt(document.getElementById('editAnasRate').value) || 0;
    const dimaRate = parseInt(document.getElementById('editDimaRate').value) || 0;

    if (!name) {
        showToast('Назва не може бути порожньою', 'warning');
        return;
    }

    if (anasRate < 0 || anasRate > 10 || dimaRate < 0 || dimaRate > 10) {
        showToast('Оцінка має бути від 0 до 10', 'warning');
        return;
    }

    const movieIndex = appData.movies.findIndex(m => m.id === id);
    if (movieIndex === -1) return;

    const oldName = appData.movies[movieIndex].content;

    // Save old state for rollback
    const oldMovie = { ...appData.movies[movieIndex] };

    appData.movies[movieIndex] = {
        id: id,
        content: name,
        anas_rate: clamp(anasRate, 0, 10),
        dima_rate: clamp(dimaRate, 0, 10)
    };

    try {
        const msg = oldName !== name
            ? `Оновлено: "${oldName}" → "${name}"`
            : `Оновлено оцінки: ${name}`;
        await pushData(msg);
        showToast(`"${name}" оновлено!`, 'success');
        $('#editModal').modal('hide');
        renderAll();
    } catch (error) {
        // Revert
        appData.movies[movieIndex] = oldMovie;
        showToast(`Помилка збереження: ${error.message}`, 'error');
    }
}

// ===== Delete Movie =====
let pendingDeleteId = null;

function confirmDeleteMovie() {
    const id = parseInt(document.getElementById('editId').value);
    const movie = appData.movies.find(m => m.id === id);
    if (!movie) return;

    pendingDeleteId = id;
    document.getElementById('deleteConfirmName').textContent = `"${movie.content}"`;
    $('#deleteConfirmModal').modal('show');

    document.getElementById('confirmDeleteBtn').onclick = async function () {
        await executeDeleteMovie();
        $('#deleteConfirmModal').modal('hide');
        $('#editModal').modal('hide');
    };
}

async function executeDeleteMovie() {
    if (pendingDeleteId === null) return;

    const movieIndex = appData.movies.findIndex(m => m.id === pendingDeleteId);
    if (movieIndex === -1) return;

    const deletedMovie = appData.movies.splice(movieIndex, 1)[0];
    const deletedName = deletedMovie.content;

    try {
        await pushData(`Видалено: ${deletedName}`);
        showToast(`"${deletedName}" видалено!`, 'success');
        pendingDeleteId = null;
        renderAll();
    } catch (error) {
        // Revert
        appData.movies.splice(movieIndex, 0, deletedMovie);
        showToast(`Помилка: ${error.message}`, 'error');
    }
}

// ===== Watchlist =====
function openAddWatchlistModal() {
    document.getElementById('watchlistName').value = '';
    $('#addWatchlistModal').modal('show');
}

async function addToWatchlist() {
    const name = document.getElementById('watchlistName').value.trim();
    if (!name) {
        showToast('Введіть назву фільму чи серіалу', 'warning');
        return;
    }

    appData.watchlist.push({ name });

    try {
        await pushData(`Додано до списку: ${name}`);
        showToast(`"${name}" додано до списку!`, 'success');
        $('#addWatchlistModal').modal('hide');
        renderAll();
    } catch (error) {
        appData.watchlist.pop();
        showToast(`Помилка: ${error.message}`, 'error');
    }
}

let pendingDeleteWatchlistIndex = null;

function confirmDeleteWatchlist(index) {
    const item = appData.watchlist[index];
    pendingDeleteWatchlistIndex = index;
    document.getElementById('deleteConfirmName').textContent = `"${item.name}"`;
    $('#deleteConfirmModal').modal('show');

    document.getElementById('confirmDeleteBtn').onclick = async function () {
        await executeDeleteWatchlist();
        $('#deleteConfirmModal').modal('hide');
    };
}

async function executeDeleteWatchlist() {
    if (pendingDeleteWatchlistIndex === null) return;

    const deletedItem = appData.watchlist.splice(pendingDeleteWatchlistIndex, 1)[0];

    try {
        await pushData(`Видалено зі списку: ${deletedItem.name}`);
        showToast(`"${deletedItem.name}" видалено!`, 'success');
        pendingDeleteWatchlistIndex = null;
        renderAll();
    } catch (error) {
        appData.watchlist.splice(pendingDeleteWatchlistIndex, 0, deletedItem);
        showToast(`Помилка: ${error.message}`, 'error');
    }
}

async function moveToWatched(index) {
    const item = appData.watchlist[index];
    if (!item) return;

    const maxId = appData.movies.reduce((max, m) => Math.max(max, m.id || 0), 0);
    const newMovie = {
        id: maxId + 1,
        content: item.name,
        anas_rate: 0,
        dima_rate: 0
    };

    appData.movies.push(newMovie);
    appData.watchlist.splice(index, 1);

    try {
        await pushData(`Переміщено до переглянутих: ${item.name}`);
        showToast(`"${item.name}" переміщено!`, 'success');
        renderAll();
    } catch (error) {
        // Revert
        appData.movies.pop();
        appData.watchlist.splice(index, 0, item);
        showToast(`Помилка: ${error.message}`, 'error');
    }
}

// ===== Random Pick =====
function pickRandom() {
    if (appData.watchlist.length === 0) {
        showToast('Список "Подивитися наступного разу" порожній!', 'warning');
        return;
    }

    const randomIndex = Math.floor(Math.random() * appData.watchlist.length);
    const movie = appData.watchlist[randomIndex];

    document.getElementById('randomMovieName').textContent = movie.name;
    document.getElementById('randomResult').classList.remove('d-none');
}

// ===== Sorting =====
function sortTable(colIndex) {
    // Clear all sort icons
    for (let i = 2; i <= 5; i++) {
        const icon = document.getElementById(`sortIcon${i}`);
        if (icon) icon.className = 'sort-icon';
    }

    if (currentSort.col === colIndex) {
        currentSort.asc = !currentSort.asc;
    } else {
        currentSort.col = colIndex;
        currentSort.asc = false; // Descending by default
    }

    const icon = document.getElementById(`sortIcon${colIndex}`);
    if (icon) {
        icon.className = `sort-icon ${currentSort.asc ? 'asc' : 'desc'}`;
    }

    renderMoviesTable();
}

function sortWatchlistTable(colIndex) {
    const icon = document.getElementById(`sortIconW${colIndex}`);
    if (icon) icon.className = 'sort-icon';

    if (watchlistSort.col === colIndex) {
        watchlistSort.asc = !watchlistSort.asc;
    } else {
        watchlistSort.col = colIndex;
        watchlistSort.asc = true;
    }

    if (icon) {
        icon.className = `sort-icon ${watchlistSort.asc ? 'asc' : 'desc'}`;
    }

    renderWatchlistTable();
}

// ===== UI Helpers =====
function showLoading(show) {
    const el = document.getElementById('loadingOverlay');
    if (show) {
        el.classList.remove('d-none');
    } else {
        el.classList.add('d-none');
    }
}

function showSavingIndicator(show) {
    let el = document.querySelector('.saving-indicator');
    if (show) {
        if (!el) {
            el = document.createElement('div');
            el.className = 'saving-indicator';
            el.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Збереження...';
            document.body.appendChild(el);
        }
    } else if (el) {
        el.remove();
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;

    let icon = '';
    switch (type) {
        case 'success': icon = '&#10003;'; break;
        case 'error': icon = '&#10007;'; break;
        case 'warning': icon = '&#9888;&#65039;'; break;
        default: icon = '&#8505;&#65039;';
    }

    toast.innerHTML = `<span>${icon}</span> ${escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // Enter in add form
    if (e.key === 'Enter' && document.activeElement.closest('#addMovieForm')) {
        e.preventDefault();
        addMovie();
    }
    // Enter in watchlist form
    if (e.key === 'Enter' && document.activeElement.closest('#watchlistForm')) {
        e.preventDefault();
        addToWatchlist();
    }
});
