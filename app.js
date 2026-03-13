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

// Проброс данных пользователя во все шаблоны EJS
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});



app.get('/', (req, res) => {
    res.render('index', { title: 'Главная | ВентРесурс' });
});

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    // Если не админ, отправляем на страницу входа с сообщением
    res.status(403).send('Доступ только для администраторов');
}

app.get('/register', (req, res) => {
    res.render('register', { title: 'Регистрация | ВентРесурс' });
});

app.post('/register', async (req, res) => {
    const { username, full_name, email, password } = req.body; // Добавили username
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (username, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [username, full_name, email, hashedPassword, 'user']
        );
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.send('Ошибка при регистрации. Возможно, логин или email уже заняты.');
    }
});

app.get('/login', (req, res) => {
    res.render('login', { title: 'Вход | ВентРесурс' });
});

// ... (начало файла без изменений до маршрута регистрации)

app.post('/register', async (req, res) => {
    const { username, full_name, email, password } = req.body;
    
    try {
        // Проверка: не занят ли логин или email заранее (хороший тон)
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

// Исправленный вход: добавим обработку неверных данных без вылета на пустую страницу
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
            // Сохраняем сессию принудительно перед редиректом (защита от багов сессий)
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

// ... (остальное без изменений)

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/profile', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('profile', { title: 'Личный кабинет | ВентРесурс' });
});

app.get('/admin', isAdmin, async (req, res) => {
    try {
        // Получаем краткую статистику для главной страницы админки
        const [usersCount] = await db.query('SELECT COUNT(*) as count FROM users');
        const [projectsCount] = await db.query('SELECT COUNT(*) as count FROM projects');
        
        res.render('admin/dashboard', { 
            title: 'Панель управления | ВентРесурс',
            stats: {
                users: usersCount[0].count,
                projects: projectsCount[0].count
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки админ-панели');
    }
});

// Страница управления услугами (Список всех услуг)
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

// Обработка добавления новой услуги
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

// Обработка удаления услуги
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});