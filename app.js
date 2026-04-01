const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');

dotenv.config();

const app = express();
const db = require('./config/db');

// Проверка подключения к БД
async function testConnection() {
    try {
        await db.query('SELECT 1');
        console.log('Database connected successfully');
    } catch (err) {
        console.error('Database connection failed:', err.message);
    }
}
testConnection();

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'vent-resurs-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- MIDDLEWARES ---

// 1. Настройки сайта во все шаблоны
app.use(async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT setting_key, setting_value FROM site_settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.locals.settings = settings; 
        next();
    } catch (err) {
        console.error('Ошибка в Middleware настроек:', err);
        res.locals.settings = {};
        next();
    }
});

// 2. Пользователь во все шаблоны
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- ФУНКЦИИ ПРОВЕРКИ ДОСТУПА ---

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Доступ только для администраторов');
}

function isAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
}

// --- ПУБЛИЧНЫЕ МАРШРУТЫ ---

app.get('/', async (req, res) => {
    try {
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index ASC');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index ASC');
        const [reps] = await db.query('SELECT * FROM partners WHERE partner_type = "representative"');
        const [clients] = await db.query('SELECT * FROM partners WHERE partner_type = "client"');
        
        res.render('index', { 
            title: 'Главная | ВентРесурс',
            slides, advantages, reps, clients
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки главной страницы');
    }
});

app.get('/services', async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('services', { title: 'Услуги под ключ | ВентРесурс', services });
    } catch (err) {
        res.status(500).send('Ошибка загрузки услуг');
    }
});

app.get('/projects', async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('projects', { title: 'Наши работы | ВентРесурс', projects });
    } catch (err) {
        res.status(500).send('Ошибка портфолио');
    }
});

app.get('/contacts', (req, res) => {
    res.render('contacts', { title: 'Контакты | ВентРесурс' });
});

// --- АВТОРИЗАЦИЯ ---

app.get('/register', (req, res) => {
    res.render('register', { title: 'Регистрация | ВентРесурс' });
});

app.post('/register', async (req, res) => {
    const { username, full_name, email, password } = req.body;
    try {
        const [existing] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) return res.render('register', { title: 'Регистрация', error: 'Данные заняты' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)', 
            [username, full_name, email, hashedPassword, 'user']);
        res.redirect('/login');
    } catch (err) {
        res.status(500).render('register', { title: 'Регистрация', error: 'Ошибка регистрации' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { title: 'Вход | ВентРесурс' });
});

app.post('/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [login]);
        if (users.length === 0) return res.render('login', { title: 'Вход', error: 'Пользователь не найден' });

        const user = users[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
            req.session.save(() => res.redirect(user.role === 'admin' ? '/admin' : '/profile'));
        } else {
            res.render('login', { title: 'Вход', error: 'Неверный пароль' });
        }
    } catch (err) {
        res.status(500).send('Ошибка входа');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ЛИЧНЫЙ КАБИНЕТ ---

app.get('/profile', isAuth, async (req, res) => {
    try {
        const [quizResults] = await db.query('SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
        res.render('profile', { title: 'Личный кабинет', quizResults });
    } catch (err) {
        res.status(500).send('Ошибка профиля');
    }
});

app.get('/profile/quiz', isAuth, (req, res) => {
    res.render('quiz', { title: 'Подбор системы вентиляции' });
});

app.post('/api/quiz-save', isAuth, async (req, res) => {
    const { building_type, area, people_count, budget_range, estimated_price } = req.body;
    try {
        await db.query('INSERT INTO quiz_results (user_id, building_type, area, people_count, budget_range, estimated_price) VALUES (?, ?, ?, ?, ?, ?)',
            [req.session.user.id, building_type, area, people_count, budget_range, estimated_price]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/callback', async (req, res) => {
    const { name, phone } = req.body;
    try {
        await db.query('INSERT INTO callbacks (name, phone) VALUES (?, ?)', [name, phone]);
        res.status(200).json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ message: 'error' });
    }
});

// --- АДМИН-ПАНЕЛЬ (ГРУППИРОВКА) ---

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const [[uCount]] = await db.query('SELECT COUNT(*) as count FROM users');
        const [[pCount]] = await db.query('SELECT COUNT(*) as count FROM projects');
        const [[sCount]] = await db.query('SELECT COUNT(*) as count FROM services');
        const [[cCount]] = await db.query('SELECT COUNT(*) as count FROM callbacks');
        
        const [recentQuiz] = await db.query(`
            SELECT qr.*, u.full_name, u.phone FROM quiz_results qr 
            JOIN users u ON qr.user_id = u.id ORDER BY qr.created_at DESC LIMIT 5
        `).catch(() => [[]]);

        res.render('admin/dashboard', { 
            title: 'Панель управления',
            stats: { users: uCount.count, projects: pCount.count, services: sCount.count, callbacks: cCount.count },
            recentQuiz
        });
    } catch (err) {
        res.status(500).send('Ошибка админки');
    }
});

// ТОТ САМЫЙ МАРШРУТ (ИСПРАВЛЕННЫЙ)
app.get('/admin/callbacks', isAdmin, async (req, res) => {
    try {
        const [callbacks] = await db.query('SELECT * FROM callbacks ORDER BY created_at DESC');
        res.render('admin/callbacks', { 
            title: 'Заявки на звонок | Админ-панель',
            callbacks: callbacks || []
            // settings и user НЕ НУЖНО передавать, они в res.locals
        });
    } catch (error) {
        res.status(500).send('Ошибка загрузки заявок');
    }
});

app.get('/admin/services', isAdmin, async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('admin/services', { title: 'Управление услугами', services });
    } catch (err) {
        res.status(500).send('Ошибка услуг');
    }
});

app.post('/admin/services/add', isAdmin, async (req, res) => {
    const { title, description, price, image_url } = req.body;
    try {
        await db.query('INSERT INTO services (title, description, price, image_url) VALUES (?, ?, ?, ?)', [title, description, price, image_url]);
        res.redirect('/admin/services');
    } catch (err) {
        res.status(500).send('Ошибка добавления');
    }
});

app.post('/admin/services/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
        res.redirect('/admin/services');
    } catch (err) {
        res.status(500).send('Ошибка удаления');
    }
});

app.get('/admin/home', isAdmin, async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category IN ("hero", "about", "geo")');
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index');
        const [partners] = await db.query('SELECT * FROM partners');
        res.render('admin/home_edit', { title: 'Управление главной', texts, slides, advantages, partners });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/admin/projects', isAdmin, async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('admin/projects_edit', { title: 'Управление проектами', projects });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/projects/add', isAdmin, async (req, res) => {
    const { year, title, object_type, image_url } = req.body;
    const slug = `projects-${year}-${Date.now()}`; 
    try {
        await db.query('INSERT INTO projects (year, title, object_type, image_url, slug) VALUES (?, ?, ?, ?, ?)', [year, title, object_type, image_url || 'project-placeholder.jpg', slug]);
        res.redirect('/admin/projects?success=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/projects/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.redirect('/admin/projects?deleted=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/admin/contacts', isAdmin, async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category = "contacts"');
        res.render('admin/contacts_edit', { title: 'Управление контактами', texts });
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.post('/admin/contacts/update', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/contacts?success=1');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/admin/content', isAdmin, async (req, res) => {
    const [settings] = await db.query('SELECT * FROM site_settings');
    res.render('admin/content', { title: 'Управление текстами', settings });
});

app.post('/admin/content/update', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/content');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

// Служебный роут
app.get('/reset-admin-password', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash('adm88@VENT556', 10);
        await db.query('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, 'admin']);
        res.send('Пароль обновлен!');
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

// Обработка изменения статуса заявки
app.post('/admin/callbacks/update-status/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        // Обновляем статус в таблице callbacks
        await db.query('UPDATE callbacks SET status = ? WHERE id = ?', [status, id]);
        
        // После успешного обновления возвращаемся на страницу списка
        res.redirect('/admin/callbacks');
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        res.status(500).send('Ошибка сервера при обновлении статуса');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});