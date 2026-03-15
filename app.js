const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');

dotenv.config();

const app = express();

const db = require('./config/db');

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
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // Сессия на 1 день
}));

// Middleware: Достаем настройки из БД и делаем их доступными везде
app.use(async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT setting_key, setting_value FROM site_settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        // Это делает объект settings доступным во всех .ejs файлах без передачи вручную
        res.locals.settings = settings; 
        next();
    } catch (err) {
        console.error('Ошибка в Middleware настроек:', err);
        res.locals.settings = {}; // Защита от падения
        next();
    }
});


app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});



app.get('/', async (req, res) => {
    try {
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index ASC');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index ASC');
        const [reps] = await db.query('SELECT * FROM partners WHERE partner_type = "representative"');
        const [clients] = await db.query('SELECT * FROM partners WHERE partner_type = "client"');
        
        res.render('index', { 
            title: 'Главная | ВентРесурс',
            slides,
            advantages,
            reps,
            clients
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки главной страницы');
    }
});

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    // Если не админ, отправляем на страницу входа с сообщением
    res.status(403).send('Доступ только для администраторов');
}

// Функция для проверки, авторизован ли пользователь
function isAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next(); // Пользователь авторизован, идем дальше
    }
    // Если не авторизован — отправляем на страницу входа
    res.redirect('/login');
}

app.get('/register', (req, res) => {
    res.render('register', { title: 'Регистрация | ВентРесурс' });
});

app.post('/register', async (req, res) => {
    const { username, full_name, email, password } = req.body;
    
    try {
        // Проверка: не занят ли логин или email заранее
        const [existingUser] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser.length > 0) {
            return res.render('register', { title: 'Регистрация', error: 'Логин или Email уже заняты' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (username, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [username, full_name, email, hashedPassword, 'user']
        );
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).render('register', { title: 'Регистрация', error: 'Ошибка сервера при регистрации' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { title: 'Вход | ВентРесурс' });
});

app.post('/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [login]);
        
        if (users.length === 0) {
            return res.render('login', { title: 'Вход', error: 'Пользователь не найден' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            req.session.user = {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role
            };
            req.session.save(() => {
                res.redirect(user.role === 'admin' ? '/admin' : '/profile');
            });
        } else {
            return res.render('login', { title: 'Вход', error: 'Неверный пароль' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/profile', isAuth, async (req, res) => {
    try {
        // Получаем результаты квиза именно для этого пользователя
        const [quizResults] = await db.query(
            'SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC', 
            [req.session.user.id]
        );

        res.render('profile', { 
            title: 'Личный кабинет | ВентРесурс',
            user: req.session.user,
            quizResults: quizResults // Передаем данные на страницу
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при загрузке профиля');
    }
});

// Страница квиза в личном кабинете
app.get('/profile/quiz', isAuth, (req, res) => {
    res.render('quiz', { 
        title: 'Подбор системы вентиляции | ВентРесурс',
        user: req.session.user 
    });
});

// Обработка результатов квиза
app.post('/api/quiz-save', isAuth, async (req, res) => {
    const { building_type, area, people_count, budget_range, estimated_price } = req.body;
    const userId = req.session.user.id;

    try {
        await db.query(
            'INSERT INTO quiz_results (user_id, building_type, area, people_count, budget_range, estimated_price) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, building_type, area, people_count, budget_range, estimated_price]
        );
        res.json({ success: true, message: 'Результат сохранен' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка БД' });
    }
});

// СТРАНИЦА "НАШИ РАБОТЫ"
app.get('/projects', async (req, res) => {
    try {
        // Получаем проекты из созданной нами таблицы
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        
        res.render('projects', { 
            title: 'Наши работы | ВентРесурс',
            projects: projects
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при загрузке портфолио');
    }
});

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const [usersCount] = await db.query('SELECT COUNT(*) as count FROM users');
        const [projectsCount] = await db.query('SELECT COUNT(*) as count FROM projects');
        const [servicesCount] = await db.query('SELECT COUNT(*) as count FROM services');
        
        // Получаем последние 5 расчетов из квиза для админки
        const [recentQuiz] = await db.query(`
            SELECT qr.*, u.full_name, u.phone 
            FROM quiz_results qr 
            JOIN users u ON qr.user_id = u.id 
            ORDER BY qr.created_at DESC LIMIT 5
        `);
        
        res.render('admin/dashboard', { 
            title: 'Панель управления',
            stats: {
                users: usersCount[0].count,
                projects: projectsCount[0].count,
                services: servicesCount[0].count
            },
            recentQuiz: recentQuiz // Передаем в админку
        });
    } catch (err) { /* ... */ }
});

app.get('/admin/services', isAdmin, async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('admin/services', { 
            title: 'Управление услугами | ВентРесурс',
            services: services 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка получения списка услуг');
    }
});

app.post('/admin/services/add', isAdmin, async (req, res) => {
    const { title, description, price, image_url } = req.body;
    try {
        await db.query(
            'INSERT INTO services (title, description, price, image_url) VALUES (?, ?, ?, ?)',
            [title, description, price, image_url]
        );
        res.redirect('/admin/services');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при добавлении услуги');
    }
});

app.post('/admin/services/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
        res.redirect('/admin/services');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении');
    }
});

app.get('/reset-admin-password', async (req, res) => {
    try {
        const newPassword = 'adm88@VENT556';
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await db.query(
            'UPDATE users SET password = ? WHERE username = ?',
            [hashedPassword, 'admin']
        );
        
        res.send('Пароль администратора успешно обновлен в БД! Теперь попробуйте войти на /login');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при обновлении пароля');
    }
});

app.get('/admin/content', isAdmin, async (req, res) => {
    const [settings] = await db.query('SELECT * FROM site_settings');
    res.render('admin/content', { title: 'Управление текстами', settings: settings });
});

app.post('/admin/content/update', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/content');
    } catch (err) {
        res.status(500).send('Ошибка обновления');
    }
});

app.get('/admin/home', isAdmin, async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category IN ("hero", "about", "geo")');
        const [slides] = await db.query('SELECT * FROM home_slider ORDER BY order_index');
        const [advantages] = await db.query('SELECT * FROM advantages ORDER BY order_index');
        const [partners] = await db.query('SELECT * FROM partners');

        res.render('admin/home_edit', {
            title: 'Управление главной | Админ',
            texts,
            slides,
            advantages,
            partners
        });
    } catch (err) {
        res.status(500).send('Ошибка загрузки данных для редактирования');
    }
});

app.post('/admin/home/update-texts', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/home?success=1');
    } catch (err) {
        res.status(500).send('Ошибка обновления текстов');
    }
});

app.post('/admin/home/update-advantages', isAdmin, async (req, res) => {
    const { id, title, description, icon_name } = req.body;
    try {
        for (let i = 0; i < id.length; i++) {
            await db.query(
                'UPDATE advantages SET title = ?, description = ?, icon_name = ? WHERE id = ?',
                [title[i], description[i], icon_name[i], id[i]]
            );
        }
        res.redirect('/admin/home?success=1');
    } catch (err) {
        res.status(500).send('Ошибка обновления преимуществ');
    }
});

app.get('/services', async (req, res) => {
    try {
        const [services] = await db.query('SELECT * FROM services');
        res.render('services', { 
            title: 'Услуги под ключ | ВентРесурс', 
            services: services 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки услуг');
    }
});

// --- УПРАВЛЕНИЕ ПРОЕКТАМИ В АДМИНКЕ ---

// 1. Страница списка проектов
app.get('/admin/projects', isAdmin, async (req, res) => {
    try {
        const [projects] = await db.query('SELECT * FROM projects ORDER BY year DESC');
        res.render('admin/projects_edit', {
            title: 'Управление проектами | Админ',
            projects: projects
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки списка проектов');
    }
});

// 2. Добавление нового проекта
app.post('/admin/projects/add', isAdmin, async (req, res) => {
    const { year, title, object_type, image_url } = req.body;
    // Создаем простой slug из года (например, projects-2024)
    const slug = `projects-${year}-${Date.now()}`; 
    try {
        await db.query(
            'INSERT INTO projects (year, title, object_type, image_url, slug) VALUES (?, ?, ?, ?, ?)',
            [year, title, object_type, image_url || 'project-placeholder.jpg', slug]
        );
        res.redirect('/admin/projects?success=1');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при добавлении проекта');
    }
});

// 3. Удаление проекта
app.post('/admin/projects/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.redirect('/admin/projects?deleted=1');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении проекта');
    }
});

// ПУБЛИЧНАЯ СТРАНИЦА КОНТАКТОВ
app.get('/contacts', (req, res) => {
    // Данные settings берутся автоматически из Middleware (res.locals.settings)
    res.render('contacts', { 
        title: 'Контакты | ВентРесурс'
    });
});

// АДМИНКА: СТРАНИЦА РЕДАКТИРОВАНИЯ КОНТАКТОВ
app.get('/admin/contacts', isAdmin, async (req, res) => {
    try {
        const [texts] = await db.query('SELECT * FROM site_settings WHERE category = "contacts"');
        res.render('admin/contacts_edit', {
            title: 'Управление контактами | Админ',
            texts
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки страницы управления контактами');
    }
});

// АДМИНКА: СОХРАНЕНИЕ КОНТАКТОВ
app.post('/admin/contacts/update', isAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (let key in updates) {
            await db.query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [updates[key], key]);
        }
        res.redirect('/admin/contacts?success=1');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка обновления контактов');
    }
});



app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});